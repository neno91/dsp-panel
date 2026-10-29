"use strict";
/* Small shared helpers. */
const crypto = require("crypto");

const log  = (...a) => console.log(new Date().toISOString(), ...a);
const pad2 = n => String(n).padStart(2, "0");
const tpl  = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k]);
/* constant-time string compare (passwords, tokens) */
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const newToken = () => crypto.randomUUID();
const clone = o => JSON.parse(JSON.stringify(o));

module.exports = { log, pad2, tpl, safeEq, newToken, clone };
