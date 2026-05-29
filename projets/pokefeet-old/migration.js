// migration.js
// Automatic migration from cookie (pk_daily_result_v2) to IndexedDB
// This script runs once before data.js loads

const Migration = (function () {
  const COOKIE_DAILY = 'pk_daily_result_v2';
  const DB_NAME = 'PokefeetDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'daily_results';

  // Get cookie by name
  function getCookie(name) {
    const v = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
    return v ? decodeURIComponent(v.pop()) : null;
  }

  // Delete cookie by name
  function deleteCookie(name) {
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/`;
  }

  // Show notification via the existing system
  function showNotification(message) {
    const container = document.getElementById('notifications');
    if (!container) {
      console.log(message); // fallback if notifications container doesn't exist yet
      return;
    }
    const n = document.createElement('div');
    n.className = 'notification';
    n.textContent = message;
    n.style.background = '#0b5a2a'; // green success color
    container.appendChild(n);
    setTimeout(() => {
      n.style.opacity = 0;
      try { container.removeChild(n); } catch (e) {}
    }, 3000);
  }

  // Initialize IndexedDB with daily_results store
  function initDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
      
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'date' });
        }
      };
    });
  }

  // Migrate cookie data to IndexedDB
  async function migrateData(db, cookieData) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      // Clear existing data (optional: use caution)
      // const clearReq = store.clear();

      // Insert each date entry
      let migratedCount = 0;
      for (const date in cookieData) {
        if (cookieData.hasOwnProperty(date)) {
          store.put({
            date: date,
            ...cookieData[date] // score, results, etc.
          });
          migratedCount++;
        }
      }

      tx.oncomplete = () => resolve(migratedCount);
      tx.onerror = () => reject(tx.error);
    });
  }

  // Main migration runner
  async function run() {
    try {
      // Check for cookie
      const cookieRaw = getCookie(COOKIE_DAILY);
      if (!cookieRaw) {
        // No cookie found, nothing to migrate
        console.log('Migration: no cookie found, skipping.');
        return;
      }

      // Parse cookie
      let cookieData;
      try {
        cookieData = JSON.parse(cookieRaw);
      } catch (e) {
        console.error('Migration: failed to parse cookie JSON', e);
        return;
      }

      // Validate it's an object (not array)
      if (!cookieData || typeof cookieData !== 'object' || Array.isArray(cookieData)) {
        console.warn('Migration: cookie data is not a valid object, skipping.');
        return;
      }

      // Initialize IndexedDB
      const db = await initDB();

      // Check if already migrated (any data in IndexedDB?)
      const countReq = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).count();
      const existingCount = await new Promise((resolve, reject) => {
        countReq.onsuccess = () => resolve(countReq.result);
        countReq.onerror = () => reject(countReq.error);
      });

      if (existingCount > 0) {
        console.log('Migration: IndexedDB already has data, skipping to avoid duplicates.');
        db.close();
        return;
      }

      // Perform migration
      const migratedCount = await migrateData(db, cookieData);
      console.log(`Migration: ${migratedCount} entries migrated to IndexedDB successfully.`);

      // Show notification (will appear once notifications container is ready)
      setTimeout(() => {
        showNotification(`[V2] Migration successful - ${migratedCount} dailies updated`);
      }, 100);

      // Delete the old cookie
      // TEMPORARLY NOT DELETE
      // deleteCookie(COOKIE_DAILY);
      console.log('Migration: old cookie deleted.');

      db.close();
    } catch (e) {
      console.error('Migration error:', e);
    }
  }

  return {
    run
  };
})();

// Run migration immediately (before data.js initializes)
Migration.run();
