/**
 * modal.js — a single accessible dialog reused by the vimeo and info
 * hotspots.
 *
 * Behaviour that matters:
 *  - The Vimeo iframe is created on open and REMOVED on close. Resetting src
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

    // Destroying the children is what actually stops a Vimeo video.
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
 * Builds the responsive 16:9 Vimeo embed.
 *
 * The src is assembled from a validated numeric video id and privacy hash (see
 * extractVimeoVideo in config.js), so no config string is ever passed through
 * to the iframe untouched. `dnt=1` asks the player not to track the visitor.
 */
export function buildVimeoEmbed(hotspot) {
  if (!hotspot.videoId2) return buildVimeoFrame(hotspot, true);

  // Two videos stack vertically. Only the first autoplays, so two soundtracks
  // never start over each other; the second carries its own title above it.
  const stack = document.createElement('div');
  stack.className = 'video-stack';
  stack.appendChild(buildVimeoFrame(hotspot, true));

  const caption = document.createElement('h3');
  caption.className = 'video-caption';
  caption.textContent = hotspot.title2 || '';
  caption.hidden = !hotspot.title2;
  stack.appendChild(caption);

  stack.appendChild(buildVimeoFrame({
    videoId: hotspot.videoId2,
    videoHash: hotspot.videoHash2,
    title: hotspot.title2 || hotspot.title
  }, false));
  return stack;
}

/** One 16:9 player for a single {videoId, videoHash, title, start}. */
function buildVimeoFrame(video, autoplay) {
  const wrapper = document.createElement('div');
  wrapper.className = 'video-frame';

  const iframe = document.createElement('iframe');
  const params = new URLSearchParams({
    autoplay: autoplay ? '1' : '0',
    byline: '0',
    portrait: '0',
    title: '0',
    dnt: '1'
  });
  // An unlisted video only plays when its privacy hash travels with the id.
  if (video.videoHash) params.set('h', video.videoHash);

  // Vimeo takes the start offset as a fragment, not as a query parameter.
  const start = video.start ? `#t=${video.start}s` : '';

  iframe.setAttribute('src',
    `https://player.vimeo.com/video/${video.videoId}?${params.toString()}${start}`);
  iframe.setAttribute('title', video.title || 'Video');
  iframe.setAttribute('frameborder', '0');
  iframe.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture; encrypted-media');
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
