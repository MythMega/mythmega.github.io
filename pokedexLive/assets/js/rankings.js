// ============================================
// StreamDex - Rankings page (rankings.js)
// Charge Data/json/rankings.json et construit
// plusieurs onglets de classements Top 10.
// Animations déclenchées par IntersectionObserver.
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  const root = document.getElementById('sd-root');
  SD.loading(root);

  let data;
  try {
    data = await SD.fetchJson('Data/json/rankings.json');
  } catch {
    SD.error(root, 'Impossible de charger les classements. Aucun export effectué ?');
    return;
  }

  const players = data.players || [];
  if (players.length === 0) {
    SD.empty(root, 'Aucun joueur enregistré.');
    return;
  }

  // ── Définition des onglets et de leurs classements ──────────────────────────

  const TABS = [
    {
      id: 'global',
      label: '🌍 Global',
      groups: [
        {
          title: 'Progression',
          rankings: [
            { id: 'level',        icon: '⭐', title: 'Niveau',            key: 'level',         fmt: v => `Lv ${v}`,             color: 'orange', platform: null },
            { id: 'dexcount',     icon: '📖', title: 'Pokédex Normal',    key: 'dexCount',      fmt: v => SD.fmt(v),             color: 'blue',   platform: null },
            { id: 'shinydex',     icon: '✨', title: 'Pokédex Shiny',     key: 'shinyDex',      fmt: v => SD.fmt(v),             color: 'gold',   platform: null },
          ]
        },
        {
          title: 'Activité',
          rankings: [
            { id: 'balls',        icon: '🎱', title: 'Balls lancées',     key: 'ballLaunched',  fmt: v => SD.fmt(v),             color: '',       platform: null },
            { id: 'caught',       icon: '🎉', title: 'Pokémon capturés',  key: 'pokeCaught',    fmt: v => SD.fmt(v),             color: 'green',  platform: null },
            { id: 'shiny',        icon: '💫', title: 'Shiny capturés',    key: 'shinyCaught',   fmt: v => SD.fmt(v),             color: 'gold',   platform: null },
          ]
        },
        {
          title: 'Économie',
          rankings: [
            { id: 'moneyspent',   icon: '💸', title: 'Argent dépensé',    key: 'moneySpent',    fmt: v => `${SD.fmt(v)} 💰`,     color: 'orange', platform: null },
            { id: 'custommoney',  icon: '🏦', title: 'Économies',         key: 'customMoney',   fmt: v => `${SD.fmt(v)} 💰`,     color: 'green',  platform: null },
            { id: 'scrap',        icon: '♻️', title: 'Scrap total',       key: '_scrapTotal',   fmt: v => SD.fmt(v),             color: 'purple', platform: null },
            { id: 'scrappedshiny',icon: '♻✨', title: 'Scrap Shiny',      key: 'scrappedShiny', fmt: v => SD.fmt(v),             color: 'gold',   platform: null },
          ]
        },
        {
          title: 'Social',
          rankings: [
            { id: 'trade',        icon: '🤝', title: 'Trades effectués',  key: 'tradeCount',    fmt: v => SD.fmt(v),             color: '',       platform: null },
            { id: 'giveaway',     icon: '🎁', title: 'Giveaways reçus',   key: '_giveTotal',    fmt: v => SD.fmt(v),             color: 'purple', platform: null },
          ]
        },
        {
          title: 'Raids',
          rankings: [
            { id: 'raidcount',    icon: '⚔️', title: 'Raids participés',  key: 'raidCount',     fmt: v => SD.fmt(v),             color: 'red',    platform: null },
            { id: 'raiddmg',      icon: '💥', title: 'Dégâts en raids',   key: 'raidTotalDmg',  fmt: v => SD.fmt(v),             color: 'red',    platform: null },
          ]
        },
      ]
    },
    {
      id: 'twitch',
      label: '🟣 Twitch',
      platform: 'twitch',
      groups: [
        {
          title: 'Top Twitch',
          rankings: [
            { id: 'tw-level',     icon: '⭐', title: 'Niveau',            key: 'level',         fmt: v => `Lv ${v}`,             color: 'orange', platform: 'twitch' },
            { id: 'tw-caught',    icon: '🎉', title: 'Pokémon capturés',  key: 'pokeCaught',    fmt: v => SD.fmt(v),             color: 'green',  platform: 'twitch' },
            { id: 'tw-shiny',     icon: '💫', title: 'Shiny capturés',    key: 'shinyCaught',   fmt: v => SD.fmt(v),             color: 'gold',   platform: 'twitch' },
            { id: 'tw-dex',       icon: '📖', title: 'Pokédex Normal',    key: 'dexCount',      fmt: v => SD.fmt(v),             color: 'blue',   platform: 'twitch' },
            { id: 'tw-shinydex',  icon: '✨', title: 'Pokédex Shiny',     key: 'shinyDex',      fmt: v => SD.fmt(v),             color: 'gold',   platform: 'twitch' },
            { id: 'tw-money',     icon: '💰', title: 'Économies',         key: 'customMoney',   fmt: v => `${SD.fmt(v)} 💰`,     color: 'green',  platform: 'twitch' },
            { id: 'tw-raid',      icon: '⚔️', title: 'Raids participés',  key: 'raidCount',     fmt: v => SD.fmt(v),             color: 'red',    platform: 'twitch' },
            { id: 'tw-raiddmg',   icon: '💥', title: 'Dégâts en raids',   key: 'raidTotalDmg',  fmt: v => SD.fmt(v),             color: 'red',    platform: 'twitch' },
            { id: 'tw-trade',     icon: '🤝', title: 'Trades effectués',  key: 'tradeCount',    fmt: v => SD.fmt(v),             color: '',       platform: 'twitch' },
          ]
        },
      ]
    },
    {
      id: 'youtube',
      label: '🔴 YouTube',
      platform: 'youtube',
      groups: [
        {
          title: 'Top YouTube',
          rankings: [
            { id: 'yt-level',     icon: '⭐', title: 'Niveau',            key: 'level',         fmt: v => `Lv ${v}`,             color: 'orange', platform: 'youtube' },
            { id: 'yt-caught',    icon: '🎉', title: 'Pokémon capturés',  key: 'pokeCaught',    fmt: v => SD.fmt(v),             color: 'green',  platform: 'youtube' },
            { id: 'yt-shiny',     icon: '💫', title: 'Shiny capturés',    key: 'shinyCaught',   fmt: v => SD.fmt(v),             color: 'gold',   platform: 'youtube' },
            { id: 'yt-dex',       icon: '📖', title: 'Pokédex Normal',    key: 'dexCount',      fmt: v => SD.fmt(v),             color: 'blue',   platform: 'youtube' },
            { id: 'yt-shinydex',  icon: '✨', title: 'Pokédex Shiny',     key: 'shinyDex',      fmt: v => SD.fmt(v),             color: 'gold',   platform: 'youtube' },
            { id: 'yt-money',     icon: '💰', title: 'Économies',         key: 'customMoney',   fmt: v => `${SD.fmt(v)} 💰`,     color: 'green',  platform: 'youtube' },
            { id: 'yt-raid',      icon: '⚔️', title: 'Raids participés',  key: 'raidCount',     fmt: v => SD.fmt(v),             color: 'red',    platform: 'youtube' },
          ]
        },
      ]
    },
    {
      id: 'discord',
      label: '🔵 Discord',
      platform: 'discord',
      groups: [
        {
          title: 'Top Discord',
          rankings: [
            { id: 'dc-level',     icon: '⭐', title: 'Niveau',            key: 'level',         fmt: v => `Lv ${v}`,             color: 'orange', platform: 'discord' },
            { id: 'dc-caught',    icon: '🎉', title: 'Pokémon capturés',  key: 'pokeCaught',    fmt: v => SD.fmt(v),             color: 'green',  platform: 'discord' },
            { id: 'dc-shiny',     icon: '💫', title: 'Shiny capturés',    key: 'shinyCaught',   fmt: v => SD.fmt(v),             color: 'gold',   platform: 'discord' },
            { id: 'dc-dex',       icon: '📖', title: 'Pokédex Normal',    key: 'dexCount',      fmt: v => SD.fmt(v),             color: 'blue',   platform: 'discord' },
            { id: 'dc-money',     icon: '💰', title: 'Économies',         key: 'customMoney',   fmt: v => `${SD.fmt(v)} 💰`,     color: 'green',  platform: 'discord' },
          ]
        },
      ]
    },
  ];

  // ── Pré-calcul des champs dérivés ────────────────────────────────────────────
  players.forEach(p => {
    p._scrapTotal = (p.scrappedNormal || 0) + (p.scrappedShiny || 0);
    p._giveTotal  = (p.giveawayNormal || 0) + (p.giveawayShiny || 0);
  });

  // ── Résumé par plateforme ────────────────────────────────────────────────────
  const PLATFORMS = ['twitch', 'youtube', 'tiktok', 'discord'];
  const PLAT_ICONS = { twitch: '🟣', youtube: '🔴', tiktok: '⚫', discord: '🔵' };
  const platSummary = PLATFORMS.map(pl => {
    const pp = players.filter(p => (p.platform || '').toLowerCase() === pl);
    return { pl, icon: PLAT_ICONS[pl] || '⚪', count: pp.length, totalCaught: pp.reduce((s, p) => s + (p.pokeCaught || 0), 0) };
  }).filter(s => s.count > 0);

  // ── Squelette HTML ───────────────────────────────────────────────────────────
  root.innerHTML = `
    <div class="sd-page">
      <div class="sd-container">

        <div class="sd-section-header" style="margin-bottom:20px">
          <h1>🏆 Classements</h1>
          <span style="font-size:13px;color:var(--text-muted)">${players.length} joueur${players.length > 1 ? 's' : ''} enregistré${players.length > 1 ? 's' : ''}</span>
        </div>

        <!-- Résumé plateformes -->
        <div class="rk-platform-summary" id="plat-summary">
          ${platSummary.map((s, i) => `
            <div class="rk-plat-badge" style="transition-delay:${i * 0.08}s">
              <span class="rk-plat-badge__label">${s.icon} ${s.pl.charAt(0).toUpperCase() + s.pl.slice(1)}</span>
              <span class="rk-plat-badge__value">${s.count}</span>
              <span class="rk-plat-badge__sub">joueur${s.count > 1 ? 's' : ''} · ${SD.fmt(s.totalCaught)} capturés</span>
            </div>`).join('')}
        </div>

        <!-- Onglets -->
        <div class="rk-tabs" id="rk-tabs">
          ${TABS.map((t, i) => `<button class="rk-tab${i === 0 ? ' is-active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
        </div>

        <!-- Contenu des onglets -->
        ${TABS.map((tab, i) => `
          <div class="rk-section${i === 0 ? ' is-active' : ''}" id="rk-section-${tab.id}">
            ${tab.groups.map(group => `
              <div class="rk-group-title">${group.title}</div>
              <div class="rk-grid">
                ${group.rankings.map(r => renderCard(r, players)).join('')}
              </div>
            `).join('')}
          </div>`).join('')}

      </div>
    </div>`;

  // ── Onglets ──────────────────────────────────────────────────────────────────
  document.querySelectorAll('.rk-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rk-tab').forEach(b => b.classList.remove('is-active'));
      document.querySelectorAll('.rk-section').forEach(s => s.classList.remove('is-active'));
      btn.classList.add('is-active');
      document.getElementById(`rk-section-${btn.dataset.tab}`).classList.add('is-active');
      // Re-déclencher les animations sur les cartes du nouvel onglet
      triggerVisible();
    });
  });

  // ── IntersectionObserver pour animations au scroll ───────────────────────────
  function triggerVisible() {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          // Déclenche les rangées enfants
          entry.target.querySelectorAll('.rk-row').forEach(row => row.classList.add('is-visible'));
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });

    document.querySelectorAll('.rk-card:not(.is-visible), .rk-plat-badge:not(.is-visible)').forEach(el => {
      observer.observe(el);
    });
  }

  triggerVisible();

  // ── Construction d'une carte de classement ───────────────────────────────────
  function renderCard(rk, allPlayers) {
    // Filtrage par plateforme si besoin
    let pool = rk.platform
      ? allPlayers.filter(p => (p.platform || '').toLowerCase() === rk.platform.toLowerCase())
      : allPlayers;

    // Tri décroissant + top 10
    const top = [...pool]
      .filter(p => (p[rk.key] ?? 0) > 0)
      .sort((a, b) => (b[rk.key] || 0) - (a[rk.key] || 0))
      .slice(0, 10);

    if (top.length === 0) return '';

    const maxVal = top[0][rk.key] || 1;
    const barColor = {
      gold: '#ffd700', green: '#3fb950', red: '#f85149',
      purple: '#bc8cff', orange: '#d29922', blue: '#58a6ff', '': '#58a6ff'
    }[rk.color] || '#58a6ff';

    const platLabel = rk.platform ? `<span class="rk-card__platform">${rk.platform}</span>` : '';

    return `
      <div class="rk-card">
        <div class="rk-card__header">
          <span class="rk-card__icon">${rk.icon}</span>
          <span class="rk-card__title">${rk.title}</span>
          ${platLabel}
        </div>
        <ul class="rk-list">
          ${top.map((p, i) => {
            const pct = Math.round(((p[rk.key] || 0) / maxVal) * 100);
            return `
              <li class="rk-row">
                <span class="rk-rank rk-rank--${i + 1}">${rankLabel(i + 1)}</span>
                <div class="rk-player">
                  <div class="rk-player__name" title="${SD.esc(p.pseudo)}">${SD.esc(p.pseudo)}</div>
                  <div class="rk-player__platform">${p.platform || ''}</div>
                </div>
                <div class="rk-bar-wrap">
                  <div class="rk-bar" style="--bar-pct:${pct}%;background:${barColor}"></div>
                </div>
                <span class="rk-value rk-value--${rk.color}">${rk.fmt(p[rk.key] || 0)}</span>
              </li>`;
          }).join('')}
        </ul>
      </div>`;
  }

  function rankLabel(i) {
    if (i === 1) return '🥇';
    if (i === 2) return '🥈';
    if (i === 3) return '🥉';
    return i;
  }
});
