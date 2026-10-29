"use strict";
/* ------------------------------------------------------------------
   Controller – joins ⇄ DSP objects
   ------------------------------------------------------------------
   Owns the current join state (what every panel shows), translates
   panel actions into SIS commands for the DspLink, and translates DMP
   replies (verbose mode 3) back into join state. The DSP is the single
   source of truth: nothing lights up until the DMP has reported it.

   Events: "change" ({t:"b"|"n", j, v}) – a join changed; forward to panels.
   ------------------------------------------------------------------ */
const EventEmitter = require("events");
const { buildModel } = require("./model");
const { tpl, log } = require("./util");

class Controller extends EventEmitter {
  constructor(store, dsp) {
    super();
    this.store = store; this.dsp = dsp;
    this.state = { b: new Map(), n: new Map() };
    this.pressed = new Set();
    this.analogPending = new Map();
    this.model = buildModel(store.site);
    dsp.on("line", line => this.onDspLine(line));
    dsp.on("up", () => this.readAllState());
    dsp.on("poll", () => this.readAllState());
    store.on("applied", ({ dspChanged }) => this.onSiteApplied(dspChanged));
  }
  get M() { return this.model; }

  /* ---- configuration changed ---- */
  onSiteApplied(dspChanged) {
    this.model = buildModel(this.store.site);
    this.dsp.session = { verbose: this.model.sis.verbose, keepAlive: this.model.sis.keepAlive };
    for (const j of [...this.state.b.keys()]) if (!this.model.digital.has(j)) this.state.b.delete(j);   // forget joins that no longer exist
    for (const j of [...this.state.n.keys()]) if (!this.model.analog.has(j)) this.state.n.delete(j);
    if (dspChanged) { log("DSP settings changed – reconnecting"); this.dsp.reconnect("config changed"); }
    else if (this.dsp.connected) this.readAllState();
  }

  /* ---- DSP → joins ---- */
  readAllState() {
    const M = this.model;
    for (const t of M.digital.values()) { if (t.oid != null) this.dsp.send(tpl(M.sis.muteView, { oid: t.oid })); if (t.group != null) this.dsp.send(tpl(M.sis.groupView, { g: t.group })); }
    for (const t of M.analog.values())  { if (t.oid != null) this.dsp.send(tpl(M.sis.gainView, { oid: t.oid })); if (t.group != null) this.dsp.send(tpl(M.sis.groupView, { g: t.group })); }
  }
  /* DMP responses: DsM20300*0 · DsM40002*1 · DsG40100*1848 (tenths dB + 2048) · GrpmD26*+00000 · Vrb3 · E13 */
  onDspLine(line) {
    const M = this.model; let m;
    if ((m = /^Ds?M(\d{5})\*([+-]?\d+)/.exec(line))) { const j = M.muteOidJoin.get(m[1]); if (j != null) this.setDigital(j, parseInt(m[2], 10) === 0); return; }
    if ((m = /^Ds?G(\d{5})\*([+-]?\d+)/.exec(line))) { const t = M.gainOidJoin.get(m[1]); if (t) this.setAnalog(t.join, M.dbToAnalog((parseInt(m[2], 10) - M.sc.gainOffset) / 10, t.min, t.max)); return; }
    if ((m = /^GrpmD(\d+)\*([+-]?\d+)/.exec(line))) {
      const g = m[1], v = parseInt(m[2], 10);
      if (M.muteGroupJoin.has(g)) { this.setDigital(M.muteGroupJoin.get(g), v === 0); return; }
      const t = M.gainGroupJoin.get(g); if (t) this.setAnalog(t.join, M.dbToAnalog(v / M.sc.groupDbScale, t.min, t.max)); return;
    }
    if (/^Vrb\d/.test(line)) return;
    if (/^E\d\d/.test(line)) { log("DSP error response:", line); return; }
    if (this.dsp.debug) log("DSP (unhandled):", line);
  }
  setDigital(j, v) { if (this.state.b.get(j) !== v) { this.state.b.set(j, v); this.emit("change", { t: "b", j, v }); } }
  setAnalog(j, v)  { if (this.state.n.get(j) !== v) { this.state.n.set(j, v); this.emit("change", { t: "n", j, v }); } }

  /* ---- joins → DSP (actions from panels) ---- */
  onDigital(j, v) {
    const M = this.model, t = M.digital.get(j); if (!t) return;
    const rising = v && !this.pressed.has(j); v ? this.pressed.add(j) : this.pressed.delete(j);
    if (!rising) return;
    const on = this.state.b.get(j);
    switch (t.kind) {
      case "view":  M.viewJoins.forEach(vj => this.setDigital(vj, vj === j)); break;
      case "mute":  t.oid != null ? this.dsp.send(tpl(M.sis.muteSet, { oid: t.oid, v: on ? 1 : 0 }), true) : this.dsp.send(tpl(M.sis.groupSet, { g: t.group, v: on ? 1 : 0 }), true); break;
      case "route":
        // turning on a member of an exclusive group → mute the group's other members in this zone first
        if (!on && t.exclusive) for (const [oj, ot] of M.digital) if (ot.kind === "route" && ot.zone === t.zone && ot.exclusive === t.exclusive && oj !== j && this.state.b.get(oj)) this.dsp.send(tpl(M.sis.muteSet, { oid: ot.oid, v: 1 }), true);
        this.dsp.send(tpl(M.sis.muteSet, { oid: t.oid, v: on ? 1 : 0 }), true);
        break;
    }
  }
  onAnalog(j, v) {
    const M = this.model, t = M.analog.get(j); if (!t) return;
    this.analogPending.set(j, v);
    if (this.analogPending.get(j + "_timer")) return;
    this.analogPending.set(j + "_timer", setTimeout(() => {              // coalesce fast fader moves
      this.analogPending.delete(j + "_timer");
      const val = this.analogPending.get(j), tenths = Math.round(M.analogToDb(val, t.min, t.max) * 10);
      if (t.oid != null) this.dsp.send(tpl(M.sis.gainSet, { oid: t.oid, v: tenths + M.sc.gainOffset }), true, "n" + j);
      else this.dsp.send(tpl(M.sis.groupSet, { g: t.group, v: tenths }), true, "n" + j);
      this.state.n.set(j, val); this.emit("change", { t: "n", j, v: val });
    }, 40));
  }
}

module.exports = { Controller };
