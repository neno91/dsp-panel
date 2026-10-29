"use strict";
/* ------------------------------------------------------------------
   Site configuration (bridge/site.json)
   ------------------------------------------------------------------
   The one configuration document: DSP connection, control mode, sources,
   zones, groups, screens, appearance. Edited through /admin, validated
   here, written back here. `SiteStore` holds the live copy and emits
   "applied" whenever a new document has been written.
   ------------------------------------------------------------------ */
const fs = require("fs");
const os = require("os");
const path = require("path");
const EventEmitter = require("events");
const { log, newToken } = require("./util");

const VIEWS = [{ id: "zones", label: "Zones", icon: "home", join: 7 }, { id: "mixer", label: "Mixer", icon: "speaker", join: 8 }];
const LANGS = ["nb", "en"];                       // panel languages (texts live in js/i18n.js)
/* appearance: logo/background live in bridge/data (uploaded via /admin, served at /custom/…),
   colours override the CSS variables; "" = the panel's built-in default, background "none" = plain colour */
const DEFAULT_THEME = { logo: "", logoHeight: 58, background: "", veil: 1, colors: {
  bg0: "#041721", bg1: "#062330", bg2: "#0b3142", bg3: "#124256", bg4: "#1a556c",
  accent: "#2689a8", accentHi: "#4fb6d4", active: "#f2b24a", activeHi: "#ffd27a",
  text: "#eef6f9", textDim: "#a9c3cf", textFaint: "#6f8f9d", ok: "#58d48f", down: "#ef6b5b" } };

/* Validate a site document (from /admin or an import). Returns a list of problems; empty = OK. */
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
    if (pn.scale != null && !(Number(pn.scale) >= 0.6 && Number(pn.scale) <= 2.5)) p.push(`screen ${nm}: scale must be between 0.6 and 2.5`);
    if (pn.lang && !LANGS.includes(pn.lang)) p.push(`screen ${nm}: language must be ${LANGS.join("/")}`);
    if (pn.views != null && (!Array.isArray(pn.views) || !pn.views.length || pn.views.some(v => !VIEWS.some(x => x.id === v)))) p.push(`screen ${nm}: views must be a non-empty list of ${VIEWS.map(v => v.id).join("/")}`);
  });
  if (s.publicUrl && !/^https?:\/\/[\w.:-]+(\/.*)?$/.test(s.publicUrl)) p.push("bridge address must look like http://<ip>:3000");
  if (s.ui && s.ui.lang && !LANGS.includes(s.ui.lang)) p.push(`language must be ${LANGS.join("/")}`);
  if (s.ui && s.ui.zoneLayout && !["scroll", "scroll2", "grid"].includes(s.ui.zoneLayout)) p.push("zone layout must be scroll, scroll2 or grid");
  if (s.ui && s.ui.sourceLayout && !["tiles", "list"].includes(s.ui.sourceLayout)) p.push("source layout must be tiles or list");
  if (s.ui && s.ui.sourceColumns != null && ![0, 2, 3, 4, 5].includes(Number(s.ui.sourceColumns))) p.push("source buttons per row must be auto, 2, 3, 4 or 5");
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

/* give every screen a token; seed a browser entry if there are no screens at all (first start after upgrade) */
function ensureTokens(s) {
  let changed = false;
  if (!Array.isArray(s.panels) || !s.panels.length) { s.panels = [{ id: "web", name: "Browser / mobile", host: "", user: "admin", password: "", zones: "*" }]; changed = true; }
  for (const p of s.panels) if (!p.token) { p.token = newToken(); changed = true; }
  return changed;
}

/* first LAN IPv4 of this host – what the screens use to reach the bridge unless publicUrl is set */
function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) for (const a of list) if (a.family === "IPv4" && !a.internal) return a.address;
  return "127.0.0.1";
}

class SiteStore extends EventEmitter {
  /* @param sitePath  bridge/site.json (or the path given on the command line)
     @param dataDir   bridge/data – uploaded logo/background */
  constructor(sitePath, { dataDir, defaultPath, env = process.env } = {}) {
    super();
    this.path = sitePath;
    this.dataDir = dataDir || path.join(path.dirname(sitePath), "data");
    this.defaultPath = defaultPath || path.join(path.dirname(sitePath), "site.default.json");
    this.env = env;
    this.site = this.load();
    this.listenPort = Number(env.PORT || (this.site.listen && this.site.listen.port) || 3000);
    this.listenHost = (this.site.listen && this.site.listen.host) || "0.0.0.0";
    if (ensureTokens(this.site)) { this.write(this.site); log("access tokens generated for screens without one – see /admin → Screens"); }
  }
  load() {
    if (!fs.existsSync(this.path)) {                                  // first start: begin from the shipped defaults
      if (!fs.existsSync(this.defaultPath)) throw new Error(`no ${this.path} and no ${this.defaultPath} – nothing to start from`);
      fs.copyFileSync(this.defaultPath, this.path);
      log(`${this.path} missing – created from site.default.json; set the DSP address in /admin`);
    }
    return JSON.parse(fs.readFileSync(this.path, "utf8"));
  }
  write(site) { fs.writeFileSync(this.path, JSON.stringify(site, null, 2) + "\n"); }
  /* Validate, write and take a new document into use. Emits "applied" with { dspChanged }. Throws with .problems on invalid input. */
  apply(newSite) {
    const problems = validateSite(newSite);
    if (problems.length) { const e = new Error("invalid configuration"); e.problems = problems; throw e; }
    const dspChanged = JSON.stringify(newSite.dsp) !== JSON.stringify(this.site.dsp);
    this.write(newSite);
    this.site = this.load();
    this.emit("applied", { dspChanged });
    log("configuration applied");
  }
  /* effective DSP connection: environment overrides win but are never written to site.json */
  conn() {
    const d = this.site.dsp, e = this.env;
    return { host: e.DSP_HOST || d.host, port: Number(e.DSP_PORT || d.port || 23), password: e.DSP_PASSWORD !== undefined ? e.DSP_PASSWORD : (d.password || "") };
  }
  security()  { return Object.assign({ requireToken: true }, this.site.security || {}); }
  panelById(id) { return (this.site.panels || []).find(p => p.id === id); }
  publicUrl() { return ((this.site.publicUrl || "").trim() || `http://${lanAddress()}:${this.listenPort}`).replace(/\/+$/, ""); }
  theme()     { const t = this.site.theme || {}; return Object.assign({}, DEFAULT_THEME, t, { colors: Object.assign({}, DEFAULT_THEME.colors, t.colors || {}) }); }
  /* absolute path of an uploaded theme file ("custom/<name>"), or null */
  customFile(rel) { return (rel && rel !== "none" && /^custom\/[\w.-]+$/.test(rel)) ? path.join(this.dataDir, rel.slice(7)) : null; }
}

module.exports = { SiteStore, validateSite, ensureTokens, lanAddress, VIEWS, LANGS, DEFAULT_THEME };
