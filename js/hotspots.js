/**
 * hotspots.js — builds the DOM element for a hotspot.
 *
 * Adding a new hotspot type means: add a builder to RENDERERS below, add the
 * type name to HOTSPOT_TYPES in config.js, add validation there, and add a
 * `.hotspot-<type>` rule in css/style.css. Nothing else needs to change.
 *
 * No Marzipano here — tour.js takes the element this module returns and hands
 * it to Marzipano's hotspot container.
 */

/**
 * Inline icons. Kept inline rather than as <img src="assets/icons/*.svg"> so
 * they inherit `currentColor` and cost no extra requests. A per-hotspot
 * "icon" path in tour.json overrides them (see buildIcon).
 */
const ICONS = {
  scene: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
         '<path d="M12 5.5 L12 18.5 M12 5.5 L6.8 10.7 M12 5.5 L17.2 10.7" ' +
         'fill="none" stroke="currentColor" stroke-width="1.9" ' +
         'stroke-linecap="round" stroke-linejoin="round"/></svg>',

  youtube: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
           '<path d="M9.5 7.6 L17 12 L9.5 16.4 Z" fill="currentColor"/></svg>',

  info: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
        '<circle cx="12" cy="7.4" r="1.25" fill="currentColor"/>' +
        '<path d="M12 11v6" fill="none" stroke="currentColor" stroke-width="1.9" ' +
        'stroke-linecap="round"/></svg>'
};

/**
 * Returns the icon markup for a hotspot. When `hotspot.icon` names a file we
 * render an <img> instead — the path is set with setAttribute, never injected
 * as HTML, so a hostile config value cannot execute script.
 */
function buildIcon(hotspot) {
  const span = document.createElement('span');
  span.className = 'hotspot-icon';

  if (typeof hotspot.icon === 'string' && hotspot.icon) {
    const img = document.createElement('img');
    img.setAttribute('src', hotspot.icon);
    img.setAttribute('alt', '');
    img.setAttribute('aria-hidden', 'true');
    span.appendChild(img);
  } else {
    // Trusted, developer-authored constant — safe to assign as HTML.
    span.innerHTML = ICONS[hotspot.type] || ICONS.info;
  }
  return span;
}

/**
 * Shared shell for every hotspot: a real <button> so keyboard, focus and
 * assistive tech work without extra wiring.
 */
function createHotspotButton(hotspot, { accessibleName, extraClass }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `hotspot ${extraClass}`;
  button.dataset.hotspotId = hotspot.id;
  button.dataset.hotspotType = hotspot.type;
  button.setAttribute('aria-label', accessibleName);

  button.appendChild(buildIcon(hotspot));

  if (hotspot.label) {
    const label = document.createElement('span');
    label.className = 'hotspot-label';
    // textContent, never innerHTML — labels come from config.
    label.textContent = hotspot.label;
    label.setAttribute('aria-hidden', 'true');
    button.appendChild(label);
  }

  // Marzipano's hotspot container sits above the drag surface, so a press that
  // starts on a hotspot never rotates the view. Stopping propagation keeps the
  // viewer from also treating the press as the start of a gesture.
  button.addEventListener('pointerdown', (event) => event.stopPropagation());

  return button;
}

const RENDERERS = {
  /** Navigates to another scene. */
  scene(hotspot, handlers, sceneById) {
    const target = sceneById.get(hotspot.target);
    const targetName = target ? target.name : hotspot.target;
    const button = createHotspotButton(hotspot, {
      accessibleName: hotspot.label || `Go to ${targetName}`,
      extraClass: 'hotspot-scene'
    });
    button.addEventListener('click', () => {
      handlers.onNavigate(hotspot.target, hotspot.targetView || null);
    });
    return button;
  },

  /** Opens the YouTube modal. */
  youtube(hotspot, handlers) {
    const button = createHotspotButton(hotspot, {
      accessibleName: hotspot.label || `Play video: ${hotspot.title}`,
      extraClass: 'hotspot-video'
    });
    button.addEventListener('click', () => handlers.onOpenVideo(hotspot, button));
    return button;
  },

  /** Opens the information modal. */
  info(hotspot, handlers) {
    const button = createHotspotButton(hotspot, {
      accessibleName: hotspot.label || `Information: ${hotspot.title}`,
      extraClass: 'hotspot-info'
    });
    button.addEventListener('click', () => handlers.onOpenInfo(hotspot, button));
    return button;
  }
};

/**
 * Creates the DOM element for one hotspot.
 *
 * @param {object} hotspot     normalised hotspot from config.js
 * @param {object} handlers    {onNavigate, onOpenVideo, onOpenInfo}
 * @param {Map} sceneById      used to resolve target names for labels
 * @returns {HTMLElement|null}
 */
export function createHotspotElement(hotspot, handlers, sceneById) {
  const renderer = RENDERERS[hotspot.type];
  if (!renderer) {
    console.warn(`[tour] No renderer for hotspot type "${hotspot.type}" — skipped.`);
    return null;
  }
  return renderer(hotspot, handlers, sceneById);
}

/**
 * Attaches hotspots for a scene the first time it is shown, and never again.
 *
 * Marzipano keeps one hotspot container per scene, so elements added here live
 * for the lifetime of that scene: navigating away and back does not re-create
 * them and cannot duplicate their listeners. Doing this lazily also means a
 * 30-scene tour builds only the hotspots the visitor actually reaches.
 *
 * @param {import('./tour.js').Tour} tour
 * @param {{scenes: Array, sceneById: Map}} config
 * @param {object} handlers  {onNavigate, onOpenVideo, onOpenInfo}
 */
export function installHotspots(tour, config, handlers) {
  const attached = new Set();

  function attachScene(scene) {
    if (attached.has(scene.id)) return;
    attached.add(scene.id);
    scene.hotspots.forEach((hotspot) => {
      const element = createHotspotElement(hotspot, handlers, config.sceneById);
      if (!element) return;
      tour.addHotspot(scene.id, element, hotspot, hotspot.perspective);
    });
  }

  tour.onSceneChange(attachScene);
  return { attachScene };
}
