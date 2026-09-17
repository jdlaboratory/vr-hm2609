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
 * The walk-through transition, in one place.
 *
 * Moving forward makes what is ahead of you grow, so the whole move is one
 * continuous narrowing of the field of view: the scene you are leaving turns
 * toward the way out and pushes into it, and the scene you arrive in fades in
 * a step wider than its resting view and settles down to it. Narrowing right
 * across the cut is what reads as walking rather than as the picture changing.
 */
const WALK = {
  // The room you are leaving holds for fadeDelayMs — long enough to see the
  // step begin — and then the two rooms cross, finishing together with the
  // step at leadMs. Starting the fade at once made it feel snatched away;
  // holding it for the whole step made the tour feel stuck in the old room.
  leadMs: 1150,      // the step: turning toward the exit and pushing into it
  fadeDelayMs: 450,  // how long before the two rooms start crossing
  push: 0.62,        // the fov the outgoing view pushes in to, as a fraction
  standBack: 1.28,   // how much wider than its resting view the new scene opens
  settleMs: 2200     // the whole move, measured from the click
};

/**
 * The two halves of the move share one motion: you start from a standstill and
 * are still going at the cut, then carry that speed into the new room and come
 * to rest there. Marzipano's default easing slows down at the end of *each*
 * half, which puts a stall right in the middle of the move.
 */
const EASE = {
  intoTheDoorway: (t) => t * t,
  outIntoTheRoom: (t) => 1 - (1 - t) * (1 - t)
};

/** Respected for the walk, as it is for every CSS animation in this build. */
function prefersReducedMotion() {
  return typeof window.matchMedia === 'function' &&
         window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

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
    this.element = element;

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
    /** True while a walk-through transition is running; a second click waits. */
    this._walking = false;

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
    // The walk sets its own fade length so the cross-fade and the step end
    // together; everything else uses the configured one.
    const fade = options.transitionDurationMs != null
      ? options.transitionDurationMs
      : this.settings.transitionDurationMs;
    entry.marzipanoScene.switchTo({ transitionDuration: options.immediate ? 0 : fade });
    this._currentId = id;

    if (this._autorotate) {
      this.viewer.setIdleMovement(this.settings.autorotateIdleDelayMs, this._autorotate);
    }

    this._sceneChangeHandlers.forEach((fn) => fn(entry.sceneConfig));
    return true;
  }

  /**
   * Drops a scene from the viewer entirely: used by the editor when a scene is
   * deleted, so that re-adding the same id later builds a fresh one instead of
   * reviving the cached panorama.
   * @param {string} id
   */
  /**
   * Walks to another scene instead of cutting to it — see WALK above.
   *
   * `options.from` is the direction of the arrow that was clicked, so the
   * camera turns to face the doorway before moving into it. Without one (the
   * ☰ list, a pin on the plan, a link) it pushes straight ahead. Anything that
   * would make the effect wrong or unwanted — the first scene, a repeat click
   * mid-walk, reduced motion, the setting turned off — falls back to the plain
   * cross-fade, so callers never have to decide.
   */
  walkTo(id, options = {}) {
    const arriving = this._ensureScene(id);
    if (!arriving) {
      console.warn(`[tour] walkTo("${id}") — no such scene.`);
      return false;
    }
    // A click while the camera is still turning toward the door is a double
    // click, or impatience with a destination already chosen: let the walk
    // finish rather than cutting away from it — and say the navigation was
    // handled, so the caller does not report a failure. The flag is dropped
    // the moment the new scene appears, so an arrow in the room you have just
    // walked into works immediately, while it is still settling.
    if (this._walking) return true;

    const leaving = this._scenes.get(this._currentId);
    if (!this.settings.walkTransition || !leaving ||
        this._currentId === id || options.immediate || prefersReducedMotion()) {
      return this.switchTo(id, options);
    }

    this._walking = true;
    // Marzipano stops the drag controls for the length of the turn; this stops
    // the arrows with them, so a click that would be ignored does not look
    // like one that was missed.
    this.element.classList.add('is-walking');

    // Marzipano calls back when the movement ends. If it never does — a scene
    // torn down mid-walk, a tab hidden at the wrong moment — this keeps the
    // flag from stranding every later navigation.
    let crossing = null;
    const watchdog = window.setTimeout(() => {
      window.clearTimeout(crossing);
      this._walking = false;
      this.element.classList.remove('is-walking');
    }, WALK.leadMs + 2000);

    const view = leaving.marzipanoScene.view();
    // Where the visitor was looking before the walk turned the camera, so
    // coming back later shows the room as they left it rather than the door.
    const before = { yaw: view.yaw(), pitch: view.pitch(), fov: view.fov() };

    const step = { fov: Math.max(before.fov * WALK.push, this.settings.minFov) };
    if (options.from) {
      step.yaw = options.from.yaw;
      step.pitch = options.from.pitch;
    }

    const resting = this._restingView(arriving, options.view);

    // The step starts at once; the crossing starts part-way into it. Both rooms
    // move while they cross — Marzipano steps a movement from the render loop,
    // so the one being left carries on turning and pushing in even though it is
    // no longer the viewer's current scene.
    crossing = window.setTimeout(() => {
      arriving.marzipanoScene.view().setParameters({
        yaw: resting.yaw,
        pitch: resting.pitch,
        fov: Math.min(resting.fov * WALK.standBack, this.settings.maxFov)
      });
      // The view is already set, so switchTo is not asked to set it again. The
      // fade lasts the rest of the step, so the two end together.
      this.switchTo(id, { transitionDurationMs: WALK.leadMs - WALK.fadeDelayMs });

      // Started after the switch, not before: Marzipano stops whatever movement
      // the scene it switches to already has.
      arriving.marzipanoScene.lookTo({ fov: resting.fov }, {
        transitionDuration: WALK.settleMs - WALK.fadeDelayMs,
        ease: EASE.outIntoTheRoom,
        controlsInterrupt: true
      });
    }, WALK.fadeDelayMs);

    leaving.marzipanoScene.lookTo(step, {
      transitionDuration: WALK.leadMs,
      ease: EASE.intoTheDoorway
    }, () => {
      window.clearTimeout(watchdog);
      this._walking = false;
      this.element.classList.remove('is-walking');
      view.setParameters(before);

      // Marzipano stops whatever movement a scene has when it is switched to,
      // and the hand-off at the end of the step can stop one too. Re-issuing
      // the settle here means the arrival always finishes, however far the
      // first half of it got.
      // controlsInterrupt keeps the drag controls alive through the settle: it
      // is a second long, and a tour that ignores the pointer for that long
      // feels broken. Dragging simply takes over from the movement.
      arriving.marzipanoScene.lookTo({ fov: resting.fov }, {
        transitionDuration: Math.max(WALK.settleMs - WALK.leadMs, 200),
        ease: EASE.outIntoTheRoom,
        controlsInterrupt: true
      });
    });

    return true;
  }

  /**
   * Where a scene should come to rest: what the hotspot asked for, falling
   * back to wherever that scene was left last time — which on a first visit is
   * its initialView.
   */
  _restingView(entry, requested) {
    const view = entry.marzipanoScene.view();
    const pick = (key, fallback) =>
      (requested && requested[key] != null ? requested[key] : fallback);
    return {
      yaw: pick('yaw', view.yaw()),
      pitch: pick('pitch', view.pitch()),
      fov: pick('fov', view.fov())
    };
  }

  forgetScene(id) {
    const entry = this._scenes.get(id);
    if (!entry) return;
    this._scenes.delete(id);
    if (this._currentId === id) this._currentId = null;
    try {
      if (this.viewer.hasScene(entry.marzipanoScene)) {
        this.viewer.destroyScene(entry.marzipanoScene);
      }
    } catch (err) {
      // Marzipano refuses to destroy the scene it is displaying. The caller
      // switches away first; if that failed, leaking one scene beats throwing.
      console.warn(`[tour] Could not destroy scene "${id}":`, err && err.message);
    }
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

  /**
   * Removes a hotspot created by addHotspot. Used by the editor; the tour
   * itself never deletes hotspots.
   * @param {string} sceneId
   * @param {object} handle  the value addHotspot returned
   */
  removeHotspot(sceneId, handle) {
    const entry = this._scenes.get(sceneId);
    if (!entry || !handle) return;
    const container = entry.marzipanoScene.hotspotContainer();
    if (container.hasHotspot(handle)) container.destroyHotspot(handle);
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
