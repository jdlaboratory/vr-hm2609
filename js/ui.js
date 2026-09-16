/**
 * ui.js — the chrome around the panorama: scene title, scene menu, fullscreen
 * button, loader, first-visit hint and the error screen.
 *
 * Everything here is optional and driven by settings in tour.json. No
 * Marzipano calls; the module talks to the app through the callbacks it is
 * given.
 */

const HINT_DISMISSED_KEY = 'tour:hintDismissed';

/** How far the pointer must travel before a press counts as a drag. */
const DRAG_SLOP_PX = 4;
/** How close to an edge of the open drawer a drag starts scrolling it. */
const DRAG_EDGE_PX = 28;

/** The six-dot grip, drawn inline so it inherits the row's colour. */
const GRIP_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
  '<circle cx="6" cy="4" r="1.15"/><circle cx="10" cy="4" r="1.15"/>' +
  '<circle cx="6" cy="8" r="1.15"/><circle cx="10" cy="8" r="1.15"/>' +
  '<circle cx="6" cy="12" r="1.15"/><circle cx="10" cy="12" r="1.15"/></svg>';

export class UI {
  /**
   * @param {object} elements  DOM references, see app.js
   * @param {object} settings  normalised settings from config.js
   * @param {{onSelectScene: Function}} callbacks
   */
  constructor(elements, settings, callbacks) {
    this.el = elements;
    this.settings = settings;
    this.callbacks = callbacks;
    this._menuOpen = false;
    this._loaderTimer = null;

    this._setupSceneName();
    this._setupFullscreen();
    this._setupHint();
  }

  // ---------------------------------------------------------------- scene name

  _setupSceneName() {
    this.el.sceneTitle.hidden = !this.settings.showSceneName;
  }

  setSceneName(name) {
    if (!this.settings.showSceneName) return;
    this.el.sceneTitle.textContent = name;
    this.el.sceneTitle.hidden = false;
  }

  // ---------------------------------------------------------------- scene menu

  /**
   * Builds the scene list. Safe to call again whenever the scene list changes —
   * the editor does, on rename, add and delete. The list items are rebuilt each
   * time; the button and document listeners are wired only on the first call,
   * so repeat calls cannot stack duplicate handlers.
   */
  buildSceneMenu(scenes) {
    // Remembered so setSceneMenuEditable can rebuild without being handed them.
    this._scenes = scenes;
    if (!this.settings.sceneMenu || scenes.length < 2) {
      this.el.menuBtn.hidden = true;
      return;
    }

    this.el.menuBtn.hidden = false;
    const list = this.el.sceneMenuList;
    list.replaceChildren();

    this._menuItems = new Map();
    scenes.forEach((scene) => {
      const li = document.createElement('li');
      li.className = 'scene-menu-row';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'scene-menu-item';
      button.textContent = scene.name;
      button.dataset.sceneId = scene.id;
      button.addEventListener('click', () => {
        this.callbacks.onSelectScene(scene.id);
        this.closeMenu();
      });
      li.appendChild(button);
      if (this._menuEditable) li.appendChild(this._menuDragHandle(scene));
      list.appendChild(li);
      this._menuItems.set(scene.id, button);
    });

    if (this._menuWired) return;
    this._menuWired = true;

    this.el.menuBtn.addEventListener('click', () => this.toggleMenu());

    // Click-away and Escape close the drawer.
    document.addEventListener('pointerdown', (event) => {
      if (!this._menuOpen) return;
      if (this.el.sceneMenu.contains(event.target) || this.el.menuBtn.contains(event.target)) return;
      this.closeMenu();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this._menuOpen) this.closeMenu();
    });
  }

  /**
   * Turns the scene list into a reorderable one. The editor calls this; the
   * tour never does, so a visitor's menu has nothing in it but the scenes.
   *
   * @param {?{onMove: function(string, number): void,
   *           onReorder: function(Array<string>): void}} handlers  null turns it off
   */
  setSceneMenuEditable(handlers) {
    this._menuEditable = handlers || null;
    if (this._scenes) this.buildSceneMenu(this._scenes);
  }

  /**
   * The grip that reorders the list.
   *
   * It is a sibling of the row button rather than a child of it, so pressing
   * it never walks into that scene. Dragging it moves the row; the arrow keys
   * move it one place at a time, so the order is reachable without a mouse.
   */
  _menuDragHandle(scene) {
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'scene-menu-grip';
    handle.dataset.sceneId = scene.id;
    handle.title = '끌어서 순서 바꾸기';
    handle.setAttribute('aria-label',
      `"${scene.name}" 순서 바꾸기. 끌거나 위/아래 방향키를 누르세요.`);
    // Trusted, developer-authored constant — safe to assign as HTML.
    handle.innerHTML = GRIP_ICON;

    handle.addEventListener('pointerdown', (event) => this._startMenuDrag(event, handle));
    handle.addEventListener('keydown', (event) => {
      const direction = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
      if (!direction) return;
      event.preventDefault();
      this._menuEditable.onMove(scene.id, direction);
    });
    return handle;
  }

  /**
   * Drags one row to a new place in the list.
   *
   * The row is moved in the DOM as the pointer passes each neighbour, so what
   * you see during the drag is the order you will get. Only on release is the
   * whole list handed to the editor, which is what writes it to the file.
   */
  _startMenuDrag(event, handle) {
    if (!this._menuEditable) return;
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();

    const list = this.el.sceneMenuList;
    const row = handle.parentElement;
    const pointerId = event.pointerId;
    const startY = event.clientY;
    let moved = false;

    // The rest of the drag is followed on `window`, NOT on the grip, and the
    // grip deliberately does not capture the pointer. Moving the row is a
    // remove-and-insert; that detaches the grip for an instant, which drops
    // any pointer capture it holds. Listening on the grip would then hear one
    // reorder and nothing after it — the row would move a single place per
    // drag, however far you pulled it.
    const onMove = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      if (!moved && Math.abs(moveEvent.clientY - startY) < DRAG_SLOP_PX) return;
      if (!moved) {
        moved = true;
        row.classList.add('is-dragging');
        list.classList.add('is-reordering');
      }
      // Nothing else should read this as a press on whatever is under it.
      moveEvent.preventDefault();
      this._placeDraggedRow(list, row, moveEvent.clientY);
      this._scrollMenuEdge(moveEvent.clientY);
    };

    const onEnd = (endEvent) => {
      if (endEvent.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onEnd, true);
      window.removeEventListener('pointercancel', onEnd, true);
      row.classList.remove('is-dragging');
      list.classList.remove('is-reordering');
      // A press that never became a drag leaves the list exactly as it was.
      if (!moved) return;
      this._menuEditable.onReorder([...list.children]
        .map((item) => item.querySelector('.scene-menu-item').dataset.sceneId));
    };

    // Capture phase, so a drag that strays over the panorama is still ours.
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onEnd, true);
    window.addEventListener('pointercancel', onEnd, true);
  }

  /** Puts the dragged row wherever the pointer currently is. */
  _placeDraggedRow(list, row, y) {
    const before = [...list.children].find((item) => {
      if (item === row) return false;
      const box = item.getBoundingClientRect();
      return y < box.top + box.height / 2;
    });
    if (before) {
      if (before.previousSibling !== row) list.insertBefore(row, before);
    } else if (list.lastChild !== row) {
      list.appendChild(row);
    }
  }

  /** Scrolls the drawer when a drag reaches its top or bottom edge. */
  _scrollMenuEdge(y) {
    const menu = this.el.sceneMenu;
    const box = menu.getBoundingClientRect();
    if (y < box.top + DRAG_EDGE_PX) menu.scrollTop -= 12;
    else if (y > box.bottom - DRAG_EDGE_PX) menu.scrollTop += 12;
  }

  toggleMenu() {
    if (this._menuOpen) this.closeMenu(); else this.openMenu();
  }

  openMenu() {
    this._menuOpen = true;
    this.el.sceneMenu.hidden = false;
    requestAnimationFrame(() => this.el.sceneMenu.classList.add('is-open'));
    this.el.menuBtn.setAttribute('aria-expanded', 'true');
    this.el.menuBtn.setAttribute('aria-label', 'Close scene list');
  }

  closeMenu() {
    if (!this._menuOpen) return;
    this._menuOpen = false;
    this.el.sceneMenu.classList.remove('is-open');
    this.el.sceneMenu.hidden = true;
    this.el.menuBtn.setAttribute('aria-expanded', 'false');
    this.el.menuBtn.setAttribute('aria-label', 'Open scene list');
  }

  setActiveScene(sceneId) {
    if (!this._menuItems) return;
    this._menuItems.forEach((button, id) => {
      const active = id === sceneId;
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    });
  }

  // ---------------------------------------------------------------- fullscreen

  _setupFullscreen() {
    const btn = this.el.fullscreenBtn;
    // Only the *Enabled* flags are meaningful. The request methods exist on
    // iPhone Safari even though element fullscreen is unavailable there, so
    // testing for them would show a button that silently does nothing.
    const supported = Boolean(
      document.fullscreenEnabled || document.webkitFullscreenEnabled
    );

    // iPhone Safari exposes no element fullscreen: hide rather than offer a
    // button that does nothing.
    if (!this.settings.fullscreen || !supported) {
      btn.hidden = true;
      return;
    }

    btn.hidden = false;
    btn.addEventListener('click', () => this._toggleFullscreen());

    const sync = () => {
      const active = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
      document.body.classList.toggle('is-fullscreen', active);
      btn.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen');
    };
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
  }

  async _toggleFullscreen() {
    const root = document.documentElement;
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        await (document.exitFullscreen
          ? document.exitFullscreen()
          : document.webkitExitFullscreen());
      } else {
        await (root.requestFullscreen
          ? root.requestFullscreen()
          : root.webkitRequestFullscreen());
      }
    } catch (err) {
      // Denied by the browser (permissions policy, user gesture rules, ...).
      console.warn('[tour] Fullscreen request failed:', err && err.message);
      this.el.fullscreenBtn.hidden = true;
    }
  }

  // ---------------------------------------------------------------- hint

  _setupHint() {
    if (!this.settings.showHint) return;
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(HINT_DISMISSED_KEY) === '1';
    } catch (err) {
      // Private mode / blocked storage: just show the hint.
    }
    if (dismissed) return;

    this.el.hint.hidden = false;
    const dismiss = () => {
      this.el.hint.hidden = true;
      try { window.localStorage.setItem(HINT_DISMISSED_KEY, '1'); } catch (err) { /* ignore */ }
      window.removeEventListener('pointerdown', dismiss);
    };
    window.addEventListener('pointerdown', dismiss, { once: true });
    window.setTimeout(dismiss, 6000);
  }

  // ---------------------------------------------------------------- loader

  /**
   * Shows the loader only if loading outlasts `delayMs`, so a fast scene
   * switch never flashes a spinner.
   */
  setLoading(isLoading, delayMs = 250) {
    window.clearTimeout(this._loaderTimer);
    if (isLoading) {
      this._loaderTimer = window.setTimeout(() => {
        this.el.loader.classList.add('is-visible');
      }, delayMs);
    } else {
      this.el.loader.classList.remove('is-visible');
    }
  }

  // ---------------------------------------------------------------- errors

  showError(message, { retry = null } = {}) {
    this.el.loader.classList.remove('is-visible');
    this.el.errorMessage.textContent = message;
    this.el.errorScreen.hidden = false;
    this.el.errorRetry.hidden = !retry;
    if (retry) this.el.errorRetry.onclick = retry;
  }

  hideError() {
    this.el.errorScreen.hidden = true;
  }
}
