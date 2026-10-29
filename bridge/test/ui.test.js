"use strict";
/* Panel + admin in a real browser (Playwright/Chromium). Skipped when playwright is not installed:
   npm i -D playwright && npx playwright install chromium */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startBridge, waitFor, sleep, get } = require("./helpers");

let chromium = null; try { ({ chromium } = require("playwright")); } catch (_) {}
const skip = chromium ? false : "playwright not installed";

let b, browser;
before(async () => { if (skip) return; b = await startBridge(); await waitFor(() => b.ctrl.state.b.size > 40, 6000, "state"); browser = await chromium.launch(); });
after(async () => { if (browser) await browser.close(); if (b) await b.stop(); });

const open = async (opts = {}, path = "") => {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 800 }, hasTouch: true }, opts));
  const p = await ctx.newPage(); await p.goto(`${b.url}/${path}${path.includes("?") ? "&" : "?"}token=${b.token}`);
  await p.waitForSelector("body.is-ready"); await sleep(150); return p;
};
const zone = (p, i) => p.locator(".zone").nth(i);
const src = (p, i, name) => zone(p, i).locator(`.source-btn:not(.source-group-btn)[title="${name}"]`);
const active = loc => loc.evaluate(n => n.classList.contains("is-active"));
const setSrc = async (p, i, name, want) => { const e = src(p, i, name); if ((await active(e)) !== want) { await e.tap(); await waitFor(async () => (await active(e)) === want, 2000, name + " → " + want); } };

test("tap toggles a source, a sideways swipe over it does not", { skip }, async () => {
  const p = await open();
  await setSrc(p, 0, "Radio", false);
  await src(p, 0, "Radio").tap(); await waitFor(async () => active(src(p, 0, "Radio")), 2000, "radio on");
  const bb = await src(p, 0, "Radio").boundingBox();
  await p.mouse.move(bb.x + 10, bb.y + bb.height / 2); await p.mouse.down(); await p.mouse.move(bb.x + 60, bb.y + bb.height / 2, { steps: 5 }); await p.mouse.up();
  await sleep(300); assert.equal(await active(src(p, 0, "Radio")), true, "swipe left the source untouched");
  await p.context().close();
});

test("exclusive source group in the UI: Music 2 replaces Music 1, Radio stays", { skip }, async () => {
  const p = await open();
  await setSrc(p, 1, "Music 1", true); await setSrc(p, 1, "Radio", true);
  await setSrc(p, 1, "Music 2", true);
  await waitFor(async () => !(await active(src(p, 1, "Music 1"))), 2000, "music 1 off");
  assert.equal(await active(src(p, 1, "Radio")), true);
  await p.context().close();
});

test("zone fader: drag sets the level and the readout follows the DSP", { skip }, async () => {
  const p = await open();
  const f = zone(p, 0).locator(".fader-horizontal"); const bb = await f.boundingBox();
  await p.mouse.move(bb.x + bb.width * 0.2, bb.y + bb.height / 2); await p.mouse.down(); await p.mouse.move(bb.x + bb.width * 0.9, bb.y + bb.height / 2, { steps: 12 }); await p.mouse.up();
  await waitFor(() => b.ctrl.state.n.get(31) > 0.85 * 65535, 3000, "zone 1 ≥ 85 %");
  await sleep(700);   // hold-until-settled window
  const pct = await f.getAttribute("aria-valuenow"); assert.ok(Number(pct) >= 85, "readout " + pct);
  await p.context().close();
});

test("per-screen config: zones, scale and layout attributes from site.json", { skip }, async () => {
  const p = await open();
  assert.equal(await p.locator(".zone").count(), 4);
  assert.equal(await p.evaluate(() => document.body.dataset.zones), "scroll");
  assert.equal(await p.evaluate(() => document.body.dataset.srcCols), "2");
  await p.context().close();
  const ts = b.store.site.panels.find(x => x.id === "ts770");
  const q = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const p2 = await q.newPage();
  await p2.goto(`${b.url}/?token=${ts.token}`); await p2.waitForSelector("body.is-ready");
  assert.equal(await p2.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--s").trim()), "1.3");
  assert.ok(await p2.locator("#view-nav").isHidden(), "ts770 shows zones only → no view nav");
  await q.close();
});

test("language: en default, nb per screen", { skip }, async () => {
  const p = await open();
  assert.equal(await p.evaluate(() => document.documentElement.lang), "en");
  assert.match(await p.locator(".zone").first().locator(".zone-status").textContent(), /Muted|Sound on/);
  await p.context().close();
  const site = JSON.parse(JSON.stringify(b.store.site)); site.panels[0].lang = "nb"; site.admin.password = "test"; b.store.apply(site);
  const p2 = await open();
  assert.equal(await p2.evaluate(() => document.documentElement.lang), "nb");
  assert.match(await p2.locator(".zone").first().locator(".zone-status").textContent(), /Dempet|Lyd på/);
  await p2.context().close();
  site.panels[0].lang = "en"; b.store.apply(site);
});

test("theme: colours from site.json and live preview via postMessage", { skip }, async () => {
  const p = await open();
  await p.evaluate(() => window.postMessage({ t: "theme", theme: { colors: { accent: "#ff0000" } } }, location.origin));
  await sleep(100);
  assert.equal(await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--teal-rgb").trim()), "255,0,0");
  await p.context().close();
});

test("admin: loads, lists screens, switches language", { skip }, async () => {
  const ctx = await browser.newContext({ httpCredentials: { username: "admin", password: "test" } }); const p = await ctx.newPage();
  await p.goto(b.url + "/admin"); await p.waitForSelector(".screen"); await sleep(300);
  assert.equal(await p.locator(".screen").count(), 3);
  assert.match(await p.locator("h1").first().textContent(), /DSP Panel/);
  assert.match(await p.locator(".powered").textContent(), /Jørgen Skar – Løvold System/);
  await p.selectOption("#admin-lang", "nb"); await p.waitForLoadState("load"); await p.waitForSelector(".screen");
  assert.match(await p.locator("body").textContent(), /Skjermer/);
  await ctx.close();
});

test("panel without a token gets the bilingual 401 page", { skip }, async () => {
  const r = await get(b.url + "/"); assert.equal(r.status, 401); assert.match(r.text, /access key/);
});
