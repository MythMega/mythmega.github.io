// ============================================
// StreamDex - Records page (records.js)
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  const root = document.getElementById('sd-root');
  SD.loading(root);

  let data;
  try {
    data = await SD.fetchJson('Data/json/records.json');
  } catch {
    SD.error(root, 'Impossible de charger les records.');
    return;
  }

  const records = data.Records || [];

  root.innerHTML = `
    <div class="sd-page">
      <div class="sd-container">
        <div class="sd-section-header">
          <h1>🏆 Records</h1>
          <span style="font-size:13px;color:var(--text-muted)">${records.length} record${records.length > 1 ? 's' : ''}</span>
        </div>
        <div class="sd-search-bar">
          <input class="sd-input" type="text" id="search-input" placeholder="Créature, statut, type...">
          <select class="sd-select" id="filter-statut">
            <option value="">Tous les statuts</option>
            <option value="normal">Normal</option>
            <option value="shiny">Shiny</option>
          </select>
          <select class="sd-select" id="filter-type">
            <option value="">Tous les types</option>
          </select>
          <select class="sd-select" id="sort-by">
            <option value="date-desc">Date récente ↓</option>
            <option value="date-asc">Date ancienne ↑</option>
            <option value="name">Nom A→Z</option>
          </select>
        </div>
        <div class="sd-table-wrap">
          <table class="sd-table">
            <thead>
              <tr>
                <th>#</th><th>Créature</th><th>Statut</th><th>Type</th><th>Date</th>
              </tr>
            </thead>
            <tbody id="records-tbody"></tbody>
          </table>
        </div>
        <div id="empty-msg"></div>
      </div>
    </div>`;

  // Populate type filter
  const types = [...new Set(records.map(r => r.Type).filter(Boolean))].sort();
  const filterType = document.getElementById('filter-type');
  types.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t; opt.textContent = t;
    filterType.appendChild(opt);
  });

  const searchInput = document.getElementById('search-input');
  const filterStatut = document.getElementById('filter-statut');
  const sortBy = document.getElementById('sort-by');
  const tbody = document.getElementById('records-tbody');

  function render() {
    const q = searchInput.value.trim();
    const s = sortBy.value;
    const fs = filterStatut.value;
    const ft = filterType.value;

    let list = SD.filterItems(records, q, ['CreatureName', 'Statut', 'Type']);
    if (fs) list = list.filter(r => r.Statut?.toLowerCase() === fs);
    if (ft) list = list.filter(r => r.Type === ft);

    if (s === 'date-desc') list.sort((a, b) => new Date(b.Date) - new Date(a.Date));
    else if (s === 'date-asc') list.sort((a, b) => new Date(a.Date) - new Date(b.Date));
    else if (s === 'name') list.sort((a, b) => (a.CreatureName || '').localeCompare(b.CreatureName || ''));

    if (list.length === 0) {
      tbody.innerHTML = '';
      document.getElementById('empty-msg').innerHTML = '<div class="sd-empty">Aucun record trouvé.</div>';
      return;
    }
    document.getElementById('empty-msg').innerHTML = '';

    tbody.innerHTML = list.map((r, i) => `
      <tr>
        <td style="color:var(--text-muted)">${r.ID ?? i+1}</td>
        <td>
          ${r.SpriteUrl ? `${SD.sprite(r.SpriteUrl, r.CreatureName, 36)} ` : ''}
          <a href="Creature/info.html?name=${encodeURIComponent(r.CreatureName)}">${SD.esc(r.CreatureName)}</a>
        </td>
        <td>
          ${r.Statut?.toLowerCase() === 'shiny'
            ? SD.badge('✨ Shiny', 'gold')
            : SD.badge(SD.esc(r.Statut || '—'), 'gray')}
        </td>
        <td>${SD.badge(SD.esc(r.Type || '—'), 'blue')}</td>
        <td style="color:var(--text-muted);font-size:12px">${fmtDate(r.Date)}</td>
      </tr>`).join('');
  }

  searchInput.addEventListener('input', SD.debounce(render));
  filterStatut.addEventListener('change', render);
  filterType.addEventListener('change', render);
  sortBy.addEventListener('change', render);
  render();
});

function fmtDate(s) {
  if (!s) return '—';
  try { return new Date(s).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return s; }
}
