#!/usr/bin/env node
/* ------------------------------------------------------------------
   DSP Panel – bridge
   ------------------------------------------------------------------
   Talks SIS (telnet) to the Extron DMP 128 and exposes the panel's
   join model (numbered digital/analog signals) over a WebSocket.
   Serves the panel, generates its js/config.js from site.json, hosts
   /admin for configuration and publishes the panel to touch screens.

   The DSP is the single source of truth: every lit state and fader
   position comes from DMP responses (verbose mode 3 makes the DMP
   report every change, whoever made it).

   site.json (edited via /admin) holds sources, zones, groups, DSP
   connection and control mode. Joins/OIDs are derived:
     source with input n  →  mixer joins D/A(20+n), route join base+n−1,
                             OIDs 401(n−1) level, 400(n−1) mute
     zone with output o   →  joins D/A(30+o), route base 100+(o−1)*10,
                             OID 600(o−1)
   Control mode "groups" uses DMP groups instead (advanced.groupsFallback).
   site.panels lists the screens (Crestron touch panels and browser/mobile
   entries): IP + login for deploy, which zones/views each shows, and an
   access token (GUID). With security.requireToken (default) every panel
   request and the WebSocket need a screen's token – ?token=<guid> in the
   URL (then kept in a cookie) or baked into the .ch5z the bridge builds.
   /api/admin/publish builds a .ch5z per screen with Crestron's ch5-cli and
   deploys it. /admin itself is protected by admin.password (HTTP Basic).

   WebSocket protocol (JSON): {"t":"b"|"n","j":<join>,"v":<value>} both ways,
   {"t":"sys","dsp":bool} link state, {"t":"sys","reload":true} config changed.

   Usage:  node server.js [site.json]
   Env:    DSP_HOST, DSP_PORT, DSP_PASSWORD, PORT override; DSP_DEBUG=1 logs traffic;
           BUILD_DIR where .ch5z builds are staged (default bridge/.build).
   ------------------------------------------------------------------ */
"use strict";
const net  = require("net");
const http = require("http");
const fs   = require("fs");
const path = require("path");
const os   = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { WebSocketServer, WebSocket } = require("ws");

const SITE_PATH = process.argv[2] || path.join(__dirname, "site.json");
const ROOT = path.resolve(__dirname, "..");
const ESC = "\x1B", CR = "\r";
const log = (...a) => console.log(new Date().toISOString(), ...a);
const pad2 = n => String(n).padStart(2, "0");
const tpl = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k]);

/* =================== configuration =================== */
let SITE = loadSite();
function loadSite() {
  if (!fs.existsSync(SITE_PATH)) {                                  // first start: begin from the shipped defaults
    const def = path.join(__dirname, "site.default.json");
    if (!fs.existsSync(def)) { console.error(`no ${SITE_PATH} and no ${def} – nothing to start from`); process.exit(1); }
    fs.copyFileSync(def, SITE_PATH);
    log(`${SITE_PATH} missing – created from site.default.json; set the DSP address in /admin`);
  }
  return JSON.parse(fs.readFileSync(SITE_PATH, "utf8"));
}
// effective DSP connection: environment overrides win at connect time but are never written to site.json
const dspConn = () => ({
  host: process.env.DSP_HOST || SITE.dsp.host,
  port: Number(process.env.DSP_PORT || SITE.dsp.port || 23),
  password: process.env.DSP_PASSWORD !== undefined ? process.env.DSP_PASSWORD : (SITE.dsp.password || ""),
});
const LISTEN_PORT = Number(process.env.PORT || (SITE.listen && SITE.listen.port) || 3000);
const LISTEN_HOST = (SITE.listen && SITE.listen.host) || "0.0.0.0";

/* Validate an incoming site document (from /admin). Returns a list of problems. */
function validateSite(s) {
  const p = [];
  const isId = v => typeof v === "string" && /^[a-z0-9_-]{1,32}$/i.test(v);
  if (!s || typeof s !== "object") return ["not an object"];
  if (!s.dsp || !s.dsp.host) p.push("DSP host missing");
  if (!Array.isArray(s.sources) || !s.sources.length) p.push("no sources");
  if (!Array.isArray(s.zones)   || !s.zones.length)   p.push("no zones");
  const ids = new Set(), inputs = new Set(), outputs = new Set();
  (s.sources || []).forEach((x, i) => {
    if (!isId(x.id)) p.push(`source ${i + 1}: invalid id`);
    if (ids.has(x.id)) p.push(`duplicate id ${x.id}`); ids.add(x.id);
    if (!(x.input >= 1 && x.input <= 99)) p.push(`${x.name || x.id}: input must be 1–99`);
    if (inputs.has(x.input)) p.push(`input ${x.input} used twice`); inputs.add(x.input);
    if (!x.name) p.push(`source ${x.id}: name missing`);
  });
  (s.zones || []).forEach((z, i) => {
    if (!isId(z.id)) p.push(`zone ${i + 1}: invalid id`);
    if (ids.has(z.id)) p.push(`duplicate id ${z.id}`); ids.add(z.id);
    if (!(z.output >= 1 && z.output <= 99)) p.push(`${z.name || z.id}: output must be 1–99`);
    if (outputs.has(z.output)) p.push(`output ${z.output} used twice`); outputs.add(z.output);
    if (!z.name) p.push(`zone ${z.id}: name missing`);
  });
  (s.groups || []).forEach(g => {
    if (!isId(g.id)) p.push(`group ${g.name || "?"}: invalid id`);
    if (g.zones !== "*" && !Array.isArray(g.zones)) p.push(`group ${g.id}: zones must be a list or "*"`);
  });
  const srcIds = new Set((s.sources || []).map(x => x.id));
  (s.sourceGroups || []).forEach(g => {
    if (!isId(g.id)) p.push(`source group ${g.name || "?"}: invalid id`);
    if (!g.name) p.push(`source group ${g.id}: name missing`);
    if (g.mode != null && !["toggle", "exclusive"].includes(g.mode)) p.push(`source group ${g.name || g.id}: mode must be toggle or exclusive`);
    if (!Array.isArray(g.sources) || g.sources.length < 2) p.push(`source group ${g.name || g.id}: pick at least two sources`);
    else g.sources.filter(id => !srcIds.has(id)).forEach(id => p.push(`source group ${g.name || g.id}: unknown source ${id}`));
  });
  const lv = s.levels || {};
  for (const k of ["input", "zone"]) if (!lv[k] || !(lv[k].min < lv[k].max)) p.push(`levels.${k}: min must be below max`);
  const zoneIds = new Set((s.zones || []).map(z => z.id)), pids = new Set();
  (s.panels || []).forEach((pn, i) => {
    const nm = pn.name || pn.id || `screen ${i + 1}`;
    if (!isId(pn.id)) p.push(`screen ${nm}: invalid id`);
    if (pids.has(pn.id)) p.push(`duplicate screen id ${pn.id}`); pids.add(pn.id);
    if (!pn.name) p.push(`screen ${pn.id}: name missing`);
    if (pn.host && !/^[\w.:-]+$/.test(pn.host)) p.push(`screen ${nm}: invalid IP address`);
    if (pn.zones !== "*" && !Array.isArray(pn.zones)) p.push(`screen ${nm}: zones must be a list or "*"`);
    if (Array.isArray(pn.zones)) { if (!pn.zones.length) p.push(`screen ${nm}: no zones selected`); pn.zones.filter(z => !zoneIds.has(z)).forEach(z => p.push(`screen ${nm}: unknown zone ${z}`)); }
    if (pn.scale != null && !(Number(pn.scale) >= 1 && Number(pn.scale) <= 2.5)) p.push(`screen ${nm}: scale must be between 1 and 2.5`);
    if (pn.lang && !LANGS.includes(pn.lang)) p.push(`screen ${nm}: language must be ${LANGS.join("/")}`);
    if (pn.views != null && (!Array.isArray(pn.views) || !pn.views.length || pn.views.some(v => !VIEWS.some(x => x.id === v)))) p.push(`screen ${nm}: views must be a non-empty list of ${VIEWS.map(v => v.id).join("/")}`);
  });
  if (s.publicUrl && !/^https?:\/\/[\w.:-]+(\/.*)?$/.test(s.publicUrl)) p.push("bridge address must look like http://<ip>:3000");
  if (s.ui && s.ui.lang && !LANGS.includes(s.ui.lang)) p.push(`language must be ${LANGS.join("/")}`);
  const th = s.theme || {};
  const hex = v => /^#[0-9a-f]{6}$/i.test(v);
  Object.entries(th.colors || {}).forEach(([k, v]) => { if (!hex(v)) p.push(`theme colour ${k}: use #rrggbb`); });
  if (th.logoHeight != null && !(th.logoHeight >= 24 && th.logoHeight <= 140)) p.push("theme: logo height must be 24–140 px");
  if (th.veil != null && !(th.veil >= 0 && th.veil <= 1.5)) p.push("theme: background darkening must be 0–1.5");
  for (const k of ["logo", "background"]) if (th[k] && th[k] !== "none" && !/^custom\/[\w.-]+$/.test(th[k])) p.push(`theme ${k}: invalid path`);
  const sec = Object.assign({ requireToken: true }, s.security || {});
  if (sec.requireToken && !((s.admin || {}).password)) p.push("set an admin password when tokens are required – otherwise anyone can read the tokens on /admin");
  if (sec.requireToken && !(s.panels || []).length) p.push("tokens are required but no screens are registered – nobody could open the panel");
  const toks = new Set();
  (s.panels || []).forEach(pn => { if (pn.token != null && (typeof pn.token !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(pn.token))) p.push(`screen ${pn.name || pn.id}: token must be 16–128 letters/digits`); if (pn.token) { if (toks.has(pn.token)) p.push(`screen ${pn.name || pn.id}: token used twice`); toks.add(pn.token); } });
  return p;
}

/* =================== access control =================== */
/* Every screen (site.panels entry) has a token – a GUID. Browsers open /?token=<guid>
   once (the bridge then keeps it in a cookie); the .ch5z built for a touch panel
   carries it in its WebSocket URL. Without a valid token the panel, its files,
   /api/state and /ws answer 401. /admin and /api/admin/* use admin.password instead. */
const SEC = () => Object.assign({ requireToken: true }, SITE.security || {});
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const newToken = () => crypto.randomUUID();
/* give every screen a token; seed a browser entry if there are no screens at all (first start after upgrade) */
function ensureTokens(s) {
  let changed = false;
  if (!Array.isArray(s.panels) || !s.panels.length) { s.panels = [{ id: "web", name: "Nettleser / mobil", host: "", user: "admin", password: "", zones: "*" }]; changed = true; }
  for (const p of s.panels) if (!p.token) { p.token = newToken(); changed = true; }
  return changed;
}
function requestToken(req) {
  const t = new URLSearchParams(req.url.split("?")[1] || "").get("token");
  if (t) return { token: t, fromUrl: true };
  const m = /(?:^|;\s*)lp_token=([^;]+)/.exec(req.headers.cookie || "");
  return m ? { token: decodeURIComponent(m[1]), fromUrl: false } : null;
}
/* the screen whose token the request carries (null if none/invalid) */
function tokenPanel(req) {
  const t = requestToken(req); if (!t) return null;
  return (SITE.panels || []).find(p => p.token && safeEq(p.token, t.token)) || null;
}
function panelAuthorized(req, res) {
  if (!SEC().requireToken) return true;
  const p = tokenPanel(req);
  if (p) { const t = requestToken(req); if (t.fromUrl) res.setHeader("set-cookie", `lp_token=${encodeURIComponent(t.token)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`); return p; }
  res.statusCode = 401;
  if (/^\/(api|js|css|assets)\//.test(req.url) || /\.(js|css|png|jpg)$/.test(req.url.split("?")[0])) { res.setHeader("content-type", "text/plain"); res.end("token required"); return null; }
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ingen tilgang</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#062330;color:#eef6f9;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:24px"><div><h1 style="font-size:22px;margin:0 0 8px">${(SITE.ui || {}).lang === "nb" ? "Panelet er beskyttet" : "This panel is protected"}</h1><p style="color:#a9c3cf;max-width:34em;margin:0">${(SITE.ui || {}).lang === "nb" ? "Åpne panelet via lenken med tilgangsnøkkel fra <code>/admin → Skjermer → Kopier lenke</code>. Lenken huskes i denne nettleseren etterpå." : "Open the panel through the link with an access key from <code>/admin → Screens → Copy link</code>. The key is remembered in this browser afterwards."}</p></div>`);
  return null;
}

const VIEWS = [{ id: "zones", label: "Soner", icon: "home", join: 7 }, { id: "mixer", label: "Mikser", icon: "speaker", join: 8 }];
const LANGS = ["nb", "en"];                       // panel languages (texts live in js/i18n.js)
/* appearance: logo/background live in bridge/data (uploaded via /admin, served at /custom/…),
   colours override the CSS variables; "" = the panel's built-in default, background "none" = plain colour */
const DATA_DIR = path.join(__dirname, "data");
const DEFAULT_THEME = { logo: "", logoHeight: 58, background: "", veil: 1, colors: {
  bg0: "#041721", bg1: "#062330", bg2: "#0b3142", bg3: "#124256", bg4: "#1a556c",
  accent: "#2689a8", accentHi: "#4fb6d4", active: "#f2b24a", activeHi: "#ffd27a",
  text: "#eef6f9", textDim: "#a9c3cf", textFaint: "#6f8f9d", ok: "#58d48f", down: "#ef6b5b" } };
const customFile = rel => (rel && rel !== "none" && /^custom\/[\w.-]+$/.test(rel)) ? path.join(DATA_DIR, rel.slice(7)) : null;

/* Address the touch panels use to reach this bridge: site.publicUrl, else the first LAN IPv4. */
function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) for (const a of list) if (a.family === "IPv4" && !a.internal) return a.address;
  return "127.0.0.1";
}
const publicUrl = () => ((SITE.publicUrl || "").trim() || `http://${lanAddress()}:${LISTEN_PORT}`).replace(/\/+$/, "");
const panelById = id => (SITE.panels || []).find(p => p.id === id);

/* Derived join conventions, shared by bridge and panel. */
const srcJoin   = src => 20 + src.input;                 // mixer mute (D) and level (A)
const srcOffset = src => src.input - 1;                  // offset inside a zone's route block
const zoneJoin  = z   => 30 + z.output;                  // zone mute (D) and level (A)
const routeBase = z   => 100 + (z.output - 1) * 10;      // first route join of the zone

/* The panel's config.js, generated from site.json (served at /js/config.js).
   With a screen (site.panels entry) the config is cut down to that screen's zones
   and views, and transport is pinned to this bridge's WebSocket – that is what gets
   built into the .ch5z for the TSW/TS panels, and what /?panel=<id> serves a browser. */
function panelConfigJs(s, panel, pinTransport) {
  const zoneOk = z => !panel || panel.zones === "*" || !Array.isArray(panel.zones) || panel.zones.includes(z.id);
  const zones = s.zones.filter(zoneOk);
  const zoneIds = new Set(zones.map(z => z.id));
  const views = panel && Array.isArray(panel.views) && panel.views.length ? VIEWS.filter(v => panel.views.includes(v.id)) : VIEWS;
  const groups = (s.groups || [])
    .map(g => g.zones === "*" ? g : Object.assign({}, g, { zones: g.zones.filter(id => zoneIds.has(id)) }))
    .filter(g => g.zones === "*" || g.zones.length > 1);                 // a group of one zone is just the zone
  const cfg = {
    site: s.site,
    panel: panel ? { id: panel.id, name: panel.name } : undefined,
    views,
    sources: s.sources.map(x => ({ id: x.id, input: x.input, name: x.name, icon: x.icon || "music", group: x.group || undefined, hint: x.hint || undefined, joinOffset: srcOffset(x) })),
    levels: s.levels,
    zones: zones.map(z => ({ id: z.id, name: z.name, icon: z.icon || "speaker", select: zoneJoin(z), volume: zoneJoin(z), sourceJoinBase: routeBase(z), hint: z.hint || undefined })),
    groups,
    sourceGroups: s.sourceGroups || [],
    theme: Object.assign({}, DEFAULT_THEME, s.theme || {}, { colors: Object.assign({}, DEFAULT_THEME.colors, (s.theme || {}).colors || {}) }),
    mixer: s.sources.map(x => ({ source: x.id, button: srcJoin(x), level: srcJoin(x) })),
    transport: pinTransport ? { mode: "bridge", url: publicUrl().replace(/^http/, "ws") + "/ws" + (SEC().requireToken && panel && panel.token ? "?token=" + encodeURIComponent(panel.token) : "") } : { mode: "auto", url: "" },   // pinned only in the .ch5z; a browser connects to whoever served it
    ui: Object.assign({ volumeStepPercent: 5, clock24h: true, lang: "en" }, s.ui || {}, { analogMax: (s.advanced && s.advanced.scaling && s.advanced.scaling.analogMax) || 65535 }, panel && panel.scale ? { scale: Number(panel.scale) } : {}, panel && panel.lang ? { lang: panel.lang } : {}),
  };
  return `/* Generated by the DSP bridge from bridge/site.json – edit via /admin, do not edit by hand. ${new Date().toISOString()}${panel ? ` – screen "${panel.name}"` : ""} */\nwindow.PANEL_CONFIG = ${JSON.stringify(cfg, null, 2)};\n`;
}

/* =================== build & publish to Crestron touch panels =================== */
/* Builds a .ch5z per screen (the panel files + that screen's config.js) with Crestron's
   ch5-cli and pushes it to the panel with  ch5-cli deploy  (SFTP, the panel's admin login).
   One job at a time; progress is kept in PUBLISH for /api/admin/publish/status. */
const BUILD_ROOT = process.env.BUILD_DIR || path.join(__dirname, ".build");   // on disk, not /tmp (often a small tmpfs on a Pi)
const PROJECT = "dsp-panel";
const PUBLISH = { running: false, startedAt: null, finishedAt: null, log: [], results: [] };
const plog = line => { PUBLISH.log.push(line); if (PUBLISH.log.length > 400) PUBLISH.log.shift(); log("publish:", line); };

function ch5cli() {
  const local = path.join(__dirname, "node_modules", ".bin", process.platform === "win32" ? "ch5-cli.cmd" : "ch5-cli");
  return fs.existsSync(local) ? { cmd: local, pre: [] } : { cmd: process.platform === "win32" ? "npx.cmd" : "npx", pre: ["--yes", "@crestron/ch5-utilities-cli"] };
}
function run(args, opts) {
  const { cmd, pre } = ch5cli();
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [...pre, ...args], { cwd: opts.cwd, env: Object.assign({}, process.env, opts.env || {}), stdio: ["pipe", "pipe", "pipe"] });
    const t = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`timed out after ${opts.timeoutMs / 1000} s`)); }, opts.timeoutMs || 300000);
    let tail = "";
    const onData = d => {
      const s = d.toString("utf8"); tail = (tail + s).slice(-2000);
      s.split(/\r?\n/).map(x => x.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trim()).filter(Boolean).forEach(x => plog("  " + x));
      // answer credential prompts if the CLI asks anyway (answers: { user, password })
      if (opts.answers) { if (/sftp user/i.test(s)) child.stdin.write(opts.answers.user + "\n"); else if (/password/i.test(s)) child.stdin.write(opts.answers.password + "\n"); }
    };
    child.stdout.on("data", onData); child.stderr.on("data", onData);
    child.on("error", e => { clearTimeout(t); reject(new Error(e.code === "ENOENT" ? `${cmd} not found – install Node/npm on the bridge host` : e.message)); });
    child.on("close", (code, signal) => { clearTimeout(t); code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited with ${code != null ? code : signal}: ${tail.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trim().split("\n").slice(-3).join(" | ")}`)); });
  });
}
/* Stage the panel files for one screen and archive them → returns the .ch5z path. */
async function buildArchive(panel) {
  // <build>/<id>/src = the panel files, <build>/<id>/dist = the archive. Kept apart: ch5-cli copies the
  // source dir into <out>/temp first, so an output dir inside the source recurses until the disk is full.
  const dir = path.join(BUILD_ROOT, panel.id), src = path.join(dir, "src");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(src, { recursive: true });
  const skip = new Set(["bridge", "node_modules", "dist", ".git", "LICENSE", "README.md", "cr-com-lib.js", "webxpanel.js"]);   // only the panel files
  const wanted = src => !(path.basename(src).startsWith(".") || /\.(smw|bundle|c3p|md)$/i.test(src));
  // entry by entry (not cpSync(ROOT, …)): the build dir lives inside ROOT/bridge and cpSync refuses a dest inside its src
  for (const e of fs.readdirSync(ROOT)) if (!skip.has(e) && wanted(e)) fs.cpSync(path.join(ROOT, e), path.join(src, e), { recursive: true, filter: wanted });
  fs.writeFileSync(path.join(src, "js", "config.js"), panelConfigJs(SITE, panel, true));
  for (const k of ["logo", "background"]) { const f = customFile((SITE.theme || {})[k]); if (f && fs.existsSync(f)) { fs.mkdirSync(path.join(src, "custom"), { recursive: true }); fs.copyFileSync(f, path.join(src, "custom", path.basename(f))); } }
  plog(`${panel.name}: building archive (zones: ${panel.zones === "*" ? "all" : panel.zones.join(", ")}; bridge ${publicUrl()})`);
  await run(["archive", "-p", PROJECT, "-d", "src", "-o", "dist"], { cwd: dir, timeoutMs: 180000 });
  const out = path.join(dir, "dist", PROJECT + ".ch5z");
  if (!fs.existsSync(out)) throw new Error("archive produced no " + PROJECT + ".ch5z");
  return out;
}
async function publishPanels(ids) {
  if (PUBLISH.running) throw new Error("a publish job is already running");
  const list = (SITE.panels || []).filter(p => (!ids || ids.includes(p.id)));
  if (!list.length) throw new Error("no screens selected");
  Object.assign(PUBLISH, { running: true, startedAt: Date.now(), finishedAt: null, log: [], results: [] });
  (async () => {
    for (const p of list) {
      const r = { id: p.id, name: p.name, host: p.host, ok: false, error: "" };
      try {
        if (!p.host) throw new Error("no IP address set");
        const file = await buildArchive(p);
        plog(`${p.name}: deploying to ${p.host} as ${p.user || "admin"} …`);
        // NB: in "deploy" -p means "prompt for credentials" (not project name) – never pass it here
        await run(["deploy", "-H", p.host, "-t", "touchscreen", file],
          { cwd: path.dirname(file), timeoutMs: 420000, env: { CH5CLI_DEPLOY_USER: p.user || "admin", CH5CLI_DEPLOY_PW: p.password || "" }, answers: { user: p.user || "admin", password: p.password || "" } });
        r.ok = true; plog(`${p.name}: ✓ published to ${p.host}`);
      } catch (e) { r.error = e.message; plog(`${p.name}: ✗ ${e.message}`); }
      PUBLISH.results.push(r);
    }
    PUBLISH.running = false; PUBLISH.finishedAt = Date.now();
    plog(`done: ${PUBLISH.results.filter(r => r.ok).length}/${PUBLISH.results.length} screens published`);
  })();
}

/* =================== join model (rebuilt on every config change) =================== */
let M = null;     // model: targets and lookups
function buildModel(s) {
  const ctrl = Object.assign({ mode: "direct", inputLevelBlock: "401", inputMuteBlock: "400", zoneBlock: "600" }, s.control || {});
  const direct = ctrl.mode === "direct";
  const gf = Object.assign({ inputGainBase: 0, inputMuteBase: 10, zoneGainBase: 20, zoneMuteBase: 25 }, (s.advanced || {}).groupsFallback || {});
  const lv = s.levels;
  const digital = new Map(), analog = new Map();
  const viewJoins = [7, 8];
  // exclusive source groups ("only one of Musikk 1–3 per zone"): route target carries the group id
  const exclGroups = (s.sourceGroups || []).filter(g => g.mode === "exclusive");
  const exclusiveOf = x => { if (x.exclusive) return "legacy"; const g = exclGroups.find(g => (g.sources || []).includes(x.id)); return g ? g.id : null; };
  viewJoins.forEach(j => digital.set(j, { kind: "view" }));

  for (const x of s.sources) {
    const i = x.input - 1, j = srcJoin(x);
    const levelOid = x.levelOid || ctrl.inputLevelBlock + pad2(i), muteOid = x.muteOid || ctrl.inputMuteBlock + pad2(i);
    const gainGroup = x.gainGroup != null ? x.gainGroup : gf.inputGainBase + x.input;
    const muteGroup = x.muteGroup != null ? x.muteGroup : gf.inputMuteBase + x.input;
    digital.set(j, direct ? { kind: "mute", oid: muteOid } : { kind: "mute", group: muteGroup });
    analog.set(j,  direct ? { kind: "gain", oid: levelOid, min: lv.input.min, max: lv.input.max } : { kind: "gain", group: gainGroup, min: lv.input.min, max: lv.input.max });
  }
  for (const z of s.zones) {
    const o = z.output - 1, j = zoneJoin(z);
    const oid = z.levelOid || ctrl.zoneBlock + pad2(o);
    const gainGroup = z.gainGroup != null ? z.gainGroup : gf.zoneGainBase + z.output;
    const muteGroup = z.muteGroup != null ? z.muteGroup : gf.zoneMuteBase + z.output;
    digital.set(j, direct ? { kind: "mute", oid: z.muteOid || oid } : { kind: "mute", group: muteGroup });
    analog.set(j,  direct ? { kind: "gain", oid, min: lv.zone.min, max: lv.zone.max } : { kind: "gain", group: gainGroup, min: lv.zone.min, max: lv.zone.max });
    for (const x of s.sources)
      digital.set(routeBase(z) + srcOffset(x), { kind: "route", oid: "2" + pad2(x.input - 1) + pad2(o), exclusive: exclusiveOf(x), zone: z, source: x });
  }
  const muteOidJoin = new Map(), gainOidJoin = new Map(), muteGroupJoin = new Map(), gainGroupJoin = new Map();
  for (const [j, t] of digital) { if (t.oid != null) muteOidJoin.set(t.oid, j); if (t.group != null) muteGroupJoin.set(String(t.group), j); }
  for (const [j, t] of analog)  { if (t.oid != null) gainOidJoin.set(t.oid, { join: j, min: t.min, max: t.max }); if (t.group != null) gainGroupJoin.set(String(t.group), { join: j, min: t.min, max: t.max }); }
  const sc = Object.assign({ analogMax: 65535, groupDbScale: 10, gainOffset: 2048 }, (s.advanced || {}).scaling || {});
  const sis = Object.assign({ verbose: "3CV", keepAlive: "CV", gainSet: "G{oid}*{v}AU", gainView: "G{oid}AU", muteSet: "M{oid}*{v}AU", muteView: "M{oid}AU", groupSet: "D{g}*{v}GRPM", groupView: "D{g}GRPM" }, (s.advanced || {}).sis || {});
  log(`model: ${s.sources.length} sources, ${s.zones.length} zones, mode ${ctrl.mode}` + (direct ? ` (level ${ctrl.inputLevelBlock}xx · mute ${ctrl.inputMuteBlock}xx · zone ${ctrl.zoneBlock}xx)` : " (DMP groups)"));
  return { ctrl, direct, digital, analog, viewJoins, muteOidJoin, gainOidJoin, muteGroupJoin, gainGroupJoin, sc, sis };
}
M = buildModel(SITE);
if (ensureTokens(SITE)) { fs.writeFileSync(SITE_PATH, JSON.stringify(SITE, null, 2) + "\n"); log("access tokens generated for screens without one – see /admin → Skjermer"); }
if (SEC().requireToken && !(SITE.admin || {}).password) log("WARNING: tokens are required but /admin has no password – set one in /admin → Sted og panel");
if (!SEC().requireToken) log("WARNING: security.requireToken is off – anyone on the network can open the panel");

const state = { b: new Map(), n: new Map() };
state.b.set(7, true); state.b.set(8, false);
const dbToAnalog = (db, min, max) => Math.round(Math.max(0, Math.min(1, (db - min) / (max - min))) * M.sc.analogMax);
const analogToDb = (a, min, max) => min + (Math.max(0, Math.min(M.sc.analogMax, a)) / M.sc.analogMax) * (max - min);

/* Apply a new site document: write, rebuild, re-read DSP, tell panels to reload. */
function applySite(newSite) {
  const dspChanged = JSON.stringify(newSite.dsp) !== JSON.stringify(SITE.dsp);
  fs.writeFileSync(SITE_PATH, JSON.stringify(newSite, null, 2) + "\n");
  SITE = loadSite();
  M = buildModel(SITE);
  // forget state for joins that no longer exist, keep views
  for (const j of [...state.b.keys()]) if (!M.digital.has(j)) state.b.delete(j);
  for (const j of [...state.n.keys()]) if (!M.analog.has(j)) state.n.delete(j);
  if (dspChanged && sock) { log("DSP settings changed – reconnecting"); sock.destroy(new Error("config changed")); }
  else if (dspReady) readAllState();
  broadcast({ t: "sys", reload: true });
  log("configuration applied");
}

/* =================== DSP link =================== */
let sock = null, dspReady = false, rxBuf = "", reconnectTimer = null;
let pollTimer = null, keepAliveTimer = null, watchdogTimer = null, lastRx = 0;
/* Command pacing. SIS devices expect a controller that sends one command and
   waits for the reply; a burst (e.g. the ~75 view commands at session start)
   can stall the DMP's telnet handler and the link dies with ETIMEDOUT. So:
   one command in flight at a time, the next goes when a reply line arrives,
   with a fallback timer in case a command gets no reply, and a small minimum
   gap between commands. */
const txQueue = [];
let inFlight = false, inFlightTimer = null, lastTx = 0;
const PACE = () => ({ minGapMs: SITE.dsp.minGapMs != null ? SITE.dsp.minGapMs : 100, replyTimeoutMs: SITE.dsp.replyTimeoutMs != null ? SITE.dsp.replyTimeoutMs : 400 });

/* urgent = a user action: goes ahead of pending view queries (the ~75 reads at session start
   would otherwise delay the first button presses by several seconds). Queue items: { c, urgent } */
function dspSend(cmd, urgent) {
  const item = { c: ESC + cmd + CR, urgent: !!urgent };
  if (urgent) { let i = 0; while (i < txQueue.length && txQueue[i].urgent) i++; txQueue.splice(i, 0, item); } else txQueue.push(item);
  pump();
}
function pump() {
  if (inFlight || !txQueue.length || !sock || sock.destroyed) return;
  const pace = PACE();
  const wait = pace.minGapMs - (Date.now() - lastTx);
  if (wait > 0) { setTimeout(pump, wait); return; }
  const c = txQueue.shift().c;
  inFlight = true; lastTx = Date.now();
  sock.write(c);
  if (process.env.DSP_DEBUG) log("DSP ←", JSON.stringify(c));
  inFlightTimer = setTimeout(() => { inFlight = false; pump(); }, pace.replyTimeoutMs);   // no reply → move on
}
function replied() { clearTimeout(inFlightTimer); inFlight = false; pump(); }

function connectDsp() {
  clearTimeout(reconnectTimer);
  const { host, port } = dspConn();
  log(`DSP: connecting to ${host}:${port}`);
  sock = net.createConnection({ host, port });
  sock.setNoDelay(true);
  sock.setKeepAlive(true, 10000);
  let loginTimer = null;
  sock.on("connect", () => { log("DSP: TCP connected, waiting for banner"); loginTimer = setTimeout(startSession, 1500); });
  sock.on("data", buf => {
    lastRx = Date.now();
    const text = buf.toString("latin1");
    if (process.env.DSP_DEBUG) log("DSP →", JSON.stringify(text));
    if (/Password:/i.test(text)) { clearTimeout(loginTimer); sock.write(dspConn().password + CR); loginTimer = setTimeout(startSession, 500); return; }
    rxBuf += text;
    let i;
    while ((i = rxBuf.search(/\r\n|\r|\n/)) >= 0) {
      const line = rxBuf.slice(0, i).trim(); rxBuf = rxBuf.slice(i).replace(/^(\r\n|\r|\n)/, "");
      if (line) { handleDspLine(line); replied(); }
    }
  });
  const down = why => {
    if (dspReady || sock) log("DSP: link down", why || "");
    dspReady = false; sock = null; rxBuf = ""; txQueue.length = 0; inFlight = false; clearTimeout(inFlightTimer);
    clearTimeout(loginTimer);
    clearInterval(pollTimer); pollTimer = null;
    clearInterval(keepAliveTimer); keepAliveTimer = null;
    clearInterval(watchdogTimer); watchdogTimer = null;
    broadcast({ t: "sys", dsp: false });
    reconnectTimer = setTimeout(connectDsp, SITE.dsp.reconnectMs || 3000);
  };
  sock.on("error", e => down(e.message));
  sock.on("close", () => down("closed"));
}

function startSession() {
  if (dspReady) return;
  dspReady = true; lastRx = Date.now();
  log("DSP: session started – verbose mode + full state read");
  dspSend(M.sis.verbose);
  readAllState();
  broadcast({ t: "sys", dsp: true });
  const d = SITE.dsp;
  if (d.pollMs > 0) pollTimer = setInterval(readAllState, d.pollMs);
  if (d.keepAliveMs > 0 && M.sis.keepAlive) keepAliveTimer = setInterval(() => dspSend(M.sis.keepAlive), d.keepAliveMs);
  if (d.silenceTimeoutMs > 0) watchdogTimer = setInterval(() => {
    if (sock && Date.now() - lastRx > d.silenceTimeoutMs) { log(`DSP: no data for ${Math.round((Date.now() - lastRx) / 1000)} s – reconnecting`); sock.destroy(new Error("silence timeout")); }
  }, 5000);
}

function readAllState() {
  for (const t of M.digital.values()) { if (t.oid != null) dspSend(tpl(M.sis.muteView, { oid: t.oid })); if (t.group != null) dspSend(tpl(M.sis.groupView, { g: t.group })); }
  for (const t of M.analog.values())  { if (t.oid != null) dspSend(tpl(M.sis.gainView, { oid: t.oid })); if (t.group != null) dspSend(tpl(M.sis.groupView, { g: t.group })); }
}

/* DMP responses (verbose 3): DsM20300*0 · DsM40002*1 · DsG40100*1848 (tenths dB + 2048) · GrpmD26*+00000 · Vrb3 · E13 */
function handleDspLine(line) {
  let m;
  if ((m = /^Ds?M(\d{5})\*([+-]?\d+)/.exec(line))) { const j = M.muteOidJoin.get(m[1]); if (j != null) setDigital(j, parseInt(m[2], 10) === 0); return; }
  if ((m = /^Ds?G(\d{5})\*([+-]?\d+)/.exec(line))) { const t = M.gainOidJoin.get(m[1]); if (t) setAnalog(t.join, dbToAnalog((parseInt(m[2], 10) - M.sc.gainOffset) / 10, t.min, t.max)); return; }
  if ((m = /^GrpmD(\d+)\*([+-]?\d+)/.exec(line))) {
    const g = m[1], v = parseInt(m[2], 10);
    if (M.muteGroupJoin.has(g)) { setDigital(M.muteGroupJoin.get(g), v === 0); return; }
    const t = M.gainGroupJoin.get(g); if (t) setAnalog(t.join, dbToAnalog(v / M.sc.groupDbScale, t.min, t.max)); return;
  }
  if (/^Vrb\d/.test(line)) return;
  if (/^E\d\d/.test(line)) { log("DSP error response:", line); return; }
  if (process.env.DSP_DEBUG) log("DSP (unhandled):", line);
}
function setDigital(j, v) { if (state.b.get(j) !== v) { state.b.set(j, v); broadcast({ t: "b", j, v }); } }
function setAnalog(j, v)  { if (state.n.get(j) !== v) { state.n.set(j, v); broadcast({ t: "n", j, v }); } }

/* =================== actions from panels =================== */
const pressed = new Set();
function onDigital(j, v) {
  const t = M.digital.get(j); if (!t) return;
  const rising = v && !pressed.has(j); v ? pressed.add(j) : pressed.delete(j);
  if (!rising) return;
  const on = state.b.get(j);
  switch (t.kind) {
    case "view":  M.viewJoins.forEach(vj => setDigital(vj, vj === j)); break;
    case "mute":  t.oid != null ? dspSend(tpl(M.sis.muteSet, { oid: t.oid, v: on ? 1 : 0 }), true) : dspSend(tpl(M.sis.groupSet, { g: t.group, v: on ? 1 : 0 }), true); break;
    case "route":
      // turning on a member of an exclusive group → mute the group's other members in this zone first
      if (!on && t.exclusive) for (const [oj, ot] of M.digital) if (ot.kind === "route" && ot.zone === t.zone && ot.exclusive === t.exclusive && oj !== j && state.b.get(oj)) dspSend(tpl(M.sis.muteSet, { oid: ot.oid, v: 1 }), true);
      dspSend(tpl(M.sis.muteSet, { oid: t.oid, v: on ? 1 : 0 }), true);
      break;
  }
}
const analogPending = new Map();
function onAnalog(j, v) {
  const t = M.analog.get(j); if (!t) return;
  analogPending.set(j, v);
  if (analogPending.get(j + "_timer")) return;
  analogPending.set(j + "_timer", setTimeout(() => {              // coalesce fast fader moves
    analogPending.delete(j + "_timer");
    const val = analogPending.get(j), tenths = Math.round(analogToDb(val, t.min, t.max) * 10);
    if (t.oid != null) dspSend(tpl(M.sis.gainSet, { oid: t.oid, v: tenths + M.sc.gainOffset }), true);
    else dspSend(tpl(M.sis.groupSet, { g: t.group, v: tenths }), true);
    state.n.set(j, val); broadcast({ t: "n", j, v: val });
  }, 60));
}

/* =================== HTTP: panel, generated config, admin =================== */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp", ".json": "application/json", ".ico": "image/x-icon", ".woff2": "font/woff2" };
const json = (res, code, obj) => { res.statusCode = code; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(obj)); };
const readBody = req => new Promise((resolve, reject) => { let b = ""; req.on("data", c => { b += c; if (b.length > 2e6) reject(new Error("too large")); }); req.on("end", () => resolve(b)); req.on("error", reject); });
const readRaw  = (req, max) => new Promise((resolve, reject) => { const parts = []; let n = 0; req.on("data", c => { n += c.length; if (n > max) { reject(new Error(`file too large (max ${Math.round(max / 1e6)} MB)`)); req.destroy(); } else parts.push(c); }); req.on("end", () => resolve(Buffer.concat(parts))); req.on("error", reject); });
const IMG_EXT = { "image/png": ".png", "image/jpeg": ".jpg", "image/svg+xml": ".svg", "image/webp": ".webp" };

function adminAuthorized(req, res) {
  const pw = (SITE.admin || {}).password || "";
  if (!pw) return true;
  const h = req.headers.authorization || "";
  const ok = h.startsWith("Basic ") && safeEq(Buffer.from(h.slice(6), "base64").toString("utf8").split(":").slice(1).join(":"), pw);
  if (!ok) { res.statusCode = 401; res.setHeader("WWW-Authenticate", 'Basic realm="DSP Panel admin"'); res.end("Unauthorized"); }
  return ok;
}

const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  const q = new URLSearchParams(req.url.split("?")[1] || "");
  try {
    if (url === "/api/health") {                                   // open, minimal – for monitoring; details need a token
      const auth = SEC().requireToken ? tokenPanel(req) : true;
      return json(res, 200, auth ? { ok: true, dsp: dspReady, mode: M.ctrl.mode, clients: wss.clients.size, sources: SITE.sources.length, zones: SITE.zones.length, publishing: PUBLISH.running } : { ok: true, dsp: dspReady });
    }
    if (url === "/api/state")  { if (!panelAuthorized(req, res)) return; return json(res, 200, { b: Object.fromEntries(state.b), n: Object.fromEntries(state.n) }); }

    // generated panel config (also the file to copy into js/ for a TSW build); ?panel=<id> → that screen's cut-down config
    if (url === "/js/config.js" || url === "/api/export/config.js") {
      let panel;
      if (url.startsWith("/api/export")) { if (!adminAuthorized(req, res)) return; panel = q.get("panel") ? panelById(q.get("panel")) : null; if (q.get("panel") && !panel) return json(res, 404, { ok: false, error: "unknown screen " + q.get("panel") }); }
      else { const auth = panelAuthorized(req, res); if (!auth) return; panel = auth === true ? (q.get("panel") ? panelById(q.get("panel")) : null) : auth; }
      res.setHeader("content-type", "text/javascript"); res.setHeader("cache-control", "no-cache");
      if (url.startsWith("/api/export")) res.setHeader("content-disposition", `attachment; filename="config${panel ? "-" + panel.id : ""}.js"`);
      return res.end(panelConfigJs(SITE, panel, url.startsWith("/api/export") && !!panel));
    }

    // admin
    if (url === "/admin" || url === "/admin/") {
      if (!adminAuthorized(req, res)) return;
      res.setHeader("content-type", "text/html; charset=utf-8"); res.setHeader("cache-control", "no-cache");
      return res.end(fs.readFileSync(path.join(__dirname, "admin", "index.html")));
    }
    if (url === "/api/admin/config") {
      if (!adminAuthorized(req, res)) return;
      if (req.method === "GET") {
        const s = JSON.parse(JSON.stringify(SITE)); s.dsp.password = s.dsp.password ? "••••••" : ""; s.admin = { password: (SITE.admin || {}).password ? "••••••" : "" };
        (s.panels || []).forEach(p => { p.password = p.password ? "••••••" : ""; });
        s.security = SEC();
        return json(res, 200, { site: s, dsp: dspReady, joins: joinTable(SITE), publicUrl: publicUrl(), lanAddress: lanAddress(), listenPort: LISTEN_PORT, ch5cli: fs.existsSync(path.join(__dirname, "node_modules", "@crestron", "ch5-utilities-cli")) ? "installed" : "npx" });
      }
      if (req.method === "POST") {
        const body = JSON.parse(await readBody(req) || "{}");
        const s = body.site;
        // keep secrets unless changed
        if (s && s.dsp && s.dsp.password === "••••••") s.dsp.password = SITE.dsp.password || "";
        if (s && s.admin && s.admin.password === "••••••") s.admin.password = (SITE.admin || {}).password || "";
        if (s && Array.isArray(s.panels)) s.panels.forEach(p => { if (p.password === "••••••") p.password = (panelById(p.id) || {}).password || ""; if (!p.token) p.token = newToken(); });
        if (s) { s.listen = SITE.listen; s.advanced = s.advanced || SITE.advanced; }
        const problems = validateSite(s);
        if (problems.length) return json(res, 400, { ok: false, problems });
        applySite(s);
        return json(res, 200, { ok: true, joins: joinTable(SITE) });
      }
    }
    // backup / restore of the whole configuration (site.json)
    if (url === "/api/admin/export/site.json") {
      if (!adminAuthorized(req, res)) return;
      res.setHeader("content-type", "application/json"); res.setHeader("content-disposition", `attachment; filename="site-${new Date().toISOString().slice(0, 10)}.json"`);
      return res.end(JSON.stringify(SITE, null, 2));
    }
    if (url === "/api/admin/import" && req.method === "POST") {
      if (!adminAuthorized(req, res)) return;
      let s; try { s = JSON.parse(await readBody(req) || ""); } catch (_) { return json(res, 400, { ok: false, problems: ["not valid JSON"] }); }
      if (s && s.site && !s.sources) s = s.site;                        // accept a wrapped {site:…} too
      if (s) { s.listen = SITE.listen; s.advanced = s.advanced || SITE.advanced; s.admin = s.admin || SITE.admin; ensureTokens(s); }
      const problems = validateSite(s);
      if (problems.length) return json(res, 400, { ok: false, problems });
      applySite(s);
      return json(res, 200, { ok: true, joins: joinTable(SITE) });
    }
    // publish to the Crestron touch panels (build .ch5z per screen + ch5-cli deploy)
    if (url === "/api/admin/publish" && req.method === "POST") {
      if (!adminAuthorized(req, res)) return;
      const body = JSON.parse(await readBody(req) || "{}");
      try { await publishPanels(Array.isArray(body.ids) && body.ids.length ? body.ids : null); } catch (e) { return json(res, 409, { ok: false, error: e.message }); }
      return json(res, 202, { ok: true });
    }
    if (url === "/api/admin/publish/status") { if (!adminAuthorized(req, res)) return; return json(res, 200, PUBLISH); }
    // download one screen's .ch5z (to load with Crestron Toolbox if the direct deploy can't reach the panel)
    if (url.startsWith("/api/admin/panels/") && url.endsWith("/archive")) {
      if (!adminAuthorized(req, res)) return;
      const panel = panelById(url.split("/")[4]);
      if (!panel) return json(res, 404, { ok: false, error: "unknown screen" });
      if (PUBLISH.running) return json(res, 409, { ok: false, error: "a publish job is running – wait for it to finish" });
      let file; try { file = await buildArchive(panel); } catch (e) { return json(res, 500, { ok: false, error: e.message }); }
      res.setHeader("content-type", "application/octet-stream"); res.setHeader("content-disposition", `attachment; filename="${PROJECT}-${panel.id}.ch5z"`);
      return fs.createReadStream(file).pipe(res);
    }
    // appearance: upload / reset logo and background (PNG, JPEG, SVG, WebP ≤ 8 MB). Updates theme.<kind> and applies at once.
    if (url === "/api/admin/theme/upload" && req.method === "POST") {
      if (!adminAuthorized(req, res)) return;
      const kind = q.get("kind"); if (!["logo", "background"].includes(kind)) return json(res, 400, { ok: false, error: "kind must be logo or background" });
      const ext = IMG_EXT[(req.headers["content-type"] || "").split(";")[0].trim()]; if (!ext) return json(res, 415, { ok: false, error: "use a PNG, JPEG, SVG or WebP image" });
      let buf; try { buf = await readRaw(req, 8e6); } catch (e) { return json(res, 413, { ok: false, error: e.message }); }
      if (!buf.length) return json(res, 400, { ok: false, error: "empty file" });
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const name = `${kind}-${crypto.createHash("sha1").update(buf).digest("hex").slice(0, 8)}${ext}`;
      fs.writeFileSync(path.join(DATA_DIR, name), buf);
      const s = JSON.parse(JSON.stringify(SITE)); s.theme = Object.assign({}, s.theme || {}); const old = customFile(s.theme[kind]); s.theme[kind] = "custom/" + name;
      applySite(s);
      if (old && path.basename(old) !== name && fs.existsSync(old)) fs.unlinkSync(old);
      return json(res, 200, { ok: true, path: s.theme[kind] });
    }
    if (url === "/api/admin/theme/reset" && req.method === "POST") {
      if (!adminAuthorized(req, res)) return;
      const kind = q.get("kind"); if (!["logo", "background"].includes(kind)) return json(res, 400, { ok: false, error: "kind must be logo or background" });
      const s = JSON.parse(JSON.stringify(SITE)); s.theme = Object.assign({}, s.theme || {}); const old = customFile(s.theme[kind]); s.theme[kind] = q.get("none") ? "none" : "";
      applySite(s);
      if (old && fs.existsSync(old)) fs.unlinkSync(old);
      return json(res, 200, { ok: true, path: s.theme[kind] });
    }
    if (url === "/api/admin/dsp/reconnect" && req.method === "POST") { if (!adminAuthorized(req, res)) return; if (sock) sock.destroy(new Error("manual reconnect")); else connectDsp(); return json(res, 200, { ok: true }); }

    // static panel files (token required); /custom/<file> = uploaded logo/background from bridge/data
    const auth = panelAuthorized(req, res); if (!auth) return;
    const inData = url.startsWith("/custom/");
    let file = inData ? path.normalize(path.join(DATA_DIR, url.slice(8))) : path.normalize(path.join(ROOT, url === "/" ? "index.html" : url));
    const forbidden = inData ? !file.startsWith(DATA_DIR + path.sep) : (!file.startsWith(ROOT) || file.includes(path.sep + "bridge" + path.sep) || file.includes("node_modules"));
    if (forbidden) { res.statusCode = 403; return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.statusCode = 404; return res.end("not found"); }
      res.setHeader("content-type", MIME[path.extname(file)] || "application/octet-stream"); res.setHeader("cache-control", "no-cache");
      if (path.basename(file) === "index.html") {
        let html = data.toString("utf8").replace("</head>", "<script>window.DSP_BRIDGE=true</script>\n</head>");
        const pid = auth === true ? q.get("panel") : null;      // without tokens, /?panel=<id> previews a screen; with tokens the token says which
        if (pid && panelById(pid)) html = html.replace('src="js/config.js"', `src="js/config.js?panel=${encodeURIComponent(pid)}"`);
        data = Buffer.from(html);
      }
      res.end(data);
    });
  } catch (e) { log("http error", e.message); json(res, 500, { ok: false, error: e.message }); }
});

/* Join/OID table for the admin page (read-only reference). */
function joinTable(s) {
  const rows = [];
  for (const x of s.sources) { const t = M.digital.get(srcJoin(x)), a = M.analog.get(srcJoin(x)); rows.push({ kind: "Input", name: x.name, input: x.input, joins: `D/A ${srcJoin(x)}`, control: t.oid != null ? `mute ${t.oid} · level ${a.oid}` : `mute grp ${t.group} · gain grp ${a.group}` }); }
  for (const z of s.zones) { const t = M.digital.get(zoneJoin(z)), a = M.analog.get(zoneJoin(z)); rows.push({ kind: "Zone", name: z.name, output: z.output, joins: `D/A ${zoneJoin(z)} · ruting D${routeBase(z)}–${routeBase(z) + 9}`, control: t.oid != null ? `output ${a.oid}` : `mute grp ${t.group} · gain grp ${a.group}` }); }
  return rows;
}

const wss = new WebSocketServer({ server, path: "/ws", verifyClient: info => !SEC().requireToken || !!tokenPanel(info.req) });
function broadcast(msg) { const s = JSON.stringify(msg); for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(s); }
wss.on("connection", (ws, req) => {
  const who = tokenPanel(req);
  log("panel connected", req.socket.remoteAddress, who ? `(${who.name})` : "", "| clients:", wss.clients.size);
  ws.send(JSON.stringify({ t: "sys", dsp: dspReady }));
  for (const [j, v] of state.b) ws.send(JSON.stringify({ t: "b", j, v }));
  for (const [j, v] of state.n) ws.send(JSON.stringify({ t: "n", j, v }));
  ws.on("message", data => { let m; try { m = JSON.parse(data); } catch (_) { return; } if (m.t === "b") onDigital(Number(m.j), !!m.v); else if (m.t === "n") onAnalog(Number(m.j), Number(m.v)); });
  ws.on("close", () => log("panel disconnected | clients:", wss.clients.size));
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  log(`bridge listening on http://${LISTEN_HOST}:${LISTEN_PORT}  (panel · /admin · /ws)`);
  connectDsp();
});
