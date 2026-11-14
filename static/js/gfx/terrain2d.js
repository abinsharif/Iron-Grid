/* IRON GRID 2D - terrain painter.
 * Static ground (tiles, roads, railways, bridges, shores) is painted once per game-state into an offscreen layer; only
 * the animated parts (waves, foam, trees, reeds, cloud shadows) are drawn per frame, driven by the shared animation clock
 * (so 0% freezes them and 200% doubles their speed). Real art from the asset manifest is used where present; everything
 * else is procedural. Logical tile = 44 px; the layer is rendered at 64 px per tile.
 * Terrain ids come straight from the game data: . = R B F M O S U W ~   */
(function (G) {
  "use strict";
  const T = 44, K = 64 / 44, TAU = Math.PI * 2;
  const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const hash = (x, y, s) => { let h = Math.imul(x + 374761393, 668265263) ^ Math.imul(y + 1274126177, 2246822519) ^ Math.imul((s | 0) + 7, 3266489917);
    h = Math.imul(h ^ h >>> 13, 1274126177); return ((h ^ h >>> 16) >>> 0) / 4294967296; };
  const circ = (g, x, y, r, fill) => { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fillStyle = fill; g.fill(); };
  const poly = (g, pts, fill) => { g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fillStyle = fill; g.fill(); };
  const lgrad = (g, x0, y0, x1, y1, stops) => { const r = g.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, c]) => r.addColorStop(o, c)); return r; };
  const blob = (g, x, y, r, col) => { const r2 = g.createRadialGradient(x, y, 0, x, y, r); r2.addColorStop(0, col); r2.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = r2; g.fillRect(x - r, y - r, 2 * r, 2 * r); };
  const WATER = "WO";
  const ROAD_BLD = new Set(["HQ", "factory", "city", "barracks", "airbase", "airfield", "harbor", "port", "shipyard", "training"]);
  const RAIL_BLD = new Set(["factory", "port", "harbor", "shipyard", "airbase"]);

  // ------------------------------------------------------------------ base tiles (cached, 8 variants each)
  const GRASS = ["#79ac52", "#74a74f", "#7db057", "#72a24c", "#78aa53", "#76a950", "#7bae55", "#73a54e"];
  function grassBase(g, R, v, dark) {
    g.fillStyle = dark ? ["#4f8142", "#55884a", "#4b7c3e", "#528446"][v % 4] : GRASS[v];
    g.fillRect(0, 0, 44, 44);
    for (let i = 0; i < 4; i++) { const r = 5 + R() * 5; blob(g, r + R() * (44 - 2 * r), r + R() * (44 - 2 * r), r, R() > .5 ? (dark ? "rgba(110,150,70,.30)" : "rgba(175,215,115,.32)") : "rgba(40,95,40,.26)"); }
    for (let i = 0; i < (dark ? 16 : 26); i++) { const x = 2 + R() * 40, y = 4 + R() * 38; g.lineWidth = 1;
      g.strokeStyle = R() > .5 ? "rgba(40,92,34,.55)" : "rgba(170,215,105,.55)"; g.beginPath();
      g.moveTo(x, y); g.lineTo(x - 1.4, y - 3); g.moveTo(x, y); g.lineTo(x + .2, y - 3.6); g.moveTo(x, y); g.lineTo(x + 1.5, y - 2.8); g.stroke(); }
    if (!dark) for (let i = 0; i < 4; i++) circ(g, 3 + R() * 38, 3 + R() * 38, .9, ["#f7f3d0", "#f2d34f", "#e58fb0", "#ffffff"][i % 4]);
    for (let i = 0; i < 2; i++) circ(g, 3 + R() * 38, 3 + R() * 38, 1 + R() * .8, "rgba(120,120,105,.55)");
  }
  function houses(g, R, n) {
    const slots = [[5, 7], [24, 5], [4, 26], [22, 25], [33, 14], [13, 17]];
    for (let i = 0; i < n; i++) {
      const [sx, sy] = slots[i], w = 8 + R() * 3, h = 7 + R() * 2, x = sx + R() * 2, y = sy + R() * 2;
      poly(g, [[x + w, y + 2], [x + w + 4, y + 5], [x + w + 4, y + h + 5], [x + w, y + h + 2]], "rgba(0,0,0,.28)");
      g.fillStyle = "#efe6cf"; g.fillRect(x, y + 2, w, h); g.fillStyle = "#cfc4a6"; g.fillRect(x + w - 2, y + 2, 2, h);
      const roof = [["#b9553c", "#8d3d2b"], ["#a6603a", "#7a4528"], ["#7c8aa0", "#586679"], ["#b8a15a", "#8c7a3e"]][(R() * 4) | 0];
      poly(g, [[x - 1, y + 2], [x + w / 2, y - 3], [x + w / 2, y + 2]], roof[0]); poly(g, [[x + w / 2, y - 3], [x + w + 1, y + 2], [x + w / 2, y + 2]], roof[1]);
      g.fillStyle = "#6b4a2e"; g.fillRect(x + w / 2 - 1.2, y + h - 1, 2.4, 3.2);
      if (R() > .5) { g.fillStyle = "#6e6459"; g.fillRect(x + w - 3, y - 2.5, 2, 3.5); }
    }
  }
  function paintBase(g, c, v) {
    const R = rng(v * 7919 + c.charCodeAt(0) * 104729 + 17);
    switch (c) {
      case "F": grassBase(g, R, v, true);
        for (let i = 0; i < 12; i++) circ(g, R() * 44, R() * 44, .8 + R(), "rgba(120,90,50,.45)"); break;
      case "M": g.fillStyle = ["#7b7568", "#777164", "#7f796b", "#736d61"][v % 4]; g.fillRect(0, 0, 44, 44);
        for (let i = 0; i < 4; i++) blob(g, 6 + R() * 32, 6 + R() * 32, 7 + R() * 5, R() > .5 ? "rgba(160,150,130,.35)" : "rgba(40,36,30,.32)");
        for (let i = 0; i < 26; i++) { const x = R() * 44, y = R() * 44; g.fillStyle = R() > .5 ? "rgba(70,64,54,.55)" : "rgba(190,182,165,.4)"; g.fillRect(x, y, 1 + R() * 2, 1 + R()); }
        const n = 2 + (v % 2), peaks = [];
        for (let i = 0; i < n; i++) peaks.push({ x: 9 + R() * 26, by: 22 + R() * 16, h: 15 + R() * 15, w: 8 + R() * 6 });
        peaks.sort((a, b) => a.by - b.by);
        for (const p of peaks) {
          poly(g, [[p.x, p.by - p.h], [p.x + p.w + 9, p.by + 4], [p.x + p.w, p.by + 4]], "rgba(0,0,0,.22)");
          poly(g, [[p.x - p.w, p.by], [p.x, p.by - p.h], [p.x + 1, p.by]], lgrad(g, p.x - p.w, p.by, p.x, p.by - p.h, [[0, "#a49b88"], [1, "#d6cfbf"]]));
          poly(g, [[p.x + 1, p.by], [p.x, p.by - p.h], [p.x + p.w, p.by]], lgrad(g, p.x, p.by - p.h, p.x + p.w, p.by, [[0, "#7d7767"], [1, "#4d483f"]]));
          g.strokeStyle = "rgba(30,26,20,.35)"; g.lineWidth = .8; g.beginPath();
          g.moveTo(p.x - p.w * .5, p.by - 1); g.lineTo(p.x - 1, p.by - p.h * .55); g.moveTo(p.x + p.w * .55, p.by - 1); g.lineTo(p.x + 1, p.by - p.h * .5); g.stroke();
          if (p.h > 22) { const sy = p.by - p.h + p.h * .36, sw = p.w * .38;
            poly(g, [[p.x - sw, sy + 1], [p.x - sw * .4, sy - 1.4], [p.x, sy + 1.4], [p.x, p.by - p.h], [p.x - 1, p.by - p.h]], "#f4f7fa");
            poly(g, [[p.x, p.by - p.h], [p.x, sy + 1.4], [p.x + sw * .5, sy - 1], [p.x + sw, sy + 1]], "#cdd7e2"); }
        } break;
      case "W": g.fillStyle = "#3f86c6"; g.fillRect(0, 0, 44, 44);
        for (let i = 0; i < 3; i++) blob(g, 8 + R() * 28, 8 + R() * 28, 9 + R() * 4, R() > .5 ? "rgba(20,70,130,.28)" : "rgba(130,200,245,.28)"); break;
      case "B": g.fillStyle = "#3f86c6"; g.fillRect(0, 0, 44, 44); blob(g, 22, 22, 18, "rgba(15,55,110,.25)"); break;
      case "O": g.fillStyle = "#1c5b97"; g.fillRect(0, 0, 44, 44);
        for (let i = 0; i < 3; i++) blob(g, 8 + R() * 28, 8 + R() * 28, 10 + R() * 4, R() > .5 ? "rgba(8,40,88,.35)" : "rgba(70,150,215,.22)"); break;
      case "S": g.fillStyle = ["#5f6e3a", "#667540", "#5a6836", "#636f3c"][v % 4]; g.fillRect(0, 0, 44, 44);
        for (let i = 0; i < 3; i++) { const x = 9 + R() * 26, y = 9 + R() * 26, rx = 5 + R() * 4, ry = 3 + R() * 3;
          g.fillStyle = "#6b5a36"; g.beginPath(); g.ellipse(x, y + 1, rx + 1.5, ry + 1.5, 0, 0, TAU); g.fill();
          g.fillStyle = "#2f4a43"; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.fill();
          g.strokeStyle = "rgba(190,225,210,.45)"; g.lineWidth = .9; g.beginPath(); g.ellipse(x, y, rx * .7, ry * .6, 0, 3.4, 5.2); g.stroke(); }
        for (let i = 0; i < 18; i++) circ(g, R() * 44, R() * 44, .8 + R(), "rgba(35,55,30,.5)"); break;
      case "~": g.fillStyle = ["#e3d3a1", "#e7d8a7", "#dfcf9a", "#e5d5a3"][v % 4]; g.fillRect(0, 0, 44, 44);
        g.strokeStyle = "rgba(190,165,110,.55)"; g.lineWidth = 1;
        for (let i = 0; i < 4; i++) { const y = 6 + i * 10 + R() * 3; g.beginPath(); g.moveTo(0, y); g.quadraticCurveTo(11, y - 3, 22, y); g.quadraticCurveTo(33, y + 3, 44, y); g.stroke(); }
        for (let i = 0; i < 24; i++) circ(g, R() * 44, R() * 44, .6 + R() * 1.1, R() > .7 ? "rgba(255,250,225,.7)" : "rgba(150,125,70,.5)"); break;
      case "U": grassBase(g, R, v, false); g.fillStyle = "rgba(184,160,110,.55)"; g.beginPath(); g.ellipse(22, 24, 17, 12, 0, 0, TAU); g.fill();
        houses(g, R, 4 + (v % 2));
        for (let i = 0; i < 2; i++) { const x = 5 + R() * 34, y = 36 + R() * 5; circ(g, x + 1.5, y + 1.5, 3.4, "rgba(0,0,0,.2)"); circ(g, x, y, 3.4, "#3d7a3a"); circ(g, x - 1, y - 1, 1.8, "#58994d"); } break;
      case "=": case "R": default: grassBase(g, R, v, false);
        if (c === "R") { g.fillStyle = "rgba(150,140,125,.25)"; g.fillRect(0, 0, 44, 44); }
    }
  }
  const tileCache = new Map();
  function tileBitmap(c, v) {
    const k = c + v; let cv = tileCache.get(k);
    if (!cv) { cv = document.createElement("canvas"); cv.width = cv.height = 64; const g = cv.getContext("2d"); g.scale(K, K); paintBase(g, c, v); tileCache.set(k, cv); }
    return cv;
  }

  // ------------------------------------------------------------------ road / rail / bridge pieces (mask: N=1 E=2 S=4 W=8)
  function pieceFor(mask) {
    const n = (mask & 1 ? 1 : 0) + (mask & 2 ? 1 : 0) + (mask & 4 ? 1 : 0) + (mask & 8 ? 1 : 0);
    if (n === 0) return { name: "isolated", r: 0 };
    if (n === 1) return { name: "end", r: mask & 2 ? 0 : mask & 4 ? 1 : mask & 8 ? 2 : 3 };
    if (n === 2) {
      if ((mask & 10) === 10) return { name: "straight", r: 0 };
      if ((mask & 5) === 5) return { name: "straight", r: 1 };
      return { name: "corner", r: (mask & 3) === 3 ? 0 : (mask & 6) === 6 ? 1 : (mask & 12) === 12 ? 2 : 3 };      // base: N+E
    }
    if (n === 3) return { name: "t", r: !(mask & 1) ? 0 : !(mask & 2) ? 1 : !(mask & 4) ? 2 : 3 };                // base: E+W+S
    return { name: "cross", r: 0 };
  }
  function tracePaths(g, name) {
    g.beginPath();
    switch (name) {
      case "straight": case "isolated": g.moveTo(name === "isolated" ? 8 : 0, 22); g.lineTo(name === "isolated" ? 36 : 44, 22); break;
      case "corner": g.moveTo(22, 0); g.quadraticCurveTo(22, 22, 44, 22); break;
      case "t": g.moveTo(0, 22); g.lineTo(44, 22); g.moveTo(22, 22); g.lineTo(22, 44); break;
      case "cross": g.moveTo(0, 22); g.lineTo(44, 22); g.moveTo(22, 0); g.lineTo(22, 44); break;
      case "end": g.moveTo(0, 22); g.lineTo(44, 22); break;
    }
  }
  /** kind: road | rail | bridge | railbridge. g must be translated to the tile origin. */
  function drawNetwork(g, kind, mask) {
    const p = pieceFor(mask);
    g.save(); g.translate(22, 22); g.rotate(p.r * Math.PI / 2); g.translate(-22, -22); g.lineCap = "butt"; g.lineJoin = "round";
    const stroke = (w, col, dash) => { tracePaths(g, p.name); g.lineWidth = w; g.strokeStyle = col; g.setLineDash(dash || []); g.stroke(); g.setLineDash([]); };
    const hub = (r, col) => { if (p.name === "t" || p.name === "cross") circ(g, 22, 22, r, col); };
    if (kind === "road") {
      stroke(16, "rgba(0,0,0,.22)"); stroke(14, "#4b4843"); hub(7, "#4b4843"); stroke(11.5, "#75716a"); hub(5.75, "#75716a");
      if (p.name === "straight" || p.name === "corner") stroke(1.2, "rgba(243,233,170,.85)", [5, 5]);
    } else if (kind === "rail") {
      stroke(12, "rgba(0,0,0,.2)"); stroke(10.5, "#8b8377"); hub(5, "#8b8377"); stroke(9, "#5b4632", [2, 3.4]);
      stroke(5.2, "#b9bec7"); hub(2.6, "#b9bec7"); stroke(2.6, "#8b8377"); hub(1.3, "#8b8377");
    } else {
      stroke(17, "rgba(0,0,0,.3)"); stroke(15, "#4a3a28"); stroke(12, "#a98456"); stroke(12, "#7d6139", [1.1, 3.1]);
      if (kind === "railbridge") { stroke(5.2, "#b9bec7"); stroke(2.6, "#a98456"); }
    }
    g.restore();
  }

  // ------------------------------------------------------------------ painter
  class TerrainPainter {
    constructor() { this.layer = null; this.key = null; this.ver = 0; this.water = []; this.forest = []; this.swamp = []; this.clouds = null; }
    invalidate() { this.ver++; }
    build(f, A) {
      const W = f.W, H = f.H, TER = f.terrain, at = (x, y) => (x >= 0 && y >= 0 && x < W && y < H && TER[y]) ? TER[y][x] : null;
      const bmap = new Map(); for (const b of f.state.buildings) bmap.set(b.x + "," + b.y, b.type);
      const bt = (x, y) => bmap.get(x + "," + y);
      const cv = this.layer && this.layer.width === W * 64 && this.layer.height === H * 64 ? this.layer : document.createElement("canvas");
      cv.width = W * 64; cv.height = H * 64; this.layer = cv;
      const g = cv.getContext("2d"); g.scale(K, K); g.imageSmoothingQuality = "high";
      this.water = []; this.forest = []; this.swamp = [];
      const nb = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (!TER[y]) continue;
        const c = TER[y][x], v = Math.floor(hash(x, y, 1) * 8), ox = x * T, oy = y * T;
        const img = A.img("terrain", c, v % Math.max(1, (A.entry("terrain", c) || {}).variants || 1));
        const tileImg = img && !((A.entry("terrain", c) || {}).frames > 1);
        if (tileImg) g.drawImage(img, ox, oy, T, T); else g.drawImage(tileBitmap(c, v), ox, oy, T, T);
        g.save(); g.translate(ox, oy);
        if (c === "=" || c === "R" || c === "B") {
          let mask = 0, mRoad = 0, mRail = 0;
          for (const [dx, dy, bit] of nb) {
            const t2 = at(x + dx, y + dy), b2 = bt(x + dx, y + dy);
            const road = t2 === "=" || t2 === "U" || ROAD_BLD.has(b2), rail = t2 === "R" || RAIL_BLD.has(b2), br = t2 === "B";
            if (c === "=") { if (road || br) mask |= bit; }
            else if (c === "R") { if (rail || br) mask |= bit; }
            else { if (road) mRoad |= bit; if (rail) mRail |= bit; if (br) mask |= bit; }
          }
          let kind = c === "=" ? "road" : c === "R" ? "rail" : (mRail && !mRoad ? "railbridge" : "bridge");
          if (c === "B") {                                           // bridges are straight: pick the axis from connections, then from the water
            mask |= mRoad | mRail;
            const ns = !!(mask & 5), ew = !!(mask & 10);
            const wE = WATER.includes(at(x + 1, y) || " ") || WATER.includes(at(x - 1, y) || " ");
            mask = ns && !ew ? 5 : ew && !ns ? 10 : (wE ? 5 : 10);
          }
          const p = pieceFor(mask), pname = (c === "B" ? "bridge" : c === "=" ? "road" : "railway") + "_" + p.name;
          const pimg = A.img("network", pname, 0);
          if (pimg) { g.translate(22, 22); g.rotate(p.r * Math.PI / 2); g.drawImage(pimg, -22, -22, T, T); }
          else drawNetwork(g, kind, mask);
        }
        g.restore();
        // water banks: shallow band + record foam sides on water tiles; wet sand on beaches
        if (WATER.includes(c) || c === "~") {
          const sides = [];
          for (const [dx, dy, bit] of nb) { const t2 = at(x + dx, y + dy); if (t2 === null) continue;
            const wet = WATER.includes(t2) || t2 === "B"; if (WATER.includes(c) ? !wet : wet) sides.push(bit); }
          if (sides.length) {
            g.save(); g.translate(ox, oy);
            for (const bit of sides) { const hor = bit === 1 || bit === 4, edge = bit === 1 || bit === 8 ? 0 : 44, d = (bit === 1 || bit === 8) ? 1 : -1;
              const gr = hor ? g.createLinearGradient(0, edge, 0, edge + 9 * d) : g.createLinearGradient(edge, 0, edge + 9 * d, 0);
              gr.addColorStop(0, WATER.includes(c) ? "rgba(120,215,225,.55)" : "rgba(95,80,50,.28)"); gr.addColorStop(1, "rgba(0,0,0,0)");
              g.fillStyle = gr; if (hor) g.fillRect(0, bit === 1 ? 0 : 35, 44, 9); else g.fillRect(bit === 8 ? 0 : 35, 0, 9, 44); }
            g.restore();
          }
          if (WATER.includes(c) || c === "B") this.water.push({ x, y, c, sides: WATER.includes(c) ? sides : [], vert: (WATER.includes(at(x, y - 1) || " ") || WATER.includes(at(x, y + 1) || " ")) && !(WATER.includes(at(x - 1, y) || " ") && WATER.includes(at(x + 1, y) || " ")) });
        } else if (c === "F") this.forest.push({ x, y });
        else if (c === "S") this.swamp.push({ x, y });
      }
      // bridges sit over water: animate waves around them too
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (TER[y] && TER[y][x] === "B") this.water.push({ x, y, c: "W", sides: [], vert: false, under: true });
      this.key = f.state.buildings;
      if (!this.clouds) { const R = rng(4242); this.clouds = Array.from({ length: 5 }, () => ({ x: R(), y: R(), rx: 70 + R() * 70, ry: 26 + R() * 24, sp: 5 + R() * 6, a: .07 + R() * .05 })); }
    }
    needsBuild(f) { return this.key !== f.state.buildings || this.layerRef !== f.terrain || this.layerVer !== this.ver; }
    mark(f) { this.layerRef = f.terrain; this.layerVer = this.ver; }
    drawStatic(g, f) { g.drawImage(this.layer, 22, 22, f.W * T, f.H * T); }

    /** Animated overlays. clock = seconds of animation time (frozen at 0%). */
    drawAnimated(g, f, clock, A, calm) {
      const L = 22;
      // ---- water: waves, sparkles, foam (batched into few strokes)
      if (this.water.length) {
        const sh = A.entry("terrain", "O");
        for (const wt of this.water) {
          if (wt.under) continue;
          const wx = L + wt.x * T, wy = L + wt.y * T, ent = A.entry("terrain", wt.c);
          if (ent && ent.frames > 1) { const fr = A.frame("terrain", wt.c, clock * 1000); if (fr) { g.drawImage(fr.img, fr.sx, fr.sy, fr.sw, fr.sh, wx, wy, T, T); continue; } }
        }
        g.lineCap = "round"; g.lineJoin = "round";
        for (const pass of [0, 1]) {
          g.beginPath();
          for (const wt of this.water) {
            const wx = L + wt.x * T, wy = L + wt.y * T, ocean = wt.c === "O";
            const ent = A.entry("terrain", wt.c); if (ent && ent.frames > 1 && A.img("terrain", wt.c, 0) && !wt.under) continue;
            const lines = pass === 0 ? 3 : 2;
            for (let i = 0; i < lines; i++) {
              const base = 8 + i * (pass === 0 ? 13 : 20) + (pass ? 3 : 0), ph = (pass ? 2.1 : 0) + i * 1.7 + (ocean ? 0 : .6);
              for (let s = 0; s <= 6; s++) {
                const a = s * 7.333, wv = Math.sin((wx + a) * 0.17 + clock * (ocean ? 1.5 : 2.2) + ph) * (ocean ? 1.7 : 1.1) + Math.sin((wy + base) * 0.11 - clock * .8) * .9;
                const X = wt.vert ? wx + base + wv : wx + a, Y = wt.vert ? wy + a + (clock * 3 % 7.333) * 0 : wy + base + wv;
                if (s === 0) g.moveTo(X, Y); else g.lineTo(X, Y);
              }
            }
          }
          g.lineWidth = pass === 0 ? 1.3 : .9; g.strokeStyle = pass === 0 ? "rgba(235,248,255,.26)" : "rgba(10,50,100,.16)"; g.stroke();
        }
        // sparkles + foam
        g.beginPath();
        for (const wt of this.water) { if (wt.under) continue;
          for (const bit of wt.sides) { const wx = L + wt.x * T, wy = L + wt.y * T, o = 1.6 + Math.sin(clock * 1.8 + wt.x + wt.y * 2) * 1.4;
            if (bit === 1 || bit === 4) { const y = bit === 1 ? wy + o : wy + T - o; g.moveTo(wx, y); for (let s = 1; s <= 8; s++) g.lineTo(wx + s * 5.5, y + Math.sin(clock * 2 + s * 1.3 + wt.x) * 1.1); }
            else { const x = bit === 8 ? wx + o : wx + T - o; g.moveTo(x, wy); for (let s = 1; s <= 8; s++) g.lineTo(x + Math.sin(clock * 2 + s * 1.3 + wt.y) * 1.1, wy + s * 5.5); } } }
        g.lineWidth = 2; g.strokeStyle = "rgba(255,255,255,.55)"; g.stroke();
        g.fillStyle = "rgba(255,255,255,.8)";
        for (const wt of this.water) { if (wt.under) continue; const n = hash(wt.x, wt.y, 5); if (n < .45) continue;
          const sp = Math.max(0, Math.sin(clock * 2.4 + n * 40)); if (sp > .8) g.fillRect(L + wt.x * T + n * 36 + 3, L + wt.y * T + hash(wt.x, wt.y, 9) * 36 + 3, 1.6, 1.6); }
      }
      // ---- swamp reeds + bubbles
      for (const t of this.swamp) {
        const x0 = L + t.x * T, y0 = L + t.y * T;
        for (let i = 0; i < 5; i++) { const rx = x0 + 4 + hash(t.x, t.y, 20 + i) * 36, ry = y0 + 12 + hash(t.x, t.y, 30 + i) * 28, sw = Math.sin(clock * 1.4 + i * 1.9 + t.x) * 1.3;
          g.strokeStyle = "#3f5a22"; g.lineWidth = 1.2; g.beginPath(); g.moveTo(rx, ry); g.quadraticCurveTo(rx + sw * .4, ry - 5, rx + sw, ry - 9); g.stroke();
          g.fillStyle = "#6a4a28"; g.fillRect(rx + sw - .9, ry - 11, 1.8, 3.4); }
        const b = (clock * .6 + hash(t.x, t.y, 3)) % 1; if (hash(t.x, t.y, 4) > .4) { g.strokeStyle = `rgba(200,230,215,${.6 * (1 - b)})`; g.lineWidth = .8; g.beginPath(); g.arc(x0 + 12 + hash(t.x, t.y, 6) * 20, y0 + 24, 1 + b * 3.5, 0, TAU); g.stroke(); }
      }
      // ---- trees: individual canopies sway gently
      const trees = [];
      for (const t of this.forest) { const x0 = L + t.x * T, y0 = L + t.y * T, n = 6 + ((hash(t.x, t.y, 40) * 3) | 0);
        for (let i = 0; i < n; i++) { const gx = (i % 3) * 13 + 7, gy = ((i / 3) | 0) * 13 + 8;
          trees.push({ x: x0 + Math.max(5, Math.min(39, gx + (hash(t.x, t.y, 50 + i) - .5) * 9)), y: y0 + Math.max(7, Math.min(40, gy + (hash(t.x, t.y, 60 + i) - .5) * 9)),
                       r: 5.2 + hash(t.x, t.y, 70 + i) * 3, k: hash(t.x, t.y, 80 + i), p: hash(t.x, t.y, 90 + i) * TAU }); } }
      trees.sort((a, b) => a.y - b.y);
      for (const tr of trees) {
        const sway = calm ? 0 : Math.sin(clock * 1.3 + tr.p + tr.x * .05) * (tr.r * .16);
        g.fillStyle = "rgba(0,0,0,.2)"; g.beginPath(); g.ellipse(tr.x + 3, tr.y + 2.5, tr.r * .95, tr.r * .5, 0, 0, TAU); g.fill();
        g.fillStyle = "#5a3d24"; g.fillRect(tr.x - .9, tr.y - 1, 1.8, 3.2);
        if (tr.k < .28) {                                                                  // conifer
          const cols = ["#1f5a44", "#2a6f52", "#378762"];
          for (let j = 0; j < 3; j++) { const yy = tr.y - 1 - j * tr.r * .5, w = tr.r * (1 - j * .26) + 1;
            poly(g, [[tr.x - w + sway * (j + 1) * .4, yy + 2], [tr.x + sway * (j + 1) * .7, yy - tr.r * .9], [tr.x + w + sway * (j + 1) * .4, yy + 2]], cols[j]); }
        } else {                                                                           // broadleaf
          const pal = tr.k < .6 ? ["#2e6b32", "#3f8a43", "#62ac58"] : tr.k < .85 ? ["#2c6a3d", "#3b8650", "#5aa86a"] : ["#6f7d2c", "#8a9a38", "#b0bd55"];
          circ(g, tr.x + sway * .5, tr.y - tr.r * .35, tr.r, pal[0]); circ(g, tr.x + sway - .8, tr.y - tr.r * .6, tr.r * .78, pal[1]); circ(g, tr.x + sway * 1.3 - 1.6, tr.y - tr.r * .9, tr.r * .42, pal[2]);
        }
      }
      // ---- drifting cloud shadows (cosmetic, never information)
      if (!calm && this.clouds) {
        const bw = f.W * T + 260;
        for (const c of this.clouds) {
          const cx = L - 130 + ((c.x * bw + clock * c.sp) % bw), cy = L + c.y * f.H * T;
          const ci = A.img("env", "cloud", 0);
          if (ci) { const w = ci.width / A.ppt * T, h = ci.height / A.ppt * T; g.save(); g.globalAlpha = Math.min(1, c.a * 6); g.drawImage(ci, cx - w / 2, cy - h / 2, w, h); g.restore(); }
          else { g.save(); g.translate(cx, cy); g.scale(1, c.ry / c.rx); blob(g, 0, 0, c.rx, `rgba(10,20,40,${c.a})`); g.restore(); }
        }
      }
    }
  }
  G.TerrainPainter = TerrainPainter;
  G.TerrainParts = { drawNetwork, pieceFor, tileBitmap, hash };
})(window.GFX = window.GFX || {});
