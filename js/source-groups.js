/* ------------------------------------------------------------------
   DSP Panel – source groups
   ------------------------------------------------------------------
   A source group is a set of sources with a shared behaviour:
     "toggle"     one button (per zone card / group card) that turns the
                  whole set on or off; state is all / some / none
     "exclusive"  only one member on per zone – enforced by the bridge,
                  mirrored in the simulator (see app.js seedSim)
   ------------------------------------------------------------------ */
(function () {
  "use strict";
  const { C, B, L, el, svgIcon, State } = window.Panel;

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
  Object.assign(window.Panel, { SourceGroups, ExclusiveGroups, sourceGroupRow });
})();
