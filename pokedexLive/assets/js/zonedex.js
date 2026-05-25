// ============================================
// StreamDex - ZoneDex page (zonedex.js)
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    const root = document.getElementById('sd-root');
    SD.loading(root);

    let zones;
    try {
        zones = await SD.fetchJson('Data/json/zones_list.json');
    } catch {
        SD.error(root, 'Impossible de charger les zones.');
        return;
    }

    root.innerHTML = `
    <div class="sd-page">
      <div class="sd-container">
        <div class="sd-section-header">
          <h1>📍 Zones</h1>
          <span style="font-size:13px;color:var(--text-muted)">${zones.length} zone${zones.length > 1 ? 's' : ''}</span>
        </div>
        <div class="sd-search-bar">
          <input class="sd-input" type="text" id="search-input" placeholder="Nom de zone...">
          <select class="sd-select" id="sort-by">
            <option value="name">Nom A→Z</option>
            <option value="dex">Dex requis ↑</option>
            <option value="level">Niveau requis ↑</option>
            <option value="count">Nb créatures ↓</option>
          </select>
        </div>
        <div id="zones-grid" class="sd-grid sd-grid--auto-lg"></div>
      </div>
    </div>`;

    const grid = document.getElementById('zones-grid');
    const searchInput = document.getElementById('search-input');
    const sortBy = document.getElementById('sort-by');

    function render() {
        const q = searchInput.value.trim();
        const s = sortBy.value;

        let list = SD.filterItems(zones, q, ['Name', 'Description']);

        if (s === 'name') list.sort((a, b) => (a.Name || '').localeCompare(b.Name || ''));
        else if (s === 'dex') list.sort((a, b) => (a.DexRequirement || 0) - (b.DexRequirement || 0));
        else if (s === 'level') list.sort((a, b) => (a.LevelRequirement || 0) - (b.LevelRequirement || 0));
        else if (s === 'count') list.sort((a, b) => (b.CreatureCount || 0) - (a.CreatureCount || 0));

        if (list.length === 0) { SD.empty(grid); return; }

        grid.innerHTML = list.map(z => `
      <a href="Zone/info.html?name=${encodeURIComponent(z.Name)}" class="sd-card" style="display:block;text-decoration:none;">
        ${z.Image
          ? `<div style="width:100%;height:120px;overflow:hidden;border-radius:var(--radius-md) var(--radius-md) 0 0;background:var(--bg-secondary);">
               <img src="${SD.esc(z.Image)}" alt="${SD.esc(z.Name)}" style="width:100%;height:120px;object-fit:cover;display:block;">
             </div>`
          : `<div style="width:100%;height:120px;border-radius:var(--radius-md) var(--radius-md) 0 0;background:var(--bg-secondary);display:flex;align-items:center;justify-content:center;font-size:40px;">📍</div>`
        }
        <div class="sd-card__body" style="padding:16px">
          <div class="sd-card__title" style="font-size:16px">${SD.esc(z.Name)}</div>
          ${z.Description ? `<p style="font-size:12px;color:var(--text-secondary);margin:6px 0">${SD.esc(z.Description)}</p>` : ''}
          <div class="sd-card__badges" style="margin-top:8px">
            ${z.CreatureCount ? SD.badge(`${z.CreatureCount} créatures`, 'gray') : ''}
            ${z.ExclusiveCount ? SD.badge(`${z.ExclusiveCount} exclusives`, 'purple') : ''}
            ${z.DexRequirement > 0 ? SD.badge(`Dex ${z.DexRequirement}`, 'blue') : SD.badge('Accessible', 'green')}
            ${z.LevelRequirement > 0 ? SD.badge(`Lv ${z.LevelRequirement}`, 'orange') : ''}
          </div>
        </div>
      </a>`).join('');
    }

    searchInput.addEventListener('input', SD.debounce(render));
    sortBy.addEventListener('change', render);
    render();
});