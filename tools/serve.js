#!/usr/bin/env node
/**
 * serve.js — Node fallback for tools/serve.py.
 *
 * Identical behaviour, used by the launchers when Python is not available.
 * Standard library only; nothing to install.
 *
 *   node tools/serve.js              serve and open a browser
 *   node tools/serve.js --edit       open straight into the hotspot editor
 *   node tools/serve.js --lan        also reachable from a phone on the same Wi-Fi
 *   node tools/serve.js --port 9000
 *   node tools/serve.js --no-browser
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

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (err) {
    res.writeHead(400).end('Bad request');
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
  console.log('  Press Ctrl+C to stop.');
  console.log('');

  if (options.browser) setTimeout(() => openBrowser(url), 400);
});

process.on('SIGINT', () => {
  console.log('\n  Stopping...');
  server.close(() => process.exit(0));
});

server.listen(port, host);
