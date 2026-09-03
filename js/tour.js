/**
 * tour.js — the only file that talks to Marzipano.
 *
 * It turns normalised scene config (see config.js) into Marzipano scenes and
 * exposes a small, UI-agnostic surface: switchTo, currentView, onViewChange,
 * onLoadingChange. It knows nothing about hotspots' appearance, modals or
 * the DOM chrome — hotspot DOM elements are handed in from the outside.
 *
 * Marzipano APIs used here were verified against marzipano 0.10.2:
 *   Marzipano.Viewer, .EquirectGeometry, .CubeGeometry, .ImageUrlSource,
 *   .RectilinearView(.limit.traditional), .autorotate
 *   viewer.createScene / .stage() / .setIdleMovement / .breakIdleMovement
 *   scene.switchTo / .view() / .hotspotContainer().createHotspot
 */

const Marzipano = window.Marzipano;

/** Marzipano wants field-of-view limits in radians; the limiter also caps resolution. */
const MAX_RESOLUTION = 4096;

/**
 * Builds the Marzipano source + geometry pair for a scene's panorama block.
 * Supports both panorama types so the same tour can mix them during a
 * migration from equirectangular previews to production tiles.
 */
function createSourceAndGeometry(panorama) {
  if (panorama.type === 'multires') {
    const urlTemplate = `${panorama.path}/{z}/{f}/{y}/{x}.${panorama.extension}`;
    const sourceOpts = {};
    if (panorama.preview) {
      sourceOpts.cubeMapPreviewUrl = `${panorama.path}/preview.${panorama.extension}`;
    }
    const source = Marzipano.ImageUrlSource.fromString(urlTemplate, sourceOpts);
    const geometry = new Marzipano.CubeGeometry(buildCubeLevels(panorama));
    return { source, geometry };
  }

  // Equirectangular: one image per level, {z} selects the level (0 = smallest).
  const source = Marzipano.ImageUrlSource.fromString(panorama.url);
  const geometry = new Marzipano.EquirectGeometry(panorama.levels);
  return { source, geometry };
}

/**
 * Produces the level list for a cube geometry. If tour.json supplied explicit
 * levels we use them verbatim; otherwise we derive the usual pyramid, doubling
 * from tileSize up to faceSize with the smallest level marked fallbackOnly
 * (that is the convention the Marzipano tile tool emits).
 */
function buildCubeLevels(panorama) {
  if (panorama.levels) return panorama.levels;

  const levels = [];
  for (let size = panorama.tileSize; size <= panorama.faceSize; size *= 2) {
    levels.push({
      tileSize: panorama.tileSize,
      size: size,
      fallbackOnly: size === panorama.tileSize && panorama.faceSize > panorama.tileSize
    });
  }
  if (!levels.length) {
    levels.push({ tileSize: panorama.tileSize, size: panorama.faceSize });
  }
  return levels;
}

function createView(scene, settings) {
  const limiter = Marzipano.RectilinearView.limit.traditional(
    MAX_RESOLUTION,
    settings.maxFov,          // max vertical fov
    settings.maxFov           // max horizontal fov
  );
  const view = new Marzipano.RectilinearView(
    {
      yaw: scene.initialView.yaw,
      pitch: scene.initialView.pitch,
      fov: scene.initialView.fov
    },
    limiter
  );
  return view;
}

export class Tour {
  /**
   * @param {HTMLElement} element  container the viewer renders into
   * @param {{settings: object, scenes: Array, sceneById: Map}} config
   */
  constructor(element, config) {
    this.config = config;
    this.settings = config.settings;

    this.viewer = new Marzipano.Viewer(element, {
      controls: { mouseViewMode: 'drag' }
    });

    /** @type {Map<string, {sceneConfig: object, marzipanoScene: object}>} */
    this._scenes = new Map();
    this._currentId = null;
    this._viewChangeHandlers = [];
    this._loadingHandlers = [];
    this._sceneChangeHandlers = [];
    this._loading = false;

    this._autorotate = this.settings.autorotate
      ? Marzipano.autorotate({ yawSpeed: 0.03, targetPitch: 0, targetFov: Math.PI / 2 })
      : null;

    // A single viewChange listener on the viewer covers every scene, so no
    // per-scene listeners accumulate as the user navigates.
    this.viewer.addEventListener('viewChange', () => {
      const view = this.currentView();
      if (view) this._viewChangeHandlers.forEach((fn) => fn(view));
    });

    // Marzipano's stage reports whether everything visible finished loading.
    this.viewer.stage().addEventListener('renderComplete', (allLoaded) => {
      this._setLoading(!allLoaded);
    });
  }

  /** Lazily creates (and caches) the Marzipano scene for a config id. */
  _ensureScene(id) {
    if (this._scenes.has(id)) return this._scenes.get(id);

    const sceneConfig = this.config.sceneById.get(id);
    if (!sceneConfig) return null;

    let entry;
    try {
      const { source, geometry } = createSourceAndGeometry(sceneConfig.panorama);
      const view = createView(sceneConfig, this.settings);
      const marzipanoScene = this.viewer.createScene({
        source,
        geometry,
        view,
        pinFirstLevel: true   // keep the low-res level resident: no blank tiles
      });
      entry = { sceneConfig, marzipanoScene };
    } catch (err) {
      console.error(`[tour] Could not build scene "${id}":`, err);
      return null;
    }

    this._scenes.set(id, entry);
    return entry;
  }

  /**
   * Switches to a scene.
   * @param {string} id
   * @param {{view?: object, immediate?: boolean}} [options]
   * @returns {boolean} false when the scene does not exist
   */
  switchTo(id, options = {}) {
    const entry = this._ensureScene(id);
    if (!entry) {
      console.warn(`[tour] switchTo("${id}") — no such scene.`);
      return false;
    }
    if (this._currentId === id && !options.view) return true;

    // Adopt an arriving camera direction before the transition so the user
    // lands facing the right way rather than snapping afterwards.
    const targetView = options.view || null;
    const view = entry.marzipanoScene.view();
    if (targetView) {
      const params = {
        yaw: targetView.yaw != null ? targetView.yaw : view.yaw(),
        pitch: targetView.pitch != null ? targetView.pitch : view.pitch(),
        fov: targetView.fov != null ? targetView.fov : view.fov()
      };
      view.setParameters(params);
    }

    this._setLoading(true);
    entry.marzipanoScene.switchTo({
      transitionDuration: options.immediate ? 0 : this.settings.transitionDurationMs
    });
    this._currentId = id;

    if (this._autorotate) {
      this.viewer.setIdleMovement(this.settings.autorotateIdleDelayMs, this._autorotate);
    }

    this._sceneChangeHandlers.forEach((fn) => fn(entry.sceneConfig));
    return true;
  }

  /** Restores a scene's configured initialView (used by the editor's reset). */
  resetView(id = this._currentId) {
    const entry = this._scenes.get(id);
    if (!entry) return;
    entry.marzipanoScene.view().setParameters(entry.sceneConfig.initialView);
  }

  /**
   * Adds a hotspot element to a scene.
   * @param {string} sceneId
   * @param {HTMLElement} element
   * @param {{yaw: number, pitch: number}} position
   * @param {object} [perspective] optional {radius, extraTransforms}
   */
  addHotspot(sceneId, element, position, perspective) {
    const entry = this._ensureScene(sceneId);
    if (!entry) return null;

    // Marzipano writes `transform: translateX(..) translateY(..) translateZ(0)
    // <extraTransforms>` onto the element, putting its TOP-LEFT corner on the
    // coordinate. extraTransforms is the supported hook for re-centring it, and
    // is honoured on both the flat and the perspective code paths.
    const opts = {
      perspective: Object.assign(
        { extraTransforms: 'translate(-50%, -50%)' },
        perspective || {}
      )
    };
    return entry.marzipanoScene.hotspotContainer()
      .createHotspot(element, { yaw: position.yaw, pitch: position.pitch }, opts);
  }

  /** Current camera parameters, or null before the first scene loads. */
  currentView() {
    const entry = this._scenes.get(this._currentId);
    if (!entry) return null;
    const view = entry.marzipanoScene.view();
    return { yaw: view.yaw(), pitch: view.pitch(), fov: view.fov() };
  }

  /**
   * Converts a point in viewer-element coordinates to panorama yaw/pitch.
   * Used by the editor to turn a click into hotspot coordinates.
   */
  screenToCoordinates(x, y) {
    const entry = this._scenes.get(this._currentId);
    if (!entry) return null;
    return entry.marzipanoScene.view().screenToCoordinates({ x, y });
  }

  currentSceneId() {
    return this._currentId;
  }

  currentSceneConfig() {
    const entry = this._scenes.get(this._currentId);
    return entry ? entry.sceneConfig : null;
  }

  /** Stops any idle autorotate — called when a modal opens. */
  pauseMovement() {
    this.viewer.stopMovement();
    if (this._autorotate) this.viewer.setIdleMovement(Infinity, null);
  }

  /** Restores idle autorotate after a modal closes. */
  resumeMovement() {
    if (this._autorotate) {
      this.viewer.setIdleMovement(this.settings.autorotateIdleDelayMs, this._autorotate);
    }
  }

  /** Enables/disables drag + zoom controls (used while a modal is open). */
  setControlsEnabled(enabled) {
    const controls = this.viewer.controls();
    if (enabled) controls.enable(); else controls.disable();
  }

  onViewChange(fn) { this._viewChangeHandlers.push(fn); }
  onSceneChange(fn) { this._sceneChangeHandlers.push(fn); }
  onLoadingChange(fn) { this._loadingHandlers.push(fn); }

  _setLoading(isLoading) {
    if (this._loading === isLoading) return;
    this._loading = isLoading;
    this._loadingHandlers.forEach((fn) => fn(isLoading));
  }
}
