// daily.js
// Mode "Daily" : 5 Pokémon identiques pour tout le monde chaque jour (seed = date)
// Dépend de pokemon.js (classe Pokemon + matchesName)

const Daily = (function () {
  // config
  const COUNT = 5;
  const maxAttempts = 5; // 0..4 attempts allowed, 5th fail = complete fail
  const cookieName = 'pk_daily_result_v1';

  // state
  let pokemons = [];
  let dailyList = []; // array of Pokemon objects (5)
  let index = 0; // current position 0..4
  let attempts = 0; // attempts for current pokemon (0 = first try)
  let score = 0;
  let results = []; // for each of 5: { outcome: 'win'|'fail', attempts: n }

  // DOM
  const img = () => document.getElementById('dailyImg');
  const input = () => document.getElementById('dailyInput');
  const hintsList = document.getElementById('dailyHints');
  const revealDiv = document.getElementById('dailyReveal');
  const dGen = document.getElementById('dGen');
  const dIdx = document.getElementById('dIndex');
  const dT1 = document.getElementById('dT1');
  const dT2 = document.getElementById('dT2');
  const progressEl = document.getElementById('progress');
  const scoreEl = document.getElementById('dailyScore');
  const namesDatalist = document.getElementById('namesListDaily');
  const notif = document.getElementById('notifications');
  const afterDone = document.getElementById('afterDone');
  const shareArea = document.getElementById('shareTextArea');

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

  // seed based on date YYYY-MM-DD
  function dateSeedStr(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
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
    const namesSet = new Set();
    pokemons.forEach(p => {
      if (p.NameFR) namesSet.add(p.NameFR);
      if (p.NameEN) namesSet.add(p.NameEN);
    });
    namesDatalist.innerHTML = '';
    Array.from(namesSet).forEach(n => {
      const o = document.createElement('option');
      o.value = n;
      namesDatalist.appendChild(o);
    });
  }

  function updateProgressUI() {
    progressEl.textContent = `${index + 1} / ${COUNT}`;
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

  // scoring: points for attempt (same as main game)
  const basePoints = 10;
  const hintPenalty = 2;
  function pointsForAttempt(a) {
    return Math.max(basePoints - a * hintPenalty, 0);
  }

  // stocke l'objet history complet dans le cookie
  function saveDailyCookie(historyObj) {
    try {
      setCookie(cookieName, JSON.stringify(historyObj), 3650);
    } catch (e) {
      console.error('Impossible de sauvegarder l\'historique daily', e);
    }
  }

  // renvoie l'objet history (map date -> { score, results }) ou null
  function loadDailyCookie() {
    const raw = getCookie(cookieName);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      // sécurité: s'assurer que c'est un objet
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      return null;
    } catch (e) { return null; }
  }
  
  // helper pour sauvegarder le résultat du jour dans l'historique
  function saveResultForToday(payload) {
    const dateKey = payload.date;
    const history = loadDailyCookie() || {};
    history[dateKey] = {
      score: payload.score,
      results: payload.results
    };
    saveDailyCookie(history);
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


  // advance to next pokemon (or finish)
  function nextPokemon() {
    index++;
    attempts = 0;
    hideReveal();
    clearHints();
    input().value = '';
    if (index >= COUNT) {
      finishDaily();
      return;
    }
    showCurrent();
    updateProgressUI();
  }

  // --- Adapter finishDaily pour utiliser l'historique ---
  function finishDaily() {
    // persist results into history map
    const payload = { date: dateSeedStr(), results, score };
    saveResultForToday(payload);

    // prepare share text
    const share = buildShareText(results, payload.date, score);
    shareArea.textContent = share;
    afterDone.classList.remove('hidden');

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
    nextPokemon();
  }

  function handleCorrect() {
    const pts = pointsForAttempt(attempts);
    score += pts;
    results.push({ outcome: 'win', attempts });
    showReveal(dailyList[index]);
    updateProgressUI();
    showNotification('+' + pts + ' points', 'success');
    // small delay then next
    setTimeout(nextPokemon, 700);
  }

  function showHintForAttempt(a) {
    switch (a) {
      case 1:
        addHint(`Type 1 : ${dailyList[index].Type1}`);
        break;
      case 2:
        addHint(`Type 2 : ${dailyList[index].getDisplayType2()}`);
        break;
      case 3:
        addHint(`Index : ${dailyList[index].Index}`);
        break;
      case 4:
        addHint(`Génération : ${dailyList[index].Generation}`);
        break;
      default:
        break;
    }
    // visual preview
    showNotification('Réponse correcte = +' + pointsForAttempt(attempts) + ' points', 'hint');
  }

  function submitGuess() {
    const val = input().value.trim();
    if (!val) return;
    const current = dailyList[index];
    if (current.matchesName(val)) {
      handleCorrect();
    } else {
      attempts++;
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
  function renderFinishedFromCookie(payload) {
    // payload.results array length may be <= COUNT
    const date = payload.date || dateSeedStr();
    const saved = payload;
    const share = buildShareText(saved.results, date, saved.score || 0);
    shareArea.textContent = share;
    afterDone.classList.remove('hidden');
    // show summary on top
    progressEl.textContent = `Terminé`;
    scoreEl.textContent = saved.score || 0;
    // disable controls
    input().disabled = true;
    document.getElementById('dailySubmit').disabled = true;
    document.getElementById('dailySkip').disabled = true;
    showImage(''); // keep blank or show last if desired
  }

  // show current pokemon (partial image)
  function showCurrent() {
    const p = dailyList[index];
    showImage(p ? p.Image : '');
    updateProgressUI();
  }

  // main init
  async function init() {
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
    const saved = loadDailyCookie();
    const today = dateSeedStr();
    if (saved && saved.date === today) {
      // already played today
      populateNamesList();
      renderFinishedFromCookie(saved);
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
    populateNamesList();
    showCurrent();
    updateProgressUI();
    bindButtons();
  }

  function bindButtons() {
    document.getElementById('dailySubmit').addEventListener('click', submitGuess);
    document.getElementById('dailySkip').addEventListener('click', () => {
      // reveal and mark as fail, then next
      showNotification('Passé — Pokémon révélé', 'hint');
      failCurrentAndAdvance();
    });
    document.getElementById('dailyInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitGuess();
    });
    document.getElementById('copyShare').addEventListener('click', () => {
      const txt = shareArea.textContent || '';
      if (!txt) return;
      navigator.clipboard?.writeText(txt).then(() => {
        showNotification('Copié dans le presse-papier', 'success');
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
