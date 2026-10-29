#!/usr/bin/env node
/* ------------------------------------------------------------------
   DSP Panel – bridge
   ------------------------------------------------------------------
   Talks SIS (telnet) to an Extron DMP and exposes the panel's join
   model over a WebSocket; serves the panel and /admin; publishes the
   panel to Crestron touch screens. The DSP is the single source of
   truth: every lit state and fader position comes from DMP responses.

     lib/bridge.js    createBridge – wires everything below
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
const { createBridge } = require("./lib/bridge");

createBridge({ sitePath: process.argv[2] || path.join(__dirname, "site.json"), rootDir: path.resolve(__dirname, "..") }).listen();
