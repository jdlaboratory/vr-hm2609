/**
 * editor.js — developer-only tool for positioning navigation points and
 * minimap pins.
 *
 * Loaded and initialised ONLY when the page URL carries ?edit=1, so nothing in
 * this file executes for visitors.
 *
 * What it edits, live, with no reload:
 *   - navigation points: drag a hotspot in the panorama, or click a spot after
 *     pressing "화면에서 위치 지정"; change its target, label and type; add and
 *     delete them
 *   - minimap position: drag the scene's pin on the floor plan, or click the
 *     plan to drop the open scene there
 *   - the scene's opening view
 *
 * Changes are written straight into the parsed tour.json (every normalised
 * object keeps a `_raw` pointer to the object it came from — see config.js),
 * so saving re-emits the real file rather than a reconstruction of it. "저장"
 * PUTs that file to the local dev server, which is the only thing that can
 * write to disk; anywhere else it falls back to downloading the file.
 */

import { linkRaw, extractVimeoVideo, MINIMAP_CORNERS, MINIMAP_WIDTH_RANGE } from './config.js';

/** Korean names for the hotspot types, shared by the picker and the list. */
const HOTSPOT_TYPE_LABELS = {
  scene: '이동 (다른 장면)',
  vimeo: '비메오 영상',
  info: '정보 패널'
};

/** Labels for the four corners the minimap panel can hang off. */
const CORNER_LABELS = {
  'bottom-right': '우측 하단',
  'bottom-left': '좌측 하단',
  'top-right': '우측 상단',
  'top-left': '좌측 상단'
};

/** Where the dev server accepts the edited file. Relative: the tour may be
 *  served from a subdirectory. */
const SAVE_ENDPOINT = 'api/tour-config';

/** Where the dev server lists the panoramas a new viewpoint could use. */
const PANORAMA_ENDPOINT = 'api/panoramas';

/**
 * Builds the panorama block for a new scene by copying an existing one and
 * swapping the scene id through it, so a tour on multires tiles or on a
 * non-default path keeps working without the editor knowing what it uses.
 */
function clonePanorama(template, sceneId) {
  const source = (template && template._raw && template._raw.panorama) ||
                 (template && template.panorama) || {};
  const clone = JSON.parse(JSON.stringify(source));
  const swap = (value) =>
    (typeof value === 'string' && value.includes(template.id)
      ? value.split(template.id).join(sceneId)
      : null);

  const url = swap(clone.url);
  const path = swap(clone.path);
  if (url) clone.url = url;
  if (path) clone.path = path;
  // The template's own id was nowhere in its paths, so there is nothing to
  // swap: fall back to this project's layout rather than reuse its picture.
  if (!url && !path) {
    clone.type = 'equirectangular';
    clone.url = `assets/panoramas/equirect/${sceneId}_{z}.jpg`;
    delete clone.path;
  }
  return clone;
}

/** The last segment of a path: `assets/source-panoramas/006.jpg` → `006.jpg`. */
function basename(path) {
  return typeof path === 'string' ? path.split('/').pop() : '';
}

/** `scene09a` → `assets/source-panoramas/009a.jpg`, the note every scene carries. */
function sourceNoteFor(sceneId) {
  const match = /^scene(\d+)([a-z]*)$/i.exec(sceneId);
  if (!match) return null;
  return `assets/source-panoramas/${match[1].padStart(3, '0')}${match[2].toLowerCase()}.jpg`;
}

/** Radians rounded to 3 decimals — finer than anyone can aim. */
function round(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * Minimap positions are fractions of the plan, so they need more digits than
 * radians do: four decimals is a tenth of a pixel even on a 1000 px floor plan,
 * which keeps a pin where you put it if the plan is later re-exported larger.
 */
function roundFraction(value) {
  return Math.round(value * 10000) / 10000;
}

function radToDeg(value) {
  return Math.round((value * 180 / Math.PI) * 10) / 10;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
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
    /* no capture: pointermove still arrives while the pointer is over the element */
  }
}

/**
 * Pretty-prints tour.json the way the file is written by hand: two-space
 * indent, but coordinate objects and level lists kept on one line, and a blank
 * line between scenes. Without this, the first save would reformat all 850
 * lines and bury the real change in the diff.
 */
export function formatTourJson(raw) {
  let text = JSON.stringify(raw, null, 2);

  const collapse = (key) => {
    const pattern = new RegExp(`("${key}": )\\{\\n((?:[^{}]*\\n)+?)\\s*\\}`, 'g');
    text = text.replace(pattern, (match, prefix, body) =>
      `${prefix}{ ${body.trim().split('\n').map((line) => line.trim()).join(' ')} }`);
  };
  collapse('initialView');
  collapse('map');
  collapse('position');

  text = text.replace(/\{\n\s*"width": (\d+)\n\s*\}/g, '{ "width": $1 }');
  text = text.replace(
    /"levels": \[\n\s*(\{ "width": \d+ \}),\n\s*(\{ "width": \d+ \})\n\s*\]/g,
    '"levels": [$1, $2]');
  text = text.split('    },\n    {\n      "id"').join('    },\n\n    {\n      "id"');

  return `${text}\n`;
}

export class Editor {
  /**
   * @param {import('./tour.js').Tour} tour
   * @param {{scenes: Array, sceneById: Map, raw: object}} config
   * @param {HTMLElement} panoElement  the Marzipano container (for click coords)
   * @param {{hotspots: object, minimap: ?object, onNavigate: Function}} services
   */
  constructor(tour, config, panoElement, services) {
    this.tour = tour;
    this.config = config;
    this.panoElement = panoElement;
    this.hotspots = services.hotspots;
    this.minimap = services.minimap || null;
    this.ui = services.ui || null;
    this.onNavigate = services.onNavigate;
    /** Panorama ids on disk; null until the server answers, or if it cannot. */
    this.panoramasOnDisk = null;

    this.scene = null;
    this.selected = null;
    this.picking = false;
    this.dirty = false;
    this._armed = new WeakSet();
    this._suppressClick = false;

    this._buildPanel();
    this._bindPanorama();
    this._bindKeyboard();

    this.tour.onViewChange((view) => this._renderView(view));
    this.tour.onSceneChange((scene) => this._onSceneChange(scene));

    if (this.ui) {
      // ▲ ▼ in the ☰ list, so the order scenes are shown in can be set from
      // the tour itself rather than by moving blocks around in the file.
      this.ui.setSceneMenuEditable({
        onMove: (sceneId, direction) => this._reorderScene(sceneId, direction),
        onReorder: (sceneIds) => this._applySceneOrder(sceneIds)
      });
    }

    if (this.minimap) {
      this.minimap.setEditable(true);
      this.minimap.onPlace((sceneId, position) => this._placeScene(sceneId, position));
      // The panel writes its own geometry as it is dragged; mirror it into the
      // file and the readout.
      this.minimap.onMove((position) => this._setPanelPosition(position));
    }

    document.body.classList.add('editor-active');
    this._probeSaving();
    this._probePanoramas();
    console.info('[tour] Editor mode active (?edit=1). Remove the query parameter for production.');
  }

  // ------------------------------------------------------------------ panel

  _buildPanel() {
    const panel = el('aside', 'editor');
    panel.setAttribute('aria-label', '투어 편집기');

    const header = el('div', 'editor-header');
    header.appendChild(el('h2', 'editor-title', '편집기'));
    this.collapseBtn = el('button', 'editor-collapse', '–');
    this.collapseBtn.type = 'button';
    this.collapseBtn.setAttribute('aria-label', '편집기 접기');
    this.collapseBtn.addEventListener('click', () => {
      const collapsed = panel.classList.toggle('is-collapsed');
      this.collapseBtn.textContent = collapsed ? '+' : '–';
      this.collapseBtn.setAttribute('aria-label', collapsed ? '편집기 펼치기' : '편집기 접기');
    });
    header.appendChild(this.collapseBtn);
    panel.appendChild(header);

    const body = el('div', 'editor-body');
    panel.appendChild(body);

    this._buildViewSection(body);
    body.appendChild(el('hr', 'editor-rule'));
    this._buildSceneSection(body);
    body.appendChild(el('hr', 'editor-rule'));
    this._buildHotspotSection(body);
    body.appendChild(el('hr', 'editor-rule'));
    this._buildMapSection(body);
    body.appendChild(el('hr', 'editor-rule'));
    this._buildPanelSection(body);
    body.appendChild(el('hr', 'editor-rule'));
    this._buildSaveSection(body);

    document.body.appendChild(panel);
    this.panel = panel;
  }

  // --- current scene and view -------------------------------------------

  _buildViewSection(body) {
    const readout = el('div', 'editor-readout');
    this.sceneOut = el('code', null, '—');
    this.yawOut = el('code', null, '0');
    this.pitchOut = el('code', null, '0');
    this.fovOut = el('code', null, '0');

    [['장면', this.sceneOut], ['Yaw', this.yawOut],
     ['Pitch', this.pitchOut], ['FOV', this.fovOut]].forEach(([label, node]) => {
      const row = el('div', 'editor-readout-row');
      row.appendChild(el('span', 'editor-readout-label', label));
      row.appendChild(node);
      readout.appendChild(row);
    });
    body.appendChild(readout);

    const actions = el('div', 'editor-actions');
    const setInitial = el('button', 'editor-btn', '시작 화면으로 지정');
    setInitial.type = 'button';
    setInitial.addEventListener('click', () => this._useCurrentViewAsInitial());
    actions.appendChild(setInitial);

    const reset = el('button', 'editor-btn', '되돌리기');
    reset.type = 'button';
    reset.title = '저장된 시작 화면으로 되돌립니다';
    reset.addEventListener('click', () => this.tour.resetView());
    actions.appendChild(reset);
    body.appendChild(actions);
  }

  _renderView(view) {
    this.yawOut.textContent = `${round(view.yaw)} (${radToDeg(view.yaw)}°)`;
    this.pitchOut.textContent = `${round(view.pitch)} (${radToDeg(view.pitch)}°)`;
    this.fovOut.textContent = `${round(view.fov)} (${radToDeg(view.fov)}°)`;
  }

  _useCurrentViewAsInitial() {
    const view = this.tour.currentView();
    if (!view || !this.scene) return;
    const initialView = { yaw: round(view.yaw), pitch: round(view.pitch), fov: round(view.fov) };
    this.scene.initialView = initialView;
    if (this.scene._raw) this.scene._raw.initialView = initialView;
    this._status(`시작 화면을 현재 시점으로 지정했습니다.`, 'ok');
  }

  // --- the scene (viewpoint) itself --------------------------------------

  _buildSceneSection(body) {
    const heading = el('div', 'editor-section-head');
    heading.appendChild(el('span', 'editor-label', '포인트'));
    this.sceneCountOut = el('span', 'editor-count', '0');
    heading.appendChild(this.sceneCountOut);
    body.appendChild(heading);

    this.nameInput = this._field(body, '이름', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = '예: 중앙 로비';
      input.addEventListener('input', () => this._renameScene(input.value));
      return input;
    });

    // Which photo this viewpoint is: the one thing the name alone cannot tell
    // you when you are matching the tour against a folder of originals.
    this.sceneFileOut = el('p', 'editor-file', '—');
    body.appendChild(this.sceneFileOut);

    // --- add -------------------------------------------------------------
    const addRow = el('label', 'editor-row');
    addRow.appendChild(el('span', 'editor-label', '추가할 파노라마'));
    const addControls = el('div', 'editor-inline');
    this.panoramaSelect = document.createElement('select');
    addControls.appendChild(this.panoramaSelect);
    this.addSceneBtn = el('button', 'editor-btn editor-btn-primary', '추가');
    this.addSceneBtn.type = 'button';
    this.addSceneBtn.addEventListener('click', () => this._addScene(this.panoramaSelect.value));
    addControls.appendChild(this.addSceneBtn);
    addRow.appendChild(addControls);
    body.appendChild(addRow);

    // --- delete ----------------------------------------------------------
    const actions = el('div', 'editor-actions');
    this.deleteSceneBtn = el('button', 'editor-btn editor-btn-danger', '이 포인트 삭제');
    this.deleteSceneBtn.type = 'button';
    this.deleteSceneBtn.addEventListener('click', () => this._deleteScene());
    actions.appendChild(this.deleteSceneBtn);
    body.appendChild(actions);

    this.sceneNote = el('p', 'editor-note', '');
    body.appendChild(this.sceneNote);
  }

  /**
   * Asks the server which panoramas exist on disk. Anything not already in the
   * tour becomes an option under "추가할 파노라마" — a viewpoint cannot be
   * invented, it has to have a picture behind it.
   */
  async _probePanoramas() {
    let info = null;
    try {
      const response = await fetch(PANORAMA_ENDPOINT, { cache: 'no-store' });
      if (response.ok) info = await response.json().catch(() => null);
    } catch (err) {
      /* static host, or no such endpoint */
    }
    this.panoramasOnDisk = info && Array.isArray(info.scenes) ? info.scenes : null;
    this._renderSceneSection();
  }

  /**
   * Names the photo behind the current scene. Prefers the "_source" note — the
   * original the tour was built from — and falls back to the web copy, so the
   * line is never empty even for a scene that never had the note.
   */
  _renderSceneFile() {
    const scene = this.scene;
    if (!scene) {
      this.sceneFileOut.textContent = '—';
      this.sceneFileOut.removeAttribute('title');
      return;
    }
    const source = scene._raw && typeof scene._raw._source === 'string'
      ? scene._raw._source
      : null;
    const web = scene.panorama.url || scene.panorama.path || '';
    this.sceneFileOut.textContent = basename(source || web) || scene.id;
    // The full paths are one hover away rather than crowding a 300px panel.
    this.sceneFileOut.title = [source, web].filter(Boolean).join('\n');
  }

  _renderSceneSection() {
    const scenes = this.config.scenes;
    this.sceneCountOut.textContent = String(scenes.length);
    this.nameInput.value = this.scene ? this.scene.name : '';
    this.nameInput.disabled = !this.scene;
    this._renderSceneFile();
    // The last scene cannot go: a tour with no scenes will not load at all.
    this.deleteSceneBtn.disabled = !this.scene || scenes.length < 2;

    const select = this.panoramaSelect;
    const previous = select.value;
    select.replaceChildren();

    if (this.panoramasOnDisk === null) {
      const option = document.createElement('option');
      option.textContent = '목록을 받지 못함';
      select.appendChild(option);
      select.disabled = true;
      this.addSceneBtn.disabled = true;
      this.sceneNote.textContent =
        '파노라마 목록은 로컬 서버에서만 받아올 수 있습니다. ' +
        '포인트를 추가하려면 --edit 로 실행하세요.';
      return;
    }

    const used = new Set(scenes.map((scene) => scene.id));
    const free = this.panoramasOnDisk.filter((id) => !used.has(id));
    free.forEach((id) => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = id;
      select.appendChild(option);
    });
    if (free.includes(previous)) select.value = previous;

    const none = free.length === 0;
    if (none) {
      const option = document.createElement('option');
      option.textContent = '남은 파노라마 없음';
      select.appendChild(option);
    }
    select.disabled = none;
    this.addSceneBtn.disabled = none;
    this.sceneNote.textContent = none
      ? 'assets/panoramas/equirect/ 의 파노라마가 모두 투어에 들어가 있습니다. ' +
        '새 사진을 넣고 tools/make-web-equirect.ps1 을 돌리면 여기에 나타납니다.'
      : '이름은 장면 메뉴와 화살표 라벨에 함께 쓰입니다.';
  }

  _renameScene(name) {
    if (!this.scene) return;
    const previous = this.scene.name;
    this.scene.name = name;
    if (this.scene._raw) this.scene._raw.name = name;

    const followed = this._followRenameInLabels(this.scene.id, previous, name);
    this._showSceneNames();
    if (followed) {
      this._status(`이름을 바꾸고, 이 포인트를 가리키는 화살표 라벨 ${followed}개도 ` +
                   `함께 고쳤습니다.`, 'ok');
    }
    this._markDirty();
  }

  /**
   * Re-renders every surface that shows a scene name, from the one edit. They
   * are listed here rather than at each call site so that adding a place a
   * name appears is a change in one function, not a bug found later.
   */
  _showSceneNames() {
    if (!this.scene) return;
    if (this.ui) {
      this.ui.setSceneName(this.scene.name);     // the title over the panorama
      this.ui.buildSceneMenu(this.config.scenes); // the ☰ scene list
      this.ui.setActiveScene(this.scene.id);
    }
    if (this.minimap) this.minimap.rebuild();     // each pin's accessible name
    this._renderHotspotList();                    // arrows listed by target name
    this._refreshTargetOptions();                 // and chosen from those names
  }

  /**
   * Carries a scene rename into the arrows that lead to it.
   *
   * An arrow's caption is its own string, not a view of the target's name — a
   * label like "로비로 나가기" is deliberately not the name of the lobby. So
   * only the labels that were *showing* the old name, exactly, are rewritten;
   * anything someone phrased differently is left as they wrote it.
   *
   * @returns {number} how many labels followed the rename
   */
  _followRenameInLabels(sceneId, previousName, name) {
    if (previousName === name) return 0;
    let changed = 0;

    this.config.scenes.forEach((owner) => {
      owner.hotspots.forEach((hotspot) => {
        if (hotspot.type !== 'scene' || hotspot.target !== sceneId) return;

        const mirrorsTheName = hotspot.label === previousName;
        if (mirrorsTheName) {
          hotspot.label = name;
          if (hotspot._raw) {
            if (name) hotspot._raw.label = name;
            else delete hotspot._raw.label;
          }
          changed += 1;
        }
        // An arrow with no caption of its own is announced to screen readers
        // as its target's name, so it needs rebuilding too — even though
        // nothing was written to it.
        if (mirrorsTheName || !hotspot.label) this._rerenderHotspot(owner, hotspot);
      });
    });
    return changed;
  }

  /**
   * Rebuilds one hotspot's element in place, so a change to its label, target
   * or type shows on the panorama. A hotspot in a scene that has not been
   * visited yet has nothing rendered to refresh, and is left to be built with
   * the new values when the visitor arrives.
   */
  _rerenderHotspot(scene, hotspot) {
    if (!this.hotspots.entryFor(hotspot)) return;
    const wasSelected = hotspot === this.selected;
    this.hotspots.remove(hotspot);
    const entry = this.hotspots.add(scene, hotspot);
    if (!entry) return;
    this._arm(hotspot, entry.element);
    if (wasSelected) entry.element.classList.add('is-editing');
  }

  /** Builds a new scene around a panorama that is on disk but unused. */
  _addScene(sceneId) {
    if (!sceneId || this.config.sceneById.has(sceneId)) return;

    const template = this.scene || this.config.scenes[0];
    // Key order matches the scenes already in the file, so the save reads as
    // one more of the same rather than an obviously machine-written block.
    const rawScene = { id: sceneId, name: sceneId };
    const source = sourceNoteFor(sceneId);
    if (source) rawScene._source = source;
    rawScene.panorama = clonePanorama(template, sceneId);
    rawScene.initialView = { yaw: 0, pitch: 0, fov: 1.4 };
    // Dropped in the middle of the plan rather than nowhere, so the pin is on
    // screen and can be dragged straight to where it belongs.
    rawScene.map = { x: 0.5, y: 0.5 };
    rawScene.hotspots = [];
    const scene = linkRaw({
      id: sceneId,
      name: sceneId,
      panorama: JSON.parse(JSON.stringify(rawScene.panorama)),
      initialView: Object.assign({}, rawScene.initialView),
      map: Object.assign({}, rawScene.map),
      hotspots: []
    }, rawScene);

    // Next to the scene it was added from, so the menu keeps its walking order.
    const at = this.scene ? this.config.scenes.indexOf(this.scene) + 1 : this.config.scenes.length;
    this.config.scenes.splice(at, 0, scene);
    this.config.sceneById.set(sceneId, scene);
    if (Array.isArray(this.config.raw.scenes)) {
      const rawAt = template._raw ? this.config.raw.scenes.indexOf(template._raw) + 1
                                  : this.config.raw.scenes.length;
      this.config.raw.scenes.splice(rawAt, 0, rawScene);
    }

    this._refreshSceneLists();
    this._markDirty();
    this.onNavigate(sceneId);
    this._status(`"${sceneId}" 포인트를 추가했습니다. 이름을 정하고 안내도에서 핀을 옮기세요.`, 'ok');
    // The name is the first thing to fix, so put the caret in it.
    window.setTimeout(() => { this.nameInput.focus(); this.nameInput.select(); }, 0);
  }

  _deleteScene() {
    const scene = this.scene;
    if (!scene || this.config.scenes.length < 2) return;

    const inbound = [];
    this.config.scenes.forEach((other) => {
      if (other === scene) return;
      other.hotspots.forEach((hotspot) => {
        if (hotspot.type === 'scene' && hotspot.target === scene.id) {
          inbound.push({ scene: other, hotspot });
        }
      });
    });

    const detail = inbound.length
      ? `\n이 포인트로 오는 화살표 ${inbound.length}개도 함께 지워집니다.`
      : '';
    if (!window.confirm(`"${scene.name}" (${scene.id}) 포인트를 삭제할까요?${detail}`)) return;

    // Leave first: Marzipano will not destroy the scene it is displaying.
    const remaining = this.config.scenes.filter((other) => other !== scene);
    const next = remaining[Math.min(this.config.scenes.indexOf(scene), remaining.length - 1)];
    this.onNavigate(next.id);

    inbound.forEach(({ scene: owner, hotspot }) => {
      this.hotspots.remove(hotspot);
      const index = owner.hotspots.indexOf(hotspot);
      if (index >= 0) owner.hotspots.splice(index, 1);
      if (owner._raw && Array.isArray(owner._raw.hotspots)) {
        const rawIndex = owner._raw.hotspots.indexOf(hotspot._raw);
        if (rawIndex >= 0) owner._raw.hotspots.splice(rawIndex, 1);
      }
    });

    const at = this.config.scenes.indexOf(scene);
    if (at >= 0) this.config.scenes.splice(at, 1);
    this.config.sceneById.delete(scene.id);
    if (Array.isArray(this.config.raw.scenes) && scene._raw) {
      const rawAt = this.config.raw.scenes.indexOf(scene._raw);
      if (rawAt >= 0) this.config.raw.scenes.splice(rawAt, 1);
    }
    this.tour.forgetScene(scene.id);

    // A tour whose defaultScene no longer exists falls back to the first scene
    // with a console warning; say so in the file instead. A file that names no
    // default is left alone — its entry point is the top of the scene list,
    // and writing an id here would quietly pin it.
    const rawSettings = this.config.raw.settings;
    if (rawSettings && rawSettings.defaultScene === scene.id) {
      rawSettings.defaultScene = next.id;
      this.config.settings.defaultScene = next.id;
    }

    this._refreshSceneLists();
    this._markDirty();
    this._status(`"${scene.name}" 포인트를 삭제했습니다` +
                 (inbound.length ? ` (화살표 ${inbound.length}개 포함).` : '.'), 'ok');
  }

  /**
   * Keeps the live default in step with the list when the file pins no
   * `defaultScene`. Without one the tour opens at the top of the scene list,
   * so that is what the fallback has to name — including after a reorder.
   */
  _syncDefaultScene() {
    const rawSettings = this.config.raw.settings;
    const pinned = rawSettings && rawSettings.defaultScene;
    if (!pinned && this.config.scenes.length) {
      this.config.settings.defaultScene = this.config.scenes[0].id;
    }
  }

  /** Re-renders everything that lists scenes: menu, minimap pins, this panel. */
  _refreshSceneLists() {
    this._syncDefaultScene();
    if (this.ui) {
      this.ui.buildSceneMenu(this.config.scenes);
      if (this.scene) this.ui.setActiveScene(this.scene.id);
    }
    if (this.minimap) this.minimap.rebuild();
    this._renderSceneSection();
    this._renderHotspotList();
    this._refreshTargetOptions();
  }

  /**
   * Moves one scene one place up or down in the tour's own order — the ☰ menu,
   * the 대상 장면 dropdown, 추가할 파노라마, and the order scenes are written in.
   *
   * Nothing that joins two scenes can break: an arrow points at a scene *id*,
   * and `settings.defaultScene` is an id too, so neither depends on position.
   * As with the navigation points, the file's array is reordered by swapping
   * the two raw objects where they sit rather than being rebuilt from the
   * model, which would drop any scene config.js refused to load.
   */
  _reorderScene(sceneId, direction) {
    const list = this.config.scenes;
    const from = list.findIndex((scene) => scene.id === sceneId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= list.length) return;

    const scene = list[from];
    const neighbour = list[to];
    list[from] = neighbour;
    list[to] = scene;

    this._writeSceneOrder(list);
    this._refreshSceneLists();
    this._focusSceneGrip(scene.id);
    this._markDirty();
    this._status(`"${scene.name}" 순서를 옮겼습니다. 연결은 그대로입니다.`, 'ok');
  }

  /**
   * Takes the whole scene list in the order a drag left it.
   *
   * The ids have to be the same set the tour already holds. A missing or
   * unknown one means the menu and the model have drifted apart, and ordering
   * from it would drop or duplicate a scene — so the move is refused whole
   * rather than applied in part.
   */
  _applySceneOrder(sceneIds) {
    const list = this.config.scenes;
    const byId = new Map(list.map((scene) => [scene.id, scene]));
    if (sceneIds.length !== list.length || !sceneIds.every((id) => byId.has(id))) {
      console.warn('[tour] Editor ignored a scene order it could not match to the tour.');
      return;
    }

    const previous = list.slice();
    const ordered = sceneIds.map((id) => byId.get(id));

    // The row that travelled furthest is the one that was dragged; naming it
    // in the status line is more use than "the list changed".
    let dragged = ordered[0];
    let furthest = 0;
    ordered.forEach((scene, index) => {
      const shift = Math.abs(index - previous.indexOf(scene));
      if (shift > furthest) {
        furthest = shift;
        dragged = scene;
      }
    });
    if (!furthest) return;                     // dropped where it started

    list.length = 0;
    list.push(...ordered);
    this._writeSceneOrder(list);
    this._refreshSceneLists();
    this._focusSceneGrip(dragged.id);
    this._markDirty();
    this._status(`"${dragged.name}" 순서를 옮겼습니다. 연결은 그대로입니다.`, 'ok');
  }

  /**
   * Mirrors the scene order into the file's own array.
   *
   * Only the slots holding scenes the model knows about are rewritten, in the
   * model's order. Anything else in `scenes` — a block config.js refused to
   * load — keeps the index it had, where rebuilding the array would drop it.
   */
  _writeSceneOrder(ordered) {
    const raw = this.config.raw && this.config.raw.scenes;
    if (!Array.isArray(raw)) return;

    const known = new Set(ordered.map((scene) => scene._raw));
    const slots = [];
    raw.forEach((entry, index) => { if (known.has(entry)) slots.push(index); });
    if (slots.length !== ordered.length) {
      console.warn('[tour] Editor could not match every scene to the file — ' +
                   'the menu was reordered, the saved order was not.');
      return;
    }
    ordered.forEach((scene, index) => { raw[slots[index]] = scene._raw; });
  }

  /** Puts focus back on a row's grip after the menu has been rebuilt. */
  _focusSceneGrip(sceneId) {
    if (!this.ui) return;
    const grip = [...this.ui.el.sceneMenuList.querySelectorAll('.scene-menu-grip')]
      .find((item) => item.dataset.sceneId === sceneId);
    if (grip) grip.focus();
  }

  /** Keeps the hotspot form's "대상 장면" list in step with the scene list. */
  _refreshTargetOptions() {
    const select = this.targetSelect;
    if (!select) return;
    const previous = select.value;
    select.replaceChildren();
    this.config.scenes.forEach((scene) => {
      const option = document.createElement('option');
      option.value = scene.id;
      option.textContent = `${scene.name} (${scene.id})`;
      select.appendChild(option);
    });
    if (this.config.sceneById.has(previous)) select.value = previous;
    else if (this.selected && this.selected.type === 'scene') select.value = this.selected.target;
  }

  // --- navigation points -------------------------------------------------

  _buildHotspotSection(body) {
    const heading = el('div', 'editor-section-head');
    heading.appendChild(el('span', 'editor-label', '이동 포인트'));
    this.hotspotCount = el('span', 'editor-count', '0');
    heading.appendChild(this.hotspotCount);
    body.appendChild(heading);

    this.hotspotList = el('ul', 'editor-list');
    body.appendChild(this.hotspotList);

    const addRow = el('div', 'editor-actions');
    const addBtn = el('button', 'editor-btn editor-btn-primary', '+ 이동 포인트 추가');
    addBtn.type = 'button';
    addBtn.addEventListener('click', () => this._addHotspot());
    addRow.appendChild(addBtn);
    body.appendChild(addRow);

    // --- form for the selected hotspot ----------------------------------
    this.form = el('div', 'editor-form');

    this.typeSelect = this._field(this.form, '종류', () => {
      const select = document.createElement('select');
      Object.keys(HOTSPOT_TYPE_LABELS).forEach((value) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = HOTSPOT_TYPE_LABELS[value];
        select.appendChild(option);
      });
      select.addEventListener('change', () => this._changeType(select.value));
      return select;
    });

    this.targetSelect = this._field(this.form, '대상 장면', () => {
      const select = document.createElement('select');
      this.config.scenes.forEach((scene) => {
        const option = document.createElement('option');
        option.value = scene.id;
        option.textContent = `${scene.name} (${scene.id})`;
        select.appendChild(option);
      });
      select.addEventListener('change', () => this._changeTarget(select.value));
      return select;
    }, 'row-scene');

    this.labelInput = this._field(this.form, '라벨', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = '예: 카페로 이동';
      input.addEventListener('input', () => {
        this._writeField('label', input.value);
        this._rebuildSelected();
        this._renderHotspotList();
      });
      return input;
    });

    this.videoInput = this._field(this.form, '비메오 영상 ID 또는 주소', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = '76979871 또는 https://vimeo.com/76979871';
      input.addEventListener('input', () => this._writeVideo(input.value.trim()));
      return input;
    }, 'row-vimeo');

    this.titleInput = this._field(this.form, '제목', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = '이 공간에 대하여';
      input.addEventListener('input', () => this._writeField('title', input.value));
      return input;
    }, 'row-info row-vimeo');

    this.contentInput = this._field(this.form, '내용', () => {
      const area = document.createElement('textarea');
      area.rows = 3;
      area.placeholder = '본문. 빈 줄로 문단을 나눕니다.';
      area.addEventListener('input', () => this._writeField('content', area.value));
      return area;
    }, 'row-info');

    body.appendChild(this.form);

    this.positionOut = el('p', 'editor-picked', '선택된 이동 포인트가 없습니다.');
    body.appendChild(this.positionOut);

    const tools = el('div', 'editor-actions');
    this.pickBtn = el('button', 'editor-btn editor-btn-primary', '화면에서 위치 지정');
    this.pickBtn.type = 'button';
    this.pickBtn.addEventListener('click', () => this._togglePicking());
    tools.appendChild(this.pickBtn);

    this.deleteBtn = el('button', 'editor-btn editor-btn-danger', '삭제');
    this.deleteBtn.type = 'button';
    this.deleteBtn.addEventListener('click', () => this._deleteSelected());
    tools.appendChild(this.deleteBtn);
    body.appendChild(tools);

    body.appendChild(el('p', 'editor-note',
      '핫스팟은 파노라마에서 바로 끌어 옮길 수 있습니다. 선택한 뒤 방향키로 미세 조정, ' +
      'Shift를 함께 누르면 크게 움직입니다. Esc로 선택을 풀면 방향키가 다시 화면 회전에 쓰입니다.'));
  }

  /** Creates a labelled form row and returns the input element. */
  _field(parent, labelText, buildControl, rowClass) {
    const row = el('label', `editor-row${rowClass ? ' ' + rowClass : ''}`);
    row.appendChild(el('span', 'editor-label', labelText));
    const control = buildControl();
    row.appendChild(control);
    parent.appendChild(row);
    control._row = row;
    return control;
  }

  _renderHotspotList() {
    this.hotspotList.replaceChildren();
    const hotspots = this.scene ? this.scene.hotspots : [];
    this.hotspotCount.textContent = String(hotspots.length);

    if (!hotspots.length) {
      const empty = el('li', 'editor-list-empty', '이 장면에는 이동 포인트가 없습니다.');
      this.hotspotList.appendChild(empty);
      return;
    }

    hotspots.forEach((hotspot, index) => {
      const item = el('li', 'editor-list-row');
      const button = el('button', 'editor-list-item');
      button.type = 'button';
      button.classList.toggle('is-selected', hotspot === this.selected);

      const target = hotspot.type === 'scene'
        ? (this.config.sceneById.get(hotspot.target) || {}).name || hotspot.target
        : HOTSPOT_TYPE_LABELS[hotspot.type] || hotspot.type;
      button.appendChild(el('span', 'editor-list-name', hotspot.label || hotspot.id));
      button.appendChild(el('span', 'editor-list-meta', target));

      button.addEventListener('click', () => this._select(hotspot));
      // Hovering the list highlights the hotspot out in the panorama.
      button.addEventListener('pointerenter', () => this._highlight(hotspot, true));
      button.addEventListener('pointerleave', () => this._highlight(hotspot, false));

      item.appendChild(button);
      item.appendChild(this._orderButtons(hotspot, index, hotspots.length));
      this.hotspotList.appendChild(item);
    });
  }

  /** The ▲ / ▼ pair that moves one point within its scene. */
  _orderButtons(hotspot, index, total) {
    const group = el('span', 'editor-list-order');
    const name = hotspot.label || hotspot.id;

    [[-1, '▲', '위로'], [1, '▼', '아래로']].forEach(([direction, glyph, word]) => {
      const button = el('button', '', glyph);
      button.type = 'button';
      button.dataset.move = String(direction);
      button.title = `${word} 옮기기`;
      button.setAttribute('aria-label', `"${name}" ${word} 옮기기`);
      button.disabled = direction < 0 ? index === 0 : index === total - 1;
      button.addEventListener('click', () => this._reorderHotspot(hotspot, direction));
      group.appendChild(button);
    });
    return group;
  }

  /**
   * Moves one navigation point one place up or down inside its scene.
   *
   * Order is presentation only. What a point *does* is its `target`, and a
   * target is an id, so no link between two scenes can be broken by reordering
   * — this only changes the order they are listed and written in.
   *
   * The file's own array is reordered by swapping the two raw objects where
   * they sit, rather than being rebuilt from the model: a hotspot config.js
   * refused to load has no model entry, and rebuilding would drop it silently.
   */
  _reorderHotspot(hotspot, direction) {
    if (!this.scene) return;
    const list = this.scene.hotspots;
    const from = list.indexOf(hotspot);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= list.length) return;

    const neighbour = list[to];
    list[from] = neighbour;
    list[to] = hotspot;

    const raw = this.scene._raw && this.scene._raw.hotspots;
    if (Array.isArray(raw)) {
      const rawFrom = raw.indexOf(hotspot._raw);
      const rawTo = raw.indexOf(neighbour._raw);
      if (rawFrom >= 0 && rawTo >= 0) {
        raw[rawFrom] = neighbour._raw;
        raw[rawTo] = hotspot._raw;
      } else {
        console.warn('[tour] Editor could not find one of these points in the file ' +
                     '— the list was reordered, the saved order was not.');
      }
    }

    this._renderHotspotList();
    // Keep the pointer over the same button so a run of clicks keeps working;
    // at the end of the list that button is disabled, so fall back to the row.
    const row = this.hotspotList.children[to];
    if (row) {
      const again = row.querySelector(`[data-move="${direction}"]`);
      (again && !again.disabled ? again : row.querySelector('.editor-list-item')).focus();
    }
    this._markDirty();
    this._status(`"${hotspot.label || hotspot.id}" 순서를 옮겼습니다. ` +
                 `연결은 그대로입니다.`, 'ok');
  }

  _highlight(hotspot, on) {
    const entry = this.hotspots.entryFor(hotspot);
    if (entry) entry.element.classList.toggle('is-hovered', on);
  }

  _select(hotspot) {
    if (this.selected && this.selected !== hotspot) {
      const previous = this.hotspots.entryFor(this.selected);
      if (previous) previous.element.classList.remove('is-editing');
    }
    this.selected = hotspot || null;
    if (this.selected) {
      const entry = this.hotspots.entryFor(this.selected);
      if (entry) entry.element.classList.add('is-editing');
    }
    this._renderHotspotList();
    this._renderForm();
  }

  _renderForm() {
    const hotspot = this.selected;
    const show = (control, visible) => { control._row.hidden = !visible; };

    if (!hotspot) {
      this.form.hidden = true;
      this.pickBtn.disabled = true;
      this.deleteBtn.disabled = true;
      this.positionOut.textContent = '선택된 이동 포인트가 없습니다.';
      return;
    }

    this.form.hidden = false;
    this.pickBtn.disabled = false;
    this.deleteBtn.disabled = false;

    this.typeSelect.value = hotspot.type;
    show(this.targetSelect, hotspot.type === 'scene');
    show(this.videoInput, hotspot.type === 'vimeo');
    show(this.titleInput, hotspot.type !== 'scene');
    show(this.contentInput, hotspot.type === 'info');

    if (hotspot.type === 'scene') this.targetSelect.value = hotspot.target;
    this.labelInput.value = hotspot.label || '';
    // Show the address as it was typed, not just the id parsed out of it.
    this.videoInput.value = (hotspot._raw && hotspot._raw.videoId) || hotspot.videoId || '';
    this.titleInput.value = hotspot.title || '';
    this.contentInput.value = hotspot.content || '';

    this._renderPosition();
  }

  _renderPosition() {
    const hotspot = this.selected;
    if (!hotspot) return;
    this.positionOut.textContent =
      `yaw ${round(hotspot.yaw)} · pitch ${round(hotspot.pitch)}  ` +
      `(${radToDeg(hotspot.yaw)}° / ${radToDeg(hotspot.pitch)}°)`;
  }

  /** Writes one field to both the live model and the file it came from. */
  _writeField(key, value) {
    const hotspot = this.selected;
    if (!hotspot) return;
    hotspot[key] = value;
    if (hotspot._raw) {
      if (value === '' && key !== 'content') delete hotspot._raw[key];
      else hotspot._raw[key] = value;
    }
    this._markDirty();
  }

  /**
   * Takes a Vimeo id or a full address. The file keeps what was typed, which
   * is easier to read back; the live model keeps only the id and privacy hash
   * parsed out of it, so nothing unchecked can reach the iframe src. A value
   * that parses to nothing leaves the id empty, and _validate refuses to save.
   */
  _writeVideo(value) {
    const hotspot = this.selected;
    if (!hotspot) return;
    const video = extractVimeoVideo(value);
    hotspot.videoId = video ? video.id : '';
    hotspot.videoHash = video ? video.hash : null;
    if (hotspot._raw) {
      if (value) hotspot._raw.videoId = value;
      else delete hotspot._raw.videoId;
    }
    this._status(!value || video ? '' : '비메오 주소를 알아볼 수 없습니다.',
                 !value || video ? null : 'warn');
    this._markDirty();
  }

  /**
   * Points the selected arrow somewhere else. A caption that was showing the
   * old destination's name — or no caption at all — follows to the new one;
   * a caption someone phrased themselves is left exactly as written.
   */
  _changeTarget(targetId) {
    const hotspot = this.selected;
    if (!hotspot) return;
    const previous = this.config.sceneById.get(hotspot.target);
    const next = this.config.sceneById.get(targetId);

    const mirrored = !hotspot.label || (previous && hotspot.label === previous.name);
    this._writeField('target', targetId);
    if (next && mirrored) {
      this._writeField('label', next.name);
      this.labelInput.value = next.name;
    }
    this._rebuildSelected();
    this._renderHotspotList();
  }

  _changeType(type) {
    const hotspot = this.selected;
    if (!hotspot || hotspot.type === type) return;

    this._writeField('type', type);
    if (type === 'scene' && !hotspot.target) {
      this._writeField('target', this.targetSelect.value || this.config.scenes[0].id);
    }
    if (type === 'vimeo' && !hotspot.videoId) {
      this._status('비메오 영상 주소를 입력해야 저장 후에도 표시됩니다.', 'warn');
    }
    this._rebuildSelected();
    this._renderForm();
    this._renderHotspotList();
  }

  /** Re-renders the selected hotspot's DOM after a change of type/label/target. */
  _rebuildSelected() {
    if (!this.selected || !this.scene) return;
    this._rerenderHotspot(this.scene, this.selected);
    this._markDirty();
  }

  _addHotspot() {
    if (!this.scene) return;
    const view = this.tour.currentView() || { yaw: 0, pitch: 0.25 };

    // New points land in the middle of the screen, a little below the horizon:
    // where a floor-level arrow usually belongs.
    // A new arrow is captioned with where it goes. An empty caption would leave
    // a hotspot that says nothing on hover and announces nothing useful — and
    // the destination's name is what nearly every caption in a tour says.
    const target = this._suggestTarget();
    const rawHotspot = {
      id: this._uniqueHotspotId(),
      type: 'scene',
      target,
      yaw: round(view.yaw),
      pitch: round(Math.max(view.pitch, 0.2))
    };
    const label = (this.config.sceneById.get(target) || {}).name || '';
    if (label) rawHotspot.label = label;

    const hotspot = linkRaw(Object.assign({}, rawHotspot, {
      label, icon: null, perspective: null
    }), rawHotspot);

    this.scene.hotspots.push(hotspot);
    if (this.scene._raw) {
      if (!Array.isArray(this.scene._raw.hotspots)) this.scene._raw.hotspots = [];
      this.scene._raw.hotspots.push(rawHotspot);
    }

    const entry = this.hotspots.add(this.scene, hotspot);
    if (entry) this._arm(hotspot, entry.element);

    this._select(hotspot);
    this._markDirty();
    this._status('이동 포인트를 추가했습니다. 파노라마에서 끌어 위치를 잡으세요.', 'ok');
  }

  _uniqueHotspotId() {
    const used = new Set(this.scene.hotspots.map((hotspot) => hotspot.id));
    for (let n = 1; ; n++) {
      const candidate = `${this.scene.id}-hs${n}`;
      if (!used.has(candidate)) return candidate;
    }
  }

  /** First scene that this one does not already link to — usually the one wanted. */
  _suggestTarget() {
    const linked = new Set(this.scene.hotspots
      .filter((hotspot) => hotspot.type === 'scene')
      .map((hotspot) => hotspot.target));
    const free = this.config.scenes.find(
      (scene) => scene.id !== this.scene.id && !linked.has(scene.id));
    return (free || this.config.scenes[0]).id;
  }

  _deleteSelected() {
    const hotspot = this.selected;
    if (!hotspot || !this.scene) return;

    this.hotspots.remove(hotspot);
    const index = this.scene.hotspots.indexOf(hotspot);
    if (index >= 0) this.scene.hotspots.splice(index, 1);
    if (this.scene._raw && Array.isArray(this.scene._raw.hotspots)) {
      const rawIndex = this.scene._raw.hotspots.indexOf(hotspot._raw);
      if (rawIndex >= 0) this.scene._raw.hotspots.splice(rawIndex, 1);
    }

    this._select(null);
    this._markDirty();
    this._status('이동 포인트를 삭제했습니다.', 'ok');
  }

  _move(hotspot, yaw, pitch) {
    hotspot.yaw = round(yaw);
    hotspot.pitch = round(pitch);
    if (hotspot._raw) {
      hotspot._raw.yaw = hotspot.yaw;
      hotspot._raw.pitch = hotspot.pitch;
    }
    this.hotspots.move(hotspot);
    if (hotspot === this.selected) this._renderPosition();
    this._markDirty();
  }

  // --- dragging in the panorama -----------------------------------------

  /** Makes one rendered hotspot selectable and draggable. Idempotent. */
  _arm(hotspot, element) {
    if (this._armed.has(element)) return;
    this._armed.add(element);

    let dragging = false;
    let moved = false;

    element.addEventListener('pointerdown', (event) => {
      if (event.button != null && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      capture(element, event.pointerId, true);
      dragging = true;
      moved = false;
      this._select(hotspot);
    });

    element.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const coords = this._coordsFromEvent(event);
      if (!coords) return;
      moved = true;
      element.classList.add('is-dragging');
      this._move(hotspot, coords.yaw, coords.pitch);
    });

    const end = (event) => {
      if (!dragging) return;
      dragging = false;
      element.classList.remove('is-dragging');
      capture(element, event.pointerId, false);
      // A drag must not also fire the hotspot's navigate/open click.
      if (moved) this._swallowNextClick();
      moved = false;
    };
    element.addEventListener('pointerup', end);
    element.addEventListener('pointercancel', end);
  }

  /** Arms every hotspot rendered for a scene (they are built lazily). */
  _armScene(scene) {
    scene.hotspots.forEach((hotspot) => {
      const entry = this.hotspots.entryFor(hotspot);
      if (entry) this._arm(hotspot, entry.element);
    });
  }

  /**
   * Cancels the click that follows a drag. The listener sits on the document
   * in the capture phase so it runs before the hotspot's own click handler,
   * whichever order those were registered in.
   */
  _swallowNextClick() {
    this._suppressClick = true;
    window.setTimeout(() => { this._suppressClick = false; }, 350);
  }

  _coordsFromEvent(event) {
    const rect = this.panoElement.getBoundingClientRect();
    return this.tour.screenToCoordinates(
      event.clientX - rect.left,
      event.clientY - rect.top
    );
  }

  // --- click-to-place ----------------------------------------------------

  _bindPanorama() {
    document.addEventListener('click', (event) => {
      if (!this._suppressClick) return;
      // Only the panorama's own click needs cancelling — a drag that ends over
      // the editor panel must not eat the button press that follows it.
      if (!this.panoElement.contains(event.target)) return;
      this._suppressClick = false;
      event.stopPropagation();
      event.preventDefault();
    }, true);

    this.panoElement.addEventListener('click', (event) => {
      if (!this.picking || !this.selected) return;
      if (event.target.closest && event.target.closest('.hotspot')) return;

      const coords = this._coordsFromEvent(event);
      if (!coords) return;
      this._move(this.selected, coords.yaw, coords.pitch);
      this._togglePicking(false);
    });
  }

  _togglePicking(force) {
    this.picking = force != null ? force : !this.picking;
    this.pickBtn.textContent = this.picking ? '파노라마를 클릭하세요…' : '화면에서 위치 지정';
    this.pickBtn.classList.toggle('is-armed', this.picking);
    document.body.classList.toggle('editor-picking', this.picking);
  }

  // --- keyboard nudging --------------------------------------------------

  _bindKeyboard() {
    const STEP = 0.01;
    const BIG_STEP = 0.05;

    // Capture phase on window: Marzipano binds the arrow keys to panning on
    // `document`, so the nudge has to claim the event before that listener
    // ever sees it. Escape drops the selection and hands the keys back.
    window.addEventListener('keydown', (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // Never steal keys from a field the user is typing in.
      const tag = event.target && event.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (event.key === 'Escape' && this.selected) {
        this._togglePicking(false);
        this._select(null);
        return;
      }
      if (!this.selected) return;

      const step = event.shiftKey ? BIG_STEP : STEP;
      let { yaw, pitch } = this.selected;
      switch (event.key) {
        case 'ArrowLeft':  yaw -= step; break;
        case 'ArrowRight': yaw += step; break;
        case 'ArrowUp':    pitch -= step; break;
        case 'ArrowDown':  pitch += step; break;
        default: return;
      }
      event.preventDefault();
      event.stopPropagation();
      this._move(this.selected, yaw, pitch);
    }, true);
  }

  // --- minimap -----------------------------------------------------------

  _buildMapSection(body) {
    const heading = el('div', 'editor-section-head');
    heading.appendChild(el('span', 'editor-label', '미니맵 핀 위치'));
    body.appendChild(heading);

    this.mapOut = el('p', 'editor-picked', '—');
    body.appendChild(this.mapOut);

    const actions = el('div', 'editor-actions');
    this.clearMapBtn = el('button', 'editor-btn', '핀 없애기');
    this.clearMapBtn.type = 'button';
    this.clearMapBtn.addEventListener('click', () => {
      if (this.scene) this._placeScene(this.scene.id, null);
    });
    actions.appendChild(this.clearMapBtn);
    body.appendChild(actions);

    body.appendChild(el('p', 'editor-note', this.minimap
      ? '안내도에서 핀을 끌거나, 빈 곳을 클릭하면 현재 장면의 핀이 그곳으로 옮겨집니다.'
      : '미니맵이 꺼져 있습니다. tour.json 의 settings.minimap 을 확인하세요.'));

    if (!this.minimap) this.clearMapBtn.disabled = true;
  }

  /** Applies a minimap position (or clears it) for one scene. */
  _placeScene(sceneId, position) {
    const scene = this.config.sceneById.get(sceneId);
    if (!scene) return;

    if (position) {
      scene.map = { x: roundFraction(position.x), y: roundFraction(position.y) };
      if (scene._raw) scene._raw.map = scene.map;
    } else {
      scene.map = null;
      if (scene._raw) delete scene._raw.map;
    }

    if (this.minimap) this.minimap.updatePin(sceneId);
    if (scene === this.scene) this._renderMap();
    this._markDirty();
  }

  _renderMap() {
    const position = this.scene && this.scene.map;
    this.mapOut.textContent = position
      ? `x ${position.x} · y ${position.y}`
      : '이 장면은 안내도에 표시되지 않습니다.';
    this.clearMapBtn.disabled = !this.minimap || !position;
  }

  // --- the minimap panel itself -----------------------------------------

  _buildPanelSection(body) {
    const heading = el('div', 'editor-section-head');
    heading.appendChild(el('span', 'editor-label', '미니맵 패널'));
    this.panelWidthOut = el('span', 'editor-count', '—');
    heading.appendChild(this.panelWidthOut);
    body.appendChild(heading);

    const row = el('label', 'editor-row');
    row.appendChild(el('span', 'editor-label', '크기'));
    this.widthInput = document.createElement('input');
    this.widthInput.type = 'range';
    this.widthInput.min = String(MINIMAP_WIDTH_RANGE.min);
    this.widthInput.max = String(MINIMAP_WIDTH_RANGE.max);
    this.widthInput.step = '4';
    this.widthInput.addEventListener('input',
      () => this._setPanelWidth(Number(this.widthInput.value)));
    row.appendChild(this.widthInput);
    body.appendChild(row);

    this.cornerSelect = this._field(body, '기준 모서리', () => {
      const select = document.createElement('select');
      MINIMAP_CORNERS.forEach((corner) => {
        const option = document.createElement('option');
        option.value = corner;
        option.textContent = CORNER_LABELS[corner] || corner;
        select.appendChild(option);
      });
      select.addEventListener('change', () => {
        const current = this._panelGeometry();
        this._setPanelPosition({ corner: select.value, x: current.x, y: current.y });
      });
      return select;
    });

    this.panelPosOut = el('p', 'editor-picked', '—');
    body.appendChild(this.panelPosOut);

    const actions = el('div', 'editor-actions');
    this.resetPanelBtn = el('button', 'editor-btn', '처음 상태로');
    this.resetPanelBtn.type = 'button';
    this.resetPanelBtn.title = '편집기를 열었을 때의 크기와 위치로 되돌립니다';
    this.resetPanelBtn.addEventListener('click', () => {
      const { width, corner, x, y } = this._panelGeometryAtLoad;
      this._setPanelWidth(width);
      this._setPanelPosition({ corner, x, y });
    });
    actions.appendChild(this.resetPanelBtn);
    body.appendChild(actions);

    body.appendChild(el('p', 'editor-note', this.minimap
      ? '안내도 제목 줄을 끌면 패널이 통째로 움직이고, 놓은 자리에서 가장 가까운 ' +
        '모서리에 붙습니다. 그 모서리로부터의 여백이 저장됩니다.'
      : '미니맵이 꺼져 있어 조정할 것이 없습니다.'));

    if (!this.minimap) {
      this.widthInput.disabled = true;
      this.cornerSelect.disabled = true;
      this.resetPanelBtn.disabled = true;
      return;
    }
    // Snapshot for the reset button: "back to how it was when I opened this"
    // is more useful here than "back to the library default".
    this._panelGeometryAtLoad = this._panelGeometry();
    this._renderPanelGeometry();
  }

  /** The live minimap settings object, shared with js/minimap.js. */
  _panelGeometry() {
    const minimap = this.config.settings.minimap;
    return { width: minimap.width, ...minimap.position };
  }

  /** settings.minimap as it appears in tour.json, or null if it is not there. */
  _minimapRaw() {
    const settings = this.config.raw && this.config.raw.settings;
    if (!settings || !settings.minimap || typeof settings.minimap !== 'object') return null;
    return settings.minimap;
  }

  _setPanelWidth(width) {
    if (!this.minimap) return;
    const raw = this._minimapRaw();
    if (raw) raw.width = width;
    this.minimap.setWidth(width);
    this._renderPanelGeometry();
    this._markDirty();
  }

  _setPanelPosition(position) {
    if (!this.minimap) return;
    const raw = this._minimapRaw();
    if (raw) raw.position = { corner: position.corner, x: position.x, y: position.y };
    this.minimap.setPosition(position);
    this._renderPanelGeometry();
    this._markDirty();
  }

  _renderPanelGeometry() {
    if (!this.minimap) return;
    const geometry = this._panelGeometry();
    this.panelWidthOut.textContent = `${geometry.width}px`;
    this.widthInput.value = String(geometry.width);
    this.cornerSelect.value = geometry.corner;
    this.panelPosOut.textContent =
      `${CORNER_LABELS[geometry.corner] || geometry.corner} · ` +
      `가로 ${geometry.x}px · 세로 ${geometry.y}px`;
  }

  // --- saving ------------------------------------------------------------

  _buildSaveSection(body) {
    const actions = el('div', 'editor-actions');

    this.saveBtn = el('button', 'editor-btn editor-btn-primary', '저장');
    this.saveBtn.type = 'button';
    this.saveBtn.addEventListener('click', () => this._save());
    actions.appendChild(this.saveBtn);

    this.copyBtn = el('button', 'editor-btn', 'JSON 복사');
    this.copyBtn.type = 'button';
    this.copyBtn.addEventListener('click', () => this._copy());
    actions.appendChild(this.copyBtn);

    this.downloadBtn = el('button', 'editor-btn', '내려받기');
    this.downloadBtn.type = 'button';
    this.downloadBtn.addEventListener('click', () => this._download());
    actions.appendChild(this.downloadBtn);

    body.appendChild(actions);

    this.statusOut = el('p', 'editor-status', '');
    this.statusOut.setAttribute('role', 'status');
    body.appendChild(this.statusOut);

    this.saveNote = el('p', 'editor-note', '저장 가능 여부를 확인하는 중…');
    body.appendChild(this.saveNote);
  }

  /**
   * Asks the server, at startup, whether it will accept a save — so "you are
   * running a read-only server" is on screen before an hour of edits, not
   * after pressing 저장. A static host simply has no such endpoint.
   */
  async _probeSaving() {
    let info = null;
    try {
      const response = await fetch(SAVE_ENDPOINT, { cache: 'no-store' });
      if (response.ok) info = await response.json().catch(() => null);
    } catch (err) {
      /* no server, or nothing listening on that path */
    }

    this.canSave = Boolean(info && info.save === true);
    if (this.canSave) {
      this.saveNote.className = 'editor-note';
      this.saveNote.textContent = '저장하면 config/tour.json 에 바로 반영됩니다.';
      return;
    }
    this.saveNote.className = 'editor-note is-warn';
    this.saveNote.textContent =
      '이 서버는 저장을 받지 않습니다. --edit 를 붙여 다시 실행하세요 ' +
      '(예: start-windows.bat --edit). 그 전까지는 "내려받기"를 쓰세요.';
    this.saveBtn.title = '서버를 --edit 로 실행해야 저장할 수 있습니다';
  }

  _markDirty() {
    this.dirty = true;
    this.panel.classList.add('is-dirty');
  }

  _status(message, kind) {
    this.statusOut.textContent = message;
    this.statusOut.className = `editor-status${kind ? ' is-' + kind : ''}`;
  }

  /** Problems that would make a scene or hotspot disappear on the next load. */
  _validate() {
    const problems = [];
    this.config.scenes.forEach((scene) => {
      scene.hotspots.forEach((hotspot) => {
        if (hotspot.type === 'scene' && !this.config.sceneById.has(hotspot.target)) {
          problems.push(`${scene.id}/${hotspot.id}: 대상 장면 "${hotspot.target}" 없음`);
        }
        if (hotspot.type === 'vimeo' && !hotspot.videoId) {
          problems.push(`${scene.id}/${hotspot.id}: 비메오 영상 주소가 비었거나 잘못됨`);
        }
      });
    });
    return problems;
  }

  async _save() {
    const problems = this._validate();
    if (problems.length) {
      this._status(`저장하지 않았습니다 — ${problems[0]}`, 'error');
      console.warn('[tour] Editor found unsaveable hotspots:', problems);
      return;
    }

    const body = formatTourJson(this.config.raw);
    this.saveBtn.disabled = true;
    this._status('저장 중…');

    let response;
    try {
      response = await fetch(SAVE_ENDPOINT, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body
      });
    } catch (err) {
      this.saveBtn.disabled = false;
      // Either nothing is listening, or the server closed the connection on us.
      // The usual cause by far is a server started without --edit.
      this._status('서버에 저장하지 못했습니다. --edit 로 실행 중인지 확인하거나 ' +
                   '"내려받기"를 쓰세요.', 'error');
      console.warn('[tour] Save request failed:', err);
      return;
    }

    this.saveBtn.disabled = false;
    if (response.ok) {
      this.dirty = false;
      this.panel.classList.remove('is-dirty');
      const at = new Date().toLocaleTimeString();
      this._status(`config/tour.json 에 저장했습니다 (${at}).`, 'ok');
      return;
    }

    const detail = (await response.text().catch(() => '')).trim();
    if (response.status === 403) {
      // The server says saving is off; it also says how to turn it on.
      this._status(detail || '저장이 꺼져 있습니다. 서버를 --edit 로 실행하세요.', 'error');
    } else if (response.status === 404 || response.status === 405) {
      this._status('이 서버는 저장을 지원하지 않습니다. ' +
                   'tools/serve.py --edit 로 실행하거나 파일을 내려받으세요.', 'error');
    } else {
      this._status(`저장 실패 (HTTP ${response.status}). ${detail}`.trim(), 'error');
    }
    console.warn(`[tour] Save rejected: HTTP ${response.status}`, detail);
  }

  _download() {
    const blob = new Blob([formatTourJson(this.config.raw)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'tour.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    this._status('tour.json 을 내려받았습니다. config/ 폴더의 파일을 교체하세요.', 'ok');
  }

  async _copy() {
    const text = formatTourJson(this.config.raw);
    try {
      await navigator.clipboard.writeText(text);
      this._status('tour.json 전체를 클립보드에 복사했습니다.', 'ok');
    } catch (err) {
      // Clipboard access needs a secure context; the download always works.
      this._status('복사할 수 없습니다. "내려받기"를 사용하세요.', 'error');
    }
  }

  // --- scene changes -----------------------------------------------------

  _onSceneChange(scene) {
    this.scene = scene;
    this.sceneOut.textContent = `${scene.id}`;
    this._togglePicking(false);
    this._armScene(scene);
    this._select(null);
    this._renderMap();
    this._renderSceneSection();
  }
}

/** True when the page was opened with ?edit=1. */
export function isEditorRequested() {
  return new URLSearchParams(window.location.search).get('edit') === '1';
}
