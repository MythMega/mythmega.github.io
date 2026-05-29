// history_curve.js
(function () {
  const DB_NAME = 'PokefeetDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'daily_results';
  const maxPoints = 50; // score max possible
  const canvas = document.getElementById('historyChart');
  const ctx = canvas.getContext('2d');
  const historyListEl = document.getElementById('historyList');
  const totalDaysEl = document.getElementById('totalDays');
  const chartStats = document.getElementById('chartStats');
  let dbInstance = null;

  function getDB() {
    return new Promise((resolve, reject) => {
      if (dbInstance) {
        resolve(dbInstance);
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        dbInstance = req.result;
        resolve(dbInstance);
      };
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'date' });
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
    entries.forEach(date => {
      const item = historyObj[date];
      const div = document.createElement('div');
      div.style.padding = '8px';
      div.style.borderBottom = '1px solid rgba(255,255,255,0.03)';
      div.innerHTML = `<strong>${date}</strong> — score: <strong>${item.score ?? 0}</strong><br/><span style="color:var(--muted);font-size:13px;">${(item.results||[]).map(r => r ? (r.outcome==='win' ? (r.attempts===0 ? '🟩' : '🟧') : '🟥') : '🟥').join('')}</span>`;
      historyListEl.appendChild(div);
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
      ctx.fillStyle = 'var(--muted)';
      ctx.fillText('Pas de données', pad + 10, pad + 20);
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
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText('Moyenne: ' + avg.toFixed(1), pad + 6, avgY - 8);

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
    chartStats.textContent = `Derniers ${coords.length} jours — moyenne: ${avg.toFixed(1)} / ${maxPoints}`;
  }

  // initial render (now async)
  async function init() {
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
          <div style="font-weight:700;color:var(--accent);font-size:12px;text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px;">${T(titleKey, titleFallback)}</div>
          ${rows.map(([lKey, lFallback, val]) => `
            <div style="display:flex;justify-content:space-between;align-items:baseline;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
              <span style="color:var(--muted);font-size:12px;">${T(lKey, lFallback)}</span>
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

    statsEl.innerHTML = `<h3 class="h5 mb-3" style="color:#fff;">${T('history.stats.title', 'Statistiques détaillées')}</h3>`;
    statsEl.appendChild(row);
  }

  // redraw on resize for crispness
  window.addEventListener('resize', async () => {
    // keep canvas pixel ratio crisp
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(canvas.clientWidth * ratio);
    canvas.height = Math.floor(canvas.clientHeight * ratio);
    const history = await loadHistory();
    drawChart(getLastNScores(history, 45));
  });

  // set initial canvas size for device pixel ratio
  (function setCanvasSize() {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(canvas.clientWidth * ratio);
    canvas.height = Math.floor(canvas.clientHeight * ratio);
  })();

  init();
})();
