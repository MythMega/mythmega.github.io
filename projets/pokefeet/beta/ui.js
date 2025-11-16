// ui.js
// Fonctions responsables des mises à jour visuelles
const UI = (function () {
  const scoreEl = document.getElementById('score');
  const streakEl = document.getElementById('streak');
  const bestEl = document.getElementById('bestScore');
  const imgEl = document.getElementById('pokeImg');
  const hintsList = document.getElementById('hintsList');
  const revealDiv = document.getElementById('revealInfo');
  const genEl = document.getElementById('gen');
  const idxEl = document.getElementById('indexDex');
  const t1El = document.getElementById('t1');
  const t2El = document.getElementById('t2');
  const notifContainer = document.getElementById('notifications');
  const namesDatalist = document.getElementById('namesList');
  const nextBtn = document.getElementById('nextBtn');
  const submitBtn = document.getElementById('submitBtn');

  function populateNamesList(pokemons) {
    // Récupère tous les noms FR/EN uniques
    const namesSet = new Set();
    pokemons.forEach(p => {
      if (p.NameFR) namesSet.add(p.NameFR);
      if (p.NameEN) namesSet.add(p.NameEN);
    });

    // Transforme en tableau puis mélange (Fisher‑Yates)
    const names = Array.from(namesSet);
    for (let i = names.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [names[i], names[j]] = [names[j], names[i]];
    }

    // Vide et remplit le datalist
    namesDatalist.innerHTML = '';
    names.forEach(n => {
      const o = document.createElement('option');
      o.value = n;
      namesDatalist.appendChild(o);
    });
  }

  function showPokemonImage(src) {
    imgEl.src = src || '';
    imgEl.alt = src ? 'Pokémon' : 'Aucun';
    // Réinitialiser image styles si nécessaire
  }

  function setScore(s) {
    scoreEl.textContent = s;
  }

  function setStreak(s) {
    streakEl.textContent = s;
  }

  function setBest(b) {
    bestEl.textContent = b;
  }

  function addHint(text) {
    const li = document.createElement('li');
    li.textContent = text;
    hintsList.appendChild(li);
  }

  function clearHints() {
    hintsList.innerHTML = '';
  }

  function showRevealInfo(pokemon) {
    if (!pokemon) return;
    revealDiv.classList.remove('hidden');
    genEl.textContent = pokemon.Generation;
    idxEl.textContent = pokemon.Index;
    t1El.textContent = pokemon.Type1;
    t2El.textContent = pokemon.getDisplayType2();
  }

  function hideRevealInfo() {
    revealDiv.classList.add('hidden');
    genEl.textContent = '';
    idxEl.textContent = '';
    t1El.textContent = '';
    t2El.textContent = '';
  }

  function clearInput() {
    const inp = document.getElementById('guessInput');
    if (inp) inp.value = '';
  }

  function enableInput(enabled) {
    const inp = document.getElementById('guessInput');
    if (inp) inp.disabled = !enabled;
    submitBtn.disabled = !enabled;
    nextBtn.disabled = false;
  }

  function enableSuivantBtn(enabledState) {
    nextBtn.disabled = !enabledState;
  }

  function setSubmitEnabled(v) {
    submitBtn.disabled = !v;
  }

  // notification simple en haut à droite
  function showNotification(message, type = 'info') {
    const n = document.createElement('div');
    n.className = 'notification';
    n.textContent = message;
    if (type === 'fail') n.style.background = '#491111';
    if (type === 'hint') n.style.background = '#334155';
    notifContainer.appendChild(n);
    setTimeout(() => {
      n.style.opacity = 0;
      try { notifContainer.removeChild(n); } catch (e) {}
    }, 1800);
  }

  // visual preview of points for the next correct answer (optional)
  function setScorePreview(p) {
    // place un petit badge temporaire comme notification
    showNotification('Réponse correcte = +' + p + ' points', 'hint');
  }

  return {
    populateNamesList,
    showPokemonImage,
    setScore,
    setStreak,
    setBest,
    addHint,
    clearHints,
    showRevealInfo,
    hideRevealInfo,
    clearInput,
    enableInput,
    setSubmitEnabled,
    showNotification,
    enableSuivantBtn,
  };
})();
