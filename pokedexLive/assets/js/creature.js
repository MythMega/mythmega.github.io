// ============================================
// StreamDex - Creature detail page (creature.js)
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  const root = document.getElementById('sd-root');
  const name = SD.getParam('name');

  if (!name) {
    SD.error(root, 'Aucun nom de créature spécifié dans l\'URL.');
    return;
  }

  SD.loading(root);
  SD.setTitle(name);

  let data;
  try {
    data = await SD.fetchJson(`../Data/json/creatures/${encodeURIComponent(name)}.json`);
  } catch {
    try {
      // Fallback: search in full list
      const all = await SD.fetchJson('../Data/json/creatures_list.json');
      data = all.find(c =>
        c.Name_FR?.toLowerCase() === name.toLowerCase() ||
        c.Name_EN?.toLowerCase() === name.toLowerCase()
      );
      if (!data) throw new Error('not found');
    } catch {
      SD.error(root, `Créature "${SD.esc(name)}" introuvable.`);
      return;
    }
  }

  SD.setTitle(data.Name_FR || data.Name_EN || name);
  render(root, data);
});

function render(root, d) {
  const isShiny = SD.getParam('shiny') === 'true';
  const spriteUrl = isShiny ? d.Sprite_Shiny : d.Sprite_Normal;
  const altSprite = isShiny ? d.Sprite_Normal : d.Sprite_Shiny;

  root.innerHTML = `
    <div class="sd-page">
      <div class="sd-container">

        <!-- Breadcrumb -->
        <nav style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">
          <a href="../main.html">Accueil</a> › <a href="../availablepokemon.html">Créatures</a> › ${SD.esc(d.Name_FR || d.Name_EN)}
        </nav>

        <!-- Hero -->
        <div class="sd-hero">
          <div class="sd-hero__sprite">
            <img id="hero-sprite" src="${SD.esc(spriteUrl)}" alt="${SD.esc(d.Name_FR)}">
          </div>
          <div class="sd-hero__info">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">
              <h1 class="sd-hero__name">${SD.esc(d.Name_FR)}</h1>
              ${d.Name_EN && d.Name_EN !== d.Name_FR ? `<span style="color:var(--text-secondary);font-size:18px">${SD.esc(d.Name_EN)}</span>` : ''}
            </div>
            <div class="sd-hero__meta">
              ${d.isLegendary ? SD.badge('✨ Légendaire', 'gold') : ''}
              ${d.isCustom ? SD.badge('Custom', 'purple') : ''}
              ${d.isShinyLock ? SD.badge('Shiny Lock', 'red') : SD.badge('Shiny disponible', 'gold')}
              ${d.Serie ? SD.badge(d.Serie, 'blue') : ''}
              ${d.Rarity ? SD.badge(d.Rarity, 'gray') : ''}
              ${!d.enabled ? SD.badge('Non disponible', 'gray') : SD.badge('Disponible', 'green')}
            </div>
            ${d.Type1Url || d.Type2Url ? `
            <div style="display:flex;gap:6px;margin-bottom:12px;align-items:center;">
              <span style="font-size:12px;color:var(--text-secondary)">Types :</span>
              ${d.Type1Url ? SD.typeImg(d.Type1Url) : ''}
              ${d.Type2Url ? SD.typeImg(d.Type2Url) : ''}
            </div>` : ''}
            <!-- Sprite toggle -->
            ${!d.isShinyLock ? `
            <div class="sd-sprite-toggle">
              <button class="sd-btn sd-btn--ghost" onclick="toggleSprite('${SD.esc(d.Sprite_Normal)}','${SD.esc(d.Sprite_Shiny)}')">
                Afficher le sprite ${isShiny ? 'normal' : 'shiny ✨'}
              </button>
            </div>` : ''}
          </div>
        </div>

        <!-- Two columns -->
        <div class="sd-grid sd-grid--2" style="margin-bottom:24px">

          <!-- Stats & Infos -->
          <div class="sd-card">
            <div class="sd-card__body">
              <h2 style="font-size:16px;margin:0 0 12px;">Informations</h2>
              <ul class="sd-info-list">
                <li><span class="sd-info-list__label">Catchrate de base</span> <strong>${d.CatchRate ?? '—'}%</strong></li>
                <li><span class="sd-info-list__label">Shinyrate de base</span> <strong>${d.ShinyRate ?? '—'}%</strong></li>
                <li><span class="sd-info-list__label">Valeur Scrap (Normal)</span> <strong>${d.ValueNormal ?? '—'}</strong></li>
                <li><span class="sd-info-list__label">Valeur Scrap (Shiny)</span> <strong>${d.ValueShiny ?? '—'}</strong></li>
                <li><span class="sd-info-list__label">Prix Achat (Normal)</span> <strong>${d.PriceNormal ?? '—'}</strong></li>
                <li><span class="sd-info-list__label">Prix Achat (Shiny)</span> <strong>${d.PriceShiny ?? '—'}</strong></li>
                ${d.AltName ? `<li><span class="sd-info-list__label">Nom alternatif</span> <strong>${SD.esc(d.AltName)}</strong></li>` : ''}
              </ul>
            </div>
          </div>

          <!-- Zones -->
          <div class="sd-card">
            <div class="sd-card__body">
              <h2 style="font-size:16px;margin:0 0 12px;">Zones d'apparition</h2>
              ${d.Zones && d.Zones.length > 0
                ? d.Zones.map(z => `
                <a href="../Zone/info.html?name=${encodeURIComponent(z.name)}" class="sd-badge sd-badge--blue" style="margin:3px;font-size:12px;padding:5px 10px;">
                  ${SD.esc(z.name)}${z.dexRequired > 0 ? ` (Dex ${z.dexRequired})` : ''}${z.levelRequired > 0 ? ` (Lv${z.levelRequired})` : ''}
                </a>`).join('')
                : '<span style="color:var(--text-muted)">Pas de zone spécifique (spawn partout)</span>'}
            </div>
          </div>
        </div>

        <!-- Artists -->
        ${d.Artists && d.Artists.length > 0 ? `
        <div class="sd-card" style="margin-bottom:24px">
          <div class="sd-card__body">
            <h2 style="font-size:16px;margin:0 0 8px;">Artiste(s)</h2>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              ${d.Artists.map(a => `<a href="${SD.esc(a.link)}" target="_blank" class="sd-btn sd-btn--ghost">🎨 ${SD.esc(a.name)}</a>`).join('')}
            </div>
          </div>
        </div>` : ''}

      </div>
    </div>`;
}

let _spriteToggled = false;
function toggleSprite(normal, shiny) {
  _spriteToggled = !_spriteToggled;
  const img = document.getElementById('hero-sprite');
  const btn = document.querySelector('.sd-sprite-toggle .sd-btn');
  if (img) img.src = _spriteToggled ? shiny : normal;
  if (btn) btn.textContent = `Afficher le sprite ${_spriteToggled ? 'normal' : 'shiny ✨'}`;
}
