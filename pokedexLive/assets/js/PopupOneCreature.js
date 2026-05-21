// ============================================
// StreamDex - Popup Actions par créature
// PopupOneCreature.js
// ============================================

// ── Utilitaire copie presse-papier ────────────────────────────────────────────
function _popupCopy(btn, cmd) {
    navigator.clipboard.writeText(cmd).then(() => {
        const orig = btn.textContent;
        btn.textContent = '✓ Copié !';
        btn.classList.add('poc-btn--copied');
        setTimeout(() => { btn.textContent = orig; btn.classList.remove('poc-btn--copied'); }, 1500);
    });
}

// ── Normalise un nom pour comparaison (casse, espaces) ──────────────────────
function _normName(s) { return (s || '').trim().toLowerCase(); }

// ── Recherche un pokémon achetable par nom (AltName ou Name_FR) ─────────────
function _findShopItem(pokeName) {
    const md = window._mainData;
    if (!md?.ShopData?.Items) return null;
    const n = _normName(pokeName);
    return md.ShopData.Items.find(i =>
        _normName(i.AltName) === n || _normName(i.Name_FR) === n
    ) || null;
}

// ── Recherche les évolutions possibles pour un pokémon ──────────────────────
function _findEvolutions(pokeName) {
    const md = window._mainData;
    if (!md?.EvolveData?.Evolutions) return null;
    const n = _normName(pokeName);
    return md.EvolveData.Evolutions.find(ev =>
        _normName(ev.BaseAltName) === n ||
        _normName(ev.BaseName_FR) === n ||
        _normName(ev.BaseName_EN) === n
    ) || null;
}

// ── Rend un bouton d'action ──────────────────────────────────────────────────
function _btn(label, cmd, enabled, extraClass = '') {
    const cls = `poc-btn ${extraClass} ${enabled ? '' : 'poc-btn--disabled'}`;
    const attr = enabled ? '' : 'disabled';
    const titleAttr = enabled ? `title="${cmd}"` : 'title="Conditions non remplies"';
    return `<button class="${cls}" ${attr} ${titleAttr}
    onclick="_popupCopy(this,'${cmd.replace(/'/g, "\\'")}')">${label}</button>`;
}

// ── Point d'entrée : ouvre la popup ─────────────────────────────────────────
function openCreaturePopup(entry) {
    // Supprimer une popup existante
    const existing = document.getElementById('poc-overlay');
    if (existing) existing.remove();

    const md = window._mainData;
    const cmdScrap = '!scrap';
    const cmdBuy = md?.ShopData?.CmdBuy || '!buy';
    const cmdFav = '!pokefav';
    const cmdEvolve = '!mega';
    const req = md?.EvolveData?.RequiredToEvolve ?? 3;

    const name = entry.PokeName || '';
    const normQ = entry.CountNormal || 0;
    const shinyQ = entry.CountShiny || 0;
    const money = window._userData?.CustomMoney ?? 0;

    // ── Section SCRAP ──────────────────────────────────────────────────────────
    const scrapNorm1En = normQ > 2;
    const scrapNormXEn = normQ > 2;
    const scrapNormX = normQ > 2 ? normQ - 2 : 0;
    const scrapShiny1En = shinyQ > 2;
    const scrapShinyXEn = shinyQ > 2;
    const scrapShinyX = shinyQ > 2 ? shinyQ - 2 : 0;
    const scrapBothEn = normQ >= 3 || shinyQ >= 3;

    let scrapBothLabel = '';
    if (scrapBothEn) {
        const parts = [];
        if (normQ > 2) parts.push(`${normQ - 2} normaux`);
        if (shinyQ > 2) parts.push(`${shinyQ - 2} shinies`);
        scrapBothLabel = `Scrap ${parts.join(' & ')}`;
    }

    const scrapSection = `
    <div class="poc-section">
      <div class="poc-section__title">♻️ Scrap</div>
      <div class="poc-action-grid">
        ${_btn('Scrap 1 normal', `${cmdScrap} ${name} normal`, scrapNorm1En, 'poc-btn--scrap')}
        ${scrapNormXEn || true ? _btn(`Scrap ${scrapNormX || '?'} normaux`, `${cmdScrap} ${name} fullnormal`, scrapNormXEn, 'poc-btn--scrap') : ''}
        ${_btn('Scrap 1 shiny', `${cmdScrap} ${name} shiny`, scrapShiny1En, 'poc-btn--scrap poc-btn--shiny')}
        ${scrapShinyXEn || true ? _btn(`Scrap ${scrapShinyX || '?'} shinies`, `${cmdScrap} ${name} fullshiny`, scrapShinyXEn, 'poc-btn--scrap poc-btn--shiny') : ''}
        ${_btn(scrapBothLabel || 'Scrap mix normaux & shinies',
        `${cmdScrap} ${name} complete`,
        scrapBothEn, 'poc-btn--scrap')}
      </div>
    </div>`;

    // ── Section BUY ────────────────────────────────────────────────────────────
    const shopItem = _findShopItem(name);
    const buyNameCmd = shopItem?.AltName || name;
    const hasNormPrice = shopItem?.PriceNormal != null;
    const hasShinyPrice = shopItem?.PriceShiny != null;
    const canBuyNorm = hasNormPrice && money >= (shopItem?.PriceNormal ?? Infinity);
    const canBuyShiny = hasShinyPrice && money >= (shopItem?.PriceShiny ?? Infinity);

    const buySection = `
    <div class="poc-section">
      <div class="poc-section__title">🛒 Acheter</div>
      <div class="poc-action-grid">
        ${_btn(
        hasNormPrice ? `Acheter Normal (${shopItem.PriceNormal} 💰)` : 'Non disponible (normal)',
        `${cmdBuy} ${buyNameCmd} normal`,
        canBuyNorm, 'poc-btn--buy')}
        ${_btn(
            hasShinyPrice ? `Acheter Shiny (${shopItem.PriceShiny} 💰)` : 'Non disponible (shiny)',
            `${cmdBuy} ${buyNameCmd} shiny`,
            canBuyShiny, 'poc-btn--buy poc-btn--shiny')}
      </div>
      ${money > 0 ? `<div class="poc-money-info">Votre argent : <strong>${money.toLocaleString('fr-FR')} 💰</strong></div>` : ''}
    </div>`;

    // ── Section FAVORIS ────────────────────────────────────────────────────────
    const favSection = `
    <div class="poc-section">
      <div class="poc-section__title">⭐ Favoris</div>
      <div class="poc-action-grid">
        ${_btn('Définir Normal en favori', `${cmdFav} ${name} normal`, normQ >= 1, 'poc-btn--fav')}
        ${_btn('Définir Shiny en favori ✨', `${cmdFav} ${name} shiny`, shinyQ >= 1, 'poc-btn--fav poc-btn--shiny')}
      </div>
    </div>`;

    // ── Section ÉVOLUTION ──────────────────────────────────────────────────────
    const evoData = _findEvolutions(name);
    let evolveSection = '';

    if (evoData) {
        const evos = evoData.Evolutions || [];
        const multiEvo = evos.length > 1;
        const evoButtons = [];

        // Normal
        const canEvoNorm = normQ >= req;
        if (multiEvo) {
            // Plusieurs évolutions : on ne peut pas savoir laquelle → toujours "?????"
            evoButtons.push(_btn(
                `Évoluer en ????? Normal (${normQ}/${req})`,
                `${cmdEvolve} ${name} normal`,
                canEvoNorm, 'poc-btn--evo'
            ));
        } else {
            const evo = evos[0];
            // Vérifie si on possède déjà l'évolution (dans le dex du joueur)
            const allEntries = window._allUserEntries || [];
            const ownEvo = allEntries.some(e =>
                _normName(e.PokeName) === _normName(evo.AltName) ||
                _normName(e.PokeName) === _normName(evo.Name_FR)
            );
            const evoLabel = canEvoNorm
                ? `Évoluer en ${ownEvo ? (evo.Name_FR || evo.AltName) : '?????'} Normal (${normQ}/${req})`
                : `Évoluer en ${evo.Name_FR || evo.AltName} Normal (${normQ}/${req})`;
            evoButtons.push(_btn(evoLabel, `${cmdEvolve} ${name} normal`, canEvoNorm, 'poc-btn--evo'));
        }

        // Shiny
        const canEvoShiny = shinyQ >= req;
        if (multiEvo) {
            evoButtons.push(_btn(
                `Évoluer en ????? Shiny ✨ (${shinyQ}/${req})`,
                `${cmdEvolve} ${name} shiny`,
                canEvoShiny, 'poc-btn--evo poc-btn--shiny'
            ));
        } else {
            const evo = evos[0];
            const allEntries = window._allUserEntries || [];
            const ownEvo = allEntries.some(e =>
                _normName(e.PokeName) === _normName(evo.AltName) ||
                _normName(e.PokeName) === _normName(evo.Name_FR)
            );
            const evoLabel = canEvoShiny
                ? `Évoluer en ${ownEvo ? (evo.Name_FR || evo.AltName) : '?????'} Shiny ✨ (${shinyQ}/${req})`
                : `Évoluer en ${evo.Name_FR || evo.AltName} Shiny ✨ (${shinyQ}/${req})`;
            evoButtons.push(_btn(evoLabel, `${cmdEvolve} ${name} shiny`, canEvoShiny, 'poc-btn--evo poc-btn--shiny'));
        }

        evolveSection = `
      <div class="poc-section">
        <div class="poc-section__title">🔮 Évoluer <span class="poc-req-hint">(${req} requis)</span></div>
        <div class="poc-action-grid">
          ${evoButtons.join('')}
        </div>
      </div>`;
    }

    // ── Assemblage de la popup ─────────────────────────────────────────────────
    const spriteHtml = entry.SpriteNormal
        ? `<img src="${entry.SpriteNormal}" alt="${SD.esc(name)}" class="poc-sprite">`
        : '';
    const shinyHtml = entry.SpriteShiny && shinyQ > 0
        ? `<img src="${entry.SpriteShiny}"  alt="${SD.esc(name)} shiny" class="poc-sprite poc-sprite--shiny">`
        : '';

    const overlay = document.createElement('div');
    overlay.id = 'poc-overlay';
    overlay.className = 'poc-overlay';
    overlay.innerHTML = `
    <div class="poc-modal" role="dialog" aria-modal="true" aria-label="Actions pour ${SD.esc(name)}">
      <div class="poc-modal__header">
        <div class="poc-modal__sprites">${spriteHtml}${shinyHtml}</div>
        <div class="poc-modal__title">${SD.esc(name)}</div>
        <div class="poc-modal__counts">
          <span>Normal : <strong>${normQ}</strong></span>
          ${shinyQ > 0 ? `<span>Shiny : <strong style="color:var(--shiny-gold)">✨ ${shinyQ}</strong></span>` : ''}
        </div>
        <button class="poc-close" onclick="document.getElementById('poc-overlay').remove()" aria-label="Fermer">✕</button>
      </div>
      <div class="poc-modal__body">
        ${scrapSection}
        ${buySection}
        ${favSection}
        ${evolveSection}
      </div>
    </div>`;

    // Fermer en cliquant sur l'arrière-plan
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    // Focus trap basique
    overlay.querySelector('.poc-close').focus();
}