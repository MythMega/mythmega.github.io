// ============================================
// StreamDex - Raids page (raids.js)
// Charge l'index des raids, filtre les 7 derniers jours,
// affiche une combobox de sélection et les statistiques du raid choisi.
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    const root = document.getElementById('sd-root');
    SD.loading(root);

    // ── 1. Chargement de l'index ──────────────────────────────────────────────
    let index;
    try {
        index = await SD.fetchJson('Data/raids/index.json');
    } catch {
        SD.error(root, 'Impossible de charger l\'index des raids. Aucun raid enregistré ?');
        return;
    }

    const allFiles = (index.files || []);
    if (allFiles.length === 0) {        SD.empty(root, 'Aucun raid enregistré pour le moment.');
        return;
    }

    // ── 2. Filtrage : 7 derniers jours ────────────────────────────────────────
    const now = new Date();
    const cutoff = new Date(now.getTime() - 7 * 24 * 3600 * 1000);

    // Les fichiers sont nommés raid-yyyy-MM-dd-HH-mm-ss.json
    function fileToDate(filename) {
        // "raid-2025-06-28-14-32-00.json" → "2025-06-28T14:32:00"
        const m = filename.match(/raid-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})\.json/);
        if (!m) return null;
        return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[3 + 1]}:${m[3 + 2]}:${m[3 + 3]}`);
    }

    function fileToDate2(filename) {
        const m = filename.match(/raid-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})\.json/);
        if (!m) return null;
        return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`);
    }

    // Les entrées peuvent être des objets { filename, bossName, date } ou de simples strings (ancien format)
    function entryFilename(e) { return typeof e === 'string' ? e : e.filename; }
    function entryDate(e) {
      if (typeof e === 'object' && e.date) return new Date(e.date.replace(' ', 'T'));
      return fileToDate2(entryFilename(e));
    }
    function entryLabel(e) {
      const d = entryDate(e);
      const datePart = d
        ? d.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
        : entryFilename(e).replace('raid-', '').replace('.json', '');
      const boss = (typeof e === 'object' && e.bossName) ? e.bossName : null;
      return boss ? `${boss}, ${datePart}` : datePart;
    }

    const recentFiles = allFiles.filter(e => {
      const d = entryDate(e);
      return d && d >= cutoff;
    });

    const filesToShow = recentFiles.length > 0 ? recentFiles : allFiles.slice(0, Math.min(10, allFiles.length));

    // ── 3. Squelette HTML ─────────────────────────────────────────────────────
    root.innerHTML = `
    <div class="sd-page">
      <div class="sd-container">

        <div class="sd-section-header" style="margin-bottom:24px">
          <h1>⚔️ Historique des Raids</h1>
          <span id="raid-count-label" style="font-size:13px;color:var(--text-muted)"></span>
        </div>

        <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:28px">
          <label for="raid-select" style="font-size:14px;color:var(--text-secondary);white-space:nowrap">
            Sélectionner un raid :
          </label>
          <select class="sd-select" id="raid-select" style="min-width:320px;font-size:14px"></select>
          <span style="font-size:12px;color:var(--text-muted)" id="raid-filter-hint"></span>
        </div>

        <div id="raid-content">
          <!-- rempli dynamiquement -->
        </div>

      </div>
    </div>
  `;

    // ── 4. Remplir la combobox ────────────────────────────────────────────────
    const select = document.getElementById('raid-select');
    const hint = document.getElementById('raid-filter-hint');
    const label = document.getElementById('raid-count-label');

    filesToShow.forEach(e => {
      const opt = document.createElement('option');
      opt.value = entryFilename(e);
      opt.textContent = entryLabel(e);
      select.appendChild(opt);
    });

    label.textContent = `${filesToShow.length} raid${filesToShow.length > 1 ? 's' : ''} affiché${filesToShow.length > 1 ? 's' : ''}`;

    if (recentFiles.length > 0) {
        hint.textContent = `(7 derniers jours — ${allFiles.length} raid${allFiles.length > 1 ? 's' : ''} au total)`;
    } else {
        hint.textContent = `(Aucun raid récent — affichage des ${filesToShow.length} derniers)`;
    }

    // ── 5. Chargement et rendu d'un raid ─────────────────────────────────────
    let charts = [];

    async function loadRaid(filename) {
        const content = document.getElementById('raid-content');
        SD.loading(content);
        charts.forEach(c => c.destroy());
        charts = [];

        let raid;
        try {
            raid = await SD.fetchJson(`Data/raids/${filename}`);
        } catch {
            SD.error(content, `Impossible de charger ${filename}`);
            return;
        }

        renderRaid(raid, content);
    }

    function renderRaid(raid, container) {
        const players = raid.players || [];
        const platDmg = raid.platformDmg || [];
        const funFacts = raid.funFacts || [];
        const durationFmt = formatDuration(raid.durationSec || 0);

        // Trouver le leader (plus gros dégâts — players déjà trié côté serveur)
        const leader = players[0];

        // Calcul chance
        const luckiest = [...players].sort((a, b) => b.luck - a.luck)[0];
        const lessLucky = [...players].sort((a, b) => a.luck - b.luck)[0];
        const veteran = [...players].sort((a, b) => b.raidCount - a.raidCount)[0];
        const rookie = [...players].sort((a, b) => a.raidCount - b.raidCount)[0];

        container.innerHTML = `
      <!-- En-tête boss -->
      <div class="sd-card" style="margin-bottom:24px;padding:24px;display:flex;gap:24px;align-items:center;flex-wrap:wrap">
        <img src="${raid.bossSprite}" alt="${raid.bossName}"
          style="width:96px;height:96px;object-fit:contain;image-rendering:pixelated">
        <div>
          <h2 style="margin:0 0 6px;font-size:22px">
            ${raid.bossName}
            ${raid.shiny ? '<span style="color:var(--shiny-gold);margin-left:8px">✧ Shiny</span>' : ''}
          </h2>
          <p style="margin:0;color:var(--text-secondary);font-size:13px">
            ${raid.bossRarity} &nbsp;·&nbsp; ${raid.pvMax} PV &nbsp;·&nbsp; ${raid.date} &nbsp;·&nbsp; ⏱ ${durationFmt}
          </p>
          <p style="margin:4px 0 0;color:var(--text-muted);font-size:12px">
            ${players.length} participant${players.length > 1 ? 's' : ''}
            &nbsp;·&nbsp; ${players.reduce((s, p) => s + p.damage, 0).toLocaleString('fr-FR')} dégâts totaux
          </p>
        </div>
      </div>

      <!-- Stats rapides -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin-bottom:24px">
        ${statCard('🏆 Leader', leader?.pseudo, leader?.platform)}
        ${statCard('🍀 Plus chanceux', luckiest?.pseudo, luckiest?.platform, luckiest ? `ratio ${luckiest.luck.toFixed(2)}` : '')}
        ${statCard('😔 Moins chanceux', lessLucky?.pseudo, lessLucky?.platform, lessLucky ? `ratio ${lessLucky.luck.toFixed(2)}` : '')}
        ${statCard('🎖️ Vétéran', veteran?.pseudo, veteran?.platform, veteran ? `${veteran.raidCount} raids` : '')}
        ${statCard('🌱 Rookie', rookie?.pseudo, rookie?.platform, rookie ? `${rookie.raidCount} raids` : '')}
      </div>

      <!-- Fun facts -->
      ${renderFunFacts(funFacts)}

      <!-- Tableau des joueurs -->
      <div class="sd-card" style="margin-bottom:24px;padding:24px">
        <h3 style="margin:0 0 16px">📋 Tableau des participants</h3>
        <div class="sd-table-wrap">
          <table class="sd-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Plateforme</th>
                <th>Pseudo</th>
                <th>Dégâts</th>
                <th>Attaques</th>
                <th>Dégât de base</th>
                <th>Niveau</th>
                <th>Raids</th>
                <th>Chance</th>
              </tr>
            </thead>
            <tbody>
              ${players.map((p, i) => `
                <tr>
                  <td style="color:var(--text-muted)">${i + 1}</td>
                  <td>${p.platform}</td>
                  <td style="font-weight:600">${p.pseudo}</td>
                  <td style="color:var(--accent-red)">${p.damage.toLocaleString('fr-FR')}</td>
                  <td>${p.countAtk}</td>
                  <td>${p.baseDmg.toLocaleString('fr-FR')}</td>
                  <td>${p.level}</td>
                  <td>${p.raidCount}</td>
                  <td style="color:${p.luck >= 1 ? 'var(--accent-green)' : 'var(--accent-orange)'}">
                    ${p.luck.toFixed(2)}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Graphiques -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:24px;margin-bottom:24px">
        <div class="sd-card" style="padding:24px">
          <h3 style="margin:0 0 16px;font-size:14px">🥧 Dégâts par plateforme</h3>
          <canvas id="chart-platform" height="260"></canvas>
        </div>
        <div class="sd-card" style="padding:24px">
          <h3 style="margin:0 0 16px;font-size:14px">⚔️ Dégâts par joueur</h3>
          <canvas id="chart-damage" height="260"></canvas>
        </div>
        <div class="sd-card" style="padding:24px">
          <h3 style="margin:0 0 16px;font-size:14px">💥 Dégât de base par joueur</h3>
          <canvas id="chart-base" height="260"></canvas>
        </div>
        <div class="sd-card" style="padding:24px">
          <h3 style="margin:0 0 16px;font-size:14px">🔢 Nombre d'attaques</h3>
          <canvas id="chart-atk" height="260"></canvas>
        </div>
      </div>
    `;

        // ── Charts ──────────────────────────────────────────────────────────────
        const PALETTE = [
            '#58a6ff', '#3fb950', '#d29922', '#f85149', '#bc8cff',
            '#79c0ff', '#ffa657', '#56d364', '#ff7b72', '#d2a8ff'
        ];

        const chartDefaults = {
            plugins: { legend: { labels: { color: '#e6edf3', font: { size: 12 } } } },
            scales: {
                x: { ticks: { color: '#8b949e' }, grid: { color: '#21262d' } },
                y: { ticks: { color: '#8b949e' }, grid: { color: '#21262d' }, beginAtZero: true }
            }
        };

        // Pie — plateforme
        charts.push(new Chart(document.getElementById('chart-platform'), {
            type: 'pie',
            data: {
                labels: platDmg.map(p => p.platform),
                datasets: [{ data: platDmg.map(p => p.damage), backgroundColor: PALETTE }]
            },
            options: {
                plugins: {
                    legend: { labels: { color: '#e6edf3', font: { size: 12 } } }
                }
            }
        }));

        const pseudos = players.map(p => p.pseudo);

        // Bar — dégâts
        charts.push(new Chart(document.getElementById('chart-damage'), {
            type: 'bar',
            data: {
                labels: pseudos,
                datasets: [{
                    label: 'Dégâts', data: players.map(p => p.damage),
                    backgroundColor: '#f85149', borderRadius: 4
                }]
            },
            options: { ...chartDefaults, plugins: { legend: { display: false } } }
        }));

        // Bar — base dmg
        charts.push(new Chart(document.getElementById('chart-base'), {
            type: 'bar',
            data: {
                labels: pseudos,
                datasets: [{
                    label: 'Dégât de base', data: players.map(p => p.baseDmg),
                    backgroundColor: '#d29922', borderRadius: 4
                }]
            },
            options: { ...chartDefaults, plugins: { legend: { display: false } } }
        }));

        // Bar — attaques
        charts.push(new Chart(document.getElementById('chart-atk'), {
            type: 'bar',
            data: {
                labels: pseudos,
                datasets: [{
                    label: 'Attaques', data: players.map(p => p.countAtk),
                    backgroundColor: '#3fb950', borderRadius: 4
                }]
            },
            options: { ...chartDefaults, plugins: { legend: { display: false } } }
        }));
    }

    // ── Helpers HTML ────────────────────────────────────────────────────────

    function statCard(title, pseudo, platform, sub = '') {
        if (!pseudo) return '';
        return `
      <div class="sd-card" style="padding:16px">
        <p style="margin:0 0 6px;font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">${title}</p>
        <p style="margin:0;font-weight:700;font-size:15px">${pseudo}</p>
        <p style="margin:2px 0 0;font-size:12px;color:var(--text-secondary)">${platform}${sub ? ' · ' + sub : ''}</p>
      </div>`;
    }

    function renderFunFacts(funFacts) {
        if (!funFacts.length) return '';

        const definitions = [
            { key: 'healPeople', label: 'Healer du groupe', condition: v => v > 0, fmt: v => `${v} personne(s) soignée(s)` },
            { key: 'poisonOther', label: 'Le plus toxique', condition: v => v > 0, fmt: v => `${v} empoisonnement(s)` },
            { key: 'ko', label: 'Le plus souvent KO', condition: v => v > 0, fmt: v => `${v} fois` },
            { key: 'para', label: 'Le plus paralysé', condition: v => v > 0, fmt: v => `${v} fois` },
            { key: 'frozen', label: 'Le plus gelé', condition: v => v > 0, fmt: v => `${v} fois` },
            { key: 'burnt', label: 'Le plus brûlé', condition: v => v > 0, fmt: v => `${v} fois` },
            { key: 'confused', label: 'Le plus confus', condition: v => v > 0, fmt: v => `${v} fois` },
            { key: 'backWind', label: 'Sous vent arrière ennemi', condition: v => v > 0, fmt: v => `${v} fois` },
            { key: 'asleep', label: 'Le plus endormi', condition: v => v > 0, fmt: v => `${v} fois` },
            { key: 'healing', label: 'Meilleur healer (source)', condition: v => v > 0, fmt: v => `${v} fois` },
            { key: 'poisoned', label: 'Le plus empoisonné', condition: v => v > 0, fmt: v => `${v} fois` },
            { key: 'roundsUnderFx', label: 'Cumul tours sous effet', condition: v => v > 0, fmt: v => `${v} tours` },
        ];

        const items = [];
        definitions.forEach(def => {
            const top = [...funFacts].sort((a, b) => b[def.key] - a[def.key])[0];
            if (top && def.condition(top[def.key])) {
                items.push({ label: def.label, pseudo: top.pseudo, platform: top.platform, sub: def.fmt(top[def.key]) });
            }
        });

        if (!items.length) return '';

        return `
      <div class="sd-card" style="margin-bottom:24px;padding:24px">
        <h3 style="margin:0 0 16px">🎭 Fun Facts</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px">
          ${items.map(it => `
            <div style="background:var(--bg-secondary);border-radius:var(--radius-md);padding:12px 14px;border:1px solid var(--border-color)">
              <p style="margin:0 0 4px;font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">${it.label}</p>
              <p style="margin:0;font-weight:700">${it.pseudo}
                <span style="font-weight:400;color:var(--text-secondary);font-size:12px">(${it.platform})</span>
              </p>
              <p style="margin:2px 0 0;font-size:12px;color:var(--accent-blue)">${it.sub}</p>
            </div>
          `).join('')}
        </div>
      </div>`;
    }

    function formatDuration(sec) {
        if (!sec) return '—';
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        if (h > 0) return `${h}h ${m}m ${s}s`;
        if (m > 0) return `${m}m ${s}s`;
        return `${s}s`;
    }

    // ── 6. Événements ─────────────────────────────────────────────────────────
    select.addEventListener('change', () => loadRaid(select.value));

    // Charge le plus récent par défaut
    if (filesToShow.length > 0) {
      select.value = entryFilename(filesToShow[0]);
      await loadRaid(entryFilename(filesToShow[0]));
    }
});