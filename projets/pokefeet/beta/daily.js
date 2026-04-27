// daily.js
// Mode "Daily" : 5 Pokémon identiques pour tout le monde chaque jour (seed = date)
// Dépend de pokemon.js (classe Pokemon + matchesName)

const Daily = (function () {
  // config
  const COUNT = 5;
  const maxAttempts = 5; // 0..4 attempts allowed, 5th fail = complete fail
  const cookieName = 'pk_daily_result_v2';

  // state
  let pokemons = [];
  let dailyList = []; // array of Pokemon objects (5)
  let index = 0; // current position 0..4
  let attempts = 0; // attempts for current pokemon (0 = first try)
  let score = 0;
  let results = []; // for each of 5: { outcome: 'win'|'fail', attempts: n }
  let wrongGuessesPerSlot = [];

  // DOM
  const img = () => document.getElementById('dailyImg');
  const input = () => document.getElementById('dailyInput');
  const hintsList = document.getElementById('dailyHints');
  const revealDiv = document.getElementById('dailyReveal');
  const dGen = document.getElementById('dGen');
  const dIdx = document.getElementById('dIndex');
  const dT1 = document.getElementById('dT1');
  const dT2 = document.getElementById('dT2');
  const scoreEl = document.getElementById('dailyScore');
  const dropdown = document.getElementById('namesDropdown');
  let dropdownActive = -1;
  const notif = document.getElementById('notifications');
  const afterDone = document.getElementById('afterDone');
  const shareArea = document.getElementById('shareTextArea');
  const failedEl = document.getElementById('dailyFailedAttempts');
  const attemptGaugeEl = document.getElementById('attemptGauge');
  const gaugeFillEl = attemptGaugeEl ? attemptGaugeEl.querySelector('.gauge-fill') : null;
  const gaugeLabelEl = attemptGaugeEl ? attemptGaugeEl.querySelector('.gauge-label') : null;

  // cookie helpers
  function setCookie(name, value, days = 3650) {
    const d = new Date();
    d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = `${name}=${encodeURIComponent(value)};expires=${d.toUTCString()};path=/`;
  }
  function getCookie(name) {
    const v = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
    return v ? decodeURIComponent(v.pop()) : null;
  }

  // deterministic RNG from seed (Mulberry32)
  function mulberry32(a) {
    return function() {
      let t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // Get the date from URL parameter or use provided date or today
  let overrideDate = null;
  function getDateFromURL() {
    const params = new URLSearchParams(window.location.search);
    const dateParam = params.get('date');
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      // Check if the date is not after today
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      if (dateParam > todayStr) {
        // Show error and prevent playing future dailies
        const futureMsg = Translator.get('daily.futureDaily', 'Impossible de jouer un daily du futur');
        alert(futureMsg);
        window.location.href = window.location.pathname;
        return null;
      }
      return dateParam;
    }
    return null;
  }
  
  // seed based on date YYYY-MM-DD
  function dateSeedStr(d = new Date()) {
    // If we have an override date (from URL), use it
    if (overrideDate) {
      return overrideDate;
    }
    let y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    // if in beta folder, subtract 5 years for different seed
    if (window.location.pathname.includes('/beta/')) {
      y = y - 5;
    }
    return `${y}-${m}-${day}`;
  }
  function stringToSeed(s) {
    // simple hash to 32-bit int
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(31, h) + s.charCodeAt(i) | 0;
    }
    return h >>> 0;
  }

  // shuffle deterministic
  function shuffleArrayWithSeed(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // UI helpers
  function showNotification(message, type = 'info') {
    const n = document.createElement('div');
    n.className = 'notification';
    n.textContent = message;
    if (type === 'fail') n.style.background = '#491111';
    if (type === 'hint') n.style.background = '#334155';
    notif.appendChild(n);
    setTimeout(() => {
      n.style.opacity = 0;
      try { notif.removeChild(n); } catch (e) {}
    }, 1600);
  }

  function populateNamesList() {
    // no-op : suggestions gérées dynamiquement via le dropdown custom
  }

  function closeDropdown() {
    dropdown.innerHTML = '';
    dropdown.classList.add('hidden');
    dropdownActive = -1;
  }

  function navigateDropdown(dir) {
    const items = dropdown.querySelectorAll('.autocomplete-item');
    if (!items.length) return;
    items[dropdownActive]?.classList.remove('active');
    dropdownActive = (dropdownActive + dir + items.length) % items.length;
    items[dropdownActive].classList.add('active');
    items[dropdownActive].scrollIntoView({ block: 'nearest' });
  }

  function updateProgressUI() {
    for (let i = 0; i < COUNT; i++) {
      const dot = document.getElementById('round-dot-' + i);
      if (!dot) continue;
      dot.classList.remove('completed', 'imperfect', 'active', 'failed');
      if (i < index) {
        const res = results[i];
        if (res && res.outcome === 'win') {
          dot.classList.add(res.attempts === 0 ? 'completed' : 'imperfect');
        } else {
          dot.classList.add('failed');
        }
      } else if (i === index && index < COUNT) {
        dot.classList.add('active');
      }
    }
    scoreEl.textContent = score;
  }

  function clearHints() {
    hintsList.innerHTML = '';
  }

  function addHint(text) {
    const li = document.createElement('li');
    li.textContent = text;
    hintsList.appendChild(li);
  }

  function showReveal(p) {
    if (!p) return;
    revealDiv.classList.remove('hidden');
    dGen.textContent = p.Generation;
    dIdx.textContent = p.Index;
    dT1.textContent = p.Type1;
    dT2.textContent = p.getDisplayType2();
    img().src = p.FullImage;
  }

  function hideReveal() {
    revealDiv.classList.add('hidden');
    dGen.textContent = '';
    dIdx.textContent = '';
    dT1.textContent = '';
    dT2.textContent = '';
  }

  function showImage(src) {
    img().src = src || '';
  }

  function updateDailyFailedDisplay() {
    if (!failedEl) return;
    const arr = wrongGuessesPerSlot[index] || [];
    if (!arr || arr.length === 0) {
      failedEl.classList.add('hidden');
      failedEl.textContent = '';
      return;
    }
    failedEl.classList.remove('hidden');
    failedEl.textContent = 'Échecs : ' + arr.join(', ');
  }

  function updateAttemptGauge() {
    if (!gaugeFillEl || !gaugeLabelEl) return;
    // points for the NEXT correct answer given current attempts
    const pts = pointsForAttempt(attempts);
    const pct = Math.round((pts / basePoints) * 100);
    gaugeFillEl.style.height = pct + '%';
    gaugeLabelEl.textContent = (pts > 0) ? ('+' + pts) : '+0';
  }

  function hideAttemptGauge() {
    if (!attemptGaugeEl) return;
    attemptGaugeEl.style.display = 'none';
  }

  function showAttemptGauge() {
    if (!attemptGaugeEl) return;
    attemptGaugeEl.style.display = '';
  }

  function clearDailyFailedDisplay() {
    if (!failedEl) return;
    failedEl.classList.add('hidden');
    failedEl.textContent = '';
  }

  // scoring: points for attempt (same as main game)
  const basePoints = 10;
  const hintPenalty = 2;
  function pointsForAttempt(a) {
    return Math.max(basePoints - a * hintPenalty, 0);
  }

  // stocke l'objet history complet dans le cookie
  // --- IndexedDB helpers (mirror from data.js) ---
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

  async function getAllDailyFromDB() {
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
  }

  async function saveDailyToDB(dailyObj) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      
      const clearReq = store.clear();
      clearReq.onsuccess = () => {
        for (const date in dailyObj) {
          if (dailyObj.hasOwnProperty(date)) {
            store.put({
              date: date,
              importedInDex: false, // default to false
              ...dailyObj[date]
            });
          }
        }
      };

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function saveDailyCookie(historyObj) {
    try {
      await saveDailyToDB(historyObj);
    } catch (e) {
      console.error('Impossible de sauvegarder l\'historique daily', e);
    }
  }

  // renvoie l'objet history (map date -> { score, results }) ou null
  async function loadDailyCookie() {
    try {
      const data = await getAllDailyFromDB();
      if (data && typeof data === 'object' && !Array.isArray(data)) return data;
      return null;
    } catch (e) {
      console.error('Error loading daily from IndexedDB:', e);
      return null;
    }
  }
  // helper pour sauvegarder le résultat du jour dans l'historique
  async function saveResultForToday(payload) {
    const dateKey = payload.date;
    const history = await loadDailyCookie() || {};
    history[dateKey] = {
      score: payload.score,
      results: payload.results
    };
    await saveDailyCookie(history);
    // Mark as imported since we just updated Dex
    await updateImportedInDex(dateKey, true);
  }

  // Update importedInDex for a daily entry
  async function updateImportedInDex(date, value) {
    console.log('[Daily] Updating importedInDex for', date, 'to', value);
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(date);
      req.onsuccess = () => {
        const entry = req.result;
        if (entry) {
          entry.importedInDex = value;
          const putReq = store.put(entry);
          putReq.onsuccess = () => {
            console.log('[Daily] Updated importedInDex for', date);
            resolve();
          };
          putReq.onerror = () => {
            console.error('[Daily] Error updating importedInDex:', putReq.error);
            reject(putReq.error);
          };
        } else {
          console.warn('[Daily] No entry found for date:', date);
          resolve();
        }
      };
      req.onerror = () => {
        console.error('[Daily] Error getting entry for update:', req.error);
        reject(req.error);
      };
    });
  }

  // build emoji line helper (utile aussi pour history page)
  function resultToEmojiLine(resArr) {
    // pour chaque slot: win attempts==0 => 🟩, win attempts>0 => 🟧, fail => 🟥
    return resArr.map(r => {
      if (!r) return '🟥';
      if (r.outcome === 'fail') return '🟥';
      if (r.outcome === 'win') {
        return (r.attempts === 0) ? '🟩' : '🟧';
      }
      return '🟥';
    }).join('');
  }


  // build emoji share text
  function buildShareText(resArr, dateStr, totalScore) {
    // emojis: green square = 🟩, orange = 🟧, red = 🟥
    // pour une victoire : on remplace un 🟩 par 🟧 pour chaque essai raté (attempts)
    // pour un échec : 5 rouges

    const lines = resArr.map(r => {
      if (r.outcome === 'fail') return '🟥🟥🟥🟥🟥';

      // r.outcome === 'win'
      // r.attempts représente le nombre d'essais ratés avant la réussite (0 = succès immédiat)
      const failures = Math.max(0, Math.min(5, r.attempts)); // clamp 0..5 par sécurité
      const oranges = '🟧'.repeat(failures);
      const greens = '🟩'.repeat(5 - failures);
      return oranges + greens;
    });

    const header = `PokéPied Daily — ${dateStr} — score ${totalScore}\n`;
    return header + lines.join('\n');
  }

  // Recreate deterministic daily list for a given date (used when already played)
  function getDailyListForDate(dateStr) {
    const seed = stringToSeed(dateStr);
    const rng = mulberry32(seed);
    const shuffled = shuffleArrayWithSeed(pokemons, rng);
    const list = shuffled.slice(0, Math.min(COUNT, shuffled.length));
    let cursor = 0;
    while (list.length < COUNT) {
      list.push(shuffled[cursor % shuffled.length]);
      cursor++;
    }
    return list;
  }

  function renderFullImages(list) {
    const container = document.getElementById('dailyFullImages');
    if (!container) return;
    container.innerHTML = '';
    list.forEach(p => {
      const imgEl = document.createElement('img');
      imgEl.src = p.FullImage || p.Image || '';
      imgEl.alt = p.NameFR || p.NameEN || '';
      container.appendChild(imgEl);
    });
  }

  // Check which pokemons are new (never found before)
  async function checkNewPokemons() {
    const newPokemons = [];
    for (let i = 0; i < dailyList.length; i++) {
      const res = results[i];
      if (res && res.outcome === 'win') {
        const p = dailyList[i];
        const entry = await Dex.getDexEntry(p.Index).catch(() => null);
        // A pokemon is new if it was not found before (entry is null or found is false)
        if (!entry || !entry.found) {
          newPokemons.push(p);
        }
      }
    }
    return newPokemons;
  }

  // Display new pokemons alert
  function displayNewPokemonsAlert(newPokemons) {
    const alertEl = document.getElementById('newPokemonsAlert');
    if (!alertEl) return;
    
    if (newPokemons.length === 0) {
      alertEl.classList.add('hidden');
      return;
    }

    const pokemonNames = newPokemons
      .map(p => p.NameFR || p.NameEN || '?')
      .join(', ');
    
    const message = newPokemons.length === 1
      ? `🌟 Nouveau Pokémon découvert : ${pokemonNames}!`
      : `🌟 Nouveaux Pokémon découverts : ${pokemonNames}!`;
    
    alertEl.textContent = message;
    alertEl.classList.remove('hidden');
  }


  // advance to next pokemon (or finish)
  function nextPokemon() {
    index++;
    attempts = 0;
    hideReveal();
    clearHints();
    input().value = '';
    clearDailyFailedDisplay();
    updateAttemptGauge();
    if (index >= COUNT) {
      finishDaily();
      return;
    }
    showCurrent();
    updateProgressUI();
  }

  // --- Adapter finishDaily pour utiliser l'historique ---
  async function finishDaily() {
    // persist results into history map
    const payload = { date: dateSeedStr(), results, score };
    await saveResultForToday(payload);

    // Check for new pokemons BEFORE marking them as found
    const newPokemons = await checkNewPokemons();

    // Update Dex with found Pokemon
    console.log('[Daily] Updating Dex with found Pokemon');
    for (let i = 0; i < dailyList.length; i++) {
      const p = dailyList[i];
      const res = results[i];
      if (res && res.outcome === 'win') {
        try {
          await Dex.markFound(p.Index);
          console.log('[Daily] Marked Pokemon', p.Index, 'as found');
        } catch (e) {
          console.error('[Daily] Error updating Dex for', p.Index, ':', e);
        }
      }
    }

    // Display alert for new pokemons
    displayNewPokemonsAlert(newPokemons);

    // prepare share text
    const share = buildShareText(results, payload.date, score);
    shareArea.textContent = share;
    afterDone.classList.remove('hidden');

    // show the full images of the daily pokemons
    try {
      renderFullImages(dailyList);
    } catch (e) {}

    // hide the attempt gauge on the summary screen
    hideAttemptGauge();

    // disable controls
    input().disabled = true;
    document.getElementById('dailySubmit').disabled = true;
    document.getElementById('dailySkip').disabled = true;
    showNotification('Daily terminé — partagez votre résultat', 'success');
  }

  function failCurrentAndAdvance() {
    // mark fail
    results.push({ outcome: 'fail', attempts: attempts });
    // no score increase, move on
    showReveal(dailyList[index]);
    // allow user to see reveal + failed attempts before advancing
    setTimeout(() => {
      nextPokemon();
    }, 1000);
  }

  async function handleCorrect() {
    const p = dailyList[index];
    // Check if this is a brand-new discovery BEFORE finishDaily marks it found
    try {
      const dexEntry = await Dex.getDexEntry(p.Index);
      if (!dexEntry || !dexEntry.found) {
        showNewPokemonBanner(p);
      }
    } catch (e) { /* ignore */ }

    const pts = pointsForAttempt(attempts);
    score += pts;
    results.push({ outcome: 'win', attempts });
    showReveal(dailyList[index]);
    clearDailyFailedDisplay();
    updateProgressUI();
    showNotification('+' + pts + ' points', 'success');
    // small delay then next
    setTimeout(nextPokemon, 700);
  }

  function showNewPokemonBanner(p) {
    const name = p.NameFR || p.NameEN || '?';
    const banner = document.createElement('div');
    banner.className = 'new-pokemon-banner';
    banner.innerHTML =
      '<div class="npb-star">&#10024;</div>' +
      '<div class="npb-label">Nouveau Pok\u00e9mon !</div>' +
      '<div class="npb-name">' + name + '</div>';
    document.body.appendChild(banner);
    setTimeout(() => { try { document.body.removeChild(banner); } catch (e) {} }, 3400);
  }

  function showHintForAttempt(a) {
    const p = dailyList[index];
    switch (a) {
      case 1:
        // Type(s) on same line
        const t1 = p.Type1 || '';
        const t2 = p.Type2 || '';
        const typesLabel = Translator.get('daily.types', 'Type(s)');
        addHint(`${typesLabel} : ${t1}${t2 ? ' / ' + t2 : ''}`);
        break;
      case 2:
        // Index with generation in parentheses
        const indexLabel = Translator.get('daily.index', 'Index');
        const genLabel = Translator.get('daily.generation', 'Génération');
        addHint(`${indexLabel} : ${p.Index} (${genLabel} ${p.Generation})`);
        break;
      case 3:
        // Egg groups
        const eggLabel = Translator.get('daily.eggGroups', 'Groupes d\'oeuf');
        addHint(`${eggLabel} : ${p.getEggGroupsDisplay()}`);
        break;
      case 4:
        // Category
        const catLabel = Translator.get('daily.category', 'Catégorie');
        addHint(`${catLabel} : ${p.getCategoryDisplay()}`);
        break;
      default:
        break;
    }
    // visual preview
    const correctMsg = Translator.get('daily.correctAnswer', 'Réponse correcte = +');
    const pointsWord = Translator.get('daily.pointsReward', 'points');
    showNotification(correctMsg + pointsForAttempt(attempts) + ' ' + pointsWord, 'hint');
  }

  // normalise une chaîne : minuscules + sans accents
  function normalizeStr(s) {
    return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  // --- nouvelle fonction : vérifie si le nom entré existe dans la liste (FR ou EN) ---
  function isValidName(val) {
    if (!val) return false;
    const v = normalizeStr(val.trim());
    for (let i = 0; i < pokemons.length; i++) {
      const p = pokemons[i];
      if (normalizeStr(p.NameFR) === v || normalizeStr(p.NameEN) === v) {
        return true;
      }
    }
    return false;
  }

  // animation "shake" sur input pour nom invalide
  function triggerInvalidInput() {
    const el = input();
    el.classList.remove('shake');
    // reflow pour relancer l'animation si déjà présente
    void el.offsetWidth;
    el.classList.add('shake');
    const invalidMsg = Translator.get('daily.invalidName', 'Nom invalide');
    showNotification(invalidMsg, 'fail');
    // retirer la classe après l'animation
    setTimeout(() => el.classList.remove('shake'), 500);
  }

  function submitGuess() {
    const val = input().value.trim();
    if (!val) return;
    // si le nom n'est pas dans la liste possible, on secoue et on affiche une erreur
    if (!isValidName(val)) {
      triggerInvalidInput();
      return; // ne compte pas comme tentative
    }

    // check if already tried
    const currentGuesses = wrongGuessesPerSlot[index] || [];
    if (currentGuesses.includes(val)) {
      const alreadyTriedMsg = Translator.get('daily.alreadyTried', 'Déjà essayé');
      showNotification(alreadyTriedMsg, 'hint');
      return; // ne compte pas comme tentative
    }

    const current = dailyList[index];
    if (current.matchesName(val)) {
      handleCorrect();
    } else {
      // record wrong guess for this slot and show it
      if (!wrongGuessesPerSlot[index]) wrongGuessesPerSlot[index] = [];
      wrongGuessesPerSlot[index].push(val);
      updateDailyFailedDisplay();
      attempts++;
      updateAttemptGauge();
      if (attempts >= maxAttempts) {
        // completely failed this pokemon
        showNotification('Échec — Pokémon révélé', 'fail');
        failCurrentAndAdvance();
      } else {
        showHintForAttempt(attempts);
        showNotification('-2 points (indice affiché)', 'hint');
      }
    }
  }

  // UI when daily already played
  function renderFinishedFromCookie(payload, dateStr) {
    // payload: { score, results }
    const date = dateStr || dateSeedStr();
    const saved = payload || { score: 0, results: [] };
    const share = buildShareText(saved.results || [], date, saved.score || 0);
    shareArea.textContent = share;
    afterDone.classList.remove('hidden');
    // show summary on top — mark all dots
    for (let i = 0; i < COUNT; i++) {
      const dot = document.getElementById('round-dot-' + i);
      if (!dot) continue;
      dot.classList.remove('completed', 'imperfect', 'active', 'failed');
      const res = (saved.results || [])[i];
      if (res && res.outcome === 'win') {
        dot.classList.add(res.attempts === 0 ? 'completed' : 'imperfect');
      } else {
        dot.classList.add('failed');
      }
    }
    scoreEl.textContent = saved.score || 0;
    // disable controls
    input().disabled = true;
    document.getElementById('dailySubmit').disabled = true;
    document.getElementById('dailySkip').disabled = true;
    showImage(''); // keep blank or show last if desired

    // set module state so viewDetails and autres fonctionnent
    results = saved.results ? saved.results.slice(0, COUNT) : [];
    score = saved.score || 0;
    index = COUNT; // mark finished
    // also show the full images for the date
    try {
      const list = getDailyListForDate(date);
      renderFullImages(list);
    } catch (e) {}
    hideAttemptGauge();
  }

  // show current pokemon (partial image)
  function showCurrent() {
    const p = dailyList[index];
    showImage(p ? p.Image : '');
    updateProgressUI();
  }

  // main init
  async function init() {
    // Get the date from URL parameter if provided
    overrideDate = getDateFromURL();
    
    // load pokemons data (same logic as Game.init: try fetch data/pokemons.json)
    try {
      const res = await fetch('data/pokemons.json');
      const arr = await res.json();
      pokemons = arr.map(p => new Pokemon(p));
    } catch (e) {
      // fallback sample (same as original)
      pokemons = [
        new Pokemon({"Index":"1","NameEN":"Bulbasaur","NameFR":"Bulbizarre","Generation":1,"Type1":"grass","Type2":"poison","Image":"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/1.png"}),
        new Pokemon({"Index":"4","NameEN":"Charmander","NameFR":"Salamèche","Generation":1,"Type1":"fire","Type2":null,"Image":"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/4.png"}),
        new Pokemon({"Index":"7","NameEN":"Squirtle","NameFR":"Carapuce","Generation":1,"Type1":"water","Type2":null,"Image":"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/7.png"})
      ];
    }

    // check cookie: if there is a saved daily and date matches today => render finished
    const savedHistory = await loadDailyCookie();
    const today = dateSeedStr();
    if (savedHistory && savedHistory[today]) {
      // already played today
      populateNamesList();
      renderFinishedFromCookie(savedHistory[today], today);
      bindButtons(); // still allow copy
      return;
    }


    // create deterministic list 5 using date seed
    const seed = stringToSeed(dateSeedStr());
    const rng = mulberry32(seed);
    const shuffled = shuffleArrayWithSeed(pokemons, rng);
    // if fewer pokemons than COUNT, repeat but keep unique as much as possible
    dailyList = shuffled.slice(0, Math.min(COUNT, shuffled.length));
    // if not enough, loop fill
    let cursor = 0;
    while (dailyList.length < COUNT) {
      dailyList.push(shuffled[cursor % shuffled.length]);
      cursor++;
    }

    // init UI & state
    index = 0;
    attempts = 0;
    score = 0;
    results = [];
    wrongGuessesPerSlot = Array.from({ length: COUNT }, () => []);
    populateNamesList();
    showCurrent();
    updateProgressUI();
    updateAttemptGauge();
    bindButtons();
  }

  function bindButtons() {
    document.getElementById('dailySubmit').addEventListener('click', submitGuess);
    document.getElementById('dailySkip').addEventListener('click', () => {
      const ok = confirm("Es-tu sûr de vouloir passer ce Pokémon ?");
      if (!ok) return;

      showNotification('Passé — Pokémon révélé', 'hint');
      failCurrentAndAdvance();
    });
    document.getElementById('dailyInput').addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); navigateDropdown(1); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); navigateDropdown(-1); return; }
      if (e.key === 'Escape')    { closeDropdown(); return; }
      if (e.key === 'Enter') {
        const items = dropdown.querySelectorAll('.autocomplete-item');
        if (dropdownActive >= 0 && items[dropdownActive]) {
          input().value = items[dropdownActive].textContent;
          closeDropdown();
        }
        submitGuess();
      }
    });
    document.getElementById('dailyInput').addEventListener('input', () => {
      const needle = normalizeStr(input().value.trim());
      dropdown.innerHTML = '';
      dropdownActive = -1;
      if (!needle) { dropdown.classList.add('hidden'); return; }
      const MAX = 40;
      let count = 0;
      pokemons.forEach(p => {
        if (count >= MAX) return;
        const fr = p.NameFR || '';
        const en = p.NameEN || '';
        let name = null;
        if (fr && normalizeStr(fr).includes(needle)) name = fr;
        else if (en && normalizeStr(en).includes(needle)) name = en;
        if (name) {
          const item = document.createElement('div');
          item.className = 'autocomplete-item';
          item.textContent = name;
          item.addEventListener('mousedown', (e) => {
            e.preventDefault();
            input().value = name;
            closeDropdown();
            submitGuess();
          });
          dropdown.appendChild(item);
          count++;
        }
      });
      dropdown.classList.toggle('hidden', count === 0);
    });
    document.getElementById('dailyInput').addEventListener('blur', () => {
      setTimeout(closeDropdown, 150);
    });
    document.getElementById('copyShare').addEventListener('click', () => {
      const txt = shareArea.textContent || '';
      if (!txt) return;
      const url = window.location.href;
      navigator.clipboard?.writeText(txt + '\n' + url).then(() => {
        showNotification('Copié dans le presse-papier', 'success');
      }, () => {
        showNotification('Impossible de copier', 'fail');
      });
    });
    document.getElementById('copyDiscordShare').addEventListener('click', () => {
      const txt = shareArea.textContent || '';
      if (!txt) return;
      const url = window.location.href;

      navigator.clipboard?.writeText(txt + '\n' + url).then(() => {
        showNotification('Copié dans le presse-papier', 'success');

        // Ouvrir le lien dans un nouvel onglet
        window.open('https://discord.gg/yY3b8RYznN', '_blank');

      }, () => {
        showNotification('Impossible de copier', 'fail');
      });
    });
    document.getElementById('viewDetails').addEventListener('click', () => {
      // simple details view: show per-slot reveal info
      let detail = '';
      dailyList.forEach((p, i) => {
        const r = results[i] || { outcome: 'fail', attempts: maxAttempts };
        detail += `${i + 1}. ${p.NameFR || p.NameEN} — ${r.outcome} (attempts: ${r.attempts})\n`;
      });
      alert(detail);
    });
  }

  return {
    init
  };
})();

// auto init on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  Daily.init();
});
