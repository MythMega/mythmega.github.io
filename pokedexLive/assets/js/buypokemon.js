// ============================================
// StreamDex - Buy Pokémon page (buypokemon.js)
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  const root = document.getElementById('sd-root');
  SD.loading(root);

  let data;
  try {
    data = await SD.fetchJson('Data/json/buypokemon.json');
  } catch {
    SD.error(root, 'Impossible de charger la liste d\'achat.');
    return;
  }

  const items = data.Items || [];
  const cmdBuy = data.CmdBuy || '!buy';

  root.innerHTML = `
    <div class="sd-page">
      <div class="sd-container">
        <div class="sd-section-header">
          <h1>🛒 Boutique — Acheter des Pokémon</h1>
          <span id="count-label" style="font-size:13px;color:var(--text-muted)"></span>
        </div>
        <div class="sd-search-bar">
          <input class="sd-input" type="text" id="search-input" placeholder="Rechercher un Pokémon...">
          <select class="sd-select" id="filter-type">
            <option value="">Tous</option>
            <option value="normal">Normal disponible</option>
            <option value="shiny">Shiny disponible</option>
            <option value="both">Normal & Shiny</option>
          </select>
          <select class="sd-select" id="sort-by">
            <option value="name">Nom A→Z</option>
            <option value="price-asc">Prix Normal ↑</option>
            <option value="price-desc">Prix Normal ↓</option>
          </select>
        </div>
        <div class="sd-table-wrap">
          <table class="sd-table">
            <thead>
              <tr>
                <th>Sprite</th>
                <th>Pokémon</th>
                <th>Sprite Shiny</th>
                <th>Prix Normal</th>
                <th>Commande</th>
                <th>Prix Shiny</th>
                <th>Commande</th>
              </tr>
            </thead>
            <tbody id="buy-tbody"></tbody>
          </table>
        </div>
        <div id="empty-msg"></div>
      </div>
    </div>`;

  const tbody = document.getElementById('buy-tbody');
  const searchInput = document.getElementById('search-input');
  const filterType = document.getElementById('filter-type');
  const sortBy = document.getElementById('sort-by');
  const countLabel = document.getElementById('count-label');

  function render() {
    const q = searchInput.value.trim();
    const f = filterType.value;
    const s = sortBy.value;

    let list = SD.filterItems(items, q, ['Name', 'NameEN', 'AltName']);
    if (f === 'normal') list = list.filter(i => i.PriceNormal != null);
    else if (f === 'shiny') list = list.filter(i => i.PriceShiny != null);
    else if (f === 'both') list = list.filter(i => i.PriceNormal != null && i.PriceShiny != null);

    if (s === 'name') list.sort((a, b) => (a.Name || '').localeCompare(b.Name || ''));
    else if (s === 'price-asc') list.sort((a, b) => (a.PriceNormal ?? Infinity) - (b.PriceNormal ?? Infinity));
    else if (s === 'price-desc') list.sort((a, b) => (b.PriceNormal ?? -1) - (a.PriceNormal ?? -1));

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
        <td><a href="Creature/info.html?name=${encodeURIComponent(item.Name)}">${SD.esc(item.Name)}</a></td>
        <td>${item.SpriteShiny ? SD.sprite(item.SpriteShiny, item.Name + ' shiny', 56) : '—'}</td>
        <td>${item.PriceNormal != null ? SD.fmt(item.PriceNormal) : '—'}</td>
        <td>
          ${item.PriceNormal != null
            ? `<button class="sd-copy-btn" onclick="SD.copyText('${SD.esc(cmdBuy)} ${SD.esc(cmdName(item).replace(/ /g,'_'))} normal', this)">📋 ${SD.esc(cmdBuy)} ${SD.esc(cmdName(item))} normal</button>`
            : '—'}
        </td>
        <td>${item.PriceShiny != null ? SD.fmt(item.PriceShiny) : '—'}</td>
        <td>
          ${item.PriceShiny != null
            ? `<button class="sd-copy-btn" onclick="SD.copyText('${SD.esc(cmdBuy)} ${SD.esc(cmdName(item).replace(/ /g,'_'))} shiny', this)">📋 ${SD.esc(cmdBuy)} ${SD.esc(cmdName(item))} shiny</button>`
            : '—'}
        </td>
      </tr>`).join('');
  }

  searchInput.addEventListener('input', SD.debounce(render));
  filterType.addEventListener('change', render);
  sortBy.addEventListener('change', render);
  render();
});
