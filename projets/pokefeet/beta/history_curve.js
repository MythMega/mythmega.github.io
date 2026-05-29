// history_curve.js
(function () {
  const DB_NAME = 'PokefeetDB';
  const DB_VERSION = 3;
  const STORE_NAME = 'daily_results';
  const WEEKLY_STORE = 'weekly_results';
  const maxPoints = 50; // score max possible (daily: 5×10)
  const weeklyMaxPoints = 100; // score max possible (weekly: 10×10)
  const canvas = document.getElementById('historyChart');
  const ctx = canvas.getContext('2d');
  const weeklyCanvas     = document.getElementById('weeklyChart');
  const weeklyCtx        = weeklyCanvas ? weeklyCanvas.getContext('2d') : null;
  const weeklyChartStats = document.getElementById('weeklyChartStats');
  const historyListEl = document.getElementById('historyList');
  const totalDaysEl = document.getElementById('totalDays');
  const chartStats = document.getElementById('chartStats');
  let dbInstance = null;
  let versionData = null; // chargé depuis data/version.json

  function getDB() {
    return new Promise((resolve, reject) => {
      if (dbInstance) {
        resolve(dbInstance);
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onblocked = () => {
        console.warn('[PokefeetDB] Upgrade blocked — please close other Pokefeet tabs and reload.');
        reject(new Error('IDB upgrade blocked'));
      };
      req.onsuccess = () => {
        dbInstance = req.result;
        dbInstance.addEventListener('versionchange', () => { dbInstance.close(); dbInstance = null; });
        resolve(dbInstance);
      };
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'date' });
        }
        if (!db.objectStoreNames.contains(WEEKLY_STORE)) {
          db.createObjectStore(WEEKLY_STORE, { keyPath: 'date' });
        }
      };
    });
  }

  async function loadHistory() {
    try {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
          const arr = req.result;
          const obj = {};
          arr.forEach(item => {
            const date = item.date;
            const { score, results } = item;
            obj[date] = { score, results };
          });
          resolve(obj);
        };
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.error('Error loading history from IndexedDB:', e);
      return {};
    }
  }

  async function loadWeeklyHistory() {
    try {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx    = db.transaction(WEEKLY_STORE, 'readonly');
        const store = tx.objectStore(WEEKLY_STORE);
        const req   = store.getAll();
        req.onsuccess = () => {
          const obj = {};
          req.result.forEach(item => {
            obj[item.date] = { score: item.score, results: item.results };
          });
          resolve(obj);
        };
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.error('Error loading weekly history from IndexedDB:', e);
      return {};
    }
  }

  function buildHistoryList(historyObj) {
    // historyObj: map date -> { score, results }
    const entries = Object.keys(historyObj).sort((a,b) => a.localeCompare(b)); // ascending by date
    historyListEl.innerHTML = '';
    if (entries.length === 0) {
      historyListEl.textContent = 'Aucun historique disponible.';
      totalDaysEl.textContent = '0';
      return [];
    }
    entries.reverse(); // newest first for display
    entries.forEach((date, i) => {
      const item = historyObj[date];
      const div = document.createElement('div');
      div.style.padding = '8px';
      div.style.borderBottom = '1px solid rgba(255,255,255,0.03)';
      div.innerHTML = `<strong>${date}</strong> — score: <strong>${item.score ?? 0}</strong><br/><span style="color:var(--muted);font-size:13px;">${(item.results||[]).map(r => r ? (r.outcome==='win' ? (r.attempts===0 ? '🟩' : '🟧') : '🟥') : '🟥').join('')}</span>`;
      historyListEl.appendChild(div);

      // Séparateur mise à jour entre cette entrée (plus récente) et la suivante (plus ancienne)
      const nextDate = entries[i + 1];
      if (nextDate && versionData) {
        versionData.forEach(v => {
          if (v.deploy_date && v.deploy_date > nextDate && v.deploy_date <= date) {
            const sep = document.createElement('div');
            sep.style.cssText = 'padding:5px 12px;background:#a16207;color:#fef9c3;font-size:12px;font-weight:700;border-radius:6px;margin:3px 0;text-align:center;letter-spacing:.03em;';
            sep.textContent = `↗ Mise à jour : ${v.Update_Name} (${v.deploy_date}) ↖`;
            historyListEl.appendChild(sep);
          }
        });
      }
    });
    totalDaysEl.textContent = String(entries.length);
    return Object.keys(historyObj).sort((a,b) => a.localeCompare(b)); // ascending dates
  }

  function getLastNScores(historyObj, n = 45) {
    const dates = Object.keys(historyObj).sort((a,b) => a.localeCompare(b)); // ascending
    const lastDates = dates.slice(-n);
    const scores = lastDates.map(d => {
      const s = historyObj[d] && typeof historyObj[d].score === 'number' ? historyObj[d].score : 0;
      return { date: d, score: s };
    });
    return scores;
  }

  function drawChart(points) {
    // points: [{date, score}, ...] ascending
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0,0,w,h);

    // padding
    const pad = 36;
    const innerW = w - pad * 2;
    const innerH = h - pad * 2;

    // background grid
    ctx.fillStyle = 'rgba(255,255,255,0.02)';
    ctx.fillRect(0,0,w,h);

    // draw horizontal grid lines and labels (0..maxPoints)
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.font = '12px Inter, Arial';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    const steps = 5;
    for (let i = 0; i <= steps; i++) {
      const y = pad + (innerH * i / steps);
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(pad + innerW, y);
      ctx.stroke();
      const val = Math.round(maxPoints - (maxPoints * i / steps));
      ctx.fillStyle = 'var(--muted, rgba(255,255,255,0.5))';
      ctx.fillText(String(val), 6, y + 4);
    }

    if (points.length === 0) {
      const _T = (k, f) => (typeof Translator !== 'undefined' ? Translator.get(k, f) : f);
      ctx.fillStyle = 'var(--muted)';
      ctx.fillText(_T('history.chartNoData', 'Pas de données'), pad + 10, pad + 20);
      return;
    }

    // compute scale
    const count = points.length;
    const xStep = innerW / Math.max(1, count - 1);
    // map scores to coordinates
    const coords = points.map((p, i) => {
      const x = pad + i * xStep;
      const y = pad + innerH * (1 - (p.score / maxPoints));
      return { x, y, score: p.score, date: p.date };
    });

    // draw area under curve (subtle)
    ctx.beginPath();
    ctx.moveTo(coords[0].x, pad + innerH);
    coords.forEach(c => ctx.lineTo(c.x, c.y));
    ctx.lineTo(coords[coords.length - 1].x, pad + innerH);
    ctx.closePath();
    ctx.fillStyle = 'rgba(22,163,74,0.08)';
    ctx.fill();

    // draw line
    ctx.beginPath();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#16a34a';
    coords.forEach((c, i) => {
      if (i === 0) ctx.moveTo(c.x, c.y);
      else ctx.lineTo(c.x, c.y);
    });
    ctx.stroke();

    // draw points
    coords.forEach(c => {
      ctx.beginPath();
      ctx.fillStyle = '#16a34a';
      ctx.arc(c.x, c.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    });

    // draw average line
    const avg = coords.reduce((s,c) => s + c.score, 0) / coords.length;
    const avgY = pad + innerH * (1 - (avg / maxPoints));
    ctx.beginPath();
    ctx.setLineDash([6,6]);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.5;
    ctx.moveTo(pad, avgY);
    ctx.lineTo(pad + innerW, avgY);
    ctx.stroke();
    ctx.setLineDash([]);

    // label average
    const _Tavg = (k, f) => (typeof Translator !== 'undefined' ? Translator.get(k, f) : f);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(_Tavg('history.chartAverage', 'Moyenne') + ': ' + avg.toFixed(1), pad + 6, avgY - 8);

    // x labels: show first, middle, last dates (short)
    ctx.fillStyle = 'var(--muted)';
    ctx.font = '11px Inter, Arial';
    const fmt = d => d;
    ctx.fillText(fmt(coords[0].date), pad, pad + innerH + 18);
    if (coords.length > 2) {
      const mid = coords[Math.floor(coords.length / 2)];
      ctx.fillText(fmt(mid.date), mid.x - 20, pad + innerH + 18);
    }
    ctx.fillText(fmt(coords[coords.length - 1].date), pad + innerW - 80, pad + innerH + 18);

    // update stats area
    const _Tcs = (k, f) => (typeof Translator !== 'undefined' ? Translator.get(k, f) : f);
    chartStats.textContent = _Tcs('history.chartDailyStats', 'Derniers {n} jours — moyenne : {avg} / {max}')
      .replace('{n}', coords.length)
      .replace('{avg}', avg.toFixed(1))
      .replace('{max}', maxPoints);

    // Lignes verticales pour les mises à jour de version
    if (versionData && coords.length > 1) {
      const firstTs = new Date(coords[0].date + 'T00:00:00').getTime();
      const lastTs  = new Date(coords[coords.length - 1].date + 'T00:00:00').getTime();
      versionData.forEach(v => {
        if (!v.deploy_date) return;
        const deployTs = new Date(v.deploy_date + 'T00:00:00').getTime();
        if (deployTs < firstTs || deployTs > lastTs) return;
        // Interpoler la position x
        let vx = coords[coords.length - 1].x;
        for (let i = 0; i < coords.length - 1; i++) {
          const t0 = new Date(coords[i].date + 'T00:00:00').getTime();
          const t1 = new Date(coords[i + 1].date + 'T00:00:00').getTime();
          if (deployTs >= t0 && deployTs <= t1) {
            const ratio = t1 === t0 ? 0 : (deployTs - t0) / (t1 - t0);
            vx = coords[i].x + ratio * (coords[i + 1].x - coords[i].x);
            break;
          }
        }
        ctx.save();
        ctx.beginPath();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = '#eab308';
        ctx.lineWidth = 2;
        ctx.moveTo(vx, pad);
        ctx.lineTo(vx, pad + innerH);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#fde047';
        ctx.font = 'bold 11px Inter, Arial';
        ctx.fillText(v.Update_Name, vx + 4, pad + 28);
        ctx.restore();
      });
    }
  }

  function drawWeeklyChart(points) {
    if (!weeklyCanvas || !weeklyCtx) return;
    const w = weeklyCanvas.width;
    const h = weeklyCanvas.height;
    weeklyCtx.clearRect(0, 0, w, h);
    const pad = 36;
    const innerW = w - pad * 2;
    const innerH = h - pad * 2;
    weeklyCtx.fillStyle = 'rgba(255,255,255,0.02)';
    weeklyCtx.fillRect(0, 0, w, h);
    weeklyCtx.strokeStyle = 'rgba(255,255,255,0.06)';
    weeklyCtx.lineWidth = 1;
    weeklyCtx.font = '12px Inter, Arial';
    const steps = 5;
    for (let i = 0; i <= steps; i++) {
      const y = pad + (innerH * i / steps);
      weeklyCtx.beginPath();
      weeklyCtx.moveTo(pad, y);
      weeklyCtx.lineTo(pad + innerW, y);
      weeklyCtx.stroke();
      const val = Math.round(weeklyMaxPoints - (weeklyMaxPoints * i / steps));
      weeklyCtx.fillStyle = 'var(--muted, rgba(255,255,255,0.5))';
      weeklyCtx.fillText(String(val), 6, y + 4);
    }
    if (points.length === 0) {
      const _TW = (k, f) => (typeof Translator !== 'undefined' ? Translator.get(k, f) : f);
      weeklyCtx.fillStyle = 'var(--muted)';
      weeklyCtx.fillText(_TW('history.chartNoData', 'Pas de données'), pad + 10, pad + 20);
      return;
    }
    const count = points.length;
    const xStep = innerW / Math.max(1, count - 1);
    const coords = points.map((p, i) => {
      const x = pad + i * xStep;
      const y = pad + innerH * (1 - (p.score / weeklyMaxPoints));
      return { x, y, score: p.score, date: p.date };
    });
    weeklyCtx.beginPath();
    weeklyCtx.moveTo(coords[0].x, pad + innerH);
    coords.forEach(c => weeklyCtx.lineTo(c.x, c.y));
    weeklyCtx.lineTo(coords[coords.length - 1].x, pad + innerH);
    weeklyCtx.closePath();
    weeklyCtx.fillStyle = 'rgba(22,163,74,0.08)';
    weeklyCtx.fill();
    weeklyCtx.beginPath();
    weeklyCtx.lineWidth = 2.5;
    weeklyCtx.strokeStyle = '#16a34a';
    coords.forEach((c, i) => {
      if (i === 0) weeklyCtx.moveTo(c.x, c.y);
      else weeklyCtx.lineTo(c.x, c.y);
    });
    weeklyCtx.stroke();
    coords.forEach(c => {
      weeklyCtx.beginPath();
      weeklyCtx.fillStyle = '#16a34a';
      weeklyCtx.arc(c.x, c.y, 3.5, 0, Math.PI * 2);
      weeklyCtx.fill();
    });
    const avg = coords.reduce((s, c) => s + c.score, 0) / coords.length;
    const avgY = pad + innerH * (1 - (avg / weeklyMaxPoints));
    weeklyCtx.beginPath();
    weeklyCtx.setLineDash([6, 6]);
    weeklyCtx.strokeStyle = 'rgba(255,255,255,0.5)';
    weeklyCtx.lineWidth = 1.5;
    weeklyCtx.moveTo(pad, avgY);
    weeklyCtx.lineTo(pad + innerW, avgY);
    weeklyCtx.stroke();
    weeklyCtx.setLineDash([]);
    const _TWavg = (k, f) => (typeof Translator !== 'undefined' ? Translator.get(k, f) : f);
    weeklyCtx.fillStyle = 'rgba(255,255,255,0.8)';
    weeklyCtx.fillText(_TWavg('history.chartAverage', 'Moyenne') + ': ' + avg.toFixed(1), pad + 6, avgY - 8);
    weeklyCtx.fillStyle = 'var(--muted)';
    weeklyCtx.font = '11px Inter, Arial';
    weeklyCtx.fillText(coords[0].date, pad, pad + innerH + 18);
    if (coords.length > 2) {
      const mid = coords[Math.floor(coords.length / 2)];
      weeklyCtx.fillText(mid.date, mid.x - 20, pad + innerH + 18);
    }
    weeklyCtx.fillText(coords[coords.length - 1].date, pad + innerW - 80, pad + innerH + 18);
    if (weeklyChartStats) {
      const T = (key, fallback) => (typeof Translator !== 'undefined' ? Translator.get(key, fallback) : fallback);
      weeklyChartStats.textContent = T('history.scoreChartWeeklyStats', `Derni\u00e8res {n} semaines \u2014 moyenne\u00a0: {avg} / {max}`)
        .replace('{n}', coords.length)
        .replace('{avg}', avg.toFixed(1))
        .replace('{max}', weeklyMaxPoints);
    }
    if (versionData && coords.length > 1) {
      const firstTs = new Date(coords[0].date + 'T00:00:00').getTime();
      const lastTs  = new Date(coords[coords.length - 1].date + 'T00:00:00').getTime();
      versionData.forEach(v => {
        if (!v.deploy_date) return;
        const deployTs = new Date(v.deploy_date + 'T00:00:00').getTime();
        if (deployTs < firstTs || deployTs > lastTs) return;
        let vx = coords[coords.length - 1].x;
        for (let i = 0; i < coords.length - 1; i++) {
          const t0 = new Date(coords[i].date + 'T00:00:00').getTime();
          const t1 = new Date(coords[i + 1].date + 'T00:00:00').getTime();
          if (deployTs >= t0 && deployTs <= t1) {
            const ratio = t1 === t0 ? 0 : (deployTs - t0) / (t1 - t0);
            vx = coords[i].x + ratio * (coords[i + 1].x - coords[i].x);
            break;
          }
        }
        weeklyCtx.save();
        weeklyCtx.beginPath();
        weeklyCtx.setLineDash([5, 4]);
        weeklyCtx.strokeStyle = '#eab308';
        weeklyCtx.lineWidth = 2;
        weeklyCtx.moveTo(vx, pad);
        weeklyCtx.lineTo(vx, pad + innerH);
        weeklyCtx.stroke();
        weeklyCtx.setLineDash([]);
        weeklyCtx.fillStyle = '#fde047';
        weeklyCtx.font = 'bold 11px Inter, Arial';
        weeklyCtx.fillText(v.Update_Name, vx + 4, pad + 28);
        weeklyCtx.restore();
      });
    }
  }

  // initial render (now async)
  async function init() {
    await PokemonVersions.load();
    versionData = PokemonVersions.getData();
    const history = await loadHistory();
    const allDates = buildHistoryList(history); // returns ascending dates
    const last = getLastNScores(history, 45); // ascending
    drawChart(last);
    renderStats(history);
  }

  function renderStats(historyObj) {
    const statsEl = document.getElementById('detailedStats');
    if (!statsEl) return;

    const COUNT = 5;
    const MAX_SCORE = COUNT * 10;
    const T = (key, fallback) => (typeof Translator !== 'undefined' ? Translator.get(key, fallback) : fallback);

    const dates = Object.keys(historyObj).sort((a, b) => a.localeCompare(b));
    if (dates.length === 0) { statsEl.innerHTML = ''; return; }

    // --- Scores ---
    const scores = dates.map(d => typeof historyObj[d].score === 'number' ? historyObj[d].score : 0);
    const totalScore = scores.reduce((s, v) => s + v, 0);
    const bestScore = Math.max(...scores);
    const worstScore = Math.min(...scores);
    const avgGlobal = totalScore / scores.length;

    function avgLast(n) {
      const slice = scores.slice(-n);
      return slice.reduce((s, v) => s + v, 0) / slice.length;
    }

    // --- Perfect days ---
    const perfectDates = dates.filter(d => (historyObj[d].score || 0) === MAX_SCORE);

    // --- Round stats ---
    let perfectRounds = 0, foundRounds = 0, failedRounds = 0;
    dates.forEach(d => {
      const results = historyObj[d].results || [];
      for (let i = 0; i < COUNT; i++) {
        const r = results[i];
        if (!r || r.outcome !== 'win') { failedRounds++; }
        else { foundRounds++; if (r.attempts === 0) perfectRounds++; }
      }
    });
    const totalRounds = dates.length * COUNT;

    // --- Streaks ---
    function longestStreak(arr) {
      if (!arr.length) return 0;
      let best = 1, cur = 1;
      for (let i = 1; i < arr.length; i++) {
        const diff = (new Date(arr[i] + 'T00:00:00') - new Date(arr[i - 1] + 'T00:00:00')) / 86400000;
        if (diff === 1) { cur++; if (cur > best) best = cur; } else { cur = 1; }
      }
      return best;
    }
    function currentStreakOf(arr) {
      if (!arr.length) return 0;
      const today = new Date().toISOString().slice(0, 10);
      const last = arr[arr.length - 1];
      const diffFromToday = (new Date(today + 'T00:00:00') - new Date(last + 'T00:00:00')) / 86400000;
      if (diffFromToday > 1) return 0;
      let count = 1;
      for (let i = arr.length - 2; i >= 0; i--) {
        const diff = (new Date(arr[i + 1] + 'T00:00:00') - new Date(arr[i] + 'T00:00:00')) / 86400000;
        if (diff === 1) count++; else break;
      }
      return count;
    }

    const bestStreak = longestStreak(dates);
    const currentStreak = currentStreakOf(dates);
    const bestPerfectStreak = longestStreak(perfectDates);
    const currentPerfectStreak = currentStreakOf(perfectDates);

    // --- Helpers ---
    const fmt = v => v.toFixed(1);
    const pct = v => v.toFixed(1) + '%';
    const daysLabel = n => n + '\u00a0' + T('history.stats.days', 'j');

    function makeCard(titleKey, titleFallback, rows) {
      const col = document.createElement('div');
      col.className = 'col-12 col-sm-6 col-xl-3';
      col.innerHTML = `
        <div style="background:var(--card);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:14px;height:100%;">
          <div data-i18n="${titleKey}" style="font-weight:700;color:var(--accent);font-size:12px;text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px;">${titleFallback}</div>
          ${rows.map(([lKey, lFallback, val]) => `
            <div style="display:flex;justify-content:space-between;align-items:baseline;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
              <span data-i18n="${lKey}" style="color:var(--muted);font-size:12px;">${lFallback}</span>
              <span style="font-weight:600;font-size:13px;padding-left:8px;text-align:right;">${val}</span>
            </div>`).join('')}
        </div>`;
      return col;
    }

    const row = document.createElement('div');
    row.className = 'row g-3';

    row.appendChild(makeCard('history.stats.global', 'Globaux', [
      ['history.stats.totalDaysPlayed', 'Jours joués', dates.length],
      ['history.stats.bestScore', 'Meilleur score', `${bestScore}/${MAX_SCORE}`],
      ['history.stats.worstScore', 'Pire score', `${worstScore}/${MAX_SCORE}`],
      ['history.stats.perfectDays', 'Jours parfaits', `${perfectDates.length} (${pct(perfectDates.length / dates.length * 100)})`],
      ['history.stats.totalScore', 'Score total', totalScore],
    ]));

    row.appendChild(makeCard('history.stats.averages', 'Moyennes', [
      ['history.stats.avgGlobal', 'Globale', `${fmt(avgGlobal)}/${MAX_SCORE}`],
      ['history.stats.avg7', '7 derniers jours', `${fmt(avgLast(7))}/${MAX_SCORE}`],
      ['history.stats.avg30', '30 derniers jours', `${fmt(avgLast(30))}/${MAX_SCORE}`],
      ['history.stats.avg90', '90 derniers jours', `${fmt(avgLast(90))}/${MAX_SCORE}`],
    ]));

    row.appendChild(makeCard('history.stats.streaks', 'Séries', [
      ['history.stats.bestStreak', 'Meilleure série', daysLabel(bestStreak)],
      ['history.stats.currentStreak', 'Série actuelle', daysLabel(currentStreak)],
      ['history.stats.bestPerfectStreak', 'Meill. parfaite', daysLabel(bestPerfectStreak)],
      ['history.stats.currentPerfectStreak', 'Parfaite actuelle', daysLabel(currentPerfectStreak)],
    ]));

    row.appendChild(makeCard('history.stats.rounds', 'Rounds', [
      ['history.stats.totalRounds', 'Total joués', totalRounds],
      ['history.stats.perfectRounds', 'Parfaits 🟩', `${perfectRounds} (${pct(perfectRounds / totalRounds * 100)})`],
      ['history.stats.foundRounds', 'Trouvés 🟩🟧', `${foundRounds} (${pct(foundRounds / totalRounds * 100)})`],
      ['history.stats.failedRounds', 'Ratés 🟥', `${failedRounds} (${pct(failedRounds / totalRounds * 100)})`],
    ]));

    statsEl.innerHTML = `<h3 data-i18n="history.stats.title" class="h5 mb-3" style="color:#fff;">Statistiques détaillées</h3>`;
    statsEl.appendChild(row);
    if (typeof applyTranslations === 'function') applyTranslations();
  }

  function renderWeeklyStats(historyObj) {
    const statsEl = document.getElementById('weeklyDetailedStats');
    if (!statsEl) return;

    const COUNT     = 10;
    const MAX_SCORE = COUNT * 10;
    const T = (key, fallback) => (typeof Translator !== 'undefined' ? Translator.get(key, fallback) : fallback);

    const dates = Object.keys(historyObj).sort((a, b) => a.localeCompare(b));
    if (dates.length === 0) { statsEl.innerHTML = ''; return; }

    const scores     = dates.map(d => typeof historyObj[d].score === 'number' ? historyObj[d].score : 0);
    const totalScore = scores.reduce((s, v) => s + v, 0);
    const bestScore  = Math.max(...scores);
    const worstScore = Math.min(...scores);
    const avgGlobal  = totalScore / scores.length;

    function avgLast(n) {
      const slice = scores.slice(-n);
      return slice.reduce((s, v) => s + v, 0) / slice.length;
    }

    const perfectDates = dates.filter(d => (historyObj[d].score || 0) === MAX_SCORE);

    let perfectRounds = 0, foundRounds = 0, failedRounds = 0;
    dates.forEach(d => {
      const results = historyObj[d].results || [];
      for (let i = 0; i < COUNT; i++) {
        const r = results[i];
        if (!r || r.outcome !== 'win') { failedRounds++; }
        else { foundRounds++; if (r.attempts === 0) perfectRounds++; }
      }
    });
    const totalRounds = dates.length * COUNT;

    // Streaks: consecutive weeks = diff of 7 days between monday dates
    function longestWeekStreak(arr) {
      if (!arr.length) return 0;
      let best = 1, cur = 1;
      for (let i = 1; i < arr.length; i++) {
        const diff = (new Date(arr[i] + 'T00:00:00') - new Date(arr[i - 1] + 'T00:00:00')) / 86400000;
        if (diff === 7) { cur++; if (cur > best) best = cur; } else { cur = 1; }
      }
      return best;
    }
    function currentWeekStreakOf(arr) {
      if (!arr.length) return 0;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dayOfWeek = today.getDay();
      const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const thisMonday = new Date(today);
      thisMonday.setDate(today.getDate() + daysToMonday);
      const thisMondayStr = thisMonday.toISOString().slice(0, 10);
      const lastMonday = new Date(thisMonday);
      lastMonday.setDate(thisMonday.getDate() - 7);
      const lastMondayStr = lastMonday.toISOString().slice(0, 10);
      const lastEntry = arr[arr.length - 1];
      if (lastEntry !== thisMondayStr && lastEntry !== lastMondayStr) return 0;
      let count = 1;
      for (let i = arr.length - 2; i >= 0; i--) {
        const diff = (new Date(arr[i + 1] + 'T00:00:00') - new Date(arr[i] + 'T00:00:00')) / 86400000;
        if (diff === 7) count++; else break;
      }
      return count;
    }

    const bestStreak          = longestWeekStreak(dates);
    const currentStreak       = currentWeekStreakOf(dates);
    const bestPerfectStreak   = longestWeekStreak(perfectDates);
    const currentPerfectStreak = currentWeekStreakOf(perfectDates);

    const fmt       = v => v.toFixed(1);
    const pct       = v => v.toFixed(1) + '%';
    const weeksLabel = n => n + '\u00a0' + T('history.stats.weekly.weeksUnit', 'sem');

    function makeCard(titleKey, titleFallback, rows) {
      const col = document.createElement('div');
      col.className = 'col-12 col-sm-6 col-xl-3';
      col.innerHTML = `
        <div style="background:var(--card);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:14px;height:100%;">
          <div data-i18n="${titleKey}" style="font-weight:700;color:var(--accent);font-size:12px;text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px;">${titleFallback}</div>
          ${rows.map(([lKey, lFallback, val]) => `
            <div style="display:flex;justify-content:space-between;align-items:baseline;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
              <span data-i18n="${lKey}" style="color:var(--muted);font-size:12px;">${lFallback}</span>
              <span style="font-weight:600;font-size:13px;padding-left:8px;text-align:right;">${val}</span>
            </div>`).join('')}
        </div>`;
      return col;
    }

    const row = document.createElement('div');
    row.className = 'row g-3';

    row.appendChild(makeCard('history.stats.global', 'Globaux', [
      ['history.stats.weekly.totalWeeksPlayed', 'Semaines jouées',   dates.length],
      ['history.stats.bestScore',               'Meilleur score',    `${bestScore}/${MAX_SCORE}`],
      ['history.stats.worstScore',              'Pire score',        `${worstScore}/${MAX_SCORE}`],
      ['history.stats.weekly.perfectWeeks',     'Semaines parfaites',`${perfectDates.length} (${pct(perfectDates.length / dates.length * 100)})`],
      ['history.stats.totalScore',              'Score total',       totalScore],
    ]));

    row.appendChild(makeCard('history.stats.averages', 'Moyennes', [
      ['history.stats.avgGlobal',          'Globale',               `${fmt(avgGlobal)}/${MAX_SCORE}`],
      ['history.stats.weekly.avg4',        '4 dernières semaines',  `${fmt(avgLast(4))}/${MAX_SCORE}`],
      ['history.stats.weekly.avg12',       '12 dernières semaines', `${fmt(avgLast(12))}/${MAX_SCORE}`],
      ['history.stats.weekly.avg52',       '52 dernières semaines', `${fmt(avgLast(52))}/${MAX_SCORE}`],
    ]));

    row.appendChild(makeCard('history.stats.streaks', 'Séries', [
      ['history.stats.bestStreak',          'Meilleure série',       weeksLabel(bestStreak)],
      ['history.stats.currentStreak',       'Série actuelle',        weeksLabel(currentStreak)],
      ['history.stats.bestPerfectStreak',   'Meill. parfaite',       weeksLabel(bestPerfectStreak)],
      ['history.stats.currentPerfectStreak','Parfaite actuelle',     weeksLabel(currentPerfectStreak)],
    ]));

    row.appendChild(makeCard('history.stats.rounds', 'Rounds', [
      ['history.stats.totalRounds',   'Total joués',    totalRounds],
      ['history.stats.perfectRounds', 'Parfaits 🟩',   `${perfectRounds} (${pct(perfectRounds / totalRounds * 100)})`],
      ['history.stats.foundRounds',   'Trouvés 🟩🟧',  `${foundRounds} (${pct(foundRounds / totalRounds * 100)})`],
      ['history.stats.failedRounds',  'Ratés 🟥',       `${failedRounds} (${pct(failedRounds / totalRounds * 100)})`],
    ]));

    statsEl.innerHTML = `<h3 data-i18n="history.stats.title" class="h5 mb-3" style="color:#fff;">Statistiques détaillées</h3>`;
    statsEl.appendChild(row);
    if (typeof applyTranslations === 'function') applyTranslations();
  }

  // redraw on resize for crispness
  window.addEventListener('resize', async () => {
    const ratio = window.devicePixelRatio || 1;
    canvas.width  = Math.floor(canvas.clientWidth  * ratio);
    canvas.height = Math.floor(canvas.clientHeight * ratio);
    const history = await loadHistory();
    drawChart(getLastNScores(history, 45));
    if (weeklyCanvas && weeklyCtx && weeklyCanvas.clientWidth > 0) {
      weeklyCanvas.width  = Math.floor(weeklyCanvas.clientWidth  * ratio);
      weeklyCanvas.height = Math.floor(weeklyCanvas.clientHeight * ratio);
      const wHistory = await loadWeeklyHistory();
      drawWeeklyChart(getLastNScores(wHistory, 45));
    }
  });

  // set initial canvas size for device pixel ratio
  (function () {
    const ratio = window.devicePixelRatio || 1;
    canvas.width  = Math.floor(canvas.clientWidth  * ratio);
    canvas.height = Math.floor(canvas.clientHeight * ratio);
  })();

  window.HistoryCurve = {
    renderWeekly: async function () {
      if (!weeklyCanvas || !weeklyCtx) return;
      const ratio = window.devicePixelRatio || 1;
      weeklyCanvas.width  = Math.floor(weeklyCanvas.clientWidth  * ratio);
      weeklyCanvas.height = Math.floor(weeklyCanvas.clientHeight * ratio);
      const wHistory = await loadWeeklyHistory();
      drawWeeklyChart(getLastNScores(wHistory, 45));
      renderWeeklyStats(wHistory);
    }
  };

  init();
})();
