/* ============================================================
   Cat Logic Puzzle — game.js
   1. Logique pure du puzzle (génération des régions, solveur, validation)
   2. Rendu et interaction de la page game.html
   La logique pure est exposée dans window.CatGame pour les tests.
   ============================================================ */
(function (global) {
  'use strict';

  var App = global.CatApp;
  var MIN_SIZE = 4;         // en dessous de 4×4 il n'existe aucune solution
  var MAX_SIZE = 15;
  var DEFAULT_SIZE = 5;
  var GEN_BUDGET_MS = 350;  // temps maximal de recherche d'une grille bien contrainte
  var MAX_ATTEMPTS = 400;
  var SOLUTION_CAP = 6;     // nombre de solutions recherchées avant d'abandonner une grille

  /* ============ 1. LOGIQUE PURE ============ */

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function random(n) { return Math.floor(Math.random() * n); }

  function neighbors4(cell, n, out) {
    var list = out || [];
    list.length = 0;
    var row = Math.floor(cell / n);
    var col = cell % n;
    if (row > 0) list.push(cell - n);
    if (row < n - 1) list.push(cell + n);
    if (col > 0) list.push(cell - 1);
    if (col < n - 1) list.push(cell + 1);
    return list;
  }

  function neighbors8(cell, n, out) {
    var list = out || [];
    list.length = 0;
    var row = Math.floor(cell / n);
    var col = cell % n;
    for (var dr = -1; dr <= 1; dr++) {
      for (var dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        var r = row + dr;
        var c = col + dc;
        if (r < 0 || c < 0 || r >= n || c >= n) continue;
        list.push(r * n + c);
      }
    }
    return list;
  }

  function shuffle(list) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = random(i + 1);
      var tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  /* Solution de référence : une permutation. Quand la règle 3 est active
     (enforceTouch), deux chats placés sur des lignes voisines diffèrent
     d'au moins 2 en colonne (les chats ne se touchent pas, même en diagonale). */
  function randomSolution(n, enforceTouch) {
    var cols = new Array(n);
    var used = new Array(n);
    for (var i = 0; i < n; i++) used[i] = false;

    function place(row) {
      if (row === n) return true;
      var order = [];
      for (var c = 0; c < n; c++) order.push(c);
      shuffle(order);
      for (var k = 0; k < order.length; k++) {
        var col = order[k];
        if (used[col]) continue;
        if (enforceTouch && row > 0 && Math.abs(cols[row - 1] - col) < 2) continue;
        used[col] = true;
        cols[row] = col;
        if (place(row + 1)) return true;
        used[col] = false;
      }
      return false;
    }

    return place(0) ? cols : null;
  }

  /* Régions colorées : croissance aléatoire et équilibrée depuis les chats
     de la solution (une région = un chat). */
  function growRegions(n, solution) {
    var total = n * n;
    var owner = new Int32Array(total);
    var sizes = new Int32Array(n);
    var frontiers = [];
    var scratch = [];
    var r;
    for (r = 0; r < n; r++) frontiers.push([]);
    for (r = 0; r < total; r++) owner[r] = -1;

    function addFrontier(region, cell) {
      var list = neighbors4(cell, n, scratch);
      for (var i = 0; i < list.length; i++) frontiers[region].push(list[i]);
    }

    for (r = 0; r < n; r++) {
      var seed = r * n + solution[r];
      owner[seed] = r;
      sizes[r] = 1;
      addFrontier(r, seed);
    }

    var assigned = n;
    while (assigned < total) {
      var bestSize = Infinity;
      var candidates = [];
      for (r = 0; r < n; r++) {
        var frontier = frontiers[r];
        while (frontier.length && owner[frontier[frontier.length - 1]] !== -1) frontier.pop();
        if (!frontier.length) continue;
        if (sizes[r] < bestSize) {
          bestSize = sizes[r];
          candidates.length = 0;
          candidates.push(r);
        } else if (sizes[r] === bestSize) {
          candidates.push(r);
        }
      }
      if (!candidates.length) return null; // ne devrait jamais arriver

      var region = candidates[random(candidates.length)];
      var list = frontiers[region];
      var cell = -1;
      while (list.length) {
        var pick = list.splice(random(list.length), 1)[0];
        if (owner[pick] === -1) { cell = pick; break; }
      }
      if (cell === -1) continue;

      owner[cell] = region;
      sizes[region]++;
      assigned++;
      addFrontier(region, cell);
    }
    return { owner: owner, sizes: sizes };
  }

  function isConnected(cells, n) {
    if (cells.length <= 1) return true;
    var inRegion = {};
    var i;
    for (i = 0; i < cells.length; i++) inRegion[cells[i]] = true;
    var seen = {};
    var stack = [cells[0]];
    seen[cells[0]] = true;
    var count = 1;
    var scratch = [];
    while (stack.length) {
      var cell = stack.pop();
      var list = neighbors4(cell, n, scratch);
      for (i = 0; i < list.length; i++) {
        var next = list[i];
        if (inRegion[next] && !seen[next]) {
          seen[next] = true;
          count++;
          stack.push(next);
        }
      }
    }
    return count === cells.length;
  }

  /* Rééquilibrage : déplace des cases d'une région trop grande vers une voisine
     trop petite, sans casser la connexité ni sortir les chats de leur région. */
  function rebalance(n, owner, sizes, seedSet) {
    var total = n * n;
    var scratch = [];
    var guard = 0;
    var a, i, j, k, r;

    function cellsOf(region) {
      var cells = [];
      for (var c = 0; c < total; c++) if (owner[c] === region) cells.push(c);
      return cells;
    }

    while (guard++ < 4 * total) {
      var overfull = -1;
      for (r = 0; r < n; r++) {
        if (sizes[r] > n) { overfull = r; break; }
      }
      if (overfull === -1) return true;

      var progress = false;
      for (a = overfull; a < n && !progress; a++) {
        if (sizes[a] <= n) continue;
        var cellsA = cellsOf(a);
        for (i = 0; i < cellsA.length && !progress; i++) {
          var cell = cellsA[i];
          if (seedSet[cell]) continue;
          var target = -1;
          var targetSize = Infinity;
          var list = neighbors4(cell, n, scratch);
          for (k = 0; k < list.length; k++) {
            var other = owner[list[k]];
            if (other === -1 || other === a) continue;
            if (sizes[other] < n && sizes[other] < targetSize) {
              targetSize = sizes[other];
              target = other;
            }
          }
          if (target === -1) continue;

          var rest = [];
          for (j = 0; j < cellsA.length; j++) if (cellsA[j] !== cell) rest.push(cellsA[j]);
          if (!isConnected(rest, n)) continue;

          owner[cell] = target;
          sizes[a]--;
          sizes[target]++;
          progress = true;
        }
      }
      if (!progress) return false;
    }
    return false;
  }

  /* Solveur : compte les solutions (une par ligne/colonne/région, et sans
     contact quand la règle 3 est active).
     cap limite le comptage, nodeLimit protège des grilles trop coûteuses. */
  function countSolutions(n, regionOf, cap, nodeLimit, enforceTouch) {
    var maxSolutions = cap || 2;
    var maxNodes = nodeLimit || 400000;
    var colUsed = new Uint8Array(n);
    var regUsed = new Uint8Array(n);
    var cols = new Int32Array(n);
    var count = 0;
    var nodes = 0;
    var aborted = false;

    function place(row) {
      if (aborted) return true;
      if (++nodes > maxNodes) { aborted = true; return true; }
      if (row === n) { count++; return count >= maxSolutions; }
      for (var c = 0; c < n; c++) {
        if (colUsed[c]) continue;
        var region = regionOf[row * n + c];
        if (regUsed[region]) continue;
        if (enforceTouch && row > 0 && Math.abs(cols[row - 1] - c) < 2) continue;
        cols[row] = c;
        colUsed[c] = 1;
        regUsed[region] = 1;
        var stop = place(row + 1);
        colUsed[c] = 0;
        regUsed[region] = 0;
        if (stop) return true;
      }
      return false;
    }

    place(0);
    return { count: count, nodes: nodes, aborted: aborted };
  }

  function groupByRegion(n, regionOf) {
    var cells = [];
    var i;
    for (i = 0; i < n; i++) cells.push([]);
    for (i = 0; i < n * n; i++) cells[regionOf[i]].push(i);
    return cells;
  }

  function layoutIsSound(n, owner, sizes) {
    var groups = groupByRegion(n, owner);
    for (var r = 0; r < n; r++) {
      if (sizes[r] < 2) return false;                  // région trop petite
      if (Math.abs(sizes[r] - n) > 2) return false;    // régions trop inégales
      if (!isConnected(groups[r], n)) return false;    // région en plusieurs morceaux
    }
    return true;
  }

  function makeLayout(n, enforceTouch) {
    for (var attempt = 0; attempt < 60; attempt++) {
      var solution = randomSolution(n, enforceTouch);
      if (!solution) continue;
      var grown = growRegions(n, solution);
      if (!grown) continue;

      var seedSet = {};
      for (var r = 0; r < n; r++) seedSet[r * n + solution[r]] = true;

      rebalance(n, grown.owner, grown.sizes, seedSet);
      if (!layoutIsSound(n, grown.owner, grown.sizes)) continue;

      return { size: n, solution: solution, regionOf: grown.owner, sizes: grown.sizes };
    }
    return null;
  }

  /* Plafond du comptage de solutions : sur les petites grilles on cherche à
     savoir s'il n'y a qu'une solution ; sur les grandes grilles (où l'unicité
     n'est pas atteignable avec des régions aléatoires) on détecte simplement
     s'il existe une alternative, ce qui est bien plus rapide. */
  function solutionCap(n) {
    return n <= 8 ? SOLUTION_CAP : 2;
  }

  /* Écart entre la plus petite et la plus grande région (0 = parfaitement égal). */
  function sizeDeviation(n, sizes) {
    var lo = Infinity;
    var hi = -Infinity;
    for (var r = 0; r < n; r++) {
      if (sizes[r] < lo) lo = sizes[r];
      if (sizes[r] > hi) hi = sizes[r];
    }
    return hi - lo;
  }

  /* Cherche dans le budget imparti la meilleure grille possible.
     Critères, par ordre d'importance :
       1. le moins de solutions possible (1 = solution unique, idéal) ;
       2. des régions de tailles aussi égales que possible.
     Toutes les grilles produites sont jouables et ont au moins une solution. */
  function generatePuzzle(n, budgetMs, enforceTouch) {
    var deadline = Date.now() + (budgetMs || GEN_BUDGET_MS);
    var best = null;
    var bestScore = Infinity;
    var fallback = null;
    var attempts = 0;

    while (Date.now() < deadline && attempts < MAX_ATTEMPTS) {
      attempts++;
      var layout = makeLayout(n, enforceTouch);
      if (!layout) continue;
      if (!fallback) fallback = layout;

      var result = countSolutions(n, layout.regionOf, solutionCap(n), 150000, enforceTouch);
      if (result.aborted) continue;

      // count === solutionCap(n) signifie « au moins ce nombre de solutions »
      layout.solutions = result.count;
      layout.deviation = sizeDeviation(n, layout.sizes);
      layout.attempts = attempts;

      if (result.count === 1 && layout.deviation === 0) return layout; // grille idéale

      var score = result.count * 100 + layout.deviation;
      if (score < bestScore) {
        bestScore = score;
        best = layout;
      }
    }

    var chosen = best || fallback;
    if (chosen && chosen.solutions === undefined) {
      chosen.solutions = 0;
      chosen.deviation = sizeDeviation(n, chosen.sizes);
      chosen.attempts = attempts;
    }
    return chosen;
  }

  /* Couleurs : teintes réparties pour que deux régions voisines diffèrent. */
  function hueDistance(a, b) {
    var d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  function assignHues(n, regionOf) {
    var total = n * n;
    var neighbors = [];
    var scratch = [];
    var i, r, k;

    for (r = 0; r < n; r++) neighbors.push({});
    for (i = 0; i < total; i++) {
      var list = neighbors4(i, n, scratch);
      for (k = 0; k < list.length; k++) {
        var other = regionOf[list[k]];
        if (other !== regionOf[i]) neighbors[regionOf[i]][other] = true;
      }
    }

    var order = [];
    for (r = 0; r < n; r++) order.push(r);
    order.sort(function (x, y) {
      return Object.keys(neighbors[y]).length - Object.keys(neighbors[x]).length;
    });

    var palette = [];
    for (i = 0; i < 24; i++) palette.push((i * 15 + 6) % 360);

    var assigned = new Array(n);
    for (i = 0; i < n; i++) assigned[i] = -1;

    for (i = 0; i < order.length; i++) {
      var region = order[i];
      var bestHue = palette[0];
      var bestScore = -1;
      for (var p = 0; p < palette.length; p++) {
        var hue = palette[p];
        var score = 360;
        for (var key in neighbors[region]) {
          var neighborRegion = parseInt(key, 10);
          if (assigned[neighborRegion] === -1) continue;
          var d = hueDistance(hue, assigned[neighborRegion]);
          if (d < score) score = d;
        }
        if (score > bestScore) {
          bestScore = score;
          bestHue = hue;
        }
      }
      assigned[region] = bestHue;
    }
    return assigned;
  }

  function regionColors(n, regionOf, theme) {
    var hues = assignHues(n, regionOf);
    var dark = theme === 'dark';
    return hues.map(function (hue) {
      return dark ? 'hsl(' + hue + ', 30%, 36%)' : 'hsl(' + hue + ', 62%, 84%)';
    });
  }

  /* Règle violée si on posait un chat sur cette case (null = placement légal).
     enforceTouch active la règle 3 : pas de contact, même en diagonale. */
  function violationFor(n, regionOf, cats, index, enforceTouch) {
    var row = Math.floor(index / n);
    var col = index % n;
    for (var i = 0; i < cats.length; i++) {
      var cell = cats[i];
      var r = Math.floor(cell / n);
      var c = cell % n;
      if (r === row) return 'error_row';
      if (c === col) return 'error_col';
      if (regionOf[cell] === regionOf[index]) return 'error_region';
      if (enforceTouch && Math.abs(r - row) <= 1 && Math.abs(c - col) <= 1) return 'error_touch';
    }
    return null;
  }

  /* Vérification complète des règles (lignes, colonnes, régions, et contacts
     quand la règle 3 est active). */
  function isSolved(n, regionOf, cats, enforceTouch) {
    if (cats.length !== n) return false;
    var rows = {};
    var cols = {};
    var regions = {};
    var i, j;
    for (i = 0; i < cats.length; i++) {
      var cell = cats[i];
      var r = Math.floor(cell / n);
      var c = cell % n;
      var g = regionOf[cell];
      if (rows[r] || cols[c] || regions[g]) return false;
      rows[r] = cols[c] = regions[g] = true;
      if (enforceTouch) {
        for (j = i + 1; j < cats.length; j++) {
          var other = cats[j];
          var r2 = Math.floor(other / n);
          var c2 = other % n;
          if (Math.abs(r2 - r) <= 1 && Math.abs(c2 - c) <= 1) return false;
        }
      }
    }
    return true;
  }

  /* ============ 2. PAGE DE JEU ============ */

  var LEVEL_KEYS = ['easy', 'medium', 'hard', 'custom'];
  var DIFFICULTY_SIZES = { easy: 5, medium: 7, hard: 11 };
  var CAT_ICON = 'assets/img/cat_icon.png';
  var CAT_ICON_ANGRY = 'assets/img/cat_icon_angry.png'; // Mode Chat Fâché

  var state = {
    size: DEFAULT_SIZE,
    difficulty: 'custom',
    angry: false,           // Mode Chat Fâché : règle 3 active (chats non adjacents)
    regionOf: null,
    solution: null,
    colors: [],
    cats: [],
    catMap: {},
    cells: [],
    notes: true,
    solved: false,
    element: {}
  };

  function element(id) {
    return global.document ? global.document.getElementById(id) : null;
  }

  function readParams() {
    var sizeParam = App.getParam('size', null);
    var difficulty = String(App.getParam('difficulty', 'custom') || 'custom').toLowerCase();
    var fallbackSize = DIFFICULTY_SIZES[difficulty] || DEFAULT_SIZE;
    var size = sizeParam === null
      ? fallbackSize
      : App.clampInt(sizeParam, MIN_SIZE, MAX_SIZE, fallbackSize);
    var angryParam = String(App.getParam('angry', '') || '').toLowerCase();
    var angry = angryParam === '1' || angryParam === 'true' || angryParam === 'on';
    return { size: size, difficulty: difficulty, angry: angry };
  }

  function levelTitle() {
    var key = 'level_' + (LEVEL_KEYS.indexOf(state.difficulty) >= 0 ? state.difficulty : 'custom');
    return App.t('level_title', { level: App.t(key), size: state.size });
  }

  function buildCells() {
    var n = state.size;
    var total = n * n;
    var board = state.element.board;
    board.innerHTML = '';
    board.style.setProperty('--n', String(n));
    board.classList.remove('is-locked');

    var fragment = global.document.createDocumentFragment();
    state.cells = new Array(total);

    for (var i = 0; i < total; i++) {
      var row = Math.floor(i / n);
      var col = i % n;
      var cell = global.document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell';
      cell.setAttribute('data-index', String(i));
      if (row === 0 || state.regionOf[i - n] !== state.regionOf[i]) cell.classList.add('edge-t');
      if (col === 0 || state.regionOf[i - 1] !== state.regionOf[i]) cell.classList.add('edge-l');
      cell.style.setProperty('--c', state.colors[state.regionOf[i]]);
      cell.setAttribute('aria-label', App.t('cell_label', { row: row + 1, col: col + 1 }));
      fragment.appendChild(cell);
      state.cells[i] = cell;
    }
    board.appendChild(fragment);
  }

  function updateLabel(index, hasCat) {
    var cell = state.cells[index];
    if (!cell) return;
    var n = state.size;
    cell.setAttribute('aria-label', App.t(hasCat ? 'cell_label_cat' : 'cell_label', {
      row: Math.floor(index / n) + 1,
      col: (index % n) + 1
    }));
  }

  function updateCounter() {
    if (!state.element.counter) return;
    state.element.counter.textContent = App.t('counter', {
      placed: state.cats.length,
      total: state.size
    });
  }

  /* Repérage visuel des cases devenues impossibles (notes automatiques). */
  function updateMarks() {
    for (var i = 0; i < state.cells.length; i++) {
      var cell = state.cells[i];
      if (state.catMap[i]) {
        cell.classList.remove('is-invalid');
        continue;
      }
      var impossible = state.notes &&
        violationFor(state.size, state.regionOf, state.cats, i, state.angry) !== null;
      cell.classList.toggle('is-invalid', impossible);
    }
  }

  function placeCat(index) {
    var cell = state.cells[index];
    var img = global.document.createElement('img');
    img.className = 'cell__cat';
    img.src = state.angry ? CAT_ICON_ANGRY : CAT_ICON;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    cell.appendChild(img);
    cell.classList.remove('is-invalid');
    state.catMap[index] = true;
    state.cats.push(index);
    updateLabel(index, true);
  }

  function removeCat(index) {
    var cell = state.cells[index];
    var img = cell.querySelector('.cell__cat');
    if (img) cell.removeChild(img);
    delete state.catMap[index];
    var position = state.cats.indexOf(index);
    if (position >= 0) state.cats.splice(position, 1);
    updateLabel(index, false);
  }

  function flashError(cell) {
    cell.classList.remove('is-bad');
    // Force une nouvelle animation même si la classe vient d'être retirée.
    void cell.offsetWidth;
    cell.classList.add('is-bad');
    global.setTimeout(function () { cell.classList.remove('is-bad'); }, 420);
  }

  function refresh() {
    updateCounter();
    updateMarks();
    checkWin();
  }

  function handleCellTap(index) {
    if (state.solved || !state.cells[index]) return;

    if (state.catMap[index]) {
      removeCat(index);
      App.playSound('click');
      refresh();
      return;
    }

    var reason = violationFor(state.size, state.regionOf, state.cats, index, state.angry);
    if (reason) {
      App.playSound('error');
      flashError(state.cells[index]);
      App.toast(App.t(reason));
      return;
    }

    placeCat(index);
    App.playSound('click');
    refresh();
  }

  function checkWin() {
    if (state.solved) return;
    if (!isSolved(state.size, state.regionOf, state.cats, state.angry)) return;
    state.solved = true;
    App.playSound('victory');
    state.element.board.classList.add('is-locked');
    state.cats.forEach(function (index) {
      state.cells[index].classList.add('is-win');
    });
    global.setTimeout(function () {
      App.setModalOpen(state.element.winModal, true);
    }, 420);
  }

  function resetSameGrid() {
    App.setModalOpen(state.element.winModal, false);
    App.setModalOpen(state.element.helpModal, false);
    for (var i = 0; i < state.cells.length; i++) {
      var cell = state.cells[i];
      cell.classList.remove('is-win', 'is-invalid', 'is-bad');
      var img = cell.querySelector('.cell__cat');
      if (img) cell.removeChild(img);
      updateLabel(i, false);
    }
    state.cats = [];
    state.catMap = {};
    state.solved = false;
    state.element.board.classList.remove('is-locked');
    updateCounter();
    updateMarks();
  }

  /* Règle 3 (Mode Chat Fâché) : affiche/masque l'entrée correspondante dans
     les règles et adapte le texte d'aide sous les règles. */
  function syncRulesBox() {
    var e = state.element;
    if (e.ruleTouchItem) e.ruleTouchItem.hidden = !state.angry;
    if (e.ruleTouchItemHelp) e.ruleTouchItemHelp.hidden = !state.angry;
    var hint = App.t(state.angry ? 'rules_hint' : 'rules_hint_relaxed');
    if (e.rulesHint) e.rulesHint.textContent = hint;
    if (e.rulesHintHelp) e.rulesHintHelp.textContent = hint;
  }

  function syncNotesToggle() {
    var button = state.element.notesToggle;
    if (!button) return;
    button.setAttribute('aria-pressed', state.notes ? 'true' : 'false');
    button.setAttribute('title', App.t(state.notes ? 'notes_on' : 'notes_off'));
  }

  function showLoader(visible) {
    var e = state.element;
    if (e.loader) e.loader.hidden = !visible;
    if (e.boardWrap) e.boardWrap.hidden = visible;
    if (e.controls) e.controls.hidden = visible;
    if (e.legend) e.legend.hidden = visible;
  }

  function newPuzzle() {
    App.setModalOpen(state.element.winModal, false);
    showLoader(true);

    global.setTimeout(function () {
      var puzzle = generatePuzzle(state.size, GEN_BUDGET_MS, state.angry) ||
                   generatePuzzle(state.size, 1200, state.angry);
      if (!puzzle) {
        App.toast(App.t('loading'));
        return;
      }

      state.regionOf = puzzle.regionOf;
      state.solution = puzzle.solution;
      state.colors = regionColors(state.size, puzzle.regionOf, App.getTheme());
      state.cats = [];
      state.catMap = {};
      state.solved = false;

      state.element.levelTitle.textContent = levelTitle();
      buildCells();
      updateCounter();
      updateMarks();
      syncNotesToggle();
      showLoader(false);
    }, 30);
  }

  function bindEvents() {
    var e = state.element;

    e.board.addEventListener('click', function (event) {
      var target = event.target;
      if (!target || !target.closest) return;
      var cell = target.closest('.cell');
      if (!cell) return;
      handleCellTap(parseInt(cell.getAttribute('data-index'), 10));
    });

    if (e.replayBtn) {
      e.replayBtn.addEventListener('click', function () { resetSameGrid(); });
    }

    if (e.helpBtn) {
      e.helpBtn.addEventListener('click', function () { App.setModalOpen(e.helpModal, true); });
    }

    if (e.helpCloseBtn) {
      e.helpCloseBtn.addEventListener('click', function () { App.setModalOpen(e.helpModal, false); });
    }

    if (e.abandonBtn) {
      e.abandonBtn.addEventListener('click', function () {
        App.playSound('abandon');
        App.toast(App.t('abandon_message'), 1500);
        global.setTimeout(function () { global.location.href = 'play.html'; }, 450);
      });
    }

    if (e.notesToggle) {
      e.notesToggle.addEventListener('click', function () {
        state.notes = !state.notes;
        App.setNotes(state.notes);
        syncNotesToggle();
        updateMarks();
        App.toast(App.t(state.notes ? 'notes_on' : 'notes_off'), 1600);
      });
    }

    if (e.winReplayBtn) {
      e.winReplayBtn.addEventListener('click', function () { newPuzzle(); });
    }

    [e.helpModal, e.winModal].forEach(function (modal) {
      if (!modal) return;
      modal.addEventListener('click', function (event) {
        if (event.target === modal) App.setModalOpen(modal, false);
      });
    });

    global.document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      if (e.helpModal && !e.helpModal.hidden) App.setModalOpen(e.helpModal, false);
      else if (e.winModal && !e.winModal.hidden) App.setModalOpen(e.winModal, false);
    });
  }

  function init() {
    var e = state.element;
    e.board = element('board');
    if (!e.board) return; // page inattendue

    e.boardWrap = element('boardWrap');
    e.controls = element('controls');
    e.legend = element('legend');
    e.loader = element('loader');
    e.counter = element('counter');
    e.levelTitle = element('levelTitle');
    e.notesToggle = element('notesToggle');
    e.replayBtn = element('replayBtn');
    e.helpBtn = element('helpBtn');
    e.abandonBtn = element('abandonBtn');
    e.helpModal = element('helpModal');
    e.helpCloseBtn = element('helpCloseBtn');
    e.winModal = element('winModal');
    e.winReplayBtn = element('winReplayBtn');
    e.rulesBox = element('rulesBox');
    e.ruleTouchItem = element('ruleTouchItem');
    e.ruleTouchItemHelp = element('ruleTouchItemHelp');
    e.rulesHint = element('rulesHint');
    e.rulesHintHelp = element('rulesHintHelp');
    e.loaderCat = element('loaderCat');

    var params = readParams();
    state.size = params.size;
    state.difficulty = params.difficulty;
    state.angry = params.angry;
    state.notes = App.isNotesOn();

    e.levelTitle.textContent = levelTitle();
    if (e.rulesBox && global.innerWidth && global.innerWidth < 720) e.rulesBox.removeAttribute('open');

    /* Le chat du chargement porte la même humeur que la partie. */
    if (e.loaderCat) e.loaderCat.src = state.angry ? CAT_ICON_ANGRY : CAT_ICON;

    syncRulesBox();
    syncNotesToggle();
    bindEvents();
    newPuzzle();
  }

  /* API interne exposée pour les tests (node) et le débogage. */
  global.CatGame = {
    MIN_SIZE: MIN_SIZE,
    MAX_SIZE: MAX_SIZE,
    randomSolution: randomSolution,
    growRegions: growRegions,
    rebalance: rebalance,
    isConnected: isConnected,
    countSolutions: countSolutions,
    groupByRegion: groupByRegion,
    layoutIsSound: layoutIsSound,
    makeLayout: makeLayout,
    generatePuzzle: generatePuzzle,
    regionColors: regionColors,
    assignHues: assignHues,
    violationFor: violationFor,
    isSolved: isSolved,
    readParams: readParams
  };

  if (global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }
})(typeof window !== 'undefined' ? window : this);
