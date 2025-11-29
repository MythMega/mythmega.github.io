// history.js
(function () {
  const DB_NAME = 'PokefeetDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'daily_results';
  const COUNT = 5;
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
      };
    });
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
            const { score, results } = item;
            obj[date] = { score, results };
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
    // format "16 Dec 2025"
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function emojiLineFromResults(results) {
    // results: array of up to COUNT items
    const arr = [];
    for (let i = 0; i < COUNT; i++) {
      const r = results && results[i];
      if (!r) {
        arr.push('🟥');
      } else if (r.outcome === 'fail') {
        arr.push('🟥');
      } else if (r.outcome === 'win') {
        arr.push(r.attempts === 0 ? '🟩' : '🟧');
      } else {
        arr.push('🟥');
      }
    }
    return arr.join('');
  }

  async function render() {
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

    keys.forEach(dateKey => {
      const entry = history[dateKey] || {};
      const score = entry.score || 0;
      const results = entry.results || [];
      const dateLabel = formatDateLabel(dateKey);
      const emojis = emojiLineFromResults(results);

      const row = document.createElement('div');
      row.style.padding = '10px 0';
      row.style.borderBottom = '1px solid rgba(255,255,255,0.03)';
      row.innerHTML = `<strong>${dateLabel}</strong> - Score : ${score}/${COUNT * 10} - <span style="font-family:monospace">${emojis}</span>`;
      container.appendChild(row);
    });
  }

  // auto render on DOM ready
  document.addEventListener('DOMContentLoaded', () => render());
})();
