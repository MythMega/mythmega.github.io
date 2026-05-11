// ============================================
// ============================================
// StreamDex - Main page (main.js)
// ============================================

const PLATFORMS    = ['twitch', 'youtube', 'tiktok', 'discord'];
const PLATFORM_ICONS = { twitch: '🟣', youtube: '🔴', tiktok: '⚫', discord: '🔵' };

// ── Persistance via localStorage ─────────────────────────────────────────────
// sd_recent_{platform}  → JSON array (max 3 pseudos)
// sd_last_user          → JSON { platform, username }

const LS_LAST_USER  = 'sd_last_user';
const LS_RECENT_PFX = 'sd_recent_';
const RECENT_MAX    = 3;

function getRecent(platform) {
  const raw = localStorage.getItem(LS_RECENT_PFX + platform);
  console.log(`[storage] getRecent(${platform}) → raw:`, raw);
  try { return JSON.parse(raw || '[]'); }
  catch (e) { console.error(`[storage] parse error getRecent(${platform}):`, e); return []; }
}

function addRecent(platform, pseudo) {
  const list = getRecent(platform).filter(p => p.toLowerCase() !== pseudo.toLowerCase());
  list.unshift(pseudo);
  const toSave = list.slice(0, RECENT_MAX);
  console.log(`[storage] addRecent(${platform}, ${pseudo}) → saving:`, toSave);
  localStorage.setItem(LS_RECENT_PFX + platform, JSON.stringify(toSave));
  console.log(`[storage] localStorage after write:`, localStorage.getItem(LS_RECENT_PFX + platform));
}

function getLastUser() {
  const raw = localStorage.getItem(LS_LAST_USER);
  console.log('[storage] getLastUser() → raw:', raw);
  try { return JSON.parse(raw || 'null'); }
  catch (e) { console.error('[storage] parse error getLastUser:', e); return null; }
}

function saveLastUser(platform, username) {
  const value = JSON.stringify({ platform, username });
  console.log('[storage] saveLastUser → saving:', value);
  localStorage.setItem(LS_LAST_USER, value);
  console.log('[storage] localStorage after write:', localStorage.getItem(LS_LAST_USER));
}

// ─────────────────────────────────────────────────────────────────────────────

let usersByPlatform = {};
let currentPlatform = 'twitch';
let acIndex = -1;

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    console.log('[main] DOMContentLoaded — démarrage init');

    // 1. Injecter les boutons de plateforme
    initPlatformButtons();

    // 2. Brancher les événements
    const input = document.getElementById('user-search-input');
    if (input) {
        console.log('[main] #user-search-input trouvé, branchement des events');
        input.addEventListener('input', onUserInput);
        input.addEventListener('keydown', onUserKeydown);
        input.addEventListener('focus', onUserFocus);
    } else {
        console.error('[main] #user-search-input introuvable dans le DOM.');
    }

    const btn = document.getElementById('goto-user-btn');
    if (btn) {
        console.log('[main] #goto-user-btn trouvé, branchement click');
        btn.addEventListener('click', goToUser);
    } else {
        console.error('[main] #goto-user-btn introuvable dans le DOM.');
    }

    // 3. Charger les deux JSON en parallèle
    console.log('[main] Chargement des JSON...');
    const [platformResult, mainResult] = await Promise.allSettled([
        SD.fetchJson('Data/json/users_by_platform.json'),
        SD.fetchJson('Data/json/main.json')
    ]);

    if (platformResult.status === 'fulfilled') {
        usersByPlatform = platformResult.value;
        console.log('[main] users_by_platform.json chargé :', Object.fromEntries(
            Object.entries(usersByPlatform).map(([k, v]) => [k, v.length + ' utilisateurs'])
        ));
    } else {
        console.error('[main] Erreur chargement users_by_platform.json :', platformResult.reason);
    }

    // 4. Activer Twitch par défaut
    console.log('[main] Activation plateforme par défaut : twitch');
    selectPlatform('twitch');

    // 5. Bouton "Ouvrir le dernier pokédex"
    console.log('[main] Tentative renderLastUserButton...');
    renderLastUserButton();

    if (mainResult.status === 'fulfilled') {
        console.log('[main] main.json chargé, rendu des stats');
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
    console.log('[main] Init terminée.');
});

// ── Bouton "dernier pokédex ouvert" ──────────────────────────────────────────

function renderLastUserButton() {
    const last = getLastUser();
    console.log('[lastUser] Cookie/storage lu :', last);
    if (!last) { console.log('[lastUser] Aucun last_user → bouton non affiché'); return; }

    const platformUsers = (usersByPlatform[last.platform] || []);
    console.log(`[lastUser] Utilisateurs connus sur ${last.platform} :`, platformUsers.length);
    const found = platformUsers.find(u => u.toLowerCase() === last.username.toLowerCase());
    if (!found) { console.warn(`[lastUser] "${last.username}" inconnu sur ${last.platform} → bouton non affiché`); return; }

    const container = document.getElementById('last-user-btn-container');
    if (!container) { console.error('[lastUser] #last-user-btn-container introuvable dans le DOM !'); return; }
    console.log(`[lastUser] Affichage du bouton pour ${found} sur ${last.platform}`);

    container.innerHTML = `
    <button class="sd-btn sd-btn--ghost" id="last-user-btn"
      style="margin-top:10px;font-size:14px;display:flex;align-items:center;gap:8px">
      ${PLATFORM_ICONS[last.platform] || '👤'}
      Ouvrir le dernier Pokédex : <strong>${SD.esc(found)}</strong>
      <span class="sd-badge sd-badge--gray">${SD.esc(last.platform)}</span>
    </button>`;

    document.getElementById('last-user-btn').addEventListener('click', () => {
        window.location.href =
            `User/info.html?platform=${encodeURIComponent(last.platform)}&username=${encodeURIComponent(found)}`;
    });
}

// ── Boutons plateforme ────────────────────────────────────────────────────────

function initPlatformButtons() {
    const container = document.getElementById('platform-buttons');
    if (!container) {
        console.error('[platforms] #platform-buttons introuvable dans le DOM.');
        return;
    }
    console.log('[platforms] Injection des boutons dans #platform-buttons');
    PLATFORMS.forEach(p => {
        const btn = document.createElement('button');
        btn.id = `plat-btn-${p}`;
        btn.className = 'sd-btn sd-btn--ghost plat-btn';
        btn.style.cssText = 'padding:6px 12px;font-size:13px';
        btn.textContent = `${PLATFORM_ICONS[p]} ${p.charAt(0).toUpperCase() + p.slice(1)}`;
        btn.addEventListener('click', () => { console.log('[platforms] Sélection :', p); selectPlatform(p); });
        container.appendChild(btn);
        console.log('[platforms] Bouton ajouté :', p);
    });
}

function selectPlatform(p) {
    console.log('[platforms] selectPlatform :', p);
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

function onUserFocus() {
  const input = document.getElementById('user-search-input');
  const empty = input && input.value.trim() === '';
  console.log('[autocomplete] onUserFocus — champ vide :', empty);
  if (empty) showRecentSuggestions();
}

function showRecentSuggestions() {
  const recent = getRecent(currentPlatform);
  console.log(`[autocomplete] showRecentSuggestions — récents pour ${currentPlatform} :`, recent);
    if (recent.length === 0) { console.log('[autocomplete] Aucun récent → pas de suggestions'); return; }

    // Filtrer par les utilisateurs valides connus
    const platformUsers = usersByPlatform[currentPlatform] || [];
    const valid = recent.filter(r =>
        platformUsers.some(u => u.toLowerCase() === r.toLowerCase())
    );
    console.log('[autocomplete] Récents valides (filtrés) :', valid);
    if (valid.length === 0) { console.log('[autocomplete] Aucun récent valide → pas de suggestions'); return; }

    const list = document.getElementById('autocomplete-list');
    if (!list) { console.error('[autocomplete] #autocomplete-list introuvable'); return; }

    list.innerHTML = `
    <li style="padding:4px 12px;font-size:11px;color:var(--text-muted);
      border-bottom:1px solid var(--border-color);pointer-events:none;user-select:none">
      🕓 Récemment visités
    </li>` +
        valid.map((u, i) =>
            `<li id="ac-item-${i}"
        data-pseudo="${SD.esc(u)}"
        style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border-color)">
        ${PLATFORM_ICONS[currentPlatform]} ${SD.esc(u)}
        <span style="font-size:11px;color:var(--text-muted);margin-left:6px">récent</span>
      </li>`
        ).join('');

    list.querySelectorAll('li[data-pseudo]').forEach((li, i) => {
        li.addEventListener('mousedown', () => pickUser(li.dataset.pseudo));
        li.addEventListener('mouseover', () => highlightAc(i + 1)); // +1 pour le header
    });

    acIndex = -1;
    list.style.display = 'block';
    console.log(`[autocomplete] Liste récents affichée avec ${valid.length} entrée(s)`);
}

function onUserInput() {
    const input = document.getElementById('user-search-input');
    const q = input.value.trim().toLowerCase();
    console.log(`[autocomplete] onUserInput — query: "${q}" — plateforme: ${currentPlatform}`);
    const list = document.getElementById('autocomplete-list');
    hideUserError();

    if (q.length === 0) {
        showRecentSuggestions();
        return;
    }

    const platformUsers = usersByPlatform[currentPlatform] || [];
    const matches = platformUsers.filter(u => u.toLowerCase().includes(q)).slice(0, 10);
    console.log(`[autocomplete] ${matches.length} correspondance(s) :`, matches);

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
    const items = list.querySelectorAll('li[data-pseudo]');
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
    refreshAcHighlight(document.querySelectorAll('#autocomplete-list li[data-pseudo]'));
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

document.addEventListener('click', e => {
    if (!e.target.closest('#user-search-input') && !e.target.closest('#autocomplete-list')) {
        hideAutocomplete();
    }
});

// ── Navigation ────────────────────────────────────────────────────────────────

function goToUser() {
  const input  = document.getElementById('user-search-input');
  const pseudo = input ? input.value.trim() : '';
  console.log(`[nav] goToUser — pseudo: "${pseudo}" — plateforme: ${currentPlatform}`);
  if (!pseudo) { console.log('[nav] Champ vide, annulé'); return; }

  const platformUsers = usersByPlatform[currentPlatform] || [];
  console.log(`[nav] Recherche parmi ${platformUsers.length} utilisateurs sur ${currentPlatform}`);
  const found = platformUsers.find(u => u.toLowerCase() === pseudo.toLowerCase());

  if (found) {
    console.log(`[nav] Trouvé : "${found}" → écriture storage puis navigation`);
    navigateToUser(currentPlatform, found);
  } else {
    console.warn(`[nav] "${pseudo}" introuvable sur ${currentPlatform}`, { utilisateursConnus: platformUsers });
    showUserError(`"${pseudo}" n'a pas été trouvé sur ${currentPlatform}.`);
  }
}

function navigateToUser(platform, username) {
  console.log(`[nav] navigateToUser(${platform}, ${username})`);
  addRecent(platform, username);
  saveLastUser(platform, username);
  const url = `User/info.html?platform=${encodeURIComponent(platform)}&username=${encodeURIComponent(username)}`;
  console.log('[nav] Redirection vers :', url);
  window.location.href = url;
}

function showUserError(msg) {
  const el = document.getElementById('user-error');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function hideUserError() {
  const el = document.getElementById('user-error');
  if (el) el.style.display = 'none';
}

// ── Rendu des statistiques ────────────────────────────────────────────────────

function renderStats(d) {
    const stats = d.GlobalStats || {};
    const rankings = d.Rankings || {};
    const recent = d.RecentCatches || [];
    const section = document.getElementById('sd-stats-section');
    if (!section) { console.error('[main] #sd-stats-section introuvable.'); return; }

    section.innerHTML = `
    ${d.LastUpdate
            ? `<p style="font-size:12px;color:var(--text-muted);margin:0 0 16px">Mis à jour : ${fmtDate(d.LastUpdate)}</p>`
            : ''}

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

    <div class="sd-grid sd-grid--2" style="margin-bottom:24px">
      ${rankings.TopBalls ? leaderboard('🎳 Top Balls lancées', rankings.TopBalls, 'BallLaunched') : ''}
      ${rankings.TopMoney ? leaderboard('💸 Top Argent dépensé', rankings.TopMoney, 'MoneySpent') : ''}
      ${rankings.TopShiny ? leaderboard('✨ Top Chasseurs Shiny', rankings.TopShiny, 'ShinyCount') : ''}
      ${rankings.TopDex ? leaderboard('📖 Top Pokédex', rankings.TopDex, 'DexCount') : ''}
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
      ${quickLink('balldex.html', '🎱', 'Balls')}
      ${quickLink('zonedex.html', '📍', 'Zones')}
      ${quickLink('pokestats.html', '📊', 'Statistiques')}
      ${quickLink('buypokemon.html', '🛒', 'Boutique')}
      ${quickLink('scrappokemon.html', '♻️', 'Scrapping')}
      ${quickLink('records.html', '🏆', 'Records')}
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