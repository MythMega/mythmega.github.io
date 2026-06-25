// ============================================================
// PKServ Admin — main.js
// Shared state, API helpers, tab routing, global data loaders
// ============================================================

'use strict';

// ── Config ──────────────────────────────────────────────────
const ADM = {
  port: null,           // set after port detection
  baseUrl: () => `http://localhost:${ADM.port}`,

  // Shared data
  users:     [],
  creatures: [],
  balls:     [],

  // SearchableSelect instances
  ss: {},
};

// ── Cookie helpers ───────────────────────────────────────────
function getCookie(name) {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? match[2] : null;
}

function setCookie(name, value, days = 365) {
  const d = new Date();
  d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
  document.cookie = `${name}=${value};expires=${d.toUTCString()};path=/`;
}

// ── Port detection ───────────────────────────────────────────
// Priorité : cookie > window.location.port > data.json (fallback)
ADM.port = 80; // valeur provisoire remplacée par loadConfig()

async function loadConfig() {
  // 1) Cookie (priorité absolue)
  const cookiePort = getCookie('adm_port');
  if (cookiePort) {
    ADM.port = Number(cookiePort);
    updatePortDisplay();
    dispatchEvent(new CustomEvent('adm:config-loaded'));
    return;
  }

  // 2) Port de l'URL courante (mode serveur /admin)
  const locPort = Number(window.location.port || 0);
  if (locPort > 0) ADM.port = locPort;

  // 3) Fallback optionnel : data.json (mode fichier local / legacy)
  try {
    const res  = await fetch('./data.json');
    if (res.ok) {
      const conf = await res.json();
      if (conf.Port) ADM.port = conf.Port;
    }
  } catch (e) {
    // silencieux : normal en mode /admin bundlé
  }

  updatePortDisplay();
  // Signaler à tous les modules que le port est prêt
  dispatchEvent(new CustomEvent('adm:config-loaded'));
}

function updatePortDisplay() {
  const el = document.getElementById('topbar-port');
  if (el) el.textContent = `port ${ADM.port}`;
}

function changePort(newPort) {
  if (!newPort || newPort < 1 || newPort > 65535) return false;
  ADM.port = Number(newPort);
  setCookie('adm_port', ADM.port);
  updatePortDisplay();
  dispatchEvent(new CustomEvent('adm:config-loaded'));
  return true;
}

// ── API helpers ──────────────────────────────────────────────

/** POST JSON to the PKServ API, returns response text. */
async function apiPost(route, body = {}) {
  const res = await fetch(`${ADM.baseUrl()}/${route}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  return res.text();
}

/** GET from the PKServ API, returns response text. */
async function apiGet(route) {
  const res = await fetch(`${ADM.baseUrl()}/${route}`);
  return res.text();
}

/** Show a response in a .adm-response element.
 *  @param {HTMLElement} el
 *  @param {string} text
 *  @param {'ok'|'error'|'info'} type
 */
function showResp(el, text, type = 'info') {
  if (!el) return;
  el.className = `adm-response ${type}`;
  el.textContent = text;
}

/** Disable btn, call fn(), re-enable. */
async function withBtn(btn, fn) {
  btn.disabled = true;
  const orig = btn.innerHTML;
  btn.innerHTML = '⏳ …';
  try { await fn(); }
  finally { btn.disabled = false; btn.innerHTML = orig; }
}

// ── Tab routing ──────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.adm-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      document.querySelectorAll('.adm-nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.adm-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      const tab = document.getElementById(`tab-${target}`);
      if (tab) tab.classList.add('active');
    });
  });
  // activate first tab
  const first = document.querySelector('.adm-nav-btn');
  if (first) first.click();
}

// ── Global data loaders ──────────────────────────────────────

async function loadUsers(respEl) {
  try {
    const text = await apiPost('Interface/GetAll/Users', {});
    ADM.users = JSON.parse(text);
    if (respEl) showResp(respEl, `✅ ${ADM.users.length} utilisateurs chargés.`, 'ok');
    dispatchEvent(new CustomEvent('adm:users-loaded'));
    return ADM.users;
  } catch (e) {
    if (respEl) showResp(respEl, `❌ ${e.message}`, 'error');
  }
}

async function loadCreatures(respEl) {
  try {
    const text = await apiPost('Interface/GetAll/Creatures', {});
    ADM.creatures = JSON.parse(text);
    if (respEl) showResp(respEl, `✅ ${ADM.creatures.length} créatures chargées.`, 'ok');
    dispatchEvent(new CustomEvent('adm:creatures-loaded'));
    return ADM.creatures;
  } catch (e) {
    if (respEl) showResp(respEl, `❌ ${e.message}`, 'error');
  }
}

async function loadBalls(respEl) {
  try {
    const text = await apiPost('Interface/GetAll/Balls', {});
    ADM.balls = JSON.parse(text);
    if (respEl) showResp(respEl, `✅ ${ADM.balls.length} balls chargées.`, 'ok');
    dispatchEvent(new CustomEvent('adm:balls-loaded'));
    return ADM.balls;
  } catch (e) {
    if (respEl) showResp(respEl, `❌ ${e.message}`, 'error');
  }
}

// ── Boot ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Lire le port avant tout appel API
  await loadConfig();

  initTabs();

  // Wire global loaders
  const respUsers     = document.getElementById('resp-users');
  const respCreatures = document.getElementById('resp-creatures');
  const respBalls     = document.getElementById('resp-balls');

  document.getElementById('btn-load-users')?.addEventListener('click', () =>
    loadUsers(respUsers));
  document.getElementById('btn-load-creatures')?.addEventListener('click', () =>
    loadCreatures(respCreatures));
  document.getElementById('btn-load-balls')?.addEventListener('click', () =>
    loadBalls(respBalls));

  // Auto-load après que le port est résolu
  addEventListener('adm:config-loaded', () => {
    loadUsers(respUsers);
    loadCreatures(respCreatures);
    loadBalls(respBalls);
  });

  // Bouton connecter dans la topbar
  document.getElementById('btn-connect')?.addEventListener('click', async () => {
    await loadUsers(respUsers);
    await loadCreatures(respCreatures);
    await loadBalls(respBalls);

    // Charger les settings si l'onglet est actif
    const settingsTab = document.getElementById('tab-settings');
    if (settingsTab && settingsTab.classList.contains('active')) {
      const btnLoad = document.getElementById('btn-settings-load');
      if (btnLoad) btnLoad.click();
    }
  });
});
