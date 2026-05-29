// weekly.js
// Mode "Weekly" : 10 Pokémon identiques pour tout le monde chaque semaine (seed = lundi de la semaine)
// Dépend de pokemon.js (classe Pokemon + matchesName)

const Weekly = (function () {
  // config
  const COUNT = 10;
  const maxAttempts = 5;
  const cookieName = 'pk_weekly_result_v1';

  // state
  let pokemons = [];
  let weeklyList = [];
  let index = 0;
  let attempts = 0;
  let score = 0;
  let results = [];
  let wrongGuessesPerSlot = [];
  let busy = false;

  // DOM
  const img = () => document.getElementById('weeklyImg');
  const input = () => document.getElementById('weeklyInput');
  const hintsList = document.getElementById('weeklyHints');
  const revealDiv = document.getElementById('weeklyReveal');
  const dGen = document.getElementById('wGen');
  const dIdx = document.getElementById('wIndex');
  const dT1 = document.getElementById('wT1');
  const dT2 = document.getElementById('wT2');
  const scoreEl = document.getElementById('weeklyScore');
  const dropdown = document.getElementById('weeklyNamesDropdown');
  let dropdownActive = -1;
  const notif = document.getElementById('notifications');
  const afterDone = document.getElementById('afterDone');
  const shareArea = document.getElementById('shareTextArea');
  const failedEl = document.getElementById('weeklyFailedAttempts');
  const attemptGaugeEl = document.getElementById('attemptGauge');
  const gaugeFillEl = attemptGaugeEl ? attemptGaugeEl.querySelector('.gauge-fill') : null;
  const gaugeLabelEl = attemptGaugeEl ? attemptGaugeEl.querySelector('.gauge-label') : null;

  // --- IndexedDB helpers ---
  const DB_NAME = 'PokefeetDB';
  const DB_VERSION = 3;
  const STORE_NAME = 'weekly_results';
  let dbInstance = null;
  let idbTimedOut = false;

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
        if (!db.objectStoreNames.contains('daily_results')) {
          db.createObjectStore('daily_results', { keyPath: 'date' });
        }
        if (!db.objectStoreNames.contains('weekly_results')) {
          db.createObjectStore('weekly_results', { keyPath: 'date' });
        }
      };
    });
  }

  async function getAllWeeklyFromDB() {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const arr = req.result;
        const obj = {};
        arr.forEach(item => {
          obj[item.date] = { score: item.score, results: item.results, wrongGuesses: item.wrongGuesses, importedInDex: item.importedInDex || false };
        });
        resolve(obj);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function saveWeeklyToDB(weeklyObj) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const clearReq = store.clear();
      clearReq.onsuccess = () => {
        for (const date in weeklyObj) {
          if (weeklyObj.hasOwnProperty(date)) {
            store.put({ date, importedInDex: false, ...weeklyObj[date] });
          }
        }
      };
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadWeeklyCookie() {
    try {
      const data = await getAllWeeklyFromDB();
      if (data && typeof data === 'object' && !Array.isArray(data)) return data;
      return null;
    } catch (e) {
      console.error('Error loading weekly from IndexedDB:', e);
      return null;
    }
  }

  async function saveResultForWeek(payload) {
    const dateKey = payload.date;
    const history = await loadWeeklyCookie() || {};
    history[dateKey] = { score: payload.score, results: payload.results, wrongGuesses: payload.wrongGuesses || [] };
    await saveWeeklyToDB(history);
    try {
      await updateImportedInDex(dateKey, true);
    } catch (e) {
      console.error('[Weekly] Could not update importedInDex:', e);
    }
  }

  async function updateImportedInDex(date, value) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(date);
      req.onsuccess = () => {
        const entry = req.result;
        if (entry) {
          entry.importedInDex = value;
          store.put(entry).onsuccess = () => resolve();
        } else {
          resolve();
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  // deterministic RNG (Mulberry32)
  function mulberry32(a) {
    return function () {
      let t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function stringToSeed(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = Math.imul(31, h) + s.charCodeAt(i) | 0; }
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

  // Get the Monday of a given date
  function getMondayOfWeek(d) {
    const date = new Date(d);
    date.setHours(0, 0, 0, 0);
    const day = date.getDay(); // 0=Sun, 1=Mon, ...
    const diff = (day === 0) ? -6 : 1 - day;
    date.setDate(date.getDate() + diff);
    return date;
  }

  function dateToStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // Override date from URL param ?week=YYYY-MM-DD
  let overrideWeek = null;
  let sessionWeek = null;

  function getWeekFromURL() {
    const params = new URLSearchParams(window.location.search);
    const weekParam = params.get('week');
    if (weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam)) {
      const today = new Date();
      const thisMonday = getMondayOfWeek(today);
      const thisMondayStr = dateToStr(thisMonday);
      if (weekParam > thisMondayStr) {
        alert('Impossible de jouer un weekly du futur');
        window.location.href = window.location.pathname;
        return null;
      }
      return weekParam;
    }
    return null;
  }

  function getWeekSeedStr(d = new Date()) {
    if (overrideWeek) return overrideWeek;
    const monday = getMondayOfWeek(d);
    const y = monday.getFullYear();
    const m = String(monday.getMonth() + 1).padStart(2, '0');
    const day = String(monday.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // UI helpers
  function showNotification(message, type = 'info') {
    const n = document.createElement('div');
    n.className = 'notification';
    n.textContent = message;
    if (type === 'fail') n.style.background = '#491111';
    if (type === 'hint') n.style.background = '#334155';
    notif.appendChild(n);
    setTimeout(() => { n.style.opacity = 0; try { notif.removeChild(n); } catch (e) {} }, 1600);
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

  function clearHints() { hintsList.innerHTML = ''; }

  function addHint(text) {
    const li = document.createElement('li');
    li.textContent = text;
    hintsList.appendChild(li);
  }

  function addHintHTML(html) {
    const li = document.createElement('li');
    li.innerHTML = html;
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

  function showImage(src) { img().src = src || ''; }

  function updateWeeklyFailedDisplay() {
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

  function clearWeeklyFailedDisplay() {
    if (!failedEl) return;
    failedEl.classList.add('hidden');
    failedEl.textContent = '';
  }

  function hideGameplayElements() {
    const toHide = [
      document.querySelector('.image-gauge-row'),
      document.querySelector('.info-below'),
      document.querySelector('.guess-area'),
      document.getElementById('hints')
    ];
    toHide.forEach(el => { if (el) el.style.display = 'none'; });
  }

  const basePoints = 10;
  const hintPenalty = 2;
  function pointsForAttempt(a) { return Math.max(basePoints - a * hintPenalty, 0); }

  // Build weekly list for a given week-start date
  function getWeeklyListForDate(weekDateStr) {
    const available = PokemonVersions.getAvailablePokemons(pokemons, weekDateStr);
    const seed = stringToSeed('week' + weekDateStr);
    const rng = mulberry32(seed);
    const shuffled = shuffleArrayWithSeed(available, rng);
    const list = shuffled.slice(0, Math.min(COUNT, shuffled.length));
    let cursor = 0;
    while (list.length < COUNT) {
      list.push(shuffled[cursor % shuffled.length]);
      cursor++;
    }
    return list;
  }

  function renderFullImages(list) {
    const container = document.getElementById('weeklyFullImages');
    if (!container) return;
    container.innerHTML = '';
    list.forEach(p => {
      const imgEl = document.createElement('img');
      imgEl.src = p.FullImage || p.Image || '';
      imgEl.alt = p.NameFR || p.NameEN || '';
      container.appendChild(imgEl);
    });
  }

  async function checkNewPokemons() {
    const newPokemons = [];
    for (let i = 0; i < weeklyList.length; i++) {
      const res = results[i];
      if (res && res.outcome === 'win') {
        const p = weeklyList[i];
        const entry = await Dex.getDexEntry(p.Index).catch(() => null);
        if (!entry || !entry.found) newPokemons.push(p);
      }
    }
    return newPokemons;
  }

  function displayNewPokemonsAlert(newPokemons) {
    const alertEl = document.getElementById('newPokemonsAlert');
    if (!alertEl) return;
    if (newPokemons.length === 0) { alertEl.classList.add('hidden'); return; }
    const pokemonNames = newPokemons.map(p => p.NameFR || p.NameEN || '?').join(', ');
    const message = newPokemons.length === 1
      ? `🌟 Nouveau Pokémon découvert : ${pokemonNames}!`
      : `🌟 Nouveaux Pokémon découverts : ${pokemonNames}!`;
    alertEl.textContent = message;
    alertEl.classList.remove('hidden');
  }

  function nextPokemon() {
    busy = false;
    index++;
    attempts = 0;
    hideReveal();
    clearHints();
    input().value = '';
    clearWeeklyFailedDisplay();
    updateAttemptGauge();
    if (index >= COUNT) { finishWeekly(); return; }
    showCurrent();
    updateProgressUI();
  }

  async function finishWeekly() {
    const payload = { date: sessionWeek || getWeekSeedStr(), results, score, wrongGuesses: wrongGuessesPerSlot };
    try {
      await saveResultForWeek(payload);
    } catch (e) {
      console.error('[Weekly] Could not save result:', e);
    }
    const newPokemons = await checkNewPokemons();
    for (let i = 0; i < weeklyList.length; i++) {
      const p = weeklyList[i];
      const res = results[i];
      if (res && res.outcome === 'win') {
        try { await Dex.markFound(p.Index); } catch (e) {}
      }
    }
    displayNewPokemonsAlert(newPokemons);
    const share = buildShareText(results, payload.date, score);
    shareArea.textContent = share;
    afterDone.classList.remove('hidden');
    try { renderFullImages(weeklyList); } catch (e) {}
    hideAttemptGauge();
    hideGameplayElements();
    input().disabled = true;
    document.getElementById('weeklySubmit').disabled = true;
    document.getElementById('weeklySkip').disabled = true;
    showNotification('Weekly terminé — partagez votre résultat', 'success');
  }

  function failCurrentAndAdvance() {
    busy = true;
    results.push({ outcome: 'fail', attempts });
    showReveal(weeklyList[index]);
    setTimeout(() => { nextPokemon(); }, 1000);
  }

  async function handleCorrect() {
    busy = true;
    const p = weeklyList[index];
    try {
      const dexEntry = await Dex.getDexEntry(p.Index);
      if (!dexEntry || !dexEntry.found) showNewPokemonBanner(p);
    } catch (e) {}
    const pts = pointsForAttempt(attempts);
    score += pts;
    results.push({ outcome: 'win', attempts });
    showReveal(weeklyList[index]);
    clearWeeklyFailedDisplay();
    updateProgressUI();
    showNotification('+' + pts + ' points', 'success');
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
    const p = weeklyList[index];
    switch (a) {
      case 1: {
        const t1 = p.Type1 || '';
        const t2 = p.Type2 || '';
        const typesLabel = Translator.get('daily.types', 'Type(s)');
        const t1Badge = `<span class="type-badge t-${t1.toLowerCase()}">${Translator.get('types.' + t1.toLowerCase(), t1)}</span>`;
        let typeHint = `${typesLabel} : ${t1Badge}`;
        if (t2) {
          const t2Badge = `<span class="type-badge t-${t2.toLowerCase()}">${Translator.get('types.' + t2.toLowerCase(), t2)}</span>`;
          typeHint += ` ${t2Badge}`;
        }
        addHintHTML(typeHint);
        break;
      }
      case 2: {
        const indexLabel = Translator.get('daily.index', 'Index');
        const genLabel = Translator.get('daily.generation', 'Génération');
        addHint(`${indexLabel} : ${p.Index} (${genLabel} ${p.Generation})`);
        break;
      }
      case 3: {
        const eggLabel = Translator.get('daily.eggGroups', 'Groupes d\'oeuf');
        addHint(`${eggLabel} : ${p.getEggGroupsDisplay()}`);
        break;
      }
      case 4: {
        const catLabel = Translator.get('daily.category', 'Catégorie');
        addHint(`${catLabel} : ${p.getCategoryDisplay()}`);
        break;
      }
    }
    const correctMsg = Translator.get('daily.correctAnswer', 'Réponse correcte = +');
    const pointsWord = Translator.get('daily.pointsReward', 'points');
    showNotification(correctMsg + pointsForAttempt(attempts) + ' ' + pointsWord, 'hint');
  }

  function normalizeStr(s) {
    return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function isValidName(val) {
    if (!val) return false;
    const v = normalizeStr(val.trim());
    for (let i = 0; i < pokemons.length; i++) {
      const p = pokemons[i];
      if (normalizeStr(p.NameFR) === v || normalizeStr(p.NameEN) === v) return true;
    }
    return false;
  }

  function triggerInvalidInput() {
    const el = input();
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
    showNotification(Translator.get('daily.invalidName', 'Nom invalide'), 'fail');
    setTimeout(() => el.classList.remove('shake'), 500);
  }

  function submitGuess() {
    if (busy) return;
    const val = input().value.trim();
    if (!val) return;
    if (!isValidName(val)) { triggerInvalidInput(); return; }
    const currentGuesses = wrongGuessesPerSlot[index] || [];
    if (currentGuesses.includes(val)) {
      showNotification(Translator.get('daily.alreadyTried', 'Déjà essayé'), 'hint');
      return;
    }
    const current = weeklyList[index];
    if (current.matchesName(val)) {
      handleCorrect();
    } else {
      if (!wrongGuessesPerSlot[index]) wrongGuessesPerSlot[index] = [];
      wrongGuessesPerSlot[index].push(val);
      updateWeeklyFailedDisplay();
      attempts++;
      updateAttemptGauge();
      if (attempts >= maxAttempts) {
        showNotification('Échec — Pokémon révélé', 'fail');
        failCurrentAndAdvance();
      } else {
        showHintForAttempt(attempts);
        showNotification('-2 points (indice affiché)', 'hint');
      }
    }
  }

  // build wrong guesses text
  function buildWrongGuessesText(wrongGuesses) {
    if (!wrongGuesses || !wrongGuesses.length) return '';
    const lines = [];
    for (let i = 0; i < wrongGuesses.length; i++) {
      const guesses = wrongGuesses[i];
      if (guesses && guesses.length > 0) {
        lines.push(`R${i + 1} : ${guesses.map(g => `||${g}||`).join(' ')}`);
      }
    }
    return lines.join('\n');
  }

  function buildShareText(resArr, weekDateStr, totalScore) {
    const lines = resArr.map(r => {
      if (r.outcome === 'fail') return '🟥🟥🟥🟥🟥';
      const failures = Math.max(0, Math.min(5, r.attempts));
      return '🟧'.repeat(failures) + '🟩'.repeat(5 - failures);
    });
    return `Pokefeet Weekly — ${weekDateStr} — score ${totalScore}\n` + lines.join('\n');
  }

  function renderFinishedFromCookie(payload, weekDateStr) {
    const saved = payload || { score: 0, results: [] };
    const share = buildShareText(saved.results || [], weekDateStr, saved.score || 0);
    shareArea.textContent = share;
    afterDone.classList.remove('hidden');
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
    input().disabled = true;
    document.getElementById('weeklySubmit').disabled = true;
    document.getElementById('weeklySkip').disabled = true;
    showImage('');
    results = saved.results ? saved.results.slice(0, COUNT) : [];
    score = saved.score || 0;
    wrongGuessesPerSlot = saved.wrongGuesses
      ? saved.wrongGuesses.slice(0, COUNT)
      : Array.from({ length: COUNT }, () => []);
    index = COUNT;
    try { renderFullImages(getWeeklyListForDate(weekDateStr)); } catch (e) {}
    hideAttemptGauge();
    hideGameplayElements();
  }

  function showCurrent() {
    const p = weeklyList[index];
    showImage(p ? p.Image : '');
    updateProgressUI();
  }

  async function init() {
    // Guard: only run on the weekly page
    if (!document.getElementById('weeklyImg')) return;
    // Wait for migration to finish before opening the DB (prevents concurrent IDB opens on Firefox)
    if (typeof Migration !== 'undefined') await Migration.ready;
    overrideWeek = getWeekFromURL();
    try {
      const [pokemonsRes] = await Promise.all([
        fetch('data/pokemons.json'),
        TypeIcons.load(),
        PokemonVersions.load()
      ]);
      const arr = await pokemonsRes.json();
      pokemons = arr.map(p => new Pokemon(p));
    } catch (e) {
      pokemons = [
        new Pokemon({ "Index": "1", "NameEN": "Bulbasaur", "NameFR": "Bulbizarre", "Generation": 1, "Type1": "grass", "Type2": "poison", "Image": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/1.png" })
      ];
    }

    const savedHistory = await loadWeeklyCookie();
    const thisWeek = getWeekSeedStr();
    sessionWeek = thisWeek;
    if (savedHistory && savedHistory[thisWeek]) {
      populateNamesList();
      renderFinishedFromCookie(savedHistory[thisWeek], thisWeek);
      bindButtons();
      return;
    }

    const availablePokemons = PokemonVersions.getAvailablePokemons(pokemons, sessionWeek);
    const seed = stringToSeed('week' + sessionWeek);
    const rng = mulberry32(seed);
    const shuffled = shuffleArrayWithSeed(availablePokemons, rng);
    weeklyList = shuffled.slice(0, Math.min(COUNT, shuffled.length));
    let cursor = 0;
    while (weeklyList.length < COUNT) {
      weeklyList.push(shuffled[cursor % shuffled.length]);
      cursor++;
    }

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

  function populateNamesList() {}

  function bindButtons() {
    const retourBtn = document.getElementById('retourBtn');
    if (retourBtn) retourBtn.addEventListener('click', () => {
      if (index < COUNT) {
        if (!confirm(Translator.get('practice.confirmLeave', 'Êtes-vous sûr de vouloir quitter ?'))) return;
      }
      window.location.href = './index.html';
    });

    window.addEventListener('beforeunload', (e) => {
      if (index < COUNT) { e.preventDefault(); e.returnValue = ''; }
    });

    document.getElementById('weeklySubmit').addEventListener('click', submitGuess);
    document.getElementById('weeklySkip').addEventListener('click', () => {
      if (!confirm('Es-tu sûr de vouloir passer ce Pokémon ?')) return;
      showNotification('Passé — Pokémon révélé', 'hint');
      failCurrentAndAdvance();
    });
    document.getElementById('weeklyInput').addEventListener('keydown', (e) => {
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
    document.getElementById('weeklyInput').addEventListener('input', () => {
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
          item.addEventListener('mousedown', (ev) => {
            ev.preventDefault();
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
    document.getElementById('weeklyInput').addEventListener('blur', () => { setTimeout(closeDropdown, 150); });

    document.getElementById('copyShare').addEventListener('click', () => {
      const txt = shareArea.textContent || '';
      if (!txt) return;
      const wrongGuessesText = buildWrongGuessesText(wrongGuessesPerSlot);
      const fullText = txt + '\n' + window.location.href + (wrongGuessesText ? '\n' + wrongGuessesText : '');
      navigator.clipboard?.writeText(fullText).then(
        () => showNotification('Copié dans le presse-papier', 'success'),
        () => showNotification('Impossible de copier', 'fail')
      );
    });
    document.getElementById('copyDiscordShare').addEventListener('click', () => {
      const txt = shareArea.textContent || '';
      if (!txt) return;
      const wrongGuessesText = buildWrongGuessesText(wrongGuessesPerSlot);
      const fullText = txt + (wrongGuessesText ? '\n' + wrongGuessesText : '');
      navigator.clipboard?.writeText(fullText).then(() => {
        showNotification('Copié dans le presse-papier', 'success');
        window.open('https://discord.gg/yY3b8RYznN', '_blank');
      }, () => showNotification('Impossible de copier', 'fail'));
    });
    document.getElementById('viewDetails').addEventListener('click', () => {
      let detail = '';
      weeklyList.forEach((p, i) => {
        const r = results[i] || { outcome: 'fail', attempts: maxAttempts };
        detail += `${i + 1}. ${p.NameFR || p.NameEN} — ${r.outcome} (attempts: ${r.attempts})\n`;
      });
      alert(detail);
    });
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => { Weekly.init(); });
