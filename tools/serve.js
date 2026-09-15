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
 *
 * With --edit the server also accepts `PUT /api/tour-config`, which is how the
 * editor's save button writes config/tour.json. Without it the server is
 * read-only, so a stray request cannot rewrite the tour.
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
  const options = { port: 8000, edit: false, lan: false, browser: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--edit') options.edit = true;
    else if (arg === '--lan') options.lan = true;
    else if (arg === '--no-browser') options.browser = false;
    else if (arg === '--port') options.port = parseInt(argv[++i], 10) || 8000;
    else if (arg.startsWith('--port=')) options.port = parseInt(arg.slice(7), 10) || 8000;
  }
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

/** Keeps one undo copy, then replaces config/tour.json in a single step. */
function writeConfigFile(body, done) {
  const temporary = `${CONFIG_FILE}.tmp`;
  fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true }, (mkdirErr) => {
    if (mkdirErr) return done(mkdirErr);
    fs.copyFile(CONFIG_FILE, `${CONFIG_FILE}.bak`, (copyErr) => {
      // A missing original is fine; anything else is not.
      if (copyErr && copyErr.code !== 'ENOENT') return done(copyErr);
      fs.writeFile(temporary, body, (writeErr) => {
        if (writeErr) return done(writeErr);
        fs.rename(temporary, CONFIG_FILE, done);
      });
    });
  });
}

/** Handles `PUT /api/tour-config` from the editor's save button. */
function handleSave(req, res) {
  if (!options.edit) {
    res.writeHead(403, { 'content-type': 'text/plain' })
      .end('Saving is disabled. Restart with --edit to allow it.');
    return;
  }

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
    if (!parsed || typeof parsed !== 'object' ||
        !Array.isArray(parsed.scenes) || !parsed.scenes.length) {
      res.writeHead(400, { 'content-type': 'text/plain' })
        .end('Not a tour config: no "scenes" array');
      return;
    }

    writeConfigFile(body, (err) => {
      if (err) {
        console.error(`  500 ${SAVE_PATH}: ${err.message}`);
        res.writeHead(500, { 'content-type': 'text/plain' })
          .end(`Could not write config/tour.json: ${err.message}`);
        return;
      }
      console.log(`  saved config/tour.json  (${parsed.scenes.length} scenes)`);
      res.writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ ok: true, scenes: parsed.scenes.length }));
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
    if (options.lan) {
      console.log('  With --lan, anyone on this network can too. Use it on a network you trust.');
    }
    console.log('');
  }
  console.log('  Press Ctrl+C to stop.');
  console.log('');

  if (options.browser) setTimeout(() => openBrowser(url), 400);
});

process.on('SIGINT', () => {
  console.log('\n  Stopping...');
  server.close(() => process.exit(0));
});

server.listen(port, host);
