#!/usr/bin/env node
/* Build (and optionally deploy) the panel for Crestron x70 touch panels.
     node tools/build-panel.js [--bridge http://<bridge-ip>:3000] [--panel <screen-id>] [--deploy <ip>[,<ip>…]] [--user admin]

   The same thing /admin → "Publiser til alle skjermer" does, from the command line.
   1. fetches the generated js/config.js from the running bridge (--panel: that screen's
      zones/views as set up under "Skjermer" in /admin)
   2. sets transport to the bridge's WebSocket (panels can't use "auto")
   3. runs  ch5-cli archive  → dist/dsp-panel.ch5z
   4. with --deploy: runs  ch5-cli deploy  to each panel (asks for the panel password)
   Needs: npx @crestron/ch5-utilities-cli (fetched automatically on first use). */
"use strict";
const fs = require("fs"), path = require("path"), http = require("http"), { execSync } = require("child_process");

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const bridge = (opt("--bridge", "http://localhost:3000")).replace(/\/$/, "");
const deploy = opt("--deploy", "");
const user   = opt("--user", "admin");
const panel  = opt("--panel", "");
const root   = path.resolve(__dirname, "..", "..");
const name   = "dsp-panel";

function get(url) {
  return new Promise((res, rej) => http.get(url, r => { let b = ""; r.on("data", c => b += c); r.on("end", () => r.statusCode === 200 ? res(b) : rej(new Error(`${url} → ${r.statusCode}`))); }).on("error", rej));
}

(async () => {
  // 1 + 2: config with the bridge's LAN address for the WebSocket
  const host = new URL(bridge).hostname;
  if (/^(localhost|127\.)/.test(host)) console.warn("! --bridge is localhost; the panels need the bridge's LAN IP (e.g. --bridge http://192.168.1.50:3000)");
  let cfg = await get(bridge + "/api/export/config.js" + (panel ? "?panel=" + encodeURIComponent(panel) : ""));
  const wsUrl = bridge.replace(/^http/, "ws") + "/ws";
  cfg = cfg.replace(/"transport":\s*\{[^}]*\}/, `"transport": { "mode": "bridge", "url": "${wsUrl}" }`);
  fs.writeFileSync(path.join(root, "js", "config.js"), cfg);
  console.log(`✓ js/config.js generated from ${bridge}, WebSocket ${wsUrl}`);

  // 3: archive – from a staging copy of just the panel files (ch5-cli copies the source dir into
  //    <out>/temp, so archiving the project root with dist/ and bridge/node_modules inside it is a bad idea)
  const stage = path.join(root, "dist", "src");
  fs.rmSync(stage, { recursive: true, force: true }); fs.mkdirSync(stage, { recursive: true });
  for (const e of ["index.html", "css", "js", "assets"]) if (fs.existsSync(path.join(root, e))) fs.cpSync(path.join(root, e), path.join(stage, e), { recursive: true });
  execSync(`npx --yes @crestron/ch5-utilities-cli archive -p ${name} -d dist/src -o dist`, { cwd: root, stdio: "inherit" });
  console.log(`✓ dist/${name}.ch5z`);

  // 4: deploy
  for (const ip of deploy.split(",").map(s => s.trim()).filter(Boolean)) {
    console.log(`→ deploying to ${ip} …`);
    // -p here means "prompt for credentials" (interactive); user/password can also come from CH5CLI_DEPLOY_USER / CH5CLI_DEPLOY_PW
    execSync(`npx --yes @crestron/ch5-utilities-cli deploy -H ${ip} -t touchscreen -p dist/${name}.ch5z`, { cwd: root, stdio: "inherit", env: Object.assign({ CH5CLI_DEPLOY_USER: user }, process.env) });
    console.log(`✓ ${ip}`);
  }
  if (!deploy) console.log("Deploy with:  node tools/build-panel.js --bridge " + bridge + " --deploy <tsw-1070-ip>,<ts-770-ip>");
})().catch(e => { console.error("✗", e.message); process.exit(1); });
