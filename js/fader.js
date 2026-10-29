/* ------------------------------------------------------------------
   DSP Panel – fader component
   ------------------------------------------------------------------
   A touch/mouse/keyboard fader (0..MAX) with a dB readout. Follows the
   finger 1:1 while dragging, holds its position until DSP feedback has
   settled after release, and glides to values arriving from elsewhere.
     Panel.createFader({ orientation, label, send, subscribe, range })
     Panel.joinFader(join, orientation, label, range)
   ------------------------------------------------------------------ */
(function () {
  "use strict";
  const { C, B, MAX, el, pct, State } = window.Panel;

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
    // After a drag the knob stays where the finger left it until the feedback has settled: a group fader fans
    // out to several zones and the DSP reports them back one at a time (paced), so the running average would
    // wobble. Feedback is applied once nothing new has arrived for 500 ms (or after 4 s at most).
    let holding = false, pending = null, settleTimer = null, holdMaxTimer = null;
    const settle = () => { clearTimeout(settleTimer); clearTimeout(holdMaxTimer); holding = false; if (pending != null && !dragging) { value = pending; render(value); } pending = null; };
    const end   = e => { if (!dragging) return; dragging = false; root.classList.remove("is-dragging"); send(fromPointer(e), true);
      holding = true; pending = null; clearTimeout(settleTimer); settleTimer = setTimeout(settle, 500); clearTimeout(holdMaxTimer); holdMaxTimer = setTimeout(settle, 4000); };
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

    subscribe(v => { const nv = Number(v) || 0; if (dragging) { pending = nv; return; } if (holding) { pending = nv; clearTimeout(settleTimer); settleTimer = setTimeout(settle, 500); return; } value = nv; render(value); });

    const nudge = dir => send(value + dir * MAX * (C.ui.volumeStepPercent / 100), true);
    return { root, readout, nudge, get value() { return value; } };
  }
  const joinFader = (join, orientation, label, range) => createFader({
    orientation, label, range,
    send: v => B.publish("n", join, v),
    subscribe: cb => { State.watch("n", join); B.subscribe("n", join, cb); },
  });

  Object.assign(window.Panel, { createFader, joinFader, fmtLevel });
})();
