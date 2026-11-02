// challenge-window.js — Fenêtre des défis passés rejouables (daily et weekly).
//
// Un daily ou un weekly passé n'est rejouable que s'il fait partie des défis
// proposés par la page « Défis passés » (old_challenges.html). La fenêtre
// commence au plus ancien défi enregistré — daily ou weekly, le plus ancien des
// deux — et va jusqu'à aujourd'hui.
//
// Ce module est la seule source de vérité de cette règle :
//   - old_challenges.html y prend la première date proposée ;
//   - daily.js et weekly.js y vérifient la date demandée dans l'URL.
// La liste proposée et la liste acceptée ne peuvent donc pas diverger, et il
// n'est plus possible de se fabriquer de l'XP ou des Pokédollars rétroactifs en
// ouvrant daily.html?date=… à une date antérieure à son premier défi.
const ChallengeWindow = (function () {
  const DB_NAME = 'PokefeetDB';
  const DB_VERSION = 4;
  const DAILY_STORE = 'daily_results';
  const WEEKLY_STORE = 'weekly_results';

  let dbInstance = null;
  let idbTimedOut = false;

  // ── Dates ──────────────────────────────────────────────────
  function dateToStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function todayStr() {
    return dateToStr(new Date());
  }

  // Lundi de la semaine contenant la date demandée (YYYY-MM-DD → YYYY-MM-DD).
  function mondayOf(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7)); // 0 = lundi
    return dateToStr(date);
  }

  // Règle de la fenêtre, version pure : plus ancienne date enregistrée, daily et
  // weekly confondus. `null` tant qu'aucun défi n'a été joué.
  function firstDateOf(dailyDates, weeklyDates) {
    const all = [].concat(dailyDates || [], weeklyDates || []).sort();
    return all.length ? all[0] : null;
  }

  // ── Lecture de l'historique ────────────────────────────────
  function getDB() {
    return new Promise((resolve, reject) => {
      if (idbTimedOut) { reject(new Error('IDB unavailable')); return; }
      if (dbInstance) { resolve(dbInstance); return; }
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return; settled = true;
        idbTimedOut = true;
        console.warn('[PokefeetDB] indexedDB.open() timed out — running without DB.');
        reject(new Error('IDB open timeout'));
      }, 5000);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => { if (settled) return; settled = true; clearTimeout(timer); reject(req.error); };
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
        if (!db.objectStoreNames.contains(DAILY_STORE)) {
          db.createObjectStore(DAILY_STORE, { keyPath: 'date' });
        }
        if (!db.objectStoreNames.contains(WEEKLY_STORE)) {
          db.createObjectStore(WEEKLY_STORE, { keyPath: 'date' });
        }
      };
    });
  }

  // Clés (dates) d'un store. Store absent ou base inaccessible → aucune date :
  // dans le doute la fenêtre reste fermée, seul le défi du jour est jouable.
  async function readDates(storeName) {
    const db = await getDB();
    return new Promise((resolve) => {
      if (!db.objectStoreNames.contains(storeName)) { resolve([]); return; }
      const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }

  async function getFirstDate() {
    try {
      const [daily, weekly] = await Promise.all([
        readDates(DAILY_STORE),
        readDates(WEEKLY_STORE)
      ]);
      return firstDateOf(daily, weekly);
    } catch (e) {
      return null;
    }
  }

  // Date minimale atteignable : la plus ancienne date enregistrée, ou aujourd'hui
  // tant qu'aucun défi n'a été joué (seul le défi du jour est alors accessible).
  async function getMin(kind) {
    const first = await getFirstDate();
    if (kind === 'weekly') return mondayOf(first || todayStr());
    return first || todayStr();
  }

  // Vérifie une date demandée dans l'URL. `ok: false` → la page doit afficher la
  // popup avec la date tentée et la date minimale atteignable.
  async function check(kind, dateStr) {
    const min = await getMin(kind);
    return { ok: dateStr >= min, attempted: dateStr, min };
  }

  // ── Popup « défi non disponible » ──────────────────────────
  function T(key, fallback) {
    return typeof Translator !== 'undefined' ? Translator.get(key, fallback) : fallback;
  }

  function formatLong(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const lang = typeof Translator !== 'undefined' ? Translator.getLanguage() : 'fr';
    try {
      return new Date(y, m - 1, d).toLocaleDateString(lang, {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      });
    } catch (e) {
      return dateStr;
    }
  }

  function showUnavailablePopup(kind, attempted, min) {
    const isWeekly = kind === 'weekly';

    const backdrop = document.createElement('div');
    backdrop.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:1000;';

    const popup = document.createElement('div');
    popup.style.cssText = 'background:var(--card);padding:24px;border-radius:12px;max-width:420px;width:90%;text-align:center;';

    const title = document.createElement('h2');
    title.textContent = T('challengeWindow.unavailableTitle', "Ce challenge n'est pas disponible pour vous");
    title.style.cssText = 'margin:0 0 14px 0;color:#fff;';
    popup.appendChild(title);

    const msg = document.createElement('p');
    msg.textContent = isWeekly
      ? T('challengeWindow.unavailableWeekly', 'Vous ne pouvez rejouer un Weekly qu\'à partir de votre tout premier défi enregistré.')
      : T('challengeWindow.unavailableDaily', 'Vous ne pouvez rejouer un Daily qu\'à partir de votre tout premier défi enregistré.');
    msg.style.cssText = 'color:var(--muted);margin:0 0 18px 0;line-height:1.5;';
    popup.appendChild(msg);

    const dates = document.createElement('div');
    dates.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin:0 0 20px 0;font-size:14px;';
    [
      [T('challengeWindow.attemptedDate', 'Date demandée'), formatLong(attempted)],
      [T('challengeWindow.earliestDate', 'Date minimale atteignable'), formatLong(min)]
    ].forEach(function (row) {
      const line = document.createElement('div');
      line.style.cssText = 'display:flex;justify-content:space-between;gap:12px;padding:8px 12px;background:rgba(255,255,255,0.04);border-radius:8px;text-align:left;';
      const label = document.createElement('span');
      label.textContent = row[0];
      label.style.cssText = 'color:var(--muted);';
      const value = document.createElement('strong');
      value.textContent = row[1];
      value.style.cssText = 'color:#fff;';
      line.appendChild(label);
      line.appendChild(value);
      dates.appendChild(line);
    });
    popup.appendChild(dates);

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;flex-direction:column;gap:10px;';

    const today = document.createElement('button');
    today.textContent = isWeekly
      ? T('challengeWindow.playCurrentWeek', 'Jouer la semaine en cours')
      : T('challengeWindow.playToday', 'Jouer aujourd\'hui');
    today.style.cssText = 'width:100%;padding:12px;background:var(--accent);color:#052018;font-weight:700;border:none;border-radius:8px;cursor:pointer;font-size:15px;';
    today.addEventListener('click', () => {
      window.location.href = isWeekly ? 'weekly.html' : 'daily.html';
    });
    actions.appendChild(today);

    const past = document.createElement('button');
    past.className = 'secondary';
    past.textContent = T('challengeWindow.pastChallenges', 'Défis passés');
    past.style.cssText = 'width:100%;padding:12px;border-radius:8px;cursor:pointer;font-size:15px;';
    past.addEventListener('click', () => {
      window.location.href = 'old_challenges.html';
    });
    actions.appendChild(past);

    popup.appendChild(actions);
    backdrop.appendChild(popup);
    document.body.appendChild(backdrop);
  }

  async function checkDaily(dateStr) { return check('daily', dateStr); }
  async function checkWeekly(dateStr) { return check('weekly', dateStr); }

  return {
    firstDateOf,
    mondayOf,
    todayStr,
    getFirstDate,
    checkDaily,
    checkWeekly,
    showUnavailablePopup
  };
})();
