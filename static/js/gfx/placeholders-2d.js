/* IRON GRID 2D - procedural art for units and structures (used wherever no image exists in the asset manifest).
 * Pure vector drawing in a LOGICAL 44x44 tile box, no knowledge of the asset loader. Units are drawn centred on 0,0,
 * facing +x (east), inside about +-20 px; structures are drawn in the box 0..44. Optional `o` carries animation state:
 *   units:      {ph: track/leg phase, spin: rotor angle}      structures: {t: seconds, producing: bool, owned: bool} */
(function (G) {
  "use strict";
  const TAU = Math.PI * 2;
  const rr = (g, x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  const circ = (g, x, y, r, fill, stroke) => { g.beginPath(); g.arc(x, y, r, 0, TAU); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.stroke(); } };
  const poly = (g, pts, fill, stroke) => { g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.stroke(); } };
  const rect = (g, x, y, w, h, fill) => { g.fillStyle = fill; g.fillRect(x, y, w, h); };
  const line = (g, x0, y0, x1, y1, col, w) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
  const vg = (g, y0, y1, c0, c1) => { const r = g.createLinearGradient(0, y0, 0, y1); r.addColorStop(0, c0); r.addColorStop(1, c1); return r; };
  const hg = (g, x0, x1, c0, c1) => { const r = g.createLinearGradient(x0, 0, x1, 0); r.addColorStop(0, c0); r.addColorStop(1, c1); return r; };
  const shade = (g, x, y, w, h, r, c0, c1) => { rr(g, x, y, w, h, r); g.fillStyle = vg(g, y, y + h, c0, c1); g.fill(); };

  // ================================================================== structures
  const flag = (g, x, y, col, t, h = 10) => { line(g, x, y, x, y - h, "#2f343c", 1.2);
    g.fillStyle = col; g.beginPath(); g.moveTo(x, y - h); for (let i = 0; i <= 4; i++) g.lineTo(x + i * 2.2, y - h + 1 + Math.sin(t * 5 + i * 1.1) * .9 + i * .15);
    for (let i = 4; i >= 0; i--) g.lineTo(x + i * 2.2, y - h + 5.2 + Math.sin(t * 5 + i * 1.1) * .9 + i * .15); g.closePath(); g.fill(); g.strokeStyle = "rgba(0,0,0,.35)"; g.lineWidth = .5; g.stroke(); };
  const smoke = (g, x, y, t, n, strong) => { for (let i = 0; i < n; i++) { const q = (t * .55 + i / n) % 1;
    circ(g, x + Math.sin(t + i * 2) * 1.4 + q * 3, y - q * 15, 1.8 + q * 3.6, `rgba(215,215,215,${(strong ? .62 : .26) * (1 - q)})`); } };
  const windows = (g, x, y, cols, rows, w, h, gx, gy, col) => { for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) rect(g, x + i * gx, y + j * gy, w, h, col || "#7c9bb8"); };
  function structure(g, type, col, o) {
    o = o || {}; const t = o.t || 0, prod = !!o.producing, neutral = col === "#9aa7bb";
    const pad = neutral ? "rgba(80,86,98,.5)" : "rgba(70,76,90,.55)";
    rect(g, 1.5, 1.5, 41, 41, pad);
    g.fillStyle = col; g.globalAlpha = .18; g.fillRect(1.5, 1.5, 41, 41); g.globalAlpha = 1;      // owner tint on the apron
    const dk = "#3a404c", lt = "#dfe3ea", grey = "#9aa3b2";
    const shadow = (x, y, w, h) => poly(g, [[x + w, y + 2], [x + w + 4, y + 5], [x + w + 4, y + h + 5], [x + w, y + h + 2]], "rgba(0,0,0,.3)");
    switch (type) {
      case "HQ": shadow(6, 12, 32, 24); shade(g, 6, 12, 32, 24, 1.5, "#eef1f6", "#b9c0cc"); rect(g, 6, 12, 32, 5, col); rect(g, 6, 17, 32, 1, "rgba(0,0,0,.3)");
        shade(g, 14, 20, 16, 16, 1, "#f6f8fb", "#cbd1db"); windows(g, 8, 21, 2, 3, 4, 3, 5.5, 5, "#6f93b6"); windows(g, 31, 21, 2, 3, 4, 3, 5.5, 5, "#6f93b6");
        rect(g, 19, 27, 6, 9, dk); for (const x of [14.5, 28]) rect(g, x, 20, 1.5, 16, "#aeb6c3");
        poly(g, [[22, 4.5], [24.2, 9.4], [29.5, 9.7], [25.4, 13], [26.8, 18.3], [22, 15.4], [17.2, 18.3], [18.6, 13], [14.5, 9.7], [19.8, 9.4]], col, "rgba(0,0,0,.4)");
        flag(g, 37, 12, col, t, 12); break;
      case "factory": shadow(5, 15, 34, 23); shade(g, 5, 15, 34, 23, 1, "#b7bfcb", "#7e8794");
        for (let i = 0; i < 3; i++) { const x = 5 + i * 11.33; poly(g, [[x, 15], [x, 9], [x + 11.33, 15]], "#c9d0da"); poly(g, [[x, 9], [x + 11.33, 15], [x + 11.33, 9.6]], "#7e8794"); }
        rect(g, 5, 15, 34, 3, col); rect(g, 9, 27, 10, 11, dk); rect(g, 10.5, 28.5, 7, 9.5, "#565d6a"); rect(g, 24, 27, 10, 11, dk);
        rect(g, 31, 3, 5, 14, "#6b7280"); rect(g, 31, 3, 5, 2.6, col); rect(g, 24, 6, 4, 11, "#6b7280"); smoke(g, 33.5, 3, t, prod ? 4 : 2, prod); smoke(g, 26, 6, t + .4, prod ? 3 : 0, prod);
        if (prod) { g.fillStyle = `rgba(255,190,70,${.45 + .3 * Math.sin(t * 8)})`; g.fillRect(11, 28.5, 6, 7); } break;
      case "city": [[4, 13, 12, 17, 3], [18, 6, 10, 20, 4], [30, 17, 10, 16, 3], [8, 31, 13, 9, 2], [26, 33, 11, 7, 2]].forEach(([x, y, w, h, r], i) => {
          shadow(x, y, w, h); shade(g, x, y, w, h, 1, i % 2 ? "#dcd5c4" : "#e7e1d1", i % 2 ? "#aea78f" : "#bdb6a0"); rect(g, x, y, w, 2.4, i % 3 === 0 ? col : "#7f8794");
          windows(g, x + 1.8, y + 5, Math.max(2, Math.floor(w / 4)), Math.max(1, Math.floor((h - 6) / 4.4)), 2.2, 2.4, 3.6, 4.4, "#7aa0c4"); });
        circ(g, 40, 7, 3, "#3d7a3a"); circ(g, 39, 6, 1.6, "#58994d"); flag(g, 29, 8, col, t, 7); break;
      case "barracks": shadow(5, 14, 34, 15); shade(g, 5, 14, 34, 15, 1, "#a2a77f", "#767b57"); poly(g, [[4, 14], [22, 6], [40, 14]], "#687047"); poly(g, [[22, 6], [40, 14], [22, 14]], "#545b39");
        rect(g, 18, 20, 8, 9, dk); rect(g, 6, 16, 8, 3, col); windows(g, 29, 18, 2, 1, 4, 4, 5.5, 0, "#c9d8e8");
        for (const [x, y] of [[6, 36], [20, 37], [31, 36]]) { poly(g, [[x - 6, y + 4], [x, y - 6], [x + 6, y + 4]], "#7d8458"); poly(g, [[x, y - 6], [x + 6, y + 4], [x, y + 4]], "#646a45"); rect(g, x - 1, y - 1, 2, 5, dk); }
        g.strokeStyle = "#a69a74"; g.lineWidth = 2; g.beginPath(); g.arc(8, 30, 5, -1.1, 1.1); g.stroke(); flag(g, 38, 14, col, t, 11);
        if (prod) rect(g, 18.8, 21, 6.4, 7, `rgba(255,200,90,${.5 + .3 * Math.sin(t * 7)})`); break;
      case "fort": shadow(5, 5, 34, 34); shade(g, 5, 5, 34, 34, 1.5, "#b3ab9b", "#837b6c"); rect(g, 11, 11, 22, 22, "#6c665b"); rect(g, 13, 13, 18, 18, "#8a8272");
        for (let i = 0; i < 6; i++) { rect(g, 6 + i * 6, 3.6, 3.4, 3, "#c7bfae"); rect(g, 6 + i * 6, 37.4, 3.4, 3, "#9d9584"); }
        [[3, 3], [33, 3], [3, 33], [33, 33]].forEach(([x, y]) => { shade(g, x, y, 9, 9, 1.4, "#cfc7b6", "#948c7c"); rect(g, x + 2, y + 2, 5, 5, col); });
        circ(g, 22, 22, 6, "#4b505b"); rect(g, 22, 20.6, 12, 2.8, "#2c3038"); rect(g, 19.5, 33, 5, 5, dk); flag(g, 37.5, 3, col, t, 8); break;
      case "radar": shadow(8, 22, 28, 15); shade(g, 8, 22, 28, 15, 1, "#cbd1da", "#8d95a3"); rect(g, 8, 22, 28, 3, col); windows(g, 11, 28, 4, 1, 4, 3, 6, 0, "#6f93b6");
        rect(g, 20, 14, 4, 9, "#6b7280"); g.save(); g.translate(22, 12); g.scale(Math.max(.25, Math.abs(Math.cos(t * 1.4))), 1);
        g.fillStyle = "#e6e9ef"; g.beginPath(); g.ellipse(0, 0, 13, 7, 0, Math.PI, TAU); g.fill(); g.strokeStyle = "#7a8291"; g.lineWidth = 1; g.stroke(); g.restore();
        rect(g, 21.2, 4, 1.6, 8, "#7a8291"); circ(g, 22, 4, 1.8, `rgba(255,${80 + 80 * Math.sin(t * 4) | 0},60,1)`); break;
      case "airbase": rect(g, 2, 19, 40, 11, "#3f4551"); for (let i = 0; i < 6; i++) rect(g, 4 + i * 6.6, 24, 3.6, 1.5, "#f1f1d0"); rect(g, 2, 19, 40, 1, "#cfd3da"); rect(g, 2, 29, 40, 1, "#cfd3da");
        shadow(4, 4, 18, 11); g.fillStyle = hg(g, 4, 22, "#c9d0da", "#8a93a1"); g.beginPath(); g.moveTo(4, 15); g.quadraticCurveTo(13, 0, 22, 15); g.closePath(); g.fill(); rect(g, 4, 13, 18, 2, col); rect(g, 9, 9, 8, 6, dk);
        shade(g, 30, 3, 6, 14, 1, "#dde1e8", "#9ba3b0"); rect(g, 29, 3, 8, 3.4, "#7fb2d8"); circ(g, 33, 2, 1.6, `rgba(255,${120 + 100 * Math.sin(t * 6) | 0},60,1)`);
        line(g, 38, 40, 38, 33, "#2f343c", 1); g.fillStyle = "#ff8a3c"; g.beginPath(); g.moveTo(38, 33); g.lineTo(38 + 5 + Math.sin(t * 3) * 1.2, 34.5); g.lineTo(38, 36); g.fill(); break;
      case "airfield": rect(g, 2, 14, 40, 11, "#3f4551"); for (let i = 0; i < 6; i++) rect(g, 4 + i * 6.6, 19, 3.6, 1.5, "#f1f1d0"); rect(g, 2, 14, 40, 1, "#cfd3da"); rect(g, 2, 24, 40, 1, "#cfd3da");
        shadow(26, 29, 12, 9); shade(g, 26, 29, 12, 9, 1, "#aab2bf", "#767f8d"); rect(g, 29, 32, 6, 6, dk); rect(g, 26, 29, 12, 2, col);
        line(g, 6, 12, 6, 4, "#2f343c", 1); g.fillStyle = "#ff8a3c"; g.beginPath(); g.moveTo(6, 4); g.lineTo(6 + 6 + Math.sin(t * 3) * 1.3, 5.5); g.lineTo(6, 8); g.fill(); break;
      case "harbor": case "port": case "shipyard": {
        const wg = vg(g, 24, 44, "#3a86c4", "#1f5f9f"); g.fillStyle = wg; g.fillRect(2, 26, 40, 16);
        g.strokeStyle = "rgba(255,255,255,.35)"; g.lineWidth = 1; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(3, 30 + i * 4.5); g.quadraticCurveTo(12, 28 + i * 4.5 + Math.sin(t * 2 + i), 22, 30 + i * 4.5); g.quadraticCurveTo(32, 32 + i * 4.5, 41, 30 + i * 4.5); g.stroke(); }
        shade(g, 2, 5, 40, 21, 1, "#b2ab9b", "#857e6f"); rect(g, 2, 24, 40, 2, "#6c665b");
        if (type === "harbor") { shade(g, 17, 24, 9, 16, 1, "#a09886", "#7a7364"); rect(g, 30, 7, 3, 15, dk); rect(g, 22, 7, 14, 2.4, col); line(g, 23, 9, 23, 17, "#2f343c", 1); rect(g, 22, 17, 3, 2.4, "#c9a24a");
          rect(g, 6, 9, 7, 5, "#d6a542"); rect(g, 6, 15, 7, 5, "#8d4a3a"); rect(g, 13.5, 9, 7, 5, "#4a7c59"); }
        else if (type === "port") { [["#d6a542", 4], ["#8d4a3a", 12], ["#4a7c59", 20], ["#4d6fa8", 28], ["#b9553c", 36]].forEach(([c, x], i) => { rect(g, x, 7, 7, 5.5, c); rect(g, x, 14, 7, 5.5, i % 2 ? "#4d6fa8" : "#d6a542"); rect(g, x, 7, 7, 1, "rgba(255,255,255,.3)"); });
          rect(g, 6, 20, 32, 3, "#5a6270"); rect(g, 12, 18, 3, 8, dk); rect(g, 27, 18, 3, 8, dk); rect(g, 12, 18, 18, 2.2, col); }
        else { shade(g, 8, 26, 28, 12, 1, "#232b36", "#171d26"); for (let i = 0; i < 6; i++) line(g, 10 + i * 4.8, 27, 10 + i * 4.8, 36, "#8d6a3e", 1.5); line(g, 9, 31, 36, 31, "#8d6a3e", 1.5);
          rect(g, 6, 5, 3, 20, dk); rect(g, 6, 5, 20, 2.6, col); line(g, 24, 7, 24, 16 + (prod ? Math.sin(t * 3) * 2 : 0), "#2f343c", 1); rect(g, 22, 16, 4, 2.4, "#c9a24a");
          shade(g, 28, 7, 12, 14, 1, "#8f98a6", "#656d7a"); if (prod) for (let i = 0; i < 3; i++) { const a = jitter(t * 3 + i); g.fillStyle = `rgba(255,${200 + 40 * a | 0},90,${.7 * a})`; g.fillRect(14 + i * 7 + a * 3, 29 + a * 3, 2, 2); } }
        break; }
      case "battery": shadow(8, 8, 28, 28); shade(g, 8, 8, 28, 28, 6, "#9ea4af", "#6a707c"); circ(g, 22, 22, 11, "#4e5460"); circ(g, 22, 22, 8.5, "#6f7683");
        g.strokeStyle = "#b9a273"; g.lineWidth = 2.4; g.beginPath(); g.arc(22, 22, 14, .3, 5.9); g.stroke();
        g.save(); g.translate(22, 22); g.rotate(.45); rect(g, 0, -2.4, 18, 4.8, "#2c3038"); rect(g, 15.5, -3.2, 4.2, 6.4, "#515966"); circ(g, 0, 0, 5.4, "#aab1bd", "#4b525e"); g.restore(); rect(g, 8, 8, 8, 3, col); flag(g, 37, 10, col, t, 7); break;
      case "training": shadow(5, 20, 34, 16); shade(g, 5, 20, 34, 16, 1, "#a2a77f", "#767b57"); rect(g, 5, 20, 34, 3, col); circ(g, 22, 11, 7, "#f1f1f1", "#c9453a"); circ(g, 22, 11, 4.6, "#c9453a"); circ(g, 22, 11, 2.2, "#f1f1f1"); rect(g, 21, 17, 2, 4, dk); flag(g, 36, 20, col, t, 8); break;
      default: shade(g, 8, 8, 28, 28, 2, "#c9cfd9", "#8a93a1"); rect(g, 8, 8, 28, 4, col);
    }
    if ((o.level || 1) > 1) upgrade(g, type, col, o.level, t);
  }
  const jitter = x => .5 + .5 * Math.sin(x * 12.9898 * 3.1);
  /** Upgraded structures keep their silhouette but gain extra parts, so the level can be read at a glance. */
  function upgrade(g, type, col, lv, t) {
    const gold = "#e6b422", lamp = (x, y) => { circ(g, x, y, 1.5, gold); circ(g, x, y, 3, "rgba(255,220,120,.28)"); };
    for (const [x, y] of [[3.5, 3.5], [40.5, 3.5], [3.5, 40.5], [40.5, 40.5]]) lamp(x, y);                 // corner floodlights (L2+)
    g.strokeStyle = "rgba(235,238,245,.75)"; g.lineWidth = .8; g.strokeRect(2.5, 2.5, 39, 39);             // perimeter fence (L2+)
    const mast = (x, y, h) => { line(g, x, y, x, y - h, "#2f343c", 1); circ(g, x, y - h, 1.3, `rgba(255,${90 + 90 * Math.sin(t * 4) | 0},70,1)`); };
    switch (type) {
      case "HQ": shade(g, 16, 9, 12, 5, 1, "#fbfcfe", "#c4cad5"); mast(22, 9, 6);
        if (lv > 2) { circ(g, 10, 8, 3.4, "#eef1f6", "#7a8291"); line(g, 10, 8, 13, 5, "#7a8291", 1); flag(g, 6, 14, col, t + .6, 10); circ(g, 22, 40, 3, null, "#e6b422"); } break;
      case "factory": rect(g, 21, 5, 3.4, 12, "#6b7280"); rect(g, 21, 5, 3.4, 2, col); smoke(g, 22.7, 5, t + .8, 2, false);
        if (lv > 2) { shade(g, 39, 18, 4, 18, 1, "#aab2bf", "#6f7886"); line(g, 4, 39, 40, 39, "#7e8794", 1.6); rect(g, 3, 5, 3.4, 10, "#6b7280"); } break;
      case "city": shade(g, 33, 4, 6, 14, 1, "#e9edf3", "#aab2c0"); windows(g, 34, 6, 2, 3, 1.6, 2, 2.6, 3.4, "#7aa0c4"); mast(36, 4, 6);
        if (lv > 2) { shade(g, 20, 1, 5, 6, 1, "#f1f4f8", "#b6bdca"); mast(22.5, 1, 4); circ(g, 40, 40, 3, "#58994d"); } break;
      case "barracks": shade(g, 3, 4, 8, 9, 1, "#8c926a", "#666c49"); poly(g, [[2, 4], [7, 0.5], [12, 4]], "#545b39"); rect(g, 5.5, 7, 3, 4, dk);
        if (lv > 2) { shade(g, 32, 31, 9, 9, 1, "#9aa07a", "#6a704c"); rect(g, 34, 33, 5, 5, col); g.strokeStyle = "#a69a74"; g.lineWidth = 1.6; g.strokeRect(4, 4, 36, 36); } break;
      case "fort": shade(g, 17, 17, 10, 10, 1.5, "#d6cfbf", "#9a9282"); rect(g, 19, 19, 6, 6, col); flag(g, 22, 17, col, t, 9);
        if (lv > 2) for (const [x, y] of [[22, 3], [22, 41], [3, 22], [41, 22]]) { circ(g, x, y, 3, "#c7bfae", "#6c665b"); circ(g, x, y, 1.2, gold); } break;
      case "radar": g.save(); g.translate(33, 13); g.scale(Math.max(.25, Math.abs(Math.cos(t * 2.1 + 1))), 1); g.fillStyle = "#e6e9ef"; g.beginPath(); g.ellipse(0, 0, 8, 4.4, 0, Math.PI, TAU); g.fill(); g.restore(); rect(g, 32, 13, 2, 7, "#6b7280");
        if (lv > 2) { g.save(); g.translate(11, 13); g.scale(Math.max(.25, Math.abs(Math.cos(t * 1.7 + 2))), 1); g.fillStyle = "#e6e9ef"; g.beginPath(); g.ellipse(0, 0, 8, 4.4, 0, Math.PI, TAU); g.fill(); g.restore(); rect(g, 10, 13, 2, 7, "#6b7280"); } break;
      case "airbase": shadow2(g, 24, 3, 16, 9); g.fillStyle = hg(g, 24, 40, "#c9d0da", "#8a93a1"); g.beginPath(); g.moveTo(24, 12); g.quadraticCurveTo(32, 0, 40, 12); g.closePath(); g.fill(); rect(g, 24, 10, 16, 2, col);
        if (lv > 2) { rect(g, 3, 33, 38, 5, "#454b57"); for (let i = 0; i < 5; i++) rect(g, 5 + i * 7.4, 35.2, 4, 1, "#f1f1d0"); } break;
      case "airfield": rect(g, 3, 4, 14, 8, "#9aa2af"); rect(g, 3, 4, 14, 2, col); circ(g, 33, 8, 3.4, "#7e8794"); circ(g, 33, 8, 1.6, "#c9453a");
        if (lv > 2) shade(g, 20, 30, 7, 8, 1, "#aab2bf", "#767f8d"); break;
      case "harbor": case "port": case "shipyard": rect(g, 36, 6, 2.6, 14, "#3a404c"); rect(g, 30, 6, 9, 2, col); line(g, 31, 8, 31, 14, "#2f343c", 1);
        if (lv > 2) { rect(g, 4, 20, 10, 5, "#4d6fa8"); rect(g, 15, 20, 10, 5, "#d6a542"); } break;
      case "battery": rect(g, 22, 20.6, 17, 2.1, "#2c3038"); rect(g, 36, 20, 4, 3.4, "#515966");
        if (lv > 2) { circ(g, 22, 22, 7.4, "rgba(170,178,190,.55)", "#4b525e"); line(g, 30, 10, 30, 5, "#2f343c", 1); circ(g, 30, 5, 2, "#aab1bd"); } break;
      default: break;
    }
    if (lv > 2) { g.strokeStyle = gold; g.lineWidth = 1.4; g.strokeRect(1.5, 1.5, 41, 41); }                // gold trim marks the top level
  }
  const shadow2 = (g, x, y, w, h) => poly(g, [[x + w, y + 2], [x + w + 3, y + 4], [x + w + 3, y + h + 4], [x + w, y + h + 2]], "rgba(0,0,0,.28)");

  // ================================================================== units
  const BODY = ["#5d6a52", "#3f4a3a"], DARK = "#2a312d", MID = "#7e8a73", STEEL = "#6b7280";
  let O = {};
  function tracks(g, L, W) {
    rect(g, -L, -W - 3.4, 2 * L, 4.4, DARK); rect(g, -L, W - 1, 2 * L, 4.4, DARK);
    const ph = (O.ph || 0) % 4;
    for (let x = -L + 1 - ph; x < L; x += 4) { if (x < -L) continue; rect(g, x, -W - 3.4, 1.1, 4.4, "#141815"); rect(g, x, W - 1, 1.1, 4.4, "#141815"); }
    for (const y of [-W - 1.4, W + 1.2]) { rect(g, -L, y - .5, 2 * L, 1, "rgba(255,255,255,.1)"); circ(g, -L + 2.5, y, 1.9, "#3a423c"); circ(g, L - 2.5, y, 1.9, "#3a423c"); }
  }
  function hull(g, L, W, col) { shade(g, -L, -W, 2 * L, 2 * W, 3, BODY[0], BODY[1]); g.strokeStyle = "#1d231f"; g.lineWidth = 1; rr(g, -L, -W, 2 * L, 2 * W, 3); g.stroke();
    rect(g, -L + 1.2, -W + 1.2, 2 * L - 2.4, 1.2, "rgba(255,255,255,.18)"); rect(g, -L + 1, -1.2, 5, 2.4, col); for (let i = 0; i < 3; i++) rect(g, -L + 3 + i * 2.2, W - 4, 1.2, 2.6, "rgba(0,0,0,.35)"); }
  function turret(g, x, y, r, col) { circ(g, x, y, r, null); g.beginPath(); g.arc(x, y, r, 0, TAU); g.fillStyle = hg(g, x - r, x + r, "#9aa68e", "#566049"); g.fill(); g.strokeStyle = "#1d231f"; g.lineWidth = 1; g.stroke();
    circ(g, x - r * .25, y - r * .3, r * .35, "rgba(255,255,255,.16)"); circ(g, x - r * .3, y, r * .22, col); }
  const walk = (o) => Math.sin((o.ph || 0) * .9);
  function soldier(g, col, x = 0, y = 0, o = O) {
    g.save(); g.translate(x, y); const w = o.ph ? walk(o) * 3 : 0;
    circ(g, 0.5 + w * .6, 5, 2.2, "#2a2f27"); circ(g, .5 - w * .6, -5, 2.2, "#2a2f27");                      // boots (stride while moving)
    g.fillStyle = vg(g, -7, 7, "#6a7753", "#475238"); g.beginPath(); g.ellipse(0, 0, 4.4, 7, 0, 0, TAU); g.fill(); g.strokeStyle = "#252a21"; g.lineWidth = .8; g.stroke();
    rect(g, 1, -1.2, 14, 2.4, "#23282a"); rect(g, 6, -1.8, 3, 3.6, "#3a3f42"); rect(g, -5, -4, 3.2, 8, "#3b4232");
    circ(g, 0, 0, 4, "#7d7040"); circ(g, 0, 0, 4.4, null, "#3b3524"); circ(g, -1, -1.2, 1.3, "rgba(255,255,255,.25)"); rect(g, -4, -1.5, 3, 3, col); g.restore();
  }
  const rotor = (g, r, n, ang, alpha) => { g.save(); g.globalAlpha = alpha; circ(g, 0, 0, r, "rgba(235,240,245,.35)"); g.globalAlpha = 1;
    for (let i = 0; i < n; i++) { const a = ang + i * TAU / n; line(g, -Math.cos(a) * r * .15, -Math.sin(a) * r * .15, Math.cos(a) * r, Math.sin(a) * r, "#1e2226", 1.8); } circ(g, 0, 0, 1.8, "#444b52"); g.restore(); };
  function drawUnit(g, type, cls, col, o) {
    O = o || {}; const sp = O.spin || 0; g.lineWidth = 1;
    switch (type) {
      case "inf": soldier(g, col); break;
      case "at": soldier(g, col, -1, 0); rect(g, -13, -9, 24, 3.4, "#343b35"); rect(g, -13, -9, 24, 1, "rgba(255,255,255,.18)"); poly(g, [[11, -9.8], [17, -7.3], [11, -5.6]], "#c0562c"); circ(g, -13, -7.3, 2, "#2a2f27"); break;
      case "eng": soldier(g, col); shade(g, -10, -4.5, 5.5, 9, 1.5, "#9a7a46", "#6e5530"); line(g, 4, 6.5, 14, 6.5, "#caa05a", 2); rect(g, 12, 3.6, 5, 5.8, STEEL); rect(g, 12, 3.6, 5, 1.2, "#aab2c0"); break;
      case "mortar": circ(g, -4, 0, 7, "#3a413a"); circ(g, -4, 0, 5, "#4c554a"); line(g, -4, 0, 15, -5, DARK, 4.4); line(g, -4, 0, 15, -5, MID, 2.4); circ(g, 15, -5, 2.2, "#222"); soldier(g, col, -8, 9); rect(g, -11, 11, 5, 3, "#454c40"); break;
      case "sf": soldier(g, col); poly(g, [[-1, -10], [.2, -7], [3, -7], [.8, -5.2], [1.6, -2.4], [-1, -4.2], [-3.6, -2.4], [-2.8, -5.2], [-5, -7], [-2.2, -7]], "#e6c45a", "#5c4a12"); line(g, -3, 4, -9, 9, DARK, 1.2); circ(g, -9, 9, 1.4, "#d6dbe3"); break;
      case "mbt": tracks(g, 17, 9); hull(g, 17, 9, col); turret(g, -1, 0, 7.6, col); rect(g, 6, -1.7, 19, 3.4, DARK); rect(g, 6, -1.7, 19, 1, "rgba(255,255,255,.16)"); rect(g, 22, -2.4, 3.2, 4.8, STEEL); rect(g, 15, -3, 2.4, 6, "#2a312d"); circ(g, -2.4, 0, 2.2, "#262b25"); line(g, -6, -5, -12, -11, "#262b25", 1); break;
      case "ht": tracks(g, 19, 10.5); hull(g, 19, 10.5, col); rect(g, -17, -8.6, 8, 17.2, "#46503f");
        g.fillStyle = hg(g, -9, 10, "#a2ae96", "#566049"); rr(g, -9, -8.2, 19, 16.4, 4); g.fill(); g.strokeStyle = "#1d231f"; g.stroke(); rect(g, 8, -3.6, 16, 2.7, DARK); rect(g, 8, .9, 16, 2.7, DARK); rect(g, 22, -4.2, 3.4, 8.4, STEEL); circ(g, -2, 0, 3, "#262b25"); circ(g, -2, 0, 1.3, col); break;
      case "afv": rect(g, -15, -8.6, 30, 17.2, "rgba(0,0,0,.0)"); hull(g, 15, 8, col); [[-9, -9], [0, -9], [9, -9], [-9, 9], [0, 9], [9, 9]].forEach(([x, y]) => { circ(g, x, y, 2.8, "#171b19"); circ(g, x, y, 1.2, "#59615a"); }); turret(g, 0, 0, 5.6, col); rect(g, 4, -1, 13, 2, DARK); rect(g, 15, -1.6, 2.6, 3.2, STEEL); break;
      case "ifv": tracks(g, 16, 8.5); hull(g, 16, 8.5, col); shade(g, -7, -6, 14, 12, 3, "#8f9b84", "#566049"); rect(g, 6, -1, 13, 2, DARK); rect(g, 6, 2.6, 8, 1.6, "#2a312d"); rect(g, -13, -7, 4.4, 14, "#363d36"); rect(g, -3, -10, 8, 3, "#8a5a3a"); circ(g, 1, 0, 2, col); break;
      case "cv": tracks(g, 17, 9); hull(g, 17, 9, col); shade(g, -12, -7, 15, 14, 3, "#cdd3db", "#8e97a4"); circ(g, 8, 0, 6.2, "#e0e5ec", DARK); line(g, 8, -6, 8, 6, DARK, 1); line(g, 2, 0, 14, 0, DARK, 1); line(g, -9, -7, -15, -18, "#262b25", 1.2); circ(g, -15, -18, 1.2, "#c9453a"); rect(g, -10, -4, 6, 2.4, "#6f93b6"); break;
      case "mrl": tracks(g, 18, 9); hull(g, 18, 9, col); shade(g, -14, -8, 22, 16, 2, "#8f9b84", "#566049");
        for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) { const x = -9 + c * 7, y = -4 + r * 8; circ(g, x, y, 3, "#171b19"); circ(g, x, y, 1.8, "#3a413a"); circ(g, x, y, .9, "#c9453a"); }
        shade(g, 10, -5, 7, 10, 1.5, "#566049", "#3f4a3a"); circ(g, 13.5, 0, 1.8, "#262b25"); break;
      case "how": tracks(g, 19, 9.5); hull(g, 19, 9.5, col); shade(g, -9, -8, 19, 16, 4, "#97a38b", "#566049"); rect(g, 8, -2.2, 24, 4.4, DARK); rect(g, 8, -2.2, 24, 1.1, "rgba(255,255,255,.15)"); rect(g, 29, -3.8, 4.2, 7.6, STEEL); rect(g, 29, -3.8, 4.2, 1.5, "#9aa3b2");
        rect(g, -21, -7, 4.4, 14, "#363d36"); line(g, -21, -7, -24, -9, "#262b25", 2); line(g, -21, 7, -24, 9, "#262b25", 2); circ(g, 0, 0, 3.4, "#262b25"); circ(g, 0, 0, 1.4, col); break;
      case "sam": tracks(g, 17, 9); hull(g, 17, 9, col); shade(g, -12, -7.4, 22, 14.8, 2, "#8f9b84", "#566049");
        for (let i = 0; i < 2; i++) { const y = -4.6 + i * 9.2; rect(g, -9, y - 1.8, 25, 3.6, "#dfe3ea"); rect(g, -9, y - 1.8, 25, 1, "rgba(255,255,255,.5)"); poly(g, [[16, y - 1.8], [21.5, y], [16, y + 1.8]], "#c9453a"); rect(g, -4, y - 2, 1.6, 4, "#8a93a1"); } circ(g, -10, 0, 2.6, "#262b25"); break;
      case "aa": tracks(g, 16, 9); hull(g, 16, 9, col); circ(g, 0, 0, 8.4, "#566049", "#1d231f"); circ(g, -1.5, -1.5, 5.4, "#7e8a73"); rect(g, 4, -5.4, 19, 2.5, DARK); rect(g, 4, 2.9, 19, 2.5, DARK); rect(g, 20.5, -6, 3.2, 3.6, STEEL); rect(g, 20.5, 2.4, 3.2, 3.6, STEEL); rect(g, -6, -3, 5, 6, "#3a413a"); circ(g, -3, 0, 1.4, col); break;
      case "bl": tracks(g, 19, 9.5); hull(g, 19, 9.5, col); shade(g, -16, -5.4, 34, 10.8, 1, "#b8a074", "#85703f"); for (let x = -14; x < 17; x += 4) line(g, x, -5.4, x, 5.4, "#5c4d2c", 1); rect(g, -16, -5.4, 34, 1.4, "rgba(255,255,255,.2)"); shade(g, 15, -6.6, 6.4, 13.2, 1.5, "#7d8694", "#566049"); line(g, -16, -5.4, -16, 5.4, "#3c3320", 1.4); break;
      case "heli": g.save(); rr(g, -12, -4.6, 21, 9.2, 4.6); g.fillStyle = hg(g, -12, 9, "#6e7a62", "#46503f"); g.fill(); g.strokeStyle = "#20261f"; g.stroke(); circ(g, 5, 0, 3.6, "#a9dcf6"); circ(g, 4, -1, 1.4, "rgba(255,255,255,.7)");
        rect(g, -23, -1, 12, 2, MID); rect(g, -24, -4.2, 2.2, 8.4, MID); rect(g, -12, -7, 3, 1.8, "#363d36"); rect(g, -12, 5.2, 3, 1.8, "#363d36"); circ(g, -1, 0, 2.4, col); g.restore(); rotor(g, 17, 2, sp, .26); break;
      case "ah": g.save(); rr(g, -12, -3.6, 25, 7.2, 3.6); g.fillStyle = hg(g, -12, 13, "#6a7660", "#3f4a3a"); g.fill(); g.strokeStyle = "#20261f"; g.stroke(); rr(g, 2, -2.4, 9, 4.8, 2.4); g.fillStyle = "#9fd3f2"; g.fill();
        rect(g, -24, -1, 13, 2, MID); rect(g, -3, -12.5, 6, 25, "#566049"); rect(g, -1, -12.5, 4.4, 3.4, DARK); rect(g, -1, 9.2, 4.4, 3.4, DARK); circ(g, -1, 0, 2.2, col); g.restore(); rotor(g, 16, 2, sp, .24); break;
      case "th": g.save(); rr(g, -14, -6.2, 29, 12.4, 6.2); g.fillStyle = hg(g, -14, 15, "#76826a", "#46503f"); g.fill(); g.strokeStyle = "#20261f"; g.stroke(); circ(g, 11, 0, 3.8, "#a9dcf6"); rect(g, -21, -1.3, 8, 2.6, MID); circ(g, 0, 0, 2.4, col); g.restore();
        g.save(); g.translate(9, 0); rotor(g, 11.5, 2, sp, .22); g.restore(); g.save(); g.translate(-9, 0); rotor(g, 11.5, 2, -sp, .22); g.restore(); break;
      case "jet": poly(g, [[22, 0], [-6, -17], [-14, -17], [-8, -2], [-14, 0], [-8, 2], [-14, 17], [-6, 17]], "#7e8a73", "#20261f"); shade(g, -14, -2.6, 31, 5.2, 2.6, "#9aa68e", "#566049"); circ(g, 8, 0, 2.7, "#a9dcf6"); rect(g, -14, -1.2, 3, 2.4, col); poly(g, [[-14, -1.6], [-19, 0], [-14, 1.6]], "#ff9a3c"); break;
      case "intr": poly(g, [[22, 0], [-4, -19], [-9, -19], [-3, -2], [-12, -9], [-15, -9], [-11, 0], [-15, 9], [-12, 9], [-3, 2], [-9, 19], [-4, 19]], "#7e8a73", "#20261f"); shade(g, -14, -2.6, 33, 5.2, 2.6, "#9aa68e", "#566049"); circ(g, 9, 0, 2.7, "#a9dcf6"); rect(g, -14, -4.6, 6, 2, DARK); rect(g, -14, 2.6, 6, 2, DARK); rect(g, -14, -1, 3, 2, col); poly(g, [[-14, -2], [-20, 0], [-14, 2]], "#ff9a3c"); break;
      case "sb": g.fillStyle = hg(g, -20, 20, "#7a8670", "#4a553f"); rr(g, -21, -3.6, 42, 7.2, 3.6); g.fill(); g.strokeStyle = "#20261f"; g.stroke(); poly(g, [[4, -3], [-6, -22], [-12, -22], [-9, -3]], "#6c7862", "#20261f"); poly(g, [[4, 3], [-6, 22], [-12, 22], [-9, 3]], "#6c7862", "#20261f");
        poly(g, [[-16, -3], [-21, -10], [-23, -10], [-21, -3]], "#6c7862"); poly(g, [[-16, 3], [-21, 10], [-23, 10], [-21, 3]], "#6c7862"); [[-2, -12], [-5, -17], [-2, 12], [-5, 17]].forEach(([x, y]) => { circ(g, x, y, 2.4, "#2a312d"); circ(g, x, y, 1, "#9aa3b2"); }); circ(g, 14, 0, 2.5, "#a9dcf6"); rect(g, -18, -1, 3, 2, col); break;
      case "td": poly(g, [[16, 0], [-9, -11], [-12, -11], [-8, 0], [-12, 11], [-9, 11]], "#7e8a73", "#20261f"); circ(g, 8, 0, 2.4, "#1f2226"); circ(g, 8, 0, 1.1, "#a9dcf6"); rect(g, -9, -1, 4, 2, col); poly(g, [[-12, -1.2], [-16, 0], [-12, 1.2]], "#ff9a3c"); break;
      case "drone": rect(g, -3.4, -3.4, 6.8, 6.8, "#46503f"); [[-9, -9], [9, -9], [-9, 9], [9, 9]].forEach(([x, y], i) => { line(g, 0, 0, x, y, "#2a312d", 1.5); g.save(); g.translate(x, y); rotor(g, 5.4, 2, sp * 1.6 + i, .3); g.restore(); }); circ(g, 0, 0, 2, col); circ(g, 2, 0, 1, "#a9dcf6"); break;
      case "uav": shade(g, -9, -2.2, 23, 4.4, 2.2, "#aeb6c2", "#7c8594"); rect(g, -2, -20, 5.4, 40, "#9aa3b2"); rect(g, -2, -20, 5.4, 1.4, "rgba(255,255,255,.4)"); poly(g, [[-9, 0], [-14, -6], [-11, -6], [-6, 0]], "#8a93a1"); poly(g, [[-9, 0], [-14, 6], [-11, 6], [-6, 0]], "#8a93a1"); circ(g, 12, 0, 2.2, "#1f2226"); rect(g, -8, -1, 3, 2, col); break;
      case "cor": poly(g, [[22, 0], [14, -6], [-16, -6], [-18, -4], [-18, 4], [-16, 6], [14, 6]], "#8a94a1", "#2d343d"); poly(g, [[22, 0], [14, -6], [14, 6]], "#9aa3b0"); rect(g, -8, -4, 10, 8, "#b9c0ca"); rect(g, -8, -4, 10, 1.4, "#e1e5ea"); circ(g, 9, 0, 3, STEEL, "#2d343d"); rect(g, 9, -.9, 8, 1.8, DARK); rect(g, -16, -1, 3, 2, col); line(g, -2, 0, -2, -7, DARK, 1); break;
      case "fr": poly(g, [[24, 0], [15, -6.5], [-18, -6.5], [-20, -4], [-20, 4], [-18, 6.5], [15, 6.5]], "#8a94a1", "#2d343d"); poly(g, [[24, 0], [15, -6.5], [15, 6.5]], "#9aa3b0"); rect(g, -8, -4.6, 12, 9.2, "#b9c0ca"); line(g, -2, 0, -2, -9, DARK, 1.2); circ(g, -2, -9, 2, col);
        for (let i = 0; i < 3; i++) { rect(g, 8 + i * 3.4, -3, 2.6, 6, "#4a525d"); rect(g, 8.6 + i * 3.4, -2, 1.4, 1.4, "#c9453a"); } circ(g, -12, 0, 2.2, "#c9ced8"); rect(g, -18, -1, 3, 2, col); break;
      case "dd": poly(g, [[26, 0], [17, -6.5], [-20, -6.5], [-22, -4], [-22, 4], [-20, 6.5], [17, 6.5]], "#8a94a1", "#2d343d"); poly(g, [[26, 0], [17, -6.5], [17, 6.5]], "#9aa3b0"); rect(g, -6, -4.6, 11, 9.2, "#b9c0ca"); rect(g, -13, -3, 5, 6, "#5a626e");
        circ(g, 13, 0, 3.4, STEEL, "#2d343d"); rect(g, 13, -.9, 9, 1.8, DARK); circ(g, -17, 0, 2.8, STEEL, "#2d343d"); rect(g, -24, -.9, 7, 1.8, DARK); rect(g, -20, -1, 3, 2, col); rect(g, -1, -6, 2, 12, "rgba(0,0,0,.18)"); break;
      case "ca": poly(g, [[28, 0], [19, -8], [-21, -8], [-24, -5], [-24, 5], [-21, 8], [19, 8]], "#8a94a1", "#2d343d"); poly(g, [[28, 0], [19, -8], [19, 8]], "#9aa3b0"); rect(g, -6, -5.6, 13, 11.2, "#b9c0ca"); rect(g, -4, -3.6, 5, 7.2, "#8f97a4"); line(g, -1, 0, -1, -10, DARK, 1.4);
        [16, 9, -14].forEach(x => { circ(g, x, 0, 3.8, STEEL, "#2d343d"); rect(g, x, -2.1, 9, 1.7, DARK); rect(g, x, .4, 9, 1.7, DARK); }); rect(g, -22, -1, 3, 2, col); break;
      case "sub": shade(g, -22, -5, 44, 10, 5, "#4a5463", "#2b323d"); rect(g, -20, -4, 38, 1.3, "rgba(255,255,255,.15)"); shade(g, -4, -3.4, 11, 6.8, 3, "#66707e", "#434c59"); line(g, 3, 0, 3, -9, DARK, 1.2); circ(g, 3, -9, 1.2, "#aab2bd"); rect(g, -20, -1, 3, 2, col); poly(g, [[-22, 0], [-27, -4.4], [-27, 4.4]], "#2b323d"); break;
      case "ls": poly(g, [[22, -9], [26, -5], [26, 5], [22, 9], [-20, 9], [-22, 7], [-22, -7], [-20, -9]], "#8a94a1", "#2d343d"); shade(g, -16, -6, 28, 12, 1, "#667080", "#4a5361"); rect(g, -14, -4, 10, 8, "#9a8456"); rect(g, -14, -4, 10, 1.2, "#bba66f"); rect(g, -2, -4, 10, 8, "#6c7c56"); rect(g, 12, -7, 9, 14, "#a4acb8"); rect(g, 12, -7, 1.6, 14, "#7d8694"); rect(g, -20, -1, 3, 2, col); rect(g, -16, -8, 8, 2.4, DARK); break;
      default: shade(g, -12, -9, 24, 18, 4, BODY[0], BODY[1]); rect(g, -8, -2, 8, 4, col);
    }
  }
  const WAKE_LEN = { cor: .8, fr: .85, dd: .9, ca: 1, sub: .7, ls: .9 };
  G.Placeholders2D = { structure, unit: drawUnit, WAKE_LEN };
})(window.GFX = window.GFX || {});
