// history.js
(function () {
  const cookieName = 'pk_daily_result_v2';
  const COUNT = 5;

  function getCookie(name) {
    const v = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
    return v ? decodeURIComponent(v.pop()) : null;
  }

  function loadHistory() {
    const raw = getCookie(cookieName);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      return {};
    } catch (e) {
      console.error('Erreur parsing history cookie', e);
      return {};
    }
  }

  function formatDateLabel(isoDate) {
    // isoDate = YYYY-MM-DD
    const d = new Date(isoDate + 'T00:00:00');
    // format "16 Dec 2025"
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function emojiLineFromResults(results) {
    // results: array of up to COUNT items
    const arr = [];
    for (let i = 0; i < COUNT; i++) {
      const r = results && results[i];
      if (!r) {
        arr.push('🟥');
      } else if (r.outcome === 'fail') {
        arr.push('🟥');
      } else if (r.outcome === 'win') {
        arr.push(r.attempts === 0 ? '🟩' : '🟧');
      } else {
        arr.push('🟥');
      }
    }
    return arr.join('');
  }

  function render() {
    const history = loadHistory();
    const keys = Object.keys(history);
    const container = document.getElementById('historyList');
    const totalDaysEl = document.getElementById('totalDays');
    container.innerHTML = '';

    if (!keys.length) {
      container.innerHTML = '<p>Aucun résultat enregistré pour le moment.</p>';
      totalDaysEl.textContent = '0';
      return;
    }

    // trier par date décroissante (YYYY-MM-DD lexical sort fonctionne)
    keys.sort((a, b) => b.localeCompare(a));

    totalDaysEl.textContent = keys.length;

    keys.forEach(dateKey => {
      const entry = history[dateKey] || {};
      const score = entry.score || 0;
      const results = entry.results || [];
      const dateLabel = formatDateLabel(dateKey);
      const emojis = emojiLineFromResults(results);

      const row = document.createElement('div');
      row.style.padding = '10px 0';
      row.style.borderBottom = '1px solid rgba(255,255,255,0.03)';
      row.innerHTML = `<strong>${dateLabel}</strong> - Score : ${score}/${COUNT * 10} - <span style="font-family:monospace">${emojis}</span>`;
      container.appendChild(row);
    });
  }

  // auto render on DOM ready
  document.addEventListener('DOMContentLoaded', render);
})();
