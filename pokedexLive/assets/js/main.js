// ============================================
// StreamDex - Main page (main.js)
// Le widget de recherche est dans main.html.
// Ce script le câble et charge les stats.
// ============================================

const PLATFORMS = ['twitch', 'youtube', 'tiktok', 'discord'];
const PLATFORM_ICONS = { twitch: '🟣', youtube: '🔴', tiktok: '⚫', discord: '🔵' };

let usersByPlatform = {};
let currentPlatform = 'twitch';
let acIndex = -1;

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Injecter les boutons de plateforme dans le conteneur HTML existant
  initPlatformButtons();

  // 2. Brancher les événements sur les éléments HTML existants
  const input = document.getElementById('user-search-input');
  if (input) {
    input.addEventListener('input', onUserInput);
    input.addEventListener('keydown', onUserKeydown);
  } else {
    console.error('[main] #user-search-input introuvable dans le DOM.');
  }

  const btn = document.getElementById('goto-user-btn');
  if (btn) btn.addEventListener('click', goToUser);
  else console.error('[main] #goto-user-btn introuvable dans le DOM.');

  // 3. Charger les deux JSON en parallèle
  const [platformResult, mainResult] = await Promise.allSettled([
    SD.fetchJson('Data/json/users_by_platform.json'),
    SD.fetchJson('Data/json/main.json')
  ]);

  if (platformResult.status === 'fulfilled') {
    usersByPlatform = platformResult.value;
    console.log('[main] users_by_platform chargé :', Object.fromEntries(
      Object.entries(usersByPlatform).map(([k, v]) => [k, v.length + ' utilisateurs'])
    ));
  } else {
    console.error('[main] Erreur chargement users_by_platform.json :', platformResult.reason);
  }

  // Activer Twitch par défaut après chargement des données
  selectPlatform('twitch');

  if (mainResult.status === 'fulfilled') {
    console.log('[main] main.json chargé.');
    renderStats(mainResult.value);
  } else {
    console.error('[main] Erreur chargement main.json :', mainResult.reason);
    const section = document.getElementById('sd-stats-section');
    if (section) {
      section.innerHTML = `<div class="sd-error" style="margin-bottom:24px">
        ⚠️ Impossible de charger les statistiques.<br>
        <small style="color:var(--text-muted)">${mainResult.reason}</small>
      </div>`;
    }
  }
});

// ── Boutons plateforme ────────────────────────────────────────────────────────

function initPlatformButtons() {
  const container = document.getElementById('platform-buttons');
  if (!container) {
    console.error('[main] #platform-buttons introuvable dans le DOM.');
    return;
  }
  PLATFORMS.forEach(p => {
    const btn = document.createElement('button');
    btn.id = `plat-btn-${p}`;
    btn.className = 'sd-btn sd-btn--ghost plat-btn';
    btn.style.cssText = 'padding:6px 12px;font-size:13px';
    btn.textContent = `${PLATFORM_ICONS[p]} ${p.charAt(0).toUpperCase() + p.slice(1)}`;
    btn.addEventListener('click', () => selectPlatform(p));
    container.appendChild(btn);
  });
}

function selectPlatform(p) {
  currentPlatform = p;
  PLATFORMS.forEach(pl => {
    const btn = document.getElementById(`plat-btn-${pl}`);
    if (!btn) return;
    btn.className = pl === p ? 'sd-btn sd-btn--primary plat-btn' : 'sd-btn sd-btn--ghost plat-btn';
  });
  const input = document.getElementById('user-search-input');
  if (input) input.value = '';
  hideUserError();
  hideAutocomplete();
}

// ── Autocomplete ──────────────────────────────────────────────────────────────

function onUserInput() {
  const input = document.getElementById('user-search-input');
  const q = input.value.trim().toLowerCase();
  const list = document.getElementById('autocomplete-list');
  hideUserError();

  const platformUsers = usersByPlatform[currentPlatform] || [];
  const matches = q.length === 0
    ? []
    : platformUsers.filter(u => u.toLowerCase().includes(q)).slice(0, 10);

  acIndex = -1;

  if (matches.length === 0) {
    hideAutocomplete();
    return;
  }

  list.innerHTML = matches.map((u, i) =>
    `<li id="ac-item-${i}"
      data-pseudo="${SD.esc(u)}"
      style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border-color)">
      ${PLATFORM_ICONS[currentPlatform]} ${SD.esc(u)}
    </li>`
  ).join('');

  list.querySelectorAll('li').forEach((li, i) => {
    li.addEventListener('mousedown', () => pickUser(li.dataset.pseudo));
    li.addEventListener('mouseover', () => highlightAc(i));
  });

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
      pickUser(items[acIndex].dataset.pseudo);
    } else {
      goToUser();
    }
  } else if (e.key === 'Escape') {
    hideAutocomplete();
  }
}

function highlightAc(i) {
  acIndex = i;
  refreshAcHighlight(document.querySelectorAll('#autocomplete-list li'));
}

function refreshAcHighlight(items) {
  items.forEach((el, i) => {
    el.style.background = i === acIndex ? 'var(--bg-card-hover)' : '';
    el.style.color      = i === acIndex ? 'var(--accent-blue)'   : '';
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

document.addEventListener('click', e => {
  if (!e.target.closest('#user-search-input') && !e.target.closest('#autocomplete-list')) {
    hideAutocomplete();
  }
});

// ── Navigation ────────────────────────────────────────────────────────────────

function goToUser() {
  const input  = document.getElementById('user-search-input');
  const pseudo = input ? input.value.trim() : '';
  if (!pseudo) return;

  const platformUsers = usersByPlatform[currentPlatform] || [];
  const found = platformUsers.find(u => u.toLowerCase() === pseudo.toLowerCase());

  if (found) {
    console.log(`[main] Navigation vers ${found} sur ${currentPlatform}`);
    window.location.href =
      `User/info.html?platform=${encodeURIComponent(currentPlatform)}&username=${encodeURIComponent(found)}`;
  } else {
    console.warn(`[main] Utilisateur "${pseudo}" introuvable sur ${currentPlatform}`, {
      plateforme: currentPlatform,
      pseudo,
      utilisateursConnus: usersByPlatform[currentPlatform] || []
    });
    showUserError(
      `"${pseudo}" n'a pas été trouvé sur ${currentPlatform.charAt(0).toUpperCase() + currentPlatform.slice(1)} parmi les utilisateurs enregistrés.`
    );
  }
}

function showUserError(msg) {
  const el = document.getElementById('user-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
}

function hideUserError() {
  const el = document.getElementById('user-error');
  if (el) el.style.display = 'none';
}

// ── Rendu des statistiques ────────────────────────────────────────────────────

function renderStats(d) {
  const stats    = d.GlobalStats   || {};
  const rankings = d.Rankings      || {};
  const recent   = d.RecentCatches || [];
  const section  = document.getElementById('sd-stats-section');
  if (!section) { console.error('[main] #sd-stats-section introuvable.'); return; }

  section.innerHTML = `
    ${d.LastUpdate
      ? `<p style="font-size:12px;color:var(--text-muted);margin:0 0 16px">Mis à jour : ${fmtDate(d.LastUpdate)}</p>`
      : ''}

    <div class="sd-stat-grid" style="margin-bottom:24px">
      ${kpi('Pokéballs lancées',  SD.fmt(stats.TotalBallLaunched))}
      ${kpi('Pokémon capturés',   SD.fmt(stats.TotalPokeCaught))}
      ${kpi('Shiny capturés',     SD.fmt(stats.TotalShinyCaught),  'gold')}
      ${kpi('Argent dépensé',     SD.fmt(stats.TotalMoneySpent))}
      ${kpi('Participants',       SD.fmt(stats.TotalUsers))}
      ${kpi('Dex Normal',  `${stats.GlobalDexNormal ?? 0}/${stats.TotalPokemons ?? 0}`, 'blue')}
      ${kpi('Dex Shiny',   `${stats.GlobalDexShiny  ?? 0}/${stats.TotalPokemons ?? 0}`, 'gold')}
      ${kpi('Normal distribués',  SD.fmt(stats.TotalGiveawayNormal))}
      ${kpi('Shiny distribués',   SD.fmt(stats.TotalGiveawayShiny), 'gold')}
    </div>

    <div class="sd-grid sd-grid--2" style="margin-bottom:24px">
      ${rankings.TopBalls ? leaderboard('🎳 Top Balls lancées',   rankings.TopBalls,  'BallLaunched') : ''}
      ${rankings.TopMoney ? leaderboard('💸 Top Argent dépensé',  rankings.TopMoney,  'MoneySpent')   : ''}
      ${rankings.TopShiny ? leaderboard('✨ Top Chasseurs Shiny', rankings.TopShiny,  'ShinyCount')   : ''}
      ${rankings.TopDex   ? leaderboard('📖 Top Pokédex',         rankings.TopDex,    'DexCount')     : ''}
    </div>

    ${recent.length > 0 ? `
    <div class="sd-section-header"><h2>🕐 Captures récentes</h2></div>
    <div class="sd-table-wrap" style="margin-bottom:24px">
      <table class="sd-table">
        <thead><tr>
          <th>Sprite</th><th>Pokémon</th><th>Joueur</th><th>Statut</th><th>Pokéball</th><th>Date</th>
        </tr></thead>
        <tbody>
          ${recent.map(c => `<tr>
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

    <div class="sd-section-header"><h2>🔗 Accès rapide</h2></div>
    <div class="sd-grid sd-grid--auto" style="margin-bottom:24px">
      ${quickLink('availablepokemon.html', '🐾', 'Pokédex disponible')}
      ${quickLink('balldex.html',          '🎱', 'Balls')}
      ${quickLink('zonedex.html',          '📍', 'Zones')}
      ${quickLink('pokestats.html',        '📊', 'Statistiques')}
      ${quickLink('buypokemon.html',       '🛒', 'Boutique')}
      ${quickLink('scrappokemon.html',     '♻️', 'Scrapping')}
      ${quickLink('records.html',          '🏆', 'Records')}
    </div>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function kpi(label, value, accent = 'blue') {
  const colors = { blue: 'var(--accent-blue)', gold: 'var(--shiny-gold)', green: 'var(--accent-green)' };
  return `<div class="sd-stat-card">
    <div class="sd-stat-card__value" style="color:${colors[accent] || colors.blue}">${value}</div>
    <div class="sd-stat-card__label">${label}</div>
  </div>`;
}

function leaderboard(title, users, valueKey) {
  return `<div class="sd-card"><div class="sd-card__body">
    <h2 style="font-size:15px;margin:0 0 12px">${title}</h2>
    <ol class="sd-leaderboard">
      ${users.map((u, i) => `<li>
        <span class="sd-leaderboard__rank sd-leaderboard__rank--${i + 1}">${i + 1}</span>
        <span class="sd-leaderboard__name">
          <a href="User/info.html?platform=${encodeURIComponent(u.Platform)}&username=${encodeURIComponent(u.Pseudo)}">${SD.esc(u.Pseudo)}</a>
          ${SD.badge(u.Platform, 'gray')}
        </span>
        <span class="sd-leaderboard__value">${SD.fmt(u[valueKey])}</span>
      </li>`).join('')}
    </ol>
  </div></div>`;
}

function quickLink(href, icon, label) {
  return `<a href="${href}" class="sd-card" style="text-decoration:none;display:block;padding:20px;text-align:center;">
    <div style="font-size:28px;margin-bottom:8px">${icon}</div>
    <div style="font-weight:600;font-size:14px;color:var(--text-primary)">${label}</div>
  </a>`;
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  try { return new Date(dateStr).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }); }
  catch { return dateStr; }
}
