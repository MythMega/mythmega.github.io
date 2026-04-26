// ============================================
// StreamDex - Scrap Pokémon page (scrappokemon.js)
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  const root = document.getElementById('sd-root');
  SD.loading(root);

  let data;
  try {
    data = await SD.fetchJson('Data/json/scrappokemon.json');
  } catch {
    SD.error(root, 'Impossible de charger la liste de scrapping.');
    return;
  }

  const items = data.Items || [];
  const cmdScrap = data.CmdScrap || '!scrap';

  root.innerHTML = `
    <div class="sd-page">
      <div class="sd-container">
        <div class="sd-section-header">
          <h1>♻️ Scrapping — Valeurs</h1>
          <span id="count-label" style="font-size:13px;color:var(--text-muted)"></span>
        </div>
        <div class="sd-search-bar">
          <input class="sd-input" type="text" id="search-input" placeholder="Rechercher un Pokémon...">
          <select class="sd-select" id="filter-type">
            <option value="">Tous</option>
            <option value="legendary">Légendaires</option>
            <option value="shiny">Shiny disponible</option>
          </select>
          <select class="sd-select" id="sort-by">
            <option value="name">Nom A→Z</option>
            <option value="value-desc">Valeur Normal ↓</option>
            <option value="shiny-desc">Valeur Shiny ↓</option>
          </select>
        </div>
        <div class="sd-table-wrap">
          <table class="sd-table">
            <thead>
              <tr>
                <th>Sprite</th><th>Pokémon</th>
                <th>Sprite Shiny</th><th>Valeur Normal</th>
                <th>Commande</th><th>Valeur Shiny</th><th>Commande</th>
              </tr>
            </thead>
            <tbody id="scrap-tbody"></tbody>
          </table>
        </div>
        <div id="empty-msg"></div>
      </div>
    </div>`;

  const tbody = document.getElementById('scrap-tbody');
  const countLabel = document.getElementById('count-label');
  const searchInput = document.getElementById('search-input');
  const filterType = document.getElementById('filter-type');
  const sortBy = document.getElementById('sort-by');

  function render() {
    const q = searchInput.value.trim();
    const f = filterType.value;
    const s = sortBy.value;

    let list = SD.filterItems(items, q, ['Name', 'NameEN']);
    if (f === 'legendary') list = list.filter(i => i.IsLegendary);
    else if (f === 'shiny') list = list.filter(i => !i.IsShinyLock);

    if (s === 'name') list.sort((a, b) => (a.Name || '').localeCompare(b.Name || ''));
    else if (s === 'value-desc') list.sort((a, b) => (b.ValueNormal || 0) - (a.ValueNormal || 0));
    else if (s === 'shiny-desc') list.sort((a, b) => (b.ValueShiny || 0) - (a.ValueShiny || 0));

    countLabel.textContent = `${list.length} pokémon`;

    if (list.length === 0) {
      tbody.innerHTML = '';
      document.getElementById('empty-msg').innerHTML = '<div class="sd-empty">Aucun résultat.</div>';
      return;
    }
    document.getElementById('empty-msg').innerHTML = '';

    const cmdName = item => (item.AltName && item.AltName !== item.Name && item.AltName !== item.NameEN)
      ? item.AltName : item.Name;

    tbody.innerHTML = list.map(item => `
      <tr>
        <td>${item.SpriteNormal ? SD.sprite(item.SpriteNormal, item.Name, 56) : '—'}</td>
        <td>
          <a href="Creature/info.html?name=${encodeURIComponent(item.Name)}">${SD.esc(item.Name)}</a>
          ${item.IsLegendary ? SD.badge('Légendaire', 'gold') : ''}
        </td>
        <td>${item.SpriteShiny ? SD.sprite(item.SpriteShiny, item.Name + ' shiny', 56) : '—'}</td>
        <td>${SD.fmt(item.ValueNormal)}</td>
        <td>
          <button class="sd-copy-btn" onclick="SD.copyText('${SD.esc(cmdScrap)} ${SD.esc(cmdName(item).replace(/ /g,'_'))} normal', this)">
            📋 ${SD.esc(cmdScrap)} ${SD.esc(cmdName(item))} normal
          </button>
        </td>
        <td>${item.IsShinyLock ? '—' : SD.fmt(item.ValueShiny)}</td>
        <td>
          ${!item.IsShinyLock
            ? `<button class="sd-copy-btn" onclick="SD.copyText('${SD.esc(cmdScrap)} ${SD.esc(cmdName(item).replace(/ /g,'_'))} shiny', this)">
                📋 ${SD.esc(cmdScrap)} ${SD.esc(cmdName(item))} shiny
              </button>`
            : '—'}
        </td>
      </tr>`).join('');
  }

  searchInput.addEventListener('input', SD.debounce(render));
  filterType.addEventListener('change', render);
  sortBy.addEventListener('change', render);
  render();
});
