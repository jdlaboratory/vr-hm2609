/**
 * ui.js — the chrome around the panorama: scene title, scene menu, fullscreen
 * button, loader, first-visit hint and the error screen.
 *
 * Everything here is optional and driven by settings in tour.json. No
 * Marzipano calls; the module talks to the app through the callbacks it is
 * given.
 */

const HINT_DISMISSED_KEY = 'tour:hintDismissed';

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
   * Builds the scene list. Called once; the active item is updated on each
   * scene change rather than the list being rebuilt.
   */
  buildSceneMenu(scenes) {
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
      list.appendChild(li);
      this._menuItems.set(scene.id, button);
    });

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
