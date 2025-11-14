// game.js
// Logique métier du jeu (sélection, score, essais, indices)
const Game = (function () {
  // variables privées
  let pokemons = [];
  let current = null;
  let attempts = 0; // 0 = première tentative
  let score = 0;
  const basePoints = 10;
  const hintPenalty = 2; // chaque indice retire 2 points
  const maxAttempts = 5;

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
    const idx = Math.floor(Math.random() * pokemons.length);
    return pokemons[idx];
  }

  // points pour la tentative courante selon le nombre d'indices déjà affichés (attempts)
  function pointsForAttempt(a) {
    // attempts 0 => 10, 1 => 8, 2 => 6, 3 => 4, 4 => 2
    return Math.max(basePoints - a * hintPenalty, 0);
  }

  // démarrer une partie / charger les données
  async function init() {
    // charge le JSON embarqué (on peut remplacer par fetch si placé en fichier séparé)
    // Exemple minimal intégré ici : si vous avez un fichier data/pokemons.json, utilisez fetch.
    try {
      const res = await fetch('data/pokemons.json');
      const arr = await res.json();
      pokemons = arr.map(p => new Pokemon(p));
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
    next();
    bindUI();
    UI.enableSuivantBtn(false);
  }

  function bindUI() {
    document.getElementById('submitBtn').addEventListener('click', onSubmit);
    document.getElementById('nextBtn').addEventListener('click', next);
    document.getElementById('guessInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') onSubmit();
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
    UI.setScore(score);
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
    UI.setScore(score);
    UI.showNotification('Révélé ! Score remis à 0', 'fail');
    saveBestIfNeeded();
    UI.enableInput(false);
  }

  function onSubmit() {
    const input = document.getElementById('guessInput').value.trim();
    if (!current || !input) return;
    if (current.matchesName(input)) {
      // correct
      const points = pointsForAttempt(attempts);
      score += points;
      UI.setScore(score);
      UI.showNotification('+' + points + ' points', 'success');
      UI.showRevealInfo(current); // afficher infos
      saveBestIfNeeded();
      UI.enableSuivantBtn(true);
      UI.enableInput(false);
    } else {
      // incorrect
      attempts++;
      if (attempts >= maxAttempts) {
        // échoué complètement
        UI.enableSuivantBtn(true);
        revealAllAndResetScore();
      } else {
        // afficher indice correspondant
        showHintForAttempt(attempts);
        UI.showNotification('-0 points (indice affiché)', 'hint');
      }
    }
  }

  function showHintForAttempt(a) {
    // a = 1 => afficher Type1
    // a = 2 => afficher Type2
    // a = 3 => afficher Index
    // a = 4 => afficher Generation
    switch (a) {
      case 1:
        UI.addHint(`Type 1 : ${current.Type1}`);
        break;
      case 2:
        UI.addHint(`Type 2 : ${current.getDisplayType2()}`);
        break;
      case 3:
        UI.addHint(`Index : ${current.Index}`);
        break;
      case 4:
        UI.addHint(`Génération : ${current.Generation}`);
        break;
      default:
        break;
    }
    // mettre à jour points attendus (visuel)
    UI.setScorePreview(pointsForAttempt(attempts));
  }

  return {
    init,
    next,
    onSubmit,
    // exposer pour debug/test si besoin
    _getState: () => ({current, attempts, score})
  };
})();
