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
import { Modal, buildYouTubeEmbed, buildInfoContent } from './modal.js';
import { UI } from './ui.js';
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

  // ------------------------------------------------------------- hotspots
  installHotspots(tour, config, {
    onNavigate: (targetId, targetView) => goToScene(targetId, targetView),

    onOpenVideo: (hotspot, opener) => {
      // config.js already guaranteed a valid 11-character id; this is a
      // second line of defence so a bad edit cannot blank the tour.
      if (!hotspot.videoId) {
        console.warn(`[tour] Hotspot "${hotspot.id}" has no video id — ignoring click.`);
        return;
      }
      modal.open({
        title: hotspot.title || 'Video',
        content: buildYouTubeEmbed(hotspot),
        openerElement: opener
      });
      elements.modal.dialog.classList.add('is-video');
    },

    onOpenInfo: (hotspot, opener) => {
      modal.open({
        title: hotspot.title || 'Information',
        content: buildInfoContent(hotspot),
        openerElement: opener
      });
      elements.modal.dialog.classList.remove('is-video');
    }
  });

  // -------------------------------------------------------- scene routing
  function goToScene(sceneId, targetView) {
    if (!sceneById.has(sceneId)) {
      console.warn(`[tour] Unknown scene "${sceneId}" — loading "${settings.defaultScene}".`);
      sceneId = settings.defaultScene;
    }
    const ok = tour.switchTo(sceneId, { view: targetView || undefined });
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
    document.title = `${scene.name} — Virtual Tour`;
  });

  // Back/forward and manual hash edits.
  window.addEventListener('popstate', () => {
    const requested = readSceneFromUrl();
    if (requested && sceneById.has(requested)) tour.switchTo(requested);
  });

  // ---------------------------------------------------------------- editor
  if (isEditorRequested()) {
    try {
      new Editor(tour, config, elements.pano);
    } catch (err) {
      console.error('[tour] Editor failed to start:', err);
    }
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
