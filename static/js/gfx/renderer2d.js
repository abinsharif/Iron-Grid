/* IRON GRID 2D - Renderer2D: the complete top-down graphical board.
 * Same canvas, grid, labels, zoom/pan and tile picking as Classic (it extends ClassicRenderer and draws in the same
 * logical 44px tile space under a uniform scale), so selection/range/forecast/float/cursor/tutorial overlays are Classic's
 * own code. It only ever draws the fog-filtered state it is handed and fog-safe events; cached images and procedural art
 * are keyed by type, never by hidden information. All motion is driven by the shared animation clock (0% = frozen). */
(function (G) {
  "use strict";
  const T = 44, L = 22, K = 64 / 44, TAU = Math.PI * 2;
  const PH = () => G.Placeholders2D, A = () => G.Assets2D;
  const AIR_SITES = ["airbase", "airfield", "HQ"];
  const LAYER = { sea: 0, foot: 1, tread: 2, air: 3 };
  const ROTARY = new Set(["heli", "ah", "th", "drone"]);
  const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

  class Renderer2D extends G.ClassicRenderer {
    constructor() {
      super(); this.id = "2d"; this.terrain = new G.TerrainPainter(); this.effects = new G.Effects2D();
      this.heading = new Map(); this.clock = 0; this._last = 0; this._turning = false; this._lastAmbient = 0;
    }
    async init(host) {
      super.init(host);
      await A().init();
      A().onLoad = () => { this.terrain.invalidate(); G.manager && G.manager.markDirty(); };
      this._onDispose(() => { A().onLoad = null; this.effects.clear(); this.heading.clear(); this.terrain = new G.TerrainPainter(); });
      return this;
    }

    // ---------------------------------------------------------------- geometry (logical coords * K = bitmap)
    setBoard({ w, h }) {
      this.W = w; this.H = h; this.zoom = 1; this.terrain.invalidate();
      this.canvas.width = Math.round((L + w * T) * K); this.canvas.height = Math.round((L + h * T) * K);
    }
    resize() {
      this.canvas.style.width = Math.round((L + this.W * T) * this.zoom) + "px";
      this.canvas.style.height = Math.round((L + this.H * T) * this.zoom) + "px";
      if (G.manager) G.manager.markDirty();
    }
    screenToTile(cx, cy) {
      const r = this.canvas.getBoundingClientRect(), sx = (L + this.W * T) / r.width, sy = (L + this.H * T) / r.height;
      const x = Math.floor(((cx - r.left) * sx - L) / T), y = Math.floor(((cy - r.top) * sy - L) / T);
      return (x >= 0 && y >= 0 && x < this.W && y < this.H) ? { x, y } : null;
    }
    tileToScreen(x, y) {
      const r = this.canvas.getBoundingClientRect(), kx = r.width / (L + this.W * T), ky = r.height / (L + this.H * T);
      const w = T * kx, h = T * ky, left = r.left + (L + x * T) * kx, top = r.top + (L + y * T) * ky;
      return { x: left, y: top, w, h, cx: left + w / 2, cy: top + h / 2 };
    }
    /** Frames are requested only while something animates: events, motion, turning, or ambient life (~25 fps) when animation is on. */
    needsFrame(f) {
      if (f.anim || f.floats.length || f.hover || (f.marks && f.marks.length) || this.effects.active || this._turning) return true;
      return G.anim.enabled && this.lodLevel() === 0 && f.now - this._lastAmbient >= 40;
    }
    exportImage(f, o) {
      const c = document.createElement("canvas"), bh = o.headerHeight;
      c.width = Math.round((L + f.W * T) * K); c.height = Math.round((L + f.H * T) * K) + bh;
      const t = c.getContext("2d"), P = G.classicPalette(this.prefs);
      t.fillStyle = P.bg; t.fillRect(0, 0, c.width, c.height);
      t.fillStyle = P.text; t.font = "bold 14px system-ui"; t.textBaseline = "middle"; t.textAlign = "left"; t.fillText(o.header, 8, bh / 2);
      t.translate(0, bh); this.drawScene(t, f, false);
      return new Promise(res => c.toBlob(res));
    }
    playEvent(e) { this.effects.play(e, A(), G.unitClass); G.manager && G.manager.markDirty(); }

    // ---------------------------------------------------------------- scene
    renderFrame(f) {
      const dt = this._last ? Math.min(0.1, (f.now - this._last) / 1000) : 0; this._last = f.now;
      this._dt = dt; this.clock += dt * G.anim.pct / 100; this._lastAmbient = f.now;
      this._f = f; this.drawScene(this.ctx, f, true);
    }
    drawScene(g, f, ui) {
      const P = G.classicPalette(this.prefs), W = f.W, H = f.H, cw = L + W * T, ch = L + H * T, lod = this.lodLevel();
      g.save(); g.scale(K, K); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
      g.fillStyle = P.bg; g.fillRect(0, 0, cw, ch);
      if (lod < 2) {
        g.font = "bold 11px system-ui"; g.fillStyle = P.lab; g.textAlign = "center"; g.textBaseline = "middle";
        for (let x = 0; x < W; x++) g.fillText(String.fromCharCode(65 + x), L + x * T + T / 2, L / 2);
        for (let y = 0; y < H; y++) g.fillText(String(y + 1), L / 2, L + y * T + T / 2);
      }
      const tp = this.terrain;
      if (lod === 0) {
        if (tp.needsBuild(f)) { tp.build(f, A()); tp.mark(f); }
        tp.drawStatic(g, f);
        tp.drawAnimated(g, f, this.clock, A(), !G.anim.enabled);
      } else {                                                    // zoomed far out: flat, cheap tiles (same level-of-detail rule as Classic)
        const GLY = { "=": "═", M: "▲", W: "≋", S: "⁞", F: "♣", B: "≡", U: "▦", R: "╬", "~": "∴", O: "≈" };
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          if (!f.terrain[y]) continue;
          const c = f.terrain[y][x], pair = P.tiles[c] || P.tiles["."];
          g.fillStyle = (x + y) % 2 ? pair[0] : pair[1]; g.fillRect(L + x * T, L + y * T, T, T);
          if (lod === 1 && GLY[c]) { g.fillStyle = P.glyph[c] || P.lab; g.font = "12px system-ui"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(GLY[c], L + x * T + T / 2, L + y * T + T / 2); }
        }
      }
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {                       // fog of war (same shading as Classic)
        const k = x + "," + y;
        if (!f.seen.has(k)) { g.fillStyle = "rgba(3,5,8,0.88)"; g.fillRect(L + x * T, L + y * T, T, T); }
        else if (!f.visible.has(k)) { g.fillStyle = "rgba(3,5,8,0.45)"; g.fillRect(L + x * T, L + y * T, T, T); }
      }
      if (lod < 2) {
        g.strokeStyle = "rgba(255,255,255,.05)"; g.lineWidth = 1;
        for (let x = 0; x <= W; x++) { g.beginPath(); g.moveTo(L + x * T, L); g.lineTo(L + x * T, ch); g.stroke(); }
        for (let y = 0; y <= H; y++) { g.beginPath(); g.moveTo(L, L + y * T); g.lineTo(cw, L + y * T); g.stroke(); }
      }
      this.drawBuildings(g, f, P);
      if (ui && f.sel) this.drawSelection(g, f, P);
      this.drawUnits(g, f, P);
      if (ui) { this.effects.draw(g, f, P, A()); this.drawMarks(g, f); this.drawForecast(g, f, P); this.drawFloats(g, f); this.drawCursor(g, f, P); }
      g.restore();
    }

    // ---------------------------------------------------------------- structures
    drawBuildings(g, f, P) {
      const state = f.state, t = this.clock, a = A(), lod = this.lodLevel();
      for (const b of state.buildings) {
        const x = L + b.x * T, y = L + b.y * T, col = b.side ? P[b.side] : "#9aa7bb";
        if (lod === 2) { g.globalAlpha = b.visible ? 1 : 0.55; g.fillStyle = col; g.fillRect(x + 12, y + 12, T - 24, T - 24); g.globalAlpha = 1; continue; }
        const q = state.queue && state.queue.find(o => o.x === b.x && o.y === b.y), producing = !!q;
        g.globalAlpha = b.visible ? 1 : 0.55;
        const lv = b.level || 1, ids = [];                                            // most specific supplied image wins
        if (b.side && lv > 1) ids.push(`${b.type}_${b.side}_L${lv}`);
        if (lv > 1) ids.push(`${b.type}_L${lv}`);
        if (b.side) ids.push(`${b.type}_${b.side}`);
        ids.push(b.type);
        let img = null, hit = null;
        for (const id of ids) { img = a.img("structures", id, 0); if (img) { hit = id; break; } }
        if (img) {                                                                      // supplied art (sizes come from the image, px_per_tile)
          const e = a.entry("structures", hit) || {}, w = img.width / a.ppt * T * (e.scale || 1), h = img.height / a.ppt * T * (e.scale || 1);
          g.drawImage(img, x + T / 2 - w / 2, y + T / 2 - h / 2, w, h);
          if (hit === b.type || hit === `${b.type}_L${lv}`) { g.fillStyle = col; g.fillRect(x + 3, y + 2, 14, 3.5); }   // neutral art: add the owner stripe
        } else { g.save(); g.translate(x, y); PH().structure(g, b.type, col, { t, producing, owned: !!b.side, level: lv }); g.restore(); }
        g.strokeStyle = col; g.lineWidth = 1.5; g.strokeRect(x + 1.5, y + 1.5, T - 3, T - 3);
        if (producing && lod === 0) {                                                  // production in progress: pulsing amber frame + turning gear
          g.strokeStyle = `rgba(255,180,60,${.5 + .4 * Math.sin(t * 5)})`; g.lineWidth = 2.5; g.strokeRect(x + 3, y + 3, T - 6, T - 6);
          g.save(); g.translate(x + 9, y + 9); g.rotate(t * 2.2); g.fillStyle = "#ffb454"; g.strokeStyle = "rgba(0,0,0,.6)"; g.lineWidth = 1;
          for (let i = 0; i < 8; i++) { g.rotate(TAU / 8); g.fillRect(-1.4, -8, 2.8, 3.4); } g.beginPath(); g.arc(0, 0, 5.6, 0, TAU); g.fill(); g.stroke();
          g.fillStyle = "#3b2a10"; g.beginPath(); g.arc(0, 0, 2.2, 0, TAU); g.fill(); g.restore();
          g.font = "bold 10px system-ui"; g.textAlign = "center"; g.textBaseline = "middle"; g.lineWidth = 2.6; g.strokeStyle = "rgba(0,0,0,.8)";
          g.strokeText(String(q.left), x + 9, y + 9.5); g.fillStyle = "#fff"; g.fillText(String(q.left), x + 9, y + 9.5);
        }
        g.textAlign = "center"; g.textBaseline = "middle";
        if (b.level > 1 && lod === 0) { g.font = "bold 9px system-ui"; g.fillStyle = "#fff"; g.strokeStyle = "rgba(0,0,0,.75)"; g.lineWidth = 2.6; g.strokeText("L" + b.level, x + T - 9, y + 8); g.fillText("L" + b.level, x + T - 9, y + 8); }
        if (b.cap && lod === 0) { g.font = "bold 9px system-ui"; g.fillStyle = "#ffb454"; g.strokeStyle = "rgba(0,0,0,.75)"; g.lineWidth = 2.6;
          const s = `${b.cap.pts}/${b.cap.side === "P" ? (b.type === "HQ" ? 3 : 2) : "?"}`; g.strokeText(s, x + 8, y + T - 7); g.fillText(s, x + 8, y + T - 7); }
        if (b.hp !== undefined) { g.fillStyle = "rgba(0,0,0,.6)"; g.fillRect(x + 6, y + T - 8, T - 12, 4);
          g.fillStyle = b.hp / b.max_hp > 0.4 ? "#ffb454" : "#ff5d5d"; g.fillRect(x + 6, y + T - 8, (T - 12) * b.hp / b.max_hp, 4); }
        g.globalAlpha = 1;
      }
    }

    // ---------------------------------------------------------------- units
    drawUnits(g, f, P) {
      const st = f.state, now = f.now, a = f.anim, dt = this._dt || 0, stacks = {}, t = this.clock, as = A(), lod = this.lodLevel();
      const live = new Set(st.units.map(u => u.id)); for (const id of this.heading.keys()) if (!live.has(id)) this.heading.delete(id);
      this._turning = false;
      const units = st.units.slice().sort((p, q) => (LAYER[f.unitDef(p.type).cls] - LAYER[f.unitDef(q.type).cls]) || p.y - q.y || p.x - q.x);
      for (const u of units) {
        const def = f.unitDef(u.type), cls = def.cls, col = P[u.side], moving = !!(a && a.id === u.id), k = u.x + "," + u.y;
        const n = stacks[k] = (stacks[k] || 0) + 1, off = n > 1 ? 7 : 0;
        const [gx, gy] = this._unitPos(f, u), cx = L + gx * T + T / 2 + off, cy = L + gy * T + T / 2 - off;
        // heading eases toward the direction of travel (instant when animations are off)
        let h = this.heading.get(u.id);
        if (!h) { const base = u.side === "P" ? 0 : Math.PI; h = { cur: base, target: base }; this.heading.set(u.id, h); }
        if (moving && (a.tx !== a.fx || a.ty !== a.fy)) {
          if (a.path && a.path.length > 1) { const tt = Math.min(1, (now - a.start) / a.dur); h.target = G.pathAt(a.path, 1 - Math.pow(1 - tt, 2)).ang; }   // turn along the real route
          else h.target = Math.atan2(a.ty - a.fy, a.tx - a.fx);
        }
        const d = angDiff(h.cur, h.target);
        if (Math.abs(d) > .01) { if (!G.anim.enabled) h.cur = h.target; else { const step = Math.max(.001, 13 * dt * G.anim.pct / 100); h.cur += Math.abs(d) <= step ? d : Math.sign(d) * step; this._turning = true; } }
        const ang = h.cur, p = moving ? Math.min(1, (now - a.start) / a.dur) : 0;
        const spent = u.side === "P" && (u.acted || (u.moved && !def.move_fire));
        let alpha = spent ? 0.55 : 1;
        if (moving && a.fade) alpha *= a.fade === "in" ? p : 1 - p;
        const grounded = cls === "air" && (u.fuel === 0 || st.buildings.some(b => b.x === u.x && b.y === u.y && AIR_SITES.includes(b.type) && b.side === u.side));
        const rotary = ROTARY.has(u.type), alt = cls === "air" && !grounded ? (moving ? Math.sin(Math.PI * p) : 0) : 0;
        const hover = cls === "air" && !grounded && (rotary || u.type === "uav") && !moving ? Math.sin(t * 2.6 + u.id) * 1.1 : 0;
        if (cls === "sea" && moving) this.drawWake(g, f, u, a, ang, P);
        if (cls === "tread" && moving) this.drawDust(g, cx, cy, ang, p);
        if (lod === 2) {                                   // far zoom: a clear dot per unit
          g.save(); g.globalAlpha = alpha; g.fillStyle = col; g.beginPath(); g.arc(cx, cy, 9, 0, TAU); g.fill();
          g.fillStyle = "rgba(0,0,0,.68)"; g.fillRect(cx - T / 2 + 7, cy + T / 2 - 11, T - 14, 5); const r2 = u.hp / u.mhp;
          g.fillStyle = r2 > 0.5 ? "#2fd47a" : r2 > 0.25 ? "#ffb454" : "#ff5d5d"; g.fillRect(cx - T / 2 + 7, cy + T / 2 - 11, (T - 14) * r2, 5); g.restore(); continue;
        }
        // ---- shadow / team ring
        g.save(); g.globalAlpha = alpha;
        g.translate(cx, cy);
        const sw = { foot: [8, 5.5], tread: [17, 10], air: [15, 8], sea: [20, 7] }[cls];
        if (cls !== "sea") { g.save(); g.translate(cls === "air" && !grounded ? 4 + 9 * alt : 2, cls === "air" && !grounded ? 7 + 10 * alt : 3); g.rotate(ang);
          g.globalAlpha = alpha * (cls === "air" ? .26 - .08 * alt : .3); g.fillStyle = "#000"; g.beginPath(); g.ellipse(0, 0, sw[0], sw[1], 0, 0, TAU); g.fill(); g.restore(); }
        g.save(); g.rotate(ang); g.globalAlpha = alpha * .8; g.strokeStyle = col; g.lineWidth = 1.6; g.beginPath(); g.ellipse(0, 0, sw[0] + 3, sw[1] + 3, 0, 0, TAU); g.stroke(); g.restore();
        // ---- sprite
        g.translate(0, -2 - 3 * alt + hover);
        if (cls === "sea") g.translate(0, Math.sin(t * 2 + u.id) * .5);
        if (cls === "foot" && moving) g.translate(0, -Math.abs(Math.sin(t * 14)) * 1.3);
        if (cls === "tread" && moving) g.translate(0, Math.sin(t * 30) * .35);
        g.rotate(ang + (cls === "sea" ? Math.sin(t * 1.8 + u.id) * .025 : cls === "air" && moving ? Math.sin(Math.PI * p) * .08 * Math.sign(angDiff(h.cur, h.target) || 1) : 0));
        const s = (1 + .2 * alt) * (grounded ? .9 : 1), img = as.img("units", u.type, 0), me = as.entry("units", u.type) || {};
        const spin = grounded ? 0 : t * (rotary ? 38 : 0), o = { ph: moving ? t * 14 : 0, spin };
        if (img) { const w = img.width / as.ppt * T * (me.scale || 1) * s, hh = img.height / as.ppt * T * (me.scale || 1) * s; g.drawImage(img, -w / 2, -hh / 2, w, hh); }
        else { g.scale(s * (cls === "foot" ? 1 : .95), s * (cls === "foot" ? 1 : .95)); PH().unit(g, u.type, cls, col, o); }
        g.restore();
        // ---- readable overlays (never baked into art): team marker, health bar, hp number
        g.save(); g.globalAlpha = alpha;
        const x = cx - T / 2, y = cy - T / 2;
        g.fillStyle = col; g.fillRect(x + 2, y + 2, 8, 8); g.strokeStyle = "rgba(0,0,0,.7)"; g.lineWidth = 1; g.strokeRect(x + 2, y + 2, 8, 8);
        g.fillStyle = "rgba(0,0,0,.72)"; g.fillRect(x + 5, y + T - 8.5, T - 10, 6); const r = u.hp / u.mhp;
        g.fillStyle = r > 0.5 ? "#2fd47a" : r > 0.25 ? "#ffb454" : "#ff5d5d"; g.fillRect(x + 6, y + T - 7.5, (T - 12) * r, 4);
        if (lod === 0) { g.font = "bold 10px system-ui"; g.textAlign = "right"; g.textBaseline = "middle"; g.lineWidth = 2.8; g.strokeStyle = "rgba(0,0,0,.85)";
          g.strokeText(String(u.hp), x + T - 3, y + 8); g.fillStyle = "#fff"; g.fillText(String(u.hp), x + T - 3, y + 8); }
        g.restore();
      }
    }
    drawWake(g, f, u, a, ang, P) {                     // propeller wash + foamy wake, scaled to the hull
      const p = Math.min(1, (f.now - a.start) / a.dur), len = PH().WAKE_LEN[u.type] || .8;
      for (let i = 1; i <= 6; i++) {
        const q = Math.max(0, p - i * 0.06), e = 1 - Math.pow(1 - q, 2), gx = a.fx + (a.tx - a.fx) * e, gy = a.fy + (a.ty - a.fy) * e;
        g.save(); g.translate(L + gx * T + T / 2, L + gy * T + T / 2); g.rotate(ang); g.globalAlpha = Math.max(0, .55 - i * .08); g.fillStyle = "#fff";
        g.beginPath(); g.ellipse(-4 * len, 0, 8 * len + i * 1.4, (3 + i * .7) * len, 0, 0, TAU); g.fill(); g.restore();
      }
      const gx = this._unitPos(f, u); g.save(); g.translate(L + gx[0] * T + T / 2, L + gx[1] * T + T / 2); g.rotate(ang); g.strokeStyle = "rgba(255,255,255,.65)"; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(18 * len, 0); g.lineTo(6 * len, -7 * len); g.moveTo(18 * len, 0); g.lineTo(6 * len, 7 * len); g.stroke(); g.restore();
    }
    drawDust(g, cx, cy, ang, p) {                      // vehicles kick up a little dust while driving
      for (let i = 1; i <= 3; i++) { g.save(); g.translate(cx, cy); g.rotate(ang); g.fillStyle = `rgba(190,170,130,${Math.max(0, .34 - i * .08) * Math.sin(Math.PI * Math.min(1, p * 1.2))})`;
        g.beginPath(); g.arc(-14 - i * 5, Math.sin(p * 20 + i) * 3, 2 + i * 1.2, 0, TAU); g.fill(); g.restore(); }
    }
  }
  G.unitClass = type => { const m = G.manager, f = m && m.host.frameData(), u = f && f.unitDef(type); return u ? u.cls : "tread"; };
  G.Renderer2D = Renderer2D;
})(window.GFX = window.GFX || {});
