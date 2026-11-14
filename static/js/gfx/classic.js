/* IRON GRID graphics - ClassicRenderer: the original lightweight canvas board, moved behind the common
 * renderer interface. The drawing code is the pre-upgrade code, unchanged in behaviour; it now reads a
 * per-frame snapshot (`f`) instead of reaching into game.js variables. */
(function (G) {
  "use strict";
  const TILE = 44, LAB = 22;
  const CLSCOL = { foot: "#2b8a4a", tread: "#b8761a", air: "#2b82b8" };
  const px = x => LAB + x * TILE, py = y => LAB + y * TILE;

  function palette(p) {
    const light = !!p.light, cvd = !!p.cvd;
    return {
      light, bg: light ? "#dfe6f1" : "#070a0f", lab: light ? "#44546f" : "#8b97ae",
      P: cvd ? (light ? "#0a58a8" : "#3aa0ff") : (light ? "#0b64b8" : "#4cc3ff"),
      A: cvd ? (light ? "#b85c00" : "#ff9f1c") : (light ? "#c62828" : "#ff5d5d"),
      uP: light ? "#d4e6fa" : "#123349", uA: light ? "#fadcdc" : "#3d1618",
      text: light ? "#0e1a2c" : "#eef3ff", grid: light ? "rgba(0,0,0,.07)" : "rgba(255,255,255,.045)",
      tiles: light ? { ".": ["#cfe3b8", "#c6dbae"], "=": ["#c3bcae", "#bcb5a6"], "F": ["#8fbf8a", "#86b681"],
                       "M": ["#aaa49b", "#b3ada4"], "W": ["#8ec3e6", "#86bce0"], "S": ["#a9b27f", "#a1aa77"],
                       "B": ["#b9a98e", "#b2a287"], "U": ["#c9b7a0", "#c2b099"], "R": ["#9aa3ad", "#939ca7"],
                       "~": ["#e0d3a8", "#d8cba0"], "O": ["#7fb2d9", "#77abd4"] }
                   : { ".": ["#1b2331", "#1e2837"], "=": ["#2b2f3a", "#303542"], "F": ["#17301f", "#1a3a24"],
                       "M": ["#333a45", "#3a4250"], "W": ["#0f2f4a", "#123a5c"], "S": ["#262c17", "#2b321b"],
                       "B": ["#4a3b28", "#51422d"], "U": ["#3d3630", "#453d36"], "R": ["#27313d", "#2c3844"],
                       "~": ["#6b5d3a", "#74653f"], "O": ["#0d2337", "#10293f"] },
      glyph: light ? { "=": "#6f685b", "M": "#6c675f", "W": "#2f6a99", "S": "#6a7340", "F": "#2f6a3a",
                       "B": "#7a5c2e", "U": "#7d5a44", "R": "#4a545f", "~": "#8a7a4a", "O": "#1e5a86" }
                   : { "=": "#8892a8", "M": "#8f9bb5", "W": "#3f7ab5", "S": "#7d8a4a", "F": "#2c6b3c",
                       "B": "#c9a86a", "U": "#c79b7a", "R": "#7f95ad", "~": "#d9c98a", "O": "#3f8ac0" },
    };
  }
  G.classicPalette = palette;
  /** Position and heading at fraction e (0..1) of a route (array of [x, y] tiles). Visual only. */
  G.pathAt = (pts, e) => {
    let total = 0; const segs = [];
    for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push(l); total += l; }
    let d = Math.max(0, Math.min(1, e)) * total;
    for (let i = 0; i < segs.length; i++) {
      if (d <= segs[i] || i === segs.length - 1) {
        const q = segs[i] ? Math.min(1, d / segs[i]) : 1, [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
        return { p: [x0 + (x1 - x0) * q, y0 + (y1 - y0) * q], ang: Math.atan2(y1 - y0, x1 - x0), seg: i };
      }
      d -= segs[i];
    }
    return { p: pts[pts.length - 1].slice(), ang: 0, seg: 0 };
  };

  class ClassicRenderer extends G.Renderer {
    constructor() { super("classic"); this.canvas = null; this.zoom = 1; this.W = 14; this.H = 10; this._f = null; }
    get element() { return this.canvas; }

    init(host) {
      super.init(host);
      this.box = host.container;
      this.canvas = host.container.querySelector("#board");
      this.canvas.style.display = "";
      this.ctx = this.canvas.getContext("2d");
      host.canvasOwner = this;                                   // renderers sharing this canvas: the newest owner keeps it visible
      this._onDispose(() => { if (host.canvasOwner === this) this.canvas.style.display = "none"; this._f = null; });
      return this;
    }

    // ---------------------------------------------------------------- board / camera
    setBoard({ w, h }) {
      this.W = w; this.H = h;
      this.canvas.width = LAB + w * TILE; this.canvas.height = LAB + h * TILE;
      this.zoom = 1;
    }
    resize() {
      const bw = LAB + this.W * TILE, bh = LAB + this.H * TILE;
      this.canvas.style.width = Math.round(bw * this.zoom) + "px";
      this.canvas.style.height = Math.round(bh * this.zoom) + "px";
      if (G.manager) G.manager.markDirty();
    }
    getCamera() { return { zoom: this.zoom, panX: this.box.scrollLeft, panY: this.box.scrollTop, rotation: 0 }; }
    setCamera(c) {
      if (c.zoom !== undefined) {
        this.zoom = Math.min(G.CAMERA.ZOOM_MAX, Math.max(G.CAMERA.ZOOM_MIN, c.zoom));
        this.resize();
      }
      if (c.panX !== undefined) this.box.scrollLeft = c.panX;
      if (c.panY !== undefined) this.box.scrollTop = c.panY;
    }
    zoomBy(f, anchor) {
      const oldZoom = this.zoom;
      const nextZoom = Math.min(G.CAMERA.ZOOM_MAX, Math.max(G.CAMERA.ZOOM_MIN, oldZoom * f));
      if (nextZoom === oldZoom) return;
      const boxRect = this.box.getBoundingClientRect();
      const point = anchor || { x: boxRect.left + this.box.clientWidth / 2,
                                y: boxRect.top + this.box.clientHeight / 2 };
      const canvasRect = this.canvas.getBoundingClientRect();
      const worldX = (point.x - canvasRect.left) / oldZoom;
      const worldY = (point.y - canvasRect.top) / oldZoom;
      this.zoom = nextZoom;
      this.resize();
      this.box.scrollLeft = worldX * nextZoom - (point.x - boxRect.left);
      this.box.scrollTop = worldY * nextZoom - (point.y - boxRect.top);
    }
    _fitZoom() {
      const bw = LAB + this.W * TILE, bh = LAB + this.H * TILE;
      const width = Math.max(1, this.box.clientWidth - 16), height = Math.max(1, this.box.clientHeight - 16);
      return Math.min(G.CAMERA.FIT_MAX, Math.max(G.CAMERA.FIT_MIN, Math.min(width / bw, height / bh)));
    }
    zoomToPreset(preset, autoTile = true) {
      const fit = this._fitZoom();
      const multiplier = preset === "strategic" ? 0.68 : preset === "tactical" ? 1.8 : 1;
      this.zoom = Math.min(G.CAMERA.ZOOM_MAX, Math.max(G.CAMERA.ZOOM_MIN,
        (preset === "standard" && !autoTile ? 1 : fit) * multiplier));
      this.resize();
    }
    zoomFit() {
      this.zoomToPreset("standard");
      this.centerOnTile((this.W - 1) / 2, (this.H - 1) / 2, false);
    }
    zoomReset() { this.zoom = 1; this.resize(); }
    panBy(dx, dy) { this.box.scrollLeft += dx; this.box.scrollTop += dy; }
    centerOnTile(x, y, smooth = !!this.prefs.smoothPan) {
      const left = Math.max(0, px(x) * this.zoom + TILE * this.zoom / 2 - this.box.clientWidth / 2);
      const top = Math.max(0, py(y) * this.zoom + TILE * this.zoom / 2 - this.box.clientHeight / 2);
      if (smooth && this.box.scrollTo) this.box.scrollTo({ left, top, behavior: "smooth" });
      else { this.box.scrollLeft = left; this.box.scrollTop = top; }
    }
    ensureTileVisible(x, y) {
      const t = this.tileToScreen(x, y), r = this.box.getBoundingClientRect();
      if (!t) return;
      const margin = Math.min(36, this.zoom * TILE / 2);
      if (t.x < r.left + margin) this.box.scrollLeft -= r.left + margin - t.x;
      else if (t.x + t.w > r.right - margin) this.box.scrollLeft += t.x + t.w - r.right + margin;
      if (t.y < r.top + margin) this.box.scrollTop -= r.top + margin - t.y;
      else if (t.y + t.h > r.bottom - margin) this.box.scrollTop += t.y + t.h - r.bottom + margin;
    }
    lodLevel() {
      if (this.prefs.lod === false) return 0;
      const tilePx = TILE * this.zoom;
      return tilePx < 20 ? 2 : tilePx < 29 ? 1 : 0;
    }

    // ---------------------------------------------------------------- picking (board coordinates are the truth)
    screenToTile(cx, cy) {
      const r = this.canvas.getBoundingClientRect();
      const sx = this.canvas.width / r.width, sy = this.canvas.height / r.height;
      const x = Math.floor(((cx - r.left) * sx - LAB) / TILE), y = Math.floor(((cy - r.top) * sy - LAB) / TILE);
      return (x >= 0 && y >= 0 && x < this.W && y < this.H) ? { x, y } : null;
    }
    tileToScreen(x, y) {
      const r = this.canvas.getBoundingClientRect();
      const kx = r.width / this.canvas.width, ky = r.height / this.canvas.height;
      const w = TILE * kx, h = TILE * ky, left = r.left + px(x) * kx, top = r.top + py(y) * ky;
      return { x: left, y: top, w, h, cx: left + w / 2, cy: top + h / 2 };
    }
    unitScreenPos(id) {
      const f = this._f, u = f && f.state.units.find(q => q.id === id);
      if (!u) return null;
      const [gx, gy] = this._unitPos(f, u), t = this.tileToScreen(gx, gy);
      return { x: t.cx, y: t.cy };
    }

    // ---------------------------------------------------------------- frames
    needsFrame(f) {
      return !!(f.anim || f.floats.length || f.hover || (f.marks && f.marks.length));
    }
    renderFrame(f) { this._f = f; this.drawScene(this.ctx, f, true); }
    exportImage(f, o) {
      const c = document.createElement("canvas"), cw = LAB + f.W * TILE, ch = LAB + f.H * TILE, bh = o.headerHeight;
      c.width = cw; c.height = ch + bh;
      const t = c.getContext("2d"), P = palette(this.prefs);
      t.fillStyle = P.bg; t.fillRect(0, 0, c.width, c.height);
      t.fillStyle = P.text; t.font = "bold 14px system-ui"; t.textBaseline = "middle"; t.textAlign = "left";
      t.fillText(o.header, 8, bh / 2);
      t.translate(0, bh); this.drawScene(t, f, false);
      return new Promise(res => c.toBlob(res));
    }

    _unitPos(f, u) {
      const a = f.anim;
      if (a && a.id === u.id) {
        const t = Math.min(1, (f.now - a.start) / a.dur), e = 1 - Math.pow(1 - t, 2);
        if (a.path && a.path.length > 1) return G.pathAt(a.path, e).p;       // follow the real route, not a straight line
        return [a.fx + (a.tx - a.fx) * e, a.fy + (a.ty - a.fy) * e];
      }
      return [u.x, u.y];
    }

    // ---------------------------------------------------------------- drawing (original code)
    drawScene(g, f, ui) {
      const P = palette(this.prefs), W = f.W, H = f.H, TERRAIN = f.terrain, cw = LAB + W * TILE, ch = LAB + H * TILE;
      const lod = this.lodLevel();
      g.fillStyle = P.bg; g.fillRect(0, 0, cw, ch);
      if (lod < 2) {
        g.font = "bold 11px system-ui"; g.fillStyle = P.lab; g.textAlign = "center"; g.textBaseline = "middle";
        for (let x = 0; x < W; x++) g.fillText(String.fromCharCode(65 + x), px(x) + TILE / 2, LAB / 2);
        for (let y = 0; y < H; y++) g.fillText(String(y + 1), LAB / 2, py(y) + TILE / 2);
      }
      const GL = { "=": "═", "M": "▲", "W": "≋", "S": "⁞", "F": "♣", "B": "≡", "U": "▦", "R": "╬",
                   "~": "∴", "O": "≈" };
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (!TERRAIN[y]) continue;
        const c = TERRAIN[y][x], [c1, c2] = P.tiles[c] || P.tiles["."];
        g.fillStyle = (x + y) % 2 ? c1 : c2; g.fillRect(px(x), py(y), TILE, TILE);
        if (lod < 2 && GL[c]) {
          g.fillStyle = P.glyph[c]; g.font = lod === 0 ? "13px system-ui" : "10px system-ui";
          g.fillText(GL[c], px(x) + TILE / 2, py(y) + TILE / 2);
        }
        const k = x + "," + y;
        if (!f.seen.has(k)) { g.fillStyle = "rgba(3,5,8,0.88)"; g.fillRect(px(x), py(y), TILE, TILE); }
        else if (!f.visible.has(k)) { g.fillStyle = "rgba(3,5,8,0.45)"; g.fillRect(px(x), py(y), TILE, TILE); }
      }
      if (lod < 2) {
        g.strokeStyle = P.grid; g.lineWidth = 1;
        for (let x = 0; x <= W; x++) { g.beginPath(); g.moveTo(px(x), LAB); g.lineTo(px(x), ch); g.stroke(); }
        for (let y = 0; y <= H; y++) { g.beginPath(); g.moveTo(LAB, py(y)); g.lineTo(cw, py(y)); g.stroke(); }
      }
      this.drawBuildings(g, f, P);
      if (ui && f.sel) this.drawSelection(g, f, P);
      this.drawUnits(g, f, P);
      if (ui) { this.drawMarks(g, f); this.drawForecast(g, f, P); this.drawFloats(g, f); this.drawCursor(g, f, P); }
    }
    drawBuildings(g, f, P) {
      const GL = { HQ: "★", factory: "⚙", city: "⌂", barracks: "⛺", fort: "✚",
                   radar: "◉", airbase: "✈", airfield: "✈", harbor: "⚓", port: "⚓",
                   shipyard: "⚒", battery: "☗" };
      const state = f.state;
      const lod = this.lodLevel();
      for (const b of state.buildings) {
        const x = px(b.x), y = py(b.y);
        const col = b.side ? P[b.side] : (P.light ? "#59657b" : "#9aa7bb");
        g.globalAlpha = b.visible ? 1 : 0.55;
        g.fillStyle = P.light ? "rgba(255,255,255,.45)" : "rgba(255,255,255,0.05)";
        g.fillRect(x + 3, y + 3, TILE - 6, TILE - 6);
        g.strokeStyle = col; g.lineWidth = 2; g.strokeRect(x + 4, y + 4, TILE - 8, TILE - 8);
        g.fillStyle = col;
        if (lod < 2) {
          g.font = `${b.type === "HQ" ? 22 : 17}px system-ui`;
          g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(GL[b.type], x + TILE / 2, y + TILE / 2 - 2);
        } else {
          g.fillRect(x + 13, y + 13, TILE - 26, TILE - 26);
        }
        if (b.level > 1 && lod < 2) { g.font = "bold 9px system-ui"; g.fillText("L" + b.level, x + TILE - 9, y + 8); }
        if (b.cap && lod === 0) { g.font = "bold 9px system-ui"; g.fillStyle = "#ffb454";
          g.fillText(`${b.cap.pts}/${b.cap.side === "P" ? (b.type === "HQ" ? 3 : 2) : "?"}`, x + 6, y + TILE - 7); }
        if (state.queue) {
          const q = state.queue.find(o => o.x === b.x && o.y === b.y);
          if (q) { g.font = "bold 10px system-ui"; g.fillStyle = "#ffb454";
                   g.fillText("⚙" + q.left, x + 5, y + 10); }
        }
        if (b.hp !== undefined) {
          g.fillStyle = "rgba(0,0,0,.6)"; g.fillRect(x + 6, y + TILE - 8, TILE - 12, 4);
          g.fillStyle = b.hp / b.max_hp > 0.4 ? "#ffb454" : "#ff5d5d";
          g.fillRect(x + 6, y + TILE - 8, (TILE - 12) * b.hp / b.max_hp, 4);
        }
        g.globalAlpha = 1;
      }
    }
    drawSelection(g, f, P) {
      const sel = f.sel;
      g.fillStyle = P.light ? "rgba(10,100,200,.28)" : "rgba(76,195,255,0.22)";
      for (const k of sel.moves) { const [x, y] = k.split(",").map(Number); g.fillRect(px(x) + 2, py(y) + 2, TILE - 4, TILE - 4); }
      for (const [id] of sel.attacks) {
        const u = f.state.units.find(q => q.id === id); if (!u) continue;
        g.strokeStyle = P.A; g.lineWidth = 3; g.strokeRect(px(u.x) + 2, py(u.y) + 2, TILE - 4, TILE - 4);
      }
      const u = sel.unit;
      g.strokeStyle = P.P; g.lineWidth = 2; g.strokeRect(px(u.x) + 1, py(u.y) + 1, TILE - 2, TILE - 2);
    }
    drawUnits(g, f, P) {
      const lod = this.lodLevel();
      const stacks = {};
      for (const u of f.state.units) {
        const k = u.x + "," + u.y;
        const n = stacks[k] = (stacks[k] || 0) + 1;
        const off = n > 1 ? 7 : 0;
        const [gx, gy] = this._unitPos(f, u), x = LAB + gx * TILE + off, y = LAB + gy * TILE - off,
              t = f.unitDef(u.type);
        const col = P[u.side];
        const spent = u.side === "P" && (u.acted || (u.moved && !t.move_fire));
        let alpha = spent ? 0.5 : 1;
        const a = f.anim;
        if (a && a.id === u.id && a.fade) {          // fog-safe entrances/exits: fade instead of showing the hidden side
          const p = Math.min(1, (f.now - a.start) / a.dur);
          alpha *= a.fade === "in" ? p : 1 - p;
        }
        g.globalAlpha = alpha;
        g.fillStyle = u.side === "P" ? P.uP : P.uA; g.strokeStyle = col; g.lineWidth = 2;
        this.roundRect(g, x + 4, y + 4, TILE - 8, TILE - 8, lod === 2 ? 14 : 6); g.fill(); g.stroke();
        if (lod < 2) {
          g.fillStyle = P.light ? P.text : col; g.font = "bold 12px system-ui"; g.textAlign = "center"; g.textBaseline = "middle";
          g.fillText(t.code, x + TILE / 2, y + TILE / 2 - 3);
          g.fillStyle = CLSCOL[t.cls]; g.fillRect(x + 5, y + 5, 11, 11);
          g.fillStyle = "#fff"; g.font = "bold 8px system-ui"; g.fillText(t.cls[0].toUpperCase(), x + 10.5, y + 11);
        } else {
          g.fillStyle = col; g.beginPath(); g.arc(x + TILE / 2, y + TILE / 2, 8, 0, Math.PI * 2); g.fill();
        }
        g.fillStyle = "rgba(0,0,0,.68)"; g.fillRect(x + 7, y + TILE - 11, TILE - 14, 5);
        const r = u.hp / u.mhp;
        g.fillStyle = r > 0.5 ? "#2fd47a" : r > 0.25 ? "#ffb454" : "#ff5d5d";
        g.fillRect(x + 7, y + TILE - 11, (TILE - 14) * r, 5);
        if (lod === 0) {
          g.fillStyle = P.light ? P.text : "#fff"; g.font = "bold 9px system-ui"; g.textAlign = "right";
          g.fillText(String(u.hp), x + TILE - 6, y + 11); g.textAlign = "center";
        }
        g.globalAlpha = 1;
      }
    }
    roundRect(g, x, y, w, h, r) {
      g.beginPath(); g.moveTo(x + r, y);
      g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
    }
    drawForecast(g, f, P) {
      const sel = f.sel;
      if (!sel || this.prefs.hoverfx === false) return;
      const st = f.state;
      for (const tile of [f.hover, this.prefs.keyboard ? f.cursor : null]) {
        if (!tile) continue;
        const u = st.units.find(q => q.x === tile.x && q.y === tile.y);
        const bb = u ? null : st.buildings.find(q => q.x === tile.x && q.y === tile.y);
        const tgt = u || bb;
        if (!tgt) continue;
        const a = sel.attacks.get(tgt.id);
        if (!a) continue;
        const txt = `-${a.dmg}${a.counter ? "  ↩" + a.counter : ""}${a.kill ? "  KILL" : ""}`;
        g.font = "bold 12px system-ui"; const w = g.measureText(txt).width + 12;
        const bx = Math.min(Math.max(px(tile.x) + TILE / 2 - w / 2, LAB), LAB + f.W * TILE - w), by = Math.max(py(tile.y) - 20, 0);
        g.fillStyle = "rgba(10,14,20,.92)"; g.fillRect(bx, by, w, 18);
        g.strokeStyle = P.A; g.lineWidth = 1; g.strokeRect(bx, by, w, 18);
        g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(txt, bx + w / 2, by + 9);
      }
    }
    drawFloats(g, f) {
      const now = f.now;
      for (const fl of f.floats) {
        if (now - fl.born >= 1100) continue;
        const t = (now - fl.born) / 1100;
        g.globalAlpha = 1 - t; g.fillStyle = fl.color; g.font = "bold 14px system-ui";
        g.strokeStyle = "rgba(0,0,0,.7)"; g.lineWidth = 3; g.textAlign = "center";
        const x = px(fl.x) + TILE / 2, y = py(fl.y) - 4 - t * 22;
        g.strokeText(fl.text, x, y); g.fillText(fl.text, x, y); g.globalAlpha = 1;
      }
    }
    drawCursor(g, f, P) {
      const hover = f.hover, cursor = f.cursor, flash = f.flash;
      if (hover) { g.strokeStyle = "rgba(255,255,255,.4)"; g.lineWidth = 1; g.strokeRect(px(hover.x) + 1, py(hover.y) + 1, TILE - 2, TILE - 2); }
      if (this.prefs.keyboard) {
        const pulse = 0.65 + 0.35 * Math.sin(f.now / 180);
        g.strokeStyle = `rgba(255,180,84,${pulse})`; g.lineWidth = 3;
        g.strokeRect(px(cursor.x) + 1.5, py(cursor.y) + 1.5, TILE - 3, TILE - 3);
      }
      if (flash && f.now - flash.t < 1400) {
        g.strokeStyle = `rgba(255,255,80,${1 - (f.now - flash.t) / 1400})`; g.lineWidth = 4;
        g.strokeRect(px(flash.x) - 2, py(flash.y) - 2, TILE + 4, TILE + 4);
      }
    }
    drawMarks(g, f) {               // tutorial markers
      const marks = f.marks;
      if (!marks || !marks.length) return;
      const pulse = 0.55 + 0.45 * Math.sin(f.now / 260);
      g.lineWidth = 3;
      for (const [x, y] of marks) {
        g.strokeStyle = `rgba(80,220,140,${pulse})`;
        g.strokeRect(px(x) + 3, py(y) + 3, TILE - 6, TILE - 6);
        g.fillStyle = `rgba(80,220,140,${0.12 + 0.12 * pulse})`; g.fillRect(px(x) + 3, py(y) + 3, TILE - 6, TILE - 6);
      }
    }
  }
  G.ClassicRenderer = ClassicRenderer;

  G.registerRenderer("classic", { label: "Classic", available: true, create: () => new ClassicRenderer(),
    note: "The original lightweight board." });
  G.registerRenderer("2d", { label: "2D Graphics", available: true,
    note: "Top-down graphical board. Uses placeholder art until you add your own images (docs/2d-asset-checklist.md).",
    create: async () => { await G.loadScripts(["placeholders-2d.js", "assets.js", "terrain2d.js", "effects2d.js", "renderer2d.js"]); return new G.Renderer2D(); } });
  G.registerRenderer("25d", { label: "2.5D Graphics", available: false, note: "Not available yet (Stage 4)." });
  G.registerRenderer("3d", { label: "3D Graphics", available: false, note: "Not available yet (Stage 5)." });
})(window.GFX = window.GFX || {});
