/* ------------------------------------------------------------------
   DSP Panel – zone groups
   ------------------------------------------------------------------
   A group is a set of zone ids. Presets come from the config; users
   can make their own on the panel (kept in localStorage). Actions fan
   out to the members; state is derived from member feedback.
   ------------------------------------------------------------------ */
(function () {
  "use strict";
  const { C, B, L, MAX, $, el, svgIcon, State, createFader, routeJoin, zoneById, srcHint, srcLabel, sourceGroupRow } = window.Panel;

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

  window.Panel.Groups = Groups;
})();
