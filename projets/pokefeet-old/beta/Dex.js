// Dex.js - Core Dex logic (excluding import)
const Dex = (function () {
  const DB_NAME = 'PokefeetDexDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'dex_entries';
  let dbInstance = null;
  let allPokemons = [];

  // Get IndexedDB instance
  function getDB() {
    console.log('[Dex] Getting DB instance');
    return new Promise((resolve, reject) => {
      if (dbInstance) {
        console.log('[Dex] DB instance already exists');
        resolve(dbInstance);
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => {
        console.error('[Dex] DB open error:', req.error);
        reject(req.error);
      };
      req.onsuccess = () => {
        dbInstance = req.result;
        console.log('[Dex] DB opened successfully');
        resolve(dbInstance);
      };
      req.onupgradeneeded = (e) => {
        console.log('[Dex] Upgrading DB');
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'index' });
          console.log('[Dex] Created object store:', STORE_NAME);
        }
      };
    });
  }

  // Get all dex entries
  async function getAllDexEntries() {
    console.log('[Dex] Getting all dex entries');
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        console.log('[Dex] Retrieved dex entries:', req.result.length);
        resolve(req.result);
      };
      req.onerror = () => {
        console.error('[Dex] Error getting dex entries:', req.error);
        reject(req.error);
      };
    });
  }

  // Get dex entry by index
  async function getDexEntry(index) {
    console.log('[Dex] Getting dex entry for index:', index);
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(index);
      req.onsuccess = () => {
        console.log('[Dex] Retrieved entry for', index, ':', req.result);
        resolve(req.result);
      };
      req.onerror = () => {
        console.error('[Dex] Error getting entry for', index, ':', req.error);
        reject(req.error);
      };
    });
  }

  // Update or create dex entry
  async function updateDexEntry(index, updates) {
    console.log('[Dex] Updating dex entry for index:', index, 'with:', updates);
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(index);
      req.onsuccess = () => {
        let entry = req.result || { index: index, found: false, firstFoundDate: null, count: 0 };
        Object.assign(entry, updates);
        const putReq = store.put(entry);
        putReq.onsuccess = () => {
          console.log('[Dex] Updated entry for', index);
          resolve(entry);
        };
        putReq.onerror = () => {
          console.error('[Dex] Error updating entry for', index, ':', putReq.error);
          reject(putReq.error);
        };
      };
      req.onerror = () => {
        console.error('[Dex] Error getting entry for update:', req.error);
        reject(req.error);
      };
    });
  }

  // Mark Pokemon as found (increment count, set first date if new)
  async function markFound(index, date = new Date().toISOString()) {
    console.log('[Dex] Marking as found:', index, 'on date:', date);
    const existing = await getDexEntry(index).catch(() => null);
    const updates = {
      found: true,
      count: (existing?.count || 0) + 1
    };
    if (!existing || !existing.firstFoundDate) {
      updates.firstFoundDate = date;
    }
    return updateDexEntry(index, updates);
  }

  // Add new Dex entry (for import - count always 1, don't modify if exists)
  async function addNewDexEntry(index, date = new Date().toISOString()) {
    console.log('[Dex] Adding new dex entry:', index, 'on date:', date);
    const existing = await getDexEntry(index).catch(() => null);
    if (existing && existing.found) {
      console.log('[Dex] Entry already exists and found, skipping');
      return existing;
    }
    const updates = {
      found: true,
      count: 1,
      firstFoundDate: date
    };
    return updateDexEntry(index, updates);
  }

  // Load Pokemon data
  async function loadPokemons() {
    console.log('[Dex] Loading Pokemon data');
    try {
      const res = await fetch('data/pokemons.json');
      const arr = await res.json();
      allPokemons = arr.map(p => new Pokemon(p));
      console.log('[Dex] Loaded', allPokemons.length, 'Pokemon');
    } catch (e) {
      console.error('[Dex] Error loading Pokemon data:', e);
      allPokemons = [];
    }
  }

  // Get progress: number of found Pokemon
  async function getProgress() {
    console.log('[Dex] Calculating progress');
    const entries = await getAllDexEntries();
    const found = entries.filter(e => e.found).length;
    console.log('[Dex] Progress:', found, '/', allPokemons.length);
    return { found, total: allPokemons.length };
  }

  return {
    init: loadPokemons,
    getAllDexEntries,
    getDexEntry,
    updateDexEntry,
    markFound,
    addNewDexEntry,
    getProgress,
    getAllPokemons: () => allPokemons
  };
})();