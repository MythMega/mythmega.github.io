// old_daily.js
// Page pour afficher les défis passés (daily ET weekly) avec onglets

const OldDaily = (function () {
  const dailyContainer  = document.getElementById('dailiesContainer');
  const weeklyContainer = document.getElementById('weekliesContainer');
  const noDailiesMsg    = document.getElementById('noDailies');
  const tabDailyBtn     = document.getElementById('tabDailyBtn');
  const tabWeeklyBtn    = document.getElementById('tabWeeklyBtn');

  const DB_NAME    = 'PokefeetDB';
  const DB_VERSION = 3;
  let dbInstance   = null;

  function getDB() {
    return new Promise((resolve, reject) => {
      if (dbInstance) { resolve(dbInstance); return; }
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return; settled = true;
        console.warn('[PokefeetDB] indexedDB.open() timed out — running without DB.');
        reject(new Error('IDB open timeout'));
      }, 5000);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror   = () => { if (settled) return; settled = true; clearTimeout(timer); reject(req.error); };
      req.onblocked = () => {
        if (settled) return; settled = true; clearTimeout(timer);
        console.warn('[PokefeetDB] Upgrade blocked — please close other Pokefeet tabs and reload.');
        reject(new Error('IDB upgrade blocked'));
      };
      req.onsuccess = () => {
        if (settled) return; settled = true; clearTimeout(timer);
        dbInstance = req.result;
        dbInstance.addEventListener('versionchange', () => { dbInstance.close(); dbInstance = null; });
        resolve(dbInstance);
      };
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('daily_results'))
          db.createObjectStore('daily_results',  { keyPath: 'date' });
        if (!db.objectStoreNames.contains('weekly_results'))
          db.createObjectStore('weekly_results', { keyPath: 'date' });
      };
    });
  }

  async function getAllFromStore(storeName) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx    = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req   = store.getAll();
      req.onsuccess = () => {
        const map = {};
        req.result.forEach(item => { map[item.date] = item; });
        resolve(map);
      };
      req.onerror = () => reject(req.error);
    });
  }

  // ── helpers ────────────────────────────────────────────────
  function getMondayOfWeek(d) {
    const date = new Date(d);
    date.setHours(0, 0, 0, 0);
    const day  = date.getDay();
    const diff = (day === 0) ? -6 : 1 - day;
    date.setDate(date.getDate() + diff);
    return date;
  }

  function dateToStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  function formatDate(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const locale = (typeof Translator !== 'undefined' && Translator.getLanguage() === 'fr') ? 'fr-FR' : 'en-GB';
    return date.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function formatWeekLabel(mondayStr) {
    const [year, month, day] = mondayStr.split('-').map(Number);
    const monday = new Date(year, month - 1, day);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const opts   = { day: 'numeric', month: 'short' };
    const locale = (typeof Translator !== 'undefined' && Translator.getLanguage() === 'fr') ? 'fr-FR' : 'en-GB';
    if (typeof Translator !== 'undefined') {
      return Translator.get('history.weekLabel', 'Semaine du {from} au {to} {year}')
        .replace('{from}', monday.toLocaleDateString(locale, opts))
        .replace('{to}',   sunday.toLocaleDateString(locale, opts))
        .replace('{year}', year);
    }
    return `Semaine du ${monday.toLocaleDateString(locale, opts)} au ${sunday.toLocaleDateString(locale, opts)} ${year}`;
  }

  // ── DAILY tab ──────────────────────────────────────────────
  async function renderDailyTab() {
    const allDailies  = await getAllFromStore('daily_results');
    const allWeeklies = await getAllFromStore('weekly_results');

    // Start date = min(oldest daily, oldest weekly)
    const dailyDates  = Object.keys(allDailies).sort();
    const weeklyDates = Object.keys(allWeeklies).sort();
    const allOldest   = [...dailyDates, ...weeklyDates].sort();

    dailyContainer.innerHTML = '';
    noDailiesMsg.classList.add('hidden');

    if (allOldest.length === 0) {
      noDailiesMsg.classList.remove('hidden');
      return;
    }

    const oldestStr = allOldest[0];
    const [eY, eM, eD] = oldestStr.split('-').map(Number);
    const startDate = new Date(eY, eM - 1, eD);
    startDate.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const current = new Date(today);

    while (current >= startDate) {
      const dateStr = dateToStr(current);
      const played  = allDailies.hasOwnProperty(dateStr);
      const btn     = document.createElement('a');
      btn.href      = `daily.html?date=${dateStr}`;
      btn.className = `daily-button ${played ? 'played' : 'available'}`;
      btn.textContent = formatDate(dateStr);
      btn.title     = played
        ? (typeof Translator !== 'undefined' ? Translator.get('oldDaily.playedTitle', 'Déjà joué') : 'Déjà joué')
        : (typeof Translator !== 'undefined' ? Translator.get('oldDaily.availableTitle', 'Disponible') : 'Disponible');
      dailyContainer.appendChild(btn);
      current.setDate(current.getDate() - 1);
    }
  }

  // ── WEEKLY tab ─────────────────────────────────────────────
  async function renderWeeklyTab() {
    const allDailies  = await getAllFromStore('daily_results');
    const allWeeklies = await getAllFromStore('weekly_results');

    const dailyDates  = Object.keys(allDailies).sort();
    const weeklyDates = Object.keys(allWeeklies).sort();
    const allOldest   = [...dailyDates, ...weeklyDates].sort();

    weeklyContainer.innerHTML = '';
    noDailiesMsg.classList.add('hidden');

    if (allOldest.length === 0) {
      noDailiesMsg.classList.remove('hidden');
      return;
    }

    const oldestStr = allOldest[0];
    const [eY, eM, eD] = oldestStr.split('-').map(Number);
    // Align to Monday
    const startMonday = getMondayOfWeek(new Date(eY, eM - 1, eD));

    const today = new Date();
    const currentMonday = getMondayOfWeek(today);

    const current = new Date(currentMonday);
    while (current >= startMonday) {
      const mondayStr = dateToStr(current);
      const played    = allWeeklies.hasOwnProperty(mondayStr);
      const btn       = document.createElement('a');
      btn.href        = `weekly.html?week=${mondayStr}`;
      btn.className   = `daily-button ${played ? 'played' : 'available'}`;
      btn.textContent = formatWeekLabel(mondayStr);
      btn.title       = played
        ? (typeof Translator !== 'undefined' ? Translator.get('oldDaily.weeklyPlayedTitle', 'Déjà joué') : 'Déjà joué')
        : (typeof Translator !== 'undefined' ? Translator.get('oldDaily.weeklyAvailableTitle', 'Disponible') : 'Disponible');
      weeklyContainer.appendChild(btn);
      current.setDate(current.getDate() - 7);
    }
  }

  // ── Tab switching ──────────────────────────────────────────
  function switchTab(tab) {
    if (tab === 'daily') {
      tabDailyBtn.classList.add('active');
      tabWeeklyBtn.classList.remove('active');
      dailyContainer.style.display  = '';
      weeklyContainer.style.display = 'none';
    } else {
      tabWeeklyBtn.classList.add('active');
      tabDailyBtn.classList.remove('active');
      weeklyContainer.style.display = '';
      dailyContainer.style.display  = 'none';
    }
  }

  // ── Init ───────────────────────────────────────────────────
  async function init() {
    tabDailyBtn.addEventListener('click',  () => switchTab('daily'));
    tabWeeklyBtn.addEventListener('click', () => switchTab('weekly'));

    try {
      await Promise.all([renderDailyTab(), renderWeeklyTab()]);
    } catch (e) {
      console.error('Error initializing past challenges page:', e);
      noDailiesMsg.classList.remove('hidden');
    }
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => { OldDaily.init(); });
