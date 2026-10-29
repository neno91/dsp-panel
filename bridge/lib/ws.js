"use strict";
/* ------------------------------------------------------------------
   WebSocket: the panels' live link to the join state
   ------------------------------------------------------------------
   Protocol (JSON): {"t":"b"|"n","j":<join>,"v":<value>} both ways,
   {"t":"sys","dsp":bool} link state, {"t":"sys","reload":true} config changed.
   ------------------------------------------------------------------ */
const { WebSocketServer, WebSocket } = require("ws");
const { log } = require("./util");

function attachWebSocket(server, { auth, ctrl, dsp, store }) {
  const wss = new WebSocketServer({ server, path: "/ws", verifyClient: info => !auth.requireToken() || !!auth.tokenPanel(info.req) });
  const broadcast = msg => { const s = JSON.stringify(msg); for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(s); };
  wss.on("connection", (ws, req) => {
    const who = auth.tokenPanel(req);
    log("panel connected", req.socket.remoteAddress, who ? `(${who.name})` : "", "| clients:", wss.clients.size);
    ws.send(JSON.stringify({ t: "sys", dsp: dsp.connected }));
    for (const [j, v] of ctrl.state.b) ws.send(JSON.stringify({ t: "b", j, v }));
    for (const [j, v] of ctrl.state.n) ws.send(JSON.stringify({ t: "n", j, v }));
    ws.on("message", data => { let m; try { m = JSON.parse(data); } catch (_) { return; } if (m.t === "b") ctrl.onDigital(Number(m.j), !!m.v); else if (m.t === "n") ctrl.onAnalog(Number(m.j), Number(m.v)); });
    ws.on("close", () => log("panel disconnected | clients:", wss.clients.size));
  });
  ctrl.on("change", broadcast);
  dsp.on("up",   () => broadcast({ t: "sys", dsp: true }));
  dsp.on("down", () => broadcast({ t: "sys", dsp: false }));
  store.on("applied", () => broadcast({ t: "sys", reload: true }));
  return { wss, broadcast, clientCount: () => wss.clients.size };
}

module.exports = { attachWebSocket };
