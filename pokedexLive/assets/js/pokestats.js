// ============================================
// StreamDex - Pokestats page (pokestats.js)
// ============================================

const PAGE_SIZE = 40;
let allStats = [];
let filteredStats = [];
let page = 1;

document.addEventListener('DOMContentLoaded', async () => {
  const root = document.getElementById('sd-root');
  SD.loading(root);

  let data;
  try {
    data = await SD.fetchJson('Data/json/pokestats.json');
  } catch {
    SD.error(root, 'Impossible de charger les statistiques.');
    return;
  }

  allStats = data.CreatureStats || [];
  const global = data.GlobalStats || {};

  root.innerHTML = `
    <div class="sd-page">
      <div class="sd-container">
        <div class="sd-section-header">
          <h1>📊 Statistiques des créatures</h1>
          <span style="font-size:12px;color:var(--text-muted)">Mis à jour : ${fmtDate(data.LastUpdate)}</span>
        </div>

        <!-- Global stats -->
        <div class="sd-stat-grid" style="margin-bottom:24px">
          ${kpi('Total captures', SD.fmt(global.TotalCatch))}
          ${kpi('Total shiny', SD.fmt(global.TotalShiny), 'gold')}
          ${kpi('Espèces capturées', SD.fmt(global.SpeciesCaught))}
          ${kpi('Espèces shiny', SD.fmt(global.SpeciesShiny), 'gold')}
        </div>

        <div class="sd-search-bar">
          <input class="sd-input" type="text" id="search-input" placeholder="Nom de créature...">
          <select class="sd-select" id="sort-by">
            <option value="total-desc">Total captures ↓</option>
            <option value="shiny-desc">Shiny ↓</option>
            <option value="name">Nom A→Z</option>
            <option value="ratio">Ratio Shiny ↓</option>
          </select>
          <select class="sd-select" id="filter-type">
            <option value="">Tous</option>
            <option value="shiny">Avec shiny</option>
            <option value="legendary">Légendaires</option>
          </select>
          <span id="count-label" style="font-size:13px;color:var(--text-muted)"></span>
        </div>

        <div class="sd-table-wrap">
          <table class="sd-table">
            <thead>
              <tr>
                <th>Sprite</th>
                <th>Nom</th>
                <th>Total capturés</th>
                <th>Normal</th>
                <th>Shiny ✨</th>
                <th>Ratio Shiny</th>
                <th>Première capture</th>
                <th>Dernière capture</th>
              </tr>
            </thead>
            <tbody id="stats-tbody"></tbody>
          </table>
        </div>
        <div id="pagination" class="sd-pagination"></div>
      </div>
    </div>`;

  document.getElementById('search-input').addEventListener('input', SD.debounce(applyFilters));
  document.getElementById('sort-by').addEventListener('change', applyFilters);
  document.getElementById('filter-type').addEventListener('change', applyFilters);

  applyFilters();
});

function applyFilters() {
  const q = document.getElementById('search-input').value.trim();
  const s = document.getElementById('sort-by').value;
  const f = document.getElementById('filter-type').value;

  filteredStats = SD.filterItems(allStats, q, ['Name', 'NameEN']);
  if (f === 'shiny') filteredStats = filteredStats.filter(c => c.TotalShiny > 0);
  else if (f === 'legendary') filteredStats = filteredStats.filter(c => c.IsLegendary);

  if (s === 'total-desc') filteredStats.sort((a, b) => (b.TotalCatch || 0) - (a.TotalCatch || 0));
  else if (s === 'shiny-desc') filteredStats.sort((a, b) => (b.TotalShiny || 0) - (a.TotalShiny || 0));
  else if (s === 'name') filteredStats.sort((a, b) => (a.Name || '').localeCompare(b.Name || ''));
  else if (s === 'ratio') filteredStats.sort((a, b) => {
    const ra = a.TotalCatch > 0 ? a.TotalShiny / a.TotalCatch : 0;
    const rb = b.TotalCatch > 0 ? b.TotalShiny / b.TotalCatch : 0;
    return rb - ra;
  });

  document.getElementById('count-label').textContent = `${filteredStats.length} créature${filteredStats.length > 1 ? 's' : ''}`;
  page = 1;
  renderPage();
}

function renderPage() {
  const tbody = document.getElementById('stats-tbody');
  const start = (page - 1) * PAGE_SIZE;
  const slice = filteredStats.slice(start, start + PAGE_SIZE);

  if (slice.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-muted)">Aucun résultat</td></tr>`;
    renderPagination();
    return;
  }

  tbody.innerHTML = slice.map(c => {
    const ratio = c.TotalCatch > 0 ? ((c.TotalShiny / c.TotalCatch) * 100).toFixed(2) : '0.00';
    return `
    <tr>
      <td>${c.SpriteNormal ? SD.sprite(c.SpriteNormal, c.Name, 40) : '—'}</td>
      <td>
        <a href="Creature/info.html?name=${encodeURIComponent(c.Name)}">${SD.esc(c.Name)}</a>
        ${c.IsLegendary ? SD.badge('Légendaire', 'gold') : ''}
      </td>
      <td>${SD.fmt(c.TotalCatch)}</td>
      <td>${SD.fmt(c.TotalNormal)}</td>
      <td>${c.TotalShiny > 0 ? `<span style="color:var(--shiny-gold)">✨ ${SD.fmt(c.TotalShiny)}</span>` : '—'}</td>
      <td style="color:var(--text-muted);font-size:12px">${ratio}%</td>
      <td style="color:var(--text-muted);font-size:12px">${fmtDate(c.FirstCatch)}</td>
      <td style="color:var(--text-muted);font-size:12px">${fmtDate(c.LastCatch)}</td>
    </tr>`;
  }).join('');

  renderPagination();
}

function renderPagination() {
  const container = document.getElementById('pagination');
  const total = Math.ceil(filteredStats.length / PAGE_SIZE);
  if (total <= 1) { container.innerHTML = ''; return; }
  let html = '';
  if (page > 1) html += `<button class="sd-pagination__btn" onclick="goPage(${page-1})">←</button>`;
  for (let i = Math.max(1, page-2); i <= Math.min(total, page+2); i++)
    html += `<button class="sd-pagination__btn${i===page?' active':''}" onclick="goPage(${i})">${i}</button>`;
  if (page < total) html += `<button class="sd-pagination__btn" onclick="goPage(${page+1})">→</button>`;
  container.innerHTML = html;
}

function goPage(p) { page = p; renderPage(); window.scrollTo({ top: 0, behavior: 'smooth' }); }

function kpi(label, value, accent = 'blue') {
  const c = { blue: 'var(--accent-blue)', gold: 'var(--shiny-gold)', green: 'var(--accent-green)' };
  return `<div class="sd-stat-card"><div class="sd-stat-card__value" style="color:${c[accent]||c.blue}">${value}</div><div class="sd-stat-card__label">${label}</div></div>`;
}

function fmtDate(s) {
  if (!s) return '—';
  try { return new Date(s).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return s; }
}
