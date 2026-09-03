#!/usr/bin/env python3
"""
serve.py — the tiny local web server behind the double-click launchers.

The tour fetches config/tour.json, which browsers refuse to do for file://
pages, so it has to be served over http://. This does exactly that and nothing
else: no dependencies, no install, standard library only.

    python3 tools/serve.py              # serve and open a browser
    python3 tools/serve.py --edit       # open straight into the hotspot editor
    python3 tools/serve.py --lan        # also reachable from a phone on the same Wi-Fi
    python3 tools/serve.py --port 9000  # pick the port yourself
    python3 tools/serve.py --no-browser

Stop it with Ctrl+C.
"""

import argparse
import functools
import http.server
import os
import socket
import sys
import threading
import webbrowser

MINIMUM_PYTHON = (3, 7)
if sys.version_info < MINIMUM_PYTHON:
    sys.exit('This script needs Python %d.%d or newer (found %s).'
             % (MINIMUM_PYTHON[0], MINIMUM_PYTHON[1], sys.version.split()[0]))

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

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
        if path.endswith(('.json', '.html', '.js', '.css')) or path.endswith('/'):
            # Always re-read the files you edit, so a reload shows your changes.
            self.send_header('Cache-Control', 'no-store, must-revalidate')
        else:
            # Panoramas and tiles never change once generated.
            self.send_header('Cache-Control', 'max-age=3600')
        super().end_headers()

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
                        help='open the browser with ?edit=1 (hotspot editor)')
    parser.add_argument('--lan', action='store_true',
                        help='also accept connections from other devices on this network')
    parser.add_argument('--no-browser', action='store_true', help='do not open a browser')
    args = parser.parse_args()

    if not os.path.isfile(os.path.join(PROJECT_ROOT, 'index.html')):
        sys.exit('index.html was not found next to tools/. Is the project folder complete?')

    host = '0.0.0.0' if args.lan else '127.0.0.1'
    server, port = start_server(host, args.port)

    suffix = '?edit=1' if args.edit else ''
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
    print('  Press Ctrl+C to stop.')
    print()
    sys.stdout.flush()   # so the URLs appear immediately even when redirected

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
