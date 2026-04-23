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
    // format "16 Dec 2025"
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
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
      batch.forEach(dateKey => {
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
        row.innerHTML = `<strong>${dateLabel}</strong> - Score : ${score}/${COUNT * 10} - <span style="font-family:monospace">${emojis}</span>${dexIcon}`;
        container.insertBefore(row, showMoreBtn);
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

  // auto render on DOM ready
  document.addEventListener('DOMContentLoaded', () => {
    render();
  });
})();
