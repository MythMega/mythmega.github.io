// ============================================
// StreamDex - Available Pokémon page (availablepokemon.js)
// ============================================

const PAGE_SIZE = 60;
let allCreatures = [];
let filtered = [];
let page = 1;
let allSeries = [];

document.addEventListener('DOMContentLoaded', async () => {
  const root = document.getElementById('sd-root');
  SD.loading(root);

  try {
    allCreatures = await SD.fetchJson('Data/json/creatures_list.json');
    allCreatures = allCreatures.filter(c => c.enabled);
  } catch {
    SD.error(root, 'Impossible de charger la liste des créatures.');
    return;
  }

  allSeries = [...new Set(allCreatures.map(c => c.Serie).filter(Boolean))].sort();

  root.innerHTML = `
    <div class="sd-page">
      <div class="sd-container">
        <div class="sd-section-header">
          <h1>🐾 Créatures disponibles</h1>
          <span id="count-label" style="font-size:13px;color:var(--text-muted)"></span>
        </div>
        <div class="sd-search-bar">
          <input class="sd-input" type="text" id="search-input" placeholder="Nom, série...">
          <select class="sd-select" id="filter-serie">
            <option value="">Toutes les séries</option>
            ${allSeries.map(s => `<option value="${SD.esc(s)}">${SD.esc(s)}</option>`).join('')}
          </select>
          <select class="sd-select" id="filter-special">
            <option value="">Tous</option>
            <option value="legendary">Légendaires</option>
            <option value="shiny">Shiny disponible</option>
            <option value="custom">Custom</option>
          </select>

        </div>
        <div id="creatures-grid" class="sd-grid sd-grid--auto"></div>
        <div id="pagination" class="sd-pagination"></div>
      </div>
    </div>`;

  document.getElementById('search-input').addEventListener('input', SD.debounce(applyFilters));
  document.getElementById('filter-serie').addEventListener('change', applyFilters);
  document.getElementById('filter-special').addEventListener('change', applyFilters);

  applyFilters();
});

function applyFilters() {
  const q = document.getElementById('search-input').value.trim();
  const serie = document.getElementById('filter-serie').value;
  const special = document.getElementById('filter-special').value;

  // L'ordre de creatures_list.json est conservé (pas de tri)
  filtered = SD.filterItems(allCreatures, q, ['Name_FR', 'Name_EN', 'AltName', 'Serie']);
  if (serie) filtered = filtered.filter(c => c.Serie === serie);
  if (special === 'legendary') filtered = filtered.filter(c => c.isLegendary);
  else if (special === 'shiny') filtered = filtered.filter(c => !c.isShinyLock);
  else if (special === 'custom') filtered = filtered.filter(c => c.isCustom);

  document.getElementById('count-label').textContent = `${filtered.length} créature${filtered.length > 1 ? 's' : ''}`;
  page = 1;
  renderPage();
}

function renderPage() {
  const grid = document.getElementById('creatures-grid');
  const start = (page - 1) * PAGE_SIZE;
  const slice = filtered.slice(start, start + PAGE_SIZE);

  if (slice.length === 0) { SD.empty(grid); renderPagination(); return; }

  grid.innerHTML = slice.map(c => {
    let cardClass = 'sd-card';
    if (c.isLegendary) cardClass += ' sd-card--legendary';
    else if (c.isCustom) cardClass += ' sd-card--exclusive';
    const name = c.Name_FR || c.Name_EN;
    return `
      <a href="Creature/info.html?name=${encodeURIComponent(name)}" class="${cardClass}" style="display:block;text-decoration:none;">
        <div class="sd-card__sprite">
          ${SD.sprite(c.Sprite_Normal, name, 80)}
        </div>
        <div class="sd-card__body">
          <div class="sd-card__title" title="${SD.esc(name)}">${SD.esc(name)}</div>
          <div class="sd-card__badges">
            ${c.Serie ? SD.badge(c.Serie, 'gray') : ''}
            ${c.isLegendary ? SD.badge('✨ Légendaire', 'gold') : ''}
            ${!c.isShinyLock ? '<span title="Shiny disponible">✨</span>' : ''}
            ${c.isCustom ? SD.badge('Custom', 'purple') : ''}
          </div>
        </div>
      </a>`;
  }).join('');

  renderPagination();
}

function renderPagination() {
  const container = document.getElementById('pagination');
  const total = Math.ceil(filtered.length / PAGE_SIZE);
  if (total <= 1) { container.innerHTML = ''; return; }

  let html = '';
  if (page > 1) html += `<button class="sd-pagination__btn" onclick="goPage(${page-1})">←</button>`;
  for (let i = Math.max(1, page-2); i <= Math.min(total, page+2); i++) {
    html += `<button class="sd-pagination__btn${i===page?' active':''}" onclick="goPage(${i})">${i}</button>`;
  }
  if (page < total) html += `<button class="sd-pagination__btn" onclick="goPage(${page+1})">→</button>`;
  container.innerHTML = html;
}

function goPage(p) {
  page = p;
  renderPage();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
