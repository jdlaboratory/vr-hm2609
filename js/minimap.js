/**
 * minimap.js — the floor plan in the bottom-right corner.
 *
 * One pin per scene that has a "map" block in tour.json; the scene currently
 * on screen swaps to the highlight pin. Clicking a pin jumps to that scene.
 *
 * The module also carries the editing affordances the editor turns on: with
 * `setEditable(true)`, pins can be dragged, a click on bare floor plan places
 * the active scene, and the panel itself can be dragged by its header to a new
 * corner. Nothing here writes to tour.json — it reports changes through
 * `onPlace`/`onMove` and lets the editor own the file.
 *
 * No Marzipano here; the minimap only knows scene ids.
 */

/** Below this much pointer travel a drag is treated as a click. */
const DRAG_SLOP_PX = 4;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

/**
 * Takes or releases pointer capture, tolerating browsers that throw when the
 * pointer is already gone. Losing capture costs a smooth drag, never the edit.
 */
function capture(element, pointerId, take) {
  try {
    if (take) element.setPointerCapture(pointerId);
    else if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
  } catch (err) {
    /* no capture: pointermove still arrives while the pointer is over the pin */
  }
}

export class Minimap {
  /**
   * @param {{root: HTMLElement, toggle: HTMLElement, title: HTMLElement,
   *          body: HTMLElement, plate: HTMLElement, image: HTMLImageElement,
   *          pins: HTMLElement}} elements
   * @param {object} settings  normalised settings.minimap (never null)
   * @param {Array} scenes     normalised scenes
   * @param {{onSelectScene: Function}} callbacks
   */
  constructor(elements, settings, scenes, callbacks) {
    this.el = elements;
    this.settings = settings;
    this.scenes = scenes;
    this.callbacks = callbacks;
    this.editable = false;
    this.activeId = null;
    this._placeHandlers = [];
    this._moveHandlers = [];
    this._swallowToggle = false;
    /** @type {Map<string, HTMLButtonElement>} */
    this._pins = new Map();

    this._setupPanel();
    this._buildPins();
    this._bindPlate();
    this._bindPanelDrag();
  }

  // ------------------------------------------------------------------ panel

  _setupPanel() {
    const { root, image, title, toggle, body } = this.el;

    this.applyGeometry();
    title.textContent = this.settings.title || '';
    title.hidden = !this.settings.title;
    // Lets the stylesheet shrink the header to its chevron when there is no
    // caption to sit in it.
    root.classList.toggle('is-untitled', !this.settings.title);

    image.setAttribute('alt', this.settings.title || '층별 안내도');
    image.addEventListener('error', () => {
      console.warn(`[tour] Minimap image "${this.settings.image}" could not be loaded — ` +
                   `hiding the minimap. Check settings.minimap.image in tour.json.`);
      root.hidden = true;
    });
    image.setAttribute('src', this.settings.image);

    root.hidden = false;
    if (this.settings.startCollapsed) this._setCollapsed(true);

    toggle.addEventListener('click', () => {
      // The header doubles as the drag handle in editor mode; the click that
      // ends a drag must not also fold the panel away.
      if (this._swallowToggle) {
        this._swallowToggle = false;
        return;
      }
      this._setCollapsed(!root.classList.contains('is-collapsed'));
    });
    // Keeps the initial aria state honest even when startCollapsed is false.
    toggle.setAttribute('aria-controls', body.id);
  }

  /** Writes the stored width and corner offsets onto the panel. */
  applyGeometry() {
    const { root } = this.el;
    const { width, position } = this.settings;
    root.style.setProperty('--minimap-width', `${width}px`);
    root.style.setProperty('--minimap-offset-x', `${position.x}px`);
    root.style.setProperty('--minimap-offset-y', `${position.y}px`);
    root.dataset.corner = position.corner;
  }

  /** Editor: resize the panel. Width is clamped by config.js on the way in. */
  setWidth(width) {
    this.settings.width = width;
    this.applyGeometry();
  }

  /** Editor: anchor the panel to `{corner, x, y}`. */
  setPosition(position) {
    this.settings.position = position;
    this.applyGeometry();
  }

  _setCollapsed(collapsed) {
    this.el.root.classList.toggle('is-collapsed', collapsed);
    this.el.body.hidden = collapsed;
    this.el.toggle.setAttribute('aria-expanded', String(!collapsed));
    this.el.toggle.setAttribute('aria-label', collapsed ? '안내도 펼치기' : '안내도 접기');
  }

  // ------------------------------------------------------------------- pins

  _buildPins() {
    this.el.pins.replaceChildren();
    this._pins.clear();

    this.scenes.forEach((scene) => {
      if (!scene.map) return;

      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = 'minimap-pin';
      pin.dataset.sceneId = scene.id;
      pin.setAttribute('aria-label', scene.name);

      const img = document.createElement('img');
      // setAttribute, never innerHTML: the path comes from config.
      img.setAttribute('src', this.settings.pin);
      img.setAttribute('alt', '');
      img.setAttribute('aria-hidden', 'true');
      pin.appendChild(img);

      // No visible caption: two dozen of them over a floor plan is noise, and
      // the scene name is already the button's accessible name above.

      this._bindPin(pin, scene);
      this.el.pins.appendChild(pin);
      this._pins.set(scene.id, pin);
      this._position(pin, scene.map);
    });
  }

  _position(pin, position) {
    pin.style.left = `${position.x * 100}%`;
    pin.style.top = `${position.y * 100}%`;
  }

  /**
   * Rebuilds every pin from the current scene list. The editor calls this when
   * a scene is added or removed, where updatePin has nothing to update.
   */
  rebuild() {
    this._buildPins();
    this.setActiveScene(this.activeId);
  }

  /** Re-reads one scene's `map` block and moves its pin (editor use). */
  updatePin(sceneId) {
    const scene = this.scenes.find((item) => item.id === sceneId);
    if (!scene) return;

    const existing = this._pins.get(sceneId);
    if (!scene.map) {
      if (existing) {
        existing.remove();
        this._pins.delete(sceneId);
      }
      return;
    }
    if (!existing) {
      // The scene had no position until now: rebuild so it gets a pin.
      this._buildPins();
      this.setActiveScene(this.activeId);
      return;
    }
    this._position(existing, scene.map);
  }

  setActiveScene(sceneId) {
    this.activeId = sceneId;
    this._pins.forEach((pin, id) => {
      const active = id === sceneId;
      pin.classList.toggle('is-active', active);
      const img = pin.querySelector('img');
      // Two files rather than a CSS filter, so the highlight colour is a
      // designer's choice in assets/icons and not baked into the stylesheet.
      const wanted = active ? this.settings.pinActive : this.settings.pin;
      if (img.getAttribute('src') !== wanted) img.setAttribute('src', wanted);
      if (active) pin.setAttribute('aria-current', 'true');
      else pin.removeAttribute('aria-current');
    });
  }

  // ---------------------------------------------------------------- editing

  /** Turns pin dragging and click-to-place on or off. */
  setEditable(enabled) {
    this.editable = enabled;
    this.el.root.classList.toggle('is-editable', enabled);
  }

  /** @param {(sceneId: string, position: {x: number, y: number}) => void} fn */
  onPlace(fn) {
    this._placeHandlers.push(fn);
  }

  /** @param {(position: {corner: string, x: number, y: number}) => void} fn */
  onMove(fn) {
    this._moveHandlers.push(fn);
  }

  _emitPlace(sceneId, position) {
    this._placeHandlers.forEach((fn) => fn(sceneId, position));
  }

  /**
   * Drags the whole panel by its header. On release the panel is anchored to
   * whichever corner it ended up nearest, so it keeps that margin when the
   * window is resized instead of drifting into the middle of the view.
   */
  _bindPanelDrag() {
    const { root, toggle } = this.el;
    let start = null;
    let dragged = false;

    toggle.addEventListener('pointerdown', (event) => {
      if (!this.editable) return;
      if (event.button != null && event.button !== 0) return;
      event.preventDefault();
      const rect = root.getBoundingClientRect();
      start = {
        x: event.clientX, y: event.clientY,
        left: rect.left, top: rect.top,
        width: rect.width, height: rect.height
      };
      dragged = false;
      capture(toggle, event.pointerId, true);
      root.classList.add('is-moving');
    });

    toggle.addEventListener('pointermove', (event) => {
      if (!start) return;
      if (!dragged &&
          Math.hypot(event.clientX - start.x, event.clientY - start.y) < DRAG_SLOP_PX) {
        return;
      }
      dragged = true;
      this._dragPanelTo(event, start);
    });

    const endDrag = (event) => {
      if (!start) return;
      start = null;
      root.classList.remove('is-moving');
      capture(toggle, event.pointerId, false);
      if (dragged) this._swallowToggle = true;
    };
    toggle.addEventListener('pointerup', endDrag);
    toggle.addEventListener('pointercancel', endDrag);
  }

  _dragPanelTo(event, start) {
    const viewWidth = window.innerWidth;
    const viewHeight = window.innerHeight;

    // Always leave the whole panel on screen: a header dragged off the edge
    // would be unreachable for the next drag.
    const left = clamp(start.left + (event.clientX - start.x),
                       0, Math.max(0, viewWidth - start.width));
    const top = clamp(start.top + (event.clientY - start.y),
                      0, Math.max(0, viewHeight - start.height));

    const corner = (top + start.height / 2 < viewHeight / 2 ? 'top' : 'bottom') + '-' +
                   (left + start.width / 2 < viewWidth / 2 ? 'left' : 'right');
    // Offsets are measured from the chosen corner, so the box does not jump
    // when the nearest corner changes mid-drag.
    const position = {
      corner,
      x: Math.round(corner.endsWith('left') ? left : viewWidth - left - start.width),
      y: Math.round(corner.startsWith('top') ? top : viewHeight - top - start.height)
    };

    this.setPosition(position);
    this._moveHandlers.forEach((fn) => fn(position));
  }

  /** Pointer position as a 0..1 fraction of the floor plan image. */
  _toMapPosition(event) {
    const rect = this.el.plate.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height)
    };
  }

  _bindPin(pin, scene) {
    let start = null;
    let dragged = false;

    pin.addEventListener('pointerdown', (event) => {
      // The minimap sits above the panorama; never let a press on it start a
      // camera drag underneath.
      event.stopPropagation();
      if (!this.editable) return;
      event.preventDefault();
      start = { x: event.clientX, y: event.clientY };
      dragged = false;
      capture(pin, event.pointerId, true);
      pin.classList.add('is-dragging');
    });

    pin.addEventListener('pointermove', (event) => {
      if (!start) return;
      if (!dragged &&
          Math.hypot(event.clientX - start.x, event.clientY - start.y) < DRAG_SLOP_PX) {
        return;
      }
      dragged = true;
      const position = this._toMapPosition(event);
      if (!position) return;
      this._position(pin, position);
      this._emitPlace(scene.id, position);
    });

    const endDrag = (event) => {
      if (!start) return;
      start = null;
      pin.classList.remove('is-dragging');
      capture(pin, event.pointerId, false);
    };
    pin.addEventListener('pointerup', endDrag);
    pin.addEventListener('pointercancel', endDrag);

    pin.addEventListener('click', (event) => {
      event.stopPropagation();
      // A drag that ended on the pin must not also navigate away from it.
      if (dragged) {
        dragged = false;
        return;
      }
      this.callbacks.onSelectScene(scene.id);
    });
  }

  _bindPlate() {
    this.el.plate.addEventListener('pointerdown', (event) => event.stopPropagation());

    this.el.plate.addEventListener('click', (event) => {
      if (!this.editable || !this.activeId) return;
      if (event.target.closest('.minimap-pin')) return;   // handled by the pin
      const position = this._toMapPosition(event);
      if (position) this._emitPlace(this.activeId, position);
    });
  }
}
