"use strict";
/* ------------------------------------------------------------------
   DspLink – a paced SIS session over TCP (Extron DMP 128 / DMP 64)
   ------------------------------------------------------------------
   Protocol-agnostic apart from the Esc…CR framing and the "Password:"
   prompt: it hands every reply line to the owner (event "line") and
   takes commands through send(). What it owns is the hard part of
   talking to a DSP over telnet:

     pacing      state reads go one at a time with a gap between them – a
                 burst of ~75 reads at session start stalls the DMP's telnet
                 handler and the link dies with ETIMEDOUT
     bursts      user actions (urgent) may have `burst` commands in flight at
                 once, so a group fader moving five zones updates all five
                 together; they also jump ahead of queued reads
     dedupe      a newer command with the same key replaces one still queued,
                 so a fader drag never builds a backlog of stale values
     keepalive   a harmless view command every keepAliveMs
     watchdog    reconnect when nothing has been received for silenceTimeoutMs
     reconnect   after any error/close, after reconnectMs

   Events: "up" (session started – send your initial reads), "down" (why),
           "line" (one reply line), "tx"/"rx" (raw, when debug).
   ------------------------------------------------------------------ */
const net = require("net");
const EventEmitter = require("events");
const { log } = require("./util");

const ESC = "\x1B", CR = "\r";

class DspLink extends EventEmitter {
  /* opts.conn():   () => { host, port, password }
     opts.timing(): () => { reconnectMs, keepAliveMs, silenceTimeoutMs, pollMs, minGapMs, replyTimeoutMs, burst }
     opts.session:  { verbose, keepAlive } – SIS commands sent at session start / as keepalive
     opts.debug:    log every byte */
  constructor(opts) {
    super();
    this.conn = opts.conn; this.timing = opts.timing; this.session = opts.session || {}; this.debug = !!opts.debug;
    this.sock = null; this.ready = false; this.rxBuf = ""; this.lastRx = 0;
    this.txQueue = []; this.inFlight = 0; this.lastTx = 0;
    this.timers = {};
  }
  get connected() { return this.ready; }

  /* ---- outgoing ---- */
  /* send(cmd, urgent, key): cmd without Esc/CR. urgent = user action; key = replace an identical pending command */
  send(cmd, urgent, key) {
    const item = { c: ESC + cmd + CR, urgent: !!urgent, key };
    if (key) { const i = this.txQueue.findIndex(x => x.key === key); if (i >= 0) { this.txQueue[i] = item; this.pump(); return; } }
    if (urgent) { let i = 0; while (i < this.txQueue.length && this.txQueue[i].urgent) i++; this.txQueue.splice(i, 0, item); } else this.txQueue.push(item);
    this.pump();
  }
  pace() {
    const t = this.timing();
    return { minGapMs: t.minGapMs != null ? t.minGapMs : 100, replyTimeoutMs: t.replyTimeoutMs != null ? t.replyTimeoutMs : 400, burst: t.burst != null ? Math.max(1, Math.min(10, Number(t.burst))) : 5 };
  }
  pump() {
    if (!this.txQueue.length || !this.sock || this.sock.destroyed) return;
    const pace = this.pace(), next = this.txQueue[0];
    if (next.urgent ? this.inFlight >= pace.burst : this.inFlight > 0) return;          // wait for replies
    if (!next.urgent || this.inFlight === 0) {                                             // the gap applies between paced sends, not inside a burst
      const wait = pace.minGapMs - (Date.now() - this.lastTx);
      if (wait > 0) { clearTimeout(this.timers.pump); this.timers.pump = setTimeout(() => this.pump(), wait); return; }
    }
    const c = this.txQueue.shift().c;
    this.inFlight++; this.lastTx = Date.now();
    this.sock.write(c);
    if (this.debug) log("DSP ←", JSON.stringify(c));
    clearTimeout(this.timers.inFlight); this.timers.inFlight = setTimeout(() => { this.inFlight = 0; this.pump(); }, pace.replyTimeoutMs);   // no reply → move on
    if (next.urgent) this.pump();                                                          // fill the burst
  }
  replied() { if (this.inFlight > 0) this.inFlight--; if (this.inFlight === 0) clearTimeout(this.timers.inFlight); this.pump(); }

  /* ---- connection ---- */
  connect() {
    clearTimeout(this.timers.reconnect);
    const { host, port } = this.conn();
    log(`DSP: connecting to ${host}:${port}`);
    const sock = this.sock = net.createConnection({ host, port });
    sock.setNoDelay(true);
    sock.setKeepAlive(true, 10000);
    sock.on("connect", () => { log("DSP: TCP connected, waiting for banner"); this.timers.login = setTimeout(() => this.startSession(), 1500); });
    sock.on("data", buf => {
      this.lastRx = Date.now();
      const text = buf.toString("latin1");
      if (this.debug) log("DSP →", JSON.stringify(text));
      if (/Password:/i.test(text)) { clearTimeout(this.timers.login); sock.write(this.conn().password + CR); this.timers.login = setTimeout(() => this.startSession(), 500); return; }
      this.rxBuf += text;
      let i;
      while ((i = this.rxBuf.search(/\r\n|\r|\n/)) >= 0) {
        const line = this.rxBuf.slice(0, i).trim(); this.rxBuf = this.rxBuf.slice(i).replace(/^(\r\n|\r|\n)/, "");
        if (line) { this.emit("line", line); this.replied(); }
      }
    });
    sock.on("error", e => this.down(e.message));
    sock.on("close", () => this.down("closed"));
  }
  /* drop the current session (and reconnect after reconnectMs) */
  reconnect(why) { if (this.sock) this.sock.destroy(new Error(why || "reconnect")); else this.connect(); }
  down(why) {
    if (this.ready || this.sock) log("DSP: link down", why || "");
    this.ready = false; this.sock = null; this.rxBuf = ""; this.txQueue.length = 0; this.inFlight = 0;
    for (const k of ["inFlight", "login", "pump"]) clearTimeout(this.timers[k]);
    for (const k of ["poll", "keepAlive", "watchdog"]) clearInterval(this.timers[k]);
    this.emit("down", why);
    this.timers.reconnect = setTimeout(() => this.connect(), this.timing().reconnectMs || 3000);
  }
  startSession() {
    if (this.ready) return;
    this.ready = true; this.lastRx = Date.now();
    log("DSP: session started – verbose mode + full state read");
    if (this.session.verbose) this.send(this.session.verbose);
    this.emit("up");
    const t = this.timing();
    if (t.pollMs > 0) this.timers.poll = setInterval(() => this.emit("poll"), t.pollMs);
    if (t.keepAliveMs > 0 && this.session.keepAlive) this.timers.keepAlive = setInterval(() => this.send(this.session.keepAlive), t.keepAliveMs);
    if (t.silenceTimeoutMs > 0) this.timers.watchdog = setInterval(() => {
      if (this.sock && Date.now() - this.lastRx > t.silenceTimeoutMs) { log(`DSP: no data for ${Math.round((Date.now() - this.lastRx) / 1000)} s – reconnecting`); this.sock.destroy(new Error("silence timeout")); }
    }, 5000);
  }
}

module.exports = { DspLink };
