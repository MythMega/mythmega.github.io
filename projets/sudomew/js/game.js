/* ============================================================
   Cat Logic Puzzle — game.js
   1. Logique pure du puzzle (génération à solution unique, solveur, validation)
   2. Rendu et interaction de la page game.html
   La logique pure est exposée dans window.CatGame pour les tests.
   ============================================================ */
(function (global) {
  'use strict';

  var App = global.CatApp;
  var MIN_SIZE = 4;         // en dessous de 4×4 il n'existe aucune solution
  var MAX_SIZE = 15;
  var DEFAULT_SIZE = 5;
  var GEN_BUDGET_MS = 2500; // temps de génération d'une grille à solution unique
  var GEN_RETRY_MS = 8000;  // seconde chance si le premier budget n'a pas suffi
  var MAX_ATTEMPTS = 60;    // nouvelles solutions/régions essayées au maximum
  var MIN_REGION = 2;       // une région a toujours au moins 2 cases
  var ALT_BATCH = 12;       // solutions alternatives collectées par passe du solveur
  var SOLVE_NODE_LIMIT = 60000; // garde-fou du solveur (nœuds explorés par recherche)
  var MAX_REGION_FACTOR = 2.2; // une région ne dépasse jamais ~2,2 × la taille moyenne

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

  var randomSource = Math.random;

  function random(n) { return Math.floor(randomSource() * n); }

  /* Graine déterministe (FNV-1a 32 bits) : même valeur partout, quel que soit
     le navigateur. Sert à dériver la grille du jour de sa date. */
  function hashSeed(text) {
    var str = String(text);
    var hash = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  /* Fixe la source aléatoire : la grille devient reproductible. */
  function setSeed(seed) {
    randomSource = mulberry32(seed >>> 0);
    return seed >>> 0;
  }

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

  /* Tailles cibles inégales : beaucoup de petites régions et quelques grandes.
     Une grille aux régions toutes identiques laisse énormément de solutions ;
     partir de tailles variées rend l'unicité atteignable, même en 15×15.
     skew = 0 donne des régions égales, plus il monte plus l'écart se creuse. */
  function randomTargets(n, skew) {
    var total = n * n;
    var weights = [];
    var sum = 0;
    var r;
    for (r = 0; r < n; r++) {
      weights[r] = 0.2 + Math.pow(randomSource(), skew);
      sum += weights[r];
    }
    var targets = [];
    for (r = 0; r < n; r++) {
      targets[r] = Math.max(MIN_REGION, Math.round(weights[r] / sum * total));
    }
    return targets;
  }

  /* Régions colorées : croissance aléatoire depuis les chats de la solution
     (une région = un chat). À chaque pas, la région la moins remplie par
     rapport à sa taille cible gagne une case voisine. Sans targets, toutes
     les cibles valent 1 : les régions grandissent de façon équilibrée. */
  function growRegions(n, solution, targets) {
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
      var bestRatio = Infinity;
      var candidates = [];
      for (r = 0; r < n; r++) {
        var frontier = frontiers[r];
        while (frontier.length && owner[frontier[frontier.length - 1]] !== -1) frontier.pop();
        if (!frontier.length) continue;
        var ratio = sizes[r] / (targets ? targets[r] : 1);
        if (ratio < bestRatio) {
          bestRatio = ratio;
          candidates.length = 0;
          candidates.push(r);
        } else if (ratio === bestRatio) {
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

  /* ---------- Solveur ----------
     Recherche exhaustive avec propagation : à chaque nœud on compte, pour chaque
     ligne, colonne et région encore vide, les cases où un chat peut aller.
       - une unité sans aucune case possible → impasse immédiate ;
       - sinon on branche sur l'unité la plus contrainte (celle qui a le moins
         de cases), ce qui élague l'arbre bien plus qu'un parcours ligne par ligne.
     Options :
       cap       nombre maximal de solutions à collecter ;
       nodeLimit garde-fou : abandon (aborted = true) au-delà de ce nombre de nœuds ;
       touch     règle 3 (Mode Chat Fâché) ;
       exclude   solution de référence (tableau colonne par ligne), non comptée :
                 count === 0 (sans abandon) prouve donc qu'elle est unique ;
       shuffle   ordre de branchement aléatoire (variété des solutions trouvées).
     Chaque solution est un tableau « colonne du chat pour chaque ligne ». */
  function searchSolutions(n, regionOf, options) {
    var opts = options || {};
    var cap = opts.cap || 2;
    var maxNodes = opts.nodeLimit || SOLVE_NODE_LIMIT;
    var touch = !!opts.touch;
    var exclude = opts.exclude || null;
    var doShuffle = !!opts.shuffle;
    var total = n * n;

    var rowOf = new Int32Array(total);
    var colOf = new Int32Array(total);
    var i;
    for (i = 0; i < total; i++) {
      rowOf[i] = Math.floor(i / n);
      colOf[i] = i % n;
    }
    var regionCells = groupByRegion(n, regionOf);

    var rowUsed = new Uint8Array(n);
    var colUsed = new Uint8Array(n);
    var regUsed = new Uint8Array(n);
    var blocked = new Int32Array(total);   // > 0 : case interdite par un chat voisin
    var colOfRow = new Int32Array(n);
    var rowCnt = new Int32Array(n);
    var colCnt = new Int32Array(n);
    var regCnt = new Int32Array(n);
    var scratch = [];
    var solutions = [];
    var nodes = 0;
    var aborted = false;

    function isFree(cell) {
      return !rowUsed[rowOf[cell]] && !colUsed[colOf[cell]] &&
             !regUsed[regionOf[cell]] && !blocked[cell];
    }

    function put(cell, delta) {
      var flag = delta > 0 ? 1 : 0;
      rowUsed[rowOf[cell]] = flag;
      colUsed[colOf[cell]] = flag;
      regUsed[regionOf[cell]] = flag;
      if (delta > 0) colOfRow[rowOf[cell]] = colOf[cell];
      if (touch) {
        var list = neighbors8(cell, n, scratch);
        for (var k = 0; k < list.length; k++) blocked[list[k]] += delta;
      }
    }

    function search(depth) {
      if (++nodes > maxNodes) { aborted = true; return true; }

      if (depth === n) {
        if (exclude) {
          var same = true;
          for (var r = 0; r < n; r++) {
            if (exclude[r] !== colOfRow[r]) { same = false; break; }
          }
          if (same) return false;   // la solution de référence ne compte pas
        }
        solutions.push(Array.prototype.slice.call(colOfRow));
        return solutions.length >= cap;
      }

      rowCnt.fill(0);
      colCnt.fill(0);
      regCnt.fill(0);
      for (var cell = 0; cell < total; cell++) {
        if (!isFree(cell)) continue;
        rowCnt[rowOf[cell]]++;
        colCnt[colOf[cell]]++;
        regCnt[regionOf[cell]]++;
      }

      var bestType = -1;
      var bestIndex = -1;
      var bestCount = total + 1;
      for (var u = 0; u < n; u++) {
        if (!rowUsed[u]) {
          if (rowCnt[u] === 0) return false;
          if (rowCnt[u] < bestCount) { bestCount = rowCnt[u]; bestType = 0; bestIndex = u; }
        }
        if (!colUsed[u]) {
          if (colCnt[u] === 0) return false;
          if (colCnt[u] < bestCount) { bestCount = colCnt[u]; bestType = 1; bestIndex = u; }
        }
        if (!regUsed[u]) {
          if (regCnt[u] === 0) return false;
          if (regCnt[u] < bestCount) { bestCount = regCnt[u]; bestType = 2; bestIndex = u; }
        }
      }

      var options = [];
      var k, candidate;
      if (bestType === 0) {
        for (k = 0; k < n; k++) {
          candidate = bestIndex * n + k;
          if (isFree(candidate)) options.push(candidate);
        }
      } else if (bestType === 1) {
        for (k = 0; k < n; k++) {
          candidate = k * n + bestIndex;
          if (isFree(candidate)) options.push(candidate);
        }
      } else {
        var cells = regionCells[bestIndex];
        for (k = 0; k < cells.length; k++) {
          if (isFree(cells[k])) options.push(cells[k]);
        }
      }
      if (doShuffle) shuffle(options);

      for (k = 0; k < options.length; k++) {
        put(options[k], 1);
        var stop = search(depth + 1);
        put(options[k], -1);
        if (stop) return true;
      }
      return false;
    }

    search(0);
    return { count: solutions.length, solutions: solutions, nodes: nodes, aborted: aborted };
  }

  /* Compte les solutions (une par ligne/colonne/région, et sans contact quand
     la règle 3 est active). cap limite le comptage, nodeLimit protège des
     grilles trop coûteuses. */
  function countSolutions(n, regionOf, cap, nodeLimit, enforceTouch) {
    var result = searchSolutions(n, regionOf, {
      cap: cap || 2,
      nodeLimit: nodeLimit || 400000,
      touch: enforceTouch
    });
    return { count: result.count, nodes: result.nodes, aborted: result.aborted };
  }

  function groupByRegion(n, regionOf) {
    var cells = [];
    var i;
    for (i = 0; i < n; i++) cells.push([]);
    for (i = 0; i < n * n; i++) cells[regionOf[i]].push(i);
    return cells;
  }

  /* Une grille est saine si chaque région est d'un seul tenant et assez grande.
     Les régions n'ont plus besoin d'avoir la même taille : c'est l'unicité de
     la solution qui compte, pas l'égalité des couleurs. */
  function layoutIsSound(n, owner, sizes) {
    var groups = groupByRegion(n, owner);
    for (var r = 0; r < n; r++) {
      if (sizes[r] < MIN_REGION) return false;         // région trop petite
      if (!isConnected(groups[r], n)) return false;    // région en plusieurs morceaux
    }
    return true;
  }

  /* ---------- Génération par réparation ----------
     1. On tire une solution S et on fait pousser les régions autour de ses chats.
     2. Le solveur cherche des solutions différentes de S.
     3. Pour chacune, on déplace une case vers une région voisine qui contient
        déjà un autre chat de cette solution : elle met alors deux chats dans
        la même région et devient invalide. S reste toujours valide, car on ne
        déplace jamais la case d'un chat de S.
     4. On recommence jusqu'à ce que S soit la seule solution.
     Une région garde toujours au moins MIN_REGION cases et reste d'un seul tenant. */

  function maxRegionSize(n) {
    return Math.max(n + 3, Math.round(n * MAX_REGION_FACTOR));
  }

  /* Inégalité voulue des régions au départ : jusqu'à 9×9 des régions équilibrées
     suffisent (et sont plus harmonieuses) ; au-delà, des tailles variées sont
     nécessaires pour que la solution unique soit atteignable. */
  function regionSkew(n) {
    if (n <= 9) return 0;
    return n <= 11 ? 2 : 3;
  }

  function repairIterations(n) {
    return 40 + 10 * n;
  }

  /* Retirer cette case laisse-t-elle sa région d'un seul tenant ?
     size = taille actuelle de la région (avant retrait). */
  function staysConnected(n, owner, cell, size) {
    if (size <= 2) return true;
    var region = owner[cell];
    var first = neighbors4(cell, n, []);
    var start = -1;
    var i;
    for (i = 0; i < first.length; i++) {
      if (owner[first[i]] === region) { start = first[i]; break; }
    }
    if (start === -1) return false;

    var seen = new Uint8Array(n * n);
    var stack = [start];
    var scratch = [];
    var reached = 1;
    seen[start] = 1;
    seen[cell] = 1;
    while (stack.length) {
      var list = neighbors4(stack.pop(), n, scratch);
      for (i = 0; i < list.length; i++) {
        var next = list[i];
        if (seen[next] || owner[next] !== region) continue;
        seen[next] = 1;
        reached++;
        stack.push(next);
      }
    }
    return reached === size - 1;
  }

  /* La case peut-elle passer dans la région voisine target ? (target doit
     toucher la case : l'appelant le garantit.) */
  function canMove(n, owner, sizes, seedSet, cell, target, maxSize) {
    var from = owner[cell];
    if (seedSet[cell] || from === target) return false;
    if (sizes[from] <= MIN_REGION || sizes[target] >= maxSize) return false;
    return staysConnected(n, owner, cell, sizes[from]);
  }

  function applyMove(owner, sizes, cell, target) {
    sizes[owner[cell]]--;
    sizes[target]++;
    owner[cell] = target;
  }

  /* La solution alt reste-t-elle valide avec ces régions ? (une seule par région) */
  function altIsValid(n, owner, alt) {
    var seen = 0;
    for (var r = 0; r < n; r++) {
      var bit = 1 << owner[r * n + alt[r]];
      if (seen & bit) return false;
      seen |= bit;
    }
    return true;
  }

  /* Meilleur déplacement pour invalider des solutions alternatives : celui qui
     en tue le plus d'un coup, à égalité celui qui rééquilibre les tailles. */
  function bestKillMove(n, owner, sizes, seedSet, alive, maxSize) {
    var scratch = [];
    var seen = {};
    var candidates = [];
    var a, r, k;

    for (a = 0; a < alive.length; a++) {
      var alt = alive[a];
      var count = new Int32Array(n);
      for (r = 0; r < n; r++) count[owner[r * n + alt[r]]]++;
      for (r = 0; r < n; r++) {
        var cell = r * n + alt[r];
        if (seedSet[cell]) continue;
        var from = owner[cell];
        var list = neighbors4(cell, n, scratch);
        for (k = 0; k < list.length; k++) {
          var target = owner[list[k]];
          if (target === from || !count[target]) continue;
          var key = cell * 16 + target;
          if (seen[key]) continue;
          seen[key] = true;
          candidates.push({ cell: cell, target: target, score: 0 });
        }
      }
    }
    if (!candidates.length) return null;

    for (var i = 0; i < candidates.length; i++) {
      var cand = candidates[i];
      var row = Math.floor(cand.cell / n);
      var col = cand.cell % n;
      var kills = 0;
      for (a = 0; a < alive.length; a++) {
        var other = alive[a];
        if (other[row] !== col) continue;
        for (r = 0; r < n; r++) {
          if (r !== row && owner[r * n + other[r]] === cand.target) { kills++; break; }
        }
      }
      cand.score = kills + (sizes[owner[cand.cell]] - sizes[cand.target]) * 0.02 + random(100) / 10000;
    }
    candidates.sort(function (x, y) { return y.score - x.score; });

    for (var j = 0; j < candidates.length; j++) {
      if (canMove(n, owner, sizes, seedSet, candidates[j].cell, candidates[j].target, maxSize)) {
        return candidates[j];
      }
    }
    return null;
  }

  /* Invalide toutes les alternatives de la liste, déplacement après déplacement.
     Renvoie true si elles sont toutes mortes. */
  function killAlternatives(n, owner, sizes, seedSet, alternatives, maxSize) {
    var alive = alternatives;
    var guard = 0;
    while (alive.length && guard++ < alternatives.length * 3 + 6) {
      var move = bestKillMove(n, owner, sizes, seedSet, alive, maxSize);
      if (!move) return false;
      applyMove(owner, sizes, move.cell, move.target);
      alive = alive.filter(function (alt) { return altIsValid(n, owner, alt); });
    }
    return alive.length === 0;
  }

  /* Déplacement aléatoire légal : sort la recherche d'une impasse. */
  function shake(n, owner, sizes, seedSet, maxSize) {
    var scratch = [];
    for (var tries = 0; tries < 80; tries++) {
      var cell = random(n * n);
      if (seedSet[cell]) continue;
      var list = neighbors4(cell, n, scratch);
      var target = owner[list[random(list.length)]];
      if (canMove(n, owner, sizes, seedSet, cell, target, maxSize)) {
        applyMove(owner, sizes, cell, target);
        return true;
      }
    }
    return false;
  }

  /* Invalide les alternatives de la liste, déplacement après déplacement.
     Renvoie true si au moins un déplacement a été fait. */
  function killAlternatives(n, owner, sizes, seedSet, alternatives, maxSize) {
    var alive = alternatives;
    var moved = false;
    var guard = 0;
    while (alive.length && guard++ < alternatives.length * 3 + 6) {
      var move = bestKillMove(n, owner, sizes, seedSet, alive, maxSize);
      if (!move) break;
      applyMove(owner, sizes, move.cell, move.target);
      moved = true;
      alive = alive.filter(function (alt) { return altIsValid(n, owner, alt); });
    }
    return moved;
  }

  /* Boucle de réparation. Modifie owner/sizes en place.
     Renvoie { unique, left } : left = nombre d'alternatives encore trouvées
     à la meilleure itération (0 si la grille est unique). */
  function repairLayout(n, owner, sizes, solution, seedSet, touch, maxIter, deadline) {
    var maxSize = maxRegionSize(n);
    var left = Infinity;
    for (var iter = 0; iter < maxIter && Date.now() < deadline; iter++) {
      var found = searchSolutions(n, owner, {
        cap: ALT_BATCH,
        nodeLimit: SOLVE_NODE_LIMIT,
        touch: touch,
        exclude: solution,
        shuffle: true
      });
      if (found.count === 0 && found.aborted) break;   // preuve trop coûteuse : autre grille
      if (found.count === 0) return { unique: true, left: 0 };

      if (found.count < left) left = found.count;
      if (!killAlternatives(n, owner, sizes, seedSet, found.solutions, maxSize)) {
        shake(n, owner, sizes, seedSet, maxSize);
      }
    }
    return { unique: false, left: left === Infinity ? ALT_BATCH : left };
  }

  /* Une fois la grille unique, on rapproche les tailles des régions : on
     tente de déplacer une case d'une grande région vers une petite voisine
     et on ne garde le déplacement que si la solution reste unique. */
  function polishSizes(n, owner, sizes, solution, seedSet, touch, deadline) {
    var maxSize = maxRegionSize(n);
    var total = n * n;
    var scratch = [];
    var solves = 0;
    var maxSolves = 6 * n;

    for (var t = 0; t < 30 * total && solves < maxSolves && Date.now() < deadline; t++) {
      if (sizeDeviation(n, sizes) <= 1) return;
      var cell = random(total);
      if (seedSet[cell]) continue;
      var from = owner[cell];
      var list = neighbors4(cell, n, scratch);
      var target = -1;
      for (var k = 0; k < list.length; k++) {
        var other = owner[list[k]];
        if (other === from || sizes[other] + 1 >= sizes[from]) continue;   // doit améliorer l'équilibre
        if (target === -1 || sizes[other] < sizes[target]) target = other;
      }
      if (target === -1) continue;
      if (!canMove(n, owner, sizes, seedSet, cell, target, maxSize)) continue;

      applyMove(owner, sizes, cell, target);
      solves++;
      var check = searchSolutions(n, owner, {
        cap: 1, nodeLimit: SOLVE_NODE_LIMIT, touch: touch, exclude: solution
      });
      if (check.count !== 0 || check.aborted) applyMove(owner, sizes, cell, from);   // on annule
    }
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

  /* Construit une grille : solution aléatoire, régions, réparation, polissage.
     Renvoie null si aucune croissance de régions n'a abouti. Le résultat porte
     unique (true = une seule solution prouvée) et left (alternatives restantes
     sinon). */
  function makeLayout(n, enforceTouch, deadline) {
    var until = deadline === undefined ? Infinity : deadline;
    for (var roll = 0; roll < 60; roll++) {
      var solution = randomSolution(n, enforceTouch);
      if (!solution) continue;
      var skew = regionSkew(n);
      var grown = growRegions(n, solution, skew > 0 ? randomTargets(n, skew) : null);
      if (!grown) continue;

      var tooSmall = false;
      var seedSet = new Uint8Array(n * n);
      for (var r = 0; r < n; r++) {
        seedSet[r * n + solution[r]] = 1;
        if (grown.sizes[r] < MIN_REGION) tooSmall = true;
      }
      if (tooSmall) continue;

      var outcome = repairLayout(n, grown.owner, grown.sizes, solution, seedSet,
                                 enforceTouch, repairIterations(n), until);
      if (outcome.unique) {
        polishSizes(n, grown.owner, grown.sizes, solution, seedSet, enforceTouch, until);
      }
      return {
        size: n,
        solution: solution,
        regionOf: grown.owner,
        sizes: grown.sizes,
        unique: outcome.unique,
        left: outcome.left
      };
    }
    return null;
  }

  /* Génère une grille à solution unique.
     Avec attemptLimit (> 0), le budget de temps est ignoré : on fait exactement
     ce nombre d'essais, ce qui rend la grille reproductible (grille du jour).
     Si aucun essai n'aboutit à l'unicité dans le budget, on renvoie la grille
     la moins ambiguë (unique === false). */
  function generatePuzzle(n, budgetMs, enforceTouch, attemptLimit) {
    var fixed = attemptLimit > 0;
    var deadline = fixed ? Infinity : Date.now() + (budgetMs || GEN_BUDGET_MS);
    var limit = fixed ? attemptLimit : MAX_ATTEMPTS;
    var best = null;
    var attempts = 0;

    while (attempts < limit && Date.now() < deadline) {
      attempts++;
      var layout = makeLayout(n, enforceTouch, deadline);
      if (!layout) continue;
      layout.attempts = attempts;
      layout.deviation = sizeDeviation(n, layout.sizes);
      layout.solutions = layout.unique ? 1 : layout.left + 1;   // « au moins » si non unique
      if (layout.unique) return layout;
      if (!best || layout.left < best.left) best = layout;
    }
    return best;
  }

  /* Couleurs des régions.
     Table fixe de 15 couleurs (une par région au maximum, la grille la plus
     grande en a 15) choisies pour rester bien distinctes entre elles : teintes
     éloignées, mais aussi luminosités et saturations variées pour aider en cas
     de daltonisme. Les valeurs sont celles du thème clair ; le thème sombre en
     est déduit (même teinte, plus foncée). */
  var REGION_PALETTE = [
    '#ff8fa3', // rose
    '#f4845f', // orange
    '#ffd166', // jaune
    '#c5e063', // citron vert
    '#5fc77a', // vert
    '#4fd1c5', // turquoise
    '#6ec6ff', // bleu ciel
    '#5b8def', // bleu
    '#9b7ede', // violet
    '#d8a7f0', // lilas
    '#f06bc4', // magenta
    '#e8c4a0', // sable
    '#b08968', // brun
    '#c3c8d0', // gris
    '#9fb58a'  // vert sauge
  ];

  function hexToRgb(hex) {
    var value = parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  /* Distance perceptuelle entre deux couleurs (CIE Lab, ΔE76). */
  function hexToLab(hex) {
    var rgb = hexToRgb(hex).map(function (v) {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    var x = (rgb[0] * 0.4124 + rgb[1] * 0.3576 + rgb[2] * 0.1805) / 0.95047;
    var y = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    var z = (rgb[0] * 0.0193 + rgb[1] * 0.1192 + rgb[2] * 0.9505) / 1.08883;
    function f(t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; }
    var fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  var PALETTE_LAB = REGION_PALETTE.map(hexToLab);

  function colorDistance(a, b) {
    var l = PALETTE_LAB[a][0] - PALETTE_LAB[b][0];
    var u = PALETTE_LAB[a][1] - PALETTE_LAB[b][1];
    var v = PALETTE_LAB[a][2] - PALETTE_LAB[b][2];
    return Math.sqrt(l * l + u * u + v * v);
  }

  /* Affecte une couleur différente à chaque région (renvoie des indices de
     REGION_PALETTE). Les régions les plus entourées sont servies d'abord ;
     chacune prend la couleur la plus éloignée de ses voisines déjà coloriées,
     et, à égalité, la plus éloignée de toutes les couleurs déjà utilisées. */
  function assignColors(n, regionOf) {
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
      return Object.keys(neighbors[y]).length - Object.keys(neighbors[x]).length || x - y;
    });

    var assigned = [];
    var used = [];
    for (i = 0; i < n; i++) assigned.push(-1);

    for (i = 0; i < order.length; i++) {
      var region = order[i];
      var bestColor = -1;
      var bestNear = -1;
      var bestAll = -1;
      for (var c = 0; c < REGION_PALETTE.length; c++) {
        if (used[c]) continue;
        var near = Infinity;
        var all = Infinity;
        for (var other2 = 0; other2 < n; other2++) {
          if (assigned[other2] === -1) continue;
          var d = colorDistance(c, assigned[other2]);
          if (d < all) all = d;
          if (neighbors[region][other2] && d < near) near = d;
        }
        if (near === Infinity) near = 1000;   // aucun voisin colorié : seul compte l'écart global
        if (all === Infinity) all = 1000;
        if (near > bestNear || (near === bestNear && all > bestAll)) {
          bestColor = c;
          bestNear = near;
          bestAll = all;
        }
      }
      assigned[region] = bestColor;
      used[bestColor] = true;
    }
    return assigned;
  }

  /* Thème sombre : même teinte, moins saturée et nettement plus foncée. */
  function darkVariant(hex) {
    var rgb = hexToRgb(hex).map(function (v) { return v / 255; });
    var max = Math.max(rgb[0], rgb[1], rgb[2]);
    var min = Math.min(rgb[0], rgb[1], rgb[2]);
    var l = (max + min) / 2;
    var d = max - min;
    var s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    var h = 0;
    if (d !== 0) {
      if (max === rgb[0]) h = ((rgb[1] - rgb[2]) / d) % 6;
      else if (max === rgb[1]) h = (rgb[2] - rgb[0]) / d + 2;
      else h = (rgb[0] - rgb[1]) / d + 4;
      h = (h * 60 + 360) % 360;
    }
    return 'hsl(' + Math.round(h) + ', ' + Math.round(s * 60) + '%, ' + Math.round((0.18 + 0.32 * l) * 100) + '%)';
  }

  function regionColors(n, regionOf, theme) {
    var dark = theme === 'dark';
    return assignColors(n, regionOf).map(function (index) {
      return dark ? darkVariant(REGION_PALETTE[index]) : REGION_PALETTE[index];
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

  var LEVEL_KEYS = ['easy', 'medium', 'hard', 'custom', 'daily'];
  var DIFFICULTY_SIZES = { easy: 5, medium: 7, hard: 11 };
  var DAILY_SIZE = 7;                                   // taille imposée de la grille du jour
  var DAILY_ATTEMPTS = 12;                              // essais fixes : grille identique pour tous
  var CAT_ICON = 'assets/img/cat_icon.png';
  var CAT_ICON_ANGRY = 'assets/img/cat_icon_angry.png'; // Mode Chat Fâché
  var LONG_PRESS_MS = 450;                              // appui long tactile → croix manuelle

  var state = {
    size: DEFAULT_SIZE,
    difficulty: 'custom',
    angry: false,           // Mode Chat Fâché : règle 3 active (chats non adjacents)
    daily: false,           // grille du jour (daily.html) : 7×7, Angry Cat, sans notes auto
    date: null,             // date de la grille du jour { year, month, day }
    regionOf: null,
    solution: null,
    colors: [],
    cats: [],
    catMap: {},
    crossMap: {},           // cases barrées à la main (clic droit / appui long)
    cells: [],
    notes: false,           // notes auto : réglage dans settings.html, désactivé par défaut
    errors: 0,              // tentatives de placement invalides
    removals: 0,            // chats retirés : « mauvais placements » de la grille du jour
    solved: false,
    element: {}
  };

  /* Abonnés (page daily.html) : 'ready' quand la grille est affichée,
     'win' quand elle est résolue. Voir CatGame.on(). */
  var listeners = { ready: [], win: [] };

  function on(event, handler) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(handler);
    return handler;
  }

  function emit(event, payload) {
    var list = listeners[event] || [];
    for (var i = 0; i < list.length; i++) {
      try {
        list[i](payload);
      } catch (err) { /* un abonné qui échoue ne doit pas casser la partie */ }
    }
  }

  /* Photographie de la partie, envoyée aux abonnés. */
  function snapshot() {
    return {
      daily: state.daily,
      size: state.size,
      difficulty: state.difficulty,
      angry: state.angry,
      notes: state.notes,
      date: state.date,
      errors: state.errors,
      removals: state.removals
    };
  }

  function element(id) {
    return global.document ? global.document.getElementById(id) : null;
  }

  /* Date de la grille du jour : date locale, ou ?date=AAAA-MM-JJ pour rejouer
     une grille passée. */
  function readDailyDate() {
    var param = String(App.getParam('date', '') || '');
    var match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(param);
    if (match) return { year: +match[1], month: +match[2], day: +match[3] };
    var now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  }

  /* Graine de la grille du jour : même date = même grille pour tout le monde. */
  function dailySeed(date) {
    return hashSeed('sudomeow-daily-' + date.year + '-' + date.month + '-' + date.day);
  }

  function readParams() {
    var daily = !!(global.document && global.document.body &&
      String(global.document.body.getAttribute('data-mode') || '') === 'daily');
    var sizeParam = App.getParam('size', null);
    var difficulty = String(App.getParam('difficulty', 'custom') || 'custom').toLowerCase();
    var fallbackSize = DIFFICULTY_SIZES[difficulty] || DEFAULT_SIZE;
    var size = sizeParam === null
      ? fallbackSize
      : App.clampInt(sizeParam, MIN_SIZE, MAX_SIZE, fallbackSize);
    var angryParam = String(App.getParam('angry', '') || '').toLowerCase();
    var angry = angryParam === '1' || angryParam === 'true' || angryParam === 'on';

    if (daily) {   // la grille du jour impose ses règles
      size = DAILY_SIZE;
      difficulty = 'daily';
      angry = true;
    }
    return {
      size: size,
      difficulty: difficulty,
      angry: angry,
      daily: daily,
      date: daily ? readDailyDate() : null
    };
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

  /* Notes : croix manuelles (clic droit / appui long) ; quand les notes auto
     sont activées dans les réglages, les cases impossibles se barrent seules. */
  function updateMarks() {
    for (var i = 0; i < state.cells.length; i++) {
      var cell = state.cells[i];
      if (state.catMap[i]) {
        cell.classList.remove('is-invalid', 'is-crossed');
        continue;
      }
      cell.classList.toggle('is-crossed', !state.notes && !!state.crossMap[i]);
      var impossible = state.notes &&
        violationFor(state.size, state.regionOf, state.cats, i, state.angry) !== null;
      cell.classList.toggle('is-invalid', impossible);
    }
  }

  function updateErrorCounter() {
    var el = state.element.errorCounter;
    if (!el) return;
    // Grille du jour : on compte les chats retirés (« mauvais placements »).
    var count = state.daily ? state.removals : state.errors;
    var key = state.daily ? 'daily_mistakes_counter' : 'errors_counter';
    el.textContent = App.t(key, { count: count });
    el.classList.toggle('is-alert', count > 0);
  }

  /* Croix manuelle : la case est marquée comme ne pouvant pas recevoir de chat.
     Renvoie true quand la case a bien été barrée (ou débarrée). */
  function toggleCross(index) {
    if (state.solved || state.notes || state.catMap[index] || !state.cells[index]) return false;
    if (state.crossMap[index]) delete state.crossMap[index];
    else state.crossMap[index] = true;
    updateMarks();
    return true;
  }

  /* Action secondaire (clic droit / appui long) : barre une case vide,
     retire le chat d'une case occupée. Renvoie true si l'état a changé. */
  function secondaryAction(index) {
    if (state.solved || !state.cells[index]) return false;
    if (state.catMap[index]) {
      removeCat(index);
      App.playSound('click');
      refresh();
      return true;
    }
    return toggleCross(index);
  }

  function placeCat(index) {
    var cell = state.cells[index];
    var img = global.document.createElement('img');
    img.className = 'cell__cat';
    img.src = state.angry ? CAT_ICON_ANGRY : CAT_ICON;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    cell.appendChild(img);
    cell.classList.remove('is-invalid', 'is-crossed');
    delete state.crossMap[index];   // la croix disparaît quand un chat occupe la case
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
    state.removals++;   // un chat retiré = un mauvais placement (grille du jour)
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
    updateErrorCounter();
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
      // Placement refusé : erreur signalée, case barrée, compteur incrémenté.
      state.errors++;
      if (!state.notes) state.crossMap[index] = true;
      App.playSound('error');
      flashError(state.cells[index]);
      App.toast(App.t(reason));
      refresh();
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
    emit('win', snapshot());
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
      cell.classList.remove('is-win', 'is-invalid', 'is-bad', 'is-crossed');
      var img = cell.querySelector('.cell__cat');
      if (img) cell.removeChild(img);
      updateLabel(i, false);
    }
    state.cats = [];
    state.catMap = {};
    state.crossMap = {};
    state.errors = 0;
    state.solved = false;
    state.element.board.classList.remove('is-locked');
    updateCounter();
    updateErrorCounter();
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

  /* Légende : la ligne des notes auto et l'astuce de la croix manuelle
     dépendent du réglage « auto notes ». */
  function syncLegend() {
    var e = state.element;
    if (e.legendNotes) e.legendNotes.hidden = !state.notes;
    if (e.legendCross) e.legendCross.hidden = state.notes;
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
      var puzzle;
      if (state.daily) {
        setSeed(dailySeed(state.date));   // grille du jour : même graine, donc même grille
        puzzle = generatePuzzle(state.size, 0, state.angry, DAILY_ATTEMPTS);
      } else {
        puzzle = generatePuzzle(state.size, GEN_BUDGET_MS, state.angry);
        if (!puzzle || !puzzle.unique) {   // pas de solution unique trouvée : seconde chance
          var retry = generatePuzzle(state.size, GEN_RETRY_MS, state.angry);
          if (retry && (!puzzle || retry.unique || retry.left < puzzle.left)) puzzle = retry;
        }
      }
      if (!puzzle) {
        App.toast(App.t('loading'));
        return;
      }

      state.regionOf = puzzle.regionOf;
      state.solution = puzzle.solution;
      state.colors = regionColors(state.size, puzzle.regionOf, App.getTheme());
      state.cats = [];
      state.catMap = {};
      state.crossMap = {};
      state.errors = 0;
      state.removals = 0;
      state.solved = false;

      state.element.levelTitle.textContent = levelTitle();
      buildCells();
      updateCounter();
      updateErrorCounter();
      updateMarks();
      showLoader(false);
      emit('ready', snapshot());
    }, 30);
  }

  function bindEvents() {
    var e = state.element;

    var suppressClick = false;   // neutralise le clic qui suit un appui long tactile
    var longPressTimer = null;
    var pressOrigin = null;
    var lastTouchDown = 0;

    function clearLongPress() {
      if (longPressTimer) global.clearTimeout(longPressTimer);
      longPressTimer = null;
      pressOrigin = null;
    }

    function cellIndexFrom(target) {
      var cell = target && target.closest ? target.closest('.cell') : null;
      return cell ? parseInt(cell.getAttribute('data-index'), 10) : -1;
    }

    e.board.addEventListener('click', function (event) {
      if (suppressClick) {   // relâchement de l'appui long : le clic ne compte pas
        suppressClick = false;
        return;
      }
      var index = cellIndexFrom(event.target);
      if (index >= 0) handleCellTap(index);
    });

    /* Clic droit : barre une case vide, retire le chat d'une case occupée. */
    e.board.addEventListener('contextmenu', function (event) {
      event.preventDefault();
      // Sur mobile, l'appui long tactile est déjà traité par la minuterie.
      if (Date.now() - lastTouchDown < 900) return;
      secondaryAction(cellIndexFrom(event.target));
    });

    /* Appui long tactile (mobile) : même geste que le clic droit. */
    e.board.addEventListener('pointerdown', function (event) {
      suppressClick = false;   // nouveau geste : on repart d'un état propre
      if (event.pointerType === 'mouse') return;
      var index = cellIndexFrom(event.target);
      if (index < 0) return;
      lastTouchDown = Date.now();
      clearLongPress();
      pressOrigin = { x: event.clientX, y: event.clientY };
      longPressTimer = global.setTimeout(function () {
        longPressTimer = null;
        if (secondaryAction(index)) suppressClick = true;
      }, LONG_PRESS_MS);
    });

    e.board.addEventListener('pointermove', function (event) {
      if (!pressOrigin) return;
      if (Math.abs(event.clientX - pressOrigin.x) > 10 ||
          Math.abs(event.clientY - pressOrigin.y) > 10) clearLongPress();
    });

    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (type) {
      e.board.addEventListener(type, clearLongPress);
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

    if (e.resetBtn) {
      e.resetBtn.addEventListener('click', function () {
        resetSameGrid();
        App.toast(App.t('reset_done'), 1500);
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
    e.errorCounter = element('errorCounter');
    e.legendNotes = element('legendNotes');
    e.legendCross = element('legendCross');
    e.resetBtn = element('resetBtn');
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
    state.daily = params.daily;
    state.date = params.date;
    if (state.daily) setSeed(dailySeed(state.date));       // grille du jour : reproductible
    state.notes = state.daily ? false : App.isNotesOn();   // grille du jour : sans notes auto

    e.levelTitle.textContent = levelTitle();
    if (e.rulesBox && global.innerWidth && global.innerWidth < 720) e.rulesBox.removeAttribute('open');

    /* Le chat du chargement porte la même humeur que la partie. */
    if (e.loaderCat) e.loaderCat.src = state.angry ? CAT_ICON_ANGRY : CAT_ICON;

    syncRulesBox();
    syncLegend();
    updateErrorCounter();
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
    searchSolutions: searchSolutions,
    countSolutions: countSolutions,
    groupByRegion: groupByRegion,
    layoutIsSound: layoutIsSound,
    makeLayout: makeLayout,
    generatePuzzle: generatePuzzle,
    regionColors: regionColors,
    assignColors: assignColors,
    REGION_PALETTE: REGION_PALETTE,
    violationFor: violationFor,
    isSolved: isSolved,
    readParams: readParams,
    readDailyDate: readDailyDate,
    dailySeed: dailySeed,
    hashSeed: hashSeed,
    setSeed: setSeed,
    snapshot: snapshot,
    on: on,
    DAILY_SIZE: DAILY_SIZE,
    DAILY_ATTEMPTS: DAILY_ATTEMPTS
  };

  if (global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }
})(typeof window !== 'undefined' ? window : this);
