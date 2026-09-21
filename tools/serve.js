#!/usr/bin/env node
/**
 * serve.js — Node fallback for tools/serve.py.
 *
 * Identical behaviour, used by the launchers when Python is not available.
 * Standard library only; nothing to install.
 *
 *   node tools/serve.js              serve and open a browser
 *   node tools/serve.js --edit       open the editor, and let it save
 *   node tools/serve.js --lan        also reachable from a phone on the same Wi-Fi
 *   node tools/serve.js --port 9000
 *   node tools/serve.js --no-browser
 *   node tools/serve.js --live       reload the page when a source file changes
 *   node tools/serve.js --autosave   the editor writes every change, no button
 *
 * With --edit the server also accepts `PUT /api/tour-config`, which is how the
 * editor's save button writes config/tour.json. Without it the server is
 * read-only, so a stray request cannot rewrite the tour.
 *
 * --live watches index.html, css/ and js/ and pushes a message over
 * `GET /api/live` (server-sent events) when one of them changes: a .css edit is
 * swapped into the open page, anything else reloads it. --autosave tells the
 * editor, through `GET /api/tour-config`, to save on every change instead of
 * waiting for the button. Both are development conveniences and are off unless
 * asked for.
 *
 * Stop it with Ctrl+C.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PROJECT_ROOT = path.dirname(__dirname);

// The editor's save target. Only this one file can ever be written, and only
// when the server was started with --edit.
const SAVE_PATH = '/api/tour-config';
const CONFIG_FILE = path.join(PROJECT_ROOT, 'config', 'tour.json');
const MAX_CONFIG_BYTES = 8 * 1024 * 1024;

// Read-only: the editor asks what panoramas exist so "add a viewpoint" can
// offer the ones not in the tour yet, instead of asking for a typed path.
const PANORAMA_PATH = '/api/panoramas';
const PANORAMA_DIR = path.join(PROJECT_ROOT, 'assets', 'panoramas', 'equirect');
// sceneNN_0.jpg / sceneNN_1.jpg — the level suffix is stripped to get the id.
const PANORAMA_FILE_RE = /^(.+)_\d+\.(?:jpg|jpeg|png|webp)$/i;

// One .bak per server run, taken before the first save: with --autosave the
// file is rewritten every second or so, and a .bak from a second ago is not an
// undo. This way it holds the tour as it was when you started the session.
let backupWritten = false;

// Live reload. The watcher polls mtimes rather than using fs.watch: it is a
// handful of files, and polling behaves the same on every OS — fs.watch's
// recursive mode and event coalescing differ between macOS, Linux and Windows.
const LIVE_PATH = '/api/live';
const LIVE_WATCH = ['index.html', 'css', 'js'];
const LIVE_SUFFIXES = ['.html', '.css', '.js', '.mjs'];
const LIVE_POLL_MS = 400;
const LIVE_HEARTBEAT_MS = 20000;

// Lets a reconnecting browser notice it is talking to a *restarted* server and
// reload — which is what you want after editing serve.js itself.
const SESSION_ID = `${process.pid}-${Date.now()}`;
const liveClients = new Set();

/**
 * Every source file live reload cares about. Never config/tour.json — the
 * editor writes that itself, and reloading on it would fight autosave.
 */
function watchedFiles(entry, found) {
  let stats;
  try {
    stats = fs.statSync(entry);
  } catch (err) {
    return found;
  }
  if (stats.isFile()) {
    if (LIVE_SUFFIXES.includes(path.extname(entry).toLowerCase())) found.push(entry);
    return found;
  }
  let names = [];
  try {
    names = fs.readdirSync(entry);
  } catch (err) {
    return found;
  }
  for (const name of names) {
    if (name.startsWith('.')) continue;
    watchedFiles(path.join(entry, name), found);
  }
  return found;
}

/**
 * path -> mtime for everything watched. Unreadable files are skipped, so a
 * file being rewritten under us reads as a change rather than a crash.
 */
function snapshotSources() {
  const seen = new Map();
  for (const entry of LIVE_WATCH) {
    for (const file of watchedFiles(path.join(PROJECT_ROOT, entry), [])) {
      try {
        seen.set(file, fs.statSync(file).mtimeMs);
      } catch (err) {
        /* gone between listing and stat; the next pass will see it */
      }
    }
  }
  return seen;
}

function sendEvent(res, name, value) {
  res.write(`event: ${name}\ndata: ${JSON.stringify(value)}\n\n`);
}

/** Announces changes to the open pages. */
function watchSources() {
  let previous = snapshotSources();
  setInterval(() => {
    const current = snapshotSources();
    const changed = [];
    for (const [file, mtime] of current) {
      if (previous.get(file) !== mtime) changed.push(file);
    }
    for (const file of previous.keys()) {
      if (!current.has(file)) changed.push(file);
    }
    if (!changed.length) return;
    previous = current;
    changed.sort();
    // Styles can be swapped into the running page; anything else means the
    // loaded JavaScript is stale, and only a reload fixes that.
    const kind = changed.every((file) => file.endsWith('.css')) ? 'css' : 'reload';
    const label = kind === 'css' ? 'restyle' : 'reload ';
    console.log(`  ${label} ${changed.map((f) => path.relative(PROJECT_ROOT, f)).join(', ')}`);
    for (const client of liveClients) sendEvent(client, 'change', { kind });
  }, LIVE_POLL_MS).unref();
}

/**
 * Holds the connection open and writes an event on every change. The browser's
 * EventSource reconnects by itself, so a dropped stream — or a restarted
 * server — costs nothing.
 */
function streamLive(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive'
  });
  sendEvent(res, 'hello', { session: SESSION_ID });
  liveClients.add(res);

  // A comment line: keeps proxies and sleeping laptops from quietly dropping
  // an idle connection.
  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), LIVE_HEARTBEAT_MS);
  heartbeat.unref();
  const drop = () => {
    clearInterval(heartbeat);
    liveClients.delete(res);
  };
  req.on('close', drop);
  res.on('error', drop);
}

/** Scene ids that have a web panorama on disk, whether in the tour or not. */
function availableSceneIds() {
  let names;
  try {
    names = fs.readdirSync(PANORAMA_DIR);
  } catch (err) {
    return [];
  }
  const found = new Set();
  for (const name of names) {
    const match = PANORAMA_FILE_RE.exec(name);
    if (match) found.add(match[1]);
  }
  return [...found].sort();
}

// Explicit content types: some systems have a broken .js registry entry, which
// silently breaks ES modules.
const CONTENT_TYPES = {
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
  '.md': 'text/markdown; charset=utf-8'
};

function parseArguments(argv) {
  const options = { port: 8000, edit: false, lan: false, browser: true, live: false, autosave: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--edit') options.edit = true;
    else if (arg === '--lan') options.lan = true;
    else if (arg === '--no-browser') options.browser = false;
    else if (arg === '--live') options.live = true;
    else if (arg === '--autosave') options.autosave = true;
    else if (arg === '--port') options.port = parseInt(argv[++i], 10) || 8000;
    else if (arg.startsWith('--port=')) options.port = parseInt(arg.slice(7), 10) || 8000;
  }
  // Autosave is meaningless on a server that refuses to save, so it turns
  // editing on rather than failing with a flag combination to puzzle out.
  if (options.autosave) options.edit = true;
  return options;
}

function openBrowser(url) {
  const command = process.platform === 'win32' ? 'cmd'
    : process.platform === 'darwin' ? 'open' : 'xdg-open';
  // On Windows `start` needs an empty title argument before the URL.
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(command, args, { stdio: 'ignore', detached: true }).unref();
  } catch (err) {
    // Opening a browser is a convenience; the printed URL is the real interface.
  }
}

function localIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const entry of interfaces[name] || []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return null;
}

const options = parseArguments(process.argv.slice(2));

if (!fs.existsSync(path.join(PROJECT_ROOT, 'index.html'))) {
  console.error('index.html was not found next to tools/. Is the project folder complete?');
  process.exit(1);
}

/**
 * Returns why `parsed` is not a usable tour, or null if it looks like one.
 *
 * The bar is what js/config.js needs to draw a scene: an id and a panorama
 * block, for every scene. Checking only for a "scenes" array is not enough —
 * one stray request with a plausible shape would replace the whole tour, and
 * the single .bak copy is gone the second time it happens.
 */
function describeBadTour(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return 'the body is not a JSON object';
  }
  if (!Array.isArray(parsed.scenes) || !parsed.scenes.length) return 'no "scenes" array';
  for (let i = 0; i < parsed.scenes.length; i++) {
    const scene = parsed.scenes[i];
    const where = `scene #${i + 1}`;
    if (!scene || typeof scene !== 'object') return `${where} is not an object`;
    if (typeof scene.id !== 'string' || !scene.id) return `${where} has no "id"`;
    if (!scene.panorama || typeof scene.panorama !== 'object') {
      return `scene "${scene.id}" has no "panorama" block`;
    }
  }
  return null;
}

/**
 * Keeps one undo copy, then replaces config/tour.json in a single step.
 *
 * Calls back with `written === false` when the file already holds exactly this
 * content: with autosave most requests are no-ops, and rewriting the file
 * anyway would churn the disk for nothing.
 */
function writeConfigFile(body, done) {
  const temporary = `${CONFIG_FILE}.tmp`;
  const replace = () => {
    fs.writeFile(temporary, body, (writeErr) => {
      if (writeErr) return done(writeErr);
      fs.rename(temporary, CONFIG_FILE, (renameErr) => done(renameErr, !renameErr));
    });
  };

  fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true }, (mkdirErr) => {
    if (mkdirErr) return done(mkdirErr);
    fs.readFile(CONFIG_FILE, (readErr, existing) => {
      if (!readErr && existing.equals(body)) return done(null, false);
      if (backupWritten || readErr) {
        // No original to copy, or this run already took its snapshot.
        if (readErr && readErr.code !== 'ENOENT') return done(readErr);
        return replace();
      }
      fs.copyFile(CONFIG_FILE, `${CONFIG_FILE}.bak`, (copyErr) => {
        if (copyErr && copyErr.code !== 'ENOENT') return done(copyErr);
        backupWritten = true;
        replace();
      });
    });
  });
}

/** Handles `PUT /api/tour-config` from the editor's save button. */
function handleSave(req, res) {
  // The body is read before anything is decided, refusals included: replying
  // while the client is still sending can reset the connection, and the editor
  // would report an unreachable server rather than the real reason.
  const chunks = [];
  let size = 0;
  let aborted = false;

  req.on('data', (chunk) => {
    if (aborted) return;
    size += chunk.length;
    if (size > MAX_CONFIG_BYTES) {
      aborted = true;
      res.writeHead(413, { 'content-type': 'text/plain' })
        .end('That is far larger than a tour config');
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on('end', () => {
    if (aborted) return;
    if (!options.edit) {
      res.writeHead(403, { 'content-type': 'text/plain' })
        .end('Saving is off. Restart the server with --edit ' +
             '(for example: start-windows.bat --edit).');
      return;
    }

    const body = Buffer.concat(chunks);
    let parsed;
    try {
      parsed = JSON.parse(body.toString('utf8'));
    } catch (err) {
      res.writeHead(400, { 'content-type': 'text/plain' }).end(`Not valid JSON: ${err.message}`);
      return;
    }
    // Refuse anything that is not recognisably a tour, so a misdirected
    // request cannot leave the project without a config.
    const problem = describeBadTour(parsed);
    if (problem) {
      res.writeHead(400, { 'content-type': 'text/plain' })
        .end(`Not a tour config: ${problem}`);
      return;
    }

    writeConfigFile(body, (err, written) => {
      if (err) {
        console.error(`  500 ${SAVE_PATH}: ${err.message}`);
        res.writeHead(500, { 'content-type': 'text/plain' })
          .end(`Could not write config/tour.json: ${err.message}`);
        return;
      }
      // Autosave fires on a timer, so plenty of saves carry no change at all.
      // Saying so every time would bury the ones that matter.
      if (written) console.log(`  saved   config/tour.json  (${parsed.scenes.length} scenes)`);
      res.writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ ok: true, scenes: parsed.scenes.length, written: Boolean(written) }));
    });
  });
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (err) {
    res.writeHead(400).end('Bad request');
    return;
  }

  if (req.method === 'PUT' && pathname === SAVE_PATH) {
    handleSave(req, res);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }).end('Method not allowed');
    return;
  }
  // Two small read-only endpoints for the editor.
  if (pathname === SAVE_PATH) {          // will this server accept a save?
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      .end(JSON.stringify({ save: options.edit, autosave: options.edit && options.autosave }));
    return;
  }
  if (pathname === PANORAMA_PATH) {      // what panoramas could be added?
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      .end(JSON.stringify({ scenes: availableSceneIds() }));
    return;
  }
  if (pathname === LIVE_PATH) {          // live reload: probe, then the stream
    if (/[?&]probe=1(&|$)/.test(req.url)) {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        .end(JSON.stringify({ live: options.live }));
    } else if (!options.live) {
      res.writeHead(404, { 'content-type': 'text/plain' })
        .end('Live reload is off. Restart the server with --live.');
    } else {
      streamLive(req, res);
    }
    return;
  }

  if (pathname.endsWith('/')) pathname += 'index.html';

  const filePath = path.join(PROJECT_ROOT, pathname);
  // Refuse anything that escapes the project folder.
  if (!filePath.startsWith(PROJECT_ROOT + path.sep) && filePath !== PROJECT_ROOT) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      console.error(`  404 ${pathname}`);
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    const extension = path.extname(filePath).toLowerCase();
    const isEditable = ['.html', '.js', '.mjs', '.css', '.json'].includes(extension);
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[extension] || 'application/octet-stream',
      // Always re-read the files you edit; panoramas never change once generated.
      'cache-control': isEditable ? 'no-store, must-revalidate' : 'max-age=3600'
    });
    res.end(data);
  });
});

const host = options.lan ? '0.0.0.0' : '127.0.0.1';
let port = options.port;
let attempts = 0;

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && attempts < 40) {
    attempts += 1;
    port += 1;
    server.listen(port, host);
    return;
  }
  console.error(`Could not start the server: ${err.message}`);
  process.exit(1);
});

server.on('listening', () => {
  const url = `http://localhost:${port}/${options.edit ? '?edit=1' : ''}`;
  console.log('');
  console.log('  360 Virtual Tour is running.');
  console.log('');
  console.log(`    Tour      http://localhost:${port}/`);
  console.log(`    Editor    http://localhost:${port}/?edit=1`);
  if (options.lan) {
    const ip = localIpAddress();
    console.log(ip
      ? `    Phone     http://${ip}:${port}/     (same Wi-Fi)`
      : "    Phone     could not determine this machine's network address");
  }
  console.log('');
  if (options.edit) {
    console.log('  Editing is on: the editor can overwrite config/tour.json.');
    if (options.autosave) {
      console.log('  Autosave is on: every change is written, no button to press.');
      console.log('  config/tour.json.bak keeps the tour as it was when this server started.');
    }
    if (options.lan) {
      console.log('  With --lan, anyone on this network can too. Use it on a network you trust.');
    }
    console.log('');
  }
  if (options.live) {
    console.log('  Live reload is on: editing index.html, css/ or js/ updates the page.');
    console.log('');
    watchSources();
  }
  console.log('  Press Ctrl+C to stop.');
  console.log('');

  if (options.browser) setTimeout(() => openBrowser(url), 400);
});

process.on('SIGINT', () => {
  console.log('\n  Stopping...');
  // An open live-reload stream never ends on its own, so server.close() would
  // wait for a page that is not going to go away. Hang them up first.
  for (const client of liveClients) client.end();
  liveClients.clear();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
});

server.listen(port, host);
