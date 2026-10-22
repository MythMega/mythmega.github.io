#!/usr/bin/env node
/**
 * Tests navigateur Pokefeet.
 *
 * Lance un serveur statique local puis ouvre chaque page de TEST_PAGES dans
 * Chrome (headless) via le protocole DevTools :
 *  - tests/save-load.html : sauvegarde / chargement des données ;
 *  - tests/button-theme.html : lisibilité de chaque thème de bouton.
 * Attend le résultat des assertions et renvoie un code de sortie non nul en
 * cas d'échec.
 *
 * Aucune dépendance npm. CHROME_PATH permet de forcer le chemin du navigateur.
 *
 * Usage : npm test
 */

import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_PAGES = [
  '/tests/save-load.html',
  '/tests/button-theme.html'
];
const TIMEOUT_MS = 90000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2'
};

function startServer() {
  const server = http.createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }
    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = path.resolve(ROOT, '.' + pathname);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(file).pipe(res);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const candidates = [];
  if (process.platform === 'win32') {
    const roots = [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
      .filter(Boolean);
    for (const root of roots) {
      candidates.push(path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      candidates.push(path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    candidates.push('/Applications/Chromium.app/Contents/MacOS/Chromium');
    candidates.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge'
    );
  }
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function waitForFile(file, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function poll() {
      if (fs.existsSync(file)) {
        const content = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
        if (content[0]) {
          resolve(Number(content[0]));
          return;
        }
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`port DevTools introuvable (${file})`));
        return;
      }
      setTimeout(poll, 100);
    })();
  });
}

function connectCdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    const consoleErrors = [];
    const exceptions = [];

    const timer = setTimeout(() => reject(new Error('connexion DevTools expirée')), 15000);

    socket.addEventListener('open', () => {
      clearTimeout(timer);
      resolve({
        consoleErrors,
        exceptions,
        send(method, params = {}) {
          const id = nextId++;
          socket.send(JSON.stringify({ id, method, params }));
          return new Promise((resolveSend, rejectSend) => {
            pending.set(id, { resolve: resolveSend, reject: rejectSend });
          });
        },
        close() {
          try { socket.close(); } catch { /* déjà fermé */ }
        }
      });
    });

    socket.addEventListener('message', async (event) => {
      const raw = typeof event.data === 'string' ? event.data : await event.data.text();
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }
      if (message.id && pending.has(message.id)) {
        const { resolve: resolveSend, reject: rejectSend } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) rejectSend(new Error(message.error.message));
        else resolveSend(message.result);
        return;
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails;
        exceptions.push(details.exception?.description || details.text || 'exception inconnue');
      }
    });

    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('connexion DevTools impossible'));
    });
  });
}

async function waitForTestResult(cdp) {
  const start = Date.now();
  while (Date.now() - start < TIMEOUT_MS) {
    const result = await cdp.send('Runtime.evaluate', {
      expression: 'window.__TEST_RESULT__ ? JSON.stringify(window.__TEST_RESULT__) : null',
      returnByValue: true
    });
    const value = result?.result?.value;
    if (typeof value === 'string' && value.length > 0) {
      return JSON.parse(value);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('le banc de test n’a pas publié de résultat');
}

async function runPage(testPage) {
  const chrome = findChrome();
  if (!chrome) {
    console.warn('⚠ Chrome introuvable — test navigateur ignoré (définir CHROME_PATH pour l’activer).');
    return 0;
  }

  const { server, port } = await startServer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pokefeet-test-'));
  const targetUrl = `http://127.0.0.1:${port}${testPage}`;
  let browser = null;
  let cdp = null;
  let exitCode = 1;

  try {
    browser = spawn(
      chrome,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--disable-background-networking',
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        targetUrl
      ],
      { stdio: ['ignore', 'ignore', 'pipe'], detached: process.platform !== 'win32' }
    );

    let stderr = '';
    browser.stderr?.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    browser.on('exit', (code) => {
      if (exitCode === 1 && code !== 0) {
        console.error(`Chrome s’est arrêté avec le code ${code}.`);
      }
    });

    const devtoolsPort = await waitForFile(path.join(profile, 'DevToolsActivePort'), 20000);

    let pageTarget = null;
    const deadline = Date.now() + 20000;
    while (!pageTarget && Date.now() < deadline) {
      const response = await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`);
      const targets = await response.json();
      pageTarget = targets.find((target) => target.type === 'page' && target.url.includes(testPage))
        || targets.find((target) => target.type === 'page');
      if (!pageTarget) await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (!pageTarget) throw new Error(`page de test introuvable.\n${stderr}`);

    cdp = await connectCdp(pageTarget.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    const result = await waitForTestResult(cdp);

    for (const check of result.checks || []) {
      const line = `${check.ok ? '✔' : '✖'} ${check.name}${check.ok || !check.detail ? '' : ` — ${check.detail}`}`;
      if (check.ok) console.log(line);
      else console.error(line);
    }

    const pageErrors = [...(result.consoleErrors || []), ...cdp.consoleErrors, ...cdp.exceptions];
    const uniqueErrors = [...new Set(pageErrors.map((entry) => String(entry).split('\n')[0]).filter(Boolean))];
    if (uniqueErrors.length > 0) {
      console.log('\nErreurs console de la page :');
      for (const error of uniqueErrors.slice(0, 10)) console.log(`  · ${error}`);
    }

    if (result.error) console.error(`\n${result.error}`);
    console.log(`\n${result.pass ? '✔' : '✖'} ${result.summary}`);
    exitCode = result.pass ? 0 : 1;
  } catch (error) {
    console.error(`✖ Test navigateur ${testPage} : ${error.message}`);
    exitCode = 1;
  } finally {
    cdp?.close();
    if (browser && browser.pid) {
      try {
        if (process.platform === 'win32') {
          execFileSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' });
        } else {
          process.kill(-browser.pid, 'SIGKILL');
        }
      } catch {
        try { browser.kill('SIGKILL'); } catch { /* déjà arrêté */ }
      }
    }
    server.close();
    await new Promise((resolve) => setTimeout(resolve, 300));
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }

  return exitCode;
}

async function main() {
  let exitCode = 0;
  for (const page of TEST_PAGES) {
    const code = await runPage(page);
    if (code !== 0) exitCode = code;
  }
  return exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
