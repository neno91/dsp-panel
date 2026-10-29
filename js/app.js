/* ------------------------------------------------------------------
   DSP Panel – audio control panel
   Builds the UI from PANEL_CONFIG and binds every control to the
   join bridge. No framework; plain DOM.
   ------------------------------------------------------------------ */
(function () {
  "use strict";

  const C   = window.PANEL_CONFIG;
  const B   = window.Bridge;
  const MAX = C.ui.analogMax;
  const $   = (sel, root = document) => root.querySelector(sel);

  /* ---------- language ---------- */
  const LANG = (window.PANEL_I18N && window.PANEL_I18N[C.ui.lang]) ? C.ui.lang : "en";
  const L = window.PANEL_I18N[LANG];
  document.documentElement.lang = LANG;
  C.ui.locale = L.locale;
  document.querySelectorAll("[data-i18n]").forEach(n => { n.textContent = L[n.dataset.i18n]; });
  document.querySelectorAll("[data-i18n-aria]").forEach(n => { n.setAttribute("aria-label", L[n.dataset.i18nAria]); });

  /* Per-screen scale (set under Screens in /admin): every size in the CSS is in rem, so the root
     font-size scales the whole UI – works the same in browsers and on the touch panels. */
  const scale = Math.min(2.5, Math.max(0.6, Number(C.ui.scale) || 1));
  if (scale !== 1) document.documentElement.style.setProperty("--s", String(scale));

  /* ---------- appearance (theme from /admin → Utseende) ---------- */
  const THEME_VARS = { bg0: "--navy-950", bg1: "--navy-900", bg2: "--navy-800", bg3: "--navy-700", bg4: "--navy-600",
    accent: "--teal", accentHi: "--teal-hi", active: "--amber", activeHi: "--amber-hi",
    text: "--fg", textDim: "--fg-dim", textFaint: "--fg-faint", ok: "--ok", down: "--down" };
  const THEME_RGB = { bg0: "--bg0-rgb", bg1: "--bg1-rgb", bg2: "--card-rgb", accent: "--teal-rgb", accentHi: "--teal-hi-rgb", active: "--amber-rgb", down: "--down-rgb", text: "--text-rgb" };
  const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(",");
  function applyTheme(T) {
    T = T || {}; const root = document.documentElement.style, colors = T.colors || {};
    for (const [k, v] of Object.entries(THEME_VARS)) {
      const c = colors[k], ok = /^#[0-9a-f]{6}$/i.test(c || "");
      ok ? root.setProperty(v, c) : root.removeProperty(v);
      if (THEME_RGB[k]) ok ? root.setProperty(THEME_RGB[k], hexRgb(c)) : root.removeProperty(THEME_RGB[k]);
    }
    root.setProperty("--veil", String(T.veil != null ? T.veil : 1));
    const img = document.querySelector(".brand img");
    if (img) { img.hidden = T.logo === "none"; img.style.height = T.logoHeight ? T.logoHeight + "px" : ""; const want = T.logo && T.logo !== "none" ? T.logo : "assets/logo.svg"; if (img.getAttribute("src") !== want) img.src = want; }
    const bd = document.querySelector(".backdrop");
    if (bd) bd.style.backgroundImage = !T.background ? "" : T.background === "none" ? "none" : `url("${T.background}")`;
  }
  applyTheme(C.theme);
  // layout options (Site and panel in /admin): zones as a side-scrolling row or a grid; sources as compact tiles or a list
  document.body.dataset.zones = C.ui.zoneLayout === "grid" ? "grid" : "scroll";
  document.body.dataset.zoneRows = C.ui.zoneLayout === "scroll2" ? "2" : "1";
  document.body.dataset.sources = C.ui.sourceLayout === "list" ? "list" : "tiles";
  const srcCols = [2, 3, 4, 5].includes(Number(C.ui.sourceColumns)) ? Number(C.ui.sourceColumns) : 0;   // 0 = as many as fit
  if (srcCols) document.body.dataset.srcCols = String(srcCols);
  const srcLabel = s => (document.body.dataset.sources === "tiles" && s.short && (srcCols === 0 || srcCols >= 4)) ? s.short : s.name;   // wide tiles show the full name
  // live preview from /admin (same origin): the admin page posts the theme as it is being edited
  window.addEventListener("message", e => { if (e.origin === location.origin && e.data && e.data.t === "theme") applyTheme(e.data.theme); });

  /* ---------- helpers ---------- */
  function el(tag, attrs = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) n.setAttribute(k, v);
    }
    for (const c of children) if (c != null) n.append(c);
    return n;
  }
  // SVG needs its own namespace, so icons are built via innerHTML.
  function svgIcon(name, cls = "icon") {
    const wrap = document.createElement("span");
    wrap.innerHTML = `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
    return wrap.firstChild;
  }
  const pct = v => Math.round((v / MAX) * 100);
  const sourceById = id => C.sources.find(s => s.id === id);
  const srcHint    = s  => s.hint || (s.group ? s.group : null);

  /* ---------- source groups ----------
     A source group ("Alle mikrofoner") is a set of sources toggled together: one button per
     zone card (and in the zone-group card). State is derived: all / some / none of the member
     routes on. Tap: not all on → turn the missing ones on; all on → turn all off. */
  const allSourceGroups = (C.sourceGroups || [])
    .map(g => ({ id: g.id, name: g.name, icon: g.icon || "group", mode: g.mode === "exclusive" ? "exclusive" : "toggle", idx: (g.sources || []).map(id => C.sources.findIndex(s => s.id === id)).filter(i => i >= 0) }))
    .filter(g => g.idx.length > 1);
  const SourceGroups   = allSourceGroups.filter(g => g.mode === "toggle");      // get a button
  const ExclusiveGroups = allSourceGroups.filter(g => g.mode === "exclusive");  // only one member on per zone (enforced by the bridge; mirrored in the simulator)
  const triJoins = joins => { const v = joins.map(j => !!State.b[j]); if (!v.length || v.every(x => !x)) return "none"; return v.every(Boolean) ? "all" : "some"; };
  const toggleJoins = joins => { const target = triJoins(joins) !== "all"; joins.forEach(j => { if (!!State.b[j] !== target) B.tap(j); }); };
  /* row of group buttons; joinsFor(group) → the route joins the button controls */
  function sourceGroupRow(label, joinsFor) {
    if (!SourceGroups.length) return null;
    const row = el("div", { class: "source-groups", role: "group", "aria-label": L.sourceGroups(label) });
    const btns = SourceGroups.map(g => {
      const b = el("button", { class: "source-btn source-group-btn", type: "button", "aria-label": L.sourceIn(g.name, label), onclick: () => toggleJoins(joinsFor(g)) },
        svgIcon(g.icon), el("span", {}, g.name), el("small", { class: "source-group-count" }, ""));
      row.append(b); return { g, b };
    });
    let seen = false;
    const update = () => { if (row.isConnected) seen = true; else if (seen) return; btns.forEach(({ g, b }) => { const joins = joinsFor(g), st = triJoins(joins), on = joins.filter(j => State.b[j]).length;
      b.classList.toggle("is-active", st === "all"); b.classList.toggle("is-some", st === "some"); b.querySelector(".source-group-count").textContent = `${on}/${joins.length}`; }); };
    State.onChange(update); update();
    return row;
  }
  const zoneById   = id => C.zones.find(z => z.id === id);
  const routeJoin  = (z, s, i) => z.sourceJoinBase + (s.joinOffset != null ? s.joinOffset : i);   // generated config: by DSP input; static: by position

  /* ---------- Feedback store ----------
     Keeps the last value of every join the UI cares about, so that derived
     views (groups) can be computed from member state. */
  const State = (function () {
    const b = {}, n = {}, listeners = new Set(), subscribed = new Set();
    function watch(type, join) {
      const key = type + join;
      if (subscribed.has(key)) return;
      subscribed.add(key);
      B.subscribe(type, join, v => {
        (type === "b" ? b : n)[join] = type === "b" ? !!v : Number(v) || 0;
        listeners.forEach(fn => fn(type, join));
      });
    }
    return { b, n, watch, onChange: fn => listeners.add(fn) };
  })();

  /* Press-and-hold digital button: high on pointer down, low on release. */
  function bindMomentary(node, onPress, onRelease) {
    let down = false;
    const up = () => { if (!down) return; down = false; node.classList.remove("is-pressed"); onRelease(); };
    node.addEventListener("pointerdown", e => {
      if (e.button !== undefined && e.button !== 0) return;
      down = true; node.classList.add("is-pressed");
      try { node.setPointerCapture(e.pointerId); } catch (_) {}
      onPress();
    });
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", up);
    node.addEventListener("lostpointercapture", up);
    node.addEventListener("keydown", e => { if ((e.key === " " || e.key === "Enter") && !down) { e.preventDefault(); down = true; onPress(); } });
    node.addEventListener("keyup",   e => { if (e.key === " " || e.key === "Enter") up(); });
    node.addEventListener("contextmenu", e => e.preventDefault());
  }
  const bindJoinButton = (node, join) => bindMomentary(node, () => B.press(join), () => B.release(join));

  /* Digital feedback → .is-active */
  function bindFeedback(node, join, onChange) {
    State.watch("b", join);
    B.subscribe("b", join, v => {
      node.classList.toggle("is-active", !!v);
      node.setAttribute("aria-pressed", v ? "true" : "false");
      if (onChange) onChange(!!v);
    });
  }

  /* ---------- Fader component ----------
     send(value)        called with 0..MAX while dragging / on keys
     subscribe(cb)      how the fader receives its displayed value      */
  const fmtLevel = (v, range) => {
    if (!range) return pct(v) + " %";
    const db = range.min + (v / MAX) * (range.max - range.min);
    if (range.min <= -90 && db <= range.min + 0.05) return "−∞ dB";
    return (db > 0 ? "+" : db < 0 ? "−" : "") + Math.abs(db).toFixed(1).replace(/\.0$/, "") + " dB";
  };
  function createFader({ orientation, label, send: sendOut, subscribe, range }) {
    const track = el("div", { class: "fader-track" }, el("div", { class: "fader-fill" }), el("div", { class: "fader-thumb" }));
    const readout = el("output", { class: "fader-readout" }, "0 %");
    const root = el("div", {
      class: `fader fader-${orientation}`, role: "slider", tabindex: "0",
      "aria-label": label, "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0",
    }, track);

    let value = 0, dragging = false, lastSent = 0, raf = null;

    function render(v) {
      const p = pct(v);
      root.style.setProperty("--p", p + "%");
      readout.textContent = fmtLevel(v, range);
      readout.title = p + " %";
      root.setAttribute("aria-valuenow", String(p));
      root.setAttribute("aria-valuetext", fmtLevel(v, range));
    }
    function send(v, force) {
      value = Math.max(0, Math.min(MAX, Math.round(v)));
      render(value);
      const now = performance.now();
      if (force || now - lastSent > 40) { lastSent = now; sendOut(value); }
      else if (!raf) raf = requestAnimationFrame(() => { raf = null; lastSent = performance.now(); sendOut(value); });
    }
    function fromPointer(e) {
      const r = track.getBoundingClientRect();
      const horizontal = r.width > r.height;                                  // vertical faders become horizontal on phones
      const ratio = horizontal ? (e.clientX - r.left) / r.width : 1 - (e.clientY - r.top) / r.height;
      return Math.max(0, Math.min(1, ratio)) * MAX;
    }

    // Drag handling on the whole fader (padding included) – a 10 px track is too small a target for a finger.
    // The fader has touch-action:none so the browser never turns the drag into a scroll and cancels it.
    const start = e => { dragging = true; root.classList.add("is-dragging"); send(fromPointer(e), true); };
    const move  = e => { if (dragging) send(fromPointer(e)); };
    const end   = e => { if (!dragging) return; dragging = false; root.classList.remove("is-dragging"); send(fromPointer(e), true); };
    if (window.PointerEvent) {
      root.addEventListener("pointerdown", e => { if (e.button !== undefined && e.button !== 0) return; e.preventDefault(); try { root.setPointerCapture(e.pointerId); } catch (_) {} start(e); });
      root.addEventListener("pointermove", move);
      root.addEventListener("pointerup", end);
      root.addEventListener("pointercancel", end);
      root.addEventListener("lostpointercapture", end);
    } else {                                                   // old WebKit without pointer events: touch + mouse
      const t = f => e => { if (e.touches && e.touches.length) f(e.touches[0]); else if (e.changedTouches && e.changedTouches.length) f(e.changedTouches[0]); else f(e); e.preventDefault(); };
      root.addEventListener("touchstart", t(start), { passive: false });
      root.addEventListener("touchmove", t(move), { passive: false });
      root.addEventListener("touchend", t(end)); root.addEventListener("touchcancel", t(end));
      root.addEventListener("mousedown", e => { start(e); const mv = ev => move(ev), up = ev => { end(ev); window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); }; window.addEventListener("mousemove", mv); window.addEventListener("mouseup", up); });
    }
    root.addEventListener("keydown", e => {
      const step = MAX * (C.ui.volumeStepPercent / 100);
      const map = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: step * 2, PageDown: -step * 2 };
      if (e.key in map) { e.preventDefault(); send(value + map[e.key], true); }
      if (e.key === "Home") { e.preventDefault(); send(0, true); }
      if (e.key === "End")  { e.preventDefault(); send(MAX, true); }
    });

    subscribe(v => { if (!dragging) { value = Number(v) || 0; render(value); } });

    const nudge = dir => send(value + dir * MAX * (C.ui.volumeStepPercent / 100), true);
    return { root, readout, nudge, get value() { return value; } };
  }
  const joinFader = (join, orientation, label, range) => createFader({
    orientation, label, range,
    send: v => B.publish("n", join, v),
    subscribe: cb => { State.watch("n", join); B.subscribe("n", join, cb); },
  });

  /* ---------- Views ---------- */
  function buildNav() {
    const nav = $("#view-nav");
    const panes = {};
    document.querySelectorAll(".view").forEach(s => { s.hidden = true; });   // views not in the config (per-screen setup) stay hidden
    if (C.views.length < 2) nav.hidden = true;
    C.views.forEach(v => { panes[v.id] = $(`#view-${v.id}`); panes[v.id].hidden = true; });
    // the view is local to this screen (not a shared join – switching to the mixer on one panel must not switch the others)
    const btns = {};
    const show = id => {
      C.views.forEach(v => { panes[v.id].hidden = v.id !== id; btns[v.id].classList.toggle("is-active", v.id === id); btns[v.id].setAttribute("aria-pressed", v.id === id ? "true" : "false"); });
      document.body.dataset.view = id;
      try { sessionStorage.setItem("dsp-panel.view", id); } catch (_) {}
    };
    C.views.forEach(v => {
      btns[v.id] = el("button", { class: "nav-btn", type: "button", id: `nav-${v.id}`, onclick: () => show(v.id) }, svgIcon(v.icon), el("span", {}, (L.views[v.id] || v.label)));
      nav.append(btns[v.id]);
    });
    let initial = C.views[0].id; try { const s = sessionStorage.getItem("dsp-panel.view"); if (C.views.some(v => v.id === s)) initial = s; } catch (_) {}
    show(initial);
  }

  function buildZones() {
    const grid = $("#zones-grid");
    C.zones.forEach(z => {
      const card = el("article", { class: "zone", id: `zone-${z.id}` });

      // header: icon, name, power
      const power = el("button", { class: "zone-select", type: "button", "aria-label": L.zoneToggle(z.name), title: L.zoneToggleHint }, svgIcon("power"));
      bindJoinButton(power, z.select);
      const status = el("span", { class: "zone-status" }, L.muted);
      bindFeedback(power, z.select, on => { card.classList.toggle("is-on", on); status.textContent = on ? L.soundOn : L.muted; });
      card.append(el("header", { class: "zone-head" },
        el("span", { class: "zone-icon" }, svgIcon(z.icon)),
        el("div", { class: "zone-title" }, el("h2", {}, z.name), status),
        power));

      // volume
      const fader = joinFader(z.volume, "horizontal", L.zoneVolume(z.name), C.levels && C.levels.zone);
      const minus = el("button", { class: "nudge", type: "button", "aria-label": L.lower, onclick: () => fader.nudge(-1) }, svgIcon("minus"));
      const plus  = el("button", { class: "nudge", type: "button", "aria-label": L.higher, onclick: () => fader.nudge(1) }, svgIcon("plus"));
      card.append(el("div", { class: "zone-volume" },
        el("div", { class: "vol-row" }, el("span", { class: "eyebrow" }, L.volume), fader.readout),
        el("div", { class: "vol-ctl" }, minus, fader.root, plus)));

      // source groups (toggle several sources at once), then the sources themselves (several can be on at once)
      const sgRow = sourceGroupRow(z.name, g => g.idx.map(i => routeJoin(z, C.sources[i], i)));
      if (sgRow) card.append(sgRow);
      const list = el("div", { class: "source-list", role: "group", "aria-label": L.zoneSources(z.name) });
      C.sources.forEach((s, i) => {
        const join = routeJoin(z, s, i);
        const b = el("button", { class: "source-btn", type: "button", "aria-label": L.sourceTo(s.name, z.name), title: srcHint(s) || s.name }, svgIcon(s.icon), el("span", {}, srcLabel(s)));
        bindJoinButton(b, join);
        bindFeedback(b, join);   // each source is an independent on/off toggle
        list.append(b);
      });
      card.append(list);

      if (z.hint) card.append(el("p", { class: "zone-hint" }, z.hint));
      grid.append(card);
    });
  }

  /* ---------- Groups ----------
     A group is a set of zone ids. Actions fan out to members; state is
     derived from member feedback (all / some / none). */
  const Groups = (function () {
    const LS_KEY = "dsp-panel.groups";
    const resolve = g => (g.zones === "*" ? C.zones.map(z => z.id) : g.zones).filter(zoneById);
    const presets = (C.groups || []).map(g => ({ id: g.id, name: g.name, zones: resolve(g), preset: true }));
    let custom = [];
    try { custom = JSON.parse(localStorage.getItem(LS_KEY) || "[]").filter(g => g && g.id && Array.isArray(g.zones)); } catch (_) {}
    const save = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(custom)); } catch (_) {} };

    let selected = null;   // group id
    let editing  = false;
    let ui = {};

    const all = () => presets.concat(custom);
    const get = id => all().find(g => g.id === id);
    const members = g => g.zones.map(zoneById).filter(Boolean);

    // ---- derived state
    const tri = (g, pick) => {            // 'all' | 'some' | 'none'
      const vals = members(g).map(pick);
      if (!vals.length || vals.every(v => !v)) return "none";
      return vals.every(Boolean) ? "all" : "some";
    };
    const powerState  = g => tri(g, z => State.b[z.select]);
    const sourceState = (g, i) => tri(g, z => State.b[routeJoin(z, C.sources[i], i)]);
    const avgVolume   = g => { const m = members(g); return m.length ? m.reduce((a, z) => a + (State.n[z.volume] || 0), 0) / m.length : 0; };
    const volumeSpread = g => { const v = members(g).map(z => State.n[z.volume] || 0); return v.length ? Math.max(...v) - Math.min(...v) : 0; };

    // ---- fan-out actions (toggle joins: press only the members that need to change)
    function setAll(g, pickJoin, pickState) {
      const target = tri(g, pickState) !== "all";           // not all on → turn on; all on → turn off
      members(g).forEach(z => { if (!!pickState(z) !== target) B.tap(pickJoin(z)); });
    }
    const setPower  = g      => setAll(g, z => z.select, z => State.b[z.select]);
    const setSource = (g, i) => setAll(g, z => routeJoin(z, C.sources[i], i), z => State.b[routeJoin(z, C.sources[i], i)]);
    const setVolume = (g, v) => members(g).forEach(z => B.publish("n", z.volume, v));

    // ---- UI
    function build() {
      const host = $("#groups");
      ui.bar  = el("div", { class: "group-bar" });
      ui.card = el("section", { class: "group-card", hidden: "" });
      host.append(ui.bar, ui.card);
      renderBar();
      State.onChange(() => { if (selected) renderCardState(); });
    }

    function renderBar() {
      ui.bar.replaceChildren(
        el("span", { class: "eyebrow group-eyebrow" }, L.groups),
        ...all().map(g => {
          const chip = el("button", { class: "group-chip" + (g.id === selected ? " is-active" : ""), type: "button", onclick: () => select(g.id === selected ? null : g.id) },
            svgIcon("group"), el("span", {}, g.name), el("small", {}, String(g.zones.length)));
          return chip;
        }),
        el("button", { class: "group-chip group-new", type: "button", onclick: createGroup }, svgIcon("plus"), el("span", {}, L.newGroup)));
    }

    function select(id) {
      selected = id; editing = false;
      document.querySelectorAll(".zone").forEach(c => c.classList.remove("in-group"));
      renderBar();
      if (!selected) { ui.card.hidden = true; return; }
      const g = get(selected);
      members(g).forEach(z => $(`#zone-${z.id}`).classList.add("in-group"));
      renderCard(g);
      ui.card.hidden = false;
    }

    function createGroup() {
      const n = custom.length + 1;
      const g = { id: "u" + Date.now().toString(36), name: L.defaultGroupName(n), zones: [] };
      custom.push(g); save();
      select(g.id); editing = true; renderCard(g);
    }

    function renderCard(g) {
      const m = members(g);
      // header
      const title = editing
        ? el("input", { class: "group-name-input", id: `group-name-${g.id}`, type: "text", value: g.name, maxlength: "32", "aria-label": L.groupName,
            oninput: e => { g.name = e.target.value.trim() || g.name; } })
        : el("h2", {}, g.name);
      const actions = el("div", { class: "group-actions" });
      if (!g.preset) {
        actions.append(
          editing
            ? el("button", { class: "ghost-btn", type: "button", onclick: () => { editing = false; save(); renderBar(); renderCard(g); } }, L.done)
            : el("button", { class: "ghost-btn", type: "button", onclick: () => { editing = true; renderCard(g); } }, L.edit),
          el("button", { class: "ghost-btn danger", type: "button", onclick: () => confirmDelete(g) }, L.remove));
      }
      actions.append(el("button", { class: "ghost-btn", type: "button", "aria-label": L.close, onclick: () => select(null) }, svgIcon("close")));

      // members
      const memberRow = el("div", { class: "group-members" },
        ...C.zones.map(z => {
          const on = g.zones.includes(z.id);
          if (!editing && !on) return null;
          return el("button", {
            class: "member-chip" + (on ? " is-on" : ""), type: "button", "aria-pressed": on ? "true" : "false",
            disabled: editing ? null : "",
            onclick: () => { if (!editing) return; g.zones = on ? g.zones.filter(id => id !== z.id) : g.zones.concat(z.id); save(); select(g.id); editing = true; renderCard(g); },
          }, svgIcon(editing ? (on ? "check" : "plus") : z.icon), el("span", {}, z.name));
        }));

      // controls
      ui.power = el("button", { class: "zone-select group-power", type: "button", "aria-label": L.groupToggle(g.name), onclick: () => setPower(g) }, svgIcon("power"));
      ui.powerLabel = el("span", { class: "zone-status" }, "");
      ui.fader = createFader({
        orientation: "horizontal", label: L.zoneVolume(g.name), range: C.levels && C.levels.zone,
        send: v => setVolume(g, v),
        subscribe: cb => { ui.faderCb = cb; cb(avgVolume(g)); },
      });
      ui.spread = el("span", { class: "group-spread", title: L.spread }, "≠");
      const minus = el("button", { class: "nudge", type: "button", "aria-label": L.lower, onclick: () => ui.fader.nudge(-1) }, svgIcon("minus"));
      const plus  = el("button", { class: "nudge", type: "button", "aria-label": L.higher, onclick: () => ui.fader.nudge(1) }, svgIcon("plus"));
      ui.sources = C.sources.map((s, i) =>
        el("button", { class: "source-btn", type: "button", "aria-label": L.sourceIn(s.name, g.name), title: srcHint(s) || s.name, onclick: () => setSource(g, i) }, svgIcon(s.icon), el("span", {}, srcLabel(s))));
      const sgRow = sourceGroupRow(g.name, sg => members(g).flatMap(z => sg.idx.map(i => routeJoin(z, C.sources[i], i))));

      const controls = el("div", { class: "group-controls" },
        el("div", { class: "group-col" },
          el("div", { class: "vol-row" }, el("span", { class: "eyebrow" }, L.allZones), ui.powerLabel),
          el("div", { class: "group-power-row" }, ui.power, el("span", { class: "group-power-text" }, L.muteAll))),
        el("div", { class: "group-col group-col-vol" },
          el("div", { class: "vol-row" }, el("span", { class: "eyebrow" }, L.volume), el("span", { class: "vol-readout-wrap" }, ui.spread, ui.fader.readout)),
          el("div", { class: "vol-ctl" }, minus, ui.fader.root, plus)),
        el("div", { class: "group-col group-col-src" },
          el("div", { class: "vol-row" }, el("span", { class: "eyebrow" }, L.sources)),
          sgRow,
          el("div", { class: "source-list group-sources" }, ...ui.sources)));

      const empty = m.length ? null : el("p", { class: "group-empty" }, editing ? L.pickZones : L.emptyGroup);

      const head = editing
        ? el("header", { class: "group-head" }, svgIcon("group", "icon group-head-icon"), title, actions)
        : el("header", { class: "group-head" }, svgIcon("group", "icon group-head-icon"), title, memberRow, actions);
      ui.card.replaceChildren(...[head, editing ? memberRow : null, empty, m.length ? controls : null].filter(Boolean));
      renderCardState();
    }

    function renderCardState() {
      const g = get(selected); if (!g || !ui.power || !ui.power.isConnected) return;
      const p = powerState(g);
      ui.power.classList.toggle("is-active", p === "all");
      ui.power.classList.toggle("is-some", p === "some");
      ui.powerLabel.textContent = p === "all" ? L.onInAll : p === "some" ? L.onInSome : L.allMuted;
      if (ui.faderCb) ui.faderCb(avgVolume(g));
      ui.spread.hidden = volumeSpread(g) < MAX * 0.02;
      ui.sources.forEach((b, i) => { const s = sourceState(g, i); b.classList.toggle("is-active", s === "all"); b.classList.toggle("is-some", s === "some"); });
    }

    function confirmDelete(g) {
      const box = el("div", { class: "confirm" },
        el("span", {}, L.confirmDelete(g.name)),
        el("button", { class: "ghost-btn danger", type: "button", onclick: () => { custom = custom.filter(x => x.id !== g.id); save(); select(null); } }, L.yesDelete),
        el("button", { class: "ghost-btn", type: "button", onclick: () => renderCard(g) }, L.cancel));
      $(".group-head", ui.card).replaceWith(el("header", { class: "group-head" }, box));
    }

    return { build };
  })();

  function buildMixer() {
    const strip = $("#mixer-strip");
    C.mixer.forEach(ch => {
      const s = sourceById(ch.source);
      if (!s) return;
      const col = el("div", { class: "channel", id: `ch-${s.id}` });
      const fader = joinFader(ch.level, "vertical", L.level(s.name), C.levels && C.levels.input);
      const btn = el("button", { class: "ch-btn", type: "button", title: srcHint(s) }, svgIcon(s.icon), el("span", {}, s.name),
        s.group ? el("small", { class: "ch-group" }, s.group) : null);
      bindJoinButton(btn, ch.button);
      bindFeedback(btn, ch.button, on => col.classList.toggle("is-on", on));
      col.append(fader.readout, fader.root, btn);
      strip.append(col);
    });
  }

  /* ---------- Clock & status ---------- */
  function startClock() {
    const t = $("#clock-time"), d = $("#clock-date");
    const tick = () => {
      const now = new Date();
      t.textContent = now.toLocaleTimeString(C.ui.locale, { hour: "2-digit", minute: "2-digit", hour12: !C.ui.clock24h });
      d.textContent = now.toLocaleDateString(C.ui.locale, { weekday: "long", day: "numeric", month: "long" });
    };
    tick(); setInterval(tick, 10000);
  }

  function startStatus() {
    const s = $("#conn-status");
    if (B.transport === "sim") { s.textContent = L.sim; s.dataset.state = "sim"; return; }
    B.onConnection(on => { s.textContent = on ? L.connected : L.noContact; s.dataset.state = on ? "ok" : "down"; });
  }

  /* ---------- Simulator seed (browser demo only) ---------- */
  function seedSim() {
    const S = B.Sim;
    C.zones.forEach(z => {
      S.rules.toggle.add(String(z.select));
      C.sources.forEach((s, i) => S.rules.toggle.add(String(routeJoin(z, s, i))));   // each source is on/off per zone
      // only one of the "exclusive" sources per zone (legacy per-source flag + exclusive source groups)
      S.rules.exclusive.push(C.sources.map((s, i) => s.exclusive ? String(routeJoin(z, s, i)) : null).filter(Boolean));
      ExclusiveGroups.forEach(g => S.rules.exclusive.push(g.idx.map(i => String(routeJoin(z, C.sources[i], i)))));
    });
    C.mixer.forEach(ch => S.rules.toggle.add(String(ch.button)));

    const seed = {
      restaurant: [["music1", "led"],  0.62, true],
      reception:  [["radio"],          0.48, true],
      meeting:    [["mic1", "xlr"],    0.70, false],
      office:     [["music2"],         0.35, true],
      send:       [["mic1", "music1"], 0.55, false],
    };
    C.zones.forEach(z => {
      const [srcs, vol, on] = seed[z.id] || [[], 0.5, false];
      S.set("b", z.select, on);
      S.set("n", z.volume, Math.round(vol * MAX));
      srcs.forEach(src => { const i = C.sources.findIndex(s => s.id === src); S.set("b", routeJoin(z, C.sources[i], i), true); });
    });
    const lv = [0.72, 0.68, 0.0, 0.0, 0.8, 0.55, 0.5, 0.6, 0.65, 0.4];
    C.mixer.forEach((ch, i) => { S.set("n", ch.level, Math.round(lv[i] * MAX)); S.set("b", ch.button, lv[i] > 0); });
  }

  /* ---------- boot ---------- */
  function init() {
    document.title = C.site.area ? `${C.site.name} – ${C.site.area}` : C.site.name;
    if (B.transport === "sim") seedSim();
    buildNav(); buildZones(); Groups.build(); buildMixer();
    startClock(); startStatus();
    document.body.classList.add("is-ready");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
