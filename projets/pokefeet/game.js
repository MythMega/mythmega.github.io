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
  let practiceGaugeEl = null;
  let practiceGaugeFill = null;
  let practiceGaugeLabel = null;
  let gameActive = false;

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

  // selection aléatoire
  function pickRandom() {
    if (!pokemons.length) return null;
    return takeRandomAndRemove();
  }

  function takeRandomAndRemove() {
    // mélange Fisher‑Yates in-place
    for (let i = PossiblePokemons.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [PossiblePokemons[i], PossiblePokemons[j]] = [PossiblePokemons[j], PossiblePokemons[i]];
    }

    // prends et retire le premier élément
    const selected = PossiblePokemons.shift(); // ou arr.splice(0,1)[0]
    return selected;
  }

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
        TypeIcons.load()
      ]);
      const arr = await pokemonsRes.json();
      pokemons = arr.map(p => new Pokemon(p));
      PossiblePokemons = pokemons.slice();
    } catch (e) {
      // fallback : quelques pokémons d'exemple pour que l'app fonctionne sans fetch
      pokemons = [
        new Pokemon({"Index":"1","NameEN":"Bulbasaur","NameFR":"Bulbizarre","Generation":1,"Type1":"grass","Type2":"poison","Image":"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/1.png"}),
        new Pokemon({"Index":"4","NameEN":"Charmander","NameFR":"Salamèche","Generation":1,"Type1":"fire","Type2":null,"Image":"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/4.png"}),
        new Pokemon({"Index":"7","NameEN":"Squirtle","NameFR":"Carapuce","Generation":1,"Type1":"water","Type2":null,"Image":"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/7.png"})
      ];
    }

    // initialisation UI
    UI.populateNamesList(pokemons);
    loadBestScore();
    // cache gauge elements (DOM is ready when init is called)
    practiceGaugeEl = document.getElementById('practiceAttemptGauge');
    practiceGaugeFill = practiceGaugeEl ? practiceGaugeEl.querySelector('.gauge-fill') : null;
    practiceGaugeLabel = practiceGaugeEl ? practiceGaugeEl.querySelector('.gauge-label') : null;
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
      saveBestIfNeeded();
      showGameOverScreen(current, true);
    });

    // Retour à l'accueil → confirm si partie en cours
    const retourBtn = document.getElementById('retourBtn');
    if (retourBtn) retourBtn.addEventListener('click', () => {
      if (gameActive) {
        const confirmMsg = Translator.get('practice.confirmLeave', 'Êtes-vous sûr de vouloir quitter la partie ?');
        if (!confirm(confirmMsg)) return;
      }
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

    // Confirmation avant fermeture/rechargement si partie en cours
    window.addEventListener('beforeunload', (e) => {
      if (gameActive) {
        e.preventDefault();
        e.returnValue = '';
      }
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
    current = pickRandom();
    resetGameStateForNewPokemon();
    UI.showPokemonImage(current ? current.Image : '');
    UI.enableInput(true);
    UI.setSubmitEnabled(true);
    UI.enableSuivantBtn(false);
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

  function onSubmit() {
    const input = document.getElementById('guessInput').value.trim();
    if (!current || !input) return;

    // validation : si le nom n'est pas dans la liste possible, on secoue et on affiche une erreur
    if (!isValidName(input)) {
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
      UI.setScore(score);
      UI.setStreak(streak);
      UI.showNotification('+' + points + ' points', 'success');
      UI.showRevealInfo(current); // afficher infos
      saveBestIfNeeded();
      UI.enableSuivantBtn(true);
      UI.enableInput(false);
      UI.showPokemonImage(current ? current.FullImage : '');
      console.log(PossiblePokemons.length);
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
        const t1Name = Translator.get(`types.${t1}`, t1);
        const t1IconUrl = TypeIcons.getUrl(t1);
        const t1Html = t1Name + (t1IconUrl ? ` <img class="type-icon" src="${t1IconUrl}" alt="${t1}">` : '');
        let typeHint = `${typesLabel} : ${t1Html}`;
        if (t2) {
          const t2Name = Translator.get(`types.${t2}`, t2);
          const t2IconUrl = TypeIcons.getUrl(t2);
          const t2Html = t2Name + (t2IconUrl ? ` <img class="type-icon" src="${t2IconUrl}" alt="${t2}">` : '');
          typeHint += ` / ${t2Html}`;
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
      const scoreLabel = Translator.get('practice.score', 'Score');
      const streakLabel = Translator.get('practice.streak', 'Série');
      const bestLabel = Translator.get('practice.best', 'Meilleur');
      const best = parseInt(getCookie('pk_best') || '0', 10);
      statsEl.innerHTML =
        `<div>${scoreLabel} : <strong>${score}</strong></div>` +
        `<div>${streakLabel} : <strong>${streak}</strong></div>` +
        `<div>${bestLabel} : <strong>${best}</strong></div>`;
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