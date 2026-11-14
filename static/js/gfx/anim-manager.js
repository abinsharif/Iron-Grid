/* IRON GRID graphics - central animation timing.
 * One speed percentage (0-200, default 100) drives every animation in every renderer.
 * 0 = animations off. 100 reproduces the original (pre-graphics-upgrade) default timing exactly.
 * Visual only: nothing here is ever sent to, or read by, the server. */
(function (G) {
  "use strict";
  const BASE = 0.888;                   // legacy default timing multiplier (old slider value 57)
  class AnimManager {
    constructor() { this.pct = 100; this._subs = new Set(); }
    setPercent(p) {
      p = Math.max(0, Math.min(200, Math.round(+p)));
      if (Number.isNaN(p) || p === this.pct) return;
      this.pct = p;
      for (const fn of this._subs) { try { fn(p); } catch (e) { /* a bad listener must not block others */ } }
    }
    get enabled() { return this.pct > 0; }
    /** Scale a base duration (ms). Returns 0 when animations are off. */
    dur(ms) { return this.pct <= 0 ? 0 : ms * BASE * 100 / this.pct; }
    /** Scale a base speed (units per second); 0 when off. */
    rate(v) { return this.pct <= 0 ? 0 : v * this.pct / 100 / BASE; }
    sleep(ms) { const d = this.dur(ms); return d ? new Promise(r => setTimeout(r, d)) : Promise.resolve(); }
    onChange(fn) { this._subs.add(fn); return () => this._subs.delete(fn); }
    static label(p) {
      return p <= 0 ? "Off" : p <= 37 ? "Very slow" : p <= 62 ? "Slow" : p <= 87 ? "Slightly slow"
        : p <= 112 ? "Normal" : p <= 175 ? "Fast" : "Very fast";
    }
    /** Migrate the old 0-100 'animspeed' value (default 57) to the new percentage. */
    static fromLegacy(s) {
      if (s === undefined || s === 57) return 100;
      if (s <= 0) return 0;
      return Math.max(25, Math.min(200, Math.round(100 * BASE / (1.8 - 1.6 * s / 100))));
    }
  }
  G.AnimManager = AnimManager;
  G.anim = new AnimManager();
})(window.GFX = window.GFX || {});
