"use strict";
/* Test helpers: boot the bridge in-process against the emulated DMP, on random ports,
   with a temporary copy of site.default.json. */
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const { createBridge } = require("../lib/bridge");
const fakeDmp = require("../tools/fake-dmp");

const ROOT = path.resolve(__dirname, "..", "..");
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* start({ site: patch }) → { url, token, store, ctrl, dsp, dmp, tmp, stop() } */
async function startBridge({ site: patch = {}, dmpPassword = "" } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsp-panel-test-"));
  const site = JSON.parse(fs.readFileSync(path.join(ROOT, "bridge", "site.default.json"), "utf8"));
  const dmpPort = await freePort();
  Object.assign(site.dsp, { host: "127.0.0.1", port: dmpPort, password: dmpPassword, minGapMs: 10, replyTimeoutMs: 200, keepAliveMs: 0, silenceTimeoutMs: 0 });
  site.admin.password = "test";
  deepMerge(site, patch);
  const sitePath = path.join(tmp, "site.json");
  fs.writeFileSync(sitePath, JSON.stringify(site, null, 2));
  const dmp = fakeDmp.start(dmpPort, dmpPassword, { drift: false });
  const bridge = createBridge({ sitePath, rootDir: ROOT, dataDir: path.join(tmp, "data"), buildDir: path.join(tmp, "build"), env: {}, port: 0, host: "127.0.0.1", debug: false,
    defaultPath: path.join(ROOT, "bridge", "site.default.json") });
  const port = await bridge.listen();
  await waitFor(() => bridge.dsp.connected, 5000, "DSP session");
  await sleep(50);
  return Object.assign(bridge, {
    url: `http://127.0.0.1:${port}`, token: bridge.store.site.panels[0].token, dmp, tmp,
    admin: { Authorization: "Basic " + Buffer.from("admin:test").toString("base64") },
    stop: async () => { await bridge.close(); dmp.close(); fs.rmSync(tmp, { recursive: true, force: true }); },
  });
}
function deepMerge(a, b) { for (const [k, v] of Object.entries(b)) { if (v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object") deepMerge(a[k], v); else a[k] = v; } return a; }
async function waitFor(fn, ms = 3000, what = "condition") { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error("timeout waiting for " + what); await sleep(20); } }
const get = async (url, headers = {}) => { const r = await fetch(url, { headers }); return { status: r.status, text: await r.text(), headers: r.headers }; };
const post = async (url, body, headers = {}) => { const r = await fetch(url, { method: "POST", headers: Object.assign({ "content-type": "application/json" }, headers), body: typeof body === "string" ? body : JSON.stringify(body) }); return { status: r.status, text: await r.text() }; };

module.exports = { startBridge, waitFor, sleep, get, post, ROOT };
