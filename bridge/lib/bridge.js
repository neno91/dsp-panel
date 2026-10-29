"use strict";
/* ------------------------------------------------------------------
   createBridge – wires the modules into one running bridge
   ------------------------------------------------------------------
   Used by server.js and by the tests (which boot it on a random port
   with a temporary site.json and the emulated DMP).
   ------------------------------------------------------------------ */
const path = require("path");
const { SiteStore } = require("./site");
const { DspLink } = require("./dsp");
const { Controller } = require("./control");
const { Auth } = require("./auth");
const { Publisher } = require("./publish");
const { createHttpServer } = require("./http");
const { attachWebSocket } = require("./ws");
const { log } = require("./util");

/* opts: { sitePath, rootDir, dataDir, buildDir, env, port, host, debug } → { store, dsp, ctrl, auth, publisher, server, ws, listen(), close() } */
function createBridge(opts) {
  const env = opts.env || process.env;
  const bridgeDir = path.dirname(opts.sitePath);
  const store = new SiteStore(opts.sitePath, { dataDir: opts.dataDir || path.join(bridgeDir, "data"), defaultPath: opts.defaultPath, env });
  if (opts.port != null) store.listenPort = opts.port;
  if (opts.host) store.listenHost = opts.host;
  if (store.security().requireToken && !(store.site.admin || {}).password) log("WARNING: tokens are required but /admin has no password – set one in /admin → Site and panel");
  if (!store.security().requireToken) log("WARNING: security.requireToken is off – anyone on the network can open the panel");

  const dsp = new DspLink({ conn: () => store.conn(), timing: () => store.site.dsp, debug: !!(opts.debug != null ? opts.debug : env.DSP_DEBUG) });
  const ctrl = new Controller(store, dsp);
  dsp.session = { verbose: ctrl.M.sis.verbose, keepAlive: ctrl.M.sis.keepAlive };
  const auth = new Auth(store);
  const publisher = new Publisher(store, opts.rootDir, { buildDir: opts.buildDir || env.BUILD_DIR, binDir: opts.binDir });

  const ctx = { store, auth, ctrl, dsp, publisher, root: opts.rootDir, adminDir: path.join(__dirname, "..", "admin"), clientCount: () => 0 };
  const server = createHttpServer(ctx);
  const ws = attachWebSocket(server, ctx);
  ctx.clientCount = ws.clientCount;

  return {
    store, dsp, ctrl, auth, publisher, server, ws,
    listen: () => new Promise(resolve => server.listen(store.listenPort, store.listenHost, () => {
      log(`bridge listening on http://${store.listenHost}:${server.address().port}  (panel · /admin · /ws)`);
      dsp.connect(); resolve(server.address().port);
    })),
    close: () => new Promise(resolve => { clearTimeout(dsp.timers.reconnect); if (dsp.sock) dsp.sock.destroy(); dsp.down = () => {}; for (const c of ws.wss.clients) c.terminate(); server.close(() => resolve()); }),
  };
}

module.exports = { createBridge };
