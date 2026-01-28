// old_daily.js
// Page pour afficher les dailies passés et rejouer les dailies manqués

const OldDaily = (function () {
  const container = document.getElementById('dailiesContainer');
  const noDailiesMsg = document.getElementById('noDailies');
  const DB_NAME = 'PokefeetDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'daily_results';
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

  // Get all daily results from indexedDB
  async function getAllDailyResults() {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const results = {};
        req.result.forEach(item => {
          results[item.date] = item;
        });
        resolve(results);
      };
      req.onerror = () => reject(req.error);
    });
  }

  // Generate date range from today back to the earliest daily in DB
  async function generateDateRange() {
    const allDailies = await getAllDailyResults();
    const dates = Object.keys(allDailies).sort();

    if (dates.length === 0) {
      return [];
    }

    const today = new Date();
    const startDate = new Date();
    const endDateStr = dates[0]; // earliest date
    const [eYear, eMonth, eDay] = endDateStr.split('-').map(Number);
    startDate.setFullYear(eYear, eMonth - 1, eDay);

    const dateRange = [];
    const current = new Date(today);
    current.setHours(0, 0, 0, 0);
    startDate.setHours(0, 0, 0, 0);

    while (current >= startDate) {
      const y = current.getFullYear();
      const m = String(current.getMonth() + 1).padStart(2, '0');
      const d = String(current.getDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${d}`;
      dateRange.push({ date: dateStr, played: allDailies.hasOwnProperty(dateStr) });
      current.setDate(current.getDate() - 1);
    }

    return dateRange;
  }

  // Format date for display
  function formatDate(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const options = { weekday: 'short', month: 'short', day: 'numeric' };
    return date.toLocaleDateString('fr-FR', options);
  }

  // Create a button for each daily
  function createDailyButton(dateInfo) {
    const button = document.createElement('a');
    button.href = `daily.html?date=${dateInfo.date}`;
    button.className = `daily-button ${dateInfo.played ? 'played' : 'available'}`;
    button.textContent = formatDate(dateInfo.date);
    button.title = dateInfo.played ? 'Daily déjà joué' : 'Daily disponible - Cliquez pour jouer';
    return button;
  }

  // Initialize the page
  async function init() {
    try {
      const dateRange = await generateDateRange();

      if (dateRange.length === 0) {
        noDailiesMsg.classList.remove('hidden');
        return;
      }

      container.innerHTML = '';
      dateRange.forEach(dateInfo => {
        const button = createDailyButton(dateInfo);
        container.appendChild(button);
      });
    } catch (e) {
      console.error('Error initializing old daily page:', e);
      noDailiesMsg.classList.remove('hidden');
    }
  }

  return {
    init
  };
})();

// Auto-init on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  OldDaily.init();
});
