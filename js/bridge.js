/* ------------------------------------------------------------------
   Transport
   ------------------------------------------------------------------
   The UI talks "joins" (numbered digital/analog signals) to the DSP
   bridge over a WebSocket. Opened as a plain file, without a bridge,
   it runs a local simulator instead so the whole UI can be exercised.

   API
     Bridge.live                       true when connected to a bridge
     Bridge.subscribe(type, join, cb)  type: 'b' | 'n' | 's'
     Bridge.publish(type, join, value)
     Bridge.press(join)                digital high
     Bridge.release(join)              digital low
     Bridge.tap(join)                  press + release (~80 ms)
     Bridge.onConnection(cb)           cb(true|false)
   ------------------------------------------------------------------ */

window.Bridge = (function () {
  "use strict";

  const CFG = (window.PANEL_CONFIG && window.PANEL_CONFIG.transport) || {};
  const mode = CFG.mode || "auto";
  // "bridge": WebSocket to the DSP bridge (url, or the host that served the page) · "sim": simulator ·
  // "auto": bridge when the page was served by the bridge (it injects window.DSP_BRIDGE) or a url is configured, else simulation
  const useWs = mode === "bridge" || (mode === "auto" && (window.DSP_BRIDGE === true || !!CFG.url));

  /* ---------- WebSocket transport (DSP bridge) ---------- */
  const Ws = (function () {
    const subs = { b: {}, n: {}, s: {} }, state = { b: {}, n: {}, s: {} };
    let sock = null, connCb = null, dspUp = false, open = false;
    const url = CFG.url || ((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
    function emit(type, join, value) {
      state[type][join] = value;
      (subs[type][join] || []).forEach(cb => { try { cb(value); } catch (e) { console.error(e); } });
    }
    function connect() {
      try { sock = new WebSocket(url); } catch (e) { console.error("[Bridge] bad WebSocket url", url, e); return; }
      sock.onopen  = () => { open = true; console.info("[Bridge] connected to", url); };
      sock.onclose = () => { open = false; dspUp = false; if (connCb) connCb(false); setTimeout(connect, 2000); };
      sock.onerror = () => {};
      sock.onmessage = ev => {
        let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
        if (m.t === "sys") {
          if (m.reload) { console.info("[Bridge] configuration changed – reloading"); setTimeout(() => location.reload(), 300); return; }
          dspUp = !!m.dsp; if (connCb) connCb(dspUp); return;
        }
        if (m.t === "b" || m.t === "n" || m.t === "s") emit(m.t, String(m.j), m.v);
      };
    }
    function subscribe(type, join, cb) {
      join = String(join);
      (subs[type][join] = subs[type][join] || []).push(cb);
      if (join in state[type]) cb(state[type][join]);
    }
    function publish(type, join, value) {
      if (open) sock.send(JSON.stringify({ t: type, j: Number(join), v: value }));
    }
    function onConnection(cb) { connCb = cb; cb(open && dspUp); }
    if (useWs) connect();
    return { subscribe, publish, onConnection };
  })();

  /* ---------- Simulator ---------- */
  const Sim = (function () {
    const state = { b: {}, n: {}, s: {} };
    const subs  = { b: {}, n: {}, s: {} };
    const rules = { toggle: new Set(), interlock: [], exclusive: [], echoAnalog: true };

    function set(type, join, value) {
      join = String(join);
      if (state[type][join] === value) return;
      state[type][join] = value;
      (subs[type][join] || []).forEach(cb => { try { cb(value); } catch (e) { console.error(e); } });
    }

    function subscribe(type, join, cb) {
      join = String(join);
      (subs[type][join] = subs[type][join] || []).push(cb);
      if (join in state[type]) cb(state[type][join]);
      return { type, join, cb };
    }

    /* Emulates what the bridge/DSP would do on an incoming signal. */
    function publish(type, join, value) {
      join = String(join);
      if (type === "n" || type === "s") {
        if (rules.echoAnalog) set(type, join, value);
        return;
      }
      // digital: act on the rising edge
      if (value !== true) return;
      const group = rules.interlock.find(g => g.includes(join));
      if (group) {                       // radio-style: exactly one on
        group.forEach(j => set("b", j, j === join));
        return;
      }
      const excl = rules.exclusive.find(g => g.includes(join));
      if (excl) {                        // toggle, but switching one on turns the others off
        const next = !state.b[join];
        excl.forEach(j => set("b", j, j === join ? next : false));
        return;
      }
      if (rules.toggle.has(join)) set("b", join, !state.b[join]);
    }

    return { set, subscribe, publish, rules, state };
  })();

  /* ---------- Public surface ---------- */
  function subscribe(type, join, cb) { return useWs ? Ws.subscribe(type, join, cb) : Sim.subscribe(type, join, cb); }
  function publish(type, join, value) { useWs ? Ws.publish(type, join, value) : Sim.publish(type, join, value); }

  const press   = join => publish("b", join, true);
  const release = join => publish("b", join, false);
  const tap     = join => { press(join); setTimeout(() => release(join), 80); };

  function onConnection(cb) { if (useWs) Ws.onConnection(cb); else cb(true); }

  // transport name for the status badge: "bridge" | "sim"
  const transport = useWs ? "bridge" : "sim";
  return { live: useWs, transport, subscribe, publish, press, release, tap, onConnection, Sim };
})();
