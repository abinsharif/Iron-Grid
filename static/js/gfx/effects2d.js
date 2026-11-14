/* IRON GRID 2D - combat/capture effects.
 * Driven only by fog-safe game events (combat: attacker/defender snapshots, indirect flag, kill flags; capture). The
 * weapon category comes from the real unit type; nothing here changes game state. Each effect id can be replaced by a
 * sprite sheet through the asset manifest (frames, frame_ms, loop, ...); until then a procedural animation plays.
 * All timings go through GFX.anim, so 0% plays nothing and 200% plays twice as fast. */
(function (G) {
  "use strict";
  const T = 44, L = 22, TAU = Math.PI * 2;
  const px = x => L + x * T + T / 2;
  const jit = (s, i) => { let h = Math.imul((s | 0) + i * 7919 + 1, 2654435761); h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13; return ((h >>> 0) / 4294967296); };

  /** weapon category per unit type: muzzle effect id + projectile style (all ids exist in the game data) */
  const WEAPON = {
    inf: ["infantry", "muzzle_infantry", "bullet"], sf: ["infantry", "muzzle_infantry", "bullet"], at: ["infantry", "muzzle_infantry", "rocket1"],
    mbt: ["tank", "muzzle_tank", "tankshell"], ht: ["tank", "muzzle_tank", "tankshell"], afv: ["tank", "muzzle_tank", "burst"], ifv: ["tank", "muzzle_tank", "burst"], cv: ["tank", "muzzle_tank", "burst"],
    mrl: ["artillery", "muzzle_artillery", "rocket"], how: ["artillery", "muzzle_artillery", "shell"], mortar: ["artillery", "muzzle_artillery", "mortar"],
    aa: ["aa", "muzzle_aa", "flak"], sam: ["sam", "muzzle_aa", "missile"],
    heli: ["air", "muzzle_air", "burst"], ah: ["air", "muzzle_air", "rocket1"], th: ["air", "muzzle_air", "burst"], jet: ["air", "muzzle_air", "missile"],
    intr: ["air", "muzzle_air", "missile"], sb: ["air", "muzzle_air", "bomb"], td: ["air", "muzzle_air", "burst"], drone: ["air", "muzzle_air", "burst"], uav: ["air", "muzzle_air", "burst"],
    cor: ["naval", "muzzle_naval", "navalshell"], fr: ["naval", "muzzle_naval", "navalshell"], dd: ["naval", "muzzle_naval", "navalshell"], ca: ["naval", "muzzle_naval", "salvo"], sub: ["naval", "muzzle_naval", "torpedo"],
  };
  const DEFAULT_MS = { muzzle: 150, impact: 260, boom: 460, capture: 560, smoke: 900 };

  class Effects2D {
    constructor() { this.list = []; }
    clear() { this.list = []; }
    get active() { return this.list.length > 0; }

    play(e, A, unitCls) {
      if (!G.anim.enabled) return;
      const D = ms => G.anim.dur(ms), now = performance.now(), seed = (now * 1000) | 0;
      const add = o => { o.seed = seed + this.list.length; this.list.push(o); if (this.list.length > 70) this.list.shift(); return o.t0 + o.dur; };
      const dur = (id, def) => { const d = A.duration("effects", id); return d || D(def); };
      if (e.t === "capture") { add({ k: "capture", id: "capture", x: e.x, y: e.y, side: e.side, t0: now, dur: dur("capture", DEFAULT_MS.capture) }); return; }
      if (e.t === "bldhit") e = { t: "combat", a: e.a, d: { x: e.x, y: e.y, type: "bld" }, dk: e.dk, counter: 0 };   // a hit on a structure
      if (e.t !== "combat") return;
      const d = e.d, a = e.a;
      const volley = (from, to, t0) => {
        const [cat, mu, pr] = WEAPON[from.type] || WEAPON.mbt, dist = Math.hypot(to.x - from.x, to.y - from.y), ang = Math.atan2(to.y - from.y, to.x - from.x);
        add({ k: "muzzle", id: mu, cat, x: from.x, y: from.y, ang, t0, dur: dur(mu, DEFAULT_MS.muzzle) });
        const fly = { bullet: 150, burst: 200, tankshell: 150, rocket1: 220 + 55 * dist, rocket: 260 + 70 * dist, shell: 240 + 85 * dist, mortar: 300 + 100 * dist, navalshell: 200 + 70 * dist,
                      salvo: 240 + 75 * dist, flak: 200, missile: 200 + 80 * dist, bomb: 380, torpedo: 280 + 130 * dist }[pr];
        const pdur = D(Math.min(fly, 760)), pt0 = t0 + D(70);
        add({ k: "proj", id: pr === "shell" || pr === "mortar" || pr === "navalshell" || pr === "salvo" ? "shell" : pr === "missile" || pr === "rocket1" || pr === "rocket" ? (pr === "missile" ? "missile" : "rocket") : null,
              pr, x: from.x, y: from.y, tx: to.x, ty: to.y, ang, dist, t0: pt0, dur: pdur });
        return pt0 + pdur;
      };
      const hitFx = (to, t0, killed) => {
        const cls = unitCls(to.type), air = cls === "air", sea = cls === "sea";
        const iid = air ? "impact_air" : sea ? "impact_water" : "impact_ground";
        add({ k: "impact", id: iid, kind: air ? "air" : sea ? "water" : "ground", x: to.x, y: to.y, t0, dur: dur(iid, DEFAULT_MS.impact) });
        if (killed) { const bid = air ? "explosion_air" : sea ? "explosion_naval" : "explosion_ground";
          add({ k: "boom", id: bid, kind: air ? "air" : sea ? "water" : "ground", x: to.x, y: to.y, t0: t0 + D(70), dur: dur(bid, DEFAULT_MS.boom) }); }
      };
      if (a) {
        const t1 = volley(a, d, now);
        hitFx(d, t1, e.dk);
        if (e.counter && !e.dk) { const t2 = volley(d, a, t1 + D(160)); hitFx(a, t2, e.ak); }
        else if (e.ak) hitFx(a, t1 + D(160), true);
      } else hitFx(d, now + D(60), e.dk);          // attacker unseen / a coastal battery: show only what lands on the visible target
    }

    draw(g, f, P, A) {
      const now = f.now;
      this.list = this.list.filter(o => now < o.t0 + o.dur + 40);
      for (const o of this.list) {
        const el = now - o.t0, p = el / o.dur;
        if (p < 0 || p > 1) continue;
        const X = px(o.x), Y = px(o.y);
        if (o.id && o.k !== "proj" && this.sheet(g, A, o, X, Y, el)) continue;
        if (o.k === "muzzle") this.muzzle(g, o, p, X, Y);
        else if (o.k === "proj") this.proj(g, A, o, p, el);
        else if (o.k === "impact") this.impact(g, o, p, X, Y);
        else if (o.k === "boom") this.boom(g, o, p, X, Y);
        else if (o.k === "capture") this.capture(g, o, p, X, Y, P);
      }
    }
    sheet(g, A, o, X, Y, el) {
      const fr = A.frame("effects", o.id, el);
      if (!fr) return false;
      const e = fr.e, sc = e.scale || 1, w = fr.sw / A.ppt * T * sc, h = fr.sh / A.ppt * T * sc, an = e.anchor || [.5, .5];
      g.save(); g.translate(X, Y);
      if (o.ang !== undefined && e.rotate !== false) g.rotate(o.ang);
      if (!(e.frames > 1)) { const p = el / o.dur; g.globalAlpha = 1 - p * p; g.scale(.85 + .4 * p, .85 + .4 * p); }
      g.drawImage(fr.img, fr.sx, fr.sy, fr.sw, fr.sh, -w * an[0], -h * an[1], w, h); g.restore();
      return true;
    }
    // ---------------------------------------------------------------- procedural fallbacks
    muzzle(g, o, p, X, Y) {
      g.save(); g.translate(X, Y); g.rotate(o.ang); g.globalAlpha = 1 - p;
      const k = { infantry: .55, tank: 1.1, artillery: 1.5, air: .8, naval: 1.6, aa: .8, sam: 1 }[o.cat] || 1, flame = (c1, c2, len, wd) => {
        g.fillStyle = c1; g.beginPath(); g.moveTo(8, 0); g.lineTo(8 + len, -wd); g.lineTo(8 + len * .62, 0); g.lineTo(8 + len, wd); g.closePath(); g.fill();
        g.fillStyle = c2; g.beginPath(); g.arc(9, 0, wd * .75, 0, TAU); g.fill(); };
      if (o.cat === "infantry") flame("#ffe27a", "#fff", 8 * k * 2, 2.2);
      else if (o.cat === "air") { for (const s of [-5, 5]) { g.save(); g.translate(0, s); flame("#ffd27a", "#fff", 8, 2); g.restore(); } }
      else if (o.cat === "aa" || o.cat === "sam") { flame("#ffe9a0", "#fff", 7, 2.4); g.fillStyle = "rgba(210,210,210,.55)"; g.beginPath(); g.arc(-4 - 6 * p, 0, 3 + 7 * p, 0, TAU); g.fill(); }
      else { flame("#ffb347", "#fff6c8", 10 * k, 4 * k * (1 - p * .5)); g.fillStyle = "rgba(190,190,190,.5)"; g.beginPath(); g.arc(12 + 12 * p * k, -2, 3 * k + 7 * p * k, 0, TAU); g.fill(); }
      g.restore();
    }
    proj(g, A, o, p, el) {
      const x0 = px(o.x), y0 = px(o.y), x1 = px(o.tx), y1 = px(o.ty), dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
      let curve = false;                                                  // missiles bend sideways; salvos fly in parallel
      const at = (q, arc, side) => { const lat = curve ? side * Math.sin(Math.PI * q) : side;
        return [x0 + dx * q + nx * lat, y0 + dy * q + ny * lat - Math.sin(Math.PI * q) * arc]; };
      const sprite = (id, q, arc, side) => {
        const [sx, sy] = at(q, arc, side), [ax, ay] = at(Math.min(1, q + .02), arc, side), ang = Math.atan2(ay - sy, ax - sx);
        const fr = id && A.frame("effects", id, el);
        if (!fr) return [sx, sy, ang, false];
        const e = fr.e, w = fr.sw / A.ppt * T * (e.scale || 1), h = fr.sh / A.ppt * T * (e.scale || 1);
        g.save(); g.translate(sx, sy); g.rotate(ang); g.drawImage(fr.img, fr.sx, fr.sy, fr.sw, fr.sh, -w / 2, -h / 2, w, h); g.restore();
        return [sx, sy, ang, true];
      };
      const trail = (q, arc, side, col, n, wd) => { for (let i = 1; i <= n; i++) { const [tx, ty] = at(Math.max(0, q - i * .045), arc, side);
        g.fillStyle = col.replace("A", String((.5 - i * (.5 / (n + 1))).toFixed(2))); g.beginPath(); g.arc(tx, ty, wd + i * .35, 0, TAU); g.fill(); } };
      g.save();
      switch (o.pr) {
        case "bullet": case "burst": {
          const n = o.pr === "bullet" ? 3 : 5;
          for (let i = 0; i < n; i++) { const q = Math.min(1, Math.max(0, p * 1.3 - i * .12)); if (q <= 0 || q >= 1) continue;
            const hx = x0 + dx * q + (jit(o.seed, i) - .5) * 3, hy = y0 + dy * q + (jit(o.seed, i + 9) - .5) * 3, tq = Math.max(0, q - .16);
            g.strokeStyle = o.pr === "bullet" ? "#ffe27a" : "#ffd27a"; g.lineWidth = o.pr === "bullet" ? 1.3 : 1.8; g.lineCap = "round";
            g.beginPath(); g.moveTo(x0 + dx * tq, y0 + dy * tq); g.lineTo(hx, hy); g.stroke(); } break; }
        case "tankshell": { const hq = p, tq = Math.max(0, p - .28); g.lineCap = "round"; g.strokeStyle = "rgba(255,150,60,.55)"; g.lineWidth = 5; g.beginPath(); g.moveTo(x0 + dx * tq, y0 + dy * tq); g.lineTo(x0 + dx * hq, y0 + dy * hq); g.stroke();
          g.strokeStyle = "#fff0b8"; g.lineWidth = 2.2; g.stroke(); break; }
        case "flak": for (let i = 0; i < 4; i++) { const q = Math.min(1, Math.max(0, p * 1.25 - i * .1)); if (q <= 0 || q >= 1) continue; const tq = Math.max(0, q - .2);
            g.strokeStyle = "#fff2c0"; g.lineWidth = 1.5; g.lineCap = "round"; g.beginPath(); g.moveTo(x0 + dx * tq, y0 + dy * tq - 3 * tq); g.lineTo(x0 + dx * q, y0 + dy * q - 3 * q); g.stroke(); }
          if (p > .55) for (let i = 0; i < 3; i++) { const bx = x1 + (jit(o.seed, i) - .5) * 20, by = y1 + (jit(o.seed, i + 5) - .5) * 16, r = 2 + (p - .55) * 9;
            g.fillStyle = `rgba(40,40,46,${.6 * (1 - p)})`; g.beginPath(); g.arc(bx, by, r, 0, TAU); g.fill(); } break;
        case "rocket1": case "rocket": {
          const n = o.pr === "rocket" ? 3 : 1;
          for (let i = 0; i < n; i++) { const q = Math.min(1, Math.max(0, p * 1.25 - i * .1)); if (q <= 0 || q >= 1) continue;
            const arc = o.pr === "rocket" ? Math.min(40, 8 + o.dist * 5) : 3, side = (i - (n - 1) / 2) * 7 * (o.pr === "rocket" ? 1 : 0);
            trail(q, arc, side, "rgba(235,235,230,A)", 6, 1.6);
            const [sx, sy, ang, drew] = sprite("rocket", q, arc, side);
            if (!drew) { g.save(); g.translate(sx, sy); g.rotate(ang); g.fillStyle = "#d9dde3"; g.fillRect(-4, -1.1, 8, 2.2); g.fillStyle = "#c9453a"; g.fillRect(3, -1.1, 2.4, 2.2);
              g.fillStyle = "#ffb347"; g.beginPath(); g.moveTo(-4, 0); g.lineTo(-8, -1.6); g.lineTo(-8, 1.6); g.fill(); g.restore(); } } break; }
        case "shell": case "mortar": case "navalshell": case "salvo": {
          const n = o.pr === "salvo" ? 2 : 1, hi = o.pr === "mortar" ? 1.3 : o.pr === "navalshell" || o.pr === "salvo" ? .45 : 1;
          for (let i = 0; i < n; i++) { const q = Math.min(1, Math.max(0, p * 1.15 - i * .12)); if (q <= 0 || q >= 1) continue;
            const arc = (Math.min(1.6, .25 * o.dist) * T * .9 + 6) * hi, side = n > 1 ? (i - .5) * 8 : 0;
            trail(q, arc, side, "rgba(255,236,190,A)", 4, 1.1);
            const [sx, sy, ang, drew] = sprite("shell", q, arc, side);
            if (!drew) { g.save(); g.translate(sx, sy); g.rotate(ang); g.fillStyle = "#33373e"; g.fillRect(-3.4, -1.5, 6.8, 3); g.fillStyle = "#ff8a3c"; g.fillRect(2, -1.5, 2.6, 3); g.restore(); } }
          const sq = Math.min(1, p * 1.15);                                                    // landing marker that grows as the shell comes down
          g.strokeStyle = `rgba(255,120,60,${.45 * sq})`; g.lineWidth = 1.4; g.beginPath(); g.arc(x1, y1, 9 - 5 * sq, 0, TAU); g.stroke(); break; }
        case "missile": {
          curve = true;
          const arc = Math.min(14, 3 + o.dist * 2.5), side = (jit(o.seed, 3) > .5 ? 1 : -1) * Math.min(10, 2 + o.dist * 1.6);
          trail(p, arc, side, "rgba(225,225,225,A)", 8, 1.7);
          const [sx, sy, ang, drew] = sprite("missile", p, arc, side);
          if (!drew) { g.save(); g.translate(sx, sy); g.rotate(ang); g.fillStyle = "#e6e9ee"; g.fillRect(-5, -1.3, 10, 2.6); g.fillStyle = "#c9453a"; g.beginPath(); g.moveTo(5, -1.3); g.lineTo(8, 0); g.lineTo(5, 1.3); g.fill();
            g.fillStyle = "#ffb347"; g.beginPath(); g.moveTo(-5, 0); g.lineTo(-10 - 2 * jit(o.seed, Math.floor(p * 20)), -1.6); g.lineTo(-10, 1.6); g.fill(); g.restore(); } break; }
        case "bomb": { const fall = p * p, sc = 1.9 - .9 * fall;                                  // dropped from above: appears larger, shrinks onto the target
          g.fillStyle = `rgba(0,0,0,${.25 * fall})`; g.beginPath(); g.ellipse(x1, y1, 5 * fall + 1, 2.4 * fall + .6, 0, 0, TAU); g.fill();
          g.save(); g.translate(x1, y1 - (1 - fall) * 34); g.scale(sc, sc); g.rotate(Math.PI / 2 + (1 - fall) * .3); g.fillStyle = "#3b4048"; g.beginPath(); g.ellipse(0, 0, 4.2, 2, 0, 0, TAU); g.fill();
          g.fillStyle = "#c9453a"; g.fillRect(2.6, -1.2, 1.8, 2.4); g.restore(); break; }
        case "torpedo": { const hx = x0 + dx * p, hy = y0 + dy * p; g.lineCap = "round"; g.strokeStyle = "rgba(255,255,255,.7)"; g.lineWidth = 2; g.setLineDash([3, 3]);
          g.beginPath(); g.moveTo(x0, y0); g.lineTo(hx, hy); g.stroke(); g.setLineDash([]); g.fillStyle = "#cfd5dc"; g.beginPath(); g.arc(hx, hy, 2.2, 0, TAU); g.fill(); break; }
      }
      g.restore();
    }
    impact(g, o, p, X, Y) {
      g.save(); g.translate(X, Y);
      if (o.kind === "air") {                              // flak burst
        for (let i = 0; i < 4; i++) { const a = jit(o.seed, i) * TAU, r = 3 + 9 * p, rr = 3.5 + 5 * p; g.fillStyle = `rgba(35,35,42,${.7 * (1 - p)})`; g.beginPath(); g.arc(Math.cos(a) * r * .6, Math.sin(a) * r * .6, rr, 0, TAU); g.fill(); }
        g.fillStyle = `rgba(255,190,80,${1 - p * 1.4 > 0 ? 1 - p * 1.4 : 0})`; g.beginPath(); g.arc(0, 0, 6 * (1 - p * .6), 0, TAU); g.fill();
      } else if (o.kind === "water") {                     // splash
        g.strokeStyle = `rgba(255,255,255,${.85 * (1 - p)})`; g.lineWidth = 2; g.beginPath(); g.ellipse(0, 2, 4 + 15 * p, 2 + 7 * p, 0, 0, TAU); g.stroke();
        g.fillStyle = `rgba(235,248,255,${.9 * (1 - p)})`; g.beginPath(); g.moveTo(-3, 2); g.quadraticCurveTo(0, -14 * Math.sin(Math.PI * Math.min(1, p * 1.4)), 3, 2); g.closePath(); g.fill();
      } else {                                              // ground hit: flash, dust ring, sparks
        g.fillStyle = `rgba(255,236,170,${Math.max(0, 1 - p * 2)})`; g.beginPath(); g.arc(0, 0, 8 * (1 - p), 0, TAU); g.fill();
        g.strokeStyle = `rgba(210,185,140,${.8 * (1 - p)})`; g.lineWidth = 2.4 * (1 - p) + .6; g.beginPath(); g.arc(0, 0, 4 + 14 * p, 0, TAU); g.stroke();
        g.fillStyle = `rgba(255,190,90,${1 - p})`; for (let i = 0; i < 7; i++) { const a = jit(o.seed, i) * TAU, r = (5 + jit(o.seed, i + 20) * 12) * p; g.fillRect(Math.cos(a) * r, Math.sin(a) * r, 1.8, 1.8); }
      }
      g.restore();
    }
    boom(g, o, p, X, Y) {
      g.save(); g.translate(X, Y);
      const r = 8 + 15 * Math.sqrt(p), fade = 1 - p * p;
      if (o.kind === "water") { g.strokeStyle = `rgba(255,255,255,${.7 * fade})`; g.lineWidth = 2.5; g.beginPath(); g.ellipse(0, 2, 6 + 22 * p, 3 + 10 * p, 0, 0, TAU); g.stroke(); }
      g.globalAlpha = fade;
      g.fillStyle = "#ff6a22"; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
      g.fillStyle = "#ffc23a"; g.beginPath(); g.arc(-1.5, -1, r * .66, 0, TAU); g.fill();
      g.fillStyle = "#fff4c8"; g.beginPath(); g.arc(-2, -2, r * .3, 0, TAU); g.fill();
      g.fillStyle = `rgba(55,55,60,${.55 * fade})`; g.beginPath(); g.arc(4, -6 - 12 * p, r * .55 + 4 * p, 0, TAU); g.fill();
      if (o.kind === "air") { g.strokeStyle = `rgba(70,70,76,${.6 * fade})`; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(-6, 10 + 14 * p, -3, 22 + 14 * p); g.stroke(); }
      g.fillStyle = "#ffb347"; for (let i = 0; i < 8; i++) { const a = jit(o.seed, i) * TAU, rr = (8 + jit(o.seed, i + 30) * 16) * Math.sqrt(p) + 4; g.fillRect(Math.cos(a) * rr, Math.sin(a) * rr, 2, 2); }
      g.restore();
    }
    capture(g, o, p, X, Y, P) {
      const col = o.side === "P" ? P.P : P.A;
      g.save(); g.translate(X, Y); g.globalAlpha = 1 - p * p; g.strokeStyle = col; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, 8 + 16 * p, 0, TAU); g.stroke();
      g.lineWidth = 1.5; g.beginPath(); g.arc(0, 0, 4 + 10 * p, 0, TAU); g.stroke();
      g.fillStyle = "#444"; g.fillRect(-1, -15 - 5 * p, 1.8, 16); g.fillStyle = col; g.beginPath(); g.moveTo(.8, -15 - 5 * p); g.lineTo(11, -11.5 - 5 * p + Math.sin(p * 18)); g.lineTo(.8, -8 - 5 * p); g.fill(); g.restore();
    }
  }
  G.Effects2D = Effects2D;
})(window.GFX = window.GFX || {});
