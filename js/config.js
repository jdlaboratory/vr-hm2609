/**
 * config.js — loads and validates config/tour.json.
 *
 * Everything downstream (tour.js, hotspots.js, ui.js) can assume the object
 * returned by `loadTourConfig` is well-formed: settings are filled in, scenes
 * have an id/name/panorama/initialView, and hotspots that could never work
 * have been dropped with a console warning.
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
  updateUrlOnSceneChange: true,
  // Vertical field-of-view limits, in radians.
  minFov: 0.45,            // ~26deg  (zoomed in)
  maxFov: 1.85             // ~106deg (zoomed out)
};

const DEFAULT_INITIAL_VIEW = { yaw: 0, pitch: 0, fov: 1.4 };

/** Hotspot types this build knows how to render. */
export const HOTSPOT_TYPES = ['scene', 'youtube', 'info'];

/** YouTube ids are 11 chars of [A-Za-z0-9_-]. Anything else is rejected. */
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * Accepts a bare video id or a common YouTube URL and returns the id.
 * Returns null when nothing safe can be extracted — callers must handle null
 * rather than passing an arbitrary string into an iframe src.
 */
export function extractYouTubeId(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  if (YOUTUBE_ID_RE.test(raw)) return raw;

  // Try the URL forms: youtu.be/ID, /watch?v=ID, /embed/ID, /shorts/ID
  let url;
  try {
    url = new URL(raw, window.location.href);
  } catch (err) {
    return null;
  }
  const host = url.hostname.replace(/^www\./, '');
  const allowedHosts = ['youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'youtu.be'];
  if (!allowedHosts.includes(host)) return null;

  let candidate = null;
  if (host === 'youtu.be') {
    candidate = url.pathname.slice(1);
  } else if (url.searchParams.has('v')) {
    candidate = url.searchParams.get('v');
  } else {
    const match = url.pathname.match(/^\/(?:embed|shorts|v)\/([^/?#]+)/);
    if (match) candidate = match[1];
  }
  return candidate && YOUTUBE_ID_RE.test(candidate) ? candidate : null;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function numberOr(value, fallback) {
  return isFiniteNumber(value) ? value : fallback;
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

  if (raw.type === 'youtube') {
    const videoId = extractYouTubeId(raw.videoId != null ? raw.videoId : raw.url);
    if (!videoId) {
      console.warn(`[tour] ${where}: missing or invalid YouTube video id ` +
                   `(${JSON.stringify(raw.videoId)}) — skipped.`);
      return null;
    }
    hotspot.videoId = videoId;
    hotspot.title = typeof raw.title === 'string' ? raw.title : (hotspot.label || 'Video');
    if (isFiniteNumber(raw.start)) hotspot.start = Math.max(0, Math.floor(raw.start));
  }

  if (raw.type === 'info') {
    hotspot.title = typeof raw.title === 'string' ? raw.title : (hotspot.label || 'Information');
    hotspot.content = typeof raw.content === 'string' ? raw.content : '';
    // Optional image shown above the text. Must be a same-origin/relative path.
    hotspot.image = typeof raw.image === 'string' ? raw.image : null;
  }

  return hotspot;
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
    hotspots: []
  };

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
 * @returns {Promise<{settings: object, scenes: Array, sceneById: Map}>}
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

  return { settings, scenes, sceneById };
}
