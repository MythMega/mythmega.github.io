// ============================================
// StreamDex - Ball detail page (ball.js)
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  const root = document.getElementById('sd-root');
  const name = SD.getParam('ballName') || SD.getParam('name');

  if (!name) {
    SD.error(root, 'Aucun nom de ball spécifié dans l\'URL (paramètre ?ballName=).');
    return;
  }

  SD.loading(root);
  SD.setTitle(name);

  let data;
  try {
    const all = await SD.fetchJson('../Data/json/balls_list.json');
    data = all.find(b => b.Name?.toLowerCase() === name.toLowerCase());
    if (!data) throw new Error('not found');
  } catch {
    SD.error(root, `Ball "${SD.esc(name)}" introuvable.`);
    return;
  }

  SD.setTitle(data.Name);
  render(root, data);
});

function render(root, d) {
  root.innerHTML = `
    <div class="sd-page">
      <div class="sd-container">

        <!-- Breadcrumb -->
        <nav style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">
          <a href="../main.html">Accueil</a> › <a href="../balldex.html">Balls</a> › ${SD.esc(d.Name)}
        </nav>

        <!-- Hero -->
        <div class="sd-hero">
          <div class="sd-hero__sprite">
            ${d.Sprite ? `<img src="${SD.esc(d.Sprite)}" alt="${SD.esc(d.Name)}" style="max-height:140px;image-rendering:pixelated;">` : ''}
          </div>
          <div class="sd-hero__info">
            <h1 class="sd-hero__name">${SD.esc(d.Name)}</h1>
            <div class="sd-hero__meta">
              ${d.IsCustom ? SD.badge('Custom', 'purple') : SD.badge('Officielle', 'blue')}
              ${d.ExclusiveSerie ? SD.badge(`Série : ${d.ExclusiveSerie}`, 'orange') : ''}
              ${d.ExclusiveZone ? SD.badge(`Zone : ${d.ExclusiveZone}`, 'green') : ''}
            </div>
            <div class="sd-hero__stats">
              ${statBox('Catchrate', `${d.CatchRate ?? 0}%`)}
              ${statBox('Shinyrate', `${d.ShinyRate ?? 0}%`)}
              ${statBox('Bonus Catch / 100 Dex', `+${d.DexBonusCatch ?? 0}%`)}
              ${statBox('Bonus Shiny / 100 Dex', `+${d.DexBonusShiny ?? 0}%`)}
              ${statBox('Reroll non-capturé', `+${d.RerollUncaught ?? 0}%`)}
            </div>
          </div>
        </div>

        <!-- Details -->
        <div class="sd-grid sd-grid--2">
          <div class="sd-card">
            <div class="sd-card__body">
              <h2 style="font-size:16px;margin:0 0 12px;">Paramètres</h2>
              <ul class="sd-info-list">
                <li><span class="sd-info-list__label">Catchrate de base</span> <strong>${d.CatchRate ?? 0}%</strong></li>
                <li><span class="sd-info-list__label">Shinyrate de base</span> <strong>${d.ShinyRate ?? 0}%</strong></li>
                <li><span class="sd-info-list__label">Bonus catch / 100 Dex</span> <strong>+${d.DexBonusCatch ?? 0}%</strong></li>
                <li><span class="sd-info-list__label">Bonus shiny / 100 Dex</span> <strong>+${d.DexBonusShiny ?? 0}%</strong></li>
                <li><span class="sd-info-list__label">Reroll non-capturés</span> <strong>+${d.RerollUncaught ?? 0}%</strong></li>
                <li><span class="sd-info-list__label">Série exclusive</span> <strong>${d.ExclusiveSerie ? SD.esc(d.ExclusiveSerie) : 'Non'}</strong></li>
                <li><span class="sd-info-list__label">Zone exclusive</span> <strong>${d.ExclusiveZone ? SD.esc(d.ExclusiveZone) : 'Non'}</strong></li>
                ${d.ExclusiveTypeUrl ? `<li><span class="sd-info-list__label">Type exclusif</span>${SD.typeImg(d.ExclusiveTypeUrl)}</li>` : ''}
              </ul>
            </div>
          </div>
          ${d.Description ? `
          <div class="sd-card">
            <div class="sd-card__body">
              <h2 style="font-size:16px;margin:0 0 12px;">Description</h2>
              <p style="color:var(--text-secondary);line-height:1.7">${SD.esc(d.Description)}</p>
            </div>
          </div>` : ''}
        </div>

      </div>
    </div>`;
}

function statBox(label, value) {
  return `
    <div class="sd-stat-card" style="padding:12px;text-align:center;">
      <div class="sd-stat-card__value" style="font-size:20px">${value}</div>
      <div class="sd-stat-card__label">${label}</div>
    </div>`;
}
