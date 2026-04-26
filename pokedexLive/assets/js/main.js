// ============================================
// StreamDex - Main page (main.js)
// ============================================

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