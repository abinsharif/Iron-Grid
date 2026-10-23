/* IRON GRID V4 lobby: accounts, LAN presence, AI operations, PvP challenges, hall of fame. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const setHidden = (id, hidden) => {
    const el = $(id);
    if (el) el.classList.toggle("hidden", hidden);
  };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  async function api(path, body, method) {
    const opt = body !== undefined
      ? { method: method || "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : (method ? { method } : {});
    const r = await fetch(path, opt);
    const j = await r.json().catch(() => ({ ok: false, error: "bad response" }));
    if (!r.ok || j.ok === false) throw new Error(j.error || ("HTTP " + r.status));
    return j;
  }

  let META = null, ME = null, registering = false;

  // ---------------------------------------------------------------- auth
  function authErr(msg) { $("auth-err").textContent = msg || ""; }
  function setMode(reg) {
    registering = reg;
    $("auth-title").textContent = reg ? "Register" : "Sign in";
    $("auth-go").textContent = reg ? "Create account" : "Sign in";
    $("auth-switch").textContent = reg ? "Already registered? Sign in" : "Need an account? Register";
    authErr("");
  }
  async function submitAuth() {
    authErr("");
    const name = $("auth-name").value.trim(), password = $("auth-pass").value;
    try {
      const j = await api(registering ? "/api/register" : "/api/login", { name, password });
      ME = j.user;
      enterLobby();
    } catch (e) { authErr(e.message); }
  }
  $("auth-go").addEventListener("click", submitAuth);
  $("auth-switch").addEventListener("click", () => setMode(!registering));
  ["auth-name", "auth-pass"].forEach(id => $(id).addEventListener("keydown", e => {
    if (e.key === "Enter") submitAuth();
  }));

  // ---------------------------------------------------------------- lobby
  function enterLobby() {
    setHidden("lobby-loading", true);
    setHidden("auth-view", true);
    setHidden("lobby-view", false);
    $("me-stats").style.display = "";
    ["btn-battle", "btn-refresh", "btn-logout"].forEach(id => setHidden(id, false));
    renderMe(); refreshAll();
    if (!pollTimer) pollTimer = setInterval(refreshAll, 4000);
  }
  function renderTierRating() {
    if (!ME || !ME.tiers) return;
    const sel = $("rank-tier-sel");
    const t = sel ? +sel.value : 2;
    const tr = ME.tiers[t] || { rating: 0, title: "Cadet" };
    $("me-trank").textContent = tr.rating;
    $("me-ttitle").textContent = tr.title;
  }

  function renderMe() {
    if (!ME) return;
    renderTierRating();
    $("me-name").textContent = ME.name;
    $("me-rank").textContent = ME.rank;
    $("me-title").textContent = ME.title;
    $("me-wl").textContent = `${ME.wins} / ${ME.losses}`;
  }
  $("btn-battle").addEventListener("click", () => { location.href = "/"; });
  $("btn-refresh").addEventListener("click", refreshAll);
  $("btn-logout").addEventListener("click", async () => {
    try { await api("/api/logout", {}); } catch (e) {}
    location.reload();
  });

  function aiButton(lvl, desc, i) {
    const b = document.createElement("button");
    b.className = "btn-ig lobby-ai";
    b.style.textAlign = "left";
    b.innerHTML = `<b>${i + 1}. ${lvl[0].toUpperCase() + lvl.slice(1)}</b><br><small>${esc(desc)}</small>`;
    b.addEventListener("click", async () => {
      b.disabled = true;
      try { await api("/api/new", { level: lvl, map: +$("map-sel").value, tier: +$("tier-sel").value,
                                    doctrine: $("doc-sel") ? $("doc-sel").value : "territ" }); location.href = "/"; }
      catch (e) { alert(e.message); b.disabled = false; }
    });
    return b;
  }

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

  async function refreshAll() {
    try {
      const mej = await api("/api/me");
      if (!mej.user) { location.reload(); return; }
      ME = mej.user; renderMe();
    } catch (e) { return; }
    try {
      const [lob, recs] = await Promise.all([api("/api/lobby"), api("/api/records")]);
      renderPlayers(lob.players);
      renderGames(lob.open, lob.games);
      renderHof(recs.records);
    } catch (e) { /* server hiccup — keep last render */ }
  }

  function renderPlayers(players) {
    const el = $("player-list");
    if (!players.length) { el.innerHTML = `<div class="muted">Nobody else online right now. Operations vs AI are always available.</div>`; return; }
    el.innerHTML = "";
    for (const p of players) {
      const d = document.createElement("div");
      d.className = "pitem";
      d.innerHTML = `<span><b>${esc(p.name)}</b> <span class="muted">· ${p.rank} ${esc(p.title)}</span></span>`;
      const b = document.createElement("button");
      b.className = "btn-ig sm primary"; b.textContent = "Challenge";
      b.addEventListener("click", async () => {
        b.disabled = true;
        try { await api("/api/pvp/create", { opponent: p.id, tier: wiz.tier,
                                             doctrine: $("doc-sel") ? $("doc-sel").value : "territ" }); location.href = "/"; }
        catch (e) { alert(e.message); b.disabled = false; }
      });
      d.appendChild(b); el.appendChild(d);
    }
  }

  function gameRow(text, btnText, fn, hot, abandon) {
    const d = document.createElement("div");
    d.className = "pitem";
    d.innerHTML = `<span>${text}</span>`;
    const b = document.createElement("button");
    b.className = "btn-ig sm " + (hot ? "primary" : ""); b.textContent = btnText;
    b.addEventListener("click", fn); d.appendChild(b);
    if (abandon) {
      const remove = document.createElement("button");
      remove.className = "btn-ig sm danger"; remove.textContent = "Abandon";
      remove.addEventListener("click", abandon); d.appendChild(remove);
    }
    return d;
  }

  function renderGames(open, mine) {
    const el = $("game-list");
    el.innerHTML = "";
    if (!open.length && !mine.length) {
      el.innerHTML = `<div class="muted">No multiplayer battles yet. Challenge someone online,
      or post an open challenge by pressing Challenge and sharing the battle from your list.</div>`;
      return;
    }
    for (const g of mine) {
      el.appendChild(gameRow(
        `<b>vs ${esc(g.opponent)}</b> · T${g.tier || 2} · turn ${g.turn} · ${g.first ? "you move first" : "they move first"} · ${g.your_turn ? `<span class="tag-p">your move</span>` : `<span class="muted">${esc(g.opponent)} is moving</span>`}`,
        "Play", async () => {
          try { await api(`/api/pvp/${g.id}/play`, {}); location.href = "/"; }
          catch (e) { alert(e.message); }
        }, g.your_turn, async () => {
          if (!confirm("Abandon and remove this battle for both players?")) return;
          try { await api(`/api/game/${g.id}/abandon`, {}); refreshAll(); }
          catch (e) { alert(e.message); }
        }));
    }
    for (const g of open) {
      el.appendChild(gameRow(
        `<b>Open challenge</b> · turn ${g.turn} · waiting for an opponent`,
        "Join", async () => {
          try { await api(`/api/pvp/${g.id}/join`, { doctrine: $("doc-sel") ? $("doc-sel").value : "territ" }); location.href = "/"; }
          catch (e) { alert(e.message); }
        }, true));
    }
  }

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

  // ---------------------------------------------------------------- boot
  let pollTimer = null;
  (async function boot() {
    try { META = await api("/api/meta"); } catch (e) { /* server down; auth will show errors */ }
    try {
      const j = await api("/api/me");
      if (j.user) { ME = j.user; enterLobby(); buildAiList(); return; }
    } catch (e) {}
    buildAiList();
    setMode(false);
    setHidden("lobby-loading", true);
    setHidden("auth-view", false);
    $("auth-name").focus();
  })();

  const TIER_BLURB = {
    1: "The original ruleset: 4 units, no roads, no swamp. Learn the fundamentals.",
    2: "The full 8-unit combined-arms game with counters, repairs and upgrades.",
    3: "Engineers reshape the battlefield: bridges, forts, two-step captures.",
    4: "Doctrines, radar, training camps and heavy hardware on 24×16 maps.",
    5: "Air power with fuel, airfields and transport helicopters on 28×18 maps.",
    6: "Naval warfare: warships, submarines, shore bombardment on 32×20 maps.",
  };
  const MAP_MAX_TIER = { 10: 3, 16: 4, 18: 5, 20: 6 };
  const wiz = { step: 1, tier: 2, map: -1, level: "easy", doctrine: "territ" };

  function wcards(box, items, sel, fn) {
    box.innerHTML = "";
    for (const it of items) {
      const b = document.createElement("button");
      b.className = "wcard" + (sel !== undefined && String(sel) === String(it.id) ? " sel" : "");
      b.innerHTML = it.html;
      b.addEventListener("click", () => fn(it.id));
      box.appendChild(b);
    }
  }
  function wizDots() {
    document.querySelectorAll("#wiz-track .wiz-dot").forEach(d =>
      d.classList.toggle("on", +d.dataset.step <= wiz.step));
  }
  function wizShow() {
    $("wiz-tier").classList.toggle("hidden", wiz.step !== 1);
    $("wiz-map").classList.toggle("hidden", wiz.step !== 2);
    $("wiz-doc").classList.toggle("hidden", !(wiz.step === 2 && wiz.tier >= 4));
    $("wiz-ai").classList.toggle("hidden", wiz.step !== 3);
    $("wiz-back").classList.toggle("hidden", wiz.step === 1);
    $("wiz-hint").textContent = ["Pick your ruleset - each tier is its own complete game.",
      "Maps are sized to your tier; the dice deals a random one.",
      "Pick the enemy doctrine strength - then fight."][wiz.step - 1];
    wizDots();
  }
  function renderTierStep() {
    wcards($("wiz-tier"), Object.entries(META.tiers).map(([t, v]) => ({
      id: t,
      html: `<b>Tier ${t} — ${v.name}</b><small>${TIER_BLURB[t] || ""}</small>`,
    })), wiz.tier, t => { wiz.tier = +t; wiz.map = -1; renderMapStep(); wiz.step = 2; wizShow(); });
  }
  function mapsForTier() {
    return META.maps.map((m, i) => ({ m, i }))
      .filter(({ m }) => wiz.tier <= (MAP_MAX_TIER[m.h || 10] || 3));
  }
  function renderMapStep() {
    const items = [{ id: -1, html: `<b>🎲 Random battlefield</b><small>Let the war decide the terrain.</small>` }]
      .concat(mapsForTier().map(({ m, i }) => ({
        id: i,
        html: `<b>Map ${i + 1} — ${m.name}</b><small>${m.w || 14}×${m.h || 10} battlefield</small>`,
      })));
    wcards($("wiz-map"), items, wiz.map, id => { wiz.map = +id; renderAiStep(); wiz.step = 3; wizShow(); });
  }
  function renderAiStep() {
    const box = $("wiz-ai");
    box.innerHTML = "";
    orderedLevels().forEach(([lvl, desc], i) => {
      const b = document.createElement("button");
      b.className = "wcard" + (wiz.level === lvl ? " sel" : "");
      b.innerHTML = `<b>${i + 1}. ${lvl[0].toUpperCase() + lvl.slice(1)}</b><small>${esc(desc)}</small>`;
      b.addEventListener("click", async () => {
        b.disabled = true;
        try {
          await api("/api/new", { level: lvl, map: wiz.map, tier: wiz.tier,
                                  doctrine: $("doc-sel") ? $("doc-sel").value : "territ" });
          location.href = "/";
        } catch (e) { alert(e.message); b.disabled = false; }
      });
      box.appendChild(b);
    });
  }
  function buildAiList() {
    const dsel = $("doc-sel");
    if (!META) {
      $("wiz-tier").innerHTML = `<div class="muted">Server unreachable.</div>`;
      return;
    }
    if (dsel && META.doctrine_order) {
      dsel.innerHTML = META.doctrine_order.map(k => `<option value="${k}">${META.doctrines[k]}</option>`).join("");
    }
    if (META.version) $("lobby-ver").textContent = "V" + META.version + " · LOBBY";
    const rts = $("rank-tier-sel");
    if (rts && !rts.dataset.wired) {
      rts.dataset.wired = "1";
      rts.addEventListener("change", renderTierRating);
    }
    wiz.step = 1; wizShow(); renderTierStep();
  }
  $("wiz-back").addEventListener("click", () => {
    wiz.step = Math.max(1, wiz.step - 1); wizShow();
  });
})();
