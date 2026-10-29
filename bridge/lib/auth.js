"use strict";
/* ------------------------------------------------------------------
   Access control
   ------------------------------------------------------------------
   Every screen (site.panels entry) has a token – a GUID. Browsers open
   /?token=<guid> once (the bridge then keeps it in a cookie); the .ch5z
   built for a touch panel carries it in its WebSocket URL. Without a
   valid token the panel, its files, /api/state and /ws answer 401.
   /admin and /api/admin/* use admin.password (HTTP Basic) instead.
   ------------------------------------------------------------------ */
const { safeEq } = require("./util");

const DENIED_PAGE = lang => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${lang === "nb" ? "Ingen tilgang" : "No access"}</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#062330;color:#eef6f9;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:24px"><div><h1 style="font-size:22px;margin:0 0 8px">${lang === "nb" ? "Panelet er beskyttet" : "This panel is protected"}</h1><p style="color:#a9c3cf;max-width:34em;margin:0">${lang === "nb" ? "Åpne panelet via lenken med tilgangsnøkkel fra <code>/admin → Skjermer → Kopier lenke</code>. Lenken huskes i denne nettleseren etterpå." : "Open the panel through the link with an access key from <code>/admin → Screens → Copy link</code>. The key is remembered in this browser afterwards."}</p></div>`;

class Auth {
  constructor(store) { this.store = store; }
  requireToken() { return this.store.security().requireToken; }
  /* the token a request carries: ?token= in the URL or the lp_token cookie */
  requestToken(req) {
    const t = new URLSearchParams(req.url.split("?")[1] || "").get("token");
    if (t) return { token: t, fromUrl: true };
    const m = /(?:^|;\s*)lp_token=([^;]+)/.exec(req.headers.cookie || "");
    return m ? { token: decodeURIComponent(m[1]), fromUrl: false } : null;
  }
  /* the screen whose token the request carries (null if none/invalid) */
  tokenPanel(req) {
    const t = this.requestToken(req); if (!t) return null;
    return (this.store.site.panels || []).find(p => p.token && safeEq(p.token, t.token)) || null;
  }
  /* true (tokens off) | the screen | null after writing a 401 */
  panelAuthorized(req, res) {
    if (!this.requireToken()) return true;
    const p = this.tokenPanel(req);
    if (p) { const t = this.requestToken(req); if (t.fromUrl) res.setHeader("set-cookie", `lp_token=${encodeURIComponent(t.token)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`); return p; }
    res.statusCode = 401;
    if (/^\/(api|js|css|assets|custom)\//.test(req.url) || /\.(js|css|png|jpg|svg|webp)$/.test(req.url.split("?")[0])) { res.setHeader("content-type", "text/plain"); res.end("token required"); return null; }
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(DENIED_PAGE((this.store.site.ui || {}).lang));
    return null;
  }
  /* HTTP Basic with admin.password (any user name); open when no password is set */
  adminAuthorized(req, res) {
    const pw = (this.store.site.admin || {}).password || "";
    if (!pw) return true;
    const h = req.headers.authorization || "";
    const ok = h.startsWith("Basic ") && safeEq(Buffer.from(h.slice(6), "base64").toString("utf8").split(":").slice(1).join(":"), pw);
    if (!ok) { res.statusCode = 401; res.setHeader("WWW-Authenticate", 'Basic realm="DSP Panel admin"'); res.end("Unauthorized"); }
    return ok;
  }
}

module.exports = { Auth };
