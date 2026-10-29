"use strict";
/* ------------------------------------------------------------------
   HTTP: panel files, generated config, admin page and admin API
   ------------------------------------------------------------------
   Routes are a table of { method, path | test, admin | panel, handler }.
   "admin" routes need the admin password, "panel" routes a screen token
   (when tokens are on). Everything not matched is a static panel file.
   ------------------------------------------------------------------ */
const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { panelConfigJs, joinTable } = require("./model");
const { validateSite, ensureTokens } = require("./site");
const { PROJECT } = require("./publish");
const { log, clone, newToken } = require("./util");

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp", ".json": "application/json", ".ico": "image/x-icon", ".woff2": "font/woff2" };
const IMG_EXT = { "image/png": ".png", "image/jpeg": ".jpg", "image/svg+xml": ".svg", "image/webp": ".webp" };
const MASK = "••••••";

const json = (res, code, obj) => { res.statusCode = code; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(obj)); };
const readBody = req => new Promise((resolve, reject) => { let b = ""; req.on("data", c => { b += c; if (b.length > 2e6) reject(new Error("too large")); }); req.on("end", () => resolve(b)); req.on("error", reject); });
const readRaw  = (req, max) => new Promise((resolve, reject) => { const parts = []; let n = 0; req.on("data", c => { n += c.length; if (n > max) { reject(new Error(`file too large (max ${Math.round(max / 1e6)} MB)`)); req.destroy(); } else parts.push(c); }); req.on("end", () => resolve(Buffer.concat(parts))); req.on("error", reject); });
const sendFile = (res, file, type) => { res.setHeader("content-type", type || MIME[path.extname(file)] || "application/octet-stream"); res.setHeader("cache-control", "no-cache"); fs.createReadStream(file).on("error", () => { res.statusCode = 404; res.end("not found"); }).pipe(res); };

/* ctx: { store, auth, ctrl, dsp, publisher, root, adminDir, clientCount } */
function createHttpServer(ctx) {
  const { store, auth, ctrl, dsp, publisher, root, adminDir } = ctx;
  const S = () => store.site;
  const configJs = (panel, pin) => panelConfigJs(S(), panel, pin, { theme: store.theme(), publicUrl: store.publicUrl(), requireToken: store.security().requireToken });
  /* apply a document posted from /admin: restore masked secrets, keep server-only sections, validate */
  const applyFromAdmin = (s, { keepAdmin } = {}) => {
    if (s && s.dsp && s.dsp.password === MASK) s.dsp.password = S().dsp.password || "";
    if (s && s.admin && s.admin.password === MASK) s.admin.password = (S().admin || {}).password || "";
    if (s && Array.isArray(s.panels)) s.panels.forEach(p => { if (p.password === MASK) p.password = (store.panelById(p.id) || {}).password || ""; if (!p.token) p.token = newToken(); });
    if (s) { s.listen = S().listen; s.advanced = s.advanced || S().advanced; if (keepAdmin) s.admin = s.admin || S().admin; }
    const problems = validateSite(s);
    if (problems.length) return problems;
    store.apply(s); return null;
  };
  const setTheme = (kind, value) => { const s = clone(S()); s.theme = Object.assign({}, s.theme || {}); const old = store.customFile(s.theme[kind]); s.theme[kind] = value; store.apply(s); return old; };

  const routes = [
    /* ---- open ---- */
    { path: "/api/health", handler: (req, res) => {              // open, minimal – for monitoring; details need a token
      const ok = auth.requireToken() ? auth.tokenPanel(req) : true;
      json(res, 200, ok ? { ok: true, dsp: dsp.connected, mode: ctrl.M.ctrl.mode, clients: ctx.clientCount(), sources: S().sources.length, zones: S().zones.length, publishing: publisher.running } : { ok: true, dsp: dsp.connected });
    } },
    /* ---- panel (token) ---- */
    { path: "/api/state", panel: true, handler: (req, res) => json(res, 200, { b: Object.fromEntries(ctrl.state.b), n: Object.fromEntries(ctrl.state.n) }) },
    { path: "/js/config.js", panel: true, handler: (req, res, q, who) => {   // the generated panel config; the token says which screen
      const panel = who === true ? (q.get("panel") ? store.panelById(q.get("panel")) : null) : who;
      res.setHeader("content-type", "text/javascript"); res.setHeader("cache-control", "no-cache"); res.end(configJs(panel, false));
    } },
    /* ---- admin page and its files ---- */
    { test: u => u === "/admin" || u === "/admin/", admin: true, handler: (req, res) => sendFile(res, path.join(adminDir, "index.html"), MIME[".html"]) },
    { test: u => u.startsWith("/admin/"), admin: true, handler: (req, res, q, _w, url) => {
      const file = path.normalize(path.join(adminDir, url.slice(7)));
      if (!file.startsWith(adminDir + path.sep)) { res.statusCode = 403; return res.end(); }
      sendFile(res, file);
    } },
    /* ---- admin API ---- */
    { path: "/api/export/config.js", admin: true, handler: (req, res, q) => {
      const panel = q.get("panel") ? store.panelById(q.get("panel")) : null;
      if (q.get("panel") && !panel) return json(res, 404, { ok: false, error: "unknown screen " + q.get("panel") });
      res.setHeader("content-type", "text/javascript"); res.setHeader("content-disposition", `attachment; filename="config${panel ? "-" + panel.id : ""}.js"`);
      res.end(configJs(panel, !!panel));
    } },
    { path: "/api/admin/config", method: "GET", admin: true, handler: (req, res) => {
      const s = clone(S()); s.dsp.password = s.dsp.password ? MASK : ""; s.admin = { password: (S().admin || {}).password ? MASK : "" };
      (s.panels || []).forEach(p => { p.password = p.password ? MASK : ""; }); s.security = store.security();
      json(res, 200, { site: s, dsp: dsp.connected, joins: joinTable(S(), ctrl.M), publicUrl: store.publicUrl(), lanAddress: require("./site").lanAddress(), listenPort: store.listenPort, ch5cli: publisher.cliInstalled() ? "installed" : "npx" });
    } },
    { path: "/api/admin/config", method: "POST", admin: true, handler: async (req, res) => {
      const body = JSON.parse(await readBody(req) || "{}");
      const problems = applyFromAdmin(body.site);
      problems ? json(res, 400, { ok: false, problems }) : json(res, 200, { ok: true, joins: joinTable(S(), ctrl.M) });
    } },
    { path: "/api/admin/export/site.json", admin: true, handler: (req, res) => {   // backup
      res.setHeader("content-type", "application/json"); res.setHeader("content-disposition", `attachment; filename="site-${new Date().toISOString().slice(0, 10)}.json"`);
      res.end(JSON.stringify(S(), null, 2));
    } },
    { path: "/api/admin/import", method: "POST", admin: true, handler: async (req, res) => {   // restore
      let s; try { s = JSON.parse(await readBody(req) || ""); } catch (_) { return json(res, 400, { ok: false, problems: ["not valid JSON"] }); }
      if (s && s.site && !s.sources) s = s.site;                        // accept a wrapped {site:…} too
      if (s) ensureTokens(s);
      const problems = applyFromAdmin(s, { keepAdmin: true });
      problems ? json(res, 400, { ok: false, problems }) : json(res, 200, { ok: true, joins: joinTable(S(), ctrl.M) });
    } },
    { path: "/api/admin/publish", method: "POST", admin: true, handler: async (req, res) => {
      const body = JSON.parse(await readBody(req) || "{}");
      try { publisher.publish(Array.isArray(body.ids) && body.ids.length ? body.ids : null); } catch (e) { return json(res, 409, { ok: false, error: e.message }); }
      json(res, 202, { ok: true });
    } },
    { path: "/api/admin/publish/status", admin: true, handler: (req, res) => json(res, 200, publisher.status) },
    { test: u => u.startsWith("/api/admin/panels/") && u.endsWith("/archive"), admin: true, handler: async (req, res, q, _w, url) => {   // one screen's .ch5z for Crestron Toolbox
      const panel = store.panelById(url.split("/")[4]);
      if (!panel) return json(res, 404, { ok: false, error: "unknown screen" });
      if (publisher.running) return json(res, 409, { ok: false, error: "a publish job is running – wait for it to finish" });
      let file; try { file = await publisher.buildArchive(panel); } catch (e) { return json(res, 500, { ok: false, error: e.message }); }
      res.setHeader("content-disposition", `attachment; filename="${PROJECT}-${panel.id}.ch5z"`); sendFile(res, file, "application/octet-stream");
    } },
    { path: "/api/admin/theme/upload", method: "POST", admin: true, handler: async (req, res, q) => {   // logo / background image ≤ 8 MB
      const kind = q.get("kind"); if (!["logo", "background"].includes(kind)) return json(res, 400, { ok: false, error: "kind must be logo or background" });
      const ext = IMG_EXT[(req.headers["content-type"] || "").split(";")[0].trim()]; if (!ext) return json(res, 415, { ok: false, error: "use a PNG, JPEG, SVG or WebP image" });
      let buf; try { buf = await readRaw(req, 8e6); } catch (e) { return json(res, 413, { ok: false, error: e.message }); }
      if (!buf.length) return json(res, 400, { ok: false, error: "empty file" });
      fs.mkdirSync(store.dataDir, { recursive: true });
      const name = `${kind}-${crypto.createHash("sha1").update(buf).digest("hex").slice(0, 8)}${ext}`;
      fs.writeFileSync(path.join(store.dataDir, name), buf);
      const old = setTheme(kind, "custom/" + name);
      if (old && path.basename(old) !== name && fs.existsSync(old)) fs.unlinkSync(old);
      json(res, 200, { ok: true, path: "custom/" + name });
    } },
    { path: "/api/admin/theme/reset", method: "POST", admin: true, handler: (req, res, q) => {
      const kind = q.get("kind"); if (!["logo", "background"].includes(kind)) return json(res, 400, { ok: false, error: "kind must be logo or background" });
      const value = q.get("none") ? "none" : "", old = setTheme(kind, value);
      if (old && fs.existsSync(old)) fs.unlinkSync(old);
      json(res, 200, { ok: true, path: value });
    } },
    { path: "/api/admin/dsp/reconnect", method: "POST", admin: true, handler: (req, res) => { dsp.reconnect("manual reconnect"); json(res, 200, { ok: true }); } },
  ];

  /* static panel files (token required); /custom/<file> = uploaded logo/background */
  function serveStatic(req, res, q, who, url) {
    const inData = url.startsWith("/custom/");
    const file = inData ? path.normalize(path.join(store.dataDir, url.slice(8))) : path.normalize(path.join(root, url === "/" ? "index.html" : url));
    const forbidden = inData ? !file.startsWith(store.dataDir + path.sep) : (!file.startsWith(root) || file.includes(path.sep + "bridge" + path.sep) || file.includes("node_modules"));
    if (forbidden) { res.statusCode = 403; return res.end(); }
    if (path.basename(file) !== "index.html") return sendFile(res, file);
    fs.readFile(file, (err, data) => {
      if (err) { res.statusCode = 404; return res.end("not found"); }
      let html = data.toString("utf8").replace("</head>", "<script>window.DSP_BRIDGE=true</script>\n</head>");
      const pid = who === true ? q.get("panel") : null;      // without tokens, /?panel=<id> previews a screen; with tokens the token says which
      if (pid && store.panelById(pid)) html = html.replace('src="js/config.js"', `src="js/config.js?panel=${encodeURIComponent(pid)}"`);
      res.setHeader("content-type", MIME[".html"]); res.setHeader("cache-control", "no-cache"); res.end(html);
    });
  }

  return http.createServer(async (req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    const q = new URLSearchParams(req.url.split("?")[1] || "");
    try {
      const r = routes.find(r => (r.path ? r.path === url : r.test(url)) && (!r.method || r.method === req.method));
      if (r) {
        let who = true;
        if (r.admin && !auth.adminAuthorized(req, res)) return;
        if (r.panel) { who = auth.panelAuthorized(req, res); if (!who) return; }
        return await r.handler(req, res, q, who, url);
      }
      const who = auth.panelAuthorized(req, res); if (!who) return;
      serveStatic(req, res, q, who, url);
    } catch (e) { log("http error", e.message); if (!res.headersSent) json(res, 500, { ok: false, error: e.message }); }
  });
}

module.exports = { createHttpServer };
