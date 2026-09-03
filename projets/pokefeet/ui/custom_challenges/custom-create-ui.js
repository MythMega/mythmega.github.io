// ui/custom_challenges/custom-create-ui.js
// Interface de la page custom_create.html :
//  - recherche / sélection des Pokémon dans la liste complète
//  - séquence construite par drag & drop (ou ajout par clic)
//  - tri par index / ordre aléatoire
//  - nom, auteur (cookie pk_pseudo) et option d'ordre aléatoire en jeu
//  - génération d'une URL custom_play.html?code=<code>

const CustomCreateUI = (function () {
  let pokemons = [];       // tous les Pokémon (instances de Pokemon)
  let selected = [];       // liste ordonnée des index sélectionnés

  // état du drag & drop
  let dragOriginIndex = null;
  let draggingSlot = -1;

  const $ = function (id) { return document.getElementById(id); };

  function getCookie(name) {
    const v = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
    return v ? decodeURIComponent(v.pop()) : null;
  }

  function T(key, fallback) {
    return (typeof Translator !== 'undefined') ? Translator.get(key, fallback) : fallback;
  }

  // Attendre que le système de traduction soit initialisé avant de rendre les
  // textes dynamiques (sinon Translator.get retombe sur les fallbacks français).
  function translatorReady() {
    return new Promise(function (resolve) {
      if (typeof Translator === 'undefined') { resolve(); return; }
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

  function normalize(str) {
    return (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function getSelectedPokemon(index) {
    return pokemons.find(function (p) { return String(p.Index) === String(index); }) || null;
  }

  function isSelected(index) {
    return selected.some(function (idx) { return String(idx) === String(index); });
  }

  // ═══════════════ Picker (liste de choix) ═══════════════

  function renderPicker() {
    const container = $('pokemonPicker');
    if (!container) return;
    container.innerHTML = '';
    const needle = normalize($('createSearch').value);

    let matching = pokemons;
    if (needle) {
      matching = pokemons.filter(function (p) {
        return normalize(p.NameFR).includes(needle) ||
               normalize(p.NameEN).includes(needle) ||
               normalize(p.Index).includes(needle);
      });
    }

    if (matching.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'custom-picker-empty';
      empty.textContent = T('customCreate.noResults', 'Aucun Pokémon trouvé');
      container.appendChild(empty);
      $('pickerCount').textContent = '0';
      return;
    }

    matching.forEach(function (p) {
      const item = document.createElement('div');
      item.className = 'custom-pick-item' + (isSelected(p.Index) ? ' selected' : '');
      item.setAttribute('data-index', p.Index);
      item.title = p.NameFR + ' — #' + p.Index;

      const img = document.createElement('img');
      img.src = p.FullImage || p.Image || '';
      img.alt = p.NameFR || p.NameEN || '';
      img.loading = 'lazy';

      const name = document.createElement('span');
      name.className = 'custom-pick-name';
      name.textContent = p.NameFR || p.NameEN || '?';

      const num = document.createElement('span');
      num.className = 'custom-pick-idx';
      num.textContent = '#' + p.Index;

      item.appendChild(img);
      item.appendChild(name);
      item.appendChild(num);
      container.appendChild(item);
    });

    $('pickerCount').textContent = matching.length;
  }

  function addPokemon(index) {
    if (isSelected(index)) return;
    selected.push(String(index));
    renderPicker();
    renderSequence();
    updateGenerate();
  }
// ═══════════════ Séquence sélectionnée ═══════════════

  function renderSequence() {
    const container = $('sequenceList');
    if (!container) return;
    container.innerHTML = '';

    $('sequenceCount').textContent = selected.length;

    selected.forEach(function (idx, slot) {
      const p = getSelectedPokemon(idx);
      if (!p) return;
      const item = document.createElement('div');
      item.className = 'custom-seq-item' + (slot === draggingSlot ? ' dragging' : '');
      item.setAttribute('data-slot', slot);
      item.draggable = true;

      const handle = document.createElement('span');
      handle.className = 'custom-seq-handle';
      handle.textContent = '⠿';

      const img = document.createElement('img');
      img.src = p.FullImage || p.Image || '';
      img.alt = p.NameFR || p.NameEN || '';
      img.loading = 'lazy';

      const info = document.createElement('span');
      info.className = 'custom-seq-info';
      const num = document.createElement('strong');
      num.textContent = '#' + p.Index;
      const name = document.createElement('span');
      name.textContent = p.NameFR || p.NameEN || '?';
      info.appendChild(num);
      info.appendChild(name);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'custom-seq-remove';
      remove.title = 'Retirer';
      remove.textContent = '✕';
      remove.addEventListener('click', function (e) {
        e.stopPropagation();
        removePokemonAt(slot);
      });

      item.appendChild(handle);
      item.appendChild(img);
      item.appendChild(info);
      item.appendChild(remove);
      container.appendChild(item);
    });
  }

  function removePokemonAt(slot) {
    if (slot < 0 || slot >= selected.length) return;
    selected.splice(slot, 1);
    renderPicker();
    renderSequence();
    updateGenerate();
  }

  // ═══════════════ Drag & drop ═══════════════

  function reorderSequence(from, to) {
    if (from < 0 || to < 0 || from >= selected.length || to >= selected.length || from === to) return;
    const item = selected.splice(from, 1)[0];
    selected.splice(to, 0, item);
    renderSequence();
  }

  function bindDragDrop() {
    const container = $('sequenceList');
    if (!container) return;

    container.addEventListener('dragstart', function (e) {
      const slot = parseInt(e.target.getAttribute('data-slot'), 10);
      if (isNaN(slot)) return;
      draggingSlot = slot;
      dragOriginIndex = slot;
      e.dataTransfer.effectAllowed = 'move';
      try {
        e.dataTransfer.setData('text/plain', String(slot));
      } catch (err) { /* ignore */ }
    });

    container.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });

    container.addEventListener('dragenter', function (e) {
      const slot = parseInt(e.target.getAttribute('data-slot'), 10);
      if (isNaN(slot) || slot === draggingSlot) return;
      e.target.classList.add('drag-over');
    });

    container.addEventListener('dragleave', function (e) {
      if (e.target.classList) e.target.classList.remove('drag-over');
    });

    container.addEventListener('drop', function (e) {
      e.preventDefault();
      const to = parseInt(e.target.getAttribute('data-slot'), 10);
      if (e.target.classList) e.target.classList.remove('drag-over');
      if (!isNaN(to) && dragOriginIndex !== null) {
        reorderSequence(dragOriginIndex, to);
      }
      draggingSlot = -1;
      dragOriginIndex = null;
      renderSequence();
    });

    container.addEventListener('dragend', function () {
      draggingSlot = -1;
      dragOriginIndex = null;
      renderSequence();
    });
  }

  // ═══════════════ Tris ═══════════════

  function sortByIndex() {
    selected.sort(function (a, b) {
      return String(a).localeCompare(String(b), undefined, { numeric: true });
    });
    renderSequence();
    renderPicker();
  }

  function randomizeSequence() {
    for (let i = selected.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = selected[i]; selected[i] = selected[j]; selected[j] = tmp;
    }
    renderSequence();
    renderPicker();
  }
// ═══════════════ Génération ═══════════════

  function updateGenerate() {
    const nameOk = $('createName').value.trim().length > 0;
    const countOk = selected.length >= 2;

    const hint = $('generateHint');

    if (!nameOk && !countOk) hint.textContent = T('customCreate.requiresNameAndCount', 'Nom requis et au moins 2 Pokémon');
    else if (!nameOk) hint.textContent = T('customCreate.requiresName', 'Nom requis');
    else if (!countOk) hint.textContent = T('customCreate.requiresCount', 'Au moins 2 Pokémon requis');
    else hint.textContent = '';

    hint.style.display = hint.textContent ? '' : 'none';
    $('generateBtn').disabled = !(nameOk && countOk);
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
    }, 2000);
  }

  async function generate() {
    const name = $('createName').value.trim();
    if (!name || selected.length < 2) {
      showNotification(T('customCreate.generateMissing', 'Nom du challenge et 2 Pokémon au minimum requis'), 'fail');
      return;
    }
    const author = $('createAuthor').value.trim() || 'Trainer';
    const random = $('createRandom').checked;

    $('generateBtn').disabled = true;
    try {
      const code = await CustomChallengeCodec.encode({ author, name, random, pokemons: selected });
      const url = 'custom_play.html?code=' + code;

      $('resultUrl').value = url;
      $('customResultCard').classList.remove('hidden');
      showNotification(T('customCreate.generated', 'Challenge généré !'), 'success');
    } catch (e) {
      console.error('[CustomCreateUI] generate error', e);
      showNotification(T('customCreate.generateError', 'Erreur lors de la génération du code'), 'fail');
    } finally {
      updateGenerate();
    }
  }

  // ═══════════════ Init ═══════════════

  async function loadPokemons() {
    try {
      const res = await fetch('data/pokemons.json');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const arr = await res.json();
      pokemons = arr.map(function (p) { return new Pokemon(p); });
    } catch (e) {
      console.error('[CustomCreateUI] Error loading pokemons:', e);
      pokemons = [];
    }
  }

  function copyText(text) {
    return navigator.clipboard?.writeText(text);
  }

  function bindEvents() {
    // recherche
    $('createSearch').addEventListener('input', renderPicker);

    // ajout par clic sur le picker
    $('pokemonPicker').addEventListener('click', function (e) {
      const item = e.target.closest('.custom-pick-item');
      if (!item) return;
      addPokemon(item.getAttribute('data-index'));
    });

    bindDragDrop();

    // tris
    $('sortIndexBtn').addEventListener('click', sortByIndex);
    $('shuffleBtn').addEventListener('click', randomizeSequence);

    // nom / génération
    $('createName').addEventListener('input', updateGenerate);
    $('generateBtn').addEventListener('click', generate);

    // copie de l'URL générée
    $('copyUrlBtn').addEventListener('click', function () {
      const url = $('resultUrl').value;
      if (!url) return;
      copyText(url).then(function () {
        showNotification(T('daily.copied', 'Copié dans le presse-papier'), 'success');
      }, function () {
        showNotification(T('daily.copyFail', 'Impossible de copier'), 'fail');
      });
    });

    // ouverture du challenge
    $('openChallengeBtn').addEventListener('click', function () {
      const url = $('resultUrl').value;
      if (url) window.location.href = url;
    });

    // régénérer (masque le résultat)
    $('regenerateBtn').addEventListener('click', function () {
      $('customResultCard').classList.add('hidden');
    });
  }

  async function init() {
    const pseudo = getCookie('pk_pseudo');
    $('createAuthor').value = pseudo || 'Trainer';
    $('createRandom').checked = false;
    await translatorReady();
    await loadPokemons();
    renderPicker();
    renderSequence();
    updateGenerate();
    bindEvents();
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', function () {
  CustomCreateUI.init();
});