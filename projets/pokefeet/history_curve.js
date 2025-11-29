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

  function getLastNScores(historyObj, n = 30) {
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
    const last = getLastNScores(history, 30); // ascending
    drawChart(last);
  }

  // redraw on resize for crispness
  window.addEventListener('resize', async () => {
    // keep canvas pixel ratio crisp
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(canvas.clientWidth * ratio);
    canvas.height = Math.floor(canvas.clientHeight * ratio);
    const history = await loadHistory();
    drawChart(getLastNScores(history, 30));
  });

  // set initial canvas size for device pixel ratio
  (function setCanvasSize() {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(canvas.clientWidth * ratio);
    canvas.height = Math.floor(canvas.clientHeight * ratio);
  })();

  init();
})();
