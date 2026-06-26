// game.js
// Logique métier du jeu (sélection, score, essais, indices)
const Game = (function () {
  // variables privées
  let pokemons = [];
  let PossiblePokemons = [];
  let current = null;
  let attempts = 0; // 0 = première tentative
  let score = 0;
  let streak = 0;
  let currentWrongGuesses = [];
  const basePoints = 10;
  const hintPenalty = 2; // chaque indice retire 2 points
  const maxAttempts = 5;
  const PASSWORD_HASH = '19768d6a62452099c450e0e7d1ba4be25597c2669dcab5fea88fe73ae74ca39e';
  const sha256hex = async (str) => {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  };
  let practiceGaugeEl = null;
  let practiceGaugeFill = null;
  let practiceGaugeLabel = null;
  let gameActive = false;

  // session & stats
  const SESSION_KEY      = 'pk_practice_session';
  let foundCount         = 0;
  let perfectCount       = 0;
  let totalFails         = 0;
  let pokemonTotal       = 0;
  let fullOrderedIndices = [];
  let sessionStartedAt   = null;
  let bestStreak         = 0;

  // cookie helpers
  function setCookie(name, value, days = 365) {
    const d = new Date();
    d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = `${name}=${encodeURIComponent(value)};expires=${d.toUTCString()};path=/`;
  }
  function getCookie(name) {
    const v = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
    return v ? decodeURIComponent(v.pop()) : null;
  }

  // ── Seeded PRNG (mulberry32) ─────────────────────────────
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function seededShuffle(arr, seed) {
    const rng    = mulberry32(seed);
    const result = arr.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  // ── Session persistence ───────────────────────────────────
  function saveSession() {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        orderedIndices: fullOrderedIndices,
        foundCount:     foundCount,
        score:          score,
        streak:         streak,
        perfectCount:   perfectCount,
        totalFails:     totalFails,
        pokemonTotal:   pokemonTotal,
        finished:       false,
        startedAt:      sessionStartedAt
      }));
    } catch (e) {}
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      return s.finished ? null : s;
    } catch (e) { return null; }
  }

  function markSessionFinished() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      s.finished = true;
      localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    } catch (e) {}
  }

  // ── Progress bar ──────────────────────────────────────────
  function updateProgressBar() {
    const bar   = document.getElementById('practiceProgressFill');
    const ghost = document.getElementById('practiceProgressBestStreak');
    const label = document.getElementById('practiceProgressLabel');
    if (!bar || !label) return;
    const pct = pokemonTotal > 0 ? Math.round((foundCount / pokemonTotal) * 100) : 0;
    bar.style.width = pct + '%';
    if (ghost) {
      const bestPct = pokemonTotal > 0 ? Math.round((bestStreak / pokemonTotal) * 100) : 0;
      ghost.style.width = bestPct + '%';
    }
    label.textContent = foundCount + ' / ' + pokemonTotal;
  }

  // ── Victory screen (end of pool) ─────────────────────────
  function showVictoryScreen() {
    gameActive = false;
    markSessionFinished();
    const screen = document.getElementById('gameOverScreen');
    if (!screen) return;
    const T       = (k, f) => (typeof Translator !== 'undefined' ? Translator.get(k, f) : f);
    const titleEl = document.getElementById('gameOverTitle');
    const imgEl   = document.getElementById('gameOverImg');
    const nameEl  = document.getElementById('gameOverPokeName');
    const statsEl = document.getElementById('gameOverStats');
    if (titleEl) titleEl.textContent = T('practice.victoryTitle', 'Félicitations !');
    if (imgEl)  { imgEl.src = ''; imgEl.style.display = 'none'; }
    if (nameEl) nameEl.textContent = T('practice.victoryAll', 'Vous avez trouvé tous les Pokémon !');
    if (statsEl) {
      const best = parseInt(getCookie('pk_best') || '0', 10);
      statsEl.innerHTML =
        '<div>' + T('practice.score',        'Score')                + ' : <strong>' + score                          + '</strong></div>' +
        '<div>' + T('practice.statsFound',   'Trouvés')              + ' : <strong>' + foundCount + ' / ' + pokemonTotal + '</strong></div>' +
        '<div>' + T('practice.statsPerfect', 'Parfaits (1er essai)') + ' : <strong>' + perfectCount                   + '</strong></div>' +
        '<div>' + T('practice.statsFails',   'Erreurs totales')      + ' : <strong>' + totalFails                     + '</strong></div>' +
        '<div>' + T('practice.streak',       'Série')                + ' : <strong>' + streak                         + '</strong></div>' +
        '<div>' + T('practice.bestStreak',   'Meilleur Streak')      + ' : <strong>' + bestStreak                     + '</strong></div>' +
        '<div>' + T('practice.best',         'Meilleur')             + ' : <strong>' + best                           + '</strong></div>';
    }
    screen.style.display = 'flex';
  }

  // selection aléatoire (désormais gérée via seededShuffle au démarrage)
  // points pour la tentative courante selon le nombre d'indices déjà affichés (attempts)
  function pointsForAttempt(a) {
    // attempts 0 => 10, 1 => 8, 2 => 6, 3 => 4, 4 => 2
    return Math.max(basePoints - a * hintPenalty, 0);
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
    const el = document.getElementById('guessInput');
    if (!el) return;
    el.classList.remove('shake');
    // reflow pour relancer l'animation si déjà présente
    void el.offsetWidth;
    el.classList.add('shake');
    const invalidMsg = Translator.get('practice.invalidName', 'Nom invalide');
    UI.showNotification(invalidMsg, 'fail');
    // retirer la classe après l'animation
    setTimeout(() => el.classList.remove('shake'), 500);
  }

  // démarrer une partie / charger les données
  async function init() {
    // charge le JSON embarqué (on peut remplacer par fetch si placé en fichier séparé)
    // Exemple minimal intégré ici : si vous avez un fichier data/pokemons.json, utilisez fetch.
    try {
      const [pokemonsRes] = await Promise.all([
        fetch('data/pokemons.json'),
        TypeIcons.load(),
        PokemonVersions.load()
      ]);
      const arr = await pokemonsRes.json();
      pokemons = arr.map(p => new Pokemon(p));
      // Pool de jeu limité aux Pokémon disponibles aujourd'hui
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      PossiblePokemons = PokemonVersions.getAvailablePokemons(pokemons, todayStr);
      const _avVer = PokemonVersions.getAvailableVersions(todayStr);
      const _vNames = (PokemonVersions.getData() || []).filter(v => _avVer.has(v.pokefeet_data_version)).map(v => v.Update_Name);
      console.log(`[Entraînement – ${todayStr}] Pool : ${PossiblePokemons.length} Pokémon | Versions autorisées : ${_vNames.join(', ')}`);
    } catch (e) {
      // fallback : quelques pokémons d'exemple pour que l'app fonctionne sans fetch
      pokemons = [
        new Pokemon({"Index":"1","NameEN":"Bulbasaur","NameFR":"Bulbizarre","Generation":1,"Type1":"grass","Type2":"poison","Image":"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/1.png"}),
        new Pokemon({"Index":"4","NameEN":"Charmander","NameFR":"Salamèche","Generation":1,"Type1":"fire","Type2":null,"Image":"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/4.png"}),
        new Pokemon({"Index":"7","NameEN":"Squirtle","NameFR":"Carapuce","Generation":1,"Type1":"water","Type2":null,"Image":"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/7.png"})
      ];
      PossiblePokemons = pokemons.slice();
    }

    // initialisation UI
    UI.populateNamesList(pokemons);
    loadBestScore();
    loadBestStreak();
    // cache gauge elements (DOM is ready when init is called)
    practiceGaugeEl = document.getElementById('practiceAttemptGauge');
    practiceGaugeFill = practiceGaugeEl ? practiceGaugeEl.querySelector('.gauge-fill') : null;
    practiceGaugeLabel = practiceGaugeEl ? practiceGaugeEl.querySelector('.gauge-label') : null;

    // ── Session restore ou nouvelle partie ───────────────────
    const savedSession = loadSession();
    if (savedSession && Array.isArray(savedSession.orderedIndices) && savedSession.orderedIndices.length > 0) {
      // Reprendre la session existante
      fullOrderedIndices = savedSession.orderedIndices;
      pokemonTotal       = fullOrderedIndices.length;
      foundCount         = savedSession.foundCount   || 0;
      score              = savedSession.score        || 0;
      streak             = savedSession.streak       || 0;
      perfectCount       = savedSession.perfectCount || 0;
      totalFails         = savedSession.totalFails   || 0;
      sessionStartedAt   = savedSession.startedAt    || new Date().toISOString();
      const pokemonMap   = new Map(pokemons.map(p => [String(p.Index), p]));
      PossiblePokemons   = fullOrderedIndices
        .slice(foundCount)
        .map(idx => pokemonMap.get(String(idx)))
        .filter(p => p != null);
      UI.setScore(score);
      UI.setStreak(streak);
      UI.showNotification(
        (typeof Translator !== 'undefined')
          ? Translator.get('practice.sessionResumed', 'Partie en cours reprise')
          : 'Partie en cours reprise',
        'hint'
      );
    } else {
      // Nouvelle session avec ordre d\u00e9terministe (seed)
      const seed         = Math.floor(Math.random() * 2147483647) + 1;
      PossiblePokemons   = seededShuffle(PossiblePokemons, seed);
      pokemonTotal       = PossiblePokemons.length;
      fullOrderedIndices = PossiblePokemons.map(p => String(p.Index));
      sessionStartedAt   = new Date().toISOString();
      foundCount = 0; score = 0; streak = 0; perfectCount = 0; totalFails = 0;
      saveSession();
    }

    updateProgressBar();
    next();
    gameActive = true;
    bindUI();
    UI.enableSuivantBtn(false);
  }

  function bindUI() {
    document.getElementById('submitBtn').addEventListener('click', onSubmit);
    document.getElementById('nextBtn').addEventListener('click', next);

    // Abandon → game over screen
    const ab = document.getElementById('abandonBtn');
    if (ab) ab.addEventListener('click', () => {
      const confirmMsg = Translator.get('practice.confirmAbandon', 'Êtes-vous sûr d\'abandonner cette partie ?');
      if (!confirm(confirmMsg)) return;
      markSessionFinished();
      saveBestIfNeeded();
      showGameOverScreen(current, true);
    });

    // Retour à l'accueil
    const retourBtn = document.getElementById('retourBtn');
    if (retourBtn) retourBtn.addEventListener('click', () => {
      window.location.href = './index.html';
    });

    // Boutons de l'écran game over
    const gameOverHomeBtn = document.getElementById('gameOverHomeBtn');
    if (gameOverHomeBtn) gameOverHomeBtn.addEventListener('click', () => {
      window.location.href = './index.html';
    });
    const gameOverReplayBtn = document.getElementById('gameOverReplayBtn');
    if (gameOverReplayBtn) gameOverReplayBtn.addEventListener('click', () => {
      window.location.reload();
    });

    // Autocomplete custom (comme le daily)
    const practiceDropdown = document.getElementById('practiceNamesDropdown');
    let dropdownActive = -1;

    function closePracticeDropdown() {
      if (!practiceDropdown) return;
      practiceDropdown.innerHTML = '';
      practiceDropdown.classList.add('hidden');
      dropdownActive = -1;
    }

    function navigatePracticeDropdown(dir) {
      if (!practiceDropdown) return;
      const items = practiceDropdown.querySelectorAll('.autocomplete-item');
      if (!items.length) return;
      if (dropdownActive >= 0) items[dropdownActive]?.classList.remove('active');
      dropdownActive = (dropdownActive + dir + items.length) % items.length;
      items[dropdownActive].classList.add('active');
      items[dropdownActive].scrollIntoView({ block: 'nearest' });
    }

    const guessInput = document.getElementById('guessInput');
    guessInput.addEventListener('input', () => {
      if (!practiceDropdown) return;
      const needle = normalizeStr(guessInput.value.trim());
      practiceDropdown.innerHTML = '';
      dropdownActive = -1;
      if (!needle) { practiceDropdown.classList.add('hidden'); return; }
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
            guessInput.value = name;
            closePracticeDropdown();
            onSubmit();
          });
          practiceDropdown.appendChild(item);
          count++;
        }
      });
      practiceDropdown.classList.toggle('hidden', count === 0);
    });

    guessInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); navigatePracticeDropdown(1); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); navigatePracticeDropdown(-1); return; }
      if (e.key === 'Escape')    { closePracticeDropdown(); return; }
      if (e.key === 'Enter') {
        const items = practiceDropdown ? practiceDropdown.querySelectorAll('.autocomplete-item') : [];
        if (dropdownActive >= 0 && items[dropdownActive]) {
          guessInput.value = items[dropdownActive].textContent;
          closePracticeDropdown();
        }
        onSubmit();
      }
    });

    guessInput.addEventListener('blur', () => {
      setTimeout(closePracticeDropdown, 150);
    });

    // Espace → next (si le bouton Suivant est actif et qu'on n'est pas en train de taper dans l'input)
    document.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.code === 'Space') {
        const nextBtn = document.getElementById('nextBtn');
        if (nextBtn && !nextBtn.disabled && document.activeElement !== guessInput) {
          e.preventDefault(); // empêche le scroll
          nextBtn.click();
        }
      }
    });
  }

  function loadBestScore() {
    const best = parseInt(getCookie('pk_best') || '0', 10);
    UI.setBest(best);
  }

  function saveBestIfNeeded() {
    const best = parseInt(getCookie('pk_best') || '0', 10);
    if (score > best) {
      setCookie('pk_best', score, 365);
      UI.setBest(score);
    }
  }

  function loadBestStreak() {
    bestStreak = parseInt(getCookie('pk_best_streak') || '0', 10);
    UI.setBestStreak(bestStreak);
  }

  function saveBestStreakIfNeeded() {
    if (streak > bestStreak) {
      bestStreak = streak;
      setCookie('pk_best_streak', bestStreak, 365);
      UI.setBestStreak(bestStreak);
      updateProgressBar();
    }
  }

  function resetGameStateForNewPokemon() {
    attempts = 0;
    UI.clearHints();
    UI.hideRevealInfo();
    currentWrongGuesses = [];
    UI.clearFailedAttemptsPractice();
    // reset practice gauge
    if (practiceGaugeFill && practiceGaugeLabel) {
      const pct = Math.round((basePoints / basePoints) * 100);
      practiceGaugeFill.style.height = pct + '%';
      practiceGaugeLabel.textContent = '+' + basePoints;
    }
    UI.setScore(score);
    UI.setStreak(streak);
    UI.clearInput();
  }

  function next() {
    if (PossiblePokemons.length === 0) {
      saveBestIfNeeded();
      showVictoryScreen();
      return;
    }
    current = PossiblePokemons.shift();
    resetGameStateForNewPokemon();
    UI.showPokemonImage(current ? current.Image : '');
    UI.enableInput(true);
    UI.setSubmitEnabled(true);
    UI.enableSuivantBtn(false);
    // Focus direct sur l'input pour le round suivant
    const guessInput = document.getElementById('guessInput');
    if (guessInput) guessInput.focus();
  }

  function revealAllAndResetScore() {
    UI.showRevealInfo(current);
    score = 0;
    streak = 0;
    UI.setScore(score);
    const revealedMsg = Translator.get('practice.revealedReset', 'Révélé ! Score remis à 0');
    UI.showNotification(revealedMsg, 'fail');
    saveBestIfNeeded();
    UI.enableInput(false);
  }

  function isFastMode() {
    return getCookie('pk_fast_mode') === 'true';
  }

  function getCurrentLanguageName(pokemon) {
    if (!pokemon) return '';
    const lang = typeof Translator !== 'undefined' ? Translator.getLanguage() : 'fr';
    return lang === 'fr' ? (pokemon.NameFR || pokemon.NameEN) : (pokemon.NameEN || pokemon.NameFR);
  }

  async function onSubmit() {
    const input = document.getElementById('guessInput').value.trim();
    if (!current || !input) return;

    // validation : si le nom n'est pas dans la liste possible, on secoue et on affiche une erreur
    if (!isValidName(input)) {
      // Vérifier si c'est le mot de passe (SHA-256)
      const inputHash = await sha256hex(input);
      if (inputHash === PASSWORD_HASH) {
        // Mot de passe valide → on valide comme si le Pokémon était trouvé
        const points = pointsForAttempt(attempts);
        score += points;
        streak += 1;
        saveBestStreakIfNeeded();
        if (attempts === 0) perfectCount++;
        totalFails += attempts;
        foundCount++;
        UI.setScore(score);
        UI.setStreak(streak);
        const pokemonName = getCurrentLanguageName(current);
        UI.showNotification('+' + points + ' points — ' + pokemonName, 'success');
        saveBestIfNeeded();
        saveSession();
        updateProgressBar();
        if (isFastMode()) {
          UI.enableInput(false);
          setTimeout(() => { next(); }, 400);
        } else {
          UI.showRevealInfo(current);
          UI.enableSuivantBtn(true);
          UI.enableInput(false);
          UI.showPokemonImage(current ? current.FullImage : '');
        }
        return;
      }
      triggerInvalidInput();
      return; // ne compte pas comme tentative
    }

    // check if already tried
    if (currentWrongGuesses.includes(input)) {
      const alreadyTriedMsg = Translator.get('daily.alreadyTried', 'Déjà essayé');
      UI.showNotification(alreadyTriedMsg, 'hint');
      return; // ne compte pas comme tentative
    }

    if (current.matchesName(input)) {
      // correct
      const points = pointsForAttempt(attempts);
      score += points;
      streak += 1;
      saveBestStreakIfNeeded();
      if (attempts === 0) perfectCount++;
      totalFails += attempts;
      foundCount++;
      UI.setScore(score);
      UI.setStreak(streak);
      
      // Notification avec le nom du Pokémon dans la langue courante
      const pokemonName = getCurrentLanguageName(current);
      UI.showNotification('+' + points + ' points — ' + pokemonName, 'success');
      
      saveBestIfNeeded();
      saveSession();
      updateProgressBar();

      if (isFastMode()) {
        // Fast Mode : passer directement au suivant sans écran de résultat
        UI.enableInput(false);
        setTimeout(() => {
          next();
        }, 400);
      } else {
        UI.showRevealInfo(current);
        UI.enableSuivantBtn(true);
        UI.enableInput(false);
        UI.showPokemonImage(current ? current.FullImage : '');
      }
    } else {
      // incorrect
      // record wrong guess for display
      const guessVal = document.getElementById('guessInput').value.trim();
      if (guessVal) currentWrongGuesses.push(guessVal);
      UI.showFailedAttemptsPractice(currentWrongGuesses);
      attempts++;
      // update practice gauge
      if (practiceGaugeFill && practiceGaugeLabel) {
        const pts = pointsForAttempt(attempts);
        const pct = Math.round((pts / basePoints) * 100);
        practiceGaugeFill.style.height = pct + '%';
        practiceGaugeLabel.textContent = (pts > 0) ? ('+' + pts) : '+0';
      }
      if (attempts >= maxAttempts) {
        // échoué complètement → écran game over
        totalFails += maxAttempts;
        markSessionFinished();
        saveBestIfNeeded();
        showGameOverScreen(current, false);
      } else {
        // afficher indice correspondant
        showHintForAttempt(attempts);
        const hintMsg = Translator.get('practice.hintShown', '-2 points (indice affiché)');
        UI.showNotification(hintMsg, 'hint');
      }
    }
  }

  function showHintForAttempt(a) {
    // a = 1 => Type(s) on same line
    // a = 2 => Index with generation in parentheses
    // a = 3 => Egg groups
    // a = 4 => Category
    switch (a) {
      case 1:
        // Types on same line
        const t1 = current.Type1 || '';
        const t2 = current.Type2 || '';
        const typesLabel = Translator.get('practice.types', 'Type(s)');
        const t1Badge = `<span class="type-badge t-${t1.toLowerCase()}">${Translator.get('types.' + t1.toLowerCase(), t1)}</span>`;
        let typeHint = `${typesLabel} : ${t1Badge}`;
        if (t2) {
          const t2Badge = `<span class="type-badge t-${t2.toLowerCase()}">${Translator.get('types.' + t2.toLowerCase(), t2)}</span>`;
          typeHint += ` ${t2Badge}`;
        }
        UI.addHintHTML(typeHint);
        break;
      case 2:
        // Index with generation
        const indexLabel = Translator.get('practice.index', 'Index');
        const genLabel = Translator.get('practice.generation_hint', 'Génération');
        UI.addHint(`${indexLabel} : ${current.Index} (${genLabel} ${current.Generation})`);
        break;
      case 3:
        // Egg groups
        const eggLabel = Translator.get('practice.eggGroups', 'Groupes d\'oeuf');
        UI.addHint(`${eggLabel} : ${current.getEggGroupsDisplay()}`);
        break;
      case 4:
        // Category
        const catLabel = Translator.get('practice.category', 'Catégorie');
        UI.addHint(`${catLabel} : ${current.getCategoryDisplay()}`);
        break;
      default:
        break;
    }
    // mettre à jour points attendus (visuel)
    UI.setScorePreview(pointsForAttempt(attempts));
  }

  function showGameOverScreen(pokemon, wasAbandon) {
    gameActive = false;
    const screen = document.getElementById('gameOverScreen');
    if (!screen) return;
    const titleEl = document.getElementById('gameOverTitle');
    const imgEl = document.getElementById('gameOverImg');
    const nameEl = document.getElementById('gameOverPokeName');
    const statsEl = document.getElementById('gameOverStats');
    if (titleEl) titleEl.textContent = wasAbandon
      ? Translator.get('practice.abandonTitle', 'Partie abandonnée')
      : Translator.get('practice.failTitle', 'Échec !');
    if (imgEl) {
      imgEl.src = pokemon ? (pokemon.FullImage || pokemon.Image || '') : '';
      imgEl.alt = pokemon ? (pokemon.NameFR || pokemon.NameEN || '') : '';
    }
    if (nameEl) nameEl.textContent = pokemon ? (pokemon.NameFR || pokemon.NameEN || '?') : '';
    if (statsEl) {
      const T = (k, f) => (typeof Translator !== 'undefined' ? Translator.get(k, f) : f);
      const best = parseInt(getCookie('pk_best') || '0', 10);
      statsEl.innerHTML =
        '<div>' + T('practice.score',        'Score')                + ' : <strong>' + score                          + '</strong></div>' +
        '<div>' + T('practice.statsFound',   'Trouv\u00e9s')              + ' : <strong>' + foundCount + ' / ' + pokemonTotal + '</strong></div>' +
        '<div>' + T('practice.statsPerfect', 'Parfaits (1er essai)') + ' : <strong>' + perfectCount                   + '</strong></div>' +
        '<div>' + T('practice.statsFails',   'Erreurs totales')      + ' : <strong>' + totalFails                     + '</strong></div>' +
        '<div>' + T('practice.streak',       'S\u00e9rie')                + ' : <strong>' + streak                         + '</strong></div>' +
        '<div>' + T('practice.bestStreak',   'Meilleur Streak')      + ' : <strong>' + bestStreak                     + '</strong></div>' +
        '<div>' + T('practice.best',         'Meilleur')             + ' : <strong>' + best                           + '</strong></div>';
    }
    screen.style.display = 'flex';
  }

  return {
    init,
    next,
    onSubmit,
    // exposer pour debug/test si besoin
    _getState: () => ({current, attempts, score})
  };
})();




//////////////////////////////
////////////////////////////// si tu vois ça, bien joué, tu es un malin
//////////////////////////////