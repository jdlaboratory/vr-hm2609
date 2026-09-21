/**
 * livereload.js — updates the open page when a source file changes on disk.
 *
 * Development only. app.js imports this module dynamically and only when the
 * page is served from this machine or a private network address, so a
 * deployed tour never downloads it, let alone asks a static host for an
 * endpoint it does not have.
 *
 * The server side is `GET /api/live` in tools/serve.py (and serve.js), which
 * exists only when the server was started with --live.
 *
 *   a .css change  → the stylesheet is swapped in place, so the panorama
 *                    keeps its position and the editor keeps its state
 *   anything else  → the page reloads; the current scene survives because
 *                    app.js keeps it in the URL
 */

const LIVE_ENDPOINT = 'api/live';

/**
 * Connects to the live-reload stream, if this server offers one.
 *
 * `beforeReload` is awaited before the page is replaced — the editor uses it
 * to land an autosave that is still on its debounce timer, so a change made a
 * moment before a code edit is not thrown away by the reload.
 */
export async function installLiveReload({ beforeReload } = {}) {
  let info = null;
  try {
    const response = await fetch(`${LIVE_ENDPOINT}?probe=1`, { cache: 'no-store' });
    if (response.ok) info = await response.json().catch(() => null);
  } catch (err) {
    /* not a dev server, or nothing listening on that path */
  }
  // Probing first matters: EventSource retries a 404 forever, so opening one
  // against a server without --live would poll the poor thing until the tab
  // closes.
  if (!info || info.live !== true) return;

  const source = new EventSource(LIVE_ENDPOINT);
  let session = null;
  let reloading = false;

  source.addEventListener('hello', (event) => {
    const next = readData(event).session || null;
    // EventSource reconnects by itself. If it comes back to a server with a
    // different id, that server was restarted — and the page it served is
    // from the old one.
    if (session !== null && next !== session) {
      reload('the server restarted');
      return;
    }
    session = next;
  });

  source.addEventListener('change', (event) => {
    if (readData(event).kind === 'css') {
      restyle();
      return;
    }
    reload('a source file changed');
  });

  // Nothing to do on error: the browser reconnects on its own, and the hello
  // handler above works out whether anything was missed.
  source.addEventListener('error', () => {});

  async function reload(why) {
    if (reloading) return;
    reloading = true;
    console.info(`[tour] Live reload — ${why}.`);
    source.close();
    if (beforeReload) {
      try {
        await beforeReload();
      } catch (err) {
        console.warn('[tour] Could not finish saving before reloading:', err);
      }
    }
    window.location.reload();
  }
}

function readData(event) {
  try {
    return JSON.parse(event.data) || {};
  } catch (err) {
    return {};
  }
}

/**
 * Re-fetches every local stylesheet under a fresh URL. The new sheet is added
 * before the old one is dropped, so the page never flashes unstyled.
 */
function restyle() {
  document.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
    const href = link.getAttribute('href');
    if (!href) return;
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) return;
    url.searchParams.set('live', Date.now().toString(36));

    const fresh = link.cloneNode(false);
    fresh.setAttribute('href', url.pathname + url.search);
    fresh.addEventListener('load', () => link.remove(), { once: true });
    // A failed reload leaves the page on the stylesheet it already had.
    fresh.addEventListener('error', () => fresh.remove(), { once: true });
    link.after(fresh);
  });
}
