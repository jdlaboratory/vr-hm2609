#!/usr/bin/env python3
"""
serve.py — the tiny local web server behind the double-click launchers.

The tour fetches config/tour.json, which browsers refuse to do for file://
pages, so it has to be served over http://. This does exactly that and nothing
else: no dependencies, no install, standard library only.

    python3 tools/serve.py              # serve and open a browser
    python3 tools/serve.py --edit       # open the editor, and let it save
    python3 tools/serve.py --lan        # also reachable from a phone on the same Wi-Fi
    python3 tools/serve.py --port 9000  # pick the port yourself
    python3 tools/serve.py --no-browser
    python3 tools/serve.py --live       # reload the page when a source file changes
    python3 tools/serve.py --autosave   # the editor writes every change, no button

With --edit the server also accepts `PUT /api/tour-config`, which is how the
editor's 저장 button writes config/tour.json. Without it the server is
read-only, so a stray request cannot rewrite the tour.

--live watches index.html, css/ and js/ and pushes a message over
`GET /api/live` (server-sent events) when one of them changes: a .css edit is
swapped into the open page, anything else reloads it. --autosave tells the
editor, through `GET /api/tour-config`, to save on every change instead of
waiting for the button. Both are development conveniences and are off unless
asked for.

Stop it with Ctrl+C.
"""

import argparse
import functools
import http.server
import json
import os
import re
import shutil
import socket
import sys
import threading
import time
import webbrowser

MINIMUM_PYTHON = (3, 7)
if sys.version_info < MINIMUM_PYTHON:
    sys.exit('This script needs Python %d.%d or newer (found %s).'
             % (MINIMUM_PYTHON[0], MINIMUM_PYTHON[1], sys.version.split()[0]))

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# The editor's save target. Only this one file can ever be written, and only
# when the server was started with --edit.
SAVE_PATH = '/api/tour-config'
CONFIG_FILE = os.path.join(PROJECT_ROOT, 'config', 'tour.json')
MAX_CONFIG_BYTES = 8 * 1024 * 1024
ALLOW_SAVE = False
ALLOW_AUTOSAVE = False

# One .bak per server run, taken before the first save: with --autosave the
# file is rewritten every second or so, and a .bak from a second ago is not an
# undo. This way it holds the tour as it was when you started the session.
BACKUP_WRITTEN = False

# Live reload. The watcher polls mtimes rather than using a platform file-watch
# API: it is a handful of files, and this behaves the same on every OS with no
# dependency to install.
LIVE_PATH = '/api/live'
LIVE_ENABLED = False
LIVE_WATCH = ('index.html', 'css', 'js')
LIVE_SUFFIXES = ('.html', '.css', '.js', '.mjs')
LIVE_POLL_SECONDS = 0.4
LIVE_HEARTBEAT_SECONDS = 20

# Bumped once per detected change; the SSE streams wait on it. SESSION_ID lets
# a reconnecting browser notice it is talking to a *restarted* server and
# reload — which is what you want after editing serve.py itself.
SESSION_ID = '%d-%d' % (os.getpid(), time.time() * 1000)
_live_lock = threading.Condition()
_live_version = 0
_live_kind = 'reload'


def watched_files():
    """Every source file live reload cares about. Never config/tour.json —
    the editor writes that itself, and reloading on it would fight autosave."""
    for entry in LIVE_WATCH:
        target = os.path.join(PROJECT_ROOT, entry)
        if os.path.isfile(target):
            yield target
            continue
        for root, dirs, names in os.walk(target):
            dirs[:] = [name for name in dirs if not name.startswith('.')]
            for name in names:
                if name.endswith(LIVE_SUFFIXES):
                    yield os.path.join(root, name)


def snapshot_sources():
    """path -> mtime for everything watched. Unreadable files are skipped, so
    a file being rewritten under us shows up as a change rather than a crash."""
    seen = {}
    for path in watched_files():
        try:
            seen[path] = os.stat(path).st_mtime_ns
        except OSError:
            pass
    return seen


def watch_sources():
    """Announces changes to the open pages. Runs on its own daemon thread."""
    global _live_version, _live_kind
    previous = snapshot_sources()
    while True:
        time.sleep(LIVE_POLL_SECONDS)
        current = snapshot_sources()
        if current == previous:
            continue
        changed = sorted(path for path in set(current) | set(previous)
                         if current.get(path) != previous.get(path))
        previous = current
        # Styles can be swapped into the running page; anything else means the
        # loaded JavaScript is stale, and only a reload fixes that.
        kind = 'css' if all(path.endswith('.css') for path in changed) else 'reload'
        with _live_lock:
            _live_version += 1
            _live_kind = kind
            _live_lock.notify_all()
        print('  %-7s %s' % ('restyle' if kind == 'css' else 'reload',
                             ', '.join(os.path.relpath(p, PROJECT_ROOT) for p in changed)))
        sys.stdout.flush()

# Read-only: the editor asks what panoramas exist so "add a viewpoint" can
# offer the ones not in the tour yet, instead of asking for a typed path.
PANORAMA_PATH = '/api/panoramas'
PANORAMA_DIR = os.path.join(PROJECT_ROOT, 'assets', 'panoramas', 'equirect')
# sceneNN_0.jpg / sceneNN_1.jpg — the level suffix is stripped to get the id.
PANORAMA_FILE_RE = re.compile(r'^(.+)_\d+\.(?:jpg|jpeg|png|webp)$', re.IGNORECASE)


def available_scene_ids():
    """Scene ids that have a web panorama on disk, whether in the tour or not."""
    try:
        names = os.listdir(PANORAMA_DIR)
    except OSError:
        return []
    found = set()
    for name in names:
        match = PANORAMA_FILE_RE.match(name)
        if match:
            found.add(match.group(1))
    return sorted(found)


def describe_bad_tour(parsed):
    """Returns why `parsed` is not a usable tour, or None if it looks like one.

    The bar is what js/config.js needs to draw a scene: an id and a panorama
    block, for every scene. Checking only for a "scenes" array is not enough —
    one stray request with a plausible shape would replace the whole tour, and
    the single .bak copy is gone the second time it happens.
    """
    if not isinstance(parsed, dict):
        return 'the body is not a JSON object'
    scenes = parsed.get('scenes')
    if not isinstance(scenes, list) or not scenes:
        return 'no "scenes" array'
    for index, scene in enumerate(scenes):
        where = 'scene #%d' % (index + 1)
        if not isinstance(scene, dict):
            return '%s is not an object' % where
        if not isinstance(scene.get('id'), str) or not scene['id']:
            return '%s has no "id"' % where
        if not isinstance(scene.get('panorama'), dict):
            return 'scene "%s" has no "panorama" block' % scene['id']
    return None


# Content types the tour depends on. Some Windows installations have a broken
# registry entry for .js, which breaks ES modules, so these are set explicitly.
EXTRA_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.md': 'text/markdown; charset=utf-8',
    '': 'application/octet-stream',
}


class TourRequestHandler(http.server.SimpleHTTPRequestHandler):
    """Static file handler with sane content types and edit-friendly caching."""

    extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map)
    extensions_map.update(EXTRA_TYPES)

    def end_headers(self):
        path = self.path.split('?', 1)[0]
        if path.startswith('/api/'):
            # Answers about the server's own state, and the live-reload stream.
            # A cached copy of either is worse than useless.
            self.send_header('Cache-Control', 'no-store')
        elif path.endswith(('.json', '.html', '.js', '.css')) or path.endswith('/'):
            # Always re-read the files you edit, so a reload shows your changes.
            self.send_header('Cache-Control', 'no-store, must-revalidate')
        else:
            # Panoramas and tiles never change once generated.
            self.send_header('Cache-Control', 'max-age=3600')
        super().end_headers()

    def do_GET(self):
        """Two small read-only endpoints for the editor, then static files."""
        path = self.path.split('?', 1)[0]
        if path == SAVE_PATH:            # will this server accept a save?
            self._send_json({'save': ALLOW_SAVE, 'autosave': ALLOW_SAVE and ALLOW_AUTOSAVE})
            return
        if path == PANORAMA_PATH:        # what panoramas could be added?
            self._send_json({'scenes': available_scene_ids()})
            return
        if path == LIVE_PATH:            # live reload: probe, then the stream
            if '?probe=1' in self.path:
                self._send_json({'live': LIVE_ENABLED})
            else:
                self._stream_live()
            return
        super().do_GET()

    def _stream_live(self):
        """Holds the connection open and writes an event on every change.

        One thread per open page, which is what a dev server can afford. The
        browser's EventSource reconnects by itself, so a dropped stream — or a
        restarted server — costs nothing.
        """
        if not LIVE_ENABLED:
            self._refuse(404, 'Live reload is off. Restart the server with --live.')
            return
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
        self.end_headers()

        with _live_lock:
            seen = _live_version
        try:
            self._send_event('hello', {'session': SESSION_ID})
            while True:
                kind = None
                with _live_lock:
                    if _live_version == seen:
                        _live_lock.wait(LIVE_HEARTBEAT_SECONDS)
                    if _live_version != seen:
                        seen = _live_version
                        kind = _live_kind
                if kind is None:
                    # A comment line: keeps proxies and sleeping laptops from
                    # quietly dropping an idle connection.
                    self.wfile.write(b': keep-alive\n\n')
                    self.wfile.flush()
                else:
                    self._send_event('change', {'kind': kind})
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass   # the page went away; nothing to clean up

    def _send_event(self, name, value):
        self.wfile.write(('event: %s\ndata: %s\n\n'
                          % (name, json.dumps(value))).encode('utf-8'))
        self.wfile.flush()

    def do_PUT(self):
        """Writes config/tour.json for the editor's save button."""
        # Read the body before deciding anything, refusals included: replying
        # while the client is still sending can reset the connection, and the
        # editor would report an unreachable server rather than the real reason.
        try:
            length = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            length = 0
        if length <= 0:
            self._refuse(411, 'A Content-Length is required')
            return
        if length > MAX_CONFIG_BYTES:
            self._refuse(413, 'That is far larger than a tour config')
            return
        body = self.rfile.read(length)

        if self.path.split('?', 1)[0] != SAVE_PATH:
            self._refuse(404, 'Not found')
            return
        if not ALLOW_SAVE:
            self._refuse(403, 'Saving is off. Restart the server with --edit '
                              '(for example: start-windows.bat --edit).')
            return

        try:
            parsed = json.loads(body.decode('utf-8'))
        except (UnicodeDecodeError, ValueError) as err:
            self._refuse(400, 'Not valid JSON: %s' % err)
            return
        # Refuse anything that is not recognisably a tour, so a misdirected
        # request cannot leave the project without a config.
        problem = describe_bad_tour(parsed)
        if problem:
            self._refuse(400, 'Not a tour config: %s' % problem)
            return

        try:
            written = self._write_config(body)
        except OSError as err:
            self._refuse(500, 'Could not write config/tour.json: %s' % err)
            return

        # Autosave fires on a timer, so plenty of saves carry no change at all.
        # Saying so every time would bury the ones that matter.
        if written:
            print('  saved   config/tour.json  (%d scenes)' % len(parsed['scenes']))
            sys.stdout.flush()
        self._send_json({'ok': True, 'scenes': len(parsed['scenes']), 'written': written})

    def _send_json(self, value):
        payload = json.dumps(value).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _refuse(self, code, message):
        """Like send_error, but plain text.

        send_error wraps the reason in an HTML error page, and the editor shows
        the response body to the user — a page of markup where a sentence was
        meant to be. Node's server answers in plain text; match it.
        """
        payload = message.encode('utf-8')
        self.send_response(code, message.split('.')[0])
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
        sys.stderr.write('  %d %s: %s\n' % (code, self.path, message))

    @staticmethod
    def _write_config(body):
        """Keeps one undo copy, then replaces the file in a single step.

        Returns False when the file already holds exactly this content: with
        autosave most requests are no-ops, and rewriting the file anyway would
        churn the disk and make the live-reload watcher jumpy for nothing.
        """
        global BACKUP_WRITTEN
        os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
        try:
            with open(CONFIG_FILE, 'rb') as handle:
                if handle.read() == body:
                    return False
        except OSError:
            pass                      # no file yet, or unreadable: write it
        if os.path.isfile(CONFIG_FILE) and not BACKUP_WRITTEN:
            shutil.copyfile(CONFIG_FILE, CONFIG_FILE + '.bak')
            BACKUP_WRITTEN = True
        temporary = CONFIG_FILE + '.tmp'
        with open(temporary, 'wb') as handle:
            handle.write(body)
        os.replace(temporary, CONFIG_FILE)
        return True

    def log_message(self, fmt, *args):
        """Stay quiet about successful requests; report problems."""
        status = args[1] if len(args) > 1 else ''
        if str(status).startswith(('4', '5')):
            sys.stderr.write('  %s %s\n' % (status, args[0] if args else ''))

    def log_error(self, *args):
        pass  # already covered by log_message


def start_server(host, preferred_port):
    """Binds the first free port at or after `preferred_port`."""
    handler = functools.partial(TourRequestHandler, directory=PROJECT_ROOT)
    last_error = None
    for port in range(preferred_port, preferred_port + 40):
        try:
            server = http.server.ThreadingHTTPServer((host, port), handler)
            return server, port
        except OSError as err:
            last_error = err
            continue
    raise SystemExit('Could not find a free port near %d: %s' % (preferred_port, last_error))


def local_ip_address():
    """Best guess at this machine's address on the local network."""
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(('8.8.8.8', 80))   # no packets are sent; this just picks a route
        return probe.getsockname()[0]
    except OSError:
        return None
    finally:
        probe.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--port', type=int, default=8000, help='preferred port (default 8000)')
    parser.add_argument('--edit', action='store_true',
                        help='open the browser with ?edit=1 and let the editor '
                             'save config/tour.json')
    parser.add_argument('--lan', action='store_true',
                        help='also accept connections from other devices on this network')
    parser.add_argument('--no-browser', action='store_true', help='do not open a browser')
    parser.add_argument('--live', action='store_true',
                        help='reload the open page when index.html, css/ or js/ changes')
    parser.add_argument('--autosave', action='store_true',
                        help='the editor saves every change by itself (implies --edit)')
    args = parser.parse_args()

    if not os.path.isfile(os.path.join(PROJECT_ROOT, 'index.html')):
        sys.exit('index.html was not found next to tools/. Is the project folder complete?')

    global ALLOW_SAVE, ALLOW_AUTOSAVE, LIVE_ENABLED
    # Autosave is meaningless on a server that refuses to save, so it turns
    # editing on rather than failing with a flag combination to puzzle out.
    ALLOW_SAVE = args.edit or args.autosave
    ALLOW_AUTOSAVE = args.autosave
    LIVE_ENABLED = args.live

    host = '0.0.0.0' if args.lan else '127.0.0.1'
    server, port = start_server(host, args.port)

    suffix = '?edit=1' if ALLOW_SAVE else ''
    url = 'http://localhost:%d/%s' % (port, suffix)

    print()
    print('  360 Virtual Tour is running.')
    print()
    print('    Tour      %s' % ('http://localhost:%d/' % port))
    print('    Editor    %s' % ('http://localhost:%d/?edit=1' % port))
    if args.lan:
        ip = local_ip_address()
        if ip:
            print('    Phone     http://%s:%d/     (same Wi-Fi)' % (ip, port))
        else:
            print('    Phone     could not determine this machine\'s network address')
    print()
    if ALLOW_SAVE:
        print('  Editing is on: the editor can overwrite config/tour.json.')
        if ALLOW_AUTOSAVE:
            print('  Autosave is on: every change is written, no button to press.')
            print('  config/tour.json.bak keeps the tour as it was when this server started.')
        if args.lan:
            print('  With --lan, anyone on this network can too. Use it on a network you trust.')
        print()
    if LIVE_ENABLED:
        print('  Live reload is on: editing index.html, css/ or js/ updates the page.')
        print()
    print('  Press Ctrl+C to stop.')
    print()
    sys.stdout.flush()   # so the URLs appear immediately even when redirected

    if LIVE_ENABLED:
        # Daemon: Ctrl+C should not have to wait for a sleeping poller.
        threading.Thread(target=watch_sources, daemon=True).start()

    if not args.no_browser:
        threading.Timer(0.4, webbrowser.open, args=(url,)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n  Stopping...')
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
