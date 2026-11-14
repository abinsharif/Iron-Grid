/* IRON GRID graphics - fog-of-war-safe event filtering.
 * The server is the real authority (it already redacts what the player may not see); this module is a
 * second, client-side line of defence shared by EVERY renderer. Rules:
 *   - movement entirely in fog is never animated;
 *   - visible -> fog: the unit slides to the nearest fog tile beside its VISIBLE start and fades out.
 *     The real destination is never used;
 *   - fog -> visible: the unit fades in from the nearest fog tile beside its VISIBLE destination.
 *     The real origin is never used;
 *   - captures / combat on tiles the player cannot see (and does not own) are dropped.
 * Only information the current player is allowed to have is read. */
(function (G) {
  "use strict";
  const FogSafe = {
    /** Nearest tile that is NOT visible, from a visible reference tile. Scan order is fixed (never
     *  derived from any hidden coordinate). Returns [x, y] or null when everything is visible. */
    edgeTile(visible, W, H, ref) {
      const [rx, ry] = ref, max = Math.max(W, H);
      for (let r = 1; r <= max; r++) {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = rx + dx, y = ry + dy;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          if (!visible.has(x + "," + y)) return [x, y];
        }
      }
      return null;
    },
    /** ctx: {visible:Set, W, H, buildings:[...]}. Returns a safe copy of the event, or null to skip it. */
    sanitize(e, ctx) {
      const vis = (x, y) => ctx.visible.has(x + "," + y);
      if (e.t === "move") {
        if (!e.from_vis && !e.to_vis) return null;
        const out = Object.assign({}, e, { u: Object.assign({}, e.u) });
        if (e.from_vis && e.to_vis) return out;
        delete out.path;                                     // a route that touches the fog is never used
        if (e.from_vis) {                                   // walks into the dark
          const edge = FogSafe.edgeTile(ctx.visible, ctx.W, ctx.H, e.from) || e.from;
          out.to = edge.slice(); out.u.x = edge[0]; out.u.y = edge[1]; out.fade = "out";
        } else {                                            // emerges from the dark
          const edge = FogSafe.edgeTile(ctx.visible, ctx.W, ctx.H, e.to) || e.to;
          out.from = edge.slice(); out.fade = "in";
        }
        return out;
      }
      if (e.t === "capture") {
        const own = (ctx.buildings || []).some(b => b.x === e.x && b.y === e.y && b.side === "P");
        return (vis(e.x, e.y) || own) ? e : null;
      }
      if (e.t === "combat") {
        if (!(e.d.side === "P" || vis(e.d.x, e.d.y))) return null;
        if (e.a && !(e.a.side === "P" || vis(e.a.x, e.a.y))) return Object.assign({}, e, { a: null });
        return e;
      }
      return e;
    },
  };
  G.FogSafe = FogSafe;
})(window.GFX = window.GFX || {});
