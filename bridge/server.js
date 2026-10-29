#!/usr/bin/env node
/* ------------------------------------------------------------------
   DSP Panel – bridge
   ------------------------------------------------------------------
   Talks SIS (telnet) to an Extron DMP and exposes the panel's join
   model over a WebSocket; serves the panel and /admin; publishes the
   panel to Crestron touch screens. The DSP is the single source of
   truth: every lit state and fader position comes from DMP responses.

     lib/site.js      site.json: load, validate, apply, tokens, theme
     lib/model.js     joins ⇄ DSP objects, generated panel config
     lib/dsp.js       DspLink – paced SIS session over TCP
     lib/control.js   Controller – join state, actions, DMP replies
     lib/auth.js      screen tokens, admin password
     lib/publish.js   .ch5z build + ch5-cli deploy
     lib/http.js      routes, static files
     lib/ws.js        WebSocket to the panels

   Usage:  node server.js [site.json]
   Env:    PORT, DSP_HOST, DSP_PORT, DSP_PASSWORD override site.json (never written back);
           DSP_DEBUG=1 logs all DSP traffic; BUILD_DIR where .ch5z builds are staged.
   ------------------------------------------------------------------ */
"use strict";
const path = require("path");
const { SiteStore } = require("./lib/site");
const { DspLink } = require("./lib/dsp");
const { Controller } = require("./lib/control");
const { Auth } = require("./lib/auth");
const { Publisher } = require("./lib/publish");
const { createHttpServer } = require("./lib/http");
const { attachWebSocket } = require("./lib/ws");
const { log } = require("./lib/util");

const ROOT = path.resolve(__dirname, "..");
const store = new SiteStore(process.argv[2] || path.join(__dirname, "site.json"), { dataDir: path.join(__dirname, "data") });
if (store.security().requireToken && !(store.site.admin || {}).password) log("WARNING: tokens are required but /admin has no password – set one in /admin → Site and panel");
if (!store.security().requireToken) log("WARNING: security.requireToken is off – anyone on the network can open the panel");

const dsp = new DspLink({ conn: () => store.conn(), timing: () => store.site.dsp, debug: !!process.env.DSP_DEBUG });
const ctrl = new Controller(store, dsp);
dsp.session = { verbose: ctrl.M.sis.verbose, keepAlive: ctrl.M.sis.keepAlive };
const auth = new Auth(store);
const publisher = new Publisher(store, ROOT, { buildDir: process.env.BUILD_DIR });

const ctx = { store, auth, ctrl, dsp, publisher, root: ROOT, adminDir: path.join(__dirname, "admin"), clientCount: () => 0 };
const server = createHttpServer(ctx);
const ws = attachWebSocket(server, ctx);
ctx.clientCount = ws.clientCount;

server.listen(store.listenPort, store.listenHost, () => {
  log(`bridge listening on http://${store.listenHost}:${store.listenPort}  (panel · /admin · /ws)`);
  dsp.connect();
});
