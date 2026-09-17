/**
 * config.js — loads and validates config/tour.json.
 *
 * Everything downstream (tour.js, hotspots.js, ui.js) can assume the object
 * returned by `loadTourConfig` is well-formed: settings are filled in, scenes
 * have an id/name/panorama/initialView, and hotspots that could never work
 * have been dropped with a console warning.
 *
 * Each normalised scene and hotspot also carries a non-enumerable `_raw`
 * pointing at the object it came from in tour.json. The editor writes through
 * it, so saving re-emits the original file — comments, "_source" notes and
 * anything else this module does not model included — instead of a lossy
 * re-serialisation of the normalised model.
 *
 * No Marzipano and no DOM in this file.
 */

const DEFAULT_SETTINGS = {
  defaultScene: null,      // falls back to the first scene
  autorotate: false,
  autorotateIdleDelayMs: 4000,
  sceneMenu: true,
  fullscreen: true,
  showSceneName: true,
  showHint: true,
  transitionDurationMs: 500,
  // Walk-through transition: the camera turns toward the way out and pushes
  // into it before the cross-fade. false falls back to the cross-fade alone.
  walkTransition: true,
  updateUrlOnSceneChange: true,
  // Vertical field-of-view limits, in radians.
  minFov: 0.45,            // ~26deg  (zoomed in)
  maxFov: 1.85,            // ~106deg (zoomed out)
  // Floor-plan overlay. Off unless tour.json supplies an image.
  minimap: null
};

const DEFAULT_INITIAL_VIEW = { yaw: 0, pitch: 0, fov: 1.4 };

const DEFAULT_MINIMAP = {
  enabled: true,
  image: null,                            // required; without it the map is off
  title: '',
  pin: 'assets/icons/pin.svg',
  pinActive: 'assets/icons/pin-active.svg',
  width: 260,                             // px, at desktop sizes
  // Anchored to a corner rather than given absolute coordinates, so the panel
  // keeps its margin when the window is resized.
  position: { corner: 'bottom-right', x: 16, y: 16 },
  startCollapsed: false
};

/** The corners the minimap can be anchored to. */
export const MINIMAP_CORNERS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];

/** Panel width limits, in px. Shared with the editor's size control. */
export const MINIMAP_WIDTH_RANGE = { min: 140, max: 560 };

/** Hotspot types this build knows how to render. */
export const HOTSPOT_TYPES = ['scene', 'vimeo', 'info'];

/** Vimeo ids are numeric. Anything else is rejected. */
const VIMEO_ID_RE = /^\d{6,12}$/;
/** Unlisted videos carry a short alphanumeric privacy hash beside the id. */
const VIMEO_HASH_RE = /^[A-Za-z0-9]{6,16}$/;

/**
 * Accepts a bare video id, "id/hash", or a Vimeo URL and returns
 * `{id, hash}` — hash is null for a public video.
 *
 * Returns null when nothing safe can be extracted — callers must handle null
 * rather than passing an arbitrary string into an iframe src. The hash is kept
 * because an unlisted video refuses to play without it.
 */
export function extractVimeoVideo(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;

  const build = (id, hash) => (VIMEO_ID_RE.test(id || '')
    ? { id, hash: hash && VIMEO_HASH_RE.test(hash) ? hash : null }
    : null);

  // Bare "123456789", or "123456789/abcdef0123" as Vimeo's share box writes it.
  const bare = /^(\d{6,12})(?:\/([A-Za-z0-9]+))?$/.exec(raw);
  if (bare) return build(bare[1], bare[2]);

  let url;
  try {
    url = new URL(raw, window.location.href);
  } catch (err) {
    return null;
  }
  const host = url.hostname.replace(/^www\./, '');
  if (host !== 'vimeo.com' && host !== 'player.vimeo.com') return null;

  // The id is the first all-digit segment, which covers vimeo.com/ID,
  // /channels/name/ID, /groups/name/videos/ID and player.vimeo.com/video/ID.
  // A privacy hash follows it in the path (vimeo.com/ID/HASH) or in ?h=.
  const segments = url.pathname.split('/').filter(Boolean);
  const index = segments.findIndex((segment) => VIMEO_ID_RE.test(segment));
  if (index === -1) return null;
  return build(segments[index], url.searchParams.get('h') || segments[index + 1] || null);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function numberOr(value, fallback) {
  return isFiniteNumber(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Points a normalised object back at the tour.json object it came from, so the
 * editor can write changes into the file's own structure. Non-enumerable: it
 * must not show up in JSON.stringify or in `for...in` over the model.
 *
 * Exported so the editor links the hotspots it creates the same way.
 */
export function linkRaw(normalized, raw) {
  Object.defineProperty(normalized, '_raw', { value: raw, writable: true, enumerable: false });
  return normalized;
}

/**
 * Normalises settings.minimap. Returns null whenever the minimap cannot be
 * drawn, so callers only have to check one thing before rendering it.
 */
function normalizeMinimap(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.enabled === false) return null;
  if (typeof raw.image !== 'string' || !raw.image) {
    console.warn('[tour] settings.minimap has no "image" path — minimap disabled.');
    return null;
  }
  const text = (value, fallback) =>
    (typeof value === 'string' && value ? value : fallback);
  return {
    enabled: true,
    image: raw.image,
    title: typeof raw.title === 'string' ? raw.title : DEFAULT_MINIMAP.title,
    pin: text(raw.pin, DEFAULT_MINIMAP.pin),
    pinActive: text(raw.pinActive, DEFAULT_MINIMAP.pinActive),
    // Clamped: a minimap wider than a phone would cover the panorama.
    width: Math.round(clamp(numberOr(raw.width, DEFAULT_MINIMAP.width),
                            MINIMAP_WIDTH_RANGE.min, MINIMAP_WIDTH_RANGE.max)),
    position: normalizeMinimapPosition(raw.position),
    startCollapsed: raw.startCollapsed === true
  };
}

/**
 * Where the minimap panel sits: which corner it hangs off, and how far in from
 * that corner. Offsets are capped so a bad value cannot park the panel outside
 * the window with no way back short of editing the file.
 */
function normalizeMinimapPosition(raw) {
  const fallback = DEFAULT_MINIMAP.position;
  if (!raw || typeof raw !== 'object') return Object.assign({}, fallback);

  const corner = MINIMAP_CORNERS.includes(raw.corner) ? raw.corner : fallback.corner;
  if (raw.corner != null && corner !== raw.corner) {
    console.warn(`[tour] settings.minimap.position.corner "${raw.corner}" is not one of ` +
                 `${MINIMAP_CORNERS.join(', ')} — using "${fallback.corner}".`);
  }
  return {
    corner,
    x: Math.round(clamp(numberOr(raw.x, fallback.x), 0, 2000)),
    y: Math.round(clamp(numberOr(raw.y, fallback.y), 0, 2000))
  };
}

/**
 * A scene's position on the minimap, as a 0..1 fraction of the image.
 * Returns null for scenes that have not been placed — they simply get no pin.
 */
function normalizeMapPosition(raw, sceneId) {
  if (raw == null) return null;
  if (typeof raw !== 'object' || !isFiniteNumber(raw.x) || !isFiniteNumber(raw.y)) {
    console.warn(`[tour] scene "${sceneId}": "map" needs numeric x and y between ` +
                 `0 and 1 — the scene will have no minimap pin.`);
    return null;
  }
  return { x: clamp(raw.x, 0, 1), y: clamp(raw.y, 0, 1) };
}

/**
 * Normalises one hotspot. Returns null when the hotspot can never work, so a
 * single bad entry in tour.json degrades to a warning instead of a blank tour.
 */
function normalizeHotspot(raw, scene, index) {
  const where = `scene "${scene.id}" hotspot #${index + 1}`;

  if (!raw || typeof raw !== 'object') {
    console.warn(`[tour] ${where}: not an object — skipped.`);
    return null;
  }
  if (!HOTSPOT_TYPES.includes(raw.type)) {
    console.warn(`[tour] ${where}: unknown type "${raw.type}" — skipped. ` +
                 `Expected one of: ${HOTSPOT_TYPES.join(', ')}.`);
    return null;
  }
  if (!isFiniteNumber(raw.yaw) || !isFiniteNumber(raw.pitch)) {
    console.warn(`[tour] ${where}: yaw/pitch must be numbers (radians) — skipped.`);
    return null;
  }

  const hotspot = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `${scene.id}-hs${index + 1}`,
    type: raw.type,
    yaw: raw.yaw,
    pitch: raw.pitch,
    label: typeof raw.label === 'string' ? raw.label : '',
    // Optional per-hotspot icon file, replacing the built-in inline SVG.
    icon: typeof raw.icon === 'string' && raw.icon ? raw.icon : null,
    // Optional: lay the hotspot flat on the floor plane, etc.
    perspective: raw.perspective && typeof raw.perspective === 'object'
      ? raw.perspective
      : null
  };

  if (raw.type === 'scene') {
    if (typeof raw.target !== 'string' || !raw.target) {
      console.warn(`[tour] ${where}: scene hotspot has no "target" — skipped.`);
      return null;
    }
    hotspot.target = raw.target;
    // Optional camera direction to adopt on arrival.
    if (raw.targetView && typeof raw.targetView === 'object') {
      hotspot.targetView = {
        yaw: numberOr(raw.targetView.yaw, null),
        pitch: numberOr(raw.targetView.pitch, null),
        fov: numberOr(raw.targetView.fov, null)
      };
    }
  }

  if (raw.type === 'vimeo') {
    const video = extractVimeoVideo(raw.videoId != null ? raw.videoId : raw.url);
    if (!video) {
      console.warn(`[tour] ${where}: missing or invalid Vimeo video id ` +
                   `(${JSON.stringify(raw.videoId)}) — skipped.`);
      return null;
    }
    hotspot.videoId = video.id;
    hotspot.videoHash = video.hash;
    hotspot.title = typeof raw.title === 'string' ? raw.title : (hotspot.label || 'Video');
    if (isFiniteNumber(raw.start)) hotspot.start = Math.max(0, Math.floor(raw.start));
  }

  if (raw.type === 'info') {
    hotspot.title = typeof raw.title === 'string' ? raw.title : (hotspot.label || 'Information');
    hotspot.content = typeof raw.content === 'string' ? raw.content : '';
    // Optional image shown above the text. Must be a same-origin/relative path.
    hotspot.image = typeof raw.image === 'string' ? raw.image : null;
  }

  return linkRaw(hotspot, raw);
}

/**
 * Normalises one scene. Throws only for problems that make the scene unusable;
 * the caller drops it and carries on.
 */
function normalizeScene(raw, index) {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`scene #${index + 1} is not an object`);
  }
  if (typeof raw.id !== 'string' || !raw.id) {
    throw new Error(`scene #${index + 1} has no "id"`);
  }
  const panorama = raw.panorama;
  if (!panorama || typeof panorama !== 'object') {
    throw new Error(`scene "${raw.id}" has no "panorama" block`);
  }

  const type = panorama.type === 'multires' ? 'multires' : 'equirectangular';
  const scene = {
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name ? raw.name : raw.id,
    panorama: { type },
    initialView: {
      yaw: numberOr(raw.initialView && raw.initialView.yaw, DEFAULT_INITIAL_VIEW.yaw),
      pitch: numberOr(raw.initialView && raw.initialView.pitch, DEFAULT_INITIAL_VIEW.pitch),
      fov: numberOr(raw.initialView && raw.initialView.fov, DEFAULT_INITIAL_VIEW.fov)
    },
    map: normalizeMapPosition(raw.map, raw.id),
    hotspots: []
  };
  linkRaw(scene, raw);

  if (type === 'equirectangular') {
    // `url` may contain a {z} placeholder when several resolution levels exist.
    if (typeof panorama.url !== 'string' || !panorama.url) {
      throw new Error(`scene "${raw.id}": equirectangular panorama needs a "url"`);
    }
    scene.panorama.url = panorama.url;
    const levels = Array.isArray(panorama.levels) && panorama.levels.length
      ? panorama.levels
      : [{ width: numberOr(panorama.width, 4096) }];
    scene.panorama.levels = levels
      .map((level) => ({ width: numberOr(level && level.width, 4096) }))
      .sort((a, b) => a.width - b.width);
    if (scene.panorama.url.indexOf('{z}') === -1 && scene.panorama.levels.length > 1) {
      console.warn(`[tour] scene "${raw.id}": multiple equirect levels declared but the ` +
                   `url has no {z} placeholder — only the largest level will be used.`);
      scene.panorama.levels = scene.panorama.levels.slice(-1);
    }
  } else {
    // Marzipano multiresolution cube tiles.
    if (typeof panorama.path !== 'string' || !panorama.path) {
      throw new Error(`scene "${raw.id}": multires panorama needs a "path"`);
    }
    scene.panorama.path = panorama.path.replace(/\/+$/, '');
    scene.panorama.extension = typeof panorama.extension === 'string'
      ? panorama.extension.replace(/^\./, '')
      : 'jpg';
    scene.panorama.tileSize = numberOr(panorama.tileSize, 512);
    scene.panorama.faceSize = numberOr(panorama.faceSize, 2048);
    scene.panorama.preview = panorama.preview !== false;
    if (Array.isArray(panorama.levels) && panorama.levels.length) {
      scene.panorama.levels = panorama.levels.map((level) => ({
        tileSize: numberOr(level.tileSize, scene.panorama.tileSize),
        size: numberOr(level.size, scene.panorama.faceSize),
        fallbackOnly: level.fallbackOnly === true
      }));
    } else {
      scene.panorama.levels = null; // derived in tour.js from faceSize/tileSize
    }
  }

  const rawHotspots = Array.isArray(raw.hotspots) ? raw.hotspots : [];
  scene.hotspots = rawHotspots
    .map((hs, i) => normalizeHotspot(hs, scene, i))
    .filter(Boolean);

  return scene;
}

/**
 * Fetches and validates config/tour.json.
 * @param {string} url
 * @returns {Promise<{settings: object, scenes: Array, sceneById: Map, raw: object}>}
 *   `raw` is the parsed file itself, shared with every `_raw` back-reference.
 */
export async function loadTourConfig(url = 'config/tour.json') {
  let response;
  try {
    response = await fetch(url, { cache: 'no-cache' });
  } catch (err) {
    throw new Error(`Could not reach ${url}. Are you serving the folder over http://? (${err.message})`);
  }
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}.`);
  }

  let raw;
  try {
    raw = await response.json();
  } catch (err) {
    throw new Error(`${url} is not valid JSON: ${err.message}`);
  }

  if (!raw || !Array.isArray(raw.scenes) || raw.scenes.length === 0) {
    throw new Error(`${url} contains no scenes.`);
  }

  const settings = Object.assign({}, DEFAULT_SETTINGS, raw.settings || {});
  settings.minimap = normalizeMinimap(settings.minimap);

  const scenes = [];
  raw.scenes.forEach((rawScene, index) => {
    try {
      scenes.push(normalizeScene(rawScene, index));
    } catch (err) {
      console.warn(`[tour] Skipping invalid scene: ${err.message}`);
    }
  });

  if (!scenes.length) {
    throw new Error('Every scene in tour.json was invalid.');
  }

  const sceneById = new Map();
  scenes.forEach((scene) => {
    if (sceneById.has(scene.id)) {
      console.warn(`[tour] Duplicate scene id "${scene.id}" — the later one wins.`);
    }
    sceneById.set(scene.id, scene);
  });

  // Drop navigation hotspots that point nowhere, so a click can never dead-end.
  scenes.forEach((scene) => {
    scene.hotspots = scene.hotspots.filter((hs) => {
      if (hs.type === 'scene' && !sceneById.has(hs.target)) {
        console.warn(`[tour] scene "${scene.id}" hotspot "${hs.id}" targets unknown scene ` +
                     `"${hs.target}" — removed. Check the "target" value in tour.json.`);
        return false;
      }
      return true;
    });
  });

  if (!settings.defaultScene || !sceneById.has(settings.defaultScene)) {
    if (settings.defaultScene) {
      console.warn(`[tour] settings.defaultScene "${settings.defaultScene}" does not exist — ` +
                   `falling back to "${scenes[0].id}".`);
    }
    settings.defaultScene = scenes[0].id;
  }

  return { settings, scenes, sceneById, raw };
}
