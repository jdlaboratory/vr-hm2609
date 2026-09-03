/**
 * editor.js — developer-only hotspot positioning tool.
 *
 * Loaded and initialised ONLY when the page URL carries ?edit=1, so nothing in
 * this file executes for visitors. It never writes to tour.json; it generates
 * JSON for you to paste in.
 *
 * Workflow:
 *   1. Drag the panorama until the target is on screen.
 *   2. Click "Pick position", then click the spot in the panorama.
 *   3. Choose the hotspot type and fill in the fields.
 *   4. Copy the generated JSON into the scene's "hotspots" array.
 */

/** Radians rounded to 3 decimals — plenty for hotspot placement. */
function round(value) {
  return Math.round(value * 1000) / 1000;
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

export class Editor {
  /**
   * @param {import('./tour.js').Tour} tour
   * @param {{scenes: Array, sceneById: Map}} config
   * @param {HTMLElement} panoElement  the Marzipano container (for click coords)
   */
  constructor(tour, config, panoElement) {
    this.tour = tour;
    this.config = config;
    this.panoElement = panoElement;
    this.picking = false;
    this.picked = null;

    this._buildPanel();
    this._bindPanorama();

    this.tour.onViewChange((view) => this._renderView(view));
    this.tour.onSceneChange((scene) => {
      this.sceneIdOut.textContent = scene.id;
      this._renderJson();
    });

    document.body.classList.add('editor-active');
    console.info('[tour] Editor mode active (?edit=1). Remove the query parameter for production.');
  }

  // ------------------------------------------------------------------ panel

  _buildPanel() {
    const panel = el('aside', 'editor');
    panel.setAttribute('aria-label', 'Hotspot editor');

    // --- header -----------------------------------------------------------
    const header = el('div', 'editor-header');
    header.appendChild(el('h2', 'editor-title', 'Hotspot editor'));
    this.collapseBtn = el('button', 'editor-collapse', '–');
    this.collapseBtn.type = 'button';
    this.collapseBtn.setAttribute('aria-label', 'Collapse editor');
    this.collapseBtn.addEventListener('click', () => {
      const collapsed = panel.classList.toggle('is-collapsed');
      this.collapseBtn.textContent = collapsed ? '+' : '–';
      this.collapseBtn.setAttribute('aria-label', collapsed ? 'Expand editor' : 'Collapse editor');
    });
    header.appendChild(this.collapseBtn);
    panel.appendChild(header);

    const body = el('div', 'editor-body');
    panel.appendChild(body);

    // --- live view readout (debug mode) -----------------------------------
    const readout = el('div', 'editor-readout');
    this.sceneIdOut = el('code', null, '—');
    this.yawOut = el('code', null, '0');
    this.pitchOut = el('code', null, '0');
    this.fovOut = el('code', null, '0');

    [['Scene', this.sceneIdOut], ['Yaw', this.yawOut],
     ['Pitch', this.pitchOut], ['FOV', this.fovOut]].forEach(([label, node]) => {
      const row = el('div', 'editor-readout-row');
      row.appendChild(el('span', 'editor-readout-label', label));
      row.appendChild(node);
      readout.appendChild(row);
    });
    body.appendChild(readout);

    this.copyViewBtn = el('button', 'editor-btn', 'Copy current view');
    this.copyViewBtn.type = 'button';
    this.copyViewBtn.addEventListener('click', () => this._copyCurrentView());
    body.appendChild(this.copyViewBtn);

    body.appendChild(el('hr', 'editor-rule'));

    // --- position picker ---------------------------------------------------
    this.pickBtn = el('button', 'editor-btn editor-btn-primary', 'Pick position');
    this.pickBtn.type = 'button';
    this.pickBtn.addEventListener('click', () => this._togglePicking());
    body.appendChild(this.pickBtn);

    this.pickedOut = el('p', 'editor-picked', 'No position picked yet.');
    body.appendChild(this.pickedOut);

    // --- hotspot form ------------------------------------------------------
    const form = el('div', 'editor-form');

    this.typeSelect = this._field(form, 'Type', () => {
      const select = document.createElement('select');
      [['scene', 'Scene (navigate)'],
       ['youtube', 'YouTube video'],
       ['info', 'Info panel']].forEach(([value, text]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        select.appendChild(option);
      });
      select.addEventListener('change', () => this._syncFields());
      return select;
    });

    this.idInput = this._field(form, 'Hotspot id', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'auto';
      input.addEventListener('input', () => this._renderJson());
      return input;
    });

    this.labelInput = this._field(form, 'Label', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Move to Hall';
      input.addEventListener('input', () => this._renderJson());
      return input;
    });

    // scene-only
    this.targetRow = null;
    this.targetSelect = this._field(form, 'Target scene', () => {
      const select = document.createElement('select');
      this.config.scenes.forEach((scene) => {
        const option = document.createElement('option');
        option.value = scene.id;
        option.textContent = `${scene.name} (${scene.id})`;
        select.appendChild(option);
      });
      select.addEventListener('change', () => this._renderJson());
      return select;
    }, 'row-scene');

    // youtube-only
    this.videoInput = this._field(form, 'Video id or URL', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'dQw4w9WgXcQ';
      input.addEventListener('input', () => this._renderJson());
      return input;
    }, 'row-youtube');

    // info-only
    this.titleInput = this._field(form, 'Title', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'About this room';
      input.addEventListener('input', () => this._renderJson());
      return input;
    }, 'row-info');

    this.contentInput = this._field(form, 'Content', () => {
      const area = document.createElement('textarea');
      area.rows = 3;
      area.placeholder = 'Body text. Blank lines start a new paragraph.';
      area.addEventListener('input', () => this._renderJson());
      return area;
    }, 'row-info');

    body.appendChild(form);

    // --- output ------------------------------------------------------------
    this.jsonOut = document.createElement('textarea');
    this.jsonOut.className = 'editor-json';
    this.jsonOut.rows = 9;
    this.jsonOut.readOnly = true;
    this.jsonOut.setAttribute('aria-label', 'Generated hotspot JSON');
    body.appendChild(this.jsonOut);

    const actions = el('div', 'editor-actions');
    this.copyJsonBtn = el('button', 'editor-btn editor-btn-primary', 'Copy JSON');
    this.copyJsonBtn.type = 'button';
    this.copyJsonBtn.addEventListener('click', () => this._copy(this.jsonOut.value, this.copyJsonBtn, 'Copy JSON'));
    actions.appendChild(this.copyJsonBtn);

    const resetBtn = el('button', 'editor-btn', 'Reset view');
    resetBtn.type = 'button';
    resetBtn.addEventListener('click', () => this.tour.resetView());
    actions.appendChild(resetBtn);
    body.appendChild(actions);

    body.appendChild(el('p', 'editor-note',
      'Paste the JSON into the matching scene’s "hotspots" array in config/tour.json, then reload.'));

    document.body.appendChild(panel);
    this.panel = panel;

    this._syncFields();
    this._renderJson();
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

  /** Shows only the fields relevant to the selected hotspot type. */
  _syncFields() {
    const type = this.typeSelect.value;
    const show = (control, visible) => { control._row.hidden = !visible; };
    show(this.targetSelect, type === 'scene');
    show(this.videoInput, type === 'youtube');
    show(this.titleInput, type === 'info');
    show(this.contentInput, type === 'info');
    this._renderJson();
  }

  // ------------------------------------------------------------- picking

  _bindPanorama() {
    // Marzipano's canvas and control surface both live inside the pano element,
    // so a click anywhere on the panorama bubbles up to here.
    this.panoElement.addEventListener('click', (event) => {
      if (!this.picking) return;
      // Ignore clicks that landed on an existing hotspot button.
      if (event.target.closest && event.target.closest('.hotspot')) return;

      const rect = this.panoElement.getBoundingClientRect();
      const coords = this.tour.screenToCoordinates(
        event.clientX - rect.left,
        event.clientY - rect.top
      );
      if (!coords) return;

      this.picked = { yaw: round(coords.yaw), pitch: round(coords.pitch) };
      this._togglePicking(false);
      this._renderPicked();
      this._renderJson();
    });
  }

  _togglePicking(force) {
    this.picking = force != null ? force : !this.picking;
    this.pickBtn.textContent = this.picking ? 'Click in the panorama…' : 'Pick position';
    this.pickBtn.classList.toggle('is-armed', this.picking);
    document.body.classList.toggle('editor-picking', this.picking);
  }

  _renderPicked() {
    if (!this.picked) {
      this.pickedOut.textContent = 'No position picked yet.';
      return;
    }
    this.pickedOut.textContent =
      `yaw ${this.picked.yaw}  ·  pitch ${this.picked.pitch}   ` +
      `(${radToDeg(this.picked.yaw)}° / ${radToDeg(this.picked.pitch)}°)`;
  }

  // ------------------------------------------------------------- readout

  _renderView(view) {
    this.yawOut.textContent = `${round(view.yaw)}  (${radToDeg(view.yaw)}°)`;
    this.pitchOut.textContent = `${round(view.pitch)}  (${radToDeg(view.pitch)}°)`;
    this.fovOut.textContent = `${round(view.fov)}  (${radToDeg(view.fov)}°)`;
  }

  _copyCurrentView() {
    const view = this.tour.currentView();
    if (!view) return;
    const json = JSON.stringify(
      { yaw: round(view.yaw), pitch: round(view.pitch), fov: round(view.fov) }, null, 2);
    this._copy(json, this.copyViewBtn, 'Copy current view');
  }

  // ------------------------------------------------------------- JSON out

  /** Builds the hotspot object from the form + picked position. */
  buildHotspot() {
    const type = this.typeSelect.value;
    const position = this.picked || { yaw: 0, pitch: 0 };
    const label = this.labelInput.value.trim();

    const hotspot = {
      id: this.idInput.value.trim() || `${this.tour.currentSceneId() || 'scene'}-${type}-1`,
      type
    };

    if (type === 'scene') {
      hotspot.target = this.targetSelect.value;
    } else if (type === 'youtube') {
      hotspot.videoId = this.videoInput.value.trim() || 'REPLACE_WITH_VIDEO_ID';
    } else if (type === 'info') {
      hotspot.title = this.titleInput.value.trim() || 'Untitled';
      hotspot.content = this.contentInput.value;
    }

    hotspot.yaw = position.yaw;
    hotspot.pitch = position.pitch;
    if (label) hotspot.label = label;

    return hotspot;
  }

  _renderJson() {
    if (!this.jsonOut) return;
    this.jsonOut.value = JSON.stringify(this.buildHotspot(), null, 2);
  }

  // ------------------------------------------------------------- clipboard

  async _copy(text, button, originalLabel) {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch (err) {
      // Clipboard API needs a secure context; fall back to selecting the text.
      this.jsonOut.select();
      ok = document.execCommand && document.execCommand('copy');
    }
    button.textContent = ok ? 'Copied' : 'Press Ctrl+C';
    window.setTimeout(() => { button.textContent = originalLabel; }, 1400);
  }
}

/** True when the page was opened with ?edit=1. */
export function isEditorRequested() {
  return new URLSearchParams(window.location.search).get('edit') === '1';
}
