#!/usr/bin/env node
/**
 * Tests navigateur Pokefeet.
 *
 * Lance un serveur statique local puis ouvre dans Chrome (headless, via le
 * protocole DevTools) deux familles de tests :
 *
 *  1. des pages de test qui publient leurs propres assertions dans
 *     `window.__TEST_RESULT__` :
 *       - tests/save-load.html     : sauvegarde / chargement des données ;
 *       - tests/button-theme.html  : lisibilité de chaque thème de bouton ;
 *       - tests/xp-system.html     : règles d'XP et courbe de niveaux ;
 *  2. des cas « page entière » décrits dans tests/browser-cases.mjs : une vraie
 *     page de l'application est chargée, éventuellement avec des fichiers de
 *     data/ en panne (404 ou contenu invalide), puis des assertions sont
 *     évaluées dans la page. Chaque cas vérifie aussi qu'aucune exception n'est
 *     remontée jusqu'au navigateur.
 *
 * Aucune dépendance npm. CHROME_PATH permet de forcer le chemin du navigateur.
 *
 * Usage : npm test
 *         TEST_FILTER=<regex> ne lance que les cas dont le nom ou la page correspond.
 */

import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER_CASES } from '../tests/browser-cases.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_PAGES = [
  '/tests/save-load.html',
  '/tests/button-theme.html',
  '/tests/xp-system.html'
];
// `TEST_FILTER` limite la suite à certains cas : utile pour rejouer un seul
// scénario pendant la mise au point d'un test.
const CASE_FILTER = process.env.TEST_FILTER ? new RegExp(process.env.TEST_FILTER, 'i') : null;
const PAGES_TO_RUN = CASE_FILTER ? TEST_PAGES.filter((page) => CASE_FILTER.test(page)) : TEST_PAGES;
const CASES_TO_RUN = CASE_FILTER
  ? BROWSER_CASES.filter((item) => CASE_FILTER.test(item.name) || CASE_FILTER.test(item.page))
  : BROWSER_CASES;

const TIMEOUT_MS = 90000;
const SETTLE_TIMEOUT_MS = 20000;

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

function normalizePath(value) {
  return String(value).replace(/^\.?\//, '');
}

// `faults` : chemins servis en 404 (fichier de données absent).
// `corrupt` : chemins servis en 200 avec un contenu invalide (manifeste cassé).
function startServer(options = {}) {
  const missing = new Set((options.faults || []).map(normalizePath));
  const corrupt = new Map(
    Object.entries(options.corrupt || {}).map(([key, value]) => [normalizePath(key), value])
  );

  const server = http.createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }
    if (pathname.endsWith('/')) pathname += 'index.html';
    const relative = normalizePath(pathname);

    if (missing.has(relative)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Fichier volontairement absent');
      return;
    }
    if (corrupt.has(relative)) {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      }).end(corrupt.get(relative));
      return;
    }

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

function printCheck(check) {
  const line = `${check.ok ? '✔' : '✖'} ${check.name}${check.ok || !check.detail ? '' : ` — ${check.detail}`}`;
  if (check.ok) console.log(line);
  else console.error(line);
}

function printConsoleErrors(entries) {
  const unique = [...new Set(entries.map((entry) => String(entry).split('\n')[0]).filter(Boolean))];
  if (unique.length === 0) return;
  console.log('\nErreurs console de la page :');
  for (const error of unique.slice(0, 10)) console.log(`  · ${error}`);
}

// Évalue une expression dans la page (les promesses sont attendues).
async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (result.exceptionDetails) {
    const details = result.exceptionDetails;
    throw new Error(details.exception?.description || details.text || 'expression en échec');
  }
  return result.result ? result.result.value : undefined;
}

async function waitForCondition(cdp, expression, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (await evaluate(cdp, expression)) return true;
    } catch {
      // La page n’est pas encore prête : on réessaie.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

// `setup` est rejoué à chaque tentative : un clic d’onglet peut arriver avant que
// la page ait fini de brancher ses écouteurs.
async function waitForSetupAndSettle(cdp, caseDef, timeoutMs) {
  if (!caseDef.setup && !caseDef.settle) return true;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (caseDef.setup) {
      try {
        await evaluate(cdp, caseDef.setup);
      } catch {
        // La page n’est pas encore prête pour la préparation.
      }
    }
    if (!caseDef.settle) return true;
    try {
      if (await evaluate(cdp, caseDef.settle)) return true;
    } catch {
      // La page n’est pas encore prête pour l’état attendu.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  console.error(`  · la page n’a pas atteint son état attendu en ${timeoutMs / 1000} s`);
  return false;
}

async function evaluateCheck(cdp, check) {
  let value;
  try {
    value = await evaluate(cdp, check.expression);
  } catch (error) {
    return { name: check.name, ok: false, detail: error.message.split('\n')[0] };
  }

  if (check.match !== undefined) {
    const text = value === null || value === undefined ? '' : String(value);
    const ok = check.match instanceof RegExp ? check.match.test(text) : text.includes(String(check.match));
    return { name: check.name, ok, detail: text.slice(0, 140) };
  }
  if (check.expect !== undefined) {
    return { name: check.name, ok: value === check.expect, detail: JSON.stringify(value) };
  }
  if (value && typeof value === 'object' && 'ok' in value) {
    return { name: check.name, ok: !!value.ok, detail: value.detail === undefined ? null : String(value.detail) };
  }
  return {
    name: check.name,
    ok: !!value,
    detail: value === true || value === undefined || value === null ? String(value) : String(value).slice(0, 140)
  };
}

function killBrowser(browser) {
  if (!browser || !browser.pid) return;
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

// Ouvre une page dans Chrome headless, exécute `run`, et nettoie tout.
// Retourne null quand Chrome est introuvable (test ignoré), sinon le résultat
// de `run`.
async function withPage({ url, serverOptions = {}, cookies = {}, run }) {
  const chrome = findChrome();
  if (!chrome) {
    console.warn('⚠ Chrome introuvable — test navigateur ignoré (définir CHROME_PATH pour l’activer).');
    return null;
  }

  const { server, port } = await startServer(serverOptions);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pokefeet-test-'));
  const targetUrl = `http://127.0.0.1:${port}${url}`;
  let browser = null;
  let cdp = null;
  let stopping = false;

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
        'about:blank'
      ],
      { stdio: ['ignore', 'ignore', 'pipe'], detached: process.platform !== 'win32' }
    );

    let stderr = '';
    browser.stderr?.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    browser.on('exit', (code) => {
      if (!stopping && code !== 0) console.error(`Chrome s’est arrêté avec le code ${code}.`);
    });

    const devtoolsPort = await waitForFile(path.join(profile, 'DevToolsActivePort'), 20000);

    let pageTarget = null;
    const deadline = Date.now() + 20000;
    while (!pageTarget && Date.now() < deadline) {
      const response = await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`);
      const targets = await response.json();
      pageTarget = targets.find((target) => target.type === 'page' && target.url.includes(url))
        || targets.find((target) => target.type === 'page');
      if (!pageTarget) await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (!pageTarget) throw new Error(`page de test introuvable.\n${stderr}`);

    cdp = await connectCdp(pageTarget.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');

    // Les cookies du cas sont posés avant la navigation : la page les lit dès
    // son chargement, comme un joueur qui revient avec ses données.
    const cookieNames = Object.keys(cookies);
    if (cookieNames.length > 0) {
      await cdp.send('Network.enable');
      const expires = Math.floor(Date.now() / 1000) + 86400;
      for (const name of cookieNames) {
        await cdp.send('Network.setCookie', {
          name,
          value: String(cookies[name]),
          url: `http://127.0.0.1:${port}/`,
          path: '/',
          expires
        });
      }
    }
    await cdp.send('Page.navigate', { url: targetUrl });
    // Les scripts de la page doivent avoir fini de s'exécuter : sans cela les
    // assertions peuvent tourner avant que les globales du jeu existent.
    const ready = await waitForCondition(cdp, 'document.readyState === "complete"', SETTLE_TIMEOUT_MS);
    if (!ready) console.error('  · la page n’a pas signalé la fin de son chargement');
    return await run({ cdp, url: targetUrl });
  } finally {
    stopping = true;
    cdp?.close();
    killBrowser(browser);
    server.close();
    await new Promise((resolve) => setTimeout(resolve, 300));
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}

// Page de test autonome : elle publie ses propres assertions.
async function runTestPage(testPage) {
  try {
    const exitCode = await withPage({
      url: testPage,
      run: async ({ cdp }) => {
        const result = await waitForTestResult(cdp);
        for (const check of result.checks || []) printCheck(check);
        printConsoleErrors([...(result.consoleErrors || []), ...cdp.consoleErrors, ...cdp.exceptions]);
        if (result.error) console.error(`\n${result.error}`);
        console.log(`\n${result.pass ? '✔' : '✖'} ${result.summary}`);
        return result.pass ? 0 : 1;
      }
    });
    return exitCode === null ? 0 : exitCode;
  } catch (error) {
    console.error(`✖ Test navigateur ${testPage} : ${error.message}`);
    return 1;
  }
}

// Cas « page entière » : assertions évaluées dans la page, avec pannes de
// données injectées côté serveur si le cas le demande.
async function runBrowserCase(caseDef) {
  console.log(`\n— ${caseDef.name} (${caseDef.page})`);
  try {
    const exitCode = await withPage({
      url: caseDef.page,
      serverOptions: { faults: caseDef.faults, corrupt: caseDef.corrupt },
      cookies: caseDef.cookies,
      run: async ({ cdp }) => {
        await waitForSetupAndSettle(cdp, caseDef, SETTLE_TIMEOUT_MS);

        const checks = [];
        for (const check of caseDef.checks || []) {
          checks.push(await evaluateCheck(cdp, check));
        }
        checks.push({
          name: 'aucune exception non capturée',
          ok: cdp.exceptions.length === 0,
          detail: cdp.exceptions.length ? String(cdp.exceptions[0]).split('\n')[0] : null
        });

        for (const check of checks) printCheck(check);
        printConsoleErrors(cdp.consoleErrors);

        const failed = checks.filter((check) => !check.ok).length;
        console.log(`\n${failed === 0 ? '✔' : '✖'} ${failed === 0 ? 'PASS' : 'FAIL'} — ${checks.length - failed}/${checks.length} vérifications — ${caseDef.name}`);
        return failed === 0 ? 0 : 1;
      }
    });
    return exitCode === null ? 0 : exitCode;
  } catch (error) {
    console.error(`✖ Cas navigateur ${caseDef.name} : ${error.message}`);
    return 1;
  }
}

async function main() {
  let exitCode = 0;

  for (const page of PAGES_TO_RUN) {
    const code = await runTestPage(page);
    if (code !== 0) exitCode = code;
  }

  for (const caseDef of CASES_TO_RUN) {
    const code = await runBrowserCase(caseDef);
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
