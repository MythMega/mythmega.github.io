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

  SD.setTitle(`${data.Pseudo} (${data.Platform})`);
  render(root, data, platform, username);
});

function render(root, d, platform, username) {
  const entries = d.Entries || [];
  const normalEntries = entries.filter(e => e.CountNormal > 0);
  const shinyEntries  = entries.filter(e => e.CountShiny > 0);
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
          <h2>Pokédex (${entries.length} entrées)</h2>
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
              </tr>
            </thead>
            <tbody id="dex-tbody"></tbody>
          </table>
        </div>
      </div>
    </div>`;

  renderDex(entries);

  document.getElementById('search-dex').addEventListener('input', SD.debounce(() => renderDex(entries)));
  document.getElementById('filter-dex').addEventListener('change', () => renderDex(entries));
}

function renderDex(entries) {
  const q = document.getElementById('search-dex').value.trim().toLowerCase();
  const f = document.getElementById('filter-dex').value;
  const tbody = document.getElementById('dex-tbody');

  // L'ordre vient du JSON (trié par settings.allPokemons côté serveur)
  let list = [...entries];
  if (q) list = list.filter(e => (e.PokeName || '').toLowerCase().includes(q));
  if (f === 'normal') list = list.filter(e => e.CountNormal > 0 && e.CountShiny === 0);
  else if (f === 'shiny') list = list.filter(e => e.CountShiny > 0);

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">Aucune entrée</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(e => `
    <tr>
      <td>${e.SpriteNormal ? SD.sprite(e.SpriteNormal, e.PokeName, 40) : '—'}</td>
      <td>
        <a href="../Creature/info.html?name=${encodeURIComponent(e.PokeName)}">${SD.esc(e.PokeName)}</a>
      </td>
      <td>${SD.fmt(e.CountNormal)}</td>
      <td>${e.CountShiny > 0 ? `<span style="color:var(--shiny-gold)">✨ ${SD.fmt(e.CountShiny)}</span>` : '—'}</td>
      <td style="color:var(--text-muted);font-size:12px">${fmtDate(e.DateFirstCatch)}</td>
      <td style="color:var(--text-muted);font-size:12px">${fmtDate(e.DateLastCatch)}</td>
    </tr>`).join('');
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
  exotic:    'drop-shadow(0 0 10px pink)   drop-shadow(0 0 20px pink)',
  legendary: 'drop-shadow(0 0 10px yellow) drop-shadow(0 0 20px yellow)',
  epic:      'drop-shadow(0 0 8px purple)  drop-shadow(0 0 18px purple)',
  rare:      'drop-shadow(0 0 8px blue)    drop-shadow(0 0 18px blue)',
  uncommon:  'drop-shadow(0 0 8px green)   drop-shadow(0 0 18px green)',
  common:    'drop-shadow(0 0 6px white)   drop-shadow(0 0 14px white)',
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
  const dexCount  = entries.filter(e => e.CountNormal > 0 || e.CountShiny > 0).length;
  const shinyDex  = entries.filter(e => e.CountShiny  > 0).length;

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
  <div style="margin-bottom:24px;display:flex;flex-direction:column;align-items:flex-start;gap:12px">

    <!-- ══ Carte 856×566 fixe ══ -->
    <div id="trainer-card" style="
        position:relative;
        width:856px;height:566px;
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

    <!-- Bouton téléchargement -->
    <button class="sd-btn sd-btn--primary" id="download-card-btn" onclick="downloadTrainerCard()">
      📥 Télécharger ma carte
    </button>
  </div>

  <style>
    @keyframes tctwinkle { 0%,100%{opacity:.18} 50%{opacity:.08} }
  </style>`;
}

function downloadTrainerCard() {
  const card = document.getElementById('trainer-card');
  if (!card) { console.error('[user] #trainer-card introuvable.'); return; }

  const btn = document.getElementById('download-card-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Génération…'; }

  domtoimage.toPng(card, { bgcolor: null })
    .then(dataUrl => {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `carte-dresseur-${document.querySelector('[data-pseudo]')?.dataset.pseudo || 'trainer'}.png`;
      a.click();
    })
    .catch(err => {
      console.error('[user] Erreur génération de la carte :', err);
      alert('Une erreur est survenue lors de la génération de la carte.');
    })
    .finally(() => {
      if (btn) { btn.disabled = false; btn.textContent = '📥 Télécharger ma carte'; }
    });
}
