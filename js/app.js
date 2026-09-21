/**
 * app.js — bootstrap.
 *
 * Loads the config, creates the tour, wires hotspots to the modal, keeps the
 * URL and UI in sync. Deliberately thin: the real work lives in the modules
 * it imports.
 */

import { loadTourConfig } from './config.js';
import { Tour } from './tour.js';
import { installHotspots } from './hotspots.js';
import { Modal, buildVimeoEmbed, buildInfoContent } from './modal.js';
import { UI } from './ui.js';
import { Minimap } from './minimap.js';
import { Editor, isEditorRequested } from './editor.js';

const elements = {
  pano: document.getElementById('pano'),
  sceneTitle: document.getElementById('sceneTitle'),
  menuBtn: document.getElementById('menuBtn'),
  sceneMenu: document.getElementById('sceneMenu'),
  sceneMenuList: document.getElementById('sceneMenuList'),
  fullscreenBtn: document.getElementById('fullscreenBtn'),
  hint: document.getElementById('hint'),
  loader: document.getElementById('loader'),
  errorScreen: document.getElementById('errorScreen'),
  errorMessage: document.getElementById('errorMessage'),
  errorRetry: document.getElementById('errorRetry'),
  minimap: {
    root: document.getElementById('minimap'),
    toggle: document.getElementById('minimapToggle'),
    title: document.getElementById('minimapTitle'),
    body: document.getElementById('minimapBody'),
    plate: document.getElementById('minimapPlate'),
    image: document.getElementById('minimapImage'),
    pins: document.getElementById('minimapPins')
  },
  modal: {
    root: document.getElementById('modal'),
    dialog: document.getElementById('modalDialog'),
    backdrop: document.getElementById('modalBackdrop'),
    closeButton: document.getElementById('modalClose'),
    title: document.getElementById('modalTitle'),
    body: document.getElementById('modalBody')
  }
};

/**
 * Reads the requested scene from ?scene=id or #id. Returns null when absent;
 * an unknown id is resolved to the default scene by the caller.
 */
function readSceneFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get('scene');
  if (fromQuery) return fromQuery;
  const hash = window.location.hash.replace(/^#/, '');
  return hash || null;
}

/**
 * True when this page came from a development server on this machine or the
 * local network. Live reload is only ever probed here — a deployed tour must
 * not spend a request asking a static host for an endpoint it cannot have.
 */
function isLocalAddress() {
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' ||
         host === '[::1]' || host === '' || host.endsWith('.local') ||
         /^192\.168\./.test(host) || /^10\./.test(host) ||
         /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

/** Reflects the current scene in the URL without adding history noise. */
function writeSceneToUrl(sceneId) {
  const url = new URL(window.location.href);
  url.searchParams.set('scene', sceneId);
  url.hash = '';
  window.history.replaceState({ sceneId }, '', url);
}

function showFatalError(message, retry) {
  elements.loader.classList.remove('is-visible');
  elements.errorMessage.textContent = message;
  elements.errorScreen.hidden = false;
  elements.errorRetry.hidden = !retry;
  if (retry) elements.errorRetry.onclick = retry;
}

async function start() {
  if (!window.Marzipano) {
    showFatalError('Unable to load virtual tour. The Marzipano library is missing.');
    console.error('[tour] window.Marzipano is undefined — check vendor/marzipano.js loaded.');
    return;
  }

  elements.loader.classList.add('is-visible');

  let config;
  try {
    config = await loadTourConfig('config/tour.json');
  } catch (err) {
    console.error('[tour]', err);
    showFatalError('Unable to load virtual tour.', () => window.location.reload());
    return;
  }

  const { settings, scenes, sceneById } = config;

  // ----------------------------------------------------------------- tour
  let tour;
  try {
    tour = new Tour(elements.pano, config);
  } catch (err) {
    console.error('[tour] Viewer could not be created:', err);
    showFatalError('Unable to start the 360° viewer. Your browser may not support WebGL.');
    return;
  }

  // ------------------------------------------------------------------- UI
  const ui = new UI(elements, settings, {
    onSelectScene: (id) => goToScene(id)
  });
  ui.buildSceneMenu(scenes);
  tour.onLoadingChange((isLoading) => ui.setLoading(isLoading));

  // ---------------------------------------------------------------- modal
  const modal = new Modal(elements.modal, {
    // Freeze the panorama behind the dialog so a stray drag does not move it.
    onOpen: () => { tour.pauseMovement(); tour.setControlsEnabled(false); },
    onClose: () => { tour.setControlsEnabled(true); tour.resumeMovement(); }
  });

  // -------------------------------------------------------------- minimap
  let minimap = null;
  if (settings.minimap) {
    try {
      minimap = new Minimap(elements.minimap, settings.minimap, scenes, {
        onSelectScene: (id) => goToScene(id)
      });
    } catch (err) {
      // A broken minimap must never take the tour down with it.
      console.error('[tour] Minimap could not be built:', err);
      if (elements.minimap.root) elements.minimap.root.hidden = true;
    }
  }

  // ------------------------------------------------------------- hotspots
  const hotspots = installHotspots(tour, config, {
    onNavigate: (targetId, targetView, from) => goToScene(targetId, targetView, from),

    onOpenVideo: (hotspot, opener) => {
      // config.js already guaranteed a valid numeric video id; this is a
      // second line of defence so a bad edit cannot blank the tour.
      if (!hotspot.videoId) {
        console.warn(`[tour] Hotspot "${hotspot.id}" has no video id — ignoring click.`);
        return;
      }
      modal.open({
        title: hotspot.title || 'Video',
        content: buildVimeoEmbed(hotspot),
        openerElement: opener
      });
      elements.modal.dialog.classList.add('is-video');
      elements.modal.dialog.classList.toggle('is-dual', Boolean(hotspot.videoId2));
    },

    onOpenInfo: (hotspot, opener) => {
      modal.open({
        title: hotspot.title || 'Information',
        content: buildInfoContent(hotspot),
        openerElement: opener
      });
      elements.modal.dialog.classList.remove('is-video', 'is-dual');
    }
  });

  // -------------------------------------------------------- scene routing
  function goToScene(sceneId, targetView, from) {
    if (!sceneById.has(sceneId)) {
      console.warn(`[tour] Unknown scene "${sceneId}" — loading "${settings.defaultScene}".`);
      sceneId = settings.defaultScene;
    }
    // walkTo decides for itself when a walk would be wrong — the first scene,
    // reduced motion — and cuts instead.
    const ok = tour.walkTo(sceneId, { view: targetView || undefined, from: from || null });
    if (!ok) {
      ui.showError(`Unable to show "${sceneId}". The panorama may be missing.`);
      return;
    }
    ui.hideError();
    if (settings.updateUrlOnSceneChange) writeSceneToUrl(sceneId);
  }

  tour.onSceneChange((scene) => {
    ui.setSceneName(scene.name);
    ui.setActiveScene(scene.id);
    if (minimap) minimap.setActiveScene(scene.id);
    // The tab keeps the exhibition's title from index.html. The scene name is
    // already on screen, and a title that changes underfoot makes the tour
    // hard to find again among a row of tabs.
  });

  // Back/forward and manual hash edits.
  window.addEventListener('popstate', () => {
    const requested = readSceneFromUrl();
    if (requested && sceneById.has(requested)) tour.switchTo(requested);
  });

  // ---------------------------------------------------------------- editor
  let editor = null;
  if (isEditorRequested()) {
    try {
      editor = new Editor(tour, config, elements.pano, {
        hotspots,
        minimap,
        ui,
        onNavigate: (id) => goToScene(id)
      });
    } catch (err) {
      console.error('[tour] Editor failed to start:', err);
    }
  }

  // ----------------------------------------------------------- live reload
  // Imported dynamically so the module is only ever fetched on a dev server.
  // It checks whether this one was started with --live and does nothing if not.
  if (isLocalAddress()) {
    import('./livereload.js')
      .then((module) => module.installLiveReload({
        // Never reload out from under a change the editor has not written yet.
        beforeReload: () => (editor ? editor.flushPendingSave() : null)
      }))
      .catch((err) => console.warn('[tour] Live reload is unavailable:', err));
  }

  // --------------------------------------------------------- initial scene
  const requested = readSceneFromUrl();
  const startScene = requested && sceneById.has(requested) ? requested : settings.defaultScene;
  if (requested && !sceneById.has(requested)) {
    console.warn(`[tour] Scene "${requested}" from the URL does not exist — ` +
                 `loading default scene "${settings.defaultScene}".`);
  }
  goToScene(startScene);

  // Safety net: if the first panorama never finishes loading, say so instead of
  // spinning forever.
  window.setTimeout(() => {
    if (elements.loader.classList.contains('is-visible')) {
      console.warn('[tour] The first panorama is taking an unusually long time to load.');
    }
  }, 15000);
}

start().catch((err) => {
  console.error('[tour] Unexpected startup failure:', err);
  showFatalError('Unable to load virtual tour.', () => window.location.reload());
});
