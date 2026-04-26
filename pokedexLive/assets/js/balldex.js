// ============================================
// StreamDex - BallDex page (balldex.js)
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  const root = document.getElementById('sd-root');
  SD.loading(root);

  let balls;
  try {
    balls = await SD.fetchJson('Data/json/balls_list.json');
  } catch {
    SD.error(root, 'Impossible de charger la liste des balls.');
    return;
  }

  root.innerHTML = `
    <div class="sd-page">
      <div class="sd-container">
        <div class="sd-section-header">
          <h1>🎱 Balls disponibles</h1>
          <span style="font-size:13px;color:var(--text-muted)">${balls.length} ball${balls.length > 1 ? 's' : ''}</span>
        </div>
        <div class="sd-search-bar">
          <input class="sd-input" type="text" id="search-input" placeholder="Nom de ball...">
          <select class="sd-select" id="filter-custom">
            <option value="">Toutes</option>
            <option value="official">Officielles</option>
            <option value="custom">Custom</option>
          </select>
          <select class="sd-select" id="sort-by">
            <option value="name">Nom A→Z</option>
            <option value="catchrate">Catchrate ↓</option>
            <option value="shinyrate">Shinyrate ↓</option>
          </select>
        </div>
        <div id="balls-grid" class="sd-grid sd-grid--auto-lg"></div>
      </div>
    </div>`;

  const grid = document.getElementById('balls-grid');
  const searchInput = document.getElementById('search-input');
  const filterCustom = document.getElementById('filter-custom');
  const sortBy = document.getElementById('sort-by');

  function render() {
    const q = searchInput.value.trim();
    const f = filterCustom.value;
    const s = sortBy.value;

    let list = SD.filterItems(balls, q, ['Name']);
    if (f === 'official') list = list.filter(b => !b.IsCustom);
    else if (f === 'custom') list = list.filter(b => b.IsCustom);

    if (s === 'name') list.sort((a, b) => (a.Name || '').localeCompare(b.Name || ''));
    else if (s === 'catchrate') list.sort((a, b) => (b.CatchRate || 0) - (a.CatchRate || 0));
    else if (s === 'shinyrate') list.sort((a, b) => (b.ShinyRate || 0) - (a.ShinyRate || 0));

    if (list.length === 0) { SD.empty(grid); return; }

    grid.innerHTML = list.map(b => `
      <a href="Ball/info.html?ballName=${encodeURIComponent(b.Name)}" class="sd-card" style="display:block;text-decoration:none;">
        <div class="sd-card__sprite">
          ${b.Sprite ? SD.sprite(b.Sprite, b.Name, 80) : '<div style="height:80px;display:flex;align-items:center;justify-content:center;font-size:32px">🎱</div>'}
        </div>
        <div class="sd-card__body">
          <div class="sd-card__title">${SD.esc(b.Name)}</div>
          <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">
            Catch: <strong>${b.CatchRate ?? 0}%</strong> &nbsp;|&nbsp; Shiny: <strong>${b.ShinyRate ?? 0}%</strong>
          </div>
          <div class="sd-card__badges" style="margin-top:6px">
            ${b.IsCustom ? SD.badge('Custom', 'purple') : ''}
            ${b.ExclusiveSerie ? SD.badge(b.ExclusiveSerie, 'blue') : ''}
            ${b.ExclusiveZone ? SD.badge(b.ExclusiveZone, 'green') : ''}
          </div>
        </div>
      </a>`).join('');
  }

  searchInput.addEventListener('input', SD.debounce(render));
  filterCustom.addEventListener('change', render);
  sortBy.addEventListener('change', render);
  render();
});
