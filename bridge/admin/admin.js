/* DSP Panel – admin page logic (loads after the markup; texts via i18n-nb.js) */
(function () {
  "use strict";
  /* ---------- admin language: English is the source text; NB translates it. Stored per browser. ---------- */
  const NB = window.ADMIN_I18N.nb;
  const LS_LANG = "dsp-panel.admin.lang";
  let adminLang = "en"; try { adminLang = localStorage.getItem(LS_LANG) || "en"; } catch (_) {}
  if (adminLang !== "nb") adminLang = "en";
  const T = (s, ...args) => { let out = adminLang === "nb" && NB[s] != null ? NB[s] : s; args.forEach(a => { out = out.replace("%s", String(a)); }); return out; };
  if (adminLang === "nb") {
    document.documentElement.lang = "nb";
    document.querySelectorAll("[data-t]").forEach(n => { const k = n.innerHTML.trim(); if (NB[k] != null) n.innerHTML = NB[k]; });
    document.querySelectorAll("[data-t-title]").forEach(n => { const k = n.getAttribute("title"); if (NB[k] != null) n.setAttribute("title", NB[k]); });
  }
  document.querySelector("#admin-lang").value = adminLang;
  document.querySelector("#admin-lang").onchange = e => { try { localStorage.setItem(LS_LANG, e.target.value); } catch (_) {} location.reload(); };

  const ICONS = ["mic", "music", "radio", "screen", "xlr", "speaker", "restaurant", "reception", "meeting", "office", "send", "home", "group"];
  const $ = s => document.querySelector(s);
  let site = null;

  const slug = s => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ø/g, "o").replace(/æ/g, "ae").replace(/å/g, "a").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "x";
  const uniq = (base, taken) => { let id = base, n = 2; while (taken.has(id)) id = base + n++; return id; };

  function iconSelect(value) {
    const sel = document.createElement("select");
    ICONS.forEach(i => { const o = document.createElement("option"); o.value = i; o.textContent = i; if (i === value) o.selected = true; sel.append(o); });
    return sel;
  }
  function cell(child, cls) { const td = document.createElement("td"); if (cls) td.className = cls; td.append(child); return td; }
  function text(value, attrs = {}) { const i = document.createElement("input"); i.value = value == null ? "" : value; Object.assign(i, attrs); return i; }
  function btn(props) { return Object.assign(document.createElement("button"), Object.assign({ type: "button" }, props)); }
  function tools(list, idx, rerender) {
    const d = document.createElement("div"); d.className = "tools";
    const up = btn({ className: "icon", textContent: "↑", title: T("Move up"), disabled: idx === 0 });
    const dn = btn({ className: "icon", textContent: "↓", title: T("Move down"), disabled: idx === list.length - 1 });
    const rm = btn({ className: "icon danger", textContent: "✕", title: T("Remove") });
    up.onclick = () => { [list[idx - 1], list[idx]] = [list[idx], list[idx - 1]]; rerender(); };
    dn.onclick = () => { [list[idx + 1], list[idx]] = [list[idx], list[idx + 1]]; rerender(); };
    rm.onclick = () => { list.splice(idx, 1); rerender(); };
    d.append(up, dn, rm); return d;
  }
  function checkRow() { const box = document.createElement("div"); box.className = "checks"; return box; }
  function check(box, label, checked, disabled, onchange) { const l = document.createElement("label"); const cb = Object.assign(document.createElement("input"), { type: "checkbox", checked, disabled }); cb.onchange = () => onchange(cb.checked); l.append(cb, label); box.append(l); return cb; }

  function renderSources() {
    const tb = $("#sources tbody"); tb.replaceChildren();
    site.sources.forEach((s, i) => {
      const tr = document.createElement("tr");
      const name = text(s.name); name.oninput = () => { s.name = name.value; };
      const short = text(s.short || "", { placeholder: T("for tiles, e.g. Mic 1"), maxLength: 14 }); short.oninput = () => { s.short = short.value; };
      const inp = text(s.input, { type: "number", min: 1, max: 99 }); inp.oninput = () => { s.input = Number(inp.value); };
      const icon = iconSelect(s.icon || "music"); icon.onchange = () => { s.icon = icon.value; };
      const grp = text(s.group || "", { placeholder: T("e.g. Equipment") }); grp.oninput = () => { s.group = grp.value; };
      const id = text(s.id); id.className = "ref"; id.oninput = () => { s.id = id.value; };
      tr.append(cell(name), cell(short), cell(inp, "num"), cell(icon), cell(grp), cell(id), cell(tools(site.sources, i, () => { renderSources(); renderSourceGroups(); })));
      tb.append(tr);
    });
  }
  function renderZones() {
    const tb = $("#zones tbody"); tb.replaceChildren();
    site.zones.forEach((z, i) => {
      const tr = document.createElement("tr");
      const name = text(z.name); name.oninput = () => { z.name = name.value; };
      const out = text(z.output, { type: "number", min: 1, max: 99 }); out.oninput = () => { z.output = Number(out.value); };
      const icon = iconSelect(z.icon || "speaker"); icon.onchange = () => { z.icon = icon.value; };
      const hint = text(z.hint || ""); hint.oninput = () => { z.hint = hint.value; };
      const id = text(z.id); id.className = "ref"; id.oninput = () => { z.id = id.value; renderGroups(); renderPanels(); };
      tr.append(cell(name), cell(out, "num"), cell(icon), cell(hint), cell(id), cell(tools(site.zones, i, () => { renderZones(); renderGroups(); renderPanels(); })));
      tb.append(tr);
    });
  }
  /* checkbox list of zones for an object with .zones = "*" | [ids] */
  function zonePicker(obj, rerender, allLabel) {
    const box = checkRow();
    check(box, allLabel, obj.zones === "*", false, on => { obj.zones = on ? "*" : site.zones.map(z => z.id); rerender(); });
    site.zones.forEach(z => check(box, z.name || z.id, obj.zones === "*" || (Array.isArray(obj.zones) && obj.zones.includes(z.id)), obj.zones === "*",
      on => { obj.zones = site.zones.filter(zz => zz === z ? on : obj.zones.includes(zz.id)).map(zz => zz.id); }));
    return box;
  }
  function renderGroups() {
    const tb = $("#groups tbody"); tb.replaceChildren();
    (site.groups = site.groups || []).forEach((g, i) => {
      const tr = document.createElement("tr");
      const name = text(g.name); name.oninput = () => { g.name = name.value; };
      const id = text(g.id); id.className = "ref"; id.oninput = () => { g.id = id.value; };
      tr.append(cell(name), cell(zonePicker(g, renderGroups, T("All zones"))), cell(id), cell(tools(site.groups, i, renderGroups)));
      tb.append(tr);
    });
  }
  function renderSourceGroups() {
    const tb = $("#source-groups tbody"); tb.replaceChildren();
    (site.sourceGroups = site.sourceGroups || []).forEach((g, i) => {
      const tr = document.createElement("tr");
      const name = text(g.name); name.oninput = () => { g.name = name.value; };
      const icon = iconSelect(g.icon || "group"); icon.onchange = () => { g.icon = icon.value; };
      const mode = document.createElement("select");
      [["exclusive", T("Only one at a time")], ["toggle", T("Toggle together (own button)")]].forEach(([v, l]) => { const o = document.createElement("option"); o.value = v; o.textContent = l; if ((g.mode || "toggle") === v) o.selected = true; mode.append(o); });
      mode.onchange = () => { g.mode = mode.value; };
      const box = checkRow();
      site.sources.forEach(s => check(box, s.name || s.id, (g.sources || []).includes(s.id), false, on => { g.sources = site.sources.filter(ss => ss === s ? on : (g.sources || []).includes(ss.id)).map(ss => ss.id); }));
      const id = text(g.id); id.className = "ref"; id.oninput = () => { g.id = id.value; };
      tr.append(cell(name), cell(mode), cell(icon), cell(box), cell(id), cell(tools(site.sourceGroups, i, renderSourceGroups)));
      tb.append(tr);
    });
  }
  const VIEWS = [["zones", T("Zones")], ["mixer", T("Mixer")]];
  let publicUrl = "";
  const panelLink = p => (publicUrl || location.origin) + "/?token=" + encodeURIComponent(p.token);
  const uuid = () => { const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80; const h = [...b].map(x => x.toString(16).padStart(2, "0")).join(""); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; };
  function renderPanels() {
    const box = $("#panels"); box.replaceChildren();
    (site.panels = site.panels || []).forEach((p, i) => {
      const card = document.createElement("article"); card.className = "screen";
      const field = (label, input) => { const d = document.createElement("div"); const l = document.createElement("label"); l.textContent = label; d.append(l, input); return d; };
      const name = text(p.name); name.oninput = () => { p.name = name.value; };
      const host = text(p.host || "", { placeholder: T("empty = browser only") }); host.oninput = () => { p.host = host.value.trim(); };
      const user = text(p.user || "admin"); user.oninput = () => { p.user = user.value.trim(); };
      const pw = text(p.password || "", { type: "password", autocomplete: "new-password", placeholder: T("the screen's password") }); pw.oninput = () => { p.password = pw.value; };
      const id = text(p.id); id.className = "ref"; id.oninput = () => { p.id = id.value; };
      const sc = text(p.scale || 1, { type: "number", min: 0.6, max: 2.5, step: 0.05, title: T("Magnification of the whole panel on this screen (1 = normal, 1.3 suits a 7″ TS-770)") }); sc.oninput = () => { p.scale = Number(sc.value) || 1; };
      const lang = document.createElement("select"); [["", T("As the panel")], ["en", "English"], ["nb", "Norsk"]].forEach(([v, l]) => { const o = document.createElement("option"); o.value = v; o.textContent = l; if ((p.lang || "") === v) o.selected = true; lang.append(o); }); lang.onchange = () => { if (lang.value) p.lang = lang.value; else delete p.lang; };
      const fields = document.createElement("div"); fields.className = "fields";
      fields.append(field(T("Name"), name), field(T("IP address (Crestron screen)"), host), field(T("User"), user), field(T("Password"), pw), field(T("Scale"), sc), field(T("Language"), lang), field("ID", id));

      const picks = document.createElement("div"); picks.className = "picks";
      const views = checkRow();
      VIEWS.forEach(([vid, label]) => check(views, label, !p.views || p.views.includes(vid), false, on => { p.views = VIEWS.map(v => v[0]).filter(v => v === vid ? on : (!p.views || p.views.includes(v))); }));
      picks.append(field(T("Zones shown"), zonePicker(p, renderPanels, T("All"))), field(T("Views"), views));

      const foot = document.createElement("div"); foot.className = "foot";
      const tok = document.createElement("span"); tok.className = "token"; tok.textContent = p.token ? T("key %s", p.token) : T("key is created when saving"); tok.title = p.token || "";
      const copy = btn({ textContent: T("Copy link"), title: T("Copy the panel link with this screen's key"), disabled: !p.token });
      copy.onclick = async () => { const link = panelLink(p); try { await navigator.clipboard.writeText(link); msg(T("Link copied: %s", link), "ok"); } catch (_) { window.prompt(T("Copy the link:"), link); } };
      const rot = btn({ textContent: T("New key"), title: T("Make a new key (the old link stops working when you save)") });
      rot.onclick = () => { if (window.confirm(T("New key for “%s”? Everyone using today's link loses access when you save, and the Crestron screen must be published again.", p.name))) { p.token = uuid(); renderPanels(); } };
      const open = btn({ textContent: T("👁 Open"), title: T("Open the panel as this screen sees it (saved configuration)") }); open.onclick = () => window.open(p.token ? panelLink(p) : "/?panel=" + encodeURIComponent(p.id), "_blank");
      const dl = btn({ textContent: "⬇ .ch5z", title: T("Download the .ch5z for this screen (saved configuration)") }); dl.onclick = () => { window.location.href = "/api/admin/panels/" + encodeURIComponent(p.id) + "/archive"; };
      const pub = btn({ textContent: T("⇪ Publish"), title: T("Publish to this screen only (saved configuration)"), disabled: !p.host }); pub.onclick = () => publish([p.id]);
      const sp = document.createElement("span"); sp.className = "spacer";
      foot.append(tok, copy, rot, sp, open, dl, pub, tools(site.panels, i, renderPanels));
      card.append(fields, picks, foot);
      box.append(card);
    });
  }
  async function publish(ids) {
    if (!site.panels.length) { msg(T("No screens registered."), "err"); return; }
    const names = site.panels.filter(p => !ids || ids.includes(p.id)).map(p => p.name + (p.host ? " (" + p.host + ")" : T(" – no IP")));
    if (!window.confirm(T("Publish the saved configuration to:\n• %s\n\nThe screens reload the project afterwards.", names.join("\n• ")))) return;
    const r = await fetch("/api/admin/publish", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: ids || [] }) });
    const d = await r.json();
    if (!r.ok || !d.ok) { msg(T("Publishing did not start: %s", d.error || r.status), "err"); return; }
    msg(T("Publishing … (may take a couple of minutes per screen)")); $("#publish-log").hidden = false; $("#btn-publish").disabled = true;
    pollPublish();
  }
  let pollTimer = null;
  async function pollPublish() {
    clearTimeout(pollTimer);
    try {
      const d = await (await fetch("/api/admin/publish/status")).json();
      const el = $("#publish-log"); el.hidden = !d.log.length; el.textContent = d.log.join("\n"); el.scrollTop = el.scrollHeight;
      $("#btn-publish").disabled = d.running;
      if (d.running) { pollTimer = setTimeout(pollPublish, 1500); return; }
      if (d.results.length) { const bad = d.results.filter(r => !r.ok); msg(bad.length ? T("Publishing finished with errors:\n• %s", bad.map(r => r.name + ": " + r.error).join("\n• ")) : T("Published to %s.", d.results.map(r => r.name).join(", ")), bad.length ? "err" : "ok"); }
    } catch (_) { pollTimer = setTimeout(pollPublish, 3000); }
  }
  function renderJoins(rows) {
    const tb = $("#joins tbody"); tb.replaceChildren();
    rows.forEach(r => { const tr = document.createElement("tr"); [T(r.kind), r.name, r.input != null ? T("in %s", r.input) : T("out %s", r.output), r.joins, r.control].forEach(v => { const td = document.createElement("td"); td.textContent = v; if (v === r.joins || v === r.control) td.className = "ref"; tr.append(td); }); tb.append(tr); });
  }

  /* every colour the panel uses: [key, label, default, hint] grouped as shown */
  const COLOR_GROUPS = [
    [T("Surfaces"), [["bg0", T("Background"), "#041721", T("Darkest surface – behind everything")], ["bg1", T("Page"), "#062330"], ["bg2", T("Cards and buttons"), "#0b3142"], ["bg3", T("Border / hover"), "#124256"], ["bg4", T("Pressed"), "#1a556c"]]],
    [T("Accent"), [["accent", T("Accent"), "#2689a8", T("Selected source, faders, active tab")], ["accentHi", T("Accent light"), "#4fb6d4"], ["active", T("Zone on"), "#f2b24a", T("The on/off button when the zone has sound")], ["activeHi", T("Zone on, light"), "#ffd27a"]]],
    [T("Text and status"), [["text", T("Text"), "#eef6f9"], ["textDim", T("Text dimmed"), "#a9c3cf"], ["textFaint", T("Text faint"), "#6f8f9d"], ["ok", T("OK / connected"), "#58d48f"], ["down", T("Error / disconnected"), "#ef6b5b"]]],
  ];
  const DEFAULT_COLORS = Object.fromEntries(COLOR_GROUPS.flatMap(([, defs]) => defs.map(([k, , v]) => [k, v])));
  const PRESETS = {
    standard: [T("Standard (navy / teal)"), DEFAULT_COLORS],
    graphite: [T("Graphite / orange"), { bg0: "#0f1113", bg1: "#16181b", bg2: "#1f2226", bg3: "#2a2e33", bg4: "#363b41", accent: "#e8762c", accentHi: "#ff9a4d", active: "#f5c542", activeHi: "#ffe08a", text: "#f2f2f2", textDim: "#b8bcc2", textFaint: "#7d838b", ok: "#5ad186", down: "#ef6b5b" }],
    forest:   [T("Forest / green"), { bg0: "#0a1a14", bg1: "#0e231b", bg2: "#143126", bg3: "#1c4132", bg4: "#25523f", accent: "#3fa978", accentHi: "#6fd4a4", active: "#e9c46a", activeHi: "#ffe0a0", text: "#eef7f2", textDim: "#a9c9b9", textFaint: "#6f8f80", ok: "#58d48f", down: "#ef6b5b" }],
    light:    [T("Light"), { bg0: "#dfe6ea", bg1: "#eef2f4", bg2: "#ffffff", bg3: "#d6dfe4", bg4: "#c3cfd6", accent: "#1f7a99", accentHi: "#2b9bc2", active: "#e39b1e", activeHi: "#f6b949", text: "#13232b", textDim: "#4c5f69", textFaint: "#7d8d95", ok: "#2f9e5a", down: "#d64c3d" }],
  };
  (function buildSwatches() {
    const host = $("#swatch-groups");
    COLOR_GROUPS.forEach(([title, defs]) => {
      const l = document.createElement("label"); l.textContent = title; l.style.marginTop = "10px";
      const grid = document.createElement("div"); grid.className = "swatches";
      defs.forEach(([k, label, , hint]) => { const d = document.createElement("div"); d.className = "swatch"; d.title = hint || label; const inp = document.createElement("input"); inp.type = "color"; inp.id = "col-" + k; inp.addEventListener("input", pushPreview); const lab = document.createElement("label"); lab.htmlFor = inp.id; lab.textContent = label; d.append(inp, lab); grid.append(d); });
      host.append(l, grid);
    });
    const sel = $("#theme-preset"); Object.entries(PRESETS).forEach(([id, [name]]) => { const o = document.createElement("option"); o.value = id; o.textContent = name; sel.append(o); });
    const custom = document.createElement("option"); custom.value = ""; custom.textContent = T("Custom"); sel.prepend(custom);
    sel.onchange = () => { const p = PRESETS[sel.value]; if (!p) return; for (const k of Object.keys(DEFAULT_COLORS)) $("#col-" + k).value = p[1][k]; pushPreview(); };
  })();
  /* send the theme as it is being edited to the preview iframe (same origin, no save needed) */
  function currentTheme() { const t = Object.assign({}, site.theme); t.logoHeight = Number($("#theme-logo-height").value) || 58; t.veil = Number($("#theme-veil").value); t.colors = {}; for (const k of Object.keys(DEFAULT_COLORS)) t.colors[k] = $("#col-" + k).value; return t; }
  function pushPreview() { if (!site) return; const f = $("#pv"); try { f.contentWindow.postMessage({ t: "theme", theme: currentTheme() }, location.origin); } catch (_) {} const match = Object.entries(PRESETS).find(([, [, c]]) => Object.keys(DEFAULT_COLORS).every(k => c[k].toLowerCase() === $("#col-" + k).value.toLowerCase())); $("#theme-preset").value = match ? match[0] : ""; }
  function themeAssets() {
    const t = site.theme || {};
    const lt = $("#logo-thumb"), bt = $("#bg-thumb");
    lt.style.backgroundImage = t.logo === "none" ? "none" : `url("${t.logo ? "/" + t.logo : "/assets/logo.svg"}")`; lt.textContent = t.logo === "none" ? T("no logo") : "";
    bt.style.backgroundImage = t.background === "none" ? "none" : `url("${t.background ? "/" + t.background : "/assets/bg.svg"}")`; bt.textContent = t.background === "none" ? T("plain") : "";
  }
  function fillTheme() {
    const t = site.theme = Object.assign({ logo: "", logoHeight: 58, background: "", veil: 1 }, site.theme || {}); t.colors = Object.assign({}, DEFAULT_COLORS, t.colors || {});
    $("#theme-logo-height").value = t.logoHeight; $("#theme-veil").value = t.veil; $("#veil-val").textContent = Number(t.veil).toFixed(2);
    for (const k of Object.keys(DEFAULT_COLORS)) $("#col-" + k).value = t.colors[k];
    themeAssets(); pushPreview();
  }
  function readTheme() {
    const t = site.theme; t.logoHeight = Number($("#theme-logo-height").value) || 58; t.veil = Number($("#theme-veil").value);
    for (const k of Object.keys(DEFAULT_COLORS)) t.colors[k] = $("#col-" + k).value;
  }
  function previewUrl() { const p = (site.panels || []).find(x => x.token); return p && (!site.security || site.security.requireToken !== false) ? "/?token=" + encodeURIComponent(p.token) : "/"; }
  function reloadPreview() { const u = previewUrl(); $("#pv").src = u + (u.includes("?") ? "&" : "?") + "pv=" + Date.now(); }
  async function uploadAsset(kind, file) {
    msg(T("Uploading %s …", T(kind)));
    const r = await fetch("/api/admin/theme/upload?kind=" + kind, { method: "POST", headers: { "content-type": file.type }, body: file });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) { msg(T("Upload failed: %s", d.error || r.status), "err"); return; }
    site.theme[kind] = d.path; themeAssets(); reloadPreview(); msg(T(kind === "logo" ? "Logo updated – panels reload." : "Background updated – panels reload."), "ok");
  }
  async function resetAsset(kind, none) {
    const r = await fetch("/api/admin/theme/reset?kind=" + kind + (none ? "&none=1" : ""), { method: "POST" }); const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) { msg(T("Error: %s", d.error || r.status), "err"); return; }
    site.theme[kind] = d.path; themeAssets(); reloadPreview(); msg(T("Updated."), "ok");
  }
  $("#logo-upload").onclick = () => $("#logo-file").click(); $("#logo-file").onchange = e => { const f = e.target.files[0]; e.target.value = ""; if (f) uploadAsset("logo", f); };
  $("#bg-upload").onclick = () => $("#bg-file").click(); $("#bg-file").onchange = e => { const f = e.target.files[0]; e.target.value = ""; if (f) uploadAsset("background", f); };
  $("#logo-reset").onclick = () => resetAsset("logo", false); $("#logo-none").onclick = () => resetAsset("logo", true);
  $("#bg-reset").onclick = () => resetAsset("background", false); $("#bg-none").onclick = () => resetAsset("background", true);
  $("#theme-veil").oninput = e => { $("#veil-val").textContent = Number(e.target.value).toFixed(2); pushPreview(); };
  $("#theme-logo-height").oninput = pushPreview;
  $("#theme-reset-colors").onclick = () => { for (const k of Object.keys(DEFAULT_COLORS)) $("#col-" + k).value = DEFAULT_COLORS[k]; pushPreview(); };
  $("#pv-reload").onclick = reloadPreview;
  $("#pv").addEventListener("load", () => setTimeout(pushPreview, 150));   // re-apply unsaved edits after the preview reloads

  function fillForm() {
    $("#dsp-host").value = site.dsp.host; $("#dsp-port").value = site.dsp.port; $("#dsp-password").value = site.dsp.password || "";
    $("#dsp-keepalive").value = site.dsp.keepAliveMs; $("#dsp-silence").value = site.dsp.silenceTimeoutMs; $("#dsp-reconnect").value = site.dsp.reconnectMs;
    $("#dsp-gap").value = site.dsp.minGapMs != null ? site.dsp.minGapMs : 100; $("#dsp-reply").value = site.dsp.replyTimeoutMs != null ? site.dsp.replyTimeoutMs : 400; $("#dsp-burst").value = site.dsp.burst != null ? site.dsp.burst : 5;
    $("#ctrl-mode").value = site.control.mode; $("#ctrl-level").value = site.control.inputLevelBlock; $("#ctrl-mute").value = site.control.inputMuteBlock; $("#ctrl-zone").value = site.control.zoneBlock;
    $("#lv-in-min").value = site.levels.input.min; $("#lv-in-max").value = site.levels.input.max; $("#lv-zone-min").value = site.levels.zone.min; $("#lv-zone-max").value = site.levels.zone.max;
    $("#site-name").value = site.site.name; $("#site-area").value = site.site.area; $("#ui-step").value = (site.ui || {}).volumeStepPercent || 5; $("#ui-lang").value = (site.ui || {}).lang || "en"; $("#ui-zones").value = (site.ui || {}).zoneLayout || "scroll"; $("#ui-sources").value = (site.ui || {}).sourceLayout || "tiles"; $("#ui-src-cols").value = String((site.ui || {}).sourceColumns != null ? (site.ui || {}).sourceColumns : 2); $("#admin-password").value = (site.admin || {}).password || "";
    $("#public-url").value = site.publicUrl || ""; $("#sec-token").checked = !site.security || site.security.requireToken !== false;
    fillTheme(); renderSources(); renderZones(); renderGroups(); renderSourceGroups(); renderPanels();
  }
  function readForm() {
    site.dsp.host = $("#dsp-host").value.trim(); site.dsp.port = Number($("#dsp-port").value); site.dsp.password = $("#dsp-password").value;
    site.dsp.keepAliveMs = Number($("#dsp-keepalive").value); site.dsp.silenceTimeoutMs = Number($("#dsp-silence").value); site.dsp.reconnectMs = Number($("#dsp-reconnect").value);
    site.dsp.minGapMs = Number($("#dsp-gap").value); site.dsp.replyTimeoutMs = Number($("#dsp-reply").value); site.dsp.burst = Number($("#dsp-burst").value) || 5;
    site.control = { mode: $("#ctrl-mode").value, inputLevelBlock: $("#ctrl-level").value.trim(), inputMuteBlock: $("#ctrl-mute").value.trim(), zoneBlock: $("#ctrl-zone").value.trim() };
    site.levels = { input: { min: Number($("#lv-in-min").value), max: Number($("#lv-in-max").value) }, zone: { min: Number($("#lv-zone-min").value), max: Number($("#lv-zone-max").value) } };
    site.site = { name: $("#site-name").value.trim(), area: $("#site-area").value.trim() };
    site.ui = Object.assign(site.ui || {}, { volumeStepPercent: Number($("#ui-step").value) || 5, lang: $("#ui-lang").value, zoneLayout: $("#ui-zones").value, sourceLayout: $("#ui-sources").value, sourceColumns: Number($("#ui-src-cols").value) });
    site.admin = { password: $("#admin-password").value };
    readTheme(); site.publicUrl = $("#public-url").value.trim(); site.security = Object.assign(site.security || {}, { requireToken: $("#sec-token").checked });
    (site.panels || []).forEach(p => { if (p.views && p.views.length === VIEWS.length) delete p.views; });
  }

  const msg = (t, cls) => { const m = $("#msg"); m.textContent = t; m.className = "msg " + (cls || ""); };
  const setDsp = up => { const s = $("#dsp-status"); s.textContent = up ? T("DSP connected") : T("DSP no contact"); s.className = "status " + (up ? "ok" : "down"); };

  async function load() {
    const r = await fetch("/api/admin/config"); if (!r.ok) { msg(T("Could not load the configuration (%s)", r.status), "err"); return; }
    const d = await r.json(); site = d.site; setDsp(d.dsp); fillForm(); renderJoins(d.joins || []); $("#main").hidden = false;
    publicUrl = d.publicUrl; $("#public-url").placeholder = "auto: " + d.publicUrl;
    $("#public-url-help").textContent = T("Built into the screens' config.js (WebSocket %s/ws). Empty = this machine's LAN address (%s). Set it explicitly if the bridge has several networks or a DNS name.", d.publicUrl.replace(/^http/, "ws"), d.lanAddress) + (d.ch5cli === "installed" ? "" : T(" ch5-cli is not installed in bridge/node_modules – the first publish fetches it via npx."));
    pollPublish(); if (!$("#pv").getAttribute("src")) reloadPreview(); msg(T("Ready. Changes take effect when you save – the panels reload by themselves."));
  }
  async function save() {
    readForm();
    const taken = new Set();
    for (const s of site.sources) { if (!s.id) s.id = uniq(slug(s.name), taken); taken.add(s.id); }
    for (const z of site.zones)   { if (!z.id) z.id = uniq(slug(z.name), taken); taken.add(z.id); }
    for (const g of site.groups)  { if (!g.id) g.id = uniq(slug(g.name), taken); taken.add(g.id); }
    for (const g of site.sourceGroups || []) { if (!g.id) g.id = uniq(slug(g.name), taken); taken.add(g.id); }
    for (const p of site.panels)  { if (!p.id) p.id = uniq(slug(p.name), taken); taken.add(p.id); }
    $("#btn-save").disabled = true; msg(T("Saving …"));
    try {
      const r = await fetch("/api/admin/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ site }) });
      const d = await r.json();
      if (!r.ok || !d.ok) { msg(T("Not saved:\n• %s", (d.problems || [d.error || r.status]).join("\n• ")), "err"); }
      else { await load(); renderJoins(d.joins || []); reloadPreview(); msg(T("Saved and applied. The panels reload."), "ok"); }
    } catch (e) { msg(T("Error: %s", e.message), "err"); }
    $("#btn-save").disabled = false;
  }

  $("#btn-save").onclick = save;
  $("#btn-reload").onclick = () => load();
  $("#btn-import").onclick = () => $("#import-file").click();
  $("#import-file").onchange = async ev => {
    const f = ev.target.files[0]; ev.target.value = ""; if (!f) return;
    let data; try { data = JSON.parse(await f.text()); } catch (_) { msg(T("The file is not valid JSON."), "err"); return; }
    const n = (data.sources || (data.site || {}).sources || []).length, z = (data.zones || (data.site || {}).zones || []).length;
    if (!window.confirm(T("Replace the whole configuration with “%s” (%s sources, %s zones)? The panels reload.", f.name, n, z))) return;
    msg(T("Uploading …"));
    try {
      const r = await fetch("/api/admin/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
      const d = await r.json();
      if (!r.ok || !d.ok) msg(T("Not applied:\n• %s", (d.problems || [d.error || r.status]).join("\n• ")), "err");
      else { await load(); msg(T("Configuration from “%s” applied.", f.name), "ok"); }
    } catch (e) { msg(T("Error: %s", e.message), "err"); }
  };
  $("#btn-reconnect").onclick = async () => { await fetch("/api/admin/dsp/reconnect", { method: "POST" }); msg(T("Reconnecting to the DSP …")); };
  $("#add-source").onclick = () => { const used = new Set(site.sources.map(s => s.input)); let n = 1; while (used.has(n)) n++; site.sources.push({ id: "", input: n, name: T("New source"), icon: "music", group: "" }); renderSources(); };
  $("#add-zone").onclick = () => { const used = new Set(site.zones.map(z => z.output)); let n = 1; while (used.has(n)) n++; site.zones.push({ id: "", output: n, name: T("New zone"), icon: "speaker", hint: "" }); renderZones(); renderGroups(); };
  $("#add-group").onclick = () => { site.groups.push({ id: "", name: T("New group"), zones: [] }); renderGroups(); };
  $("#add-source-group").onclick = () => { site.sourceGroups.push({ id: "", name: T("New source group"), icon: "group", mode: "exclusive", sources: [] }); renderSourceGroups(); };
  $("#add-panel").onclick = () => { site.panels.push({ id: "", name: T("New screen"), host: "", user: "admin", password: "", zones: "*", token: uuid() }); renderPanels(); };
  $("#btn-publish").onclick = () => publish(null);
  setInterval(async () => { try { const r = await fetch("/api/health"); const d = await r.json(); setDsp(d.dsp); } catch (_) {} }, 5000);
  load();
})();
