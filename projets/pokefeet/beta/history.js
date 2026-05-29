// history.js
(function () {
  const DB_NAME    = 'PokefeetDB';
  const DB_VERSION = 2;
  const STORE_NAME = 'daily_results';
  const WEEKLY_STORE = 'weekly_results';
  const COUNT        = 5;
  const WEEKLY_COUNT = 10;
  let dbInstance = null;

  function getDB() {
    return new Promise((resolve, reject) => {
      if (dbInstance) {
        resolve(dbInstance);
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        dbInstance = req.result;
        resolve(dbInstance);
      };
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'date' });
        }
        if (!db.objectStoreNames.contains(WEEKLY_STORE)) {
          db.createObjectStore(WEEKLY_STORE, { keyPath: 'date' });
        }
      };
    });
  }

  async function loadWeeklyHistory() {
    try {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx    = db.transaction(WEEKLY_STORE, 'readonly');
        const store = tx.objectStore(WEEKLY_STORE);
        const req   = store.getAll();
        req.onsuccess = () => {
          const obj = {};
          req.result.forEach(item => {
            obj[item.date] = { score: item.score, results: item.results, importedInDex: item.importedInDex || false };
          });
          resolve(obj);
        };
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.error('Error loading weekly history:', e);
      return {};
    }
  }

  async function loadHistory() {
    try {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
          const arr = req.result;
          const obj = {};
          arr.forEach(item => {
            const date = item.date;
            const { score, results, importedInDex } = item;
            obj[date] = { score, results, importedInDex: importedInDex || false };
          });
          resolve(obj);
        };
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.error('Error loading history from IndexedDB:', e);
      return {};
    }
  }

  function formatDateLabel(isoDate) {
    // isoDate = YYYY-MM-DD
    const d = new Date(isoDate + 'T00:00:00');
    const locale = (typeof Translator !== 'undefined' && Translator.getLanguage() === 'fr') ? 'fr-FR' : 'en-GB';
    // format "16 Dec 2025" / "16 déc. 2025"
    return d.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function emojiLineFromResults(results) {
    // results: array of up to COUNT items
    const parts = [];
    for (let i = 0; i < COUNT; i++) {
      const r = results && results[i];
      if (!r) {
        parts.push('🟥');
      } else if (r.outcome === 'fail') {
        parts.push('🟥');
      } else if (r.outcome === 'win') {
        if (r.attempts === 0) {
          parts.push('🟩');
        } else {
          // orange square with tooltip showing number of failed attempts
          parts.push(`<span class="emoji-tooltip" aria-label="fails: ${r.attempts}" title="fails: ${r.attempts}">🟧</span>`);
        }
      } else {
        parts.push('🟥');
      }
    }
    return parts.join('');
  }

  async function render() {
    await PokemonVersions.load();
    const history = await loadHistory();
    const keys = Object.keys(history);
    const container = document.getElementById('historyList');
    const totalDaysEl = document.getElementById('totalDays');
    container.innerHTML = '';

    if (!keys.length) {
      container.innerHTML = '<p>Aucun résultat enregistré pour le moment.</p>';
      totalDaysEl.textContent = '0';
      return;
    }

    // trier par date décroissante (YYYY-MM-DD lexical sort fonctionne)
    keys.sort((a, b) => b.localeCompare(a));

    totalDaysEl.textContent = keys.length;

    const PAGE_SIZE = 25;
    let displayed = 0;

    function renderRows() {
      const batch = keys.slice(displayed, displayed + PAGE_SIZE);
      batch.forEach((dateKey, batchIdx) => {
        const globalIdx = displayed + batchIdx;
        const entry = history[dateKey] || {};
        const score = entry.score || 0;
        const results = entry.results || [];
        const importedInDex = entry.importedInDex || false;
        const dateLabel = formatDateLabel(dateKey);
        const emojis = emojiLineFromResults(results);
        const dexIcon = importedInDex ? ' <span style="color:#4ade80;">✓</span>' : '';

        const row = document.createElement('div');
        row.style.padding = '10px 0';
        row.style.borderBottom = '1px solid rgba(255,255,255,0.03)';
        row.style.cursor = 'pointer';
        row.title = 'Voir ce daily';
        row.innerHTML = `<strong style="text-decoration:underline dotted;">${dateLabel}</strong> - Score : ${score}/${COUNT * 10} - <span style="font-family:monospace">${emojis}</span>${dexIcon}`;
        row.addEventListener('click', (e) => {
          if (e.target.closest('.emoji-tooltip')) return;
          window.location.href = `daily.html?date=${dateKey}`;
        });
        container.insertBefore(row, showMoreBtn);

        // Séparateur mise à jour : entre cette entrée (plus récente) et la suivante (plus ancienne)
        const nextDateKey = keys[globalIdx + 1];
        if (nextDateKey) {
          (PokemonVersions.getData() || []).forEach(v => {
            if (v.deploy_date && v.deploy_date > nextDateKey && v.deploy_date <= dateKey) {
              const sep = document.createElement('div');
              sep.style.cssText = 'padding:5px 12px;background:#a16207;color:#fef9c3;font-size:12px;font-weight:700;border-radius:6px;margin:3px 0;text-align:center;letter-spacing:.03em;';
              sep.textContent = Translator.get('history.update', '↑ Mise à jour : {name} ({date}) ↓').replace('{name}', v.Update_Name).replace('{date}', v.deploy_date);
              container.insertBefore(sep, showMoreBtn);
            }
          });
        }
      });
      displayed += batch.length;

      if (displayed >= keys.length) {
        showMoreBtn.style.display = 'none';
      } else {
        showMoreBtn.style.display = '';
      }

      setupEmojiTooltips();
    }

    const showMoreBtn = document.createElement('button');
    showMoreBtn.className = 'secondary';
    showMoreBtn.style.cssText = 'margin-top:12px; padding:8px 16px; width:100%;';
    showMoreBtn.setAttribute('data-i18n', 'history.showMore');
    showMoreBtn.textContent = Translator.get('history.showMore', 'Afficher 25 de plus');
    showMoreBtn.addEventListener('click', renderRows);
    container.appendChild(showMoreBtn);

    renderRows();
  }

  // Mobile-friendly tooltip toggle for emoji
  function setupEmojiTooltips() {
    const tooltips = document.querySelectorAll('.emoji-tooltip');
    tooltips.forEach(tooltip => {
      if (tooltip._tooltipSetup) return;
      tooltip._tooltipSetup = true;
      tooltip.addEventListener('click', (e) => {
        e.preventDefault();
        tooltips.forEach(t => t.classList.remove('active'));
        tooltip.classList.add('active');
      });
    });
    // Close tooltip when clicking elsewhere
    if (!document._tooltipDismiss) {
      document._tooltipDismiss = true;
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.emoji-tooltip')) {
          document.querySelectorAll('.emoji-tooltip').forEach(t => t.classList.remove('active'));
        }
      });
    }
  }

  function emojiLineFromResultsWeekly(results) {
    const parts = [];
    for (let i = 0; i < WEEKLY_COUNT; i++) {
      const r = results && results[i];
      if (!r) { parts.push('🟥'); }
      else if (r.outcome === 'fail') { parts.push('🟥'); }
      else if (r.outcome === 'win') {
        parts.push(r.attempts === 0 ? '🟩' : `<span class="emoji-tooltip" title="fails: ${r.attempts}">🟧</span>`);
      } else { parts.push('🟥'); }
    }
    return parts.join('');
  }

  function formatWeekLabel(mondayStr) {
    const [y, m, d] = mondayStr.split('-').map(Number);
    const monday = new Date(y, m - 1, d);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const locale = (typeof Translator !== 'undefined' && Translator.getLanguage() === 'fr') ? 'fr-FR' : 'en-GB';
    const opts = { day: 'numeric', month: 'short' };
    if (typeof Translator !== 'undefined') {
      return Translator.get('history.weekLabel', 'Semaine du {from} au {to} {year}')
        .replace('{from}', monday.toLocaleDateString(locale, opts))
        .replace('{to}', sunday.toLocaleDateString(locale, opts))
        .replace('{year}', y);
    }
    return `Semaine du ${monday.toLocaleDateString(locale, opts)} au ${sunday.toLocaleDateString(locale, opts)} ${y}`;
  }

  async function renderWeekly() {
    await PokemonVersions.load();
    const history = await loadWeeklyHistory();
    const keys = Object.keys(history);
    const container = document.getElementById('weeklyHistoryList');
    const totalDaysEl = document.getElementById('totalDays');
    container.innerHTML = '';

    if (!keys.length) {
      container.innerHTML = '<p>Aucun résultat weekly enregistré.</p>';
      return;
    }
    keys.sort((a, b) => b.localeCompare(a));
    totalDaysEl.textContent = keys.length;

    const PAGE_SIZE = 25;
    let displayed = 0;
    const showMoreBtn = document.createElement('button');
    showMoreBtn.className = 'secondary';
    showMoreBtn.style.cssText = 'margin-top:12px; padding:8px 16px; width:100%;';
    showMoreBtn.textContent = Translator.get('history.showMore', 'Afficher 25 de plus');
    showMoreBtn.addEventListener('click', renderRows);
    container.appendChild(showMoreBtn);

    function renderRows() {
      const batch = keys.slice(displayed, displayed + PAGE_SIZE);
      batch.forEach(dateKey => {
        const entry = history[dateKey] || {};
        const score = entry.score || 0;
        const results = entry.results || [];
        const dexIcon = entry.importedInDex ? ' <span style="color:#4ade80;">✓</span>' : '';
        const emojis = emojiLineFromResultsWeekly(results);
        const row = document.createElement('div');
        row.style.cssText = 'padding:10px 0; border-bottom:1px solid rgba(255,255,255,0.03); cursor:pointer;';
        row.title = 'Voir ce weekly';
        row.innerHTML = `<strong style="text-decoration:underline dotted;">${formatWeekLabel(dateKey)}</strong><br>Score : ${score}/${WEEKLY_COUNT * 10} — <span style="font-family:monospace">${emojis}</span>${dexIcon}`;
        row.addEventListener('click', () => { window.location.href = `weekly.html?week=${dateKey}`; });
        container.insertBefore(row, showMoreBtn);
      });
      displayed += batch.length;
      showMoreBtn.style.display = displayed >= keys.length ? 'none' : '';
    }
    renderRows();
  }

  // auto render on DOM ready
  document.addEventListener('DOMContentLoaded', () => {
    const tabDailyBtn  = document.getElementById('histTabDailyBtn');
    const tabWeeklyBtn = document.getElementById('histTabWeeklyBtn');
    const dailyPanel   = document.getElementById('histDailyPanel');
    const weeklyPanel  = document.getElementById('histWeeklyPanel');
    const totalDaysEl  = document.getElementById('totalDays');

    let weeklyRendered = false;

    if (tabDailyBtn) tabDailyBtn.addEventListener('click', () => {
      tabDailyBtn.classList.add('active');
      tabWeeklyBtn.classList.remove('active');
      dailyPanel.style.display  = '';
      weeklyPanel.style.display = 'none';
      const lbl = document.getElementById('totalCountLabel');
      if (lbl) lbl.textContent = Translator.get('history.totalDays', 'Total jours');
      loadHistory().then(h => { totalDaysEl.textContent = Object.keys(h).length; });
    });

    if (tabWeeklyBtn) tabWeeklyBtn.addEventListener('click', () => {
      tabWeeklyBtn.classList.add('active');
      tabDailyBtn.classList.remove('active');
      weeklyPanel.style.display = '';
      dailyPanel.style.display  = 'none';
      const lbl = document.getElementById('totalCountLabel');
      if (lbl) lbl.textContent = Translator.get('history.totalWeeks', 'Total semaines');
      if (!weeklyRendered) { weeklyRendered = true; renderWeekly(); }
      else { loadWeeklyHistory().then(h => { totalDaysEl.textContent = Object.keys(h).length; }); }
      if (window.HistoryCurve) HistoryCurve.renderWeekly();
    });

    render();
  });
})();
