// ============================================================
// PKServ Admin — history.js
// Module Historique : 50 dernières captures
// ============================================================

'use strict';

function initHistory() {
  document.getElementById('btn-history-refresh')?.addEventListener('click', () => {
    withBtn(document.getElementById('btn-history-refresh'), loadHistory);
  });
  document.getElementById('history-search')?.addEventListener('input', filterHistory);
  document.getElementById('history-filter-shiny')?.addEventListener('change', filterHistory);

  // Auto-load when the tab is opened
  document.querySelector('[data-tab="history"]')?.addEventListener('click', () => {
    if (!historyData.length) loadHistory();
  });
}

let historyData = [];

async function loadHistory() {
  const respEl = document.getElementById('resp-history');
  try {
    await apiGet(`Debug/CatchHistory?Count=50`);
    // The server logs to console but doesn't return JSON for this endpoint,
    // so we use the alternative approach: fetch all entries from the catch history
    // via the dedicated count parameter
    const text = await apiGet('Debug/CatchHistory?Count=50');
    // The response is a plain text log; parse each line
    historyData = parseHistoryText(text);
    renderHistory(historyData);
    showResp(respEl, `✅ ${historyData.length} entrées affichées.`, 'ok');
  } catch (e) {
    showResp(respEl, `❌ ${e.message}`, 'error');
  }
}

/** Parse the plain-text catch history response into objects. */
function parseHistoryText(raw) {
  if (!raw || !raw.trim()) return [];
  return raw.trim().split('\n')
    .filter(l => l.trim())
    .map((line, i) => {
      // Format: "2024-01-01 12:00:00 Pseudo (Platform) - PokeName (normal|shiny) - BallName"
      const match = line.match(
        /^(\S+ \S+) ([^(]+)\s*\(([^)]+)\)\s*-\s*([^(]+)\s*\(([^)]+)\)\s*-\s*(.+)$/
      );
      if (!match) return { raw: line, id: i };
      return {
        id:       i,
        time:     match[1].trim(),
        pseudo:   match[2].trim(),
        platform: match[3].trim(),
        poke:     match[4].trim(),
        statut:   match[5].trim(),   // 'normal' or 'shiny'
        ball:     match[6].trim(),
        raw:      line,
      };
    });
}

function renderHistory(data) {
  const tbody = document.getElementById('history-tbody');
  if (!tbody) return;
  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">Aucune donnée.</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(e => {
    if (e.raw && !e.pseudo) {
      return `<tr><td colspan="6" style="color:var(--text-muted);font-size:12px">${esc(e.raw)}</td></tr>`;
    }
    const shinyBadge = e.statut === 'shiny'
      ? '<span class="adm-tag adm-tag--shiny">✨ shiny</span>'
      : '<span class="adm-tag adm-tag--normal">normal</span>';
    return `<tr>
      <td style="color:var(--text-muted);font-size:12px">${esc(e.time)}</td>
      <td><strong>${esc(e.pseudo)}</strong> <span style="color:var(--text-muted);font-size:11px">(${esc(e.platform)})</span></td>
      <td>${esc(e.poke)}</td>
      <td>${shinyBadge}</td>
      <td style="color:var(--text-muted)">${esc(e.ball)}</td>
    </tr>`;
  }).join('');
}

function filterHistory() {
  const q         = (document.getElementById('history-search')?.value ?? '').toLowerCase();
  const shinyOnly = document.getElementById('history-filter-shiny')?.checked ?? false;
  const filtered  = historyData.filter(e => {
    if (shinyOnly && e.statut !== 'shiny') return false;
    if (q) {
      const haystack = `${e.pseudo} ${e.poke} ${e.ball}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
  renderHistory(filtered);
}

function esc(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initHistory);
