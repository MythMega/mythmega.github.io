// weekly.js
// Mode "Weekly" : 10 Pokémon identiques pour tout le monde chaque semaine (seed = lundi de la semaine)
// Dépend de pokemon.js (classe Pokemon + matchesName)

const Weekly = (function () {
  // config
  const COUNT = 10;
  const maxAttempts = 5;
  const cookieName = 'pk_weekly_result_v1';
  const PASSWORD_HASH = '19768d6a62452099c450e0e7d1ba4be25597c2669dcab5fea88fe73ae74ca39e';
  const sha256hex = async (str) => {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  };

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
  const DB_VERSION = 4;
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
  // Date invalide (non-lundi) demandée dans l'URL — déclenche la popup de redirection.
  let invalidWeekParam = null;

  // Attendre que le système de traduction soit initialisé avant d'afficher des
  // textes dynamiques (sinon Translator.get retombe sur les fallbacks français).
  function translatorReady() {
    return new Promise((resolve) => {
      if (typeof Translator === 'undefined') { resolve(); return; }
      if (Translator.get('common.backHome', null) !== null) { resolve(); return; }
      const start = Date.now();
      const timer = setInterval(() => {
        if (Translator.get('common.backHome', null) !== null || Date.now() - start > 4000) {
          clearInterval(timer);
          resolve();
        }
      }, 40);
    });
  }

  function getWeekFromURL() {
    const params = new URLSearchParams(window.location.search);
    const weekParam = params.get('week');
    if (weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam)) {
      const parsed = new Date(weekParam + 'T00:00:00');
      // Vérifier que la date est réelle (rejette les rollovers type 2026-02-30)
      // et qu'elle tombe bien un lundi (un weekly s'identifie par son lundi).
      const isRealDate = !isNaN(parsed.getTime()) && dateToStr(parsed) === weekParam;
      if (!isRealDate || parsed.getDay() !== 1) {
        invalidWeekParam = weekParam;
        return null;
      }

      const today = new Date();
      const thisMonday = getMondayOfWeek(today);
      const thisMondayStr = dateToStr(thisMonday);
      if (weekParam > thisMondayStr) {
        alert(Translator.get('weekly.futureWeekly', 'Impossible de jouer un weekly du futur'));
        window.location.href = window.location.pathname;
        return null;
      }
      return weekParam;
    }
    return null;
  }

  // Popup "date invalide" : un bouton Valider redirige vers le lundi précédent.
  function showInvalidDatePopup(rawDate) {
    const previousMonday = getMondayOfWeek(new Date(rawDate + 'T00:00:00'));
    const targetWeek = dateToStr(previousMonday);

    const backdrop = document.createElement('div');
    backdrop.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:1000;';

    const popup = document.createElement('div');
    popup.style.cssText = 'background:var(--card);padding:24px;border-radius:12px;max-width:420px;width:90%;text-align:center;';

    const title = document.createElement('h2');
    title.textContent = Translator.get('weekly.invalidDateTitle', 'Date invalide');
    title.style.cssText = 'margin:0 0 14px 0;color:#fff;';
    popup.appendChild(title);

    const msg = document.createElement('p');
    msg.textContent = Translator.get('weekly.invalidDateMsg', 'Ce weekly n\'est pas valide : la date doit correspondre à un lundi. Vous allez être redirigé vers le lundi précédent.');
    msg.style.cssText = 'color:var(--muted);margin:0 0 18px 0;line-height:1.5;';
    popup.appendChild(msg);

    const btn = document.createElement('button');
    btn.className = 'secondary';
    btn.textContent = Translator.get('weekly.goToMonday', 'Valider');
    btn.style.cssText = 'width:100%;padding:12px;background:var(--accent);color:#052018;font-weight:700;border:none;border-radius:8px;cursor:pointer;font-size:15px;';
    btn.addEventListener('click', () => {
      window.location.href = `weekly.html?week=${targetWeek}`;
    });
    popup.appendChild(btn);

    backdrop.appendChild(popup);
    document.body.appendChild(backdrop);
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
    if (typeof PokefeetFX !== 'undefined') {
      if (!PokefeetFX.notificationsEnabled()) return;
      PokefeetFX.notificationSound(type);
    }
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

  // --- Rechargement automatique des images ---
  // GitHub sert parfois les images en échec de chargement (blanc/inexistant) :
  // au lieu de forcer le joueur à rafraîchir, on retente le chargement 1 s plus tard.
  const MAX_IMG_RETRIES = 2;        // tentatives de renvoi après le premier échec
  const IMG_RETRY_DELAY_MS = 1000;  // délai avant de retenter (en millisecondes)
  let imgRetryCount = 0;
  let imgRetryTimer = null;

  function loadImageWithRetry(el, src) {
    if (!el) return;
    src = src || '';
    // chaque nouvelle image réinitialise le compteur et le timer en attente
    imgRetryCount = 0;
    if (imgRetryTimer) { clearTimeout(imgRetryTimer); imgRetryTimer = null; }
    el.onerror = null;
    el.onabort = null;
    el.src = src;
    if (!src) return; // pas de src → rien à retenter
    const retryHandler = function () {
      // garde-fou : on ne boucle jamais indéfiniment
      if (imgRetryCount >= MAX_IMG_RETRIES) { el.onerror = null; el.onabort = null; return; }
      imgRetryCount++;
      const srcToRetry = src;
      imgRetryTimer = setTimeout(function () {
        imgRetryTimer = null;
        // l'image affichée a changé entre-temps (nouveau round) → on n'écrase pas
        if (el.getAttribute('src') !== srcToRetry) return;
        el.src = srcToRetry; // recharge la même image
      }, IMG_RETRY_DELAY_MS);
    };
    el.onerror = retryHandler;
    el.onabort = retryHandler;
  }

  // --- Popup de révélation (Pokémon non trouvé) ---
  // Retente le chargement d'une image de la popup sans état partagé entre les deux images.
  function loadPopupImage(el, src) {
    if (!el) return;
    el.onerror = null;
    if (!src) { el.removeAttribute('src'); return; }
    let tries = 0;
    el.src = src;
    el.onerror = function () {
      if (tries >= MAX_IMG_RETRIES) { el.onerror = null; return; }
      tries++;
      const srcToRetry = src;
      setTimeout(function () {
        if (el.getAttribute('src') !== srcToRetry) return;
        el.src = srcToRetry;
      }, IMG_RETRY_DELAY_MS);
    };
  }

  function getDisplayName(p) {
    const lang = typeof Translator !== 'undefined' ? Translator.getLanguage() : 'fr';
    return (lang === 'fr' ? (p.NameFR || p.NameEN) : (p.NameEN || p.NameFR)) || '?';
  }

  // Indices affichés dans la popup : mêmes informations que le panneau latéral.
  function buildHintsHtml(p) {
    const t1 = p.Type1 || '';
    const t2 = p.Type2 || '';
    const typeBadge = (t) => `<span class="type-badge t-${t.toLowerCase()}">${Translator.get('types.' + t.toLowerCase(), t)}</span>`;
    let typeHint = `${Translator.get('daily.types', 'Type(s)')} : ${t1 ? typeBadge(t1) : 'N/A'}`;
    if (t2) typeHint += ` ${typeBadge(t2)}`;
    return [
      typeHint,
      `${Translator.get('daily.index', 'Index')} : ${p.Index} (${Translator.get('daily.generation', 'Génération')} ${p.Generation})`,
      `${Translator.get('daily.eggGroups', "Groupes d'oeuf")} : ${p.getEggGroupsDisplay()}`,
      `${Translator.get('daily.category', 'Catégorie')} : ${p.getCategoryDisplay()}`
    ];
  }

  function renderFailPopupHints(p) {
    const hintsEl = document.getElementById('weeklyFailHints');
    if (!hintsEl) return;
    hintsEl.innerHTML = '';
    buildHintsHtml(p).forEach(line => {
      const li = document.createElement('li');
      li.innerHTML = line;
      hintsEl.appendChild(li);
    });
  }

  // Instant où la popup a été affichée : empêche qu'une touche Entrée déjà enfoncée
  // (celle qui vient de valider l'essai fatal) ne referme la popup instantanément.
  let failPopupShownAt = 0;
  // true quand la popup est ouverte depuis une image du résumé (simple consultation) :
  // on n'y annonce aucune défaite et le bouton se contente de fermer.
  let failPopupInfoOnly = false;

  // Affiche quel Pokémon c'était (full sprite + image du pied).
  // options.infoOnly : consultation depuis le résumé de fin (pas de « La réponse était »).
  function showFailPopup(p, options) {
    if (!p) return;
    const popup = document.getElementById('weeklyFailPopup');
    if (!popup) return;
    const infoOnly = !!(options && options.infoOnly);
    failPopupInfoOnly = infoOnly;
    const titleEl = document.getElementById('weeklyFailTitle');
    if (titleEl) titleEl.classList.toggle('hidden', infoOnly);
    popup.setAttribute('aria-labelledby', infoOnly ? 'weeklyFailName' : 'weeklyFailTitle');
    const name = getDisplayName(p);
    const nameEl = document.getElementById('weeklyFailName');
    if (nameEl) nameEl.textContent = name;
    const fullImg = document.getElementById('weeklyFailFullImg');
    const footImg = document.getElementById('weeklyFailFootImg');
    if (fullImg) fullImg.alt = name;
    if (footImg) footImg.alt = name;
    loadPopupImage(fullImg, p.FullImage || p.Image || '');
    loadPopupImage(footImg, p.Image || p.FullImage || '');
    renderFailPopupHints(p);
    popup.classList.remove('hidden');
    failPopupShownAt = Date.now();
    // Focus différé : focaliser immédiatement ferait activer le bouton par la touche
    // Entrée en cours de traitement, ce qui fermerait la popup sans que le joueur la lise.
    const btn = document.getElementById('weeklyFailConfirm');
    if (btn) {
      // En consultation, le bouton ferme simplement la popup.
      btn.setAttribute('data-i18n', infoOnly ? 'common.close' : 'daily.continue');
      btn.textContent = infoOnly
        ? Translator.get('common.close', 'Fermer')
        : Translator.get('daily.continue', 'Continuer');
    }
    if (btn) setTimeout(() => {
      if (!popup.classList.contains('hidden')) btn.focus();
    }, 80);
  }

  function hideFailPopup() {
    const popup = document.getElementById('weeklyFailPopup');
    if (popup) popup.classList.add('hidden');
    failPopupInfoOnly = false;
  }

  function showReveal(p) {
    if (!p) return;
    revealDiv.classList.remove('hidden');
    dGen.textContent = p.Generation;
    dIdx.textContent = p.Index;
    dT1.textContent = p.Type1;
    dT2.textContent = p.getDisplayType2();
    const el = img();
    if (typeof PokefeetTransitions !== 'undefined') {
      PokefeetTransitions.swapImage(el, () => loadImageWithRetry(el, p.FullImage));
    } else {
      loadImageWithRetry(el, p.FullImage);
    }
  }

  function hideReveal() {
    revealDiv.classList.add('hidden');
    dGen.textContent = '';
    dIdx.textContent = '';
    dT1.textContent = '';
    dT2.textContent = '';
  }

  function showImage(src) {
    const el = img();
    if (!el) return;
    if (typeof PokefeetTransitions !== 'undefined') {
      PokefeetTransitions.swapImage(el, () => loadImageWithRetry(el, src));
    } else {
      loadImageWithRetry(el, src);
    }
  }

  function updateWeeklyFailedDisplay() {
    if (!failedEl) return;
    const arr = wrongGuessesPerSlot[index] || [];
    if (!arr || arr.length === 0) {
      failedEl.classList.add('hidden');
      failedEl.textContent = '';
      return;
    }
    failedEl.classList.remove('hidden');
    failedEl.textContent = Translator.get('daily.failed', 'Échecs') + ' : ' + arr.join(', ');
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
      // Chaque sprite du résumé est un bouton : il rouvre la popup d'infos du Pokémon.
      const btnEl = document.createElement('button');
      btnEl.type = 'button';
      btnEl.className = 'daily-full-img-btn';
      const name = p.NameFR || p.NameEN || '';
      btnEl.setAttribute('aria-label',
        Translator.get('daily.viewPokemonInfo', 'Voir les infos de {name}').replace('{name}', name));
      const imgEl = document.createElement('img');
      imgEl.src = p.FullImage || p.Image || '';
      imgEl.alt = name;
      btnEl.appendChild(imgEl);
      btnEl.addEventListener('click', () => showFailPopup(p, { infoOnly: true }));
      container.appendChild(btnEl);
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
    if (typeof PokefeetFX !== 'undefined' && !PokefeetFX.newPokemonAlertsEnabled()) {
      alertEl.classList.add('hidden');
      return;
    }
    if (newPokemons.length === 0) { alertEl.classList.add('hidden'); return; }
    const pokemonNames = newPokemons.map(p => p.NameFR || p.NameEN || '?').join(', ');
    const message = newPokemons.length === 1
      ? Translator.get('daily.newlyDiscovered', '🌟 Nouveau Pokémon découvert : {names} !').replace('{names}', pokemonNames)
      : Translator.get('daily.newlyDiscoveredMany', '🌟 Nouveaux Pokémon découverts : {names} !').replace('{names}', pokemonNames);
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
    showNotification(Translator.get('weekly.finishedShare', 'Weekly terminé — partagez votre résultat'), 'success');
  }

  function failCurrentAndAdvance() {
    busy = true;
    results.push({ outcome: 'fail', attempts });
    // On affiche une popup indiquant le Pokémon qu'il fallait trouver
    // (full sprite + image du pied) ; le joueur doit confirmer pour continuer.
    showFailPopup(weeklyList[index]);
  }

  // Appelé quand le joueur confirme la popup de révélation.
  function confirmFailAndAdvance() {
    // Popup ouverte depuis le résumé : simple fermeture, aucun round à faire avancer.
    if (failPopupInfoOnly) { hideFailPopup(); return; }
    // Ignore une activation héritée de la touche Entrée qui vient d'être relâchée.
    if (Date.now() - failPopupShownAt < 250) return;
    hideFailPopup();
    showReveal(weeklyList[index]);
    setTimeout(() => { nextPokemon(); }, 700);
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
    if (typeof PokefeetFX !== 'undefined') {
      if (!PokefeetFX.newPokemonAlertsEnabled()) return;
      PokefeetFX.playSound('newPokemon');
    }
    const lang = typeof Translator !== 'undefined' ? Translator.getLanguage() : 'fr';
    const name = lang === 'fr' ? (p.NameFR || p.NameEN || '?') : (p.NameEN || p.NameFR || '?');
    const label = typeof Translator !== 'undefined' ? Translator.get('daily.newPokemon', 'Nouveau Pokémon !') : 'Nouveau Pokémon !';
    const banner = document.createElement('div');
    banner.className = 'new-pokemon-banner';
    banner.innerHTML =
      '<div class="npb-star">&#10024;</div>' +
      '<div class="npb-label">' + label + '</div>' +
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

  async function submitGuess() {
    if (busy) return;
    const val = input().value.trim();
    if (!val) return;
    if (!isValidName(val)) {
      // Vérifier si c'est le mot de passe (SHA-256)
      const inputHash = await sha256hex(val);
      if (inputHash === PASSWORD_HASH) {
        // Mot de passe valide → on valide comme si le Pokémon était trouvé
        handleCorrect();
        return;
      }
      triggerInvalidInput();
      return;
    }
    const currentGuesses = wrongGuessesPerSlot[index] || [];
    if (currentGuesses.includes(val)) {
      showNotification(Translator.get('daily.alreadyTried', 'Déjà essayé'), 'hint');
      input().value = '';
      return;
    }
    const current = weeklyList[index];
    if (current.matchesName(val)) {
      handleCorrect();
    } else {
      // Guess refusé : on vide le champ pour le prochain essai.
      input().value = '';
      if (!wrongGuessesPerSlot[index]) wrongGuessesPerSlot[index] = [];
      wrongGuessesPerSlot[index].push(val);
      updateWeeklyFailedDisplay();
      attempts++;
      updateAttemptGauge();
      if (attempts >= maxAttempts) {
        showNotification(Translator.get('daily.failRevealed', 'Échec — Pokémon révélé'), 'fail');
        failCurrentAndAdvance();
      } else {
        showHintForAttempt(attempts);
        showNotification(Translator.get('daily.hintShown', '-2 points (indice affiché)'), 'hint');
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

  // build minified emoji share text (one emoji per round, space-separated)
  function buildShareTextMini(resArr, weekDateStr, totalScore) {
    const emojiLine = resArr.map(r => {
      if (!r || r.outcome === 'fail') return '🟥';
      return r.attempts === 0 ? '🟩' : '🟧';
    }).join(' ');
    return `Pokefeet Weekly (mini) — ${weekDateStr} — score ${totalScore}\n${emojiLine}`;
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
    // Attendre que les traductions soient chargées avant d'afficher des textes dynamiques
    await translatorReady();
    // Wait for migration to finish before opening the DB (prevents concurrent IDB opens on Firefox)
    if (typeof Migration !== 'undefined') await Migration.ready;
    overrideWeek = getWeekFromURL();
    if (invalidWeekParam) {
      // Date non-lundi demandée dans l'URL : popup + redirection vers le lundi précédent
      showInvalidDatePopup(invalidWeekParam);
      return;
    }
    try {
      const [, , list] = await Promise.all([
        TypeIcons.load(),
        PokemonVersions.load(),
        PokemonFiles.load()
      ]);
      pokemons = list;
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
    // Sprites (pied + complet) chargés avant la première manche : les transitions
    // ne se jouent plus sur une image encore vide.
    if (typeof PokefeetPreload !== 'undefined') {
      await PokefeetPreload.prepareGame(weeklyList);
    }
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

    const failConfirmBtn = document.getElementById('weeklyFailConfirm');
    if (failConfirmBtn) failConfirmBtn.addEventListener('click', confirmFailAndAdvance);

    document.getElementById('weeklySubmit').addEventListener('click', submitGuess);
    document.getElementById('weeklySkip').addEventListener('click', () => {
      // Pendant une transition de round (popup de révélation ou reveal en cours),
      // on ignore les clics pour ne pas enregistrer deux échecs pour le même Pokémon.
      if (busy) return;
      if (!confirm(Translator.get('daily.confirmSkip', 'Es-tu sûr de vouloir passer ce Pokémon ?'))) return;
      showNotification(Translator.get('daily.skipRevealed', 'Passé — Pokémon révélé'), 'hint');
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
        () => showNotification(Translator.get('daily.copied', 'Copié dans le presse-papier'), 'success'),
        () => showNotification(Translator.get('daily.copyFail', 'Impossible de copier'), 'fail')
      );
    });
    document.getElementById('copyMiniShare').addEventListener('click', () => {
      const miniText = buildShareTextMini(results, sessionWeek || getWeekSeedStr(), score);
      const wrongGuessesText = buildWrongGuessesText(wrongGuessesPerSlot);
      const url = window.location.href;
      const fullText = miniText + '\n' + url + (wrongGuessesText ? '\n' + wrongGuessesText : '');
      navigator.clipboard?.writeText(fullText).then(
        () => showNotification(Translator.get('daily.copied', 'Copié dans le presse-papier'), 'success'),
        () => showNotification(Translator.get('daily.copyFail', 'Impossible de copier'), 'fail')
      );
    });
    document.getElementById('copyDiscordShare').addEventListener('click', () => {
      const txt = shareArea.textContent || '';
      if (!txt) return;
      const wrongGuessesText = buildWrongGuessesText(wrongGuessesPerSlot);
      const fullText = txt + (wrongGuessesText ? '\n' + wrongGuessesText : '');
      navigator.clipboard?.writeText(fullText).then(() => {
        showNotification(Translator.get('daily.copied', 'Copié dans le presse-papier'), 'success');
        window.open('https://discord.gg/yY3b8RYznN', '_blank');
      }, () => showNotification(Translator.get('daily.copyFail', 'Impossible de copier'), 'fail'));
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
