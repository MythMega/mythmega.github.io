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
    const hasShiny = !d.isShinyLock && d.Sprite_Shiny;

    root.innerHTML = `
    <div class="sd-page">
      <div class="sd-container">

        <!-- Breadcrumb -->
        <nav style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">
          <a href="../main.html">Accueil</a> › <a href="../availablepokemon.html">Créatures</a> › ${SD.esc(d.Name_FR || d.Name_EN)}
        </nav>

        <!-- Hero -->
        <div class="sd-hero">
          <div class="sd-hero__sprite" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;">
            <div style="text-align:center;">
              <img src="${SD.esc(d.Sprite_Normal)}" alt="${SD.esc(d.Name_FR)} normal"
                style="width:128px;height:128px;object-fit:contain;image-rendering:pixelated;">
              <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Normal</div>
            </div>
            ${hasShiny ? `
            <div style="text-align:center;">
              <img src="${SD.esc(d.Sprite_Shiny)}" alt="${SD.esc(d.Name_FR)} shiny"
                style="width:128px;height:128px;object-fit:contain;image-rendering:pixelated;filter:drop-shadow(0 0 6px var(--shiny-gold));">
              <div style="font-size:11px;color:var(--shiny-gold);margin-top:4px;">✨ Shiny</div>
            </div>` : ''}
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
          </div>
        </div>

        <!-- Stats de capture -->
        <div id="capture-stats"></div>

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

    loadCaptureStats(d.Name_FR, d.Name_EN);
}

async function loadCaptureStats(nameFR, nameEN) {
    const el = document.getElementById('capture-stats');
    if (!el) return;
    try {
        const stats = await SD.fetchJson('../Data/json/pokestats.json');
        const entry = (stats.CreatureStats || []).find(c =>
            (c.Name || '').toLowerCase() === (nameFR || '').toLowerCase() ||
            (c.NameEN || '').toLowerCase() === (nameEN || '').toLowerCase()
        );
        if (!entry) {
            el.innerHTML = '<div class="sd-card" style="margin-bottom:24px;padding:20px;color:var(--text-muted);font-size:13px">Aucune capture enregistrée pour cette créature.</div>';
            return;
        }
        const fmtDate = s => s ? new Date(s).toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
        const shinyPct = entry.TotalCatch > 0 ? ((entry.TotalShiny / entry.TotalCatch) * 100).toFixed(2) : '0.00';
        el.innerHTML = `
      <div class="sd-card" style="margin-bottom:24px;padding:20px">
        <h2 style="font-size:16px;margin:0 0 16px">📊 Statistiques de capture</h2>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:16px">
          <div class="sd-stat-card"><div class="sd-stat-card__value" style="color:var(--accent-blue)">${SD.fmt(entry.TotalCatch)}</div><div class="sd-stat-card__label">Captures totales</div></div>
          <div class="sd-stat-card"><div class="sd-stat-card__value" style="color:var(--accent-green)">${SD.fmt(entry.TotalNormal)}</div><div class="sd-stat-card__label">Normaux</div></div>
          <div class="sd-stat-card"><div class="sd-stat-card__value" style="color:var(--shiny-gold)">${SD.fmt(entry.TotalShiny)}</div><div class="sd-stat-card__label">✨ Shinies</div></div>
          <div class="sd-stat-card"><div class="sd-stat-card__value" style="color:var(--shiny-gold)">${shinyPct}%</div><div class="sd-stat-card__label">Ratio shiny</div></div>
        </div>
        <ul class="sd-info-list">
          <li><span class="sd-info-list__label">Première capture</span> <strong>${fmtDate(entry.FirstCatch)}</strong></li>
          <li><span class="sd-info-list__label">Dernière capture</span>  <strong>${fmtDate(entry.LastCatch)}</strong></li>
        </ul>
      </div>`;
    } catch {
        // pokestats.json absent : on ne bloque pas le reste de la page
    }
}