// business/custom_challenges/custom-challenge-game.js
// Logique métier d'une session de challenge custom (arcade, sans persistance).
// Le jeu : deviner chaque Pokémon de la séquence. Aucune limite d'échecs :
// on garde des indices progressifs tant que la réponse est fausse.

const CustomChallengeGame = (function () {
  let allPokemons = [];
  let challengeData = null;
  let order = [];            // Pokémon résolus, dans l'ordre de jeu
  let currentSlot = 0;       // position courante dans la séquence
  let currentAttempts = 0;   // tentatives ratées sur le Pokémon courant
  let currentWrong = [];     // mauvaises réponses du Pokémon courant
  let totalFails = 0;        // total de mauvaises réponses de la partie
  let perSlot = [];          // résultat par Pokémon : { outcome, attempts, wrong: [] }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  async function loadPokemons() {
    if (allPokemons.length) return allPokemons;
    try {
      const res = await fetch('data/pokemons.json');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const arr = await res.json();
      allPokemons = arr.map(function (p) { return new Pokemon(p); });
    } catch (e) {
      console.error('[CustomChallengeGame] Error loading pokemons:', e);
      allPokemons = [];
    }
    return allPokemons;
  }

  function resolvePokemon(index) {
    return allPokemons.find(function (p) { return String(p.Index) === String(index); }) || null;
  }

  // data = { author, name, random, pokemons: [index, ...] }
  function start(data) {
    challengeData = {
      author: String(data.author || 'Trainer'),
      name: String(data.name || 'Challenge'),
      random: !!data.random,
      pokemons: (data.pokemons || []).map(String)
    };

    let list = challengeData.pokemons.map(resolvePokemon).filter(Boolean);
    // Ordre de jeu : respecte la séquence définie, ou mélange aléatoire si demandé
    order = challengeData.random ? shuffle(list) : list;

    currentSlot = 0;
    currentAttempts = 0;
    currentWrong = [];
    totalFails = 0;
    perSlot = order.map(function () { return { outcome: 'pending', attempts: 0, wrong: [] }; });
    return order.length;
  }

  function getChallenge() { return challengeData; }
  function getOrder() { return order; }
  function getCurrentPokemon() { return order[currentSlot] || null; }
  function getProgress() { return { current: currentSlot, total: order.length }; }
  function getTotalFails() { return totalFails; }
  function getPerSlot() { return perSlot; }
  function getCurrentWrong() { return currentWrong; }
  function isFinished() { return currentSlot >= order.length; }
  function getAllPokemons() { return allPokemons; }

  // Vérifie une réponse pour le Pokémon courant.
  // Retourne { correct, finished, pokemon }
  function checkAnswer(answer) {
    const p = getCurrentPokemon();
    if (!p) return { correct: false, finished: true, pokemon: null };

    if (p.matchesName(answer)) {
      // Marquer le Pokémon courant comme trouvé et passer au suivant
      perSlot[currentSlot] = { outcome: 'win', attempts: currentAttempts, wrong: currentWrong.slice() };
      currentSlot++;
      currentAttempts = 0;
      currentWrong = [];
      return { correct: true, finished: currentSlot >= order.length, pokemon: p };
    }

    currentAttempts++;
    totalFails++;
    currentWrong.push(answer);
    return { correct: false, finished: false, pokemon: p };
  }

  function reset() {
    challengeData = null;
    order = [];
    perSlot = [];
    currentSlot = 0;
    currentAttempts = 0;
    currentWrong = [];
    totalFails = 0;
  }

  return {
    loadPokemons,
    start,
    getChallenge,
    getOrder,
    getCurrentPokemon,
    getProgress,
    getTotalFails,
    getPerSlot,
    getCurrentWrong,
    isFinished,
    checkAnswer,
    getAllPokemons,
    reset
  };
})();