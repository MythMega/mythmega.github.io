// ============================================
// StreamDex - Zone detail page (zone.js)
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  const root = document.getElementById('sd-root');
  const name = SD.getParam('name');

  if (!name) {
    SD.error(root, 'Aucun nom de zone spécifié dans l\'URL (paramètre ?name=).');
    return;
  }

  SD.loading(root);
  SD.setTitle(name);

  let zone, creaturesInZone;
  try {
    const all = await SD.fetchJson('../Data/json/zones_list.json');
    zone = all.find(z => z.Name?.toLowerCase() === name.toLowerCase());
    if (!zone) throw new Error('not found');
  } catch {
    SD.error(root, `Zone "${SD.esc(name)}" introuvable.`);
    return;
  }

  try {
    const allCreatures = await SD.fetchJson('../Data/json/creatures_list.json');
    creaturesInZone = allCreatures.filter(c =>
      c.enabled && !c.isLock &&
      (!c.IsZoneExclusive || (c.Zones && c.Zones.some(z => z.name?.toLowerCase() === name.toLowerCase())))
    );
  } catch {
    creaturesInZone = [];
  }

  SD.setTitle(`Zone : ${zone.Name}`);
  render(root, zone, creaturesInZone, name);
});

function render(root, zone, creatures, zoneName) {
  const exclusive = creatures.filter(c => c.IsZoneExclusive && c.Zones?.length === 1);
  const shared = creatures.filter(c => !c.IsZoneExclusive || c.Zones?.length !== 1);

  root.innerHTML = `
    <div class="sd-page">
      <div class="sd-container">

        <!-- Breadcrumb -->
        <nav style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">
          <a href="../main.html">Accueil</a> › <a href="../zonedex.html">Zones</a> › ${SD.esc(zone.Name)}
        </nav>

        <!-- Hero -->
        <div class="sd-hero" style="margin-bottom:24px">
          <div class="sd-hero__info">
            <h1 class="sd-hero__name">📍 ${SD.esc(zone.Name)}</h1>
            <div class="sd-hero__meta">
              ${zone.DexRequirement > 0 ? SD.badge(`Dex requis : ${zone.DexRequirement}`, 'blue') : SD.badge('Accessible dès le départ', 'green')}
              ${zone.LevelRequirement > 0 ? SD.badge(`Niveau requis : ${zone.LevelRequirement}`, 'orange') : ''}
              ${SD.badge(`${creatures.length} créatures disponibles`, 'gray')}
              ${exclusive.length > 0 ? SD.badge(`${exclusive.length} exclusives`, 'purple') : ''}
            </div>
            ${zone.Description ? `<p style="color:var(--text-secondary);margin-top:12px">${SD.esc(zone.Description)}</p>` : ''}
          </div>
        </div>

        <!-- Search -->
        <div class="sd-search-bar">
          <input class="sd-input" type="text" id="search-input" placeholder="Rechercher une créature...">
          <select class="sd-select" id="filter-type">
            <option value="">Tous les types</option>
            <option value="exclusive">Exclusives</option>
            <option value="shared">Non-exclusives</option>
            <option value="legendary">Légendaires</option>
            <option value="shiny">Shiny disponible</option>
          </select>
          <span id="count-label" style="font-size:13px;color:var(--text-muted)"></span>
        </div>

        <!-- Creatures grid -->
        <div id="creatures-grid" class="sd-grid sd-grid--auto" style="margin-bottom:24px"></div>
      </div>
    </div>`;

  const grid = document.getElementById('creatures-grid');
  const searchInput = document.getElementById('search-input');
  const filterType = document.getElementById('filter-type');
  const countLabel = document.getElementById('count-label');

  function renderCreatures() {
    let list = [...creatures];
    const q = searchInput.value.trim().toLowerCase();
    const f = filterType.value;

    if (q) list = SD.filterItems(list, q, ['Name_FR', 'Name_EN', 'AltName', 'Serie']);
    if (f === 'exclusive') list = list.filter(c => c.IsZoneExclusive && c.Zones?.length === 1);
    else if (f === 'shared') list = list.filter(c => !c.IsZoneExclusive || c.Zones?.length !== 1);
    else if (f === 'legendary') list = list.filter(c => c.isLegendary);
    else if (f === 'shiny') list = list.filter(c => !c.isShinyLock);

    // Sort: exclusives first, then legendaries, then rest
    list.sort((a, b) => {
      if (a.IsZoneExclusive && a.Zones?.length === 1 && !(b.IsZoneExclusive && b.Zones?.length === 1)) return -1;
      if (!(a.IsZoneExclusive && a.Zones?.length === 1) && b.IsZoneExclusive && b.Zones?.length === 1) return 1;
      if (a.isLegendary && !b.isLegendary) return -1;
      if (!a.isLegendary && b.isLegendary) return 1;
      return (a.Name_FR || a.Name_EN || '').localeCompare(b.Name_FR || b.Name_EN || '');
    });

    countLabel.textContent = `${list.length} créature${list.length > 1 ? 's' : ''}`;

    if (list.length === 0) { SD.empty(grid); return; }

    grid.innerHTML = list.map(c => {
      let cardClass = 'sd-card';
      if (c.isLegendary) cardClass += ' sd-card--legendary';
      else if (c.IsZoneExclusive && c.Zones?.length === 1) cardClass += ' sd-card--exclusive';

      const displayName = c.Name_FR || c.Name_EN;
      const isExclusiveHere = c.IsZoneExclusive && c.Zones?.some(z => z.name?.toLowerCase() === zoneName.toLowerCase()) && c.Zones?.length === 1;
      const isFirstZone = c.Zones?.length > 0 && c.Zones[0].name?.toLowerCase() === zoneName.toLowerCase();

      return `
        <a href="info.html?name=${encodeURIComponent(c.Name_FR || c.Name_EN)}" class="${cardClass}" style="text-decoration:none;display:block;">
          <div class="sd-card__sprite">
            ${SD.sprite(c.Sprite_Normal, displayName, 80)}
          </div>
          <div class="sd-card__body">
            <div class="sd-card__title">${SD.esc(displayName)}</div>
            <div class="sd-card__badges">
              ${c.isLegendary ? SD.badge('Légendaire', 'gold') : ''}
              ${isExclusiveHere ? SD.badge('Exclusive', 'purple') : ''}
              ${isFirstZone && !isExclusiveHere ? SD.badge('Prioritaire', 'blue') : ''}
              ${!c.isShinyLock ? '✨' : ''}
            </div>
          </div>
        </a>`;
    }).join('');
  }

  searchInput.addEventListener('input', SD.debounce(renderCreatures));
  filterType.addEventListener('change', renderCreatures);
  renderCreatures();
}
