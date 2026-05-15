// ============================================
// StreamDex - Records page (records.js)
// Pagination par mois : chaque "page" = un mois calendaire.
// Les données viennent de Data/json/records.json (exporté par le serveur).
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  const root = document.getElementById('sd-root');
  SD.loading(root);

  // ── 1. Chargement du JSON ──────────────────────────────────────────────────
  let data;
  try {
    data = await SD.fetchJson('Data/json/records.json');
  } catch {
    SD.error(root, 'Impossible de charger les records.');
    return;
  }

  const allRecords = (data.Records || []).map(r => ({
    ...r,
    // On parse la date une seule fois pour toutes les opérations suivantes
    _date: new Date(r.Date)
  }));

  // ── 2. Construire la liste des mois présents dans les données ─────────────
  // Chaque mois est représenté par la clé "YYYY-MM" (tri lexicographique = tri chronologique).
  // On trie du plus récent au plus ancien pour que le mois courant soit affiché en premier.
  const monthSet = new Set(
    allRecords.map(r => fmtMonthKey(r._date)).filter(Boolean)
  );
  const months = [...monthSet].sort().reverse(); // ["2025-06", "2025-05", ...]

  // Index courant dans le tableau months (0 = mois le plus récent)
  let currentMonthIdx = 0;

  // ── 3. Injecter le squelette HTML ─────────────────────────────────────────
  root.innerHTML = `
    <div class="sd-page">
      <div class="sd-container">

        <div class="sd-section-header">
          <h1>🏆 Records</h1>
          <span style="font-size:13px;color:var(--text-muted)">${allRecords.length} record${allRecords.length !== 1 ? 's' : ''} au total</span>
        </div>

        <!-- Barre de recherche + filtres, identique aux autres pages -->
        <div class="sd-search-bar">
          <input class="sd-input" type="text" id="search-input" placeholder="Créature, statut, type...">
          <select class="sd-select" id="filter-statut">
            <option value="">Tous les statuts</option>
            <option value="normal">Normal</option>
            <option value="shiny">Shiny</option>
          </select>
          <select class="sd-select" id="filter-type">
            <option value="">Tous les types</option>
          </select>
        </div>

        <!-- Navigation entre les mois -->
        <div class="sd-month-nav" id="month-nav">
          <button class="sd-btn sd-btn--ghost" id="btn-prev" title="Mois précédent">◀</button>
          <span class="sd-month-nav__label" id="month-label">—</span>
          <button class="sd-btn sd-btn--ghost" id="btn-next" title="Mois suivant">▶</button>
        </div>

        <!-- Onglets mois (barre de sélection rapide) -->
        <div class="sd-month-tabs" id="month-tabs"></div>

        <!-- Compteur de résultats du mois affiché -->
        <p id="month-count" style="font-size:13px;color:var(--text-muted);margin:8px 0 12px"></p>

        <!-- Tableau des records du mois sélectionné -->
        <div class="sd-table-wrap">
          <table class="sd-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Créature</th>
                <th>Statut</th>
                <th>Type</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody id="records-tbody"></tbody>
          </table>
        </div>

        <div id="empty-msg"></div>

      </div>
    </div>`;

  // ── 4. Peupler le filtre "Type" avec les valeurs uniques ─────────────────
  const types = [...new Set(allRecords.map(r => r.Type).filter(Boolean))].sort();
  const filterTypeEl = document.getElementById('filter-type');
  types.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    filterTypeEl.appendChild(opt);
  });

  // ── 5. Construire les onglets de navigation rapide ────────────────────────
  const tabsEl = document.getElementById('month-tabs');
  months.forEach((m, idx) => {
    const btn = document.createElement('button');
    btn.className = 'sd-month-tab';
    btn.dataset.idx = idx;
    btn.textContent = fmtMonthLabel(m);
    btn.addEventListener('click', () => { currentMonthIdx = idx; render(); });
    tabsEl.appendChild(btn);
  });

  // ── 6. Navigation ◀ / ▶ ──────────────────────────────────────────────────
  document.getElementById('btn-prev').addEventListener('click', () => {
    // "précédent" = mois plus ancien = index plus grand dans le tableau trié décroissant
    if (currentMonthIdx < months.length - 1) { currentMonthIdx++; render(); }
  });
  document.getElementById('btn-next').addEventListener('click', () => {
    // "suivant" = mois plus récent = index plus petit
    if (currentMonthIdx > 0) { currentMonthIdx--; render(); }
  });

  // ── 7. Filtres ────────────────────────────────────────────────────────────
  const searchInput  = document.getElementById('search-input');
  const filterStatut = document.getElementById('filter-statut');
  searchInput.addEventListener('input', SD.debounce(render));
  filterStatut.addEventListener('change', render);
  filterTypeEl.addEventListener('change', render);

  // ── 8. Rendu principal ────────────────────────────────────────────────────
  function render() {
    const monthKey = months[currentMonthIdx];
    const q  = searchInput.value.trim();
    const fs = filterStatut.value;
    const ft = filterTypeEl.value;

    // Filtrage par mois calendaire en premier (partition la plus restrictive)
    let list = allRecords.filter(r => fmtMonthKey(r._date) === monthKey);

    // Puis filtres texte / statut / type
    if (q)  list = SD.filterItems(list, q, ['CreatureName', 'Statut', 'Type']);
    if (fs) list = list.filter(r => r.Statut?.toLowerCase() === fs);
    if (ft) list = list.filter(r => r.Type === ft);

    // Tri chronologique décroissant à l'intérieur du mois
    list.sort((a, b) => b._date - a._date);

    // Mise à jour du label central et des onglets actifs
    document.getElementById('month-label').textContent = fmtMonthLabel(monthKey);
    document.getElementById('month-count').textContent =
      `${list.length} record${list.length !== 1 ? 's' : ''} ce mois`;

    document.querySelectorAll('.sd-month-tab').forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.idx) === currentMonthIdx);
    });

    // Boutons ◀/▶ désactivés en bout de liste
    document.getElementById('btn-prev').disabled = currentMonthIdx >= months.length - 1;
    document.getElementById('btn-next').disabled = currentMonthIdx <= 0;

    const tbody   = document.getElementById('records-tbody');
    const emptyEl = document.getElementById('empty-msg');

    if (list.length === 0) {
      tbody.innerHTML = '';
      emptyEl.innerHTML = '<div class="sd-empty">Aucun record pour ce mois.</div>';
      return;
    }
    emptyEl.innerHTML = '';

    tbody.innerHTML = list.map(r => `
      <tr>
        <td style="color:var(--text-muted);font-size:12px">${r.ID ?? '—'}</td>
        <td>
          ${r.SpriteUrl ? `${SD.sprite(r.SpriteUrl, r.CreatureName, 36)} ` : ''}
          <a href="Creature/info.html?name=${encodeURIComponent(r.CreatureName)}">${SD.esc(r.CreatureName)}</a>
        </td>
        <td>
          ${r.Statut?.toLowerCase() === 'shiny'
            ? SD.badge('✨ Shiny', 'gold')
            : SD.badge(SD.esc(r.Statut || '—'), 'gray')}
        </td>
        <td>${SD.badge(SD.esc(r.Type || '—'), 'blue')}</td>
        <td style="color:var(--text-muted);font-size:12px">${fmtDate(r._date)}</td>
      </tr>`).join('');
  }

  // ── Lancement ─────────────────────────────────────────────────────────────
  if (months.length === 0) {
    SD.empty(root, 'Aucun record enregistré.');
  } else {
    render();
  }
});

// ── Helpers de formatage ──────────────────────────────────────────────────────

/** Retourne la clé "YYYY-MM" d'une Date (ex: "2025-06") */
function fmtMonthKey(date) {
  if (!date || isNaN(date)) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Formate "2025-06" → "Juin 2025" en français */
function fmtMonthLabel(key) {
  if (!key) return '—';
  const [y, m] = key.split('-');
  const date = new Date(Number(y), Number(m) - 1, 1);
  const label = date.toLocaleString('fr-FR', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Formate un objet Date en date+heure lisible */
function fmtDate(d) {
  if (!d || isNaN(d)) return '—';
  try {
    return d.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return String(d);
  }
}
