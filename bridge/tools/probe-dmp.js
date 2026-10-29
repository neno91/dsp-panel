#!/usr/bin/env node
/* Connection probe for the Extron DMP 128: opens one SIS session, sends one
   harmless view command every few seconds and logs everything with timestamps,
   so we can see exactly when and how the link dies.
     node tools/probe-dmp.js [host=172.16.76.11] [port=23] [intervalSec=5] [minutes=15]  */
"use strict";
const net = require("net");
const [host = "172.16.76.11", port = "23", interval = "5", minutes = "15"] = process.argv.slice(2);
const t0 = Date.now();
const ts = () => `[+${((Date.now() - t0) / 1000).toFixed(1).padStart(7)} s]`;
const cmds = ["\x1BCV\r", "\x1BG60000AU\r", "\x1BM20000AU\r", "\x1B1CV\r"];   // view verbose, output 1 gain, mixpoint 1→1, verbose query
let n = 0, lastRx = Date.now(), timer = null;

console.log(`${ts()} connecting to ${host}:${port}, one command every ${interval} s for ${minutes} min`);
const s = net.createConnection({ host, port: Number(port) });
s.setKeepAlive(true, 10000);
s.on("connect", () => {
  console.log(`${ts()} TCP connected`);
  setTimeout(() => { s.write("\x1B3CV\r"); console.log(`${ts()} tx verbose 3`); }, 1500);
  timer = setInterval(() => {
    const c = cmds[n++ % cmds.length];
    s.write(c); console.log(`${ts()} tx ${JSON.stringify(c)}  (${Math.round((Date.now() - lastRx) / 1000)} s since last rx)`);
  }, Number(interval) * 1000);
});
s.on("data", d => { lastRx = Date.now(); console.log(`${ts()} rx ${JSON.stringify(d.toString("latin1"))}`); });
s.on("error", e => console.log(`${ts()} ERROR ${e.code || ""} ${e.message}`));
s.on("close", hadErr => { console.log(`${ts()} CLOSED (hadError=${hadErr}) after ${n} commands`); clearInterval(timer); process.exit(0); });
setTimeout(() => { console.log(`${ts()} done – link stayed up for ${minutes} min`); s.end(); }, Number(minutes) * 60000);
