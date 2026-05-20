// ============================================
// StreamDex - User detail page (user.js)
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    const root = document.getElementById('sd-root');
    const platform = SD.getParam('platform');
    const username = SD.getParam('username');

    if (!platform || !username) {
        SD.error(root, 'Paramètres manquants dans l\'URL (?platform=xxx&username=xxx).');
        return;
    }

    SD.loading(root);
    SD.setTitle(`${username} (${platform})`);

    let data;
    try {
          data = await SD.fetchJson(`../Data/json/users/${encodeURIComponent(platform)}_${encodeURIComponent(username)}.json`);
        } catch {
          SD.error(root, `Utilisateur "${SD.esc(username)}" sur ${SD.esc(platform)} introuvable.`);
          return;
        }

        // Charger main.json pour les données de boutique/évolution
        try {
          window._mainData = await SD.fetchJson('../Data/json/main.json');
        } catch {
          window._mainData = null;
        }

    SD.setTitle(`${data.Pseudo} (${data.Platform})`);
    // Rendre les données user accessibles à la popup
    window._userData       = data;
    window._allUserEntries = data.Entries || [];
    render(root, data, platform, username);
});

// ── Pagination Pokédex ───────────────────────────────────────────────────────
const DEX_PAGE_SIZE = 50;

// Référence globale aux entries chargées (pour les boutons de pagination inline)
let currentEntries = [];

// Wrapper global appelé par les boutons de pagination générés dynamiquement
function renderDexGlobal(entries, page) {
    renderDex(entries, page);
}

function render(root, d, platform, username) {
    const entries = d.Entries || [];
    const normalEntries = entries.filter(e => e.CountNormal > 0);
    const shinyEntries = entries.filter(e => e.CountShiny > 0);
    const totalPokemons = d.TotalPokemons || 1;

    root.innerHTML = `
    <div class="sd-page" data-pseudo="${SD.esc(d.Pseudo)}">
      <div class="sd-container">

        <!-- Breadcrumb -->
        <nav style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">
          <a href="../main.html">Accueil</a> › Utilisateurs › ${SD.esc(d.Pseudo)}
        </nav>

        <!-- Hero -->
        <div class="sd-hero">
          <div class="sd-hero__sprite">
            ${d.AvatarUrl
            ? `<img src="${SD.esc(d.AvatarUrl)}" alt="avatar" class="sd-avatar sd-avatar--lg">`
            : `<div class="sd-avatar sd-avatar--lg" style="display:flex;align-items:center;justify-content:center;background:var(--bg-card);font-size:32px;">👤</div>`
        }
          </div>
          <div class="sd-hero__info">
            <h1 class="sd-hero__name">${SD.esc(d.Pseudo)}</h1>
            <div class="sd-hero__meta">
              ${SD.badge(d.Platform, 'blue')}
              ${d.Zone ? SD.badge(`Zone : ${d.Zone}`, 'green') : ''}
              ${d.Level ? SD.badge(`Niveau ${d.Level}`, 'orange') : ''}
            </div>
            <div class="sd-hero__stats">
              ${statBox('Balls lancées', SD.fmt(d.BallLaunched))}
              ${statBox('Poké capturés', SD.fmt(d.PokeCaught))}
              ${statBox('Shiny capturés', SD.fmt(d.ShinyCaught), 'gold')}
              ${statBox('Dex Normal', `${normalEntries.length}/${totalPokemons}`, 'blue')}
              ${statBox('Dex Shiny', `${shinyEntries.length}/${totalPokemons}`, 'gold')}
              ${statBox('Argent', SD.fmt(d.CustomMoney), 'green')}
            </div>
          </div>
        </div>

        <!-- Dex progress -->
        <div class="sd-grid sd-grid--2" style="margin-bottom:24px">
          <div class="sd-card">
            <div class="sd-card__body">
              <h2 style="font-size:15px;margin:0 0 10px">Progression Dex Normal</h2>
              ${SD.progressBar(normalEntries.length, totalPokemons)}
            </div>
          </div>
          <div class="sd-card">
            <div class="sd-card__body">
              <h2 style="font-size:15px;margin:0 0 10px">Progression Dex Shiny ✨</h2>
              ${SD.progressBar(shinyEntries.length, totalPokemons, 'sd-progress__bar--gold')}
            </div>
          </div>
        </div>

        <!-- Trainer card -->
        ${renderTrainerCardHTML(d)}

        <!-- Detailed stats -->
        <div class="sd-grid sd-grid--3" style="margin-bottom:24px">
          <div class="sd-card">
            <div class="sd-card__body">
              <h2 style="font-size:15px;margin:0 0 10px">Stats générales</h2>
              <ul class="sd-info-list">
                <li><span class="sd-info-list__label">Argent dépensé</span> <strong>${SD.fmt(d.MoneySpent)}</strong></li>
                <li><span class="sd-info-list__label">Poké reçus (normal)</span> <strong>${SD.fmt(d.GiveawayNormal)}</strong></li>
                <li><span class="sd-info-list__label">Poké reçus (shiny)</span> <strong>${SD.fmt(d.GiveawayShiny)}</strong></li>
                <li><span class="sd-info-list__label">Scraps (normal)</span> <strong>${SD.fmt(d.ScrappedNormal)}</strong></li>
                <li><span class="sd-info-list__label">Scraps (shiny)</span> <strong>${SD.fmt(d.ScrappedShiny)}</strong></li>
                <li><span class="sd-info-list__label">Trades effectués</span> <strong>${SD.fmt(d.TradeCount)}</strong></li>
                <li><span class="sd-info-list__label">Raids participés</span> <strong>${SD.fmt(d.RaidCount)}</strong></li>
                <li><span class="sd-info-list__label">Dégâts totaux (Raid)</span> <strong>${SD.fmt(d.RaidTotalDmg)}</strong></li>
              </ul>
            </div>
          </div>
          ${d.FavoriteCreature ? `
          <div class="sd-card">
            <div class="sd-card__body">
              <h2 style="font-size:15px;margin:0 0 10px">Créature favorite</h2>
              ${d.FavoriteSprite ? `<div style="text-align:center;margin-bottom:12px;">${SD.sprite(d.FavoriteSprite, d.FavoriteCreature, 96)}</div>` : ''}
              <div style="text-align:center">${SD.badge(d.FavoriteCreature, 'blue')}</div>
            </div>
          </div>` : ''}
          ${d.Badges && d.Badges.length > 0 ? `
          <div class="sd-card">
            <div class="sd-card__body">
              <h2 style="font-size:15px;margin:0 0 10px">Badges obtenus</h2>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                ${d.Badges.filter(b => b.Obtained).map(b =>
            b.ImageUrl
                ? `<img src="${SD.esc(b.ImageUrl)}" alt="${SD.esc(b.Name)}" title="${SD.esc(b.Name)}" style="height:40px;width:auto;" data-tooltip="${SD.esc(b.Name)}">`
                : SD.badge(b.Name, 'gray')
        ).join('')}
              </div>
              ${d.Level ? `<div style="margin-top:12px">${SD.progressBar(d.CurrentXP, d.MaxXP)} <span style="font-size:11px;color:var(--text-muted)">Niveau ${d.Level}</span></div>` : ''}
            </div>
          </div>` : ''}
        </div>

        <!-- Pokédex table -->
        <div class="sd-section-header">
          <h2>Pokédex (<span id="dex-count-label">${entries.length}</span> entrées)</h2>
          <div style="display:flex;gap:8px;align-items:center">
            <input class="sd-input" type="text" id="search-dex" placeholder="Rechercher..." style="min-width:160px;flex:unset;">
            <select class="sd-select" id="filter-dex">
              <option value="">Tout</option>
              <option value="normal">Normal seulement</option>
              <option value="shiny">Shiny</option>
            </select>
          </div>
        </div>
        <div class="sd-table-wrap">
          <table class="sd-table">
            <thead>
              <tr>
                <th>Sprite</th>
                <th>Nom</th>
                <th>Normal</th>
                <th>Shiny ✨</th>
                <th>Première capture</th>
                <th>Dernière capture</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="dex-tbody"></tbody>
          </table>
        </div>
        <!-- Pagination -->
        <div id="dex-pagination" style="display:flex;gap:8px;align-items:center;justify-content:center;margin:16px 0;flex-wrap:wrap"></div>

        <!-- Date d'export -->
        <div id="export-date-footer" style="text-align:center;font-size:11px;color:var(--text-muted);margin:24px 0 8px;opacity:.7"></div>
      </div>
    </div>`;

    currentEntries = entries;
    renderDex(entries, 0);

    // Appliquer le scale responsive de la carte dresseur maintenant que le DOM est prêt
    // (applyCardScale lit clientWidth, il faut que l'élément soit dans le DOM)
    requestAnimationFrame(applyCardScale);

    document.getElementById('search-dex').addEventListener('input', SD.debounce(() => renderDex(currentEntries, 0)));
    document.getElementById('filter-dex').addEventListener('change', () => renderDex(currentEntries, 0));

    // Date de dernier export
    const footer = document.getElementById('export-date-footer');
    if (footer) {
        if (d.ExportedAt) {
            const dt = new Date(d.ExportedAt);
            footer.textContent = `Données exportées le ${dt.toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' })} à ${dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
        } else {
            footer.textContent = '<pas de date de dernier export définie>';
        }
    }
}

function renderDex(entries, page = 0) {
    const q = document.getElementById('search-dex').value.trim().toLowerCase();
    const f = document.getElementById('filter-dex').value;
    const tbody = document.getElementById('dex-tbody');
    const pagination = document.getElementById('dex-pagination');
    const countLabel = document.getElementById('dex-count-label');

    // L'ordre vient du JSON (trié par settings.allPokemons côté serveur)
    let list = [...entries];
    if (q) list = list.filter(e => (e.PokeName || '').toLowerCase().includes(q));
    if (f === 'normal') list = list.filter(e => e.CountNormal > 0 && e.CountShiny === 0);
    else if (f === 'shiny') list = list.filter(e => e.CountShiny > 0);

    if (countLabel) countLabel.textContent = list.length;

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">Aucune entrée</td></tr>`;
        if (pagination) pagination.innerHTML = '';
        return;
    }

    const totalPages = Math.ceil(list.length / DEX_PAGE_SIZE);
    // Clamp page dans les bornes
    page = Math.max(0, Math.min(page, totalPages - 1));
    const slice = list.slice(page * DEX_PAGE_SIZE, (page + 1) * DEX_PAGE_SIZE);

    tbody.innerHTML = slice.map(e => `
    <tr>
      <td>${e.SpriteNormal ? SD.sprite(e.SpriteNormal, e.PokeName, 40) : '—'}</td>
      <td>
        <a href="../Creature/info.html?name=${encodeURIComponent(e.PokeName)}">${SD.esc(e.PokeName)}</a>
      </td>
      <td>${SD.fmt(e.CountNormal)}</td>
      <td>${e.CountShiny > 0 ? `<span style="color:var(--shiny-gold)">✨ ${SD.fmt(e.CountShiny)}</span>` : '—'}</td>
      <td style="color:var(--text-muted);font-size:12px">${fmtDate(e.DateFirstCatch)}</td>
      <td style="color:var(--text-muted);font-size:12px">${fmtDate(e.DateLastCatch)}</td>
      <td><button class="sd-btn sd-btn--ghost" style="font-size:12px;padding:4px 10px"
        onclick="openCreaturePopup(${JSON.stringify(e).replace(/"/g, '&quot;')})"
      >⚙️ Actions</button></td>
    </tr>`).join('');

    // ── Pagination ────────────────────────────────────────────────
    if (!pagination) return;
    if (totalPages <= 1) { pagination.innerHTML = ''; return; }

    const start = page * DEX_PAGE_SIZE + 1;
    const end = Math.min((page + 1) * DEX_PAGE_SIZE, list.length);

    let html = '';

    // Bouton Précédent
    html += `<button class="sd-btn sd-btn--ghost" style="padding:4px 10px;font-size:13px"
    ${page === 0 ? 'disabled' : ''}
    onclick="renderDexGlobal(currentEntries, ${page - 1})">‹ Précédent</button>`;

    // Numéros de page (fenêtre de 5 autour de la page courante)
    const window = 2;
    for (let i = 0; i < totalPages; i++) {
        if (i === 0 || i === totalPages - 1 || Math.abs(i - page) <= window) {
            html += `<button class="sd-btn ${i === page ? 'sd-btn--primary' : 'sd-btn--ghost'}"
        style="padding:4px 10px;font-size:13px;min-width:36px"
        onclick="renderDexGlobal(currentEntries, ${i})">${i + 1}</button>`;
        } else if (Math.abs(i - page) === window + 1) {
            html += `<span style="padding:0 4px;color:var(--text-muted)">…</span>`;
        }
    }

    // Bouton Suivant
    html += `<button class="sd-btn sd-btn--ghost" style="padding:4px 10px;font-size:13px"
    ${page === totalPages - 1 ? 'disabled' : ''}
    onclick="renderDexGlobal(currentEntries, ${page + 1})">Suivant ›</button>`;

    html += `<span style="font-size:12px;color:var(--text-muted);margin-left:8px">${start}–${end} / ${list.length}</span>`;

    pagination.innerHTML = html;
}

function statBox(label, value, accent = 'blue') {
    const colors = { blue: 'var(--accent-blue)', gold: 'var(--shiny-gold)', green: 'var(--accent-green)', orange: 'var(--accent-orange)' };
    return `
    <div class="sd-stat-card" style="padding:10px;">
      <div class="sd-stat-card__value" style="font-size:18px;color:${colors[accent] || colors.blue}">${value}</div>
      <div class="sd-stat-card__label">${label}</div>
    </div>`;
}

function fmtDate(dateStr) {
    if (!dateStr) return '—';
    try { return new Date(dateStr).toLocaleDateString('fr-FR', { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch { return dateStr; }
}

// ── Carte de dresseur ─────────────────────────────────────────────────────────

// Ordre de tri par rareté (du plus rare au moins rare)
const BADGE_RARITY_ORDER = ['exotic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];
const BADGE_GLOW = {
    exotic: 'drop-shadow(0 0 10px pink)   drop-shadow(0 0 20px pink)',
    legendary: 'drop-shadow(0 0 10px yellow) drop-shadow(0 0 20px yellow)',
    epic: 'drop-shadow(0 0 8px purple)  drop-shadow(0 0 18px purple)',
    rare: 'drop-shadow(0 0 8px blue)    drop-shadow(0 0 18px blue)',
    uncommon: 'drop-shadow(0 0 8px green)   drop-shadow(0 0 18px green)',
    common: 'drop-shadow(0 0 6px white)   drop-shadow(0 0 14px white)',
};

// Décode le champ favoritePoke : "Pikachu#s" → { name, isShiny }
function parseFavoriteCreature(raw) {
    if (!raw) return null;
    if (raw.endsWith('#s')) return { name: raw.slice(0, -2), isShiny: true };
    if (raw.endsWith('#n')) return { name: raw.slice(0, -2), isShiny: false };
    return { name: raw, isShiny: false };
}

function renderTrainerCardHTML(d) {
    // ── Calcul des stats depuis les entrées (source de vérité côté client) ──────
    const entries = d.Entries || [];
    const dexCount = entries.filter(e => e.CountNormal > 0 || e.CountShiny > 0).length;
    const shinyDex = entries.filter(e => e.CountShiny > 0).length;

    const allDates = entries
        .flatMap(e => [e.DateFirstCatch, e.DateLastCatch])
        .filter(Boolean)
        .map(s => new Date(s).getTime())
        .filter(t => !isNaN(t));
    const firstCatchStr = allDates.length
        ? new Date(Math.min(...allDates)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' })
        : '—';

    // ── Badges triés par rareté, max 8 obtenus ───────────────────────────────
    const sortedBadges = (d.Badges || [])
        .filter(b => b.Obtained)
        .sort((a, b) => {
            const ra = BADGE_RARITY_ORDER.indexOf((a.Rarity || '').toLowerCase());
            const rb = BADGE_RARITY_ORDER.indexOf((b.Rarity || '').toLowerCase());
            return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
        })
        .slice(0, 8);

    const fav = parseFavoriteCreature(d.FavoriteCreature);

    const badgesHTML = sortedBadges.map(b => {
        const glow = BADGE_GLOW[(b.Rarity || '').toLowerCase()] || 'none';
        return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center">
      <img src="${SD.esc(b.ImageUrl || '')}" alt="${SD.esc(b.Name)}"
        title="${SD.esc(b.Description || b.Name)}"
        style="height:48px;width:48px;filter:${glow};transition:transform .4s ease;cursor:default"
        onmouseover="this.style.transform='scale(1.3) rotate(360deg)'"
        onmouseout="this.style.transform=''">
      <span style="font-size:10px;color:#fff;text-shadow:0 0 8px #000;font-weight:700;max-width:56px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${SD.esc(b.Name)}">${SD.esc(b.Name)}</span>
    </div>`;
    }).join('');

    const TEXT_SHADOW = 'text-shadow:0 0 11px #000,0 0 11px #000,0 0 20px #000';

    return `
  <div class="sd-section-header" style="margin-bottom:12px">
    <h2>🎴 Carte de dresseur</h2>
  </div>

  <style>
    @keyframes tctwinkle { 0%,100%{opacity:.18} 50%{opacity:.08} }

    /* Wrapper : centre la carte sur grand écran, scale sur mobile */
    .trainer-card-outer {
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      margin-bottom: 24px;
    }

    /* Conteneur qui clip le scale sur mobile */
    .trainer-card-scaler {
      /* Grand écran : taille naturelle de la carte */
      width: 856px;
      height: 566px;
      flex-shrink: 0;
      overflow: hidden;
    }

    /* La carte est TOUJOURS 856×566 en interne.
       C'est ce qui garantit que toutes les captures téléchargées ont la même résolution.
       Le scale visuel sur mobile est appliqué par applyCardScale() en JS. */
    #trainer-card {
      width: 856px;
      height: 566px;
      transform-origin: top left;
    }

    @media (max-width: 900px) {
      .trainer-card-scaler {
        width: 100%;
        /* La hauteur est mise à jour par applyCardScale() */
      }
    }
  </style>

  <div class="trainer-card-outer">

    <!-- Conteneur qui gère le scale CSS sur mobile -->
    <div class="trainer-card-scaler" id="trainer-card-scaler">

      <!-- La carte reste TOUJOURS 856×566 ; ne pas changer ces dimensions.
           Voir applyCardScale() et downloadTrainerCard() pour la gestion responsive. -->
      <div id="trainer-card" style="
          position:relative;
          overflow:hidden;
          border-radius:10px;border:1px solid #ccc;
          background-image:url('${SD.esc(d.CardBackground || '')}');
          background-size:cover;background-position:center;
          color:#fff;box-sizing:border-box;">

        <!-- Fond sombre -->
        <div style="position:absolute;inset:0;background:rgba(0,0,0,0.5);border-radius:10px;z-index:0"></div>

        <!-- Étoiles -->
        <div style="
          position:absolute;inset:0;z-index:0;pointer-events:none;
          background:
            radial-gradient(circle,#fff 1px,transparent 1px) 0 0/60px 60px,
            radial-gradient(circle,#fff 1px,transparent 1px) 30px 30px/60px 60px;
          opacity:.18;animation:tctwinkle 8s infinite linear"></div>

        <!-- Contenu principal -->
        <div style="position:relative;z-index:1;padding:20px;height:100%;box-sizing:border-box;display:flex;flex-direction:column">

          <!-- Titre -->
          <h1 style="margin:0 0 2px;font-size:22px;font-weight:800;${TEXT_SHADOW};text-align:center">
            Dresseur : ${SD.esc(d.Pseudo)}
          </h1>
          <h3 style="margin:0 0 16px;font-size:13px;font-weight:400;opacity:.85;${TEXT_SHADOW};text-align:center">
            ID : ${SD.esc(d.Code_user || '—')}
          </h3>

          <!-- 3 colonnes égales -->
          <div style="display:flex;gap:16px;flex:1;align-items:center">

            <!-- Colonne 1 : Avatar -->
            <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px">
              ${d.AvatarUrl
            ? `<img src="${SD.esc(d.AvatarUrl)}" crossorigin="anonymous"
                  style="width:140px;height:140px;object-fit:cover;border-radius:8px;border:2px solid rgba(255,255,255,.45);"
                  alt="Avatar">`
            : `<div style="width:140px;height:140px;border-radius:8px;background:rgba(255,255,255,.1);display:flex;align-items:center;justify-content:center;font-size:56px">👤</div>`}
              <span style="font-size:13px;font-weight:700;${TEXT_SHADOW}">${SD.esc(d.Pseudo)}</span>
            </div>

            <!-- Colonne 2 : Stats -->
            <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;font-size:14px;${TEXT_SHADOW};text-align:center">
              <span>🗂️ <strong>Global Dex :</strong> ${dexCount}</span>
              <span>✨ <strong>Shiny Dex :</strong> ${shinyDex}</span>
              <span>📅 <strong>Dresseur depuis :</strong> ${firstCatchStr}</span>
              <span>
                📡 <strong>Plateforme :</strong> ${SD.esc(d.Platform)}
                <img src="https://raw.githubusercontent.com/MythMega/PkServData/refs/heads/master/img/platform/${SD.esc((d.Platform || '').toLowerCase())}.png"
                  style="height:16px;width:16px;vertical-align:middle;margin-left:3px" alt="${SD.esc(d.Platform)}">
              </span>
              <span>⭐ <strong>Niveau :</strong> ${d.Level ?? '—'}</span>
              <span>🎯 <strong>Captures :</strong> ${SD.fmt(d.PokeCaught)}</span>
            </div>

            <!-- Colonne 3 : Créature favorite -->
            <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;${TEXT_SHADOW};text-align:center">
              ${fav ? `
                <span style="font-size:12px;font-weight:700">Créature Favorite</span>
                <span style="font-size:13px">${SD.esc(fav.name)}${fav.isShiny ? ' ✨' : ''}</span>
                ${d.FavoriteSprite
                ? `<img src="${SD.esc(d.FavoriteSprite)}" alt="${SD.esc(fav.name)}" style="height:100px;width:auto">`
                : `<span style="font-size:32px">❓</span>`}
              ` : `<span style="opacity:.5">Pas de créature favorite</span>`}
            </div>

          </div>

          <!-- Badges -->
          ${badgesHTML ? `
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;justify-content:center;margin-top:14px">
            ${badgesHTML}
          </div>` : ''}

        </div>
      </div>
    </div>

    <!-- Bouton téléchargement -->
    <button class="sd-btn sd-btn--primary" id="download-card-btn" onclick="downloadTrainerCard()">
      📥 Télécharger ma carte
    </button>
  </div>`;
}

// ── Scale responsive de la carte dresseur ────────────────────────────────────
// La carte est TOUJOURS 856×566 en interne (garantit des captures identiques
// quelle que soit la taille d'écran). Sur mobile on applique un transform:scale
// pour qu'elle tienne visuellement sans modifier ses dimensions réelles.
function applyCardScale() {
    const card   = document.getElementById('trainer-card');
    const scaler = document.getElementById('trainer-card-scaler');
    if (!card || !scaler) return;

    const CARD_W = 856;
    const CARD_H = 566;
    // clientWidth du scaler = largeur réelle disponible dans la page
    const availableW = scaler.parentElement?.clientWidth || scaler.clientWidth;

    if (availableW >= CARD_W) {
        // Grand écran : taille naturelle, centré par le flex du wrapper
        card.style.transform = 'none';
        scaler.style.width   = CARD_W + 'px';
        scaler.style.height  = CARD_H + 'px';
    } else {
        // Mobile : scale proportionnel pour tenir dans la largeur disponible
        const scale = availableW / CARD_W;
        card.style.transform       = `scale(${scale})`;
        card.style.transformOrigin = 'top left';
        scaler.style.width  = '100%';
        scaler.style.height = (CARD_H * scale) + 'px'; // hauteur visuelle compressée
    }
}

// Recalcul au resize
window.addEventListener('resize', applyCardScale);

function downloadTrainerCard() {
    const card   = document.getElementById('trainer-card');
    const scaler = document.getElementById('trainer-card-scaler');
    if (!card) { console.error('[user] #trainer-card introuvable.'); return; }

    const btn = document.getElementById('download-card-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Génération…'; }

    const CARD_W  = 856;
    // On est "mobile" si le scaler est plus étroit que la carte réelle
    const isMobile = (scaler?.parentElement?.clientWidth || scaler?.clientWidth || CARD_W) < CARD_W;

    function doCapture() {
        // dom-to-image voit la carte sans scale → capture toujours en 856×566
        domtoimage.toPng(card, { width: 856, height: 566, bgcolor: null })
            .then(dataUrl => {
                const a = document.createElement('a');
                a.href     = dataUrl;
                a.download = `carte-dresseur-${document.querySelector('[data-pseudo]')?.dataset.pseudo || 'trainer'}.png`;
                a.click();
            })
            .catch(err => {
                console.error('[user] Erreur génération de la carte :', err);
                alert('Une erreur est survenue lors de la génération de la carte.');
            })
            .finally(() => {
                // Sur mobile : remettre le scale visuel après la capture
                if (isMobile) applyCardScale();
                if (btn) { btn.disabled = false; btn.textContent = '📥 Télécharger ma carte'; }
            });
    }

    if (isMobile) {
        // Retirer le scale pour que dom-to-image voie la carte en taille réelle 856×566
        card.style.transform = 'none';
        if (scaler) { scaler.style.width = '856px'; scaler.style.height = '566px'; }
        // Laisser deux cycles de rendu avant la capture pour que le layout soit stable
        requestAnimationFrame(() => requestAnimationFrame(doCapture));
    } else {
        doCapture();
    }
}