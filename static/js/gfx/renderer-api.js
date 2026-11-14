/* IRON GRID graphics - the common renderer interface, registry, shared camera rules and manager.
 *
 * The server is the only source of truth. A renderer is handed (a) the board (width, height, terrain),
 * (b) the latest fog-filtered game state and (c) a per-frame snapshot of purely visual UI state
 * (selection, hover, cursor, floating texts, the animation in flight). It draws; it never decides.
 *
 * Board coordinates (x = column 0..W-1, y = row 0..H-1, A1 top-left) are the single coordinate system.
 * Every renderer must convert screen <-> tile exactly through screenToTile()/tileToScreen().
 */
(function (G) {
  "use strict";

  /** URL of /static/ and a lazy script loader: a mode's code is only fetched when that mode is chosen. */
  G.GFX_BASE = document.currentScript ? document.currentScript.src.replace(/js\/gfx\/[^/?]*(\?.*)?$/, "") : "/static/";
  const _scripts = new Map();
  G.loadScripts = names => Promise.all(names.map(n => {
    if (!_scripts.has(n)) _scripts.set(n, new Promise((res, rej) => {
      const s = document.createElement("script"); s.src = G.GFX_BASE + "js/gfx/" + n; s.onload = res;
      s.onerror = () => { _scripts.delete(n); rej(new Error("could not load " + n)); };
      document.head.appendChild(s);
    }));
    return _scripts.get(n);
  }));

  /** Camera and interaction rules shared by ALL display modes. */
  G.CAMERA = Object.freeze({
    ZOOM_MIN: 0.2, ZOOM_MAX: 3, FIT_MIN: 0.2, FIT_MAX: 3,
    WHEEL_IN: 1.12, WHEEL_OUT: 0.9, KEY_IN: 1.25, KEY_OUT: 0.8,
    DRAG_PX: 6, CLICK_DELAY: 280,
  });

  /** Methods every renderer (Classic, 2D, 2.5D, 3D) must implement. */
  G.REQUIRED_METHODS = Object.freeze([
    "init", "dispose", "setBoard", "setState", "renderFrame", "needsFrame", "resize",
    "getCamera", "setCamera", "zoomBy", "zoomFit", "zoomReset", "panBy", "setPrefs",
    "tileToScreen", "unitScreenPos", "screenToTile", "exportImage",
  ]);
  G.verifyRenderer = r => G.REQUIRED_METHODS.filter(m => typeof r[m] !== "function")
    .concat(r.element ? [] : ["element"]);

  /** Base class: lifecycle bookkeeping so that dispose() can never leak listeners, loops or GPU objects. */
  class Renderer {
    constructor(id) { this.id = id; this._undo = []; this.disposed = true; this.host = null; this.prefs = {}; }
    get capabilities() { return { rotation: false }; }       // 3D may switch rotation on (optional)
    get element() { return null; }
    /** Register a DOM listener that dispose() removes. */
    _listen(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      this._undo.push(() => target.removeEventListener(type, fn, opts));
    }
    /** Register anything with a dispose() (textures, geometries, WebGL renderers...). */
    _track(obj) { if (obj && typeof obj.dispose === "function") this._undo.push(() => obj.dispose()); return obj; }
    /** Own a requestAnimationFrame loop that dispose() cancels. Returns a stop function. */
    _loop(fn) {
      let id = 0, on = true;
      const tick = t => { if (!on) return; fn(t); id = requestAnimationFrame(tick); };
      id = requestAnimationFrame(tick);
      const stop = () => { on = false; cancelAnimationFrame(id); };
      this._undo.push(stop);
      return stop;
    }
    _onDispose(fn) { this._undo.push(fn); }
    init(host) { this.host = host; this.disposed = false; return this; }
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      while (this._undo.length) { try { this._undo.pop()(); } catch (e) { /* keep releasing the rest */ } }
      this.host = null;
    }
    // ---- contract (documented in docs/GRAPHICS_PLAN.md); subclasses implement all of these ----
    setBoard(board) { throw new Error("setBoard not implemented"); }          // {w, h, terrain}
    setState(prev, next, events) { /* optional bookkeeping */ }
    playEvent(e) { /* optional: visual effects for one fog-safe game event (already sanitised) */ }
    renderFrame(frame) { throw new Error("renderFrame not implemented"); }
    needsFrame(frame) { return !!frame.dirty; }
    resize() {}
    getCamera() { return { zoom: 1, panX: 0, panY: 0, rotation: 0 }; }
    setCamera(cam) {}
    zoomBy(f) {} zoomFit() {} zoomReset() {} panBy(dx, dy) {}
    setPrefs(prefs) { this.prefs = Object.assign({}, prefs); }
    tileToScreen(x, y) { return null; }        // {x, y, w, h, cx, cy} in viewport (client) pixels
    unitScreenPos(id) { return null; }         // {x, y} viewport pixels of a unit's centre, or null
    screenToTile(cx, cy) { return null; }      // {x, y} board tile under a viewport point, or null
    exportImage(frame, opts) { return Promise.reject(new Error("export not supported")); }
  }
  G.Renderer = Renderer;

  // ---- registry ------------------------------------------------------------------------------
  G.MODES = [];
  G.registerRenderer = (id, def) => { G.MODES = G.MODES.filter(m => m.id !== id).concat([Object.assign({ id }, def)]); };
  G.modeInfo = id => G.MODES.find(m => m.id === id);

  /** Shared pointer / wheel behaviour, identical in every mode. Attached per renderer, detached on switch. */
  class InputController {
    constructor(renderer, handlers) {
      this.r = renderer; this.h = handlers; this.panning = null; this.panned = false;
      this._clickTimer = 0; this._pendingTile = null; this._centerAfterDouble = false; this._undo = [];
      const el = renderer.element, on = (t, ty, fn, o) => { t.addEventListener(ty, fn, o); this._undo.push(() => t.removeEventListener(ty, fn, o)); };
      const dispatchTile = tile => {
        handlers.onClickStart && handlers.onClickStart();
        if (tile) handlers.onTile(tile.x, tile.y);
      };
      const flushPending = () => {
        clearTimeout(this._clickTimer);
        this._clickTimer = 0;
        const tile = this._pendingTile;
        this._pendingTile = null;
        dispatchTile(tile);
      };
      on(el, "pointerdown", e => {
        if (e.button !== 0) return;
        const c = renderer.getCamera();
        this.panning = { x: e.clientX, y: e.clientY, px: c.panX, py: c.panY, rot: c.rotation, rotate: !!(e.altKey && renderer.capabilities.rotation) };
        this.panned = false;
        if (el.setPointerCapture) el.setPointerCapture(e.pointerId);
      });
      on(window, "pointermove", e => {
        if (!this.panning) return;
        const dx = e.clientX - this.panning.x, dy = e.clientY - this.panning.y;
        if (Math.abs(dx) + Math.abs(dy) > G.CAMERA.DRAG_PX) this.panned = true;
        if (this.panning.rotate) renderer.setCamera({ rotation: this.panning.rot + dx * 0.4 });   // optional 3D rotation
        else renderer.setCamera({ panX: this.panning.px - dx, panY: this.panning.py - dy });
      });
      on(window, "pointerup", () => { this.panning = null; });
      on(window, "pointercancel", () => { this.panning = null; });
      on(el, "wheel", e => {       e.preventDefault();
        const anchor = renderer.prefs.zoomToCursor === false ? null : { x: e.clientX, y: e.clientY };
        renderer.zoomBy(e.deltaY < 0 ? G.CAMERA.WHEEL_IN : G.CAMERA.WHEEL_OUT, anchor);
        handlers.onZoom && handlers.onZoom(renderer.getCamera());
      }, { passive: false });
      on(el, "contextmenu", e => { e.preventDefault(); handlers.onContext && handlers.onContext(e); });
      on(el, "click", e => {
        if (this.panned) { this.panned = false; return; }
        const t = renderer.screenToTile(e.clientX, e.clientY);
        if (renderer.prefs.doubleClickCenter !== false) {
          if (e.detail > 1 && this._pendingTile && t
              && this._pendingTile.x === t.x && this._pendingTile.y === t.y) {
            clearTimeout(this._clickTimer);
            this._clickTimer = 0;
            this._pendingTile = null;
            this._centerAfterDouble = true;
            return;
          }
          if (this._pendingTile) flushPending();
          this._pendingTile = t;
          clearTimeout(this._clickTimer);
          this._clickTimer = setTimeout(() => {
            this._clickTimer = 0;
            const tile = this._pendingTile;
            this._pendingTile = null;
            dispatchTile(tile);
          }, G.CAMERA.CLICK_DELAY);
          return;
        }
        handlers.onClickStart && handlers.onClickStart(e);
        if (t) handlers.onTile(t.x, t.y);
      });
      on(el, "dblclick", e => {
        e.preventDefault();
        if (!this._centerAfterDouble) return;
        this._centerAfterDouble = false;
        const t = renderer.screenToTile(e.clientX, e.clientY);
        if (t) handlers.onDoubleClick && handlers.onDoubleClick(t.x, t.y);
      });
      on(el, "mousemove", e => handlers.onHover(renderer.screenToTile(e.clientX, e.clientY), e));
      on(el, "mouseleave", () => handlers.onHover(null));
      on(renderer.box, "scroll", () => {
        if (G.manager) G.manager.markDirty();
        handlers.onCameraChange && handlers.onCameraChange();
      }, { passive: true });
    }
    detach() {
      while (this._undo.length) this._undo.pop()();
      clearTimeout(this._clickTimer);
      this._clickTimer = 0; this._pendingTile = null; this._centerAfterDouble = false; this.panning = null;
    }
  }
  G.InputController = InputController;

  /** Owns the active renderer, its input controller and the single frame loop. */
  class RenderManager {
    constructor(host) {
      this.host = host; this.r = null; this.mode = null; this.input = null;
      this.dirty = true; this._raf = 0; this._gen = 0; this._running = false;
    }
    get current() { return this.r; }
    markDirty() { this.dirty = true; }
    start() {
      if (this._running) return; this._running = true;
      const tick = () => {
        if (!this._running) return;
        const r = this.r, f = r && this.host.frameData();
        if (r && f && (this.dirty || r.needsFrame(f))) {
          this.dirty = false;                  // clear first: a throw can never wedge the loop
          try { r.renderFrame(f); } catch (e) { /* one bad frame must not freeze the board */ }
          if (this.host.afterFrame) this.host.afterFrame();
        }
        this._raf = requestAnimationFrame(tick);
      };
      this._raf = requestAnimationFrame(tick);
    }
    stop() { this._running = false; cancelAnimationFrame(this._raf); }
    /** Switch display mode without touching the game. Unavailable modes fall back to Classic. */
    async use(mode) {
      const gen = ++this._gen;
      let info = G.modeInfo(mode);
      let fellBack = false;
      if (!info || !info.available) { info = G.modeInfo("classic"); mode = "classic"; fellBack = true; }
      const next = await info.create();
      await next.init(this.host);
      if (gen !== this._gen) { next.dispose(); return { mode: this.mode, fellBack }; }     // a newer switch won
      const old = this.r, cam = old ? old.getCamera() : null;
      if (this.input) { this.input.detach(); this.input = null; }
      if (old) old.dispose();
      this.r = next; this.mode = mode;
      this.host.onRendererReady(next, cam);
      this.input = new InputController(next, this.host.handlers);
      this.markDirty();
      return { mode, fellBack };
    }
    dispose() {
      this.stop(); this._gen++;
      if (this.input) this.input.detach();
      if (this.r) this.r.dispose();
      this.r = null; this.input = null;
    }
  }
  G.RenderManager = RenderManager;
})(window.GFX = window.GFX || {});
