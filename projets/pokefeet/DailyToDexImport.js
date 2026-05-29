// DailyToDexImport.js - Import logic from Daily/Weekly to Dex
const DailyToDexImport = (function () {
  const DAILY_DB_NAME   = 'PokefeetDB';
  const DAILY_STORE_NAME   = 'daily_results';
  const WEEKLY_STORE_NAME  = 'weekly_results';
  const DAILY_COUNT  = 5;
  const WEEKLY_COUNT = 10;
  let allPokemons = [];

  // Load Pokemon data
  async function loadPokemons() {
    console.log('[Import] Loading Pokemon data');
    try {
      const [res] = await Promise.all([
        fetch('data/pokemons.json'),
        PokemonVersions.load()
      ]);
      const arr = await res.json();
      allPokemons = arr.map(p => new Pokemon(p));
      console.log('[Import] Loaded', allPokemons.length, 'Pokemon');
    } catch (e) {
      console.error('[Import] Error loading Pokemon data:', e);
      allPokemons = [];
    }
  }

  // Duplicate RNG and list generation from daily.js
  function mulberry32(a) {
    return function() {
      let t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function stringToSeed(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(31, h) + s.charCodeAt(i) | 0;
    }
    return h >>> 0;
  }

  function shuffleArrayWithSeed(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function getDailyListForDate(dateStr) {
    // Filtre les Pokémon disponibles à la date donnée avant d'appliquer le seed
    const available = PokemonVersions.getAvailablePokemons(allPokemons, dateStr);
    const seed = stringToSeed(dateStr);
    const rng = mulberry32(seed);
    const shuffled = shuffleArrayWithSeed(available, rng);
    const list = shuffled.slice(0, Math.min(DAILY_COUNT, shuffled.length));
    let cursor = 0;
    while (list.length < DAILY_COUNT) {
      list.push(shuffled[cursor % shuffled.length]);
      cursor++;
    }
    return list;
  }

  function getWeeklyListForDate(weekDateStr) {
    const available = PokemonVersions.getAvailablePokemons(allPokemons, weekDateStr);
    const seed = stringToSeed('week' + weekDateStr);
    const rng  = mulberry32(seed);
    const shuffled = shuffleArrayWithSeed(available, rng);
    const list = shuffled.slice(0, Math.min(WEEKLY_COUNT, shuffled.length));
    let cursor = 0;
    while (list.length < WEEKLY_COUNT) {
      list.push(shuffled[cursor % shuffled.length]);
      cursor++;
    }
    return list;
  }

  // Get Daily DB
  function getDailyDB() {
    console.log('[Import] Getting Daily DB');
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DAILY_DB_NAME, 3);
      req.onerror = () => { console.error('[Import] Daily DB open error:', req.error); reject(req.error); };
      req.onsuccess = () => { console.log('[Import] Daily DB opened'); resolve(req.result); };
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(DAILY_STORE_NAME))
          db.createObjectStore(DAILY_STORE_NAME,  { keyPath: 'date' });
        if (!db.objectStoreNames.contains(WEEKLY_STORE_NAME))
          db.createObjectStore(WEEKLY_STORE_NAME, { keyPath: 'date' });
      };
    });
  }

  // Get all daily results
  async function getAllDailyResults() {
    console.log('[Import] Getting all daily results');
    const db = await getDailyDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DAILY_STORE_NAME, 'readonly');
      const store = tx.objectStore(DAILY_STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => { console.log('[Import] Retrieved daily results:', req.result.length); resolve(req.result); };
      req.onerror  = () => { console.error('[Import] Error getting daily results:', req.error); reject(req.error); };
    });
  }

  // Get all weekly results
  async function getAllWeeklyResults() {
    const db = await getDailyDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(WEEKLY_STORE_NAME, 'readonly');
      const store = tx.objectStore(WEEKLY_STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => { resolve(req.result); };
      req.onerror  = () => reject(req.error);
    });
  }

  // Update importedInDex for a daily entry
  async function updateImportedInDex(date, value) {
    console.log('[Import] Updating importedInDex for', date, 'to', value);
    const db = await getDailyDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DAILY_STORE_NAME, 'readwrite');
      const store = tx.objectStore(DAILY_STORE_NAME);
      const req = store.get(date);
      req.onsuccess = () => {
        const entry = req.result;
        if (entry) {
          entry.importedInDex = value;
          const putReq = store.put(entry);
          putReq.onsuccess = () => { console.log('[Import] Updated importedInDex for', date); resolve(); };
          putReq.onerror  = () => { console.error('[Import] Error updating importedInDex:', putReq.error); reject(putReq.error); };
        } else { console.warn('[Import] No entry found for date:', date); resolve(); }
      };
      req.onerror = () => { console.error('[Import] Error getting entry for update:', req.error); reject(req.error); };
    });
  }

  async function updateWeeklyImportedInDex(date, value) {
    const db = await getDailyDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(WEEKLY_STORE_NAME, 'readwrite');
      const store = tx.objectStore(WEEKLY_STORE_NAME);
      const req = store.get(date);
      req.onsuccess = () => {
        const entry = req.result;
        if (entry) { entry.importedInDex = value; store.put(entry).onsuccess = () => resolve(); }
        else { resolve(); }
      };
      req.onerror = () => reject(req.error);
    });
  }

  // Force update: import all daily AND weekly games and check for new Pokemon
  async function forceUpdate() {
    console.log('[Import] Starting force update');
    await loadPokemons();
    const newPokemons = [];

    try {
      const [dailyResults, weeklyResults] = await Promise.all([
        getAllDailyResults(),
        getAllWeeklyResults()
      ]);

      const existingDexEntries = await Dex.getAllDexEntries();
      const existingIndexes = new Set(existingDexEntries.map(e => e.index));

      // Process daily results
      console.log('[Import] Processing', dailyResults.length, 'daily entries');
      for (const entry of dailyResults) {
        const dailyList = getDailyListForDate(entry.date);
        const results   = entry.results || [];
        for (let i = 0; i < results.length; i++) {
          const res = results[i];
          if (res && res.outcome === 'win') {
            const p = dailyList[i];
            if (p && !existingIndexes.has(p.Index)) {
              await Dex.addNewDexEntry(p.Index, entry.date);
              newPokemons.push({ index: p.Index, name: p.NameFR || p.NameEN, date: entry.date });
              existingIndexes.add(p.Index);
            }
          }
        }
      }

      // Process weekly results
      console.log('[Import] Processing', weeklyResults.length, 'weekly entries');
      for (const entry of weeklyResults) {
        const weeklyList = getWeeklyListForDate(entry.date);
        const results    = entry.results || [];
        for (let i = 0; i < results.length; i++) {
          const res = results[i];
          if (res && res.outcome === 'win') {
            const p = weeklyList[i];
            if (p && !existingIndexes.has(p.Index)) {
              await Dex.addNewDexEntry(p.Index, entry.date);
              newPokemons.push({ index: p.Index, name: p.NameFR || p.NameEN, date: entry.date + ' (weekly)' });
              existingIndexes.add(p.Index);
            }
          }
        }
      }

      console.log('[Import] Force update complete, found', newPokemons.length, 'new Pokemon');
      showImportResultPopup(newPokemons);
    } catch (e) {
      console.error('[Import] Error during force update:', e);
      alert('Erreur lors de l\'import: ' + e.message);
    }
  }

  // Expose reconstruction helpers (used by data.js for manual import + Dex update)
  async function reconstructDailyList(dateStr) {
    if (!allPokemons.length) await loadPokemons();
    return getDailyListForDate(dateStr);
  }

  async function reconstructWeeklyList(weekDateStr) {
    if (!allPokemons.length) await loadPokemons();
    return getWeeklyListForDate(weekDateStr);
  }

  // Show popup with import results
  function showImportResultPopup(newPokemons) {
    const backdrop = document.createElement('div');
    backdrop.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:1000;';

    const popup = document.createElement('div');
    popup.style.cssText = 'background:var(--card);padding:20px;border-radius:12px;max-width:500px;width:90%;max-height:70vh;overflow-y:auto;';

    const title = document.createElement('h2');
    title.textContent = `${newPokemons.length} nouveau(x) Pokémon trouvé(s)`;
    title.style.cssText = 'margin:0 0 15px 0;color:#fff;';
    popup.appendChild(title);

    if (newPokemons.length > 0) {
      const list = document.createElement('div');
      list.style.cssText = 'background:rgba(255,255,255,0.05);padding:10px;border-radius:8px;margin-bottom:15px;font-family:monospace;';
      
      const pokeListText = newPokemons.map(p => `#${p.index} - ${p.name}`).join('<br/>');
      list.innerHTML = pokeListText;
      popup.appendChild(list);
    } else {
      const noNew = document.createElement('p');
      noNew.textContent = 'Aucun nouveau Pokémon à ajouter.';
      noNew.style.cssText = 'color:var(--muted);margin-bottom:15px;';
      popup.appendChild(noNew);
    }

    const refreshBtn = document.createElement('button');
    refreshBtn.textContent = 'Rafraîchir la page';
    refreshBtn.style.cssText = 'width:100%;padding:12px;background:var(--accent);color:#052018;font-weight:700;border:none;border-radius:8px;cursor:pointer;';
    refreshBtn.onclick = () => window.location.reload();
    popup.appendChild(refreshBtn);

    backdrop.appendChild(popup);
    document.body.appendChild(backdrop);
  }

  return {
    forceUpdate,
    reconstructDailyList,
    reconstructWeeklyList
  };
})();