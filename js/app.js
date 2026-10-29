/* ------------------------------------------------------------------
   DSP Panel – app: builds the views and boots the panel
   ------------------------------------------------------------------
   Views (local to this screen), zone cards, mixer strip, clock and
   status badge, plus the simulator seed used when index.html is opened
   without a bridge. Shared helpers live in core.js; the fader, source
   groups and zone groups have their own files.
   ------------------------------------------------------------------ */
(function () {
  "use strict";
  const { C, B, L, MAX, $, el, svgIcon, State, bindJoinButton, bindFeedback, joinFader, routeJoin, sourceById, srcHint, srcLabel, sourceGroupRow, ExclusiveGroups, Groups } = window.Panel;

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

    // a believable demo state: a few zones on with a source or two, varied volumes
    const seed = [[[0, 4], 0.62, true], [[7], 0.48, true], [[0, 1], 0.70, false], [[5], 0.35, true], [[0, 4], 0.55, false]];
    C.zones.forEach((z, zi) => {
      const [srcIdx, vol, on] = seed[zi % seed.length];
      S.set("b", z.select, on);
      S.set("n", z.volume, Math.round(vol * MAX));
      srcIdx.forEach(i => { if (C.sources[i]) S.set("b", routeJoin(z, C.sources[i], i), true); });
    });
    const lv = [0.72, 0.68, 0.0, 0.0, 0.8, 0.55, 0.5, 0.6, 0.65, 0.4];
    C.mixer.forEach((ch, i) => { const v = lv[i % lv.length]; S.set("n", ch.level, Math.round(v * MAX)); S.set("b", ch.button, v > 0); });
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
