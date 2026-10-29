"use strict";
/* Bridge behaviour against the emulated DMP: run with  npm test  (node --test). */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const WebSocket = require("ws");
const { startBridge, waitFor, sleep, get, post } = require("./helpers");

const connectWs = (b, token) => new Promise((res, rej) => { const ws = new WebSocket(`${b.url.replace("http", "ws")}/ws${token ? "?token=" + token : ""}`); const st = { b: {}, n: {} }; ws.on("open", () => res({ ws, st })); ws.on("error", rej); ws.on("message", d => { const m = JSON.parse(d); if (m.t === "b") st.b[m.j] = m.v; if (m.t === "n") st.n[m.j] = m.v; }); });
const press = async (ws, j) => { ws.send(JSON.stringify({ t: "b", j, v: true })); await sleep(30); ws.send(JSON.stringify({ t: "b", j, v: false })); await sleep(30); };

test("reads the full state from the DSP at session start", async () => {
  const b = await startBridge();
  try {
    await waitFor(() => b.ctrl.state.n.size >= 14, 4000, "analog state");   // 10 inputs + 4 zones
    assert.equal(b.ctrl.state.b.get(31), true);     // zone 1 unmuted (emulator: 60000 mute = 0)
    assert.equal(b.ctrl.state.b.get(32), false);    // zone 2 muted
    assert.ok(b.ctrl.state.n.get(31) > 0);
  } finally { await b.stop(); }
});

test("tokens: panel, files and websocket need a screen token; admin needs the password", async () => {
  const b = await startBridge();
  try {
    assert.equal((await get(b.url + "/")).status, 401);
    assert.equal((await get(b.url + "/js/app.js")).status, 401);
    assert.equal((await get(b.url + "/?token=" + b.token)).status, 200);
    const r = await get(b.url + "/?token=" + b.token); assert.match(r.headers.get("set-cookie") || "", /lp_token=/);
    assert.equal((await get(b.url + "/", { cookie: "lp_token=" + b.token })).status, 200);
    assert.equal((await get(b.url + "/admin")).status, 401);
    assert.equal((await get(b.url + "/admin", b.admin)).status, 200);
    assert.equal((await get(b.url + "/admin/admin.js", b.admin)).status, 200);
    await assert.rejects(connectWs(b, null));
    await assert.rejects(connectWs(b, "bad"));
    const { ws } = await connectWs(b, b.token); ws.close();
    const health = JSON.parse((await get(b.url + "/api/health")).text); assert.deepEqual(Object.keys(health), ["ok", "dsp"]);
  } finally { await b.stop(); }
});

test("route toggle and exclusive source group (only one of Music 1–3 per zone)", async () => {
  const b = await startBridge();
  try {
    await waitFor(() => b.ctrl.state.b.size > 40, 4000, "state");
    const { ws, st } = await connectWs(b, b.token); await sleep(100);
    const zone1 = 100, music1 = zone1 + 4, music2 = zone1 + 5, radio = zone1 + 7;   // route joins: base 100 + input − 1
    for (const j of [music1, music2, radio]) if (st.b[j]) { await press(ws, j); await waitFor(() => st.b[j] === false, 2000, "clear " + j); }   // known start: all off
    await press(ws, music1); await waitFor(() => st.b[music1] === true, 2000, "music1 on");
    await press(ws, radio);  await waitFor(() => st.b[radio] === true, 2000, "radio on");
    await press(ws, music2); await waitFor(() => st.b[music2] === true && st.b[music1] === false, 2000, "music2 on, music1 off");
    assert.equal(st.b[radio], true, "radio is not in the exclusive group and stays on");
    await press(ws, music2); await waitFor(() => st.b[music2] === false, 2000, "music2 off");
    assert.equal(b.dmp.state.mix.get("0500"), 1, "mixpoint input 5 → output 1 is muted in the DSP");
    ws.close();
  } finally { await b.stop(); }
});

test("analog: coalesced, deduplicated, scaled to tenths of dB with the 2048 offset", async () => {
  const b = await startBridge();
  try {
    await waitFor(() => b.ctrl.state.n.size >= 14, 4000, "state");
    const { ws, st } = await connectWs(b, b.token); await sleep(100);
    for (let i = 0; i <= 20; i++) ws.send(JSON.stringify({ t: "n", j: 31, v: Math.round(65535 * i / 20) }));   // a fast drag to 100 %
    await waitFor(() => st.n[31] === 65535, 2000, "fader at max");
    await sleep(300);
    // zone range −100…−6 dB → 100 % = −6 dB = 1988 after the offset
    assert.equal(b.dmp.state.gain.get("60000"), 2048 - 60);
    ws.close();
  } finally { await b.stop(); }
});

test("DspLink pacing: reads are spaced by minGapMs, urgent commands go first and in bursts", async () => {
  const b = await startBridge({ site: { dsp: { minGapMs: 50, burst: 3 } } });
  try {
    await waitFor(() => b.ctrl.state.n.size >= 14, 6000, "state");
    const sent = []; const orig = b.dsp.sock.write.bind(b.dsp.sock); b.dsp.sock.write = c => { sent.push({ t: Date.now(), c }); return orig(c); };
    b.dsp.send("G60000AU"); b.dsp.send("G60001AU"); b.dsp.send("G60002AU");        // three paced reads
    b.dsp.send("G60003*1900AU", true, "a"); b.dsp.send("G60004*1900AU", true, "b"); b.dsp.send("G60004*1950AU", true, "b");   // urgent, last two share a key
    await sleep(600);
    const cmds = sent.map(s => s.c.replace(/\x1b|\r/g, ""));
    assert.ok(cmds.indexOf("G60003*1900AU") < cmds.indexOf("G60001AU"), "urgent before queued reads");
    assert.ok(!cmds.includes("G60004*1900AU") && cmds.includes("G60004*1950AU"), "newer value replaced the queued one");
    const reads = sent.filter(s => /AU\r$/.test(s.c) && !s.c.includes("*"));
    for (let i = 1; i < reads.length; i++) assert.ok(reads[i].t - reads[i - 1].t >= 45, `gap between reads ${reads[i].t - reads[i - 1].t} ms`);
  } finally { await b.stop(); }
});

test("admin: save validates, applies and reloads panels; per-screen config; backup/restore", async () => {
  const b = await startBridge();
  try {
    const { ws } = await connectWs(b, b.token); let reload = false; ws.on("message", d => { const m = JSON.parse(d); if (m.t === "sys" && m.reload) reload = true; });
    const cfg = JSON.parse((await get(b.url + "/api/admin/config", b.admin)).text);
    assert.equal(cfg.site.admin.password, "••••••", "secrets are masked");
    cfg.site.panels[2].zones = ["zone1", "zone2"]; cfg.site.panels[2].scale = 1.3;
    const bad = JSON.parse(JSON.stringify(cfg.site)); bad.sources[0].input = 2;              // duplicate input
    assert.equal((await post(b.url + "/api/admin/config", { site: bad }, b.admin)).status, 400);
    assert.equal((await post(b.url + "/api/admin/config", { site: cfg.site }, b.admin)).status, 200);
    await waitFor(() => reload, 2000, "reload broadcast");
    assert.equal(b.store.site.admin.password, "test", "masked password kept");
    const tok = b.store.site.panels[2].token;
    const js = (await get(b.url + "/js/config.js?token=" + tok)).text; const conf = JSON.parse(js.slice(js.indexOf("=") + 1).trim().replace(/;$/, ""));
    assert.deepEqual(conf.zones.map(z => z.id), ["zone1", "zone2"]); assert.equal(conf.ui.scale, 1.3); assert.equal(conf.transport.mode, "auto");
    const exp = (await get(b.url + "/api/export/config.js?panel=ts770", b.admin)).text; assert.match(exp, /"mode": "bridge"/); assert.match(exp, new RegExp("token=" + tok));
    const backup = (await get(b.url + "/api/admin/export/site.json", b.admin)).text;
    assert.equal((await post(b.url + "/api/admin/import", { sources: [] }, b.admin)).status, 400);
    assert.equal((await post(b.url + "/api/admin/import", backup, b.admin)).status, 200);
    ws.close();
  } finally { await b.stop(); }
});

test("DSP password prompt is answered and the session still comes up", async () => {
  const b = await startBridge({ dmpPassword: "secret" });
  try { assert.equal(b.dsp.connected, true); await waitFor(() => b.ctrl.state.n.size >= 14, 4000, "state"); } finally { await b.stop(); }
});
