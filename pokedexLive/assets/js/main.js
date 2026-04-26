// ============================================
// StreamDex - Main page (main.js)
// ============================================

const PLATFORMS = ['twitch', 'youtube', 'tiktok', 'discord'];
const PLATFORM_ICONS = { twitch: '🟣', youtube: '🔴', tiktok: '⚫', discord: '🔵' };

let usersByPlatform = {};

document.addEventListener('DOMContentLoaded', async () => {
  const root = document.getElementById('sd-root');
  SD.loading(root);

  let data;
  try {
    data = await SD.fetchJson('Data/json/main.json');
  } catch {
    SD.error(root, 'Impossible de charger les données principales.');
    return;
  }

  try {
    usersByPlatform = await SD.fetchJson('Data/json/users_by_platform.json');
  } catch {
    usersByPlatform = {};
  }

  render(root, data);
});

function render(root, d) {
  const stats = d.GlobalStats || {};
  const rankings = d.Rankings || {};
  const recent = d.RecentCatches || [];

  root.innerHTML = `
    <div class="sd-page">
      <div class="sd-container">

        <!-- Header -->
        <div class="sd-section-header" style="margin-bottom:24px">
          <h1>📊 StreamDex — Tableau de bord</h1>
          <span style="font-size:12px;color:var(--text-muted)">Mis à jour : ${fmtDate(d.LastUpdate)}</span>
        </div>

        <!-- User search widget -->
        <div class="sd-card" style="margin-bottom:24px;padding:20px">
          <h2 style="font-size:15px;margin:0 0 14px">🔍 Accéder au Pokédex d'un joueur</h2>
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
            <div style="display:flex;flex-direction:column;gap:4px">
              <label style="font-size:12px;color:var(--text-secondary)">Plateforme</label>
              <div style="display:flex;gap:6px">
                ${PLATFORMS.map(p => `
                  <button id="plat-btn-${p}" class="sd-btn sd-btn--ghost plat-btn" onclick="selectPlatform('${p}')"
                    style="padding:6px 12px;font-size:13px">
                    ${PLATFORM_ICONS[p]} ${p.charAt(0).toUpperCase() + p.slice(1)}
                  </button>`).join('')}
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:180px">
              <label for="user-search-input" style="font-size:12px;color:var(--text-secondary)">Pseudo</label>
              <div style="position:relative">
                <input class="sd-input" id="user-search-input" type="text"
                  placeholder="Entrez un pseudo..."
                  autocomplete="off"
                  oninput="onUserInput()"
                  onkeydown="onUserKeydown(event)"
                  style="width:100%">
                <ul id="autocomplete-list" style="
                  display:none;position:absolute;top:100%;left:0;right:0;z-index:50;
                  background:var(--bg-card);border:1px solid var(--border-color);
                  border-radius:var(--radius-sm);margin:2px 0 0;padding:0;list-style:none;
                  max-height:200px;overflow-y:auto;box-shadow:var(--shadow-md)"></ul>
              </div>
            </div>
            <button class="sd-btn sd-btn--primary" onclick="goToUser()" style="align-self:flex-end">
              Voir le Pokédex →
            </button>
          </div>
        </div>

        <!-- Global KPI -->
        <div class="sd-stat-grid" style="margin-bottom:24px">
          ${kpi('Pokéballs lancées', SD.fmt(stats.TotalBallLaunched))}
          ${kpi('Pokémon capturés', SD.fmt(stats.TotalPokeCaught))}
          ${kpi('Shiny capturés', SD.fmt(stats.TotalShinyCaught), 'gold')}
          ${kpi('Argent dépensé', SD.fmt(stats.TotalMoneySpent))}
          ${kpi('Participants', SD.fmt(stats.TotalUsers))}
          ${kpi('Dex Normal', `${stats.GlobalDexNormal ?? 0}/${stats.TotalPokemons ?? 0}`, 'blue')}
          ${kpi('Dex Shiny', `${stats.GlobalDexShiny ?? 0}/${stats.TotalPokemons ?? 0}`, 'gold')}
          ${kpi('Normal distribués', SD.fmt(stats.TotalGiveawayNormal))}
          ${kpi('Shiny distribués', SD.fmt(stats.TotalGiveawayShiny), 'gold')}
        </div>

        <!-- Rankings -->
        <div class="sd-grid sd-grid--2" style="margin-bottom:24px">
          ${rankings.TopBalls ? leaderboard('🎳 Top Balls lancées', rankings.TopBalls, 'BallLaunched') : ''}
          ${rankings.TopMoney ? leaderboard('💸 Top Argent dépensé', rankings.TopMoney, 'MoneySpent') : ''}
          ${rankings.TopShiny ? leaderboard('✨ Top Chasseurs Shiny', rankings.TopShiny, 'ShinyCount') : ''}
          ${rankings.TopDex ? leaderboard('📖 Top Pokédex', rankings.TopDex, 'DexCount') : ''}
        </div>

        <!-- Recent catches -->
        ${recent.length > 0 ? `
        <div class="sd-section-header">
          <h2>🕐 Captures récentes</h2>
        </div>
        <div class="sd-table-wrap" style="margin-bottom:24px">
          <table class="sd-table">
            <thead>
              <tr>
                <th>Sprite</th><th>Pokémon</th><th>Joueur</th><th>Statut</th><th>Pokéball</th><th>Date</th>
              </tr>
            </thead>
            <tbody>
              ${recent.map(c => `
              <tr>
                <td>${c.SpriteUrl ? SD.sprite(c.SpriteUrl, c.PokeName, 36) : '—'}</td>
                <td><a href="Creature/info.html?name=${encodeURIComponent(c.PokeName)}">${SD.esc(c.PokeName)}</a></td>
                <td><a href="User/info.html?platform=${encodeURIComponent(c.Platform)}&username=${encodeURIComponent(c.Pseudo)}">${SD.esc(c.Pseudo)}</a></td>
                <td>${c.IsShiny ? SD.badge('✨ Shiny', 'gold') : SD.badge('Normal', 'gray')}</td>
                <td>${SD.esc(c.BallName || '—')}</td>
                <td style="color:var(--text-muted);font-size:12px">${fmtDate(c.Time)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>` : ''}

        <!-- Quick links -->
        <div class="sd-section-header">
          <h2>🔗 Accès rapide</h2>
        </div>
        <div class="sd-grid sd-grid--auto" style="margin-bottom:24px">
          ${quickLink('availablepokemon.html', '🐾', 'Pokédex disponible')}
          ${quickLink('balldex.html', '🎱', 'Balls')}
          ${quickLink('zonedex.html', '📍', 'Zones')}
          ${quickLink('pokestats.html', '📊', 'Statistiques')}
          ${quickLink('buypokemon.html', '🛒', 'Boutique')}
          ${quickLink('scrappokemon.html', '♻️', 'Scrapping')}
          ${quickLink('records.html', '🏆', 'Records')}
        </div>

      </div>
    </div>

    <!-- Not found modal -->
    <div id="notfound-modal" style="
      display:none;position:fixed;inset:0;z-index:200;
      background:rgba(0,0,0,0.6);align-items:center;justify-content:center">
      <div style="
        background:var(--bg-card);border:1px solid var(--border-color);
        border-radius:var(--radius-lg);padding:32px;max-width:400px;width:90%;text-align:center">
        <div style="font-size:40px;margin-bottom:12px">😕</div>
        <h3 id="notfound-title" style="margin:0 0 8px;font-size:18px"></h3>
        <p id="notfound-msg" style="color:var(--text-secondary);margin:0 0 20px;font-size:14px"></p>
        <button class="sd-btn sd-btn--ghost" onclick="closeModal()" style="width:100%">Fermer</button>
      </div>
    </div>`;

  // Sélectionner Twitch par défaut
  selectPlatform('twitch');
}

// ── Platform selector ─────────────────────────────────────────────────────────

let currentPlatform = 'twitch';
let acIndex = -1;

function selectPlatform(p) {
  currentPlatform = p;
  PLATFORMS.forEach(pl => {
    const btn = document.getElementById(`plat-btn-${pl}`);
    if (!btn) return;
    if (pl === p) {
      btn.className = 'sd-btn sd-btn--primary plat-btn';
    } else {
      btn.className = 'sd-btn sd-btn--ghost plat-btn';
    }
  });
  // Vider l'input et les suggestions au changement de plateforme
  const input = document.getElementById('user-search-input');
  if (input) { input.value = ''; }
  hideAutocomplete();
}

// ── Autocomplete ──────────────────────────────────────────────────────────────

function onUserInput() {
  const input = document.getElementById('user-search-input');
  const q = input.value.trim().toLowerCase();
  const list = document.getElementById('autocomplete-list');

  const platformUsers = (usersByPlatform[currentPlatform] || []);
  const matches = q.length === 0
    ? []
    : platformUsers.filter(u => u.toLowerCase().includes(q)).slice(0, 10);

  acIndex = -1;

  if (matches.length === 0) {
    hideAutocomplete();
    return;
  }

  list.innerHTML = matches.map((u, i) => `
    <li id="ac-item-${i}"
      style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border-color)"
      onmousedown="pickUser('${SD.esc(u)}')"
      onmouseover="highlightAc(${i})">
      ${PLATFORM_ICONS[currentPlatform]} ${SD.esc(u)}
    </li>`).join('');
  list.style.display = 'block';
}

function onUserKeydown(e) {
  const list = document.getElementById('autocomplete-list');
  const items = list.querySelectorAll('li');
  if (list.style.display === 'none' || items.length === 0) {
    if (e.key === 'Enter') goToUser();
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    acIndex = Math.min(acIndex + 1, items.length - 1);
    refreshAcHighlight(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    acIndex = Math.max(acIndex - 1, -1);
    refreshAcHighlight(items);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (acIndex >= 0 && items[acIndex]) {
      const name = items[acIndex].textContent.trim().replace(/^[^\s]+\s/, '');
      pickUser(name);
    } else {
      goToUser();
    }
  } else if (e.key === 'Escape') {
    hideAutocomplete();
  }
}

function highlightAc(i) {
  acIndex = i;
  const items = document.querySelectorAll('#autocomplete-list li');
  refreshAcHighlight(items);
}

function refreshAcHighlight(items) {
  items.forEach((el, i) => {
    el.style.background = i === acIndex ? 'var(--bg-card-hover)' : '';
    el.style.color = i === acIndex ? 'var(--accent-blue)' : '';
  });
}

function hideAutocomplete() {
  const list = document.getElementById('autocomplete-list');
  if (list) { list.style.display = 'none'; list.innerHTML = ''; }
}

function pickUser(pseudo) {
  const input = document.getElementById('user-search-input');
  if (input) input.value = pseudo;
  hideAutocomplete();
}

// Fermer l'autocomplete si on clique ailleurs
document.addEventListener('click', e => {
  if (!e.target.closest('#user-search-input') && !e.target.closest('#autocomplete-list')) {
    hideAutocomplete();
  }
});

// ── Navigation vers le profil utilisateur ────────────────────────────────────

function goToUser() {
  const input = document.getElementById('user-search-input');
  const pseudo = input ? input.value.trim() : '';
  if (!pseudo) return;

  const platformUsers = usersByPlatform[currentPlatform] || [];
  const found = platformUsers.find(u => u.toLowerCase() === pseudo.toLowerCase());

  if (found) {
    window.location.href = `User/info.html?platform=${encodeURIComponent(currentPlatform)}&username=${encodeURIComponent(found)}`;
  } else {
    showNotFound(pseudo, currentPlatform);
  }
}

// ── Modal "non trouvé" ────────────────────────────────────────────────────────

function showNotFound(pseudo, platform) {
  const modal = document.getElementById('notfound-modal');
  document.getElementById('notfound-title').textContent = `Joueur introuvable`;
  document.getElementById('notfound-msg').textContent =
    `"${pseudo}" n'a pas été trouvé sur ${platform.charAt(0).toUpperCase() + platform.slice(1)} parmi les utilisateurs enregistrés.`;
  modal.style.display = 'flex';
}

function closeModal() {
  const modal = document.getElementById('notfound-modal');
  if (modal) modal.style.display = 'none';
}

// Fermer la modal avec Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function kpi(label, value, accent = 'blue') {
  const colors = { blue: 'var(--accent-blue)', gold: 'var(--shiny-gold)', green: 'var(--accent-green)' };
  return `
    <div class="sd-stat-card">
      <div class="sd-stat-card__value" style="color:${colors[accent] || colors.blue}">${value}</div>
      <div class="sd-stat-card__label">${label}</div>
    </div>`;
}

function leaderboard(title, users, valueKey) {
  return `
    <div class="sd-card">
      <div class="sd-card__body">
        <h2 style="font-size:15px;margin:0 0 12px">${title}</h2>
        <ol class="sd-leaderboard">
          ${users.map((u, i) => `
          <li>
            <span class="sd-leaderboard__rank sd-leaderboard__rank--${i+1}">${i+1}</span>
            <span class="sd-leaderboard__name">
              <a href="User/info.html?platform=${encodeURIComponent(u.Platform)}&username=${encodeURIComponent(u.Pseudo)}">${SD.esc(u.Pseudo)}</a>
              ${SD.badge(u.Platform, 'gray')}
            </span>
            <span class="sd-leaderboard__value">${SD.fmt(u[valueKey])}</span>
          </li>`).join('')}
        </ol>
      </div>
    </div>`;
}

function quickLink(href, icon, label) {
  return `
    <a href="${href}" class="sd-card" style="text-decoration:none;display:block;padding:20px;text-align:center;">
      <div style="font-size:28px;margin-bottom:8px">${icon}</div>
      <div style="font-weight:600;font-size:14px;color:var(--text-primary)">${label}</div>
    </a>`;
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  try { return new Date(dateStr).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }); }
  catch { return dateStr; }
}


document.addEventListener('DOMContentLoaded', async () => {
    const root = document.getElementById('sd-root');
    SD.loading(root);

    let data;
    try {
        data = await SD.fetchJson('Data/json/main.json');
    } catch {
        SD.error(root, 'Impossible de charger les données principales.');
        return;
    }

    render(root, data);
});

function render(root, d) {
    const stats = d.GlobalStats || {};
    const rankings = d.Rankings || {};
    const recent = d.RecentCatches || [];

    root.innerHTML = `
    <div class="sd-page">
      <div class="sd-container">

        <!-- Header -->
        <div class="sd-section-header" style="margin-bottom:24px">
          <h1>📊 StreamDex — Tableau de bord</h1>
          <span style="font-size:12px;color:var(--text-muted)">Mis à jour : ${fmtDate(d.LastUpdate)}</span>
        </div>

        <!-- Global KPI -->
        <div class="sd-stat-grid" style="margin-bottom:24px">
          ${kpi('Pokéballs lancées', SD.fmt(stats.TotalBallLaunched))}
          ${kpi('Pokémon capturés', SD.fmt(stats.TotalPokeCaught))}
          ${kpi('Shiny capturés', SD.fmt(stats.TotalShinyCaught), 'gold')}
          ${kpi('Argent dépensé', SD.fmt(stats.TotalMoneySpent))}
          ${kpi('Participants', SD.fmt(stats.TotalUsers))}
          ${kpi('Dex Normal', `${stats.GlobalDexNormal ?? 0}/${stats.TotalPokemons ?? 0}`, 'blue')}
          ${kpi('Dex Shiny', `${stats.GlobalDexShiny ?? 0}/${stats.TotalPokemons ?? 0}`, 'gold')}
          ${kpi('Normal distribués', SD.fmt(stats.TotalGiveawayNormal))}
          ${kpi('Shiny distribués', SD.fmt(stats.TotalGiveawayShiny), 'gold')}
        </div>

        <!-- Rankings -->
        <div class="sd-grid sd-grid--2" style="margin-bottom:24px">
          ${rankings.TopBalls ? leaderboard('🎳 Top Balls lancées', rankings.TopBalls, 'BallLaunched') : ''}
          ${rankings.TopMoney ? leaderboard('💸 Top Argent dépensé', rankings.TopMoney, 'MoneySpent') : ''}
          ${rankings.TopShiny ? leaderboard('✨ Top Chasseurs Shiny', rankings.TopShiny, 'ShinyCount') : ''}
          ${rankings.TopDex ? leaderboard('📖 Top Pokédex', rankings.TopDex, 'DexCount') : ''}
        </div>

        <!-- Recent catches -->
        ${recent.length > 0 ? `
        <div class="sd-section-header">
          <h2>🕐 Captures récentes</h2>
        </div>
        <div class="sd-table-wrap" style="margin-bottom:24px">
          <table class="sd-table">
            <thead>
              <tr>
                <th>Sprite</th><th>Pokémon</th><th>Joueur</th><th>Statut</th><th>Pokéball</th><th>Date</th>
              </tr>
            </thead>
            <tbody>
              ${recent.map(c => `
              <tr>
                <td>${c.SpriteUrl ? SD.sprite(c.SpriteUrl, c.PokeName, 36) : '—'}</td>
                <td><a href="Creature/info.html?name=${encodeURIComponent(c.PokeName)}">${SD.esc(c.PokeName)}</a></td>
                <td><a href="User/info.html?platform=${encodeURIComponent(c.Platform)}&username=${encodeURIComponent(c.Pseudo)}">${SD.esc(c.Pseudo)}</a></td>
                <td>${c.IsShiny ? SD.badge('✨ Shiny', 'gold') : SD.badge('Normal', 'gray')}</td>
                <td>${SD.esc(c.BallName || '—')}</td>
                <td style="color:var(--text-muted);font-size:12px">${fmtDate(c.Time)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>` : ''}

        <!-- Quick links -->
        <div class="sd-section-header">
          <h2>🔗 Accès rapide</h2>
        </div>
        <div class="sd-grid sd-grid--auto" style="margin-bottom:24px">
          ${quickLink('availablepokemon.html', '🐾', 'Pokédex disponible')}
          ${quickLink('balldex.html', '🎱', 'Balls')}
          ${quickLink('zonedex.html', '📍', 'Zones')}
          ${quickLink('pokestats.html', '📊', 'Statistiques')}
          ${quickLink('buypokemon.html', '🛒', 'Boutique')}
          ${quickLink('scrappokemon.html', '♻️', 'Scrapping')}
          ${quickLink('records.html', '🏆', 'Records')}
        </div>

      </div>
    </div>`;
}

function kpi(label, value, accent = 'blue') {
    const colors = { blue: 'var(--accent-blue)', gold: 'var(--shiny-gold)', green: 'var(--accent-green)' };
    return `
    <div class="sd-stat-card">
      <div class="sd-stat-card__value" style="color:${colors[accent] || colors.blue}">${value}</div>
      <div class="sd-stat-card__label">${label}</div>
    </div>`;
}

function leaderboard(title, users, valueKey) {
    return `
    <div class="sd-card">
      <div class="sd-card__body">
        <h2 style="font-size:15px;margin:0 0 12px">${title}</h2>
        <ol class="sd-leaderboard">
          ${users.map((u, i) => `
          <li>
            <span class="sd-leaderboard__rank sd-leaderboard__rank--${i + 1}">${i + 1}</span>
            <span class="sd-leaderboard__name">
              <a href="User/info.html?platform=${encodeURIComponent(u.Platform)}&username=${encodeURIComponent(u.Pseudo)}">${SD.esc(u.Pseudo)}</a>
              ${SD.badge(u.Platform, 'gray')}
            </span>
            <span class="sd-leaderboard__value">${SD.fmt(u[valueKey])}</span>
          </li>`).join('')}
        </ol>
      </div>
    </div>`;
}

function quickLink(href, icon, label) {
    return `
    <a href="${href}" class="sd-card" style="text-decoration:none;display:block;padding:20px;text-align:center;">
      <div style="font-size:28px;margin-bottom:8px">${icon}</div>
      <div style="font-weight:600;font-size:14px;color:var(--text-primary)">${label}</div>
    </a>`;
}

function fmtDate(dateStr) {
    if (!dateStr) return '—';
    try { return new Date(dateStr).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }); }
    catch { return dateStr; }
}