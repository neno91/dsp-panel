"use strict";
/* ------------------------------------------------------------------
   Join model
   ------------------------------------------------------------------
   The panel talks "joins": numbered digital (on/off) and analog (0–65535)
   signals. This module derives, from site.json, which join means what and
   which DSP object (OID) or DMP group it controls:
     source with input n  →  mixer joins D/A(20+n), route join base+n−1,
                             OIDs 401(n−1) level, 400(n−1) mute
     zone with output o   →  joins D/A(30+o), route base 100+(o−1)*10,
                             OID 600(o−1)
   Control mode "groups" uses DMP groups instead (advanced.groupsFallback).
   It also generates the panel's config.js from the same document.
   ------------------------------------------------------------------ */
const { pad2, log } = require("./util");
const { VIEWS } = require("./site");

/* Derived join conventions, shared by bridge and panel. */
const srcJoin   = src => 20 + src.input;                 // mixer mute (D) and level (A)
const srcOffset = src => src.input - 1;                  // offset inside a zone's route block
const zoneJoin  = z   => 30 + z.output;                  // zone mute (D) and level (A)
const routeBase = z   => 100 + (z.output - 1) * 10;      // first route join of the zone

const DEFAULT_SIS = { verbose: "3CV", keepAlive: "CV", gainSet: "G{oid}*{v}AU", gainView: "G{oid}AU", muteSet: "M{oid}*{v}AU", muteView: "M{oid}AU", groupSet: "D{g}*{v}GRPM", groupView: "D{g}GRPM" };

/* Build the lookup tables for a site document. */
function buildModel(s) {
  const ctrl = Object.assign({ mode: "direct", inputLevelBlock: "401", inputMuteBlock: "400", zoneBlock: "600" }, s.control || {});
  const direct = ctrl.mode === "direct";
  const gf = Object.assign({ inputGainBase: 0, inputMuteBase: 10, zoneGainBase: 20, zoneMuteBase: 25 }, (s.advanced || {}).groupsFallback || {});
  const lv = s.levels;
  const digital = new Map(), analog = new Map();
  const viewJoins = VIEWS.map(v => v.join);
  // exclusive source groups ("only one of Music 1–3 per zone"): the route target carries the group id
  const exclGroups = (s.sourceGroups || []).filter(g => g.mode === "exclusive");
  const exclusiveOf = x => { if (x.exclusive) return "legacy"; const g = exclGroups.find(g => (g.sources || []).includes(x.id)); return g ? g.id : null; };
  viewJoins.forEach(j => digital.set(j, { kind: "view" }));

  for (const x of s.sources) {
    const i = x.input - 1, j = srcJoin(x);
    const levelOid = x.levelOid || ctrl.inputLevelBlock + pad2(i), muteOid = x.muteOid || ctrl.inputMuteBlock + pad2(i);
    const gainGroup = x.gainGroup != null ? x.gainGroup : gf.inputGainBase + x.input;
    const muteGroup = x.muteGroup != null ? x.muteGroup : gf.inputMuteBase + x.input;
    digital.set(j, direct ? { kind: "mute", oid: muteOid } : { kind: "mute", group: muteGroup });
    analog.set(j,  direct ? { kind: "gain", oid: levelOid, min: lv.input.min, max: lv.input.max } : { kind: "gain", group: gainGroup, min: lv.input.min, max: lv.input.max });
  }
  for (const z of s.zones) {
    const o = z.output - 1, j = zoneJoin(z);
    const oid = z.levelOid || ctrl.zoneBlock + pad2(o);
    const gainGroup = z.gainGroup != null ? z.gainGroup : gf.zoneGainBase + z.output;
    const muteGroup = z.muteGroup != null ? z.muteGroup : gf.zoneMuteBase + z.output;
    digital.set(j, direct ? { kind: "mute", oid: z.muteOid || oid } : { kind: "mute", group: muteGroup });
    analog.set(j,  direct ? { kind: "gain", oid, min: lv.zone.min, max: lv.zone.max } : { kind: "gain", group: gainGroup, min: lv.zone.min, max: lv.zone.max });
    for (const x of s.sources)
      digital.set(routeBase(z) + srcOffset(x), { kind: "route", oid: "2" + pad2(x.input - 1) + pad2(o), exclusive: exclusiveOf(x), zone: z, source: x });
  }
  const muteOidJoin = new Map(), gainOidJoin = new Map(), muteGroupJoin = new Map(), gainGroupJoin = new Map();
  for (const [j, t] of digital) { if (t.oid != null) muteOidJoin.set(t.oid, j); if (t.group != null) muteGroupJoin.set(String(t.group), j); }
  for (const [j, t] of analog)  { if (t.oid != null) gainOidJoin.set(t.oid, { join: j, min: t.min, max: t.max }); if (t.group != null) gainGroupJoin.set(String(t.group), { join: j, min: t.min, max: t.max }); }
  const sc = Object.assign({ analogMax: 65535, groupDbScale: 10, gainOffset: 2048 }, (s.advanced || {}).scaling || {});
  const sis = Object.assign({}, DEFAULT_SIS, (s.advanced || {}).sis || {});
  log(`model: ${s.sources.length} sources, ${s.zones.length} zones, mode ${ctrl.mode}` + (direct ? ` (level ${ctrl.inputLevelBlock}xx · mute ${ctrl.inputMuteBlock}xx · zone ${ctrl.zoneBlock}xx)` : " (DMP groups)"));
  const m = { ctrl, direct, digital, analog, viewJoins, muteOidJoin, gainOidJoin, muteGroupJoin, gainGroupJoin, sc, sis };
  m.dbToAnalog = (db, min, max) => Math.round(Math.max(0, Math.min(1, (db - min) / (max - min))) * sc.analogMax);
  m.analogToDb = (a, min, max) => min + (Math.max(0, Math.min(sc.analogMax, a)) / sc.analogMax) * (max - min);
  return m;
}

/* Join/OID table for the admin page (read-only reference). */
function joinTable(s, M) {
  const rows = [];
  for (const x of s.sources) { const t = M.digital.get(srcJoin(x)), a = M.analog.get(srcJoin(x)); rows.push({ kind: "Input", name: x.name, input: x.input, joins: `D/A ${srcJoin(x)}`, control: t.oid != null ? `mute ${t.oid} · level ${a.oid}` : `mute grp ${t.group} · gain grp ${a.group}` }); }
  for (const z of s.zones) { const t = M.digital.get(zoneJoin(z)), a = M.analog.get(zoneJoin(z)); rows.push({ kind: "Zone", name: z.name, output: z.output, joins: `D/A ${zoneJoin(z)} · routing D${routeBase(z)}–${routeBase(z) + 9}`, control: t.oid != null ? `output ${a.oid}` : `mute grp ${t.group} · gain grp ${a.group}` }); }
  return rows;
}

/* The panel's config.js, generated from site.json (served at /js/config.js).
   With a screen (site.panels entry) the config is cut down to that screen's zones
   and views, and transport is pinned to this bridge's WebSocket – that is what gets
   built into the .ch5z for the TSW/TS panels. `opts`: { theme, publicUrl, requireToken }. */
function panelConfigJs(s, panel, pinTransport, opts) {
  const zoneOk = z => !panel || panel.zones === "*" || !Array.isArray(panel.zones) || panel.zones.includes(z.id);
  const zones = s.zones.filter(zoneOk);
  const zoneIds = new Set(zones.map(z => z.id));
  const views = panel && Array.isArray(panel.views) && panel.views.length ? VIEWS.filter(v => panel.views.includes(v.id)) : VIEWS;
  const groups = (s.groups || [])
    .map(g => g.zones === "*" ? g : Object.assign({}, g, { zones: g.zones.filter(id => zoneIds.has(id)) }))
    .filter(g => g.zones === "*" || g.zones.length > 1);                 // a group of one zone is just the zone
  const cfg = {
    site: s.site,
    panel: panel ? { id: panel.id, name: panel.name } : undefined,
    views,
    sources: s.sources.map(x => ({ id: x.id, input: x.input, name: x.name, short: x.short || undefined, icon: x.icon || "music", group: x.group || undefined, hint: x.hint || undefined, joinOffset: srcOffset(x) })),
    levels: s.levels,
    zones: zones.map(z => ({ id: z.id, name: z.name, icon: z.icon || "speaker", select: zoneJoin(z), volume: zoneJoin(z), sourceJoinBase: routeBase(z), hint: z.hint || undefined })),
    groups,
    sourceGroups: s.sourceGroups || [],
    theme: opts.theme,
    mixer: s.sources.map(x => ({ source: x.id, button: srcJoin(x), level: srcJoin(x) })),
    transport: pinTransport ? { mode: "bridge", url: opts.publicUrl.replace(/^http/, "ws") + "/ws" + (opts.requireToken && panel && panel.token ? "?token=" + encodeURIComponent(panel.token) : "") } : { mode: "auto", url: "" },   // pinned only in the .ch5z; a browser connects to whoever served it
    ui: Object.assign({ volumeStepPercent: 5, clock24h: true, lang: "en" }, s.ui || {}, { analogMax: (s.advanced && s.advanced.scaling && s.advanced.scaling.analogMax) || 65535 }, panel && panel.scale ? { scale: Number(panel.scale) } : {}, panel && panel.lang ? { lang: panel.lang } : {}),
  };
  return `/* Generated by the DSP bridge from bridge/site.json – edit via /admin, do not edit by hand. ${new Date().toISOString()}${panel ? ` – screen "${panel.name}"` : ""} */\nwindow.PANEL_CONFIG = ${JSON.stringify(cfg, null, 2)};\n`;
}

module.exports = { buildModel, joinTable, panelConfigJs, srcJoin, srcOffset, zoneJoin, routeBase };
