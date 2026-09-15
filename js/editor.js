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

import { linkRaw } from './config.js';

/** Where the dev server accepts the edited file. Relative: the tour may be
 *  served from a subdirectory. */
const SAVE_ENDPOINT = 'api/tour-config';

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
    this.onNavigate = services.onNavigate;

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

    if (this.minimap) {
      this.minimap.setEditable(true);
      this.minimap.onPlace((sceneId, position) => this._placeScene(sceneId, position));
    }

    document.body.classList.add('editor-active');
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
    this._buildHotspotSection(body);
    body.appendChild(el('hr', 'editor-rule'));
    this._buildMapSection(body);
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
      [['scene', '이동 (다른 장면)'],
       ['youtube', '유튜브 영상'],
       ['info', '정보 패널']].forEach(([value, text]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
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
      select.addEventListener('change', () => {
        this._writeField('target', select.value);
        this._rebuildSelected();
      });
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

    this.videoInput = this._field(this.form, '영상 ID 또는 URL', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'dQw4w9WgXcQ';
      input.addEventListener('input', () => this._writeField('videoId', input.value.trim()));
      return input;
    }, 'row-youtube');

    this.titleInput = this._field(this.form, '제목', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = '이 공간에 대하여';
      input.addEventListener('input', () => this._writeField('title', input.value));
      return input;
    }, 'row-info row-youtube');

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

    hotspots.forEach((hotspot) => {
      const item = el('li');
      const button = el('button', 'editor-list-item');
      button.type = 'button';
      button.classList.toggle('is-selected', hotspot === this.selected);

      const target = hotspot.type === 'scene'
        ? (this.config.sceneById.get(hotspot.target) || {}).name || hotspot.target
        : hotspot.type;
      button.appendChild(el('span', 'editor-list-name', hotspot.label || hotspot.id));
      button.appendChild(el('span', 'editor-list-meta', target));

      button.addEventListener('click', () => this._select(hotspot));
      // Hovering the list highlights the hotspot out in the panorama.
      button.addEventListener('pointerenter', () => this._highlight(hotspot, true));
      button.addEventListener('pointerleave', () => this._highlight(hotspot, false));

      item.appendChild(button);
      this.hotspotList.appendChild(item);
    });
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
    show(this.videoInput, hotspot.type === 'youtube');
    show(this.titleInput, hotspot.type !== 'scene');
    show(this.contentInput, hotspot.type === 'info');

    if (hotspot.type === 'scene') this.targetSelect.value = hotspot.target;
    this.labelInput.value = hotspot.label || '';
    this.videoInput.value = hotspot.videoId || '';
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

  _changeType(type) {
    const hotspot = this.selected;
    if (!hotspot || hotspot.type === type) return;

    this._writeField('type', type);
    if (type === 'scene' && !hotspot.target) {
      this._writeField('target', this.targetSelect.value || this.config.scenes[0].id);
    }
    if (type === 'youtube' && !hotspot.videoId) {
      this._status('유튜브 영상 ID를 입력해야 저장 후에도 표시됩니다.', 'warn');
    }
    this._rebuildSelected();
    this._renderForm();
    this._renderHotspotList();
  }

  /** Re-renders the selected hotspot's DOM after a change of type/label/target. */
  _rebuildSelected() {
    const hotspot = this.selected;
    if (!hotspot || !this.scene) return;
    this.hotspots.remove(hotspot);
    const entry = this.hotspots.add(this.scene, hotspot);
    if (entry) {
      this._arm(hotspot, entry.element);
      entry.element.classList.add('is-editing');
    }
    this._markDirty();
  }

  _addHotspot() {
    if (!this.scene) return;
    const view = this.tour.currentView() || { yaw: 0, pitch: 0.25 };

    // New points land in the middle of the screen, a little below the horizon:
    // where a floor-level arrow usually belongs.
    // No "label" key until there is a label to put in it: an empty string would
    // be written to the file and read back as a hotspot with a blank caption.
    const rawHotspot = {
      id: this._uniqueHotspotId(),
      type: 'scene',
      target: this._suggestTarget(),
      yaw: round(view.yaw),
      pitch: round(Math.max(view.pitch, 0.2))
    };
    const hotspot = linkRaw(Object.assign({}, rawHotspot, {
      label: '', icon: null, perspective: null
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
    heading.appendChild(el('span', 'editor-label', '미니맵 위치'));
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
        if (hotspot.type === 'youtube' && !hotspot.videoId) {
          problems.push(`${scene.id}/${hotspot.id}: 영상 ID 비어 있음`);
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
      this._status('로컬 서버에 연결하지 못했습니다. 대신 파일을 내려받으세요.', 'error');
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

    const detail = await response.text().catch(() => '');
    if (response.status === 404 || response.status === 405) {
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
  }
}

/** True when the page was opened with ?edit=1. */
export function isEditorRequested() {
  return new URLSearchParams(window.location.search).get('edit') === '1';
}
