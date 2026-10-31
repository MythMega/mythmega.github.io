// xp.js — XP totale (Daily + Weekly + Marathon + challenges + trophées).
// stats.js garde sa propre version parce qu'il a besoin du détail par trophée ;
// cette copie sert à la Boutique, aux challenges et au calcul des Pokédollars.
const PokefeetXP = (function () {
  const DB_NAME = 'PokefeetDB';
  const DB_VERSION = 4;
  const XP_PER_LEVEL = 100;
  const XP_STEP = 2;
  const COUNT = 5;
  const WEEKLY_COUNT = 10;

  function getCookie(name) {
    const m = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
    return m ? decodeURIComponent(m.pop()) : null;
  }

  function readStore(storeName) {
    return new Promise(function (resolve) {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = function () { resolve([]); };
      req.onsuccess = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains(storeName)) { db.close(); resolve([]); return; }
        const getReq = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
        getReq.onsuccess = function () { const rows = getReq.result || []; db.close(); resolve(rows); };
        getReq.onerror = function () { db.close(); resolve([]); };
      };
    });
  }

  async function readHistory(storeName) {
    const history = {};
    (await readStore(storeName)).forEach(function (item) {
      history[item.date] = { score: item.score, results: item.results };
    });
    return history;
  }

  function readDexEntries() {
    return new Promise(function (resolve) {
      const req = indexedDB.open('PokefeetDexDB');
      req.onerror = function () { resolve([]); };
      req.onsuccess = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains('dex_entries')) { db.close(); resolve([]); return; }
        const getReq = db.transaction('dex_entries', 'readonly').objectStore('dex_entries').getAll();
        getReq.onsuccess = function () { const rows = getReq.result || []; db.close(); resolve(rows); };
        getReq.onerror = function () { db.close(); resolve([]); };
      };
    });
  }

  // ── XP par jour / par semaine ──────────────────────────────
  // Chaque round trouvé rapporte 1 XP, et un round trouvé du premier coup
  // en rapporte davantage (1 de plus le daily, 2 de plus le weekly).
  function dailyXP(entry) {
    if (!entry) return 0;
    const results = entry.results || [];
    let xp = 0;
    if (results.length === COUNT) xp += 3;
    if (entry.score === COUNT * 10) xp += 2;
    results.forEach(function (r) {
      if (!r || r.outcome !== 'win') return;
      xp += 1;
      if (r.attempts === 0) xp += 1;
    });
    return xp;
  }

  function weeklyXP(entry) {
    if (!entry) return 0;
    const results = entry.results || [];
    let xp = 0;
    if (results.length === WEEKLY_COUNT) {
      xp += 6;
      if (entry.score === WEEKLY_COUNT * 10 && results.every(r => r && r.outcome === 'win')) xp += 4;
    }
    results.forEach(function (r) {
      if (!r || r.outcome !== 'win') return;
      xp += 1;
      if (r.attempts === 0) xp += 2;
    });
    return xp;
  }

  function computeDailyXP(history) {
    return Object.values(history || {}).reduce((sum, entry) => sum + dailyXP(entry), 0);
  }

  function computeWeeklyXP(history) {
    return Object.values(history || {}).reduce((sum, entry) => sum + weeklyXP(entry), 0);
  }

  function computeMarathonXP() {
    const best = parseInt(getCookie('pk_best') || '0', 10) || 0;
    const streak = parseInt(getCookie('pk_best_streak') || '0', 10) || 0;
    if (best <= 0 && streak <= 0) return 0;
    return Math.floor(best / 5) + streak * 2;
  }

  async function computeChallengeXP() {
    if (typeof ChallengeStorage === 'undefined') return 0;
    try {
      const completions = await ChallengeStorage.getAllCompletions();
      const all = await DataFiles.load('challenges');
      let xp = 0;
      for (const id in completions) {
        const challenge = all.find(c => c.ID == id);
        (challenge ? challenge.Rewards || [] : []).forEach(function (reward) {
          if (reward.TypeReward === 'Experience') xp += reward.Value;
        });
      }
      return xp;
    } catch (e) {
      console.error('[XP] challenges illisibles :', e);
      return 0;
    }
  }

  async function computeTrophyXP(dailyHistory, weeklyHistory) {
    try {
      const trophies = await DataFiles.load('trophies');
      const found = new Set((await readDexEntries()).filter(e => e.found).map(e => String(e.index)));
      let pokemons = [];
      try { pokemons = await PokemonFiles.loadRaw(); } catch (e) { /* pas de data, pas d'XP de génération */ }

      const gens = {};
      pokemons.forEach(function (p) {
        (gens[p.Generation] = gens[p.Generation] || []).push(String(p.Index));
      });

      const dailies = Object.values(dailyHistory).filter(h => (h.results || []).length === COUNT).length;
      const weeklies = Object.values(weeklyHistory).filter(h => (h.results || []).length === WEEKLY_COUNT).length;
      const streak = parseInt(getCookie('pk_best_streak') || '0', 10) || 0;

      let xp = 0;
      trophies.forEach(function (trophy) {
        if (!trophy.Enabled) return;
        const method = trophy.Obtention_Method || {};
        const value = method.Value;
        let earned = false;

        switch (method.Mode) {
          case 'Dex_Count':
            earned = found.size >= value;
            break;
          case 'Daily_Count':
            earned = dailies >= value;
            break;
          case 'Weekly_Count':
            earned = weeklies >= value;
            break;
          case 'Marathon_Streak':
            earned = streak >= value;
            break;
          case 'Full_Generation_Register': {
            const gen = gens[value] || [];
            earned = gen.length > 0 && gen.every(idx => found.has(idx));
            break;
          }
          case 'Type_Registered': {
            const type = (method.Type || '').toLowerCase();
            if (!type) break;
            const ofType = pokemons
              .filter(p => (p.Type1 || '').toLowerCase() === type || (p.Type2 || '').toLowerCase() === type)
              .map(p => String(p.Index));
            const threshold = (value === null || value === undefined || value === -1) ? ofType.length : value;
            earned = ofType.filter(idx => found.has(idx)).length >= threshold;
            break;
          }
        }

        if (earned) xp += trophy.XP;
      });
      return xp;
    } catch (e) {
      console.error('[XP] trophées illisibles :', e);
      return 0;
    }
  }

  async function computeTotalXP() {
    const [daily, weekly] = await Promise.all([
      readHistory('daily_results'),
      readHistory('weekly_results')
    ]);
    return computeDailyXP(daily) + computeWeeklyXP(weekly) + computeMarathonXP() +
      await computeChallengeXP() + await computeTrophyXP(daily, weekly);
  }

  // ── Niveaux ────────────────────────────────────────────────
  // Courbe progressive : le palier 1 → 2 coûte 100 XP, puis chaque palier
  // coûte XP_STEP XP de plus que le précédent. Les premiers niveaux restent
  // donc quasi immédiats, tandis que « Master » (niveau 100, 19 602 XP) demande
  // tout le contenu disponible (challenges bonus + trophées = 20 000 XP).
  // Seule source de vérité : stats.js délègue ici, aucune copie à maintenir.
  function levelCost(level) {
    return XP_PER_LEVEL + XP_STEP * (Math.max(1, level) - 1);
  }

  // XP cumulée nécessaire pour atteindre le niveau demandé (niveau 1 = 0 XP).
  // Somme des paliers franchis : k = level - 1, total = k(2·100 + XP_STEP(k-1))/2.
  function xpToReach(level) {
    const k = Math.max(0, level - 1);
    return (k * (2 * XP_PER_LEVEL + XP_STEP * (k - 1))) / 2;
  }

  function getLevel(totalXP) {
    const xp = Math.max(0, Number(totalXP) || 0);
    // Résolution directe de l'inéquation, puis correction d'un palier au cas où
    // les arrondis flottants tombent juste à côté d'un seuil exact.
    const a = XP_STEP / 2;
    const b = XP_PER_LEVEL - XP_STEP / 2;
    let level = a > 0
      ? Math.floor((-b + Math.sqrt(b * b + 4 * a * xp)) / (2 * a)) + 1
      : Math.floor(xp / XP_PER_LEVEL) + 1;
    if (level < 1) level = 1;
    while (xpToReach(level + 1) <= xp) level++;
    while (level > 1 && xpToReach(level) > xp) level--;
    return level;
  }

  function getXPInLevel(totalXP) {
    const xp = Math.max(0, Number(totalXP) || 0);
    return xp - xpToReach(getLevel(xp));
  }

  return {
    computeTotalXP: computeTotalXP,
    computeDailyXP: computeDailyXP,
    computeWeeklyXP: computeWeeklyXP,
    dailyXP: dailyXP,
    weeklyXP: weeklyXP,
    getLevel: getLevel,
    getXPInLevel: getXPInLevel,
    levelCost: levelCost,
    xpToReach: xpToReach,
    XP_PER_LEVEL: XP_PER_LEVEL,
    XP_STEP: XP_STEP
  };
})();
