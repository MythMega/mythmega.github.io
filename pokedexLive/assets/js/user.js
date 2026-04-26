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
    <div class="sd-page">
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
