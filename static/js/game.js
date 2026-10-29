/* IRON GRID V4 client. All rules live on the server; this file renders and sends intents. */
(() => {
  "use strict";
  const TILE = 44, LAB = 22;
  let META = null, W = 14, H = 10, TERRAIN = [];
  const $ = id => document.getElementById(id);
  const key = (x, y) => x + "," + y;
  const label = (x, y) => String.fromCharCode(65 + x) + (y + 1);
  const sleepRaw = ms => new Promise(r => setTimeout(r, ms));

  // ---------------------------------------------------------------- settings
  const SKEY = "irongrid.settings";
  const SND_CHANNELS = { select: "Cursor & select", move: "Unit movement", hit: "Attacks & damage",
                         kill: "Kills & losses", capture: "Captures", turn: "Turn notification",
                         msg: "New chat message", contact: "Contacts & ambushes",
                         heal: "Repairs", err: "Errors", build: "Production & construction" };
  const DEFAULTS = { theme: "dark", keyboard: true, cvd: false, bigtext: false, animspeed: 57,
                     sound: false, volume: 0.8,
                     snd: Object.fromEntries(Object.keys(SND_CHANNELS).map(k => [k, true])),
                     sndvol: Object.fromEntries(Object.keys(SND_CHANNELS).map(k => [k, 1])),
                     zoombar: true, readycounter: true, hoverfx: true,
                     autosave: true, confirmEnd: true, level: "normal" };
  let settings = Object.assign({}, DEFAULTS);
  try { Object.assign(settings, JSON.parse(localStorage.getItem(SKEY) || "{}")); } catch (e) {}
  settings.snd = Object.assign({}, DEFAULTS.snd, settings.snd || {});
  settings.sndvol = Object.assign({}, DEFAULTS.sndvol, settings.sndvol || {});
  if (settings.anim !== undefined && settings.animspeed === undefined)
    settings.animspeed = settings.anim === "off" ? 0 : settings.anim === "fast" ? 85 : 57;
  delete settings.anim;
  function saveSettings() { try { localStorage.setItem(SKEY, JSON.stringify(settings)); } catch (e) {} }
  function applySettings() {
    let t = settings.theme;
    if (t === "auto") t = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    const r = document.documentElement;
    r.dataset.theme = t; r.dataset.bsTheme = t;
    if (settings.cvd) r.dataset.cvd = "1"; else delete r.dataset.cvd;
    r.classList.toggle("bigtext", !!settings.bigtext);
    $("kbd-hint").textContent = settings.keyboard
      ? "Keyboard on — arrows move the cursor · Enter select/confirm · Tab next unit · T next target · E end turn · ? help"
      : "Keyboard control is off (Settings → Keyboard control).";
  }
  const speed = ms => settings.animspeed <= 0 ? 0
    : ms * (1.8 - (settings.animspeed / 100) * 1.6);   // animation-speed slider
  const sleep = ms => (speed(ms) ? sleepRaw(speed(ms)) : Promise.resolve());

  // ---------------------------------------------------------------- audio (optional)
  let actx = null;
  const BEEP_VOLUME = 0.012;
  // [freq, duration, waveform, second-freq] — second-freq plays a beat later (two-tone sounds)
  const SND_MAP = {
    select: [520, .05, "square"], move: [294, .07, "triangle"],
    hit: [147, .12, "sawtooth"], kill: [98, .22, "sawtooth", 62],
    capture: [523, .12, "triangle", 784], turn: [440, .1, "sine", 587],
    heal: [740, .1, "sine"], err: [110, .14, "square"],
    msg: [880, .12, "sine", 1175], contact: [220, .16, "square", 175],
    build: [196, .09, "square", 262],
  };
  function tone(f, d, type, vol, when) {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = f; g.gain.value = vol;
    o.connect(g); g.connect(actx.destination);
    o.start(actx.currentTime + when); o.stop(actx.currentTime + when + d);
  }
  function beep(kind) {
    if (!settings.sound) return;
    if (settings.snd && settings.snd[kind] === false) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const [f, d, type, f2] = SND_MAP[kind] || SND_MAP.select;
      const vol = BEEP_VOLUME * (settings.volume !== undefined ? settings.volume : 0.8)
                  * (settings.sndvol[kind] !== undefined ? settings.sndvol[kind] : 1);
      tone(f, d, type, vol, 0);
      if (f2) tone(f2, d, type, vol, d * 0.85);
    } catch (e) {}
  }

  // ---------------------------------------------------------------- state
  let state = null, seen = new Set(), visible = new Set();
  let sel = null;            // {unit, moves:Set, attacks:Map}
  let selB = null;           // selected building (for build menu)
  let busy = false, hover = null, cursor = { x: 2, y: 8 };
  let floats = [], anim = null, flash = null, logFilter = "all";
  let g = null;              // active 2d context (screen or export)
  const canvas = $("board"), screenCtx = canvas.getContext("2d");
  g = screenCtx;

  // ---------------------------------------------------------------- zoom & pan (bitmap scaling + scroll pan)
  const view = { s: 1 };
  function applyZoom() {
    const bw = LAB + W * TILE, bh = LAB + H * TILE;
    canvas.style.width = Math.round(bw * view.s) + "px";
    canvas.style.height = Math.round(bh * view.s) + "px";
  }
  function zoomBy(f) { view.s = Math.min(2.5, Math.max(0.5, view.s * f)); applyZoom(); }
  function zoomFit() {
    const box = $("board-scroll");
    const bw = LAB + W * TILE, bh = LAB + H * TILE;
    view.s = Math.min(1.2, Math.max(0.4, Math.min((box.clientWidth - 8) / bw, (box.clientHeight - 8) / bh)));
    applyZoom();
  }
  function zoomReset() { view.s = 1; applyZoom(); }
  let panning = null, panned = false;
  canvas.addEventListener("mousedown", e => { panning = { x: e.clientX, y: e.clientY, l: $("board-scroll").scrollLeft, t: $("board-scroll").scrollTop }; panned = false; });
  window.addEventListener("mousemove", e => {
    if (!panning) return;
    const dx = e.clientX - panning.x, dy = e.clientY - panning.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) panned = true;
    $("board-scroll").scrollLeft = panning.l - dx;
    $("board-scroll").scrollTop = panning.t - dy;
  });
  window.addEventListener("mouseup", () => { panning = null; });
  canvas.addEventListener("wheel", e => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.12 : 0.9); }, { passive: false });

  async function api(path, body, method) {
    const opt = body !== undefined
      ? { method: method || "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : (method ? { method } : {});
    const r = await fetch(path, opt);
    if (r.status === 401) { location.href = "/lobby"; throw new Error("login required"); }
    const j = await r.json().catch(() => ({ ok: false, error: "bad response" }));
    if (!r.ok || j.ok === false) throw new Error(j.error || ("HTTP " + r.status));
    return j;
  }
  const U = t => META.units[t];
  const UDEF = {name: "Unknown", code: "???", cat: "-", cls: "foot", hp: 1, move: 0, cost: 0,
                rng: [1, 1], vis: 1, capture: false, indirect: false, move_fire: false,
                atk: {soft: 0, armor: 0, hard: 0, air: 0, sea: 0}, desc: ""};
  const findUnit = id => state.units.find(u => u.id === id);
  const unitAt = (x, y) => state.units.find(u => u.x === x && u.y === y);
  const buildingAt = (x, y) => state.buildings.find(b => b.x === x && b.y === y);
  let UNIT_TILE = new Map();      // perf: tile -> units, rebuilt per state
  function rebuildIndex() {
    UNIT_TILE = new Map();
    for (const u of state.units) {
      const k = u.x + "," + u.y;
      if (!UNIT_TILE.has(k)) UNIT_TILE.set(k, []);
      UNIT_TILE.get(k).push(u);
    }
  }
  const myUnits = () => state.units.filter(u => u.side === "P");
  const uname = u => `${u.side === "P" ? "Our" : "Enemy"} ${(U(u.type) || UDEF).code}-${u.id}`;
  const err = e => { toast(e.message, "bad"); beep("err"); };

  async function refreshCmdr() {
    try {
      const j = await api("/api/me");
      if (j.user) $("cmdr").textContent = `${j.user.name} · ${j.user.rank} ${j.user.title}`;
    } catch (e) {}
  }

  // ---------------------------------------------------------------- palette
  function pal() {
    const light = document.documentElement.dataset.theme === "light", cvd = !!settings.cvd;
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
  const CLSCOL = { foot: "#2b8a4a", tread: "#b8761a", air: "#2b82b8" };
  const px = x => LAB + x * TILE, py = y => LAB + y * TILE;

  // ---------------------------------------------------------------- drawing
  function drawScene(target, ui) {
    const prev = g; g = target;
    try {
      const P = pal(), cw = LAB + W * TILE, ch = LAB + H * TILE;
      g.fillStyle = P.bg; g.fillRect(0, 0, cw, ch);
      g.font = "bold 11px system-ui"; g.fillStyle = P.lab; g.textAlign = "center"; g.textBaseline = "middle";
      for (let x = 0; x < W; x++) g.fillText(String.fromCharCode(65 + x), px(x) + TILE / 2, LAB / 2);
      for (let y = 0; y < H; y++) g.fillText(String(y + 1), LAB / 2, py(y) + TILE / 2);
      const GL = { "=": "═", "M": "▲", "W": "≋", "S": "⁞", "F": "♣", "B": "≡", "U": "▦", "R": "╬",
                   "~": "∴", "O": "≈" };
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (!TERRAIN[y]) continue;
        const c = TERRAIN[y][x], [c1, c2] = P.tiles[c] || P.tiles["."];
        g.fillStyle = (x + y) % 2 ? c1 : c2; g.fillRect(px(x), py(y), TILE, TILE);
        if (GL[c]) { g.fillStyle = P.glyph[c]; g.font = "13px system-ui"; g.fillText(GL[c], px(x) + TILE / 2, py(y) + TILE / 2); }
        const k = key(x, y);
        if (!seen.has(k)) { g.fillStyle = "rgba(3,5,8,0.88)"; g.fillRect(px(x), py(y), TILE, TILE); }
        else if (!visible.has(k)) { g.fillStyle = "rgba(3,5,8,0.45)"; g.fillRect(px(x), py(y), TILE, TILE); }
      }
      g.strokeStyle = P.grid; g.lineWidth = 1;
      for (let x = 0; x <= W; x++) { g.beginPath(); g.moveTo(px(x), LAB); g.lineTo(px(x), ch); g.stroke(); }
      for (let y = 0; y <= H; y++) { g.beginPath(); g.moveTo(LAB, py(y)); g.lineTo(cw, py(y)); g.stroke(); }
      drawBuildings(P);
      if (ui && sel) drawSelection(P);
      drawUnits(P);
      if (ui) { drawForecast(P); drawFloats(P); drawCursor(P); }
    } finally { g = prev; }
  }
  function drawBuildings(P) {
    const GL = { HQ: "★", factory: "⚙", city: "⌂", barracks: "⛺", fort: "✚",
                 radar: "◉", airbase: "✈", airfield: "✈", harbor: "⚓", port: "⚓",
                 shipyard: "⚒", battery: "☗" };
    for (const b of state.buildings) {
      const x = px(b.x), y = py(b.y);
      const col = b.side ? P[b.side] : (P.light ? "#59657b" : "#9aa7bb");
      g.globalAlpha = b.visible ? 1 : 0.55;
      g.fillStyle = P.light ? "rgba(255,255,255,.45)" : "rgba(255,255,255,0.05)";
      g.fillRect(x + 3, y + 3, TILE - 6, TILE - 6);
      g.strokeStyle = col; g.lineWidth = 2; g.strokeRect(x + 4, y + 4, TILE - 8, TILE - 8);
      g.fillStyle = col; g.font = `${b.type === "HQ" ? 22 : 17}px system-ui`;
      g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(GL[b.type], x + TILE / 2, y + TILE / 2 - 2);
      if (b.level > 1) { g.font = "bold 9px system-ui"; g.fillText("L" + b.level, x + TILE - 9, y + 8); }
      if (b.cap) { g.font = "bold 9px system-ui"; g.fillStyle = "#ffb454";
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
  function drawSelection(P) {
    g.fillStyle = P.light ? "rgba(10,100,200,.28)" : "rgba(76,195,255,0.22)";
    for (const k of sel.moves) { const [x, y] = k.split(",").map(Number); g.fillRect(px(x) + 2, py(y) + 2, TILE - 4, TILE - 4); }
    for (const [id] of sel.attacks) {
      const u = findUnit(id); if (!u) continue;
      g.strokeStyle = P.A; g.lineWidth = 3; g.strokeRect(px(u.x) + 2, py(u.y) + 2, TILE - 4, TILE - 4);
    }
    const u = sel.unit;
    g.strokeStyle = P.P; g.lineWidth = 2; g.strokeRect(px(u.x) + 1, py(u.y) + 1, TILE - 2, TILE - 2);
  }
  function unitPos(u) {
    if (anim && anim.id === u.id) {
      const t = Math.min(1, (performance.now() - anim.start) / anim.dur), e = 1 - Math.pow(1 - t, 2);
      return [anim.fx + (anim.tx - anim.fx) * e, anim.fy + (anim.ty - anim.fy) * e];
    }
    return [u.x, u.y];
  }
  function drawUnits(P) {
    const stacks = {};
    for (const u of state.units) {
      const k = u.x + "," + u.y;
      const n = stacks[k] = (stacks[k] || 0) + 1;
      const off = n > 1 ? 7 : 0;
      const [gx, gy] = unitPos(u), x = LAB + gx * TILE + off, y = LAB + gy * TILE - off,
            t = U(u.type) || UDEF;
      const col = P[u.side];
      const spent = u.side === "P" && (u.acted || (u.moved && !t.move_fire));
      g.globalAlpha = spent ? 0.5 : 1;
      g.fillStyle = u.side === "P" ? P.uP : P.uA; g.strokeStyle = col; g.lineWidth = 2;
      roundRect(x + 4, y + 4, TILE - 8, TILE - 8, 6); g.fill(); g.stroke();
      g.fillStyle = P.light ? P.text : col; g.font = "bold 12px system-ui"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(t.code, x + TILE / 2, y + TILE / 2 - 3);
      g.fillStyle = CLSCOL[t.cls]; g.fillRect(x + 5, y + 5, 11, 11);
      g.fillStyle = "#fff"; g.font = "bold 8px system-ui"; g.fillText(t.cls[0].toUpperCase(), x + 10.5, y + 11);
      g.fillStyle = "rgba(0,0,0,.6)"; g.fillRect(x + 7, y + TILE - 11, TILE - 14, 5);
      const r = u.hp / u.mhp;
      g.fillStyle = r > 0.5 ? "#2fd47a" : r > 0.25 ? "#ffb454" : "#ff5d5d";
      g.fillRect(x + 7, y + TILE - 11, (TILE - 14) * r, 5);
      g.fillStyle = P.light ? P.text : "#fff"; g.font = "bold 9px system-ui"; g.textAlign = "right";
      g.fillText(String(u.hp), x + TILE - 6, y + 11); g.textAlign = "center";
      g.globalAlpha = 1;
    }
  }
  function roundRect(x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function drawForecast(P) {
    if (!sel || settings.hoverfx === false) return;
    for (const tile of [hover, settings.keyboard ? cursor : null]) {
      if (!tile) continue;
      const u = unitAt(tile.x, tile.y);
      const bb = u ? null : buildingAt(tile.x, tile.y);
      const tgt = u || bb;
      if (!tgt) continue;
      const a = sel.attacks.get(tgt.id);
      if (!a) continue;
      const txt = `-${a.dmg}${a.counter ? "  ↩" + a.counter : ""}${a.kill ? "  KILL" : ""}`;
      g.font = "bold 12px system-ui"; const w = g.measureText(txt).width + 12;
      const bx = Math.min(Math.max(px(tile.x) + TILE / 2 - w / 2, LAB), LAB + W * TILE - w), by = Math.max(py(tile.y) - 20, 0);
      g.fillStyle = "rgba(10,14,20,.92)"; g.fillRect(bx, by, w, 18);
      g.strokeStyle = P.A; g.lineWidth = 1; g.strokeRect(bx, by, w, 18);
      g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(txt, bx + w / 2, by + 9);
    }
  }
  function drawFloats() {
    const now = performance.now();
    floats = floats.filter(f => now - f.born < 1100);
    for (const f of floats) {
      const t = (now - f.born) / 1100;
      g.globalAlpha = 1 - t; g.fillStyle = f.color; g.font = "bold 14px system-ui";
      g.strokeStyle = "rgba(0,0,0,.7)"; g.lineWidth = 3; g.textAlign = "center";
      const x = px(f.x) + TILE / 2, y = py(f.y) - 4 - t * 22;
      g.strokeText(f.text, x, y); g.fillText(f.text, x, y); g.globalAlpha = 1;
    }
  }
  function drawCursor(P) {
    if (hover) { g.strokeStyle = "rgba(255,255,255,.4)"; g.lineWidth = 1; g.strokeRect(px(hover.x) + 1, py(hover.y) + 1, TILE - 2, TILE - 2); }
    if (settings.keyboard) {
      const pulse = 0.65 + 0.35 * Math.sin(performance.now() / 180);
      g.strokeStyle = `rgba(255,180,84,${pulse})`; g.lineWidth = 3;
      g.strokeRect(px(cursor.x) + 1.5, py(cursor.y) + 1.5, TILE - 3, TILE - 3);
    }
    if (flash && performance.now() - flash.t < 1400) {
      g.strokeStyle = `rgba(255,255,80,${1 - (performance.now() - flash.t) / 1400})`; g.lineWidth = 4;
      g.strokeRect(px(flash.x) - 2, py(flash.y) - 2, TILE + 4, TILE + 4);
    }
  }
  let dirty = true;
  function markDirty() { dirty = true; }
  (function loop() {
    if (state && TERRAIN.length && (dirty || anim || floats.length || hover)) {
      dirty = false;                       // clear first: a throw can never wedge the loop
      try { drawScene(screenCtx, true); } catch (e) { /* one bad frame must not freeze the board */ }
    }
    requestAnimationFrame(loop);
  })();

  function pop(x, y, text, color) { floats.push({ x, y, text, color, born: performance.now() }); }

  // ---------------------------------------------------------------- HUD / top bar
  function updateTop() {
    $("turn").textContent = state.turn;
    const turnState = $("turn-state");
    if (turnState) {
      turnState.textContent = state.turn_label || (state.your_turn ? "Your move" : "Opponent's move");
      turnState.title = state.your_turn ? "It is your turn." : "It is the opponent's turn.";
    }
    $("credits").textContent = state.credits;
    $("income").textContent = "+" + state.income + "/turn";
    $("forces").textContent = myUnits().length;
    $("cap").textContent = state.unit_cap;
    $("lvl-badge").textContent = (state.level === "pvp" ? "PvP" : state.level) + " · T" + (state.tier || 2);
    const ready = myUnits().filter(u => !u.acted && !(u.moved && !(U(u.type) || UDEF).move_fire)).length;
    $("ready-stat").textContent = `${ready} / ${myUnits().length - ready}`;
    $("ready-wrap").style.display = settings.readycounter ? "" : "none";
    $("zoombar").classList.toggle("hidden", !settings.zoombar);
    $("end-turn").disabled = busy || state.over || state.your_turn === false;
  }
  function toast(text, tone) {
    const el = $("statusline"); el.textContent = text;
    el.style.borderColor = tone === "bad" ? "var(--bad)" : "var(--line)";
    setTimeout(() => { el.style.borderColor = ""; }, 1800);
  }
  function tileStatus(x, y) {
    const c = TERRAIN[y][x], T = META.terrain[c], k = key(x, y);
    let s = `${label(x, y)} · ${T.name} · def ${Math.round(T.def * 100)}% · foot ${T.foot > 90 ? "—" : T.foot} / tread ${T.tread > 90 ? "—" : T.tread} / air ${T.air}`;
    const b = buildingAt(x, y); if (b) s += ` · ${b.type}${b.side ? (b.side === "P" ? " (ours)" : " (enemy)") : " (neutral)"}`;
    const u = unitAt(x, y); if (u) s += ` · ${uname(u)} ${u.hp}/${u.mhp} HP`;
    if (!seen.has(k)) s = `${label(x, y)} · unexplored`;
    return s;
  }
  function updateStatusline() {
    const t = settings.keyboard ? cursor : (hover || cursor);
    if (t && state) $("statusline").textContent = tileStatus(t.x, t.y);
  }

  // ---------------------------------------------------------------- state loading
  function loadState(s) {
    if (s.w && s.h && (s.w !== W || s.h !== H)) {       // board size is per-game (tier 4+)
      W = s.w; H = s.h;
      canvas.width = LAB + W * TILE; canvas.height = LAB + H * TILE;
      view.s = 1;
    }
    if (s.ter && s.ter.length === H && s.ter[0].length === W) {   // live terrain
      let diff = TERRAIN.length !== s.ter.length;
      if (!diff) for (let i = 0; i < s.ter.length; i++) if (TERRAIN[i] !== s.ter[i]) { diff = true; break; }
      if (diff) TERRAIN = s.ter;
    } else if (s.map !== undefined && META.maps && META.maps[s.map]) {
      const m = META.maps[s.map];
      if (m.terrain.length === H && TERRAIN !== m.terrain) TERRAIN = m.terrain;
    }
    if (s.tier && s.tier !== manualTier) buildManual();
    applyZoom();
    state = s; visible = new Set(s.visible); seen = new Set(s.seen);
    if (sel) { const u = findUnit(sel.unit.id); if (u) sel.unit = u; else sel = null; }
    if (selB) { const b = buildingAt(selB.x, selB.y); if (b) selB = b; }   // capture/upgrade refresh
    const prevCredits = state ? state.credits : 0;
    const wasMyTurn = state ? state.your_turn !== false : false;
    updateTop(); updateInfo(); renderLog(); renderLedger(); watchOpponent(); rebuildIndex(); markDirty();
    if (!s.over) {
      let phase = s.turn_label || (s.your_turn ? "Your move" : "Opponent's move");
      if (s.level === "pvp" && s.your_turn === false && s.opp_online === false)
        phase += " — opponent is away; the battle is kept open (rejoin from the lobby anytime)";
      $("statusline").textContent = `Turn ${s.turn} — ${phase}.`;
      if (!wasMyTurn && s.your_turn && s.credits > prevCredits)
        toast(`Turn ${s.turn} — income collected: ${s.credits} cr.`, "good");
    }
    if (s.over) { showEnd(s); refreshCmdr(); } else $("end-overlay").classList.add("hidden");
  }

  // ---------------------------------------------------------------- info panel
  function setInfo(html) { $("info-body").innerHTML = html; $("info-actions").innerHTML = ""; }
  function addBtn(html, fn, cls, disabled, reason) {
    const b = document.createElement("button");
    b.className = "btn-ig sm " + (cls || "") + (disabled ? " off" : "");
    b.innerHTML = disabled ? "⛔ " + html : html;
    if (disabled) {
      b.title = reason || "Not available";
      b.addEventListener("click", () => { toast("⛔ " + (reason || "Not available"), "bad"); beep("err"); });
    } else {
      b.addEventListener("click", fn);
    }
    $("info-actions").appendChild(b); return b;
  }
  const clsPill = c => `<span class="pill ${c}">${c.toUpperCase()}</span>`;
  function updateInfo() {
    if (!state) return;
    if (sel) showUnitInfo(sel.unit, true);
    else if (selB) showBuildingInfo(selB);
    else setInfo(`<span class="muted">Select a unit, building or tile. Click, or use the cursor and <kbd>Enter</kbd>.</span>`);
  }
  function showUnitInfo(u, selectable) {
    const t = U(u.type) || UDEF, mine = u.side === "P";
    const st = mine ? (u.acted ? "spent" : u.moved ? "moved — can still attack" : "ready") : "hostile";
    const satk = v => v > 0 ? Math.max(1, Math.round(v * u.hp / u.mhp)) : 0;   // real, HP-scaled ATK
    const road = (t.move / META.terrain["="][t.cls]).toFixed(t.cls === "air" ? 0 : 0);
    let html = `<div><span class="title">${t.full}</span> <span class="${mine ? "tag-p" : "tag-a"}">${uname(u)}</span> ${clsPill(t.cls)}</div>
      <div class="sub">${t.cat} · ${mine ? "status: " + st : "hostile contact"} · ${t.capture ? "can capture" : "cannot capture"}</div>
      <div class="statgrid">
        <div><span>HP</span><b>${u.hp}/${u.mhp}</b></div>
        <div><span>MOVE</span><b>${t.move}</b></div>
        <div><span>RANGE</span><b>${t.rng[0] === t.rng[1] ? t.rng[0] : t.rng.join("–")}</b></div>
        <div><span>VISION</span><b>${t.vis}</b></div>
        ${u.fuel !== undefined ? `<div><span>FUEL</span><b>${u.fuel}/${u.fuel_max || 32}</b></div>` : ""}
        <div><span>ATK soft</span><b>${satk(t.atk.soft)}</b></div>
        <div><span>ATK armor</span><b>${satk(t.atk.armor)}</b></div>
        <div><span>ATK hard</span><b>${satk(t.atk.hard)}</b></div>
        <div><span>ATK rotary</span><b>${satk(t.atk.rot)}</b></div>
        <div><span>ATK fixed</span><b>${satk(t.atk.fix)}</b></div>
        <div><span>ATK sea</span><b>${satk(t.atk.sea || 0)}</b></div>
        <div><span>ATK bld</span><b>${satk(t.atk.bld || 0)}</b></div>
        <div><span>COST</span><b>${t.cost}</b></div>
      </div>
      ${(state.tier || 2) >= 4 && META.upkeep ? `<div class="sub">Upkeep ${META.upkeep[u.type] !== undefined ? META.upkeep[u.type] : (META.upkeep["_" + t.cls] || 2)} cr/turn.</div>` : ""}
      <div class="sub">${t.cls === "air" ? "Flies over all terrain." : `Move ${t.move} on plains · ${road} tiles along roads · ${t.cls === "foot" ? "can cross mountains" : "cannot cross mountains"}.`}
      ${t.indirect ? ` Indirect fire: ${t.move_fire ? "can move and fire; " : "cannot move and fire; "}never counters.` : ""}
      ATK values shown are scaled by current HP (full values in the Manual).</div>
      <div class="sub" style="margin-top:6px">${t.desc}</div>`;
    if (!mine && sel) {
      const a = sel.attacks.get(u.id);
      if (a) html += `<div class="forecast">Your ${(U(sel.unit.type) || UDEF).code} would deal <b>${a.dmg}</b> damage${a.kill ? " — <b>destroys it</b>" : ""}${a.counter ? `, taking <b>${a.counter}</b> back` : ", no counter"}.</div>`;
    }
    setInfo(html);
    if (mine && !busy && !state.over && state.your_turn !== false) {
      if (!u.acted) addBtn("Wait <kbd>W</kbd>", () => doWait(u.id), "");
      if (sel && sel.unit.id === u.id && sel.attacks.size) {
        for (const [tid, a] of sel.attacks) {
          const t2 = findUnit(tid);
          const b2 = t2 ? null : state.buildings.find(b3 => b3.id === tid);
          const tn = t2 ? `${t2.side === "P" ? "Our" : "Enemy"} ${(U(t2.type) || UDEF).code}-${t2.id}`
                      : `the ${b2 ? b2.type : "target"}`;
          addBtn(`⚔ Fire at ${tn} (-${a.dmg}${a.kill ? " KILL" : ""})`, () => doAttack(tid), "primary");
        }
      }
      if (u.type === "eng" && !u.acted && !buildingAt(u.x, u.y) && [".", "="].includes(TERRAIN[u.y][u.x])) {
        addBtn(`Found factory ${META.found_cost} <kbd>F</kbd>`, () => doFound(u.id), "good", state.credits < META.found_cost);
      }
      if ((state.tier || 2) >= 3 && !u.acted) {
        const terr = TERRAIN[u.y][u.x];
        if (u.type === "eng") {
          if ([".", "F", "S"].includes(terr) && !buildingAt(u.x, u.y))
            addBtn("⚒ Road 100", () => doConstruct(u.id, "road"), "", state.credits < 100,
              state.credits < 100 ? "Insufficient funds" : "");
          if ([".", "="].includes(terr) && !buildingAt(u.x, u.y))
            addBtn("⚒ Rail 200", () => doConstruct(u.id, "rail"), "", state.credits < 200,
              state.credits < 200 ? "Insufficient funds" : "");
          if (!buildingAt(u.x, u.y)) {
            addBtn("⚒ Fort 300", () => doConstruct(u.id, "fort"), "", state.credits < 300,
              state.credits < 300 ? "Insufficient funds" : "");
            addBtn("⚒ Airfield 1500", () => doConstruct(u.id, "airfield"), "good", state.credits < 1500,
              state.credits < 1500 ? "Insufficient funds" : "");
            addBtn("☗ Battery 800", () => doConstruct(u.id, "battery"), "", state.credits < 800,
              state.credits < 800 ? "Insufficient funds" : "");
            addBtn("⚓ Port 1200", () => doConstruct(u.id, "port"), "good", state.credits < 1200,
              state.credits < 1200 ? "Insufficient funds" : "");
          }
        }
        if (u.type === "ls") {
          const cap = 2, have = u.cargo || 0;
          const pax = adjacentLoadable(u);
          if (have < cap && pax)
            addBtn(`⚓ Load ${(U(pax.type) || UDEF).code} (${have}/${cap})`, () => doLoad(u.id), "primary");
          if (have > 0) {
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const bx = u.x + dx, by = u.y + dy;
              if (bx >= 0 && by >= 0 && bx < W && by < H && TERRAIN[by][bx] === "~" && !unitAt(bx, by))
                addBtn(`⚓ Unload → ${label(bx, by)}`, () => doUnload(u.id, bx, by), "primary");
            }
          }
        }
        if ((u.type === "th" || u.type === "ls") && u.manifest && u.manifest.length) {
        const rows = u.manifest.map(c => {
          const cu = U(c.type) || UDEF;
          return `<div class="dossier-bar"><span>${cu.code}</span><span class="dbar"><i style="width:${Math.round(100 * c.hp / cu.hp)}%"></i></span><b>${c.hp}/${cu.hp}</b></div>`;
        }).join("");
        $("info-actions").innerHTML += `<div class="forecast" style="width:100%">⚓ Cargo manifest<br>${rows}</div>`;
      }
      if (u.type === "th" && !u.cargo) {
          const pax = unitAt(u.x, u.y);
          if (pax && pax.side === "P" && ["inf", "eng", "at", "mortar", "sf"].includes(pax.type))
            addBtn(`✈ Load ${(U(pax.type) || UDEF).code}`, () => doLoad(u.id), "primary");
        }
        if (u.type === "th" && u.cargo) {
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const bx = u.x + dx, by = u.y + dy;
            if (bx >= 0 && by >= 0 && bx < W && by < H && TERRAIN[by][bx] !== "W" && !unitAt(bx, by))
              addBtn(`✈ Unload → ${label(bx, by)}`, () => doUnload(u.id, bx, by), "primary");
          }
        }
        if (u.type === "bl") {
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const bx = u.x + dx, by = u.y + dy;
            if (bx >= 0 && by >= 0 && bx < W && by < H && TERRAIN[by][bx] === "W") {
              addBtn(`⚒ Bridge 250 → ${label(bx, by)}`, () => doConstruct(u.id, "bridge", bx, by), "good", state.credits < 250,
                state.credits < 250 ? "Insufficient funds" : "");
              break;
            }
          }
        }
        if (u.type === "eng" && (state.tier || 2) >= 4) {
          for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const bx = u.x + dx, by = u.y + dy;
            if (bx >= 0 && by >= 0 && bx < W && by < H && TERRAIN[by][bx] === "B") {
              addBtn(`💥 Demolish bridge → ${label(bx, by)}`, () => doDemoBridge(u.id, bx, by), "danger");
              break;
            }
          }
        }
      }
      if (selectable) addBtn("Cancel <kbd>Esc</kbd>", cancelSel, "");
    }
  }
  function showBuildingInfo(b) {
    const names = { HQ: "Headquarters", factory: "Factory", city: "City", barracks: "Barracks",
                    fort: "Fortification", radar: "Radar Station",
                    airbase: "Airbase", airfield: "Airfield", harbor: "Harbor", port: "Port",
                    shipyard: "Shipyard", battery: "Coastal Battery" };
    const lvl = b.level || 1;
    const inc = b.hp !== undefined && b.max_hp
      ? Math.floor(META.income[b.type] * (1 + 0.5 * (lvl - 1)) * (b.hp <= b.max_hp / 2 ? 0 : b.hp / b.max_hp))
      : Math.floor(META.income[b.type] * (1 + 0.5 * (lvl - 1)));
    const heal = (META.heal[b.type] || 0) + (lvl - 1), mine = b.side === "P";
    const owner = b.side === "P" ? `<span class="tag-p">ours</span>` : b.side === "A" ? `<span class="tag-a">enemy</span>` : "neutral";
    const needT = b.type === "HQ" ? 3 : 2;
    const capTxt = b.cap ? `<div class="forecast">${b.cap.side === "P" ? "Our unit" : "Enemy unit"} is capturing this (${b.cap.pts}/${needT}).</div>` : "";
    const q = state.queue ? state.queue.filter(o => o.x === b.x && o.y === b.y) : [];
    const qTxt = q.length ? `<div class="sub">⚙ Producing ${(U(q[0].utype) || UDEF).code} — ${q[0].left} turn(s) left.</div>` : "";
    const upTxt = b.upgrading ? `<div class="sub">⚙ Upgrading — ${b.upgrading} turn(s) left.</div>` : "";
    const moneyOnly = ["HQ", "city"].includes(b.type)
      ? `<div class="sub">Income building — it produces credits only and builds nothing.</div>` : "";
    setInfo(`<div><span class="title">${names[b.type]}</span> ${owner} · ${label(b.x, b.y)}${b.visible ? "" : " <span class='muted'>(last seen)</span>"}${capTxt}</div>${upTxt}${qTxt}${moneyOnly}
      ${["battery", "radar"].includes(b.type) && META.defenses ? (() => {
        const D = META.defenses[b.type];
        return `<div class="statgrid">
          <div><span>POWER</span><b>${D.power}${b.type === "battery" ? "+" + 2 * (lvl - 1) : ""}</b></div>
          <div><span>RANGE</span><b>${D.range[0] === D.range[1] ? D.range[0] || "—" : D.range.join("–")}</b></div>
          <div><span>DETECTION</span><b>${D.detection}${b.type === "radar" ? " (sweep)" : ""}</b></div>
          <div><span>DEFENSE</span><b>${Math.round((1 - META.b_def[b.type]) * 100)}%</b></div>
        </div>
        <div class="sub">${b.type === "battery"
          ? "Automatically fires at the strongest visible enemy ship within range 2-4 at the start of your turn."
          : "Sweeps a wide detection circle (6) around itself, revealing aircraft, ships and ground forces in the fog."}</div>`;
      })() : `<div class="statgrid">
        <div><span>INCOME</span><b>+${inc}</b></div><div><span>LEVEL</span><b>${lvl}/${META.max_level}</b></div>
        <div><span>REPAIR</span><b>+${heal}</b></div>
        <div><span>DEFENSE</span><b>${Math.round((1 - META.b_def[b.type]) * 100)}%</b></div>
        ${b.hp !== undefined ? `<div><span>HP</span><b>${b.hp}/${b.max_hp}</b></div>
        <div><span>DMG TAKEN</span><b>${Math.round((1 - b.hp / b.max_hp) * 100)}%</b></div>` : ""}
      </div>
      ${b.hp !== undefined && b.hp < b.max_hp ? `<div class="sub">⚠ Income at ${Math.round(100 * b.hp / b.max_hp)}% until repaired (✚ below).</div>` : ""}`}
      <div class="sub">${b.type === "factory" ? "Upkeep −40 cr/turn. " : ""}Units standing here at the start of their turn repair <b>${heal} HP</b> (costs ${Math.round(META.repair_rate * 100)}% of the HP's value in credits).
      ${b.type === "city" ? "Aircraft cannot repair in cities — use an HQ or factory." : ""}
      Infantry and IFVs capture it by ending a move on it.</div>`);
    if (mine && !busy && !state.over && state.your_turn !== false) {
      if (b.type === "battery") {
        const fired = state.buildings && b.fired === state.turn;
        const targets = state.units.filter(u => u.side === "A" && (U(u.type) || UDEF).cls === "sea"
          && Math.abs(u.x - b.x) + Math.abs(u.y - b.y) >= 2 && Math.abs(u.x - b.x) + Math.abs(u.y - b.y) <= 4
          && state.visible.includes(u.x + "," + u.y));
        for (const t of targets.slice(0, 4))
          addBtn(`☗ Fire at ${(U(t.type) || UDEF).code}-${t.id}`, () => doBatteryFire(b.x, b.y, t.id), "primary");
        if (!targets.length && !fired) $("info-actions").innerHTML += `<span class="muted">No spotted ships in range 2-4.</span>`;
        if (fired) $("info-actions").innerHTML += `<span class="muted">☗ Fired this turn.</span>`;
      }
      if (["airfield", "port", "battery", "radar", "fort"].includes(b.type))
        addBtn("💥 Demolish", () => doDemolish(b.x, b.y), "danger");
      if (b.hp !== undefined && b.max_hp && b.hp < b.max_hp) {
        addBtn(`✚ Repair ${(b.max_hp - b.hp) * 5} cr`, () => doRepairBld(b.x, b.y), "good",
          state.credits < (b.max_hp - b.hp) * 5, state.credits < (b.max_hp - b.hp) * 5 ? "Insufficient funds" : "");
      }
      if (["factory", "barracks", "airbase", "airfield", "shipyard", "harbor"].includes(b.type)) {
        const occupied = unitAt(b.x, b.y);
        const full = myUnits().length >= state.unit_cap;
        const producing = state.queue && state.queue.some(o => o.x === b.x && o.y === b.y);
        if (producing) $("info-actions").innerHTML += `<span class="muted">⏳ Production underway — the next order must wait.</span>`;
        else if (occupied) $("info-actions").innerHTML += `<span class="muted">Tile occupied — move the unit out to build.</span>`;
        else tierUnits().filter(k => (U(k).sites || []).includes(b.type)
            && (U(k).tech || 1) <= (b.level || 1))
          .forEach((k, i) => addBtn(`<b>${i + 1}</b> ${U(k).code} · ${U(k).cost}`,
            () => doBuild(b.x, b.y, k), "", state.credits < U(k).cost || full,
            full ? "Unit cap reached" : state.credits < U(k).cost ? "Insufficient funds" : ""));
      }
      if (lvl < META.max_level) {
        const c = META.upgrade_base * lvl;
        addBtn(`Upgrade ${c} <kbd>U</kbd>`, () => doUpgrade(b.x, b.y), "good",
          state.credits < c || !!b.upgrading,
          b.upgrading ? "Already upgrading" : state.credits < c ? "Insufficient funds" : "");
      }
    }
  }
  function showTerrainInfo(x, y) {
    const T = META.terrain[TERRAIN[y][x]];
    setInfo(`<div><span class="title">${T.name}</span> · ${label(x, y)}</div>
      <div class="statgrid"><div><span>DEFENSE</span><b>${Math.round((1 - T.def) * 100)}%</b></div>
      <div><span>FOOT</span><b>${T.foot > 90 ? "—" : T.foot}</b></div><div><span>TREAD</span><b>${T.tread > 90 ? "—" : T.tread}</b></div>
      <div><span>AIR</span><b>${T.air}</b></div></div><div class="sub">${T.desc}</div>`);
  }
  function renderLedger() {
    const s = state.stats;
    $("ledger").innerHTML = [["Destroyed", s.kills], ["Lost", s.losses], ["HP repaired", s.repaired],
      ["Damage dealt", s.dealt], ["Damage taken", s.taken], ["Units", myUnits().length]]
      .map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join("");
  }

  // ---------------------------------------------------------------- logbook
  const FILTERS = { all: ["All", null], combat: ["Combat", ["combat", "kill"]], kill: ["Kills", ["kill"]],
                    econ: ["Economy", ["build", "repair", "capture"]], intel: ["Contacts", ["contact"]],
                    move: ["Moves", ["move", "system"]] };
  const ICON = { combat: "⚔", kill: "✖", capture: "⚑", repair: "✚", build: "⚙", contact: "◉", move: "➜", system: "•" };
  function buildFilters() {
    $("log-filters").innerHTML = "";
    for (const [k, [name]] of Object.entries(FILTERS)) {
      const b = document.createElement("button"); b.className = "chip" + (k === logFilter ? " on" : ""); b.textContent = name;
      b.addEventListener("click", () => { logFilter = k; buildFilters(); renderLog(); });
      $("log-filters").appendChild(b);
    }
  }
  function renderLog() {
    if (!state) return;
    const cats = FILTERS[logFilter][1];
    const list = state.log.filter(e => !cats || cats.includes(e.cat));
    const el = $("log"); el.innerHTML = "";
    if (!list.length) { el.innerHTML = `<div class="empty">Nothing logged yet.</div>`; return; }
    let lastTurn = null;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (e.turn !== lastTurn) { lastTurn = e.turn; const h = document.createElement("div"); h.className = "th"; h.textContent = "TURN " + e.turn; el.appendChild(h); }
      const d = document.createElement("div");
      d.className = `le tone-${e.tone} cat-${e.cat}` + (e.pos ? " clk" : "");
      d.innerHTML = `<span class="ico">${ICON[e.cat] || "•"}</span><span></span>`;
      d.lastChild.textContent = e.text;
      if (e.pos) d.addEventListener("click", () => { cursor = { x: e.pos[0], y: e.pos[1] }; flash = { x: e.pos[0], y: e.pos[1], t: performance.now() }; updateStatusline(); });
      el.appendChild(d);
    }
  }

  // ---------------------------------------------------------------- manual
  let manualTier = 0;
  function buildManual() {
    const tier = (state && state.tier) || 2;
    manualTier = tier;
    const tierInfo = { 1: "Skirmish", 2: "Combined Arms", 3: "Engineers",
                       4: "Doctrine", 5: "Sky", 6: "Sea" };
    const sysNotes = [
      "Capture cities for income; kill everything or take their HQ. Forests and mountains reduce damage taken; rivers block ground units.",
      "Combined arms: every unit counters another (see the ▲/▽ chips in the Units tab). Repair on friendly buildings; upgrade them for more income and healing.",
      "Captures take 2 consecutive actions (HQ 3). Engineers build roads (0.5 move/tile), railways (0.25 for vehicles), fortifications and airfields. Bridgelayers bridge rivers. Barracks train infantry and support.",
      "Two-step captures. Radar stations sweep a detection circle (grows when upgraded). Training camps start recruits strong. Pick a doctrine before battle.",
      "Aircraft carry fuel (helis 70, strike jets 95, bombers 110, plus map bonus) and refuel at airfields or HQs. Airfields are built by engineers in 2 turns; strike jets need a level-2 one. Transport helis lift infantry.",
      "Ships keep to open water (bridges passable beneath). Submarines hide until sonar (destroyer) or close spotting finds them. Ships bombard the shore; landing ships embark/disembark at harbors, shipyards and beaches (infantry anywhere). Warships are tough; coastal batteries guard the shore.",
    ][tier - 1];
    const hiddenTerr = tier === 1 ? new Set(["=", "S"]) : new Set();
    const terr = Object.entries(META.terrain).filter(([c]) => !hiddenTerr.has(c)).map(([c, T]) =>
      `<tr><td><b>${T.name}</b></td><td class="n">${Math.round((1 - T.def) * 100)}%</td><td class="n">${T.foot > 90 ? "—" : T.foot}</td>
       <td class="n">${T.tread > 90 ? "—" : T.tread}</td><td class="n">${T.air}</td><td>${T.desc}</td></tr>`).join("");
    const B = {
      HQ: "Headquarters — your crown jewel: +300 cr/turn, heals 4, strong defense, 60 HP. Lose it and the war is over (3 capture actions at tier 3+).",
      factory: "Factory — builds vehicles and guns (tanks, artillery, AA). Upkeep −40 cr/turn, heals 3, 40 HP. Can be repaired — or destroyed.",
      city: "City — pure income (+200 cr/turn, heals 2), 40 HP. Captures in 2 actions at tier 3+.",
      barracks: "Barracks — trains infantry and support teams. +80 cr/turn, heals 2, 30 HP.",
      airfield: "Airfield — engineer-built in 2 turns (1500). Builds and refuels drones and helicopters; upgrade to level 2/3 for strike jets and bombers.",
      airbase: "Airbase — a full military field: builds and refuels all aircraft (level 2: fighters, 3: bombers). Money-neutral.",
      shipyard: "Shipyard — builds warships (cruisers and submarines need level 2). Ships berth in the sea beside it. 40 HP.",
      harbor: "Harbor — docks and heals ships, builds corvettes/frigates, earns +200 cr/ton trade. 40 HP.",
      port: "Port — engineer-built on a coast (1200): a harbor you place yourself for embarkation and trade.",
      fort: "Fortification — engineer-built (300). No income; −40% damage taken standing on it. 20 HP; can be shelled.",
      radar: "Radar — sweeps a detection circle (6, 8, 10 by level). Never heals. 25 HP.",
      battery: "Coastal battery — engineer-built (800, tier 6). 20 HP; auto-fires at the strongest spotted enemy ship in range 2–4 (8 damage) each of your turns.",
      road: "Road — ground pays 0.5 movement per tile.",
      rail: "Railway — treads pay 0.25, foot 0.5 per tile.",
      bridge: "Bridge — the only river crossing for ground; ships pass beneath.",
      village: "Village — terrain, not a building: −25% damage taken; infantry moves freely, vehicles slow.",
    };
    const structKeys = ["HQ", "factory", "city", "barracks", "airfield", "airbase", "shipyard",
                        "harbor", "port", "fort", "radar", "battery", "road", "rail", "bridge", "village"]
      .filter(k => (B[k] && (tier >= 2 || ["HQ", "factory", "city"].includes(k))));
    const structRows = structKeys.map(k =>
      `<tr data-k="${k}"><td><b>${k}</b></td><td>${B[k]}</td></tr>`).join("");
    $("manual").innerHTML = `
      <h3>Tier ${tier} — ${tierInfo[tier] || ""}</h3>
      <p>${sysNotes}</p>
      <h3>Structures & terrain reference</h3>
      <input id="st-search" class="chat-in" placeholder="🔍 search structures…" style="margin-bottom:8px">
      <div class="scroll-x"><table class="tbl" id="stb">${structRows}</table></div>
      <h3>Terrain</h3>
      <div class="scroll-x"><table class="tbl"><tr><th>Tile</th><th class="n">Def</th><th class="n">Foot</th><th class="n">Tread</th><th class="n">Air</th><th>Notes</th></tr>${terr}</table></div>
      <h3>Unit database</h3>
      <p class="muted">Open the <b>Units</b> tab (<kbd>D</kbd>) — every unit of this tier has its own dossier:
      stats with bars, all five attack values, ▲/▽ matchup chips, production site, tech level and build time.</p>
      <h3>Economy & repair</h3>
      <p>Rank bands: 0–49 Cadet, then a new rank every 50 points up to Field Marshal at 950–999; 1000 is Iron Marshal.
      Damaged buildings can be repaired from their panel (5 cr per HP). Destroyed buildings are gone.</p>`;
    const stS = $("st-search");
    if (stS) stS.addEventListener("input", () => {
      const q = stS.value.trim().toLowerCase();
      document.querySelectorAll("#stb tr[data-k]").forEach(tr => {
        tr.style.display = !q || tr.dataset.k.toLowerCase().includes(q) || tr.textContent.toLowerCase().includes(q) ? "" : "none";
      });
    });
  }

  // ---------------------------------------------------------------- actions
  function cancelSel() { sel = null; selB = null; updateInfo(); }
  async function selectUnit(u) {
    if (busy || state.over || u.side !== "P") return;
    try {
      const j = await api("/api/ranges", { unit: u.id });
      selB = null;
      sel = { unit: findUnit(u.id) || u, moves: new Set(j.moves.map(p => key(p[0], p[1]))),
              attacks: new Map(j.attacks.map(a => [a.id, a])) };
      showUnitInfo(sel.unit, true); beep("select");
    } catch (e) { err(e); }
  }
  async function doMove(x, y) {
    const id = sel.unit.id, from = { x: sel.unit.x, y: sel.unit.y }; sel = null;
    try {
      const j = await api("/api/move", { unit: id, x, y });
      const mv = (j.events || []).find(e => e.t === "move");
      if (mv) anim = { id, fx: from.x, fy: from.y, tx: mv.to[0], ty: mv.to[1], start: performance.now(), dur: speed(300) || 1 };
      loadState(j.state); await showEvents(j.events); beep("move");
      const u = findUnit(id);
      const spent = !u || u.acted || (u.moved && !(U(u.type) || UDEF).move_fire);
      if (u && !state.over && !spent) await selectUnit(u);   // stays selected until fully spent
      else { sel = null; updateInfo(); }
      setTimeout(() => { if (anim && anim.id === id) anim = null; }, 320);
    } catch (e) { err(e); updateInfo(); }
  }
  async function doAttack(targetId) {
    const id = sel.unit.id; sel = null;
    try { const j = await api("/api/attack", { attacker: id, target: targetId });
      loadState(j.state); await showEvents(j.events); updateInfo(); }
    catch (e) { err(e); updateInfo(); }
  }
  async function doWait(id) { sel = null; try { loadState((await api("/api/wait", { unit: id })).state); } catch (e) { err(e); } }
  async function doBuild(x, y, type) {
    try {
      const j = await api("/api/build", { x, y, type });
      const turns = (META.build_times && META.build_times[type]) || 1;
      loadState(j.state); beep("build");
      selB = buildingAt(x, y); updateInfo();
      if (turns > 1) toast(`⚙ ${U(type).code} ordered — ready in ${turns} turns.`, "good");
    } catch (e) { err(e); }
  }
  async function doUpgrade(x, y) { try { const j = await api("/api/upgrade", { x, y }); loadState(j.state); selB = buildingAt(x, y); updateInfo(); } catch (e) { err(e); } }
  async function doFound(id) { try { const j = await api("/api/found", { unit: id }); sel = null; loadState(j.state); } catch (e) { err(e); } }
  function adjacentLoadable(ship) {
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const tx = ship.x + dx, ty = ship.y + dy;
      if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
      const b = buildingAt(tx, ty);
      const terr = TERRAIN[ty][tx];
      for (const q of unitsAt(tx, ty)) {
        if (q.side !== "P" || q.id === ship.id) continue;
        if (!["foot", "tread"].includes((U(q.type) || UDEF).cls)) continue;
        if ((b && ["harbor", "shipyard"].includes(b.type)) || terr === "~") return q;
        if ((U(q.type) || UDEF).cls === "foot" && [".", "="].includes(terr)) return q;
      }
    }
    return null;
  }
  async function doLoad(id) {
    try {
      loadState((await api("/api/load", { unit: id })).state); beep("move");
      const u = findUnit(id); if (u) await selectUnit(u);   // stay aboard: more loads/unloads
    } catch (e) { err(e); }
  }
  async function doUnload(id, x, y) {
    try {
      loadState((await api("/api/unload", { unit: id, x, y })).state); beep("move");
      const u = findUnit(id); if (u) await selectUnit(u);   // keep working the holds
    } catch (e) { err(e); }
  }
  async function doDemoBridge(id, x, y) {
    try { const j = await api("/api/demolish_bridge", { unit: id, x, y }); sel = null; loadState(j.state); toast("Bridge demolished.", "good"); }
    catch (e) { err(e); }
  }
  function doDemolish(x, y) {
    confirmDialog("Demolish this building?", "It is gone for good - no refund. (Esc to cancel)", [
      { label: "Demolish", hot: "d", cls: "danger", fn: async () => {
        try { const j = await api("/api/demolish", { x, y }); selB = null; loadState(j.state); toast("Building demolished.", "good"); }
        catch (e) { err(e); } } },
      { label: "Keep it", hot: "k", fn: () => {} },
    ]);
  }
  async function doBatteryFire(x, y, target) {
    try { const j = await api("/api/battery_fire", { x, y, target }); loadState(j.state); await showEvents(j.events); beep("hit"); updateInfo(); }
    catch (e) { err(e); }
  }
  async function doRepairBld(x, y) {
    try { const j = await api("/api/repair_bld", { x, y }); loadState(j.state); beep("heal"); selB = buildingAt(x, y); updateInfo(); }
    catch (e) { err(e); }
  }
  async function doConstruct(id, kind, x, y) {
    sel = null;
    try { const j = await api("/api/construct", { unit: id, kind, x, y }); loadState(j.state); beep("select"); }
    catch (e) { err(e); }
  }
  async function showEvents(events) {
    for (const e of events || []) {
      if (e.t === "combat") {
        pop(e.d.x, e.d.y, e.dk ? "DESTROYED" : "-" + e.dmg, e.dk ? "#ff6b6b" : "#ffb454");
        if (e.counter && e.a) pop(e.a.x, e.a.y, "↩-" + e.counter, "#ffb454");
        beep(e.dk ? "kill" : "hit"); await sleep(260);
      } else if (e.t === "capture") { pop(e.x, e.y, "CAPTURED", "#4dff9d"); beep("capture"); }
      else if (e.t === "ambush") { pop(e.x, e.y, "AMBUSH!", "#ff6b6b"); beep("contact"); }
      else if (e.t === "capprog") { pop(e.x, e.y, `CAP ${e.pts}/${e.need}`, e.side === "P" ? "#4dff9d" : "#ff6b6b"); beep("capture"); }
      else if (e.t === "bldhit") { pop(e.x, e.y, e.dk ? "DESTROYED" : "-" + e.dmg, e.dk ? "#ff6b6b" : "#ffb454"); beep(e.dk ? "kill" : "hit"); }
      else if (e.t === "blocked") { pop(e.x, e.y, "ROUTE BLOCKED", "#ff6b6b"); beep("contact"); }
    }
  }

  // ------------------------------------------------------- multiplayer watch: no manual refresh needed
  let oppPoll = null;
  function watchOpponent() {
    const inPvp = state && !state.over && state.level === "pvp";
    if (inPvp && !oppPoll) oppPoll = setInterval(pollTick, 3000);
    else if (!inPvp && oppPoll) { clearInterval(oppPoll); oppPoll = null; }
  }
  async function pollTick() {
    if (busy || !state || state.over) return;
    pollChat();
    if (state.your_turn === false) pollOpponent();
  }
  async function pollOpponent() {
    try {
      const j = await api("/api/state");
      const wasWaiting = state.your_turn === false;
      loadState(j.state);
      if (wasWaiting && j.state.your_turn && !j.state.over) {
        toast(`Your move — ${j.state.opponent || "your opponent"} has ended their turn.`, "good");
        beep("turn");
      }
    } catch (e) { /* server hiccup — retry on next tick */ }
  }

  // ------------------------------------------------------- battle comms (in-memory PvP chat)
  let chatCount = 0;
  function renderChat() {
    const log = $("chat-log");
    if (!state || state.level !== "pvp") {
      log.innerHTML = `<div class="empty">Comms are available in multiplayer battles.</div>`;
      return;
    }
    api("/api/chat").then(j => {
      chatCount = j.n;
      if (!j.msgs.length) {
        log.innerHTML = `<div class="empty">No messages yet — say hello, commander.</div>`;
        return;
      }
      let html = "";
      for (const m of j.msgs) {
        html += `<div class="chat-row${m.s === "P" ? " mine" : ""}"><b>${esc(m.u)}</b> ` +
                `<span class="muted">${m.t}</span><br>${esc(m.x)}</div>`;
      }
      log.innerHTML = html;
      log.scrollTop = log.scrollHeight;
    }).catch(() => {});
  }
  async function pollChat() {
    if (!state || state.over || state.level !== "pvp") return;
    try {
      const j = await api("/api/chat?after=" + chatCount);
      if (!j.msgs.length) return;
      const had = chatCount > 0;
      chatCount = j.n;
      renderChat();
      const last = j.msgs[j.msgs.length - 1];
      if (had && last.s !== "P") {
        toast(`New message from ${last.u}.`, "good");
        beep("msg");
      }
    } catch (e) { /* ignore */ }
  }
  async function sendChat() {
    const inp = $("chat-in"), txt = inp.value.trim();
    if (!txt) return;
    inp.value = "";
    try { await api("/api/chat", { text: txt }); renderChat(); }
    catch (e) { toast(e.message, "bad"); }
  }

  // ---------------------------------------------------------------- end turn & AI replay
  function idleUnits() { return myUnits().filter(u => !u.acted && !(u.moved && !(U(u.type) || UDEF).move_fire)).length; }
  function requestEndTurn() {
    if (busy || !state || state.over || state.your_turn === false) return;
    const idle = idleUnits();
    if (settings.confirmEnd && idle > 0) {
      confirmDialog(`End turn ${state.turn}?`, `${idle} unit${idle > 1 ? "s have" : " has"} not acted yet.`, [
        { label: "End turn", hot: "y", cls: "primary", fn: endTurn },
        { label: "Keep playing", hot: "n", fn: () => {} }]);
    } else endTurn();
  }
  async function endTurn() {
    if (busy || !state || state.over || state.your_turn === false) return;
    busy = true; sel = null; selB = null; updateTop(); updateInfo(); beep("turn");
    try {
      const j = await api("/api/end_turn", { autosave: settings.autosave });
      state = j.state; visible = new Set(state.visible); seen = new Set(state.seen); renderLog();
      for (const e of j.events || []) await replayEvent(e);
      await sleep(250); anim = null; busy = false;
      loadState(j.final);
    } catch (e) { busy = false; err(e); updateTop(); }
  }
  function pushLog(e) { if (e.log) { for (const l of e.log) state.log.push(l); renderLog(); } }
  async function replayEvent(e) {
    pushLog(e);
    if (e.t === "move") {
      let u = findUnit(e.u.id);
      if (!u) { u = Object.assign({ mhp: (U(e.u.type) || UDEF).hp, moved: true, acted: true }, e.u); u.x = e.from[0]; u.y = e.from[1]; state.units.push(u); }
      anim = { id: u.id, fx: e.from[0], fy: e.from[1], tx: e.to[0], ty: e.to[1], start: performance.now(), dur: speed(380) || 1 };
      await sleep(400); u.x = e.to[0]; u.y = e.to[1]; anim = null;
      if (!e.to_vis) state.units = state.units.filter(x => x.id !== u.id);
      else if (!e.from_vis) { pop(e.to[0], e.to[1], "CONTACT", "#ff6b6b"); beep("contact"); }
    } else if (e.t === "combat") {
      const d = findUnit(e.d.id), a = e.a && findUnit(e.a.id);
      if (d) d.hp = e.d_hp1; if (a) a.hp = e.a_hp1;
      pop(e.d.x, e.d.y, e.dk ? "DESTROYED" : "-" + e.dmg, e.dk ? "#ff6b6b" : "#ffb454");
      if (e.counter && e.a) pop(e.a.x, e.a.y, "↩-" + e.counter, "#ffb454");
      beep(e.dk ? "kill" : "hit"); await sleep(520);
      if (e.dk) state.units = state.units.filter(x => x.id !== e.d.id);
      if (e.ak && e.a) state.units = state.units.filter(x => x.id !== e.a.id);
    } else if (e.t === "capture") {
      const b = buildingAt(e.x, e.y); if (b) { b.side = e.side; b.visible = true; }
      pop(e.x, e.y, "CAPTURED", e.side === "P" ? "#4dff9d" : "#ff6b6b"); beep("capture"); await sleep(420);
    } else if (e.t === "ambush") { pop(e.x, e.y, "AMBUSH!", "#4dff9d"); beep("contact"); await sleep(350); }
    else if (e.t === "heal") { const u = findUnit(e.id); if (u) u.hp = e.hp; pop(e.x, e.y, "+" + e.amt, "#4dff9d"); beep("heal"); await sleep(160); }
  }

  // ---------------------------------------------------------------- modals
  const modalStack = [];
  function openModal(id) {
    const m = $(id); m.classList.remove("hidden"); modalStack.push(id);
    const f = m.querySelector("[data-first]") || m.querySelector("button, input, select");
    if (f) setTimeout(() => f.focus(), 0);
  }
  function closeModal(id) {
    id = id || modalStack[modalStack.length - 1]; if (!id) return;
    $(id).classList.add("hidden"); const i = modalStack.lastIndexOf(id); if (i >= 0) modalStack.splice(i, 1);
    if (!modalStack.length) canvas.focus({ preventScroll: true });
  }
  function confirmDialog(title, text, buttons) {
    $("confirm-title").textContent = title; $("confirm-text").textContent = text;
    const box = $("confirm-actions"); box.innerHTML = "";
    buttons.forEach((b, i) => {
      const el = document.createElement("button");
      el.className = "btn-ig " + (b.cls || ""); el.dataset.hot = b.hot || ""; if (i === 0) el.dataset.first = "1";
      el.innerHTML = `${b.label}${b.hot ? ` <kbd>${b.hot.toUpperCase()}</kbd>` : ""}`;
      el.addEventListener("click", () => { closeModal("modal-confirm"); b.fn && b.fn(); });
      box.appendChild(el);
    });
    openModal("modal-confirm");
  }

  // new operation
  function orderedLevels() {
    const source = META && META.levels ? META.levels : {};
    const order = Array.isArray(META && META.ai_order) ? META.ai_order : Object.keys(source);
    const ordered = [];
    for (const lvl of order) {
      if (Object.prototype.hasOwnProperty.call(source, lvl)) ordered.push([lvl, source[lvl]]);
    }
    for (const [lvl, desc] of Object.entries(source)) {
      if (!order.includes(lvl)) ordered.push([lvl, desc]);
    }
    return ordered;
  }

  function requestNew() {
    if (!state) return;
    if (state.over) { location.href = "/lobby"; return; }
    confirmDialog("Abandon this operation?", `Turn ${state.turn} is in progress. Unsaved progress will be lost.`, [
      { label: "Save first", hot: "s", cls: "good", fn: () => openSaves() },
      { label: "Abandon & go to lobby", hot: "l", cls: "danger", fn: abandonOperation },
      { label: "Cancel", hot: "c", fn: () => {} }]);
  }
  async function abandonOperation() {
    try {
      await api(`/api/game/${state.id}/abandon`, {});
      location.href = "/lobby";
    } catch (e) { err(e); }
  }
  function tierUnits() {
    const t = state && META.tiers && META.tiers[state.tier] ? state.tier : 2;
    return (META.tiers && META.tiers[t]) ? META.tiers[t].units : META.order;
  }

  function openLevelModal() {
    const box = $("level-list"); box.innerHTML = "";
    const ts = document.createElement("select");
    ts.className = "form-select"; ts.id = "tier-pick"; ts.style.marginBottom = "10px";
    ts.innerHTML = Object.entries(META.tiers).map(([t, v]) =>
      `<option value="${t}">Tier ${t} — ${v.name} (${v.units.length} units)</option>`).join("");
    box.appendChild(ts);
    const ds = document.createElement("select");
    ds.className = "form-select"; ds.id = "doc-pick"; ds.style.marginBottom = "10px";
    ds.innerHTML = (META.doctrine_order || []).map(k =>
      `<option value="${k}">${META.doctrines[k]}</option>`).join("");
    box.appendChild(ds);
    const syncDocRow = () => { ds.style.display = +ts.value >= 4 ? "" : "none"; };
    ts.addEventListener("change", syncDocRow);
    syncDocRow();
    const ms = document.createElement("select");
    ms.className = "form-select"; ms.id = "map-pick"; ms.style.marginBottom = "10px";
    ms.innerHTML = `<option value="-1">🎲 Random battlefield</option>` +
      META.maps.map((m, i) => `<option value="${i}">Map ${i + 1} — ${m.name} (${m.w || 14}×${m.h || 10})</option>`).join("");
    box.appendChild(ms);
    orderedLevels().forEach(([lvl, desc], i) => {
      const b = document.createElement("button");
      b.className = "btn-ig" + (lvl === settings.level ? " primary" : ""); b.dataset.hot = String(i + 1);
      if (lvl === settings.level) b.dataset.first = "1";
      b.style.textAlign = "left";
      b.innerHTML = `<b>${i + 1}. ${lvl[0].toUpperCase() + lvl.slice(1)}</b><br><small>${desc}</small>`;
      b.addEventListener("click", () => { closeModal("modal-new"); newGame(lvl); });
      box.appendChild(b);
    });
    openModal("modal-new");
  }
  async function newGame(level) {
    busy = false; sel = null; selB = null; floats = []; anim = null;
    try {
      const mp = $("map-pick"), tp = $("tier-pick"), dp = $("doc-pick");
      const j = await api("/api/new", { level, map: mp ? +mp.value : 0, tier: tp ? +tp.value : 2,
                                        doctrine: dp ? dp.value : "territ" });
      settings.level = level; saveSettings();
      loadState(j.state);
      const first = myUnits().find(u => !u.acted);
      if (first) cursor = { x: first.x, y: first.y };
      canvas.focus({ preventScroll: true });
    } catch (e) { err(e); }
  }

  // settings
  const SCHEMA = [
    { k: "keyboard", t: "bool", l: "Keyboard control", d: "Play with the keyboard only: cursor, hotkeys, build menu." },
    { k: "theme", t: "sel", l: "Theme", d: "Dark, light, or follow your system.", o: [["dark", "Dark"], ["light", "Light"], ["auto", "System"]] },
    { k: "level", t: "sel", l: "Default AI level", d: "Used for the next new operation.", o: "levels" },
    { k: "animspeed", t: "range", l: "Animation speed", d: "0 = instant, 100 = fastest.", min: 0, max: 100 },
    { k: "volume", t: "range", l: "Master volume", d: "Overall loudness of all sounds.", min: 0, max: 100 },
    { k: "zoombar", t: "bool", l: "Zoom controls", d: "Show the zoom / fit / reset bar above the battlefield." },
    { k: "readycounter", t: "bool", l: "Ready-unit counter", d: "Persistent 'Ready x / Used y' count in the top bar." },
    { k: "hoverfx", t: "bool", l: "Hover combat forecast", d: "Show damage preview when hovering a target." },
    { k: "autosave", t: "bool", l: "Autosave each turn", d: "Keeps one rolling autosave in the database." },
    { k: "confirmEnd", t: "bool", l: "Confirm end turn", d: "Ask first if some units haven't acted." },
    { k: "cvd", t: "bool", l: "Colorblind palette", d: "Blue vs orange instead of blue vs red." },
    { k: "bigtext", t: "bool", l: "Larger text", d: "Scales the whole interface." },
    { k: "sound", t: "bool", l: "Sound effects", d: "Small synthesized beeps." },
  ];
  function openSettings() {
    const box = $("settings-body"); box.innerHTML = "";
    for (const s of SCHEMA) {
      const row = document.createElement("div"); row.className = "setrow";
      row.innerHTML = `<div class="lbl"><b>${s.l}</b><span>${s.d}</span></div>`;
      let ctl;
      if (s.t === "bool") {
        ctl = document.createElement("div"); ctl.className = "form-check form-switch";
        ctl.innerHTML = `<input class="form-check-input" type="checkbox" role="switch" ${settings[s.k] ? "checked" : ""}>`;
        ctl.firstChild.addEventListener("change", e => { settings[s.k] = e.target.checked; saveSettings(); applySettings(); });
      } else if (s.t === "range") {
        ctl = document.createElement("div"); ctl.style.cssText = "display:flex;align-items:center;gap:10px;min-width:220px";
        const rng = document.createElement("input");
        rng.type = "range"; rng.min = s.min; rng.max = s.max; rng.value = settings[s.k];
        rng.className = "form-range";
        const lbl = document.createElement("b"); lbl.style.minWidth = "2.4em"; lbl.style.textAlign = "right";
        lbl.textContent = settings[s.k];
        rng.addEventListener("input", () => {
          settings[s.k] = +rng.value; lbl.textContent = rng.value; saveSettings(); applySettings();
        });
        ctl.append(rng, lbl);
      } else {
        ctl = document.createElement("select"); ctl.className = "form-select form-select-sm";
        const opts = s.o === "levels" ? orderedLevels().map(([k, _]) => [k, k[0].toUpperCase() + k.slice(1)]) : s.o;
        ctl.innerHTML = opts.map(([v, n]) => `<option value="${v}" ${settings[s.k] === v ? "selected" : ""}>${n}</option>`).join("");
        ctl.addEventListener("change", e => { settings[s.k] = e.target.value; saveSettings(); applySettings(); });
      }
      row.appendChild(ctl); box.appendChild(row);
    }
    const head = document.createElement("div");
    head.className = "setrow";
    head.innerHTML = `<div class="lbl"><b>Sound channels</b><span>Master switch is "Sound effects" above — fine-tune each sound here.</span></div><span></span>`;
    box.appendChild(head);
    for (const [k, label] of Object.entries(SND_CHANNELS)) {
      const row = document.createElement("div"); row.className = "setrow";
      row.innerHTML = `<div class="lbl"><span>${label}</span></div>`;
      const ctl = document.createElement("div"); ctl.style.cssText = "display:flex;align-items:center;gap:10px";
      const sw = document.createElement("div"); sw.className = "form-check form-switch";
      sw.innerHTML = `<input class="form-check-input" type="checkbox" role="switch" ${settings.snd[k] ? "checked" : ""}>`;
      sw.firstChild.addEventListener("change", e => { settings.snd[k] = e.target.checked; saveSettings(); });
      const vol = document.createElement("input");
      vol.type = "range"; vol.min = 0; vol.max = 100; vol.value = Math.round((settings.sndvol[k] ?? 1) * 100);
      vol.className = "form-range"; vol.style.width = "140px";
      vol.title = "Loudness";
      vol.addEventListener("input", () => { settings.sndvol[k] = +vol.value / 100; saveSettings(); });
      ctl.append(sw, vol); row.appendChild(ctl); box.appendChild(row);
    }
    openModal("modal-settings");
  }

  // saves
  async function openSaves() { openModal("modal-saves"); await refreshSaves(); }
  async function refreshSaves() {
    const box = $("save-list");
    try {
      const j = await api("/api/saves");
      if (!j.saves.length) { box.innerHTML = `<div class="muted">No saves yet.</div>`; return; }
      box.innerHTML = "";
      for (const s of j.saves) {
        const d = document.createElement("div"); d.className = "save-item";
        d.innerHTML = `<div><div class="nm"></div><div class="meta">${s.kind === "auto" ? "AUTOSAVE · " : ""}Turn ${s.turn} · ${s.level} · ${s.credits} cr · ${s.units} units · ${s.created}</div></div><div class="row-gap" style="margin:0"></div>`;
        d.querySelector(".nm").textContent = s.name;
        const load = document.createElement("button"); load.className = "btn-ig sm primary"; load.textContent = "Load";
        load.addEventListener("click", () => requestLoad(s));
        const del = document.createElement("button"); del.className = "btn-ig sm danger"; del.textContent = "Delete";
        del.addEventListener("click", async () => { try { await api("/api/saves/" + s.id, undefined, "DELETE"); refreshSaves(); } catch (e) { err(e); } });
        d.lastChild.append(load, del); box.appendChild(d);
      }
    } catch (e) { box.textContent = e.message; }
  }
  function requestLoad(s) {
    const go = async () => {
      try {
        const j = await api(`/api/saves/${s.id}/load`, {});
        busy = false; sel = null; selB = null; floats = []; anim = null;
        loadState(j.state); closeModal("modal-saves");
      } catch (e) { err(e); }
    };
    if (state && !state.over) confirmDialog("Load this save?", "The current game will be replaced.", [
      { label: "Load", hot: "y", cls: "primary", fn: go }, { label: "Cancel", hot: "n", fn: () => {} }]);
    else go();
  }
  $("save-btn").addEventListener("click", async () => {
    try { await api("/api/saves", { name: $("save-name").value }); $("save-name").value = ""; await refreshSaves(); toast("Game saved.", "good"); }
    catch (e) { err(e); }
  });

  // help
  function openHelp() {
    const G = (t) => `<div class="grp">${t}</div>`, R = (k, d) => `<div><span>${d}</span><kbd>${k}</kbd></div>`;
    $("help-body").innerHTML = G("Cursor & selection") + R("← ↑ ↓ →", "Move cursor") + R("Enter / Space", "Select · move · attack · wait") +
      R("Esc", "Cancel selection / close") + R("Tab / Shift+Tab", "Next / previous ready unit") + R("T", "Cycle attack targets") + R("H", "Jump to your HQ") +
      G("Unit commands") + R("W", "Wait (end unit's turn)") + R("F", "Found factory") +
      G("Buildings") + R("1 – 8", "Build unit (building selected)") + R("U", "Upgrade building") +
      G("Game") + R("E", "End turn") + R("S", "Save / load") + R("N", "New operation") + R("O", "Settings") + R("?", "This help") +
      G("Panels") + R("I / L / M / R", "Intel / Logbook / Manual / Records") + R("P", "Save board image");
    openModal("modal-help");
  }

  // ---------------------------------------------------------------- end screen / hall of fame
  function showEnd(s) {
    const win = s.result.winner === "P";
    $("end-title").textContent = win ? "VICTORY" : "DEFEAT";
    $("end-title").className = win ? "" : "defeat";
    $("end-reason").textContent = s.result.reason + (win ? ` on turn ${s.turn}.` : ".");
    $("end-note").textContent = s.rank_note || "";
    $("end-overlay").classList.remove("hidden");
  }
  async function refreshHof() { try { renderHof((await api("/api/records")).records); } catch (e) {} }
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function renderHof(recs) {
    if (!recs.length) { $("hof").innerHTML = `<tr><td class="muted">No verified victories yet.</td></tr>`; return; }
    let lastLvl = null, place = 0;
    const rows = recs.map(r => {
      if (r.level !== lastLvl) { lastLvl = r.level; place = 0; }
      place += 1;
      return `<tr><td>${place}</td><td>${esc(r.level)}</td><td>${esc(r.name)}</td><td>${esc(r.rank_title || "")}</td>` +
        `<td class="n">${r.turns}</td><td class="n">${r.kills}</td><td class="n">${r.units_left}</td><td>${esc(r.date)}</td></tr>`;
    }).join("");
    $("hof").innerHTML = `<tr><th>#</th><th>AI</th><th>Commander</th><th>Rank</th><th class="n">Turns</th><th class="n">Kills</th><th class="n">Left</th><th>Date</th></tr>` + rows;
  }

  // ---------------------------------------------------------------- export board
  function exportBoard() {
    const c = document.createElement("canvas"), cw = LAB + W * TILE, ch = LAB + H * TILE, bh = 30;
    c.width = cw; c.height = ch + bh; const t = c.getContext("2d"), P = pal();
    t.fillStyle = P.bg; t.fillRect(0, 0, c.width, c.height);
    t.fillStyle = P.text; t.font = "bold 14px system-ui"; t.textBaseline = "middle"; t.textAlign = "left";
    t.fillText(`IRON GRID — turn ${state.turn} — ${state.level === "pvp" ? "PvP" : "AI: " + state.level} — ${myUnits().length} units — ${state.credits} cr`, 8, bh / 2);
    t.translate(0, bh); drawScene(t, false);
    c.toBlob(b => { const a = document.createElement("a"); a.href = URL.createObjectURL(b);
      a.download = `irongrid-turn-${state.turn}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); });
    toast("Board image saved.", "good");
  }

  // ------------------------------------------------------- unit database panel
  let udbCat = null, udbSel = null;
  function udbCats() {
    const out = [];
    for (const c of META.cats) {
      let list = tierUnits().filter(k => U(k).cat === c);
      if (c === "Fire Support")
        list = list.concat(tierUnits().filter(k => U(k).cat === "Infantry Support"));
      if (c === "Infantry Support") continue;      // merged into Support
      if (list.length) out.push([c === "Fire Support" ? "Support" : c, list]);
    }
    return out;
  }
  function renderUdb() {
    const tabs = $("udb-tabs"), list = $("udb-list"), dos = $("udb-dossier");
    if (!tabs || !META) return;
    const cats = udbCats();
    if (!udbCat || !cats.some(([c]) => c === udbCat)) udbCat = cats[0] && cats[0][0];
    tabs.innerHTML = "";
    for (const [c] of cats) {
      const b = document.createElement("button");
      b.className = "chip" + (c === udbCat ? " on" : "");
      b.textContent = c;
      b.addEventListener("click", () => { udbCat = c; udbSel = null; renderUdb(); });
      tabs.appendChild(b);
    }
    const cur = cats.find(([c]) => c === udbCat);
    list.innerHTML = "";
    for (const k of cur[1]) {
      const t = U(k);
      const b = document.createElement("button");
      b.className = "wcard" + (k === udbSel ? " sel" : "");
      b.innerHTML = `<b>${t.code}</b><br><small>${t.name}</small>`;
      b.title = t.full;
      b.addEventListener("click", () => { udbSel = k; renderUdb(); });
      list.appendChild(b);
    }
    dos.innerHTML = udbSel ? dossier(udbSel) : `<span class="muted">Pick a ${udbCat} unit.</span>`;
  }
  function dossier(k) {
    const t = U(k), tu = tierUnits();
    const mx = { hp: 0, move: 0, cost: 0, vis: 0 };
    tu.forEach(q => { const u = U(q); mx.hp = Math.max(mx.hp, u.hp); mx.move = Math.max(mx.move, u.move);
                      mx.cost = Math.max(mx.cost, u.cost); mx.vis = Math.max(mx.vis, u.vis); });
    const row = (label, v, m) => `<div class="dossier-bar"><span>${label}</span>` +
      `<span class="dbar"><i style="width:${Math.round(100 * v / (m || 1))}%"></i></span><b>${v}</b></div>`;
    const atk = [["soft", "Soft"], ["armor", "Armor"], ["hard", "Hard"], ["rot", "Rotary"], ["fix", "Fixed"], ["sea", "Sea"], ["bld", "Bld"]]
      .map(([c, n]) => `<div class="atkbox"><span>${n}</span><b>${t.atk[c] || "—"}</b></div>`).join("");
    const strong = Object.entries(t.atk).filter(([, v]) => v >= 7).map(([c]) => c);
    const weak = Object.entries(t.atk).filter(([, v]) => v > 0 && v <= 2).map(([c]) => c);
    const chips = (strong.length ? `<span class="chip on">▲ strong: ${strong.join(", ")}</span> ` : "") +
                  (weak.length ? `<span class="chip">▽ weak: ${weak.join(", ")}</span>` : "");
    const built = (t.sites || []).join(" / ") + ((t.tech || 1) > 1 ? ` — needs level ${t.tech}` : "");
    const turns = (META.build_times && META.build_times[k]) || 1;
    return `<div><span class="title">${t.code} — ${t.full}</span> ${clsPill(t.cls)}
      <span class="tag-p" style="text-transform:capitalize">${(META.target_class && META.target_class[k]) || "-"}</span></div>
      <div class="sub" style="margin:4px 0 8px">${t.cat} · ${t.desc}</div>
      ${row("HP", t.hp, mx.hp)}${row("Move", t.move, mx.move)}${row("Cost", t.cost, mx.cost)}${row("Vision", t.vis, mx.vis)}
      <div class="dossier-bar"><span>Range</span><b style="flex:1;text-align:left">${t.rng[0] === t.rng[1] ? t.rng[0] : t.rng.join("–")}</b></div>
      <div class="atkrow">${atk}</div>
      <div style="margin:6px 0">${chips}</div>
      <div class="sub">⚙ Built at <b>${built}</b> · build time <b>${turns} turn(s)</b>
      ${t.indirect ? " · indirect fire (never counters)" : ""}${t.capture ? " · can capture" : ""}</div>`;
  }

  // ---------------------------------------------------------------- tabs
  function showTab(name) {
    document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
    document.querySelectorAll(".tabpane").forEach(p => p.classList.toggle("hidden", p.id !== "tab-" + name));
    if (name === "records") refreshHof();
    if (name === "chat") renderChat();
    if (name === "units") renderUdb();
  }
  document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => showTab(b.dataset.tab)));

  // ---------------------------------------------------------------- input: mouse
  function tileFromEvent(e) {
    const r = canvas.getBoundingClientRect();
    const sx = canvas.width / r.width, sy = canvas.height / r.height;
    const x = Math.floor(((e.clientX - r.left) * sx - LAB) / TILE), y = Math.floor(((e.clientY - r.top) * sy - LAB) / TILE);
    return (x >= 0 && y >= 0 && x < W && y < H) ? { x, y } : null;
  }
  const unitsAt = (x, y) => UNIT_TILE.get(x + "," + y) || []
    .sort((a, b) => (b.side === "P") - (a.side === "P"));   // yours first
  let lastPick = null;
  async function activate(x, y, fromKeys) {
    if (busy || !state || state.over) return;
    const myTurn = state.your_turn !== false;      // on the opponent's turn: inspect only
    cursor = { x, y };
    const stack = unitsAt(x, y);
    const bHere = buildingAt(x, y);
    const bHere0 = bHere;
    let u = stack[0] || null, pickB = false;
    if (lastPick && lastPick.x === x && lastPick.y === y) {
      const i = stack.findIndex(q => q.id === lastPick.id);   // click again: next occupant
      if (lastPick.kind === "bld") { /* start over at first unit */ }
      else if (i >= 0 && i + 1 < stack.length) u = stack[i + 1];
      else if (bHere) { u = null; pickB = true; }
    }
    lastPick = pickB ? { x, y, kind: "bld" }
                     : u ? { x, y, id: u.id, kind: "unit" } : null;
    if (pickB && bHere) {
      sel = null; selB = bHere; showBuildingInfo(bHere); beep("select");
      return;
    }
    const canMoveThere = sel && sel.moves.has(key(x, y));
    if (sel && myTurn && canMoveThere && (u || bHere0)) {   // real conflict: ask
      const opts = [{ label: "Move here", hot: "m", cls: "primary", fn: () => doMove(x, y) }];
      stack.forEach((q, i) => opts.push({
        label: `Select ${q.side === "P" ? "Our" : "Enemy"} ${(U(q.type) || UDEF).code}-${q.id}`,
        hot: String(i + 1),
        fn: () => { sel = null; selB = null; q.side === "P" ? selectUnit(q) : showUnitInfo(q, false); },
      }));
      for (const [tid, a] of sel.attacks) {
        const q = stack.find(x => x.id === tid);
        const b2 = bHere0 && bHere0.id === tid ? bHere0 : null;
        if (!q && !b2) continue;
        const tn = q ? `${q.side === "P" ? "Our" : "Enemy"} ${(U(q.type) || UDEF).code}-${q.id}` : `the ${b2.type}`;
        opts.splice(1, 0, { label: `⚔ Attack ${tn} (-${a.dmg})`, hot: "t", cls: "danger", fn: () => doAttack(tid) });
        break;
      }
      if (bHere0) opts.push({ label: `Open ${bHere0.type} <kbd>B</kbd>`, hot: "b", fn: () => {
        sel = null; selB = bHere0; showBuildingInfo(bHere0); beep("select"); } });
      opts.push({ label: "Cancel", hot: "esc", fn: () => {} });
      confirmDialog(`Move to ${label(x, y)} or select what's there?`, "M = move · 1-9 = select a unit · B = building · Esc = cancel", opts);
      return;
    }
    if (sel && myTurn && u && !canMoveThere) {   // not a move destination: inspect/select directly
      if (u.side === "A" && sel.attacks.has(u.id)) return doAttack(u.id);
      sel = null; selB = null;
      return u.side === "P" ? selectUnit(u) : showUnitInfo(u, false);
    }
    if (sel && myTurn) {
      const bb = buildingAt(x, y);
      if (bb && sel.attacks.has(bb.id)) return doAttack(bb.id);
      if (sel.moves.has(key(x, y))) return doMove(x, y);
      if (u && u.id === sel.unit.id && fromKeys && myTurn) return doWait(u.id);
    }
    if (u) {
      sel = null; selB = null;
      if (u.side === "P") return selectUnit(u);
      return showUnitInfo(u, false);
    }
    sel = null; selB = null;
    const b = buildingAt(x, y);
    if (b) { selB = b; showBuildingInfo(b); beep("select"); } else showTerrainInfo(x, y);
  }
  canvas.addEventListener("contextmenu", e => { e.preventDefault(); cancelSel(); lastPick = null; });
  canvas.addEventListener("click", e => {
    if (panned) { panned = false; return; }
    canvas.focus({ preventScroll: true });
    const t = tileFromEvent(e); if (t) activate(t.x, t.y, false);
  });
  canvas.addEventListener("mousemove", e => { const h = tileFromEvent(e); if ((h && h.x) !== (hover && hover.x) || (h && h.y) !== (hover && hover.y)) markDirty(); hover = h; updateStatusline(); });
  canvas.addEventListener("mouseleave", () => { hover = null; });

  // ---------------------------------------------------------------- input: keyboard
  function readyUnits() { return myUnits().filter(u => !u.acted && !(u.moved && !(U(u.type) || UDEF).move_fire)).sort((a, b) => a.id - b.id); }
  function cycleReady(dir) {
    const list = readyUnits(); if (!list.length) { toast("No units left to act.", "bad"); return; }
    const cur = sel ? sel.unit.id : (unitAt(cursor.x, cursor.y) || {}).id;
    let i = list.findIndex(u => u.id === cur);
    i = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
    cursor = { x: list[i].x, y: list[i].y }; selectUnit(list[i]); updateStatusline();
  }
  function cycleTarget() {
    if (!sel || !sel.attacks.size) { toast("No targets in range.", "bad"); return; }
    const ids = [...sel.attacks.keys()], here = (unitAt(cursor.x, cursor.y) || {}).id;
    const i = ids.indexOf(here), u = findUnit(ids[(i + 1) % ids.length]);
    if (u) { cursor = { x: u.x, y: u.y }; updateStatusline(); showUnitInfo(u, false); }
  }
  function modalKey(e) {
    const top = modalStack[modalStack.length - 1], m = $(top);
    if (e.key === "Escape") { e.preventDefault(); closeModal(top); return; }
    const hot = m.querySelector(`[data-hot="${e.key.toLowerCase()}"]`);
    if (hot && e.target.tagName !== "INPUT") { e.preventDefault(); hot.click(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const f = [...m.querySelectorAll("button:not(:disabled), input, select")];
      const i = f.indexOf(document.activeElement); e.preventDefault();
      f[(i + (e.key === "ArrowDown" ? 1 : -1) + f.length) % f.length].focus();
    }
  }
  document.addEventListener("keydown", e => {
    if (e.ctrlKey || e.metaKey || e.altKey || !state) return;
    const tag = (e.target.tagName || "").toLowerCase();
    if (modalStack.length) { modalKey(e); return; }
    if (tag === "input" || tag === "textarea" || tag === "select") { if (e.key === "Escape") e.target.blur(); return; }
    if (!settings.keyboard) { if (e.key === "Escape") cancelSel(); return; }
    const k = e.key, lk = k.length === 1 ? k.toLowerCase() : k;
    const move = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
    if (move) { e.preventDefault(); cursor = { x: Math.min(W - 1, Math.max(0, cursor.x + move[0])), y: Math.min(H - 1, Math.max(0, cursor.y + move[1])) }; updateStatusline(); beep("select"); return; }
    if (k === "+" || k === "=") { zoomBy(1.25); return; }
    if (k === "-") { zoomBy(0.8); return; }
    if (k === "Enter" || k === " ") { if (tag === "button") return; e.preventDefault(); activate(cursor.x, cursor.y, true); return; }
    if (k === "Escape") { cancelSel(); return; }
    if (k === "Tab") { e.preventDefault(); cycleReady(e.shiftKey ? -1 : 1); return; }
    if (busy) return;
    const bu = tierUnits();
    if (lk >= "1" && lk <= "8" && selB && selB.side === "P" && ["HQ", "factory"].includes(selB.type)) {
      const k = bu[+lk - 1];
      if (k) doBuild(selB.x, selB.y, k);
      return;
    }
    switch (lk) {
      case "t": cycleTarget(); break;
      case "w": if (sel) doWait(sel.unit.id); break;
      case "f": if (sel) doFound(sel.unit.id); break;
      case "u": { const b = selB || buildingAt(cursor.x, cursor.y); if (b && b.side === "P") doUpgrade(b.x, b.y); break; }
      case "d": showTab("units"); break;
      case "h": { const hq = state.buildings.find(b => b.type === "HQ" && b.side === "P"); if (hq) { cursor = { x: hq.x, y: hq.y }; updateStatusline(); } break; }
      case "e": requestEndTurn(); break;
      case "s": openSaves(); break;
      case "n": requestNew(); break;
      case "o": openSettings(); break;
      case "?": openHelp(); break;
      case "i": showTab("intel"); break;
      case "l": showTab("log"); break;
      case "m": showTab("manual"); break;
      case "r": showTab("records"); break;
      case "c": showTab("chat"); break;
      case "p": exportBoard(); break;
    }
  });

  // ---------------------------------------------------------------- wiring
  const wire = (id, fn) => {
    const el = $(id);
    if (el) el.addEventListener("click", fn);
  };

  wire("end-turn", requestEndTurn);
  wire("btn-new", requestNew);
  wire("rematch", () => { location.href = "/lobby"; });
  wire("lobby-return", () => { location.href = "/lobby"; });
  wire("btn-saves", openSaves);
  wire("btn-settings", openSettings);
  wire("btn-help", openHelp);
  wire("btn-export", exportBoard);
  wire("modal-new-cancel", () => closeModal("modal-new"));
  wire("settings-close", () => closeModal("modal-settings"));
  wire("saves-close", () => closeModal("modal-saves"));
  wire("help-close", () => closeModal("modal-help"));
  wire("chat-send", sendChat);
  $("chat-in").addEventListener("keydown", e => { if (e.key === "Enter") sendChat(); });
  wire("zoom-in", () => zoomBy(1.25));
  wire("zoom-out", () => zoomBy(0.8));
  wire("zoom-fit", zoomFit);
  wire("zoom-reset", zoomReset);

  (async function boot() {
    applySettings();
    try {
      META = await api("/api/meta");
      if (!META.levels[settings.level]) settings.level = "medium";   // old saved level name
      if (META.version) document.querySelector(".brand small").textContent = "V" + META.version;
      W = META.w; H = META.h; TERRAIN = META.maps ? META.maps[0].terrain : META.map;
      canvas.width = LAB + W * TILE; canvas.height = LAB + H * TILE;
      buildManual(); buildFilters(); refreshHof();
      loadState((await api("/api/state")).state);
      refreshCmdr();
      const first = myUnits().find(u => !u.acted);
      if (first) cursor = { x: first.x, y: first.y };
      canvas.focus({ preventScroll: true });
      updateStatusline();
    } catch (e) { $("statusline").textContent = "Could not reach the server: " + e.message; }
  })();
})();
