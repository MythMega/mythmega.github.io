// ui/custom_challenges/custom-play-ui.js
// Interface de la page custom_play.html :
//  - saisie d'un code (ou URL complète) si ?code absent
//  - décodage du code et affichage des infos du challenge
//  - jeu façon challenge.html (image des pieds, autocomplete, indices)
//  - écran final façon daily.html : URL à copier, erreurs, infos du challenge

const CustomPlayUI = (function () {
  const VIEWS = ['codeEntryView', 'invalidView', 'infoView', 'gameView', 'doneView'];
  let challengeInfo = null;
  let currentCode = null;
  let hintCount = 0;      // nombre d'indices déjà affichés sur le Pokémon courant

  const $ = function (id) { return document.getElementById(id); };

  function T(key, fallback) {
    return (typeof Translator !== 'undefined') ? Translator.get(key, fallback) : fallback;
  }

  function normalize(str) {
    return (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function getCookie(name) {
    const v = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
    return v ? decodeURIComponent(v.pop()) : null;
  }

  // Attendre que le système de traduction soit initialisé avant de rendre les
  // textes dynamiques (sinon Translator.get retombe sur les fallbacks français).
  function translatorReady() {
    return new Promise(function (resolve) {
      if (typeof Translator === 'undefined') { resolve(); return; }
      // Une clé connue du tronc commun n'est résolue qu'après Translator.init()
      if (Translator.get('common.backHome', null) !== null) { resolve(); return; }
      const start = Date.now();
      const timer = setInterval(function () {
        if (Translator.get('common.backHome', null) !== null || Date.now() - start > 4000) {
          clearInterval(timer);
          resolve();
        }
      }, 40);
    });
  }

  function showView(id) {
    VIEWS.forEach(function (v) {
      const el = $(v);
      if (el) el.classList.toggle('hidden', v !== id);
    });
  }

  function showNotification(message, type) {
    const notif = $('notifications');
    if (!notif) return;
    const n = document.createElement('div');
    n.className = 'notification';
    n.textContent = message;
    if (type === 'fail') n.style.background = '#491111';
    else if (type === 'hint') n.style.background = '#334155';
    else if (type === 'success') n.style.background = '#166534';
    notif.appendChild(n);
    setTimeout(function () {
      n.style.opacity = 0;
      try { notif.removeChild(n); } catch (e) {}
    }, 1600);
  }

  function copyText(text) {
    return navigator.clipboard?.writeText(text);
  }

  // ═══════════════ Chargement / décodage ═══════════════

  async function loadCode(raw) {
    const code = String(raw || '').trim();
    if (!code) {
      showNotification(T('customPlay.enterCodeError', 'Veuillez entrer un code ou une URL'), 'fail');
      return;
    }
    try {
      const data = await CustomChallengeCodec.decode(code);
      if (!data || !data.name || !Array.isArray(data.pokemons) || data.pokemons.length < 2) {
        showInvalid();
        return;
      }
      currentCode = code;
      challengeInfo = data;
      await CustomChallengeGame.loadPokemons();
      renderInfo();
      showView('infoView');
    } catch (e) {
      console.error('[CustomPlayUI] loadCode error', e);
      showInvalid();
    }
  }

  function showInvalid() {
    showView('invalidView');
  }

  function renderInfo() {
    $('infoName').textContent = challengeInfo.name;
    $('infoAuthor').textContent = challengeInfo.author || 'Trainer';
    $('infoCount').textContent = challengeInfo.pokemons.length + ' ' + T('customPlay.pokemonCount', 'Pokémon');
    $('infoRandom').textContent = challengeInfo.random
      ? T('customPlay.randomOrder', 'Ordre aléatoire en jeu')
      : T('customPlay.fixedOrder', 'Ordre tel que défini par le créateur');
  }

  // ═══════════════ Copie du JSON ═══════════════

  function buildChallengeJson() {
    const author = challengeInfo.author || 'Trainer';
    const name = challengeInfo.name;
    return {
      ID: 9999,
      Difficulty: 'Medium',
      Requirements: [],
      Tab: 'Custom',
      Name_En: name,
      Name_Fr: name,
      Desc_En: 'Custom Challenge.',
      Desc_Fr: 'Challenge Custom.',
      Additional_Info_Fr: 'Challenge custom proposé par ' + author,
      Additional_Info_En: 'Custom Challenge by ' + author,
      FeetList: (challengeInfo.pokemons || []).map(function (idx) { return String(idx); }),
      Rewards: [],
      MustHideIfUnavailable: true,
      Availabilities: []
    };
  }

  function copyChallengeJson() {
    if (!challengeInfo) return;
    const json = JSON.stringify(buildChallengeJson(), null, 4);
    copyText(json).then(function () {
      showNotification(T('daily.copied', 'Copié dans le presse-papier'), 'success');
    }, function () {
      showNotification(T('daily.copyFail', 'Impossible de copier'), 'fail');
    });
  }
// ═══════════════ Jeu ═══════════════

  function startGame() {
    CustomChallengeGame.start({
      author: challengeInfo.author,
      name: challengeInfo.name,
      random: challengeInfo.random,
      pokemons: challengeInfo.pokemons
    });
    renderGame();
    showView('gameView');
  }

  function renderFailedDisplay() {
    const failedEl = $('playFailedAttempts');
    if (!failedEl) return;
    const wrong = CustomChallengeGame.getCurrentWrong();
    if (!wrong.length) {
      failedEl.classList.add('hidden');
      failedEl.textContent = '';
      return;
    }
    failedEl.classList.remove('hidden');
    failedEl.textContent = T('customPlay.failedAttempts', 'Échecs') + ' : ' + wrong.join(', ');
  }

  function renderHints() {
    const hintsList = $('playHints');
    if (!hintsList) return;
    hintsList.innerHTML = '';
    hintCount = 0;
  }

  function addHintHTML(html) {
    const hintsList = $('playHints');
    if (!hintsList) return;
    const li = document.createElement('li');
    li.innerHTML = html;
    hintsList.appendChild(li);
    hintCount++;
  }

  function addHintText(text) {
    const hintsList = $('playHints');
    if (!hintsList) return;
    const li = document.createElement('li');
    li.textContent = text;
    hintsList.appendChild(li);
    hintCount++;
  }

  // Indice progressif (identique au mode challenge)
  function giveHint(attempt) {
    const p = CustomChallengeGame.getCurrentPokemon();
    if (!p) return;
    switch (attempt) {
      case 1: {
        const t1 = p.Type1 || '';
        const t2 = p.Type2 || '';
        let html = T('daily.types', 'Type(s)') + ' : ';
        html += '<span class="type-badge t-' + t1.toLowerCase() + '">' + T('types.' + t1.toLowerCase(), t1) + '</span>';
        if (t2) html += ' <span class="type-badge t-' + t2.toLowerCase() + '">' + T('types.' + t2.toLowerCase(), t2) + '</span>';
        addHintHTML(html);
        break;
      }
      case 2:
        addHintText(T('daily.index', 'Index') + ' : ' + p.Index + ' (' + T('daily.generation', 'Génération') + ' ' + p.Generation + ')');
        break;
      case 3:
        addHintText(T('daily.eggGroups', "Groupes d'oeuf") + ' : ' + p.getEggGroupsDisplay());
        break;
      case 4:
        addHintText(T('daily.category', 'Catégorie') + ' : ' + p.getCategoryDisplay());
        break;
      default:
        break;
    }
  }

  function renderGame() {
    if (CustomChallengeGame.isFinished()) {
      renderDone();
      return;
    }

    const p = CustomChallengeGame.getCurrentPokemon();
    if (!p) {
      renderDone();
      return;
    }

    $('playImg').src = p.Image || '';
    const prog = CustomChallengeGame.getProgress();
    $('playProgress').textContent = (prog.current + 1) + ' / ' + prog.total;
    $('playFails').textContent = T('customPlay.fails', 'Erreurs') + ' : ' + CustomChallengeGame.getTotalFails();
    $('playInput').value = '';
    renderHints();
    renderFailedDisplay();
  }
// ═══════════════ Autocomplete ═══════════════

  function closeDropdown() {
    const dd = $('playDropdown');
    if (dd) dd.remove();
  }

  function buildDropdown(needle) {
    let dd = $('playDropdown');
    if (dd) dd.remove();

    if (!needle) return;
    const input = $('playInput');
    const wrapper = input.closest('.autocomplete-wrap');
    if (!wrapper) return;

    dd = document.createElement('div');
    dd.id = 'playDropdown';
    dd.className = 'autocomplete-dropdown';

    let count = 0;
    const pokemons = CustomChallengeGame.getAllPokemons();
    for (let i = 0; i < pokemons.length && count < 40; i++) {
      const p = pokemons[i];
      const fr = p.NameFR || '';
      const en = p.NameEN || '';
      let name = null;
      if (fr && normalize(fr).includes(needle)) name = fr;
      else if (en && normalize(en).includes(needle)) name = en;
      if (!name) continue;

      const item = document.createElement('div');
      item.className = 'autocomplete-item';
      item.textContent = name;
      item.addEventListener('mousedown', function (e) {
        e.preventDefault();
        closeDropdown();
        input.value = name;
        submitGuess();
      });
      dd.appendChild(item);
      count++;
    }

    dd.classList.toggle('hidden', count === 0);
    wrapper.style.position = 'relative';
    wrapper.appendChild(dd);
  }

  // ═══════════════ Soumission des réponses ═══════════════

  function isValidName(val) {
    if (!val) return false;
    const v = normalize(val.trim());
    return CustomChallengeGame.getAllPokemons().some(function (p) {
      return normalize(p.NameFR) === v || normalize(p.NameEN) === v;
    });
  }

  function triggerInvalidInput() {
    const input = $('playInput');
    input.classList.remove('shake');
    void input.offsetWidth;
    input.classList.add('shake');
    showNotification(T('daily.invalidName', 'Nom invalide'), 'fail');
    setTimeout(function () { input.classList.remove('shake'); }, 500);
  }

  function submitGuess() {
    closeDropdown();
    const input = $('playInput');
    const val = input.value.trim();
    if (!val) return;

    if (!isValidName(val)) {
      triggerInvalidInput();
      return;
    }

    const wrong = CustomChallengeGame.getCurrentWrong();
    if (wrong.includes(val)) {
      showNotification(T('daily.alreadyTried', 'Déjà essayé'), 'hint');
      return;
    }

    const result = CustomChallengeGame.checkAnswer(val);

    if (result.correct) {
      const lang = (typeof Translator !== 'undefined') ? Translator.getLanguage() : 'fr';
      const name = lang === 'fr' ? (result.pokemon.NameFR || result.pokemon.NameEN) : (result.pokemon.NameEN || result.pokemon.NameFR);
      showNotification(T('customPlay.found', 'Pokémon trouvé : ') + name, 'success');
      input.value = '';
      if (result.finished) {
        renderDone();
      } else {
        renderGame();
      }
    } else {
      showNotification(T('customPlay.tryAgainMsg', 'Essaie encore'), 'fail');
      input.value = '';
      giveHint(hintCount + 1);
      renderFailedDisplay();
    }
  }

  function bindGameEvents() {
    const input = $('playInput');
    const submit = $('playSubmit');

    submit.addEventListener('click', submitGuess);

    input.addEventListener('input', function () {
      const needle = normalize(input.value.trim());
      buildDropdown(needle);
    });

    input.addEventListener('blur', function () {
      setTimeout(closeDropdown, 150);
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeDropdown();
      if (e.key === 'Enter') {
        closeDropdown();
        submitGuess();
      }
    });
  }
// ═══════════════ Écran de fin ═══════════════

  function buildShareText() {
    const data = CustomChallengeGame.getChallenge();
    const perSlot = CustomChallengeGame.getPerSlot();
    const fails = CustomChallengeGame.getTotalFails();
    const order = CustomChallengeGame.getOrder();

    const emojis = perSlot.map(function (r) {
      if (!r || r.outcome !== 'win') return '🟥';
      return r.attempts === 0 ? '🟩' : '🟧';
    }).join('');

    let text = 'Pokefeet Custom — ' + data.name + ' — ' + data.author +
      ' — ' + order.length + ' ' + T('customPlay.pokemonCount', 'Pokémon') + ' — ' + fails + ' ' + T('customPlay.errorCount', 'erreur(s)') + '\n' +
      emojis;

    // Liste des mauvaises réponses par round
    const wrongLines = [];
    perSlot.forEach(function (r, i) {
      if (r && r.wrong && r.wrong.length) {
        wrongLines.push('R' + (i + 1) + ' : ' + r.wrong.map(function (g) { return '||' + g + '||'; }).join(' '));
      }
    });
    if (wrongLines.length) text += '\n' + wrongLines.join('\n');

    const url = buildChallengeUrl();
    if (url) text += '\n' + url;
    return text;
  }

  function buildChallengeUrl() {
    if (!currentCode || !challengeInfo) return null;
    const clean = String(currentCode).replace(/^.*[?&]code=/, '');
    // URL complète (origine + chemin de la page courante), pas seulement le nom du fichier
    const base = window.location.origin + window.location.pathname;
    return base + '?code=' + clean;
  }

  function renderDone() {
    const data = CustomChallengeGame.getChallenge();
    const order = CustomChallengeGame.getOrder();

    $('doneName').textContent = data.name;
    $('doneAuthor').textContent = data.author;
    $('doneCount').textContent = order.length;
    $('doneFails').textContent = CustomChallengeGame.getTotalFails();
    $('doneUrl').value = buildChallengeUrl() || '';

    // Images complètes des Pokémon
    const imgWrap = $('doneFullImages');
    imgWrap.innerHTML = '';
    order.forEach(function (p) {
      const img = document.createElement('img');
      img.src = p.FullImage || p.Image || '';
      img.alt = p.NameFR || p.NameEN || '';
      img.loading = 'lazy';
      imgWrap.appendChild(img);
    });

    // Texte de partage
    $('doneShare').textContent = buildShareText();

    showView('doneView');
  }

  function bindDoneEvents() {
    $('copyUrlBtn').addEventListener('click', function () {
      const url = $('doneUrl').value;
      if (!url) return;
      copyText(url).then(function () {
        showNotification(T('daily.copied', 'Copié dans le presse-papier'), 'success');
      }, function () {
        showNotification(T('daily.copyFail', 'Impossible de copier'), 'fail');
      });
    });

    $('copyShareBtn').addEventListener('click', function () {
      const text = $('doneShare').textContent || '';
      if (!text) return;
      copyText(text).then(function () {
        showNotification(T('daily.copied', 'Copié dans le presse-papier'), 'success');
      }, function () {
        showNotification(T('daily.copyFail', 'Impossible de copier'), 'fail');
      });
    });

    $('replayBtn').addEventListener('click', function () {
      if (challengeInfo) {
        startGame();
      } else {
        window.location.href = 'custom_play.html';
      }
    });

    $('backHomeBtn').addEventListener('click', function () {
      window.location.href = 'custom.html';
    });
  }

  // ═══════════════ Init & événements génériques ═══════════════

  function bindCodeEntry() {
    $('loadCodeBtn').addEventListener('click', function () {
      loadCode($('codeInput').value);
    });
    $('codeInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') loadCode($('codeInput').value);
    });
    $('invalidLoadBtn').addEventListener('click', function () {
      loadCode($('invalidCodeInput').value);
    });
    $('invalidCodeInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') loadCode($('invalidCodeInput').value);
    });
    $('playBtn').addEventListener('click', startGame);
    $('copyJsonBtn').addEventListener('click', copyChallengeJson);
  }

  async function init() {
    bindCodeEntry();
    bindDoneEvents();
    bindGameEvents();
    await translatorReady();

    const params = new URLSearchParams(window.location.search);
    const codeParam = params.get('code');
    if (codeParam) {
      await loadCode(codeParam);
    } else {
      showView('codeEntryView');
    }
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', function () {
  CustomPlayUI.init();
});