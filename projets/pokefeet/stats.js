// stats.js — Page de statistiques (Daily, Weekly, Marathon) — avec Niveau / XP / Trophées
(function () {
  const DB_NAME    = 'PokefeetDB';
  const DB_VERSION = 3;
  const DAILY_STORE   = 'daily_results';
  const WEEKLY_STORE  = 'weekly_results';
  const COUNT         = 5;
  const WEEKLY_COUNT  = 10;
  const MAX_SCORE     = COUNT * 10;
  const WEEKLY_MAX    = WEEKLY_COUNT * 10;
  const XP_PER_LEVEL  = 100;
  let dbInstance = null;
  let idbTimedOut = false;
  let trophiesData = [];

  function getDB() {
    return new Promise((resolve, reject) => {
      if (idbTimedOut) { reject(new Error('IDB unavailable')); return; }
      if (dbInstance) { resolve(dbInstance); return; }
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return; settled = true;
        idbTimedOut = true;
        console.warn('[PokefeetDB] indexedDB.open() timed out');
        reject(new Error('IDB open timeout'));
      }, 5000);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => { if (settled) return; settled = true; clearTimeout(timer); reject(req.error); };
      req.onblocked = () => { if (settled) return; settled = true; clearTimeout(timer); reject(new Error('IDB upgrade blocked')); };
      req.onsuccess = () => {
        if (settled) return; settled = true; clearTimeout(timer);
        dbInstance = req.result;
        dbInstance.addEventListener('versionchange', () => { dbInstance.close(); dbInstance = null; });
        resolve(dbInstance);
      };
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(DAILY_STORE)) db.createObjectStore(DAILY_STORE, { keyPath: 'date' });
        if (!db.objectStoreNames.contains(WEEKLY_STORE)) db.createObjectStore(WEEKLY_STORE, { keyPath: 'date' });
      };
    });
  }

  async function loadDailyHistory() {
    try {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(DAILY_STORE, 'readonly');
        const store = tx.objectStore(DAILY_STORE);
        const req = store.getAll();
        req.onsuccess = () => {
          const obj = {};
          req.result.forEach(item => { obj[item.date] = { score: item.score, results: item.results }; });
          resolve(obj);
        };
        req.onerror = () => reject(req.error);
      });
    } catch (e) { console.error('Error loading daily history:', e); return {}; }
  }

  async function loadWeeklyHistory() {
    try {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(WEEKLY_STORE, 'readonly');
        const store = tx.objectStore(WEEKLY_STORE);
        const req = store.getAll();
        req.onsuccess = () => {
          const obj = {};
          req.result.forEach(item => { obj[item.date] = { score: item.score, results: item.results }; });
          resolve(obj);
        };
        req.onerror = () => reject(req.error);
      });
    } catch (e) { console.error('Error loading weekly history:', e); return {}; }
  }

  function getCookie(name) {
    const v = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
    return v ? decodeURIComponent(v.pop()) : null;
  }

  // ── Dex helpers ───────────────────────────────────────
  async function loadDexEntries() {
    try {
      const dexDBName = 'PokefeetDexDB';
      const dexReq = indexedDB.open(dexDBName, 1);
      return new Promise((resolve, reject) => {
        dexReq.onsuccess = () => {
          const ddb = dexReq.result;
          const tx = ddb.transaction('dex_entries', 'readonly');
          const store = tx.objectStore('dex_entries');
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        };
        dexReq.onerror = () => reject(dexReq.error);
      });
    } catch (e) { console.error('Error loading dex entries:', e); return []; }
  }

  async function loadPokemonList() {
    try {
      const res = await fetch('data/pokemons.json');
      return await res.json();
    } catch (e) { console.error('Error loading pokemons.json:', e); return []; }
  }

  // ── XP & Level calculation ───────────────────────────────
  function computeDailyXP(dailyHistory) {
    let xp = 0;
    for (const date in dailyHistory) {
      const entry = dailyHistory[date];
      const results = entry.results || [];
      let dayPerfect = entry.score === MAX_SCORE;
      let dayFinished = results.length === COUNT;
      if (dayFinished) xp += 3;
      if (dayPerfect) xp += 2;
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r && r.outcome === 'win' && r.attempts === 0) xp += 1;
      }
    }
    return xp;
  }

  function computeWeeklyXP(weeklyHistory) {
    let xp = 0;
    for (const date in weeklyHistory) {
      const entry = weeklyHistory[date];
      const results = entry.results || [];
      if (results.length === WEEKLY_COUNT) {
        const allWins = results.every(r => r && r.outcome === 'win');
        xp += 6;
        if (allWins && entry.score === WEEKLY_MAX) xp += 4;
      }
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r && r.outcome === 'win' && r.attempts === 0) xp += 2;
      }
    }
    return xp;
  }

  function computeMarathonXP() {
    const bestScore = parseInt(getCookie('pk_best') || '0', 10);
    const bestStreak = parseInt(getCookie('pk_best_streak') || '0', 10);
    if (bestScore > 0 || bestStreak > 0) {
      return Math.floor(bestScore / 5) + (bestStreak * 2);
    }
    return 0;
  }

  // ── Trophy checking ───────────────────────────────────────
  function countCompletedDailies(dailyHistory) {
    let count = 0;
    for (const date in dailyHistory) {
      if ((dailyHistory[date].results || []).length === COUNT) count++;
    }
    return count;
  }

  function countCompletedWeeklies(weeklyHistory) {
    let count = 0;
    for (const date in weeklyHistory) {
      if ((weeklyHistory[date].results || []).length === WEEKLY_COUNT) count++;
    }
    return count;
  }

  async function checkTrophies(dailyHistory, weeklyHistory) {
    const T = (k, f) => typeof Translator !== 'undefined' ? Translator.get(k, f) : f;
    const lang = typeof Translator !== 'undefined' ? Translator.getLanguage() : 'fr';

    const completedDailies = countCompletedDailies(dailyHistory);
    const completedWeeklies = countCompletedWeeklies(weeklyHistory);
    const marathonStreak = parseInt(getCookie('pk_best_streak') || '0', 10);

    // Dex data
    const dexEntries = await loadDexEntries();
    const foundIndices = new Set(dexEntries.filter(e => e.found).map(e => String(e.index)));
    const dexFoundCount = foundIndices.size;

    // Pokemon data by generation
    const pokemons = await loadPokemonList();
    const gens = {};
    for (const p of pokemons) {
      const g = p.Generation;
      if (!gens[g]) gens[g] = [];
      gens[g].push(String(p.Index));
    }

    const results = [];
    const progressMap = {}; // trophyId -> pct

    for (const trophy of trophiesData) {
      if (!trophy.Enabled) continue;
      let earned = false;
      const method = trophy.Obtention_Method;
      const mode = method.Mode;
      const value = method.Value;
      let pct = 0;

      switch (mode) {
        case 'Dex_Count':
          earned = dexFoundCount >= value;
          pct = Math.min(100, (dexFoundCount / value) * 100);
          break;
        case 'Daily_Count':
          earned = completedDailies >= value;
          pct = Math.min(100, (completedDailies / value) * 100);
          break;
        case 'Weekly_Count':
          earned = completedWeeklies >= value;
          pct = Math.min(100, (completedWeeklies / value) * 100);
          break;
        case 'Marathon_Streak':
          earned = marathonStreak >= value;
          pct = Math.min(100, (marathonStreak / value) * 100);
          break;
        case 'Full_Generation_Register': {
          const genIndices = gens[value] || [];
          const foundGen = genIndices.filter(idx => foundIndices.has(idx)).length;
          earned = genIndices.length > 0 && foundGen === genIndices.length;
          pct = genIndices.length > 0 ? Math.min(100, (foundGen / genIndices.length) * 100) : 0;
          break;
        }
      }

      const name = lang === 'fr' ? trophy.Name_fr : trophy.Name_en;
      const desc = lang === 'fr' ? trophy.Desc_fr : trophy.Desc_en;

      results.push({
        id: trophy.Id,
        name: name,
        desc: desc,
        xp: trophy.XP,
        picture: trophy.Picture,
        earned: earned,
        rarity: trophy.Rarity,
        obtentionMode: mode
      });
      progressMap[trophy.Id] = pct;
    }
    return { results, progressMap };
  }

  // ── Render trophies (grouped by type, sorted by ID) ─────────
  const TROPHY_TYPE_ORDER = ['Dex_Count', 'Daily_Count', 'Weekly_Count', 'Marathon_Streak', 'Full_Generation_Register'];
  const TROPHY_TYPE_LABELS = {
    'Dex_Count': 'Pokédex',
    'Daily_Count': 'Daily',
    'Weekly_Count': 'Weekly',
    'Marathon_Streak': 'Marathon',
    'Full_Generation_Register': 'Générations'
  };

  function renderTrophies(trophies, trophyProgress) {
    const container = document.getElementById('trophiesGrid');
    if (!container) return;
    container.innerHTML = '';

    // Group trophies by mode
    const groups = {};
    for (const t of trophies) {
      const mode = t.obtentionMode || 'Other';
      if (!groups[mode]) groups[mode] = [];
      groups[mode].push(t);
    }

    // Render each type section
    for (const mode of TROPHY_TYPE_ORDER) {
      const list = groups[mode];
      if (!list || !list.length) continue;
      // Sort by ID within type
      list.sort((a, b) => a.id - b.id);

      const section = document.createElement('div');
      section.className = 'trophies-section';

      const title = document.createElement('div');
      title.className = 'trophies-section-title';
      title.textContent = TROPHY_TYPE_LABELS[mode] || mode;
      section.appendChild(title);

      const grid = document.createElement('div');
      grid.className = 'trophies-grid';

      for (const t of list) {
        const div = document.createElement('div');
        div.className = 'trophy-entry' + (t.earned ? '' : ' locked');

        const iconSrc = t.picture || './icon.png';

        let progressHtml = '';
        if (!t.earned && trophyProgress && trophyProgress[t.id] !== undefined) {
          const p = trophyProgress[t.id];
          if (p > 0) progressHtml = '<div class="trophy-progress">' + Math.round(p) + '%</div>';
        }

        div.innerHTML =
          '<img class="trophy-icon" src="' + iconSrc + '" alt="' + t.name + '" onerror="this.src=\'./icon.png\'" />' +
          '<div class="trophy-name">' + t.name + '</div>' +
          '<div class="trophy-desc">' + t.desc + '</div>' +
          '<div class="trophy-xp">+' + t.xp + ' XP</div>' +
          progressHtml;

        grid.appendChild(div);
      }

      section.appendChild(grid);
      container.appendChild(section);
    }
  }

  // ── XP & Level display ───────────────────────────────────
  function getLevel(totalXP) {
    return Math.floor(totalXP / XP_PER_LEVEL) + 1;
  }

  function getXPInLevel(totalXP) {
    return totalXP % XP_PER_LEVEL;
  }

  function renderLevelAndXP(totalXP) {
    const level = getLevel(totalXP);
    const xpInLevel = getXPInLevel(totalXP);
    const pct = (xpInLevel / XP_PER_LEVEL) * 100;

    document.getElementById('statsLevel').textContent = 'Niveau ' + level;
    document.getElementById('statsTotalXP').textContent = 'XP totale: ' + totalXP;
    document.getElementById('statsXPBarFill').style.width = pct + '%';
    document.getElementById('statsXPBarText').textContent = xpInLevel + ' / ' + XP_PER_LEVEL + ' XP';
  }

  // --- Detailed stats cards ---
  function renderDetailedStats(historyObj, containerId, count, maxPts) {
    const statsEl = document.getElementById(containerId);
    if (!statsEl) return;
    const isWeekly = count === 10;
    const T = (k, f) => typeof Translator !== 'undefined' ? Translator.get(k, f) : f;
    const dates = Object.keys(historyObj).sort((a, b) => a.localeCompare(b));
    if (!dates.length) { statsEl.innerHTML = ''; return; }

    const scores = dates.map(d => typeof historyObj[d].score === 'number' ? historyObj[d].score : 0);
    const totalScore = scores.reduce((s, v) => s + v, 0);
    const bestScore = Math.max(...scores);
    const worstScore = Math.min(...scores);
    const avgGlobal = totalScore / scores.length;

    function avgLast(n) { const slice = scores.slice(-n); return slice.reduce((s, v) => s + v, 0) / slice.length; }
    const perfectDates = dates.filter(d => (historyObj[d].score || 0) === maxPts);

    let perfectRounds = 0, foundRounds = 0, failedRounds = 0;
    dates.forEach(d => {
      const results = historyObj[d].results || [];
      for (let i = 0; i < count; i++) {
        const r = results[i];
        if (!r || r.outcome !== 'win') { failedRounds++; }
        else { foundRounds++; if (r.attempts === 0) perfectRounds++; }
      }
    });
    const totalRounds = dates.length * count;

    function longestStreak(arr) {
      if (!arr.length) return 0;
      let best = 1, cur = 1;
      const step = isWeekly ? 7 : 1;
      for (let i = 1; i < arr.length; i++) {
        const diff = (new Date(arr[i] + 'T00:00:00') - new Date(arr[i - 1] + 'T00:00:00')) / 86400000;
        if (diff === step) { cur++; if (cur > best) best = cur; } else { cur = 1; }
      }
      return best;
    }
    function currentStreakOf(arr) {
      if (!arr.length) return 0;
      const today = new Date().toISOString().slice(0, 10);
      const last = arr[arr.length - 1];
      const step = isWeekly ? 7 : 1;
      const todayStep = isWeekly
        ? (function() { const d = new Date(); d.setHours(0,0,0,0); const day = d.getDay(); const mon = new Date(d); mon.setDate(d.getDate() + (day === 0 ? -6 : 1 - day)); return mon.toISOString().slice(0, 10); })()
        : today;
      const checkDate = isWeekly ? todayStep : today;
      if ((new Date(checkDate + 'T00:00:00') - new Date(last + 'T00:00:00')) / 86400000 > step) return 0;
      let count = 1;
      for (let i = arr.length - 2; i >= 0; i--) {
        if ((new Date(arr[i + 1] + 'T00:00:00') - new Date(arr[i] + 'T00:00:00')) / 86400000 === step) count++; else break;
      }
      return count;
    }

    const bestStreak = longestStreak(dates);
    const currentStreak = currentStreakOf(dates);
    const bestPerfectStreak = longestStreak(perfectDates);
    const currentPerfectStreak = currentStreakOf(perfectDates);
    const fmt = v => v.toFixed(1);
    const pct = v => v.toFixed(1) + '%';
    const unitKey = isWeekly ? 'history.stats.weekly.weeksUnit' : 'history.stats.days';
    const unitFallback = isWeekly ? 'sem' : 'j';
    const unitLabel = n => n + '\u00a0' + T(unitKey, unitFallback);

    function makeCard(titleKey, titleFallback, rows) {
      const col = document.createElement('div');
      col.className = 'col-12 col-sm-6 col-xl-3';
      col.innerHTML = '<div style="background:var(--card);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:14px;height:100%;">' +
        '<div data-i18n="' + titleKey + '" style="font-weight:700;color:var(--accent);font-size:12px;text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px;">' + titleFallback + '</div>' +
        rows.map(([lKey, lFallback, val]) =>
          '<div style="display:flex;justify-content:space-between;align-items:baseline;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04);">' +
          '<span data-i18n="' + lKey + '" style="color:var(--muted);font-size:12px;">' + lFallback + '</span>' +
          '<span style="font-weight:600;font-size:13px;padding-left:8px;text-align:right;">' + val + '</span></div>'
        ).join('') + '</div>';
      return col;
    }

    const row = document.createElement('div');
    row.className = 'row g-3';

    row.appendChild(makeCard('history.stats.global', 'Globaux', [
      [isWeekly ? 'history.stats.weekly.totalWeeksPlayed' : 'history.stats.totalDaysPlayed', isWeekly ? 'Semaines jou\u00e9es' : 'Jours jou\u00e9s', dates.length],
      ['history.stats.bestScore', 'Meilleur score', bestScore + '/' + maxPts],
      ['history.stats.worstScore', 'Pire score', worstScore + '/' + maxPts],
      [isWeekly ? 'history.stats.weekly.perfectWeeks' : 'history.stats.perfectDays', isWeekly ? 'Semaines parfaites' : 'Jours parfaits', perfectDates.length + ' (' + pct(perfectDates.length / dates.length * 100) + ')'],
      ['history.stats.totalScore', 'Score total', totalScore],
    ]));

    row.appendChild(makeCard('history.stats.averages', 'Moyennes', [
      ['history.stats.avgGlobal', 'Globale', fmt(avgGlobal) + '/' + maxPts],
      [isWeekly ? 'history.stats.weekly.avg4' : 'history.stats.avg7', isWeekly ? '4 derni\u00e8res semaines' : '7 derniers jours', fmt(avgLast(isWeekly ? 4 : 7)) + '/' + maxPts],
      [isWeekly ? 'history.stats.weekly.avg12' : 'history.stats.avg30', isWeekly ? '12 derni\u00e8res semaines' : '30 derniers jours', fmt(avgLast(isWeekly ? 12 : 30)) + '/' + maxPts],
      [isWeekly ? 'history.stats.weekly.avg52' : 'history.stats.avg90', isWeekly ? '52 derni\u00e8res semaines' : '90 derniers jours', fmt(avgLast(isWeekly ? 52 : 90)) + '/' + maxPts],
    ]));

    row.appendChild(makeCard('history.stats.streaks', 'S\u00e9ries', [
      ['history.stats.bestStreak', 'Meilleure s\u00e9rie', unitLabel(bestStreak)],
      ['history.stats.currentStreak', 'S\u00e9rie actuelle', unitLabel(currentStreak)],
      ['history.stats.bestPerfectStreak', 'Meill. parfaite', unitLabel(bestPerfectStreak)],
      ['history.stats.currentPerfectStreak', 'Parfaite actuelle', unitLabel(currentPerfectStreak)],
    ]));

    row.appendChild(makeCard('history.stats.rounds', 'Rounds', [
      ['history.stats.totalRounds', 'Total jou\u00e9s', totalRounds],
      ['history.stats.perfectRounds', 'Parfaits \u{1F7E9}', perfectRounds + ' (' + pct(perfectRounds / totalRounds * 100) + ')'],
      ['history.stats.foundRounds', 'Trouv\u00e9s \u{1F7E9}\u{1F7E7}', foundRounds + ' (' + pct(foundRounds / totalRounds * 100) + ')'],
      ['history.stats.failedRounds', 'Rat\u00e9s \u{1F7E5}', failedRounds + ' (' + pct(failedRounds / totalRounds * 100) + ')'],
    ]));

    statsEl.innerHTML = '<h3 data-i18n="history.stats.title" class="h5 mb-3" style="color:#fff;">' + T('history.stats.title', 'Statistiques d\u00e9taill\u00e9es') + '</h3>';
    statsEl.appendChild(row);
    if (typeof applyTranslations === 'function') applyTranslations();
  }

  // --- Marathon stats ---
  function renderMarathon() {
    document.getElementById('marathonBestScore').textContent = parseInt(getCookie('pk_best') || '0', 10);
    document.getElementById('marathonBestStreak').textContent = parseInt(getCookie('pk_best_streak') || '0', 10);
  }

  // --- Pseudo display ---
  function updatePseudo() {
    const pseudo = getCookie('pk_pseudo');
    const el = document.getElementById('statsPseudo');
    if (el) el.textContent = pseudo || '\u2014';
  }

  // --- Init ---
  document.addEventListener('DOMContentLoaded', async () => {
    if (typeof Migration !== 'undefined') await Migration.ready;

    updatePseudo();

    // Load trophies data
    try {
      const res = await fetch('data/trophies.json');
      trophiesData = await res.json();
    } catch (e) {
      console.error('Error loading trophies:', e);
      trophiesData = [];
    }

    // Load game data
    const [dailyHistory, weeklyHistory] = await Promise.all([
      loadDailyHistory(),
      loadWeeklyHistory()
    ]);

    // Compute base XP
    let totalXP = 0;
    totalXP += computeDailyXP(dailyHistory);
    totalXP += computeWeeklyXP(weeklyHistory);
    totalXP += computeMarathonXP();

    // Check trophies and add their XP
    const trophyResult = await checkTrophies(dailyHistory, weeklyHistory);
    const trophies = trophyResult.results;
    const trophyProgress = trophyResult.progressMap;
    let trophyXP = 0;
    for (const t of trophies) {
      if (t.earned) trophyXP += t.xp;
    }
    totalXP += trophyXP;

    renderLevelAndXP(totalXP);

    // Store trophies for tab
    window.__trophiesData = trophies;
    window.__trophyProgress = trophyProgress;

    const tabDailyBtn    = document.getElementById('statsTabDailyBtn');
    const tabWeeklyBtn   = document.getElementById('statsTabWeeklyBtn');
    const tabMarathonBtn = document.getElementById('statsTabMarathonBtn');
    const tabTrophiesBtn = document.getElementById('statsTabTrophiesBtn');
    const dailyPanel     = document.getElementById('statsDailyPanel');
    const weeklyPanel    = document.getElementById('statsWeeklyPanel');
    const marathonPanel  = document.getElementById('statsMarathonPanel');
    const trophiesPanel  = document.getElementById('statsTrophiesPanel');
    const totalDaysEl    = document.getElementById('totalDays');

    let weeklyRendered = false, marathonRendered = false, trophiesRendered = false;

    // Compute total Pokemon count for marathon display
    let totalPokemonCount = 0;
    try {
      const pokemons = await loadPokemonList();
      totalPokemonCount = pokemons.length;
    } catch (e) { totalPokemonCount = 0; }

    const trophyTotal = trophies.length;
    const trophyEarned = trophies.filter(t => t.earned).length;
    const marathonBestStreak = parseInt(getCookie('pk_best_streak') || '0', 10);

    function setScoreboard(label, value) {
      const lbl = document.getElementById('totalCountLabel');
      if (lbl) lbl.textContent = label;
      if (totalDaysEl) totalDaysEl.textContent = String(value);
    }

    async function renderDaily() {
      const total = Object.keys(dailyHistory).length;
      setScoreboard(typeof Translator !== 'undefined' ? Translator.get('history.totalDays', 'Total jours') : 'Total jours', total);
      renderDetailedStats(dailyHistory, 'statsDetailedStats', COUNT, MAX_SCORE);
    }

    async function renderWeekly() {
      const total = Object.keys(weeklyHistory).length;
      setScoreboard(typeof Translator !== 'undefined' ? Translator.get('history.totalWeeks', 'Total semaines') : 'Total semaines', total);
      renderDetailedStats(weeklyHistory, 'statsWeeklyDetailedStats', WEEKLY_COUNT, WEEKLY_MAX);
    }

    function renderMarathonTab() {
      renderMarathon();
      setScoreboard(typeof Translator !== 'undefined' ? Translator.get('stats.bestStreakLabel', 'Best streak') : 'Best streak', marathonBestStreak);
    }

    function renderTrophiesTab() {
      if (window.__trophiesData) renderTrophies(window.__trophiesData, window.__trophyProgress);
      setScoreboard(typeof Translator !== 'undefined' ? Translator.get('stats.trophies', 'Troph\u00e9es') : 'Troph\u00e9es', trophyEarned + ' / ' + trophyTotal);
    }

    function onTabClick(activeBtn, panel, renderFn) {
      [tabDailyBtn, tabWeeklyBtn, tabMarathonBtn, tabTrophiesBtn].forEach(b => b?.classList.remove('active'));
      [dailyPanel, weeklyPanel, marathonPanel, trophiesPanel].forEach(p => { if (p) p.style.display = 'none'; });
      if (activeBtn) activeBtn.classList.add('active');
      if (panel) panel.style.display = '';
      if (renderFn) renderFn();
    }

    if (tabDailyBtn) tabDailyBtn.addEventListener('click', () => {
      onTabClick(tabDailyBtn, dailyPanel, renderDaily);
    });

    if (tabWeeklyBtn) tabWeeklyBtn.addEventListener('click', () => {
      onTabClick(tabWeeklyBtn, weeklyPanel, () => {
        if (!weeklyRendered) { weeklyRendered = true; renderWeekly(); }
        else {
          const total = Object.keys(weeklyHistory).length;
          setScoreboard(typeof Translator !== 'undefined' ? Translator.get('history.totalWeeks', 'Total semaines') : 'Total semaines', total);
        }
      });
    });

    if (tabMarathonBtn) tabMarathonBtn.addEventListener('click', () => {
      onTabClick(tabMarathonBtn, marathonPanel, () => {
        if (!marathonRendered) { marathonRendered = true; renderMarathonTab(); }
        else { setScoreboard(typeof Translator !== 'undefined' ? Translator.get('stats.bestStreakLabel', 'Best streak') : 'Best streak', marathonBestStreak); }
      });
    });

    if (tabTrophiesBtn) tabTrophiesBtn.addEventListener('click', () => {
      onTabClick(tabTrophiesBtn, trophiesPanel, () => {
        if (!trophiesRendered) { trophiesRendered = true; renderTrophiesTab(); }
        else { setScoreboard(typeof Translator !== 'undefined' ? Translator.get('stats.trophies', 'Troph\u00e9es') : 'Troph\u00e9es', trophyEarned + ' / ' + trophyTotal); }
      });
    });

    // Initial render (daily)
    renderDaily();
  });
})();
