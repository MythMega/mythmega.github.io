// ============================================
// StreamDex - Rankings page (rankings.js)
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

  // Exclure platform "system" (double sécurité côté JS)
  const players = (data.players || []).filter(p => (p.platform || '').toLowerCase() !== 'system');
  if (players.length === 0) { SD.empty(root, 'Aucun joueur enregistré.'); return; }

  // ── Champs dérivés JS ───────────────────────────────────────────────────────
  players.forEach(p => {
    p._scrapTotal  = (p.scrappedNormal || 0) + (p.scrappedShiny || 0);
    p._giveTotal   = (p.giveawayNormal || 0) + (p.giveawayShiny || 0);
    p._dexTotal    = (p.dexCount || 0) + (p.shinyDex || 0);
    p._catchShinyPct = p.pokeCaught > 0 ? ((p.shinyCaught / p.pokeCaught) * 100) : 0;
    p._ballSuccessPct = p.ballLaunched > 0 ? ((p.pokeCaught / p.ballLaunched) * 100) : 0;
    p._raidAvgDmg  = p.raidAvgDmg || 0;
    p._catchPerDay = p.catchPerDay || 0;
    p._daysActive  = p.daysActive  || 0;
  });

  // ── Résumé par plateforme (hors system) ────────────────────────────────────
  const PLAT_ICONS = { twitch: '🟣', youtube: '🔴', tiktok: '⚫', discord: '🔵' };
  const allPlatforms = [...new Set(players.map(p => (p.platform || '').toLowerCase()))]
    .filter(pl => pl && pl !== 'system')
    .sort();

  const platStats = allPlatforms.map(pl => {
    const pp = players.filter(p => (p.platform || '').toLowerCase() === pl);
    return {
      pl,
      icon: PLAT_ICONS[pl] || '⚪',
      count:        pp.length,
      totalCaught:  pp.reduce((s, p) => s + (p.pokeCaught   || 0), 0),
      totalShiny:   pp.reduce((s, p) => s + (p.shinyCaught  || 0), 0),
      totalBalls:   pp.reduce((s, p) => s + (p.ballLaunched || 0), 0),
      totalMoney:   pp.reduce((s, p) => s + (p.moneySpent   || 0), 0),
      totalSaved:   pp.reduce((s, p) => s + (p.customMoney  || 0), 0),
      totalRaids:   pp.reduce((s, p) => s + (p.raidCount    || 0), 0),
      totalDmg:     pp.reduce((s, p) => s + (p.raidTotalDmg || 0), 0),
      totalTrades:  pp.reduce((s, p) => s + (p.tradeCount   || 0), 0),
      totalScrap:   pp.reduce((s, p) => s + (p._scrapTotal  || 0), 0),
      maxLevel:     pp.length ? Math.max(...pp.map(p => p.level || 0)) : 0,
      avgLevel:     pp.length ? Math.round(pp.reduce((s, p) => s + (p.level || 0), 0) / pp.length) : 0,
      maxDex:       pp.length ? Math.max(...pp.map(p => p.dexCount || 0)) : 0,
    };
  });

  // ── Définition des onglets ───────────────────────────────────────────────────
  const TOP = 10;

  function mkRk(id, icon, title, key, fmt, color, platform = null) {
    return { id, icon, title, key, fmt, color, platform };
  }

  const RARITY_ORDER = { COMMON: 1, UNCOMMON: 2, RARE: 3, EPIC: 4, LEGENDARY: 5, MYTHICAL: 6 };
  const RARITY_LABEL = { COMMON: 'Communs', UNCOMMON: 'Peu communs', RARE: 'Rares', EPIC: 'Épiques', LEGENDARY: 'Légendaires', MYTHICAL: 'Mythiques' };
  const RARITY_ICONS = { COMMON: '⚪', UNCOMMON: '🔵', RARE: '💎', EPIC: '🟣', LEGENDARY: '🌟', MYTHICAL: '🔮' };
  const RARITY_COLOR = { COMMON: '', UNCOMMON: '', RARE: 'blue', EPIC: 'purple', LEGENDARY: 'gold', MYTHICAL: 'purple' };

  function rarityIcon(r)  { return RARITY_ICONS[r.toUpperCase()] || '🎴'; }
  function rarityColor(r) { return RARITY_COLOR[r.toUpperCase()] || ''; }
  function rarityLabel(r) { return RARITY_LABEL[r.toUpperCase()] || r; }

  // Rarités détectées dynamiquement, triées selon l'ordre défini
  const raritySet = new Set();
  players.forEach(p => { if (p.rarityCounts) Object.keys(p.rarityCounts).forEach(r => raritySet.add(r)); });
  const rarities = [...raritySet]
    .filter(r => r && r !== 'Unknown')
    .sort((a, b) => (RARITY_ORDER[a.toUpperCase()] || 99) - (RARITY_ORDER[b.toUpperCase()] || 99));
  players.forEach(p => {
    rarities.forEach(r => { p[`_rar_${r}`] = (p.rarityCounts && p.rarityCounts[r]) ? p.rarityCounts[r] : 0; });
  });

  // Classements rareté : utilise le label traduit comme titre
  const rarityRankings = (prefix, pl = null) =>
    rarities.map(r => mkRk(`${prefix}-rar-${r}`, rarityIcon(r), rarityLabel(r), `_rar_${r}`, v => SD.fmt(v), rarityColor(r), pl));

  const globalGroups = [
    {
      title: 'Progression',
      rankings: [
        mkRk('level',        '⭐', 'Niveau',               'level',          v => `Lv ${v}`,           'orange'),
        mkRk('xp',           '🔮', 'XP accumulée',          'currentXP',      v => SD.fmt(v),           'purple'),
        mkRk('dexcount',     '📖', 'Pokédex Normal',        'dexCount',       v => SD.fmt(v),           'blue'),
        mkRk('shinydex',     '✨', 'Pokédex Shiny',         'shinyDex',       v => SD.fmt(v),           'gold'),
      ]
    },
    {
      title: 'Captures',
      rankings: [
        mkRk('caught',       '🎉', 'Pokémon capturés',      'pokeCaught',     v => SD.fmt(v),           'green'),
        mkRk('shiny',        '💫', 'Shiny capturés',        'shinyCaught',    v => SD.fmt(v),           'gold'),
        mkRk('balls',        '🎱', 'Balls lancées',         'ballLaunched',   v => SD.fmt(v),           ''),
        mkRk('daysactive',   '🗓️', 'Jours actifs',          '_daysActive',    v => `${SD.fmt(v)} j`,    'purple'),
      ]
    },
    {
      title: 'Par rareté',
      rankings: rarityRankings('rar')
    },
    {
      title: 'Économie',
      rankings: [
        mkRk('moneyspent',   '💸', 'Argent dépensé',        'moneySpent',     v => `${SD.fmt(v)} 💰`,   'orange'),
        mkRk('custommoney',  '🏦', 'Économies',             'customMoney',    v => `${SD.fmt(v)} 💰`,   'green'),
        mkRk('scrap',        '♻️', 'Scrap total',           '_scrapTotal',    v => SD.fmt(v),           'purple'),
        mkRk('scrappedshiny','♻✨', 'Scrap Shiny',           'scrappedShiny',  v => SD.fmt(v),           'gold'),
        mkRk('scrappednorm', '♻📦','Scrap Normal',           'scrappedNormal', v => SD.fmt(v),           'blue'),
      ]
    },
    {
      title: 'Social',
      rankings: [
        mkRk('trade',        '🤝', 'Trades effectués',      'tradeCount',     v => SD.fmt(v),           ''),
        mkRk('giveaway',     '🎁', 'Giveaways reçus',       '_giveTotal',     v => SD.fmt(v),           'purple'),
        mkRk('giveawaynorm', '🎁', 'Giveaways Normal',      'giveawayNormal', v => SD.fmt(v),           'blue'),
        mkRk('giveawayshiny','🎁✨','Giveaways Shiny',        'giveawayShiny',  v => SD.fmt(v),           'gold'),
      ]
    },
    {
      title: 'Raids',
      rankings: [
        mkRk('raidcount',    '⚔️', 'Raids participés',      'raidCount',      v => SD.fmt(v),           'red'),
        mkRk('raiddmg',      '💥', 'Dégâts totaux raids',   'raidTotalDmg',   v => SD.fmt(v),           'red'),
        mkRk('raidavg',      '📊', 'Dégâts moyens / raid',  '_raidAvgDmg',    v => SD.fmt(v),           'orange'),
      ]
    },
  ];

  function platGroups(pl) {
    return [
      {
        title: `Top ${pl.charAt(0).toUpperCase() + pl.slice(1)}`,
        rankings: [
          mkRk(`${pl}-level`,    '⭐', 'Niveau',              'level',          v => `Lv ${v}`,           'orange', pl),
          mkRk(`${pl}-xp`,       '🔮', 'XP accumulée',        'currentXP',      v => SD.fmt(v),           'purple', pl),
          mkRk(`${pl}-caught`,   '🎉', 'Pokémon capturés',    'pokeCaught',     v => SD.fmt(v),           'green',  pl),
          mkRk(`${pl}-shiny`,    '💫', 'Shiny capturés',      'shinyCaught',    v => SD.fmt(v),           'gold',   pl),
          mkRk(`${pl}-dex`,      '📖', 'Pokédex Normal',      'dexCount',       v => SD.fmt(v),           'blue',   pl),
          mkRk(`${pl}-shinydex`, '✨', 'Pokédex Shiny',       'shinyDex',       v => SD.fmt(v),           'gold',   pl),
          mkRk(`${pl}-money`,    '💰', 'Économies',           'customMoney',    v => `${SD.fmt(v)} 💰`,   'green',  pl),
          mkRk(`${pl}-spent`,    '💸', 'Argent dépensé',      'moneySpent',     v => `${SD.fmt(v)} 💰`,   'orange', pl),
          mkRk(`${pl}-raid`,     '⚔️', 'Raids participés',    'raidCount',      v => SD.fmt(v),           'red',    pl),
          mkRk(`${pl}-raiddmg`,  '💥', 'Dégâts raids',        'raidTotalDmg',   v => SD.fmt(v),           'red',    pl),
          mkRk(`${pl}-trade`,    '🤝', 'Trades effectués',    'tradeCount',     v => SD.fmt(v),           '',       pl),
          mkRk(`${pl}-scrap`,    '♻️', 'Scrap total',         '_scrapTotal',    v => SD.fmt(v),           'purple', pl),
          mkRk(`${pl}-days`,     '🗓️', 'Jours actifs',        '_daysActive',    v => `${SD.fmt(v)} j`,    'blue',   pl),
        ]
      },
      {
        title: 'Par rareté',
        rankings: rarityRankings(pl, pl)
      },
    ];
  }

  const TABS = [
    { id: 'global',   label: '🌍 Global',    groups: globalGroups },
    { id: 'twitch',   label: '🟣 Twitch',    groups: platGroups('twitch')   },
    { id: 'youtube',  label: '🔴 YouTube',   groups: platGroups('youtube')  },
    { id: 'tiktok',   label: '⚫ TikTok',    groups: platGroups('tiktok')   },
    { id: 'discord',  label: '🔵 Discord',   groups: platGroups('discord')  },
    { id: 'platforms',label: '📊 Plateformes', groups: [] }, // rendu spécial
  ];

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
          ${platStats.map((s, i) => `
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

        <!-- Contenu des onglets standards -->
        ${TABS.filter(t => t.id !== 'platforms').map((tab, i) => `
          <div class="rk-section${i === 0 ? ' is-active' : ''}" id="rk-section-${tab.id}">
            ${tab.groups.map(group => `
              <div class="rk-group-title">${group.title}</div>
              <div class="rk-grid">
                ${group.rankings.map(r => renderCard(r, players)).join('')}
              </div>
            `).join('')}
          </div>`).join('')}

        <!-- Onglet Plateformes (rendu spécial) -->
        <div class="rk-section" id="rk-section-platforms">
          ${renderPlatformsTab(platStats)}
        </div>

      </div>
    </div>`;

  // ── Onglets ──────────────────────────────────────────────────────────────────
  document.querySelectorAll('.rk-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rk-tab').forEach(b => b.classList.remove('is-active'));
      document.querySelectorAll('.rk-section').forEach(s => s.classList.remove('is-active'));
      btn.classList.add('is-active');
      document.getElementById(`rk-section-${btn.dataset.tab}`).classList.add('is-active');
      triggerVisible();
    });
  });

  // ── IntersectionObserver ─────────────────────────────────────────────────────
  function triggerVisible() {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          entry.target.querySelectorAll('.rk-row').forEach(row => row.classList.add('is-visible'));
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.05 });
    document.querySelectorAll('.rk-card:not(.is-visible), .rk-plat-badge:not(.is-visible), .rk-plat-card:not(.is-visible)').forEach(el => observer.observe(el));
  }

  triggerVisible();

  // ── Carte individuelle de classement ─────────────────────────────────────────
  function renderCard(rk, allPlayers) {
    let pool = rk.platform
      ? allPlayers.filter(p => (p.platform || '').toLowerCase() === rk.platform.toLowerCase())
      : allPlayers;

    const top = [...pool]
      .filter(p => (p[rk.key] ?? 0) > 0)
      .sort((a, b) => (b[rk.key] || 0) - (a[rk.key] || 0))
      .slice(0, TOP);

    if (top.length === 0) return '';

    const maxVal = top[0][rk.key] || 1;
    const barColor = { gold:'#ffd700',green:'#3fb950',red:'#f85149',purple:'#bc8cff',orange:'#d29922',blue:'#58a6ff',''  :'#58a6ff' }[rk.color] || '#58a6ff';
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
                <span class="rk-rank rk-rank--${i+1}">${rankLabel(i+1)}</span>
                <div class="rk-player">
                  <a class="rk-player__name" href="../User/info.html?platform=${encodeURIComponent(p.platform || '')}&username=${encodeURIComponent(p.pseudo)}" title="${SD.esc(p.pseudo)}">${SD.esc(p.pseudo)}</a>
                  <div class="rk-player__platform">${p.platform || ''}</div>
                </div>
                <div class="rk-bar-wrap"><div class="rk-bar" style="--bar-pct:${pct}%;background:${barColor}"></div></div>
                <span class="rk-value rk-value--${rk.color}">${rk.fmt(p[rk.key] || 0)}</span>
              </li>`;
          }).join('')}
        </ul>
      </div>`;
  }

  // ── Onglet Plateformes ───────────────────────────────────────────────────────
  function renderPlatformsTab(stats) {
    if (stats.length === 0) return '<p style="color:var(--text-muted);padding:20px">Aucune donnée de plateforme disponible.</p>';

    const platRankings = [
      { icon:'🎉', title:'Pokémon capturés',    key:'totalCaught',  fmt: v => SD.fmt(v),           color:'green'  },
      { icon:'💫', title:'Shiny capturés',       key:'totalShiny',   fmt: v => SD.fmt(v),           color:'gold'   },
      { icon:'🎱', title:'Balls lancées',        key:'totalBalls',   fmt: v => SD.fmt(v),           color:''       },
      { icon:'💸', title:'Argent dépensé',       key:'totalMoney',   fmt: v => `${SD.fmt(v)} 💰`,   color:'orange' },
      { icon:'🏦', title:'Économies cumulées',   key:'totalSaved',   fmt: v => `${SD.fmt(v)} 💰`,   color:'green'  },
      { icon:'⚔️', title:'Raids effectués',      key:'totalRaids',   fmt: v => SD.fmt(v),           color:'red'    },
      { icon:'💥', title:'Dégâts raids cumulés', key:'totalDmg',     fmt: v => SD.fmt(v),           color:'red'    },
      { icon:'🤝', title:'Trades effectués',     key:'totalTrades',  fmt: v => SD.fmt(v),           color:''       },
      { icon:'♻️', title:'Scrap total',          key:'totalScrap',   fmt: v => SD.fmt(v),           color:'purple' },
      { icon:'⭐', title:'Niveau max atteint',   key:'maxLevel',     fmt: v => `Lv ${v}`,           color:'orange' },
      { icon:'📈', title:'Niveau moyen',         key:'avgLevel',     fmt: v => `Lv ${v}`,           color:'blue'   },
      { icon:'📖', title:'Meilleur Dex',         key:'maxDex',       fmt: v => SD.fmt(v),           color:'blue'   },
      { icon:'👥', title:'Nombre de joueurs',    key:'count',        fmt: v => `${v} joueur${v>1?'s':''}`, color:'' },
    ];

    return platRankings.map(rk => {
      const sorted = [...stats].filter(s => (s[rk.key] || 0) > 0).sort((a, b) => b[rk.key] - a[rk.key]);
      if (sorted.length === 0) return '';
      const maxVal = sorted[0][rk.key] || 1;
      const barColor = { gold:'#ffd700',green:'#3fb950',red:'#f85149',purple:'#bc8cff',orange:'#d29922',blue:'#58a6ff',''  :'#58a6ff' }[rk.color] || '#58a6ff';

      return `
        <div class="rk-group-title" style="margin-top:24px">${rk.icon} ${rk.title}</div>
        <div class="rk-grid">
          <div class="rk-card rk-plat-card" style="grid-column:1/-1;max-width:560px">
            <ul class="rk-list">
              ${sorted.map((s, i) => {
                const pct = Math.round((s[rk.key] / maxVal) * 100);
                return `
                  <li class="rk-row">
                    <span class="rk-rank rk-rank--${i+1}">${rankLabel(i+1)}</span>
                    <div class="rk-player">
                      <div class="rk-player__name">${s.icon} ${s.pl.charAt(0).toUpperCase() + s.pl.slice(1)}</div>
                      <div class="rk-player__platform">${s.count} joueur${s.count>1?'s':''}</div>
                    </div>
                    <div class="rk-bar-wrap"><div class="rk-bar" style="--bar-pct:${pct}%;background:${barColor}"></div></div>
                    <span class="rk-value rk-value--${rk.color}">${rk.fmt(s[rk.key] || 0)}</span>
                  </li>`;
              }).join('')}
            </ul>
          </div>
        </div>`;
    }).join('');
  }

  function rankLabel(i) {
    if (i === 1) return '🥇';
    if (i === 2) return '🥈';
    if (i === 3) return '🥉';
    return i;
  }
});
