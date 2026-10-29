/* ------------------------------------------------------------------
   DSP Panel – core: shared state and helpers for the panel scripts
   ------------------------------------------------------------------
   Loaded after config.js, i18n.js and bridge.js. Sets up language,
   per-screen scale, theme and layout, and exposes the building blocks
   the other scripts use through window.Panel:
     C (config), B (transport), L (texts), MAX, $, el, svgIcon, pct,
     State (join feedback store), bindMomentary/bindJoinButton/bindFeedback,
     routeJoin, zoneById, sourceById, srcHint, srcLabel, applyTheme
   ------------------------------------------------------------------ */
window.Panel = (function () {
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

  /* Tap button: the join goes high→low when the finger lifts on the button without having moved.
     Acting on release (not on touch-down) means a sideways swipe that starts on a button scrolls
     the zone row without toggling anything. */
  const TAP_SLOP = 10;   // px of movement that turns a tap into a scroll
  function bindMomentary(node, onPress, onRelease) {
    let down = false, sx = 0, sy = 0, moved = false;
    const clear = () => { down = false; node.classList.remove("is-pressed"); };
    node.addEventListener("pointerdown", e => {
      if (e.button !== undefined && e.button !== 0) return;
      down = true; moved = false; sx = e.clientX; sy = e.clientY; node.classList.add("is-pressed");
    });
    node.addEventListener("pointermove", e => { if (down && (Math.abs(e.clientX - sx) > TAP_SLOP || Math.abs(e.clientY - sy) > TAP_SLOP)) { moved = true; clear(); } });
    node.addEventListener("pointerup", e => { if (!down) return; clear(); if (!moved) { onPress(); setTimeout(onRelease, 80); } });
    node.addEventListener("pointercancel", clear);     // the browser took the gesture (scroll) – no tap
    node.addEventListener("pointerleave", () => { if (down) clear(); });
    node.addEventListener("keydown", e => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (!e.repeat) { onPress(); setTimeout(onRelease, 80); } } });
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


  return { C, B, L, MAX, $, el, svgIcon, pct, State, bindMomentary, bindJoinButton, bindFeedback, routeJoin, zoneById, sourceById, srcHint, srcLabel, applyTheme };
})();
