#!/usr/bin/env node
/* Minimal Extron DMP 128 SIS emulator for testing the bridge without the
   real DSP. Implements only what the bridge uses: verbose mode, mixpoint
   mute (M2iioo), input mute (M401ii), group set/view (Dg*vGRPM / DgGRPM),
   optional password prompt. Reports changes in verbose-3 style.
   Usage: node fake-dmp.js [port=2323] [password]                       */
"use strict";
const net = require("net");

/* start(port, password, { drift }) → { server, close(), state } – also used by the tests */
function start(port, password = "", opts = {}) {
  const PASSWORD = password;
  const mix = new Map();      // "iioo" -> 0/1 (0 = unmuted)
  const inMute = new Map();   // "ii" -> 0/1
  const groups = new Map();   // "g" -> value
  const gain = new Map();     // 5-digit OID -> tenths dB + 2048 (block gain)
  const mute = new Map();     // 5-digit OID -> 0/1 (block mute: 400xx, 401xx, 600xx)
  for (let i = 0; i < 12; i++) { gain.set("400" + String(i).padStart(2, "0"), 2048 + 200); gain.set("401" + String(i).padStart(2, "0"), 2048 - 60 - i * 20); mute.set("400" + String(i).padStart(2, "0"), i < 8 ? 0 : 1); mute.set("401" + String(i).padStart(2, "0"), 0); }
  for (let o = 0; o < 8; o++) { gain.set("600" + String(o).padStart(2, "0"), 2048 - 400 - o * 50); mute.set("600" + String(o).padStart(2, "0"), o % 2); }
  for (let i = 0; i < 10; i++) { for (const blk of ["0", "1"]) inMute.set(blk + String(i).padStart(2, "0"), i < 8 ? 0 : 1); for (let o = 0; o < 5; o++) mix.set(`${String(i).padStart(2,"0")}${String(o).padStart(2,"0")}`, 1); }
  mix.set("0400", 0); mix.set("0701", 0); mix.set("0002", 0); mix.set("0102", 0); mix.set("0503", 0); mix.set("0004", 0); mix.set("0904", 0);
  for (let g = 1; g <= 10; g++) groups.set(String(g), -120 + g * 10);   // tenths dB
  for (let g = 21; g <= 25; g++) groups.set(String(g), -300 - g * 5);
  for (let g = 26; g <= 30; g++) groups.set(String(g), g % 2);           // mute groups 0/1

  const clients = new Set();
  const fmt = v => (v < 0 ? "-" : "+") + String(Math.abs(v)).padStart(5, "0");   // real DMP format: +00000 / -00450
  const tell = (sock, s) => sock.write(s + "\r\n");
  const all = s => clients.forEach(c => tell(c, s));

  const server = net.createServer(sock => {
    clients.add(sock);
    sock.write("(c) Copyright 2019, Extron Electronics, DMP 128, V1.17, 60-1179-01\r\n" + new Date().toUTCString() + "\r\n");
    let authed = !PASSWORD, buf = "";
    if (!authed) sock.write("Password:");
    sock.on("data", d => {
      buf += d.toString("latin1");
      let i;
      while ((i = buf.indexOf("\r")) >= 0) {
        let cmd = buf.slice(0, i); buf = buf.slice(i + 1).replace(/^\n/, "");
        if (!authed) { if (cmd === PASSWORD) { authed = true; tell(sock, "Login Administrator"); } else sock.write("Password:"); continue; }
        cmd = cmd.replace(/^\x1B/, "").replace(/^W/, "");
        let m;
        if (cmd === "3CV" || cmd === "CV") tell(sock, "Vrb3");
        else if ((m = /^M2(\d\d)(\d\d)\*(\d)AU$/.exec(cmd))) { mix.set(m[1] + m[2], +m[3]); all(`DsM2${m[1]}${m[2]}*${m[3]}`); }
        else if ((m = /^M2(\d\d)(\d\d)AU$/.exec(cmd))) tell(sock, `DsM2${m[1]}${m[2]}*${mix.get(m[1] + m[2]) ?? 1}`);
        else if ((m = /^G(\d{5})\*(\d+)AU$/.exec(cmd))) { gain.set(m[1], +m[2]); all(`DsG${m[1]}*${m[2]}`); }
        else if ((m = /^G(\d{5})AU$/.exec(cmd))) tell(sock, `DsG${m[1]}*${gain.get(m[1]) ?? 2048}`);
        else if ((m = /^M([46]\d{4})\*(\d)AU$/.exec(cmd))) { mute.set(m[1], +m[2]); all(`DsM${m[1]}*${m[2]}`); }
        else if ((m = /^M([46]\d{4})AU$/.exec(cmd))) tell(sock, `DsM${m[1]}*${mute.get(m[1]) ?? 1}`);
        else if ((m = /^D(\d+)\*(-?\d+)GRPM$/.exec(cmd))) { groups.set(m[1], +m[2]); all(`GrpmD${m[1]}*${fmt(+m[2])}`); }
        else if ((m = /^D(\d+)GRPM$/.exec(cmd))) tell(sock, `GrpmD${m[1]}*${fmt(groups.get(m[1]) ?? 0)}`);
        else tell(sock, "E13");
      }
    });
    sock.on("close", () => clients.delete(sock));
    sock.on("error", () => clients.delete(sock));
  });
  server.listen(port, () => console.log(`fake DMP 128 listening on ${port}${PASSWORD ? " (password set)" : ""}`));
  // simulate an external change every 15 s (someone in DSP Configurator)
  const drift = opts.drift === false ? null : setInterval(() => { const v = -200 - Math.round(Math.random() * 300); groups.set("22", v); all(`GrpmD22*${fmt(v)}`); }, 15000);
  return { server, state: { mix, inMute, groups, gain, mute }, close: () => { clearInterval(drift); for (const c of clients) c.destroy(); server.close(); } };
}

if (require.main === module) start(Number(process.argv[2] || 2323), process.argv[3] || "");
module.exports = { start };
