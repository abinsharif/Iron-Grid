/* IRON GRID V3 client. All rules live on the server; this file renders and sends intents. */
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
  const DEFAULTS = { theme: "dark", keyboard: true, cvd: false, bigtext: false, anim: "normal",
                     sound: false, autosave: true, confirmEnd: true, level: "normal" };
  let settings = Object.assign({}, DEFAULTS);
  try { Object.assign(settings, JSON.parse(localStorage.getItem(SKEY) || "{}")); } catch (e) {}
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
  const speed = ms => settings.anim === "off" ? 0 : settings.anim === "fast" ? ms * 0.45 : ms;
  const sleep = ms => (speed(ms) ? sleepRaw(speed(ms)) : Promise.resolve());

  // ---------------------------------------------------------------- audio (optional)
  let actx = null;
  const BEEP_VOLUME = 0.012;
  function beep(kind) {
    if (!settings.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const map = { select: [520, .05, "square"], move: [330, .07, "triangle"], hit: [160, .12, "sawtooth"],
                    kill: [90, .25, "sawtooth"], capture: [660, .18, "triangle"], turn: [440, .12, "sine"],
                    heal: [740, .1, "sine"], err: [120, .12, "square"] };
      const [f, d, type] = map[kind] || map.select;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.value = f; g.gain.value = BEEP_VOLUME;
      o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + d);
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

  async function api(path, body, method) {
    const opt = body !== undefined
      ? { method: method || "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : (method ? { method } : {});
    const r = await fetch(path, opt);
    const j = await r.json().catch(() => ({ ok: false, error: "bad response" }));
    if (!r.ok || j.ok === false) throw new Error(j.error || ("HTTP " + r.status));
    return j;
  }
  const U = t => META.units[t];
  const findUnit = id => state.units.find(u => u.id === id);
  const unitAt = (x, y) => state.units.find(u => u.x === x && u.y === y);
  const buildingAt = (x, y) => state.buildings.find(b => b.x === x && b.y === y);
  const myUnits = () => state.units.filter(u => u.side === "P");
  const uname = u => `${u.side === "P" ? "Our" : "Enemy"} ${U(u.type).code}-${u.id}`;
  const err = e => { toast(e.message, "bad"); beep("err"); };

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
                       "M": ["#aaa49b", "#b3ada4"], "W": ["#8ec3e6", "#86bce0"], "S": ["#a9b27f", "#a1aa77"] }
                   : { ".": ["#1b2331", "#1e2837"], "=": ["#2b2f3a", "#303542"], "F": ["#17301f", "#1a3a24"],
                       "M": ["#333a45", "#3a4250"], "W": ["#0f2f4a", "#123a5c"], "S": ["#262c17", "#2b321b"] },
      glyph: light ? { "=": "#6f685b", "M": "#6c675f", "W": "#2f6a99", "S": "#6a7340", "F": "#2f6a3a" }
                   : { "=": "#8892a8", "M": "#8f9bb5", "W": "#3f7ab5", "S": "#7d8a4a", "F": "#2c6b3c" },
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
      const GL = { "=": "═", "M": "▲", "W": "≋", "S": "⁞", "F": "♣" };
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const c = TERRAIN[y][x], [c1, c2] = P.tiles[c];
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
    const GL = { HQ: "★", factory: "⚙", city: "⌂" };
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
    for (const u of state.units) {
      const [gx, gy] = unitPos(u), x = LAB + gx * TILE, y = LAB + gy * TILE, t = U(u.type);
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
    if (!sel) return;
    for (const tile of [hover, settings.keyboard ? cursor : null]) {
      if (!tile) continue;
      const u = unitAt(tile.x, tile.y);
      const a = u && sel.attacks.get(u.id);
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
  (function loop() { if (state && TERRAIN.length) drawScene(screenCtx, true); requestAnimationFrame(loop); })();

  function pop(x, y, text, color) { floats.push({ x, y, text, color, born: performance.now() }); }

  // ---------------------------------------------------------------- HUD / top bar
  function updateTop() {
    $("turn").textContent = state.turn;
    $("credits").textContent = state.credits;
    $("income").textContent = "+" + state.income + "/turn";
    $("forces").textContent = myUnits().length;
    $("cap").textContent = state.unit_cap;
    $("lvl-badge").textContent = state.level;
    $("end-turn").disabled = busy || state.over;
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
    state = s; visible = new Set(s.visible); seen = new Set(s.seen);
    if (sel) { const u = findUnit(sel.unit.id); if (u) sel.unit = u; else sel = null; }
    updateTop(); updateInfo(); renderLog(); renderLedger();
    if (s.over) showEnd(s); else $("end-overlay").classList.add("hidden");
  }

  // ---------------------------------------------------------------- info panel
  function setInfo(html) { $("info-body").innerHTML = html; $("info-actions").innerHTML = ""; }
  function addBtn(html, fn, cls, disabled) {
    const b = document.createElement("button");
    b.className = "btn-ig sm " + (cls || ""); b.innerHTML = html; b.disabled = !!disabled;
    b.addEventListener("click", fn); $("info-actions").appendChild(b); return b;
  }
  const clsPill = c => `<span class="pill ${c}">${c.toUpperCase()}</span>`;
  function updateInfo() {
    if (!state) return;
    if (sel) showUnitInfo(sel.unit, true);
    else if (selB) showBuildingInfo(selB);
    else setInfo(`<span class="muted">Select a unit, building or tile. Click, or use the cursor and <kbd>Enter</kbd>.</span>`);
  }
  function showUnitInfo(u, selectable) {
    const t = U(u.type), mine = u.side === "P";
    const st = mine ? (u.acted ? "spent" : u.moved ? "moved — can still attack" : "ready") : "hostile";
    const road = (t.move / META.terrain["="][t.cls]).toFixed(t.cls === "air" ? 0 : 0);
    let html = `<div><span class="title">${t.full}</span> <span class="${mine ? "tag-p" : "tag-a"}">${uname(u)}</span> ${clsPill(t.cls)}</div>
      <div class="sub">${t.cat} · ${mine ? "status: " + st : "hostile contact"} · ${t.capture ? "can capture" : "cannot capture"}</div>
      <div class="statgrid">
        <div><span>HP</span><b>${u.hp}/${u.mhp}</b></div>
        <div><span>MOVE</span><b>${t.move}</b></div>
        <div><span>RANGE</span><b>${t.rng[0] === t.rng[1] ? t.rng[0] : t.rng.join("–")}</b></div>
        <div><span>VISION</span><b>${t.vis}</b></div>
        <div><span>ATK soft</span><b>${t.atk.soft}</b></div>
        <div><span>ATK armor</span><b>${t.atk.armor}</b></div>
        <div><span>ATK hard</span><b>${t.atk.hard}</b></div>
        <div><span>ATK air</span><b>${t.atk.air}</b></div>
        <div><span>COST</span><b>${t.cost}</b></div>
      </div>
      <div class="sub">${t.cls === "air" ? "Flies over all terrain." : `Move ${t.move} on plains · ${road} tiles along roads · ${t.cls === "foot" ? "can cross mountains" : "cannot cross mountains"}.`}
      ${t.indirect ? ` Indirect fire: ${t.move_fire ? "can move and fire; " : "cannot move and fire; "}never counters.` : ""}</div>
      <div class="sub" style="margin-top:6px">${t.desc}</div>`;
    if (!mine && sel) {
      const a = sel.attacks.get(u.id);
      if (a) html += `<div class="forecast">Your ${U(sel.unit.type).code} would deal <b>${a.dmg}</b> damage${a.kill ? " — <b>destroys it</b>" : ""}${a.counter ? `, taking <b>${a.counter}</b> back` : ", no counter"}.</div>`;
    }
    setInfo(html);
    if (mine && !busy && !state.over) {
      if (!u.acted) addBtn("Wait <kbd>W</kbd>", () => doWait(u.id), "");
      if (t.capture && !u.acted && !buildingAt(u.x, u.y) && [".", "="].includes(TERRAIN[u.y][u.x])) {
        addBtn(`Found factory ${META.found_cost} <kbd>F</kbd>`, () => doFound(u.id), "good", state.credits < META.found_cost);
      }
      if (selectable) addBtn("Cancel <kbd>Esc</kbd>", cancelSel, "");
    }
  }
  function showBuildingInfo(b) {
    const names = { HQ: "Headquarters", factory: "Factory", city: "City" };
    const lvl = b.level || 1, inc = Math.floor(META.income[b.type] * (1 + 0.5 * (lvl - 1)));
    const heal = META.heal[b.type] + (lvl - 1), mine = b.side === "P";
    const owner = b.side === "P" ? `<span class="tag-p">ours</span>` : b.side === "A" ? `<span class="tag-a">enemy</span>` : "neutral";
    setInfo(`<div><span class="title">${names[b.type]}</span> ${owner} · ${label(b.x, b.y)}${b.visible ? "" : " <span class='muted'>(last seen)</span>"}</div>
      <div class="statgrid">
        <div><span>INCOME</span><b>+${inc}</b></div><div><span>LEVEL</span><b>${lvl}/${META.max_level}</b></div>
        <div><span>REPAIR</span><b>+${heal}</b></div>
        <div><span>DEFENSE</span><b>${Math.round((1 - META.b_def[b.type]) * 100)}%</b></div>
      </div>
      <div class="sub">Units standing here at the start of their turn repair <b>${heal} HP</b> (costs ${Math.round(META.repair_rate * 100)}% of the HP's value in credits).
      ${b.type === "city" ? "Aircraft cannot repair in cities — use an HQ or factory." : ""}
      Infantry and IFVs capture it by ending a move on it.</div>`);
    if (mine && !busy && !state.over) {
      if (["HQ", "factory"].includes(b.type)) {
        const occupied = unitAt(b.x, b.y);
        const full = myUnits().length >= state.unit_cap;
        if (occupied) $("info-actions").innerHTML += `<span class="muted">Tile occupied — move the unit out to build.</span>`;
        else META.order.forEach((k, i) => addBtn(`<b>${i + 1}</b> ${U(k).code} · ${U(k).cost}`,
          () => doBuild(b.x, b.y, k), "", state.credits < U(k).cost || full));
      }
      if (lvl < META.max_level) {
        const c = META.upgrade_base * lvl;
        addBtn(`Upgrade ${c} <kbd>U</kbd>`, () => doUpgrade(b.x, b.y), "good", state.credits < c);
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
  function buildManual() {
    const rows = META.cats.map(cat => META.order.filter(k => U(k).cat === cat).map(k => {
      const t = U(k);
      return `<tr><td><b>${t.code}</b> ${t.full}</td><td>${clsPill(t.cls)}</td><td class="n">${t.hp}</td><td class="n">${t.cost}</td>
        <td class="n">${t.move}</td><td class="n">${t.rng[0] === t.rng[1] ? t.rng[0] : t.rng.join("–")}</td><td class="n">${t.vis}</td></tr>`;
    }).join("")).join("");
    const attackRows = META.order.map(k => {
      const t = U(k);
      return `<tr><td><b>${t.code}</b></td><td class="n">${t.atk.soft || "—"}</td><td class="n">${t.atk.armor || "—"}</td>
        <td class="n">${t.atk.hard || "—"}</td><td class="n">${t.atk.air || "—"}</td></tr>`;
    }).join("");
    const terr = Object.entries(META.terrain).map(([c, T]) =>
      `<tr><td><b>${T.name}</b></td><td class="n">${Math.round((1 - T.def) * 100)}%</td><td class="n">${T.foot > 90 ? "—" : T.foot}</td>
       <td class="n">${T.tread > 90 ? "—" : T.tread}</td><td class="n">${T.air}</td><td>${T.desc}</td></tr>`).join("");
    $("manual").innerHTML = `
      <h3>Units — four categories, two units each</h3>
      <p><b>FOOT</b> units walk (and can climb mountains). <b>TREAD</b> vehicles are faster on roads but can't enter mountains. <b>AIR</b> ignores terrain.
      ATK is base damage to a target class: <b>soft</b> (Infantry), <b>armor</b> (IFV, AFV, MBT), <b>hard</b> (MRL, SAM), or <b>air</b> (helicopters, fighters). Damage scales with attacker HP and is reduced by terrain.
      Every unit can damage a Fighter for at least 1. Fighter attacks use their full attack values.</p>
      <div class="scroll-x"><table class="tbl"><tr><th>Unit</th><th>Move type</th><th class="n">HP</th><th class="n">Cost</th><th class="n">Move</th><th class="n">Rng</th><th class="n">Vis</th></tr>${rows}</table></div>
      <h3>Attack values by target class</h3>
      <p>Base damage at full HP. All units deal at least 1 damage to Fighters.</p>
      <div class="scroll-x"><table class="tbl"><tr><th>Attacker</th><th class="n">Soft · INF</th><th class="n">Armor · IFV/AFV/MBT</th>
      <th class="n">Hard · MRL/SAM</th><th class="n">Air · HEL/FTR</th></tr>${attackRows}</table></div>
      <h3>Terrain</h3>
      <p>Numbers are movement points spent per tile. Roads cost only 0.5 for ground units.</p>
      <div class="scroll-x"><table class="tbl"><tr><th>Tile</th><th class="n">Def</th><th class="n">Foot</th><th class="n">Tread</th><th class="n">Air</th><th>Notes</th></tr>${terr}</table></div>
      <h3>Economy &amp; repair</h3>
      <p>Income per turn: HQ ${META.income.HQ}, factory ${META.income.factory}, city ${META.income.city} (+50% per building level). Founding a new factory costs <b>${META.found_cost}</b>; upgrades cost ${META.upgrade_base} × level.
      Units on a friendly city/factory/HQ repair at the start of your turn (+${META.heal.city}/+${META.heal.factory}/+${META.heal.HQ} HP, +1 per building level above 1) for credits. Aircraft can't repair in cities.
      Direct-fire defenders counter for ${Math.round(META.counter * 100)}% damage. Fog of war hides what your units and buildings can't see; moving into an unseen enemy triggers an ambush and halts you.</p>`;
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
      if (u && !u.acted && !state.over) await selectUnit(u);
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
  async function doBuild(x, y, type) { try { const j = await api("/api/build", { x, y, type }); loadState(j.state); beep("select"); selB = buildingAt(x, y); updateInfo(); } catch (e) { err(e); } }
  async function doUpgrade(x, y) { try { const j = await api("/api/upgrade", { x, y }); loadState(j.state); selB = buildingAt(x, y); updateInfo(); } catch (e) { err(e); } }
  async function doFound(id) { try { const j = await api("/api/found", { unit: id }); sel = null; loadState(j.state); } catch (e) { err(e); } }
  async function showEvents(events) {
    for (const e of events || []) {
      if (e.t === "combat") {
        pop(e.d.x, e.d.y, e.dk ? "DESTROYED" : "-" + e.dmg, e.dk ? "#ff6b6b" : "#ffb454");
        if (e.counter && e.a) pop(e.a.x, e.a.y, "↩-" + e.counter, "#ffb454");
        beep(e.dk ? "kill" : "hit"); await sleep(260);
      } else if (e.t === "capture") { pop(e.x, e.y, "CAPTURED", "#4dff9d"); beep("capture"); }
      else if (e.t === "ambush") pop(e.x, e.y, "AMBUSH!", "#ff6b6b");
    }
  }

  // ---------------------------------------------------------------- end turn & AI replay
  function idleUnits() { return myUnits().filter(u => !u.acted && !(u.moved && !U(u.type).move_fire)).length; }
  function requestEndTurn() {
    if (busy || !state || state.over) return;
    const idle = idleUnits();
    if (settings.confirmEnd && idle > 0) {
      confirmDialog(`End turn ${state.turn}?`, `${idle} unit${idle > 1 ? "s have" : " has"} not acted yet.`, [
        { label: "End turn", hot: "y", cls: "primary", fn: endTurn },
        { label: "Keep playing", hot: "n", fn: () => {} }]);
    } else endTurn();
  }
  async function endTurn() {
    if (busy || !state || state.over) return;
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
      if (!u) { u = Object.assign({ mhp: U(e.u.type).hp, moved: true, acted: true }, e.u); u.x = e.from[0]; u.y = e.from[1]; state.units.push(u); }
      anim = { id: u.id, fx: e.from[0], fy: e.from[1], tx: e.to[0], ty: e.to[1], start: performance.now(), dur: speed(380) || 1 };
      await sleep(400); u.x = e.to[0]; u.y = e.to[1]; anim = null;
      if (!e.to_vis) state.units = state.units.filter(x => x.id !== u.id);
      else if (!e.from_vis) { pop(e.to[0], e.to[1], "CONTACT", "#ff6b6b"); beep("hit"); }
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
    } else if (e.t === "ambush") { pop(e.x, e.y, "AMBUSH!", "#4dff9d"); await sleep(350); }
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
  function requestNew() {
    if (!state) return;
    if (state.over) { openLevelModal(); return; }
    confirmDialog("Abandon this operation?", `Turn ${state.turn} is in progress. Unsaved progress will be lost.`, [
      { label: "Save first", hot: "s", cls: "good", fn: () => openSaves() },
      { label: "Abandon", hot: "a", cls: "danger", fn: openLevelModal },
      { label: "Cancel", hot: "c", fn: () => {} }]);
  }
  function openLevelModal() {
    const box = $("level-list"); box.innerHTML = "";
    Object.entries(META.levels).forEach(([lvl, desc], i) => {
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
      const j = await api("/api/new", { level });
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
    { k: "anim", t: "sel", l: "Animation speed", d: "Enemy-turn replay speed.", o: [["normal", "Normal"], ["fast", "Fast"], ["off", "Instant"]] },
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
      } else {
        ctl = document.createElement("select"); ctl.className = "form-select form-select-sm";
        const opts = s.o === "levels" ? Object.keys(META.levels).map(k => [k, k[0].toUpperCase() + k.slice(1)]) : s.o;
        ctl.innerHTML = opts.map(([v, n]) => `<option value="${v}" ${settings[s.k] === v ? "selected" : ""}>${n}</option>`).join("");
        ctl.addEventListener("change", e => { settings[s.k] = e.target.value; saveSettings(); applySettings(); });
      }
      row.appendChild(ctl); box.appendChild(row);
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
    $("record-row").classList.toggle("hidden", !s.can_record);
    $("end-overlay").classList.remove("hidden");
    if (s.can_record) setTimeout(() => $("cmdr-name").focus(), 50);
  }
  $("save-record").addEventListener("click", async () => {
    try {
      const j = await api("/api/records", { name: $("cmdr-name").value.trim() || "Anon" });
      state.can_record = false; $("record-row").classList.add("hidden"); renderHof(j.records); showTab("records");
    } catch (e) { err(e); }
  });
  async function refreshHof() { try { renderHof((await api("/api/records")).records); } catch (e) {} }
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function renderHof(recs) {
    $("hof").innerHTML = !recs.length ? `<tr><td class="muted">No verified victories yet.</td></tr>` :
      `<tr><th>#</th><th>Commander</th><th>AI</th><th class="n">Turns</th><th class="n">Kills</th><th class="n">Left</th><th>Date</th></tr>` +
      recs.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${esc(r.level)}</td><td class="n">${r.turns}</td><td class="n">${r.kills}</td><td class="n">${r.units_left}</td><td>${esc(r.date)}</td></tr>`).join("");
  }

  // ---------------------------------------------------------------- export board
  function exportBoard() {
    const c = document.createElement("canvas"), cw = LAB + W * TILE, ch = LAB + H * TILE, bh = 30;
    c.width = cw; c.height = ch + bh; const t = c.getContext("2d"), P = pal();
    t.fillStyle = P.bg; t.fillRect(0, 0, c.width, c.height);
    t.fillStyle = P.text; t.font = "bold 14px system-ui"; t.textBaseline = "middle"; t.textAlign = "left";
    t.fillText(`IRON GRID — turn ${state.turn} — AI: ${state.level} — ${myUnits().length} units — ${state.credits} cr`, 8, bh / 2);
    t.translate(0, bh); drawScene(t, false);
    c.toBlob(b => { const a = document.createElement("a"); a.href = URL.createObjectURL(b);
      a.download = `irongrid-turn-${state.turn}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); });
    toast("Board image saved.", "good");
  }

  // ---------------------------------------------------------------- tabs
  function showTab(name) {
    document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
    document.querySelectorAll(".tabpane").forEach(p => p.classList.toggle("hidden", p.id !== "tab-" + name));
    if (name === "records") refreshHof();
  }
  document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => showTab(b.dataset.tab)));

  // ---------------------------------------------------------------- input: mouse
  function tileFromEvent(e) {
    const r = canvas.getBoundingClientRect();
    const sx = canvas.width / r.width, sy = canvas.height / r.height;
    const x = Math.floor(((e.clientX - r.left) * sx - LAB) / TILE), y = Math.floor(((e.clientY - r.top) * sy - LAB) / TILE);
    return (x >= 0 && y >= 0 && x < W && y < H) ? { x, y } : null;
  }
  async function activate(x, y, fromKeys) {
    if (busy || !state || state.over) return;
    cursor = { x, y };
    const u = unitAt(x, y);
    if (sel) {
      if (u && u.side === "A" && sel.attacks.has(u.id)) return doAttack(u.id);
      if (sel.moves.has(key(x, y))) return doMove(x, y);
      if (u && u.id === sel.unit.id && fromKeys) return doWait(u.id);
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
  canvas.addEventListener("click", e => {
    canvas.focus({ preventScroll: true });
    const t = tileFromEvent(e); if (t) activate(t.x, t.y, false);
  });
  canvas.addEventListener("mousemove", e => { hover = tileFromEvent(e); updateStatusline(); });
  canvas.addEventListener("mouseleave", () => { hover = null; });

  // ---------------------------------------------------------------- input: keyboard
  function readyUnits() { return myUnits().filter(u => !u.acted && !(u.moved && !U(u.type).move_fire)).sort((a, b) => a.id - b.id); }
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
    if (k === "Enter" || k === " ") { if (tag === "button") return; e.preventDefault(); activate(cursor.x, cursor.y, true); return; }
    if (k === "Escape") { cancelSel(); return; }
    if (k === "Tab") { e.preventDefault(); cycleReady(e.shiftKey ? -1 : 1); return; }
    if (busy) return;
    if (lk >= "1" && lk <= "8" && selB && selB.side === "P" && ["HQ", "factory"].includes(selB.type)) {
      doBuild(selB.x, selB.y, META.order[+lk - 1]); return;
    }
    switch (lk) {
      case "t": cycleTarget(); break;
      case "w": if (sel) doWait(sel.unit.id); break;
      case "f": if (sel) doFound(sel.unit.id); break;
      case "u": { const b = selB || buildingAt(cursor.x, cursor.y); if (b && b.side === "P") doUpgrade(b.x, b.y); break; }
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
      case "p": exportBoard(); break;
    }
  });

  // ---------------------------------------------------------------- wiring
  $("end-turn").addEventListener("click", requestEndTurn);
  $("btn-new").addEventListener("click", requestNew);
  $("rematch").addEventListener("click", requestNew);
  $("btn-saves").addEventListener("click", openSaves);
  $("btn-settings").addEventListener("click", openSettings);
  $("btn-help").addEventListener("click", openHelp);
  $("btn-export").addEventListener("click", exportBoard);
  $("modal-new-cancel").addEventListener("click", () => closeModal("modal-new"));
  $("settings-close").addEventListener("click", () => closeModal("modal-settings"));
  $("saves-close").addEventListener("click", () => closeModal("modal-saves"));
  $("help-close").addEventListener("click", () => closeModal("modal-help"));
  $("cmdr-name").addEventListener("keydown", e => { if (e.key === "Enter") $("save-record").click(); });

  (async function boot() {
    applySettings();
    try {
      META = await api("/api/meta");
      W = META.w; H = META.h; TERRAIN = META.map;
      canvas.width = LAB + W * TILE; canvas.height = LAB + H * TILE;
      buildManual(); buildFilters(); refreshHof();
      loadState((await api("/api/state")).state);
      const first = myUnits().find(u => !u.acted);
      if (first) cursor = { x: first.x, y: first.y };
      canvas.focus({ preventScroll: true });
      updateStatusline();
    } catch (e) { $("statusline").textContent = "Could not reach the server: " + e.message; }
  })();
})();