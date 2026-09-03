/**
 * modal.js — a single accessible dialog reused by the youtube and info
 * hotspots.
 *
 * Behaviour that matters:
 *  - The YouTube iframe is created on open and REMOVED on close. Resetting src
 *    is not enough on every browser; removing the element guarantees playback
 *    and audio stop.
 *  - Escape closes, the backdrop closes, focus is trapped while open and
 *    returned to the element that opened the dialog.
 *  - Content is inserted with textContent / setAttribute, never as raw HTML
 *    from config.
 */

const FOCUSABLE = 'button, [href], input, select, textarea, iframe, [tabindex]:not([tabindex="-1"])';

export class Modal {
  /**
   * @param {object} elements  {root, dialog, backdrop, closeButton, title, body}
   * @param {{onOpen?: Function, onClose?: Function}} [callbacks]
   */
  constructor(elements, callbacks = {}) {
    this.root = elements.root;
    this.dialog = elements.dialog;
    this.backdrop = elements.backdrop;
    this.closeButton = elements.closeButton;
    this.titleEl = elements.title;
    this.bodyEl = elements.body;
    this.callbacks = callbacks;

    this.isOpen = false;
    this._lastFocused = null;

    this.closeButton.addEventListener('click', () => this.close());
    this.backdrop.addEventListener('click', () => this.close());

    // Bound once; attached only while the dialog is open.
    this._onKeydown = this._onKeydown.bind(this);
  }

  /** Opens the dialog with an already-built body element. */
  open({ title, content, openerElement }) {
    if (this.isOpen) this.close();

    this._lastFocused = openerElement || document.activeElement;

    this.titleEl.textContent = title || '';
    this.titleEl.hidden = !title;

    this.bodyEl.replaceChildren(content);

    this.root.hidden = false;
    // Force a frame so the CSS transition runs from the hidden state.
    requestAnimationFrame(() => this.root.classList.add('is-open'));

    document.addEventListener('keydown', this._onKeydown, true);
    document.body.classList.add('modal-open');
    this.isOpen = true;

    // Prefer the close button: predictable, and never steals a click into the iframe.
    this.closeButton.focus();

    if (this.callbacks.onOpen) this.callbacks.onOpen();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;

    this.root.classList.remove('is-open');
    this.root.hidden = true;
    document.removeEventListener('keydown', this._onKeydown, true);
    document.body.classList.remove('modal-open');

    // Destroying the children is what actually stops a YouTube video.
    this.bodyEl.replaceChildren();
    this.titleEl.textContent = '';

    if (this._lastFocused && document.contains(this._lastFocused)) {
      this._lastFocused.focus();
    }
    this._lastFocused = null;

    if (this.callbacks.onClose) this.callbacks.onClose();
  }

  _onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }
    if (event.key !== 'Tab') return;

    // Minimal focus trap across the dialog's focusable children.
    const focusable = Array.from(this.dialog.querySelectorAll(FOCUSABLE))
      .filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

/**
 * Builds the responsive 16:9 YouTube embed.
 *
 * The src is assembled from a validated 11-character video id (see
 * extractYouTubeId in config.js), so no config string is ever passed through
 * to the iframe untouched. youtube-nocookie.com is used for privacy.
 */
export function buildYouTubeEmbed(hotspot) {
  const wrapper = document.createElement('div');
  wrapper.className = 'video-frame';

  const iframe = document.createElement('iframe');
  const params = new URLSearchParams({
    autoplay: '1',
    rel: '0',
    modestbranding: '1',
    playsinline: '1'
  });
  if (hotspot.start) params.set('start', String(hotspot.start));

  iframe.setAttribute('src',
    `https://www.youtube-nocookie.com/embed/${hotspot.videoId}?${params.toString()}`);
  iframe.setAttribute('title', hotspot.title || 'Video');
  iframe.setAttribute('frameborder', '0');
  iframe.setAttribute('allow',
    'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
  iframe.setAttribute('allowfullscreen', '');
  iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');

  wrapper.appendChild(iframe);
  return wrapper;
}

/**
 * Builds the body of an info hotspot. Paragraphs are split on blank lines and
 * written with textContent, so configuration can never inject markup.
 */
export function buildInfoContent(hotspot) {
  const wrapper = document.createElement('div');
  wrapper.className = 'info-content';

  if (hotspot.image) {
    const img = document.createElement('img');
    img.setAttribute('src', hotspot.image);
    img.setAttribute('alt', '');
    img.setAttribute('loading', 'lazy');
    img.className = 'info-image';
    wrapper.appendChild(img);
  }

  const paragraphs = String(hotspot.content || '').split(/\n{2,}/);
  paragraphs.forEach((text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const p = document.createElement('p');
    p.textContent = trimmed;
    wrapper.appendChild(p);
  });

  return wrapper;
}
