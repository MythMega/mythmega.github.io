// stats.js — Page de statistiques (Daily, Weekly, Marathon) — avec Niveau / XP
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

  // ── XP & Level calculation ───────────────────────────────
  function computeXP(dailyHistory, weeklyHistory) {
    let xp = 0;

    // ― Daily XP ―
    for (const date in dailyHistory) {
      const entry = dailyHistory[date];
      const results = entry.results || [];
      let dayPerfect = entry.score === MAX_SCORE;
      let dayFinished = results.some(r => r && r.outcome === 'win') || results.length === COUNT;

      // Si le daily est fini (tous les rounds ont un résultat)
      if (results.length === COUNT) {
        dayFinished = true;
        // Vérifier si tous sont des wins
        const allWins = results.every(r => r && r.outcome === 'win');
        // Si tous wins et score max => parfait
        dayPerfect = allWins && entry.score === MAX_SCORE;
      }

      if (dayFinished) xp += 3;                     // Daily fini
      if (dayPerfect) xp += 2;                      // Daily parfait bonus

      // Rounds parfaits (1er essai)
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r && r.outcome === 'win' && r.attempts === 0) {
          xp += 1;  // +1 XP par round parfait
        }
      }
    }

    // ― Weekly XP (×2 par rapport au daily) ―
    for (const date in weeklyHistory) {
      const entry = weeklyHistory[date];
      const results = entry.results || [];

      // Weekly fini = results.length === WEEKLY_COUNT
      if (results.length === WEEKLY_COUNT) {
        const allWins = results.every(r => r && r.outcome === 'win');
        xp += 3 * 2;  // Weekly fini = +6 XP
        if (allWins && entry.score === WEEKLY_MAX) {
          xp += 2 * 2; // Weekly parfait bonus = +4 XP
        }
      }

      // Rounds parfaits ×2
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r && r.outcome === 'win' && r.attempts === 0) {
          xp += 1 * 2;  // +2 XP par round parfait weekly
        }
      }
    }

    // ― Marathon XP ―
    const bestScore = parseInt(getCookie('pk_best') || '0', 10);
    const bestStreak = parseInt(getCookie('pk_best_streak') || '0', 10);
    if (bestScore > 0 || bestStreak > 0) {
      xp += Math.floor(bestScore / 5) + (bestStreak * 2);
    }

    return Math.max(0, xp);
  }

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

    // Charge les données pour calculer XP
    const [dailyHistory, weeklyHistory] = await Promise.all([
      loadDailyHistory(),
      loadWeeklyHistory()
    ]);

    const totalXP = computeXP(dailyHistory, weeklyHistory);
    renderLevelAndXP(totalXP);

    const tabDailyBtn    = document.getElementById('statsTabDailyBtn');
    const tabWeeklyBtn   = document.getElementById('statsTabWeeklyBtn');
    const tabMarathonBtn = document.getElementById('statsTabMarathonBtn');
    const dailyPanel     = document.getElementById('statsDailyPanel');
    const weeklyPanel    = document.getElementById('statsWeeklyPanel');
    const marathonPanel  = document.getElementById('statsMarathonPanel');
    const totalDaysEl    = document.getElementById('totalDays');

    let weeklyRendered = false, marathonRendered = false;

    async function renderDaily() {
      totalDaysEl.textContent = Object.keys(dailyHistory).length;
      renderDetailedStats(dailyHistory, 'statsDetailedStats', COUNT, MAX_SCORE);
    }

    async function renderWeekly() {
      totalDaysEl.textContent = Object.keys(weeklyHistory).length;
      renderDetailedStats(weeklyHistory, 'statsWeeklyDetailedStats', WEEKLY_COUNT, WEEKLY_MAX);
    }

    if (tabDailyBtn) tabDailyBtn.addEventListener('click', () => {
      tabDailyBtn.classList.add('active'); tabWeeklyBtn.classList.remove('active'); tabMarathonBtn.classList.remove('active');
      dailyPanel.style.display = ''; weeklyPanel.style.display = 'none'; marathonPanel.style.display = 'none';
      const lbl = document.getElementById('totalCountLabel');
      if (lbl) lbl.textContent = typeof Translator !== 'undefined' ? Translator.get('history.totalDays', 'Total jours') : 'Total jours';
      renderDaily();
    });

    if (tabWeeklyBtn) tabWeeklyBtn.addEventListener('click', () => {
      tabWeeklyBtn.classList.add('active'); tabDailyBtn.classList.remove('active'); tabMarathonBtn.classList.remove('active');
      weeklyPanel.style.display = ''; dailyPanel.style.display = 'none'; marathonPanel.style.display = 'none';
      const lbl = document.getElementById('totalCountLabel');
      if (lbl) lbl.textContent = typeof Translator !== 'undefined' ? Translator.get('history.totalWeeks', 'Total semaines') : 'Total semaines';
      if (!weeklyRendered) { weeklyRendered = true; renderWeekly(); }
      else {
        loadWeeklyHistory().then(h => { totalDaysEl.textContent = Object.keys(h).length; });
      }
    });

    if (tabMarathonBtn) tabMarathonBtn.addEventListener('click', () => {
      tabMarathonBtn.classList.add('active'); tabDailyBtn.classList.remove('active'); tabWeeklyBtn.classList.remove('active');
      marathonPanel.style.display = ''; dailyPanel.style.display = 'none'; weeklyPanel.style.display = 'none';
      const lbl = document.getElementById('totalCountLabel');
      if (lbl) lbl.textContent = typeof Translator !== 'undefined' ? Translator.get('stats.marathon', 'Marathon') : 'Marathon';
      totalDaysEl.textContent = '';
      if (!marathonRendered) { marathonRendered = true; renderMarathon(); }
    });

    renderDaily();
  });
})();