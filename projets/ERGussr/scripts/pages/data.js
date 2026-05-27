/**
 * Page controller: data.html
 * Displays filterable/sortable tables for each dataset file.
 */
import { loadTranslations } from "../business/i18n.js";
import { getLangPref } from "../business/settings.js";
import { applyTranslations, setActiveNav } from "../visual/ui.js";

const DATASETS = [
  { key: 'weapons',     labelFR: 'Armes',       file: './data/Dataset-weapon.json' },
  { key: 'armor',       labelFR: 'Armures',     file: './data/Dataset-armor.json' },
  { key: 'accessories', labelFR: 'Accessoires', file: './data/Dataset-accessories.json' },
  { key: 'goods',       labelFR: 'Objets',      file: './data/Dataset-goods.json' },
  { key: 'magic',       labelFR: 'Magie',       file: './data/Dataset-magic.json' },
];

/** @type {Record<string, object[]>} */
let allData = {};
let currentTab = 'weapons';
let sortCol = 'ID';
let sortDir = 1; // 1 = asc, -1 = desc

/** @type {Record<string, 'pending'|'ok'|'missing'>} */
let imageStatuses = {};
let renderPending = false;

// ─── Helpers ────────────────────────────────────────────────────────────────

function scheduleRender() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    renderTable();
    renderProgress();
  });
}

/** Extract folder path from a PictureURL like "./Assets/Weapons/Dague.png" → "Assets/Weapons" */
function getEmplacement(url) {
  if (!url) return '';
  const parts = url.split('/');
  if (parts.length >= 3) {
    return parts.slice(0, -1).join('/').replace(/^\.\//, '');
  }
  return url;
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Data loading ────────────────────────────────────────────────────────────

async function loadAllData() {
  const results = await Promise.all(
    DATASETS.map(async ds => {
      try {
        const resp = await fetch(ds.file);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        return { key: ds.key, data: Array.isArray(data) ? data : [] };
      } catch {
        return { key: ds.key, data: [] };
      }
    })
  );
  for (const { key, data } of results) {
    allData[key] = data.map(item => ({
      ...item,
      emplacement: getEmplacement(item.PictureURL || ''),
    }));
  }
}

// ─── Image checking ──────────────────────────────────────────────────────────

function checkImages() {
  const allUrls = new Set();
  for (const items of Object.values(allData)) {
    for (const item of items) {
      if (item.PictureURL) allUrls.add(item.PictureURL);
    }
  }
  for (const url of allUrls) {
    if (imageStatuses[url] !== undefined) continue;
    imageStatuses[url] = 'pending';
    const img = new Image();
    img.onload  = () => { imageStatuses[url] = 'ok';      scheduleRender(); };
    img.onerror = () => { imageStatuses[url] = 'missing'; scheduleRender(); };
    img.src = url;
  }
}

// ─── Filtering & sorting ─────────────────────────────────────────────────────

function getFilteredSorted() {
  const search = document.getElementById('data-search')?.value.toLowerCase().trim() ?? '';
  const hideExisting = document.getElementById('hide-existing')?.checked ?? false;

  let items = allData[currentTab] ?? [];

  if (search) {
    items = items.filter(item =>
      (item.ID           ?? '').toLowerCase().includes(search) ||
      (item.NameFR       ?? '').toLowerCase().includes(search) ||
      (item.NameEN       ?? '').toLowerCase().includes(search) ||
      (item.emplacement  ?? '').toLowerCase().includes(search)
    );
  }

  if (hideExisting) {
    items = items.filter(item => imageStatuses[item.PictureURL] !== 'ok');
  }

  items = [...items].sort((a, b) => {
    const av = String(sortCol === 'emplacement' ? a.emplacement : (a[sortCol] ?? ''));
    const bv = String(sortCol === 'emplacement' ? b.emplacement : (b[sortCol] ?? ''));
    return av.localeCompare(bv) * sortDir;
  });

  return items;
}

// ─── Progress ────────────────────────────────────────────────────────────────

/** Returns { ok, missing, pending, total } for one dataset key. */
function computeProgress(key) {
  const items = allData[key] ?? [];
  const total = items.length;
  let ok = 0, missing = 0, pending = 0;
  for (const item of items) {
    const status = imageStatuses[item.PictureURL] ?? 'pending';
    if (status === 'ok')           ok++;
    else if (status === 'missing') missing++;
    else                           pending++;
  }
  return { ok, missing, pending, total };
}

/** Returns a CSS color string based on completion percentage. */
function progressColor(pct) {
  if (pct >= 75) return 'var(--color-success)';
  if (pct >= 30) return 'var(--color-warning)';
  return 'var(--color-error)';
}

function renderProgress() {
  // ─ Global
  let totalOk = 0, totalAll = 0;
  for (const ds of DATASETS) {
    const { ok, total } = computeProgress(ds.key);
    totalOk  += ok;
    totalAll += total;
  }
  const globalPct = totalAll > 0 ? (totalOk / totalAll * 100) : 0;

  const fillEl = document.getElementById('global-progress-fill');
  const textEl = document.getElementById('global-progress-text');
  const pctEl  = document.getElementById('global-progress-pct');
  if (fillEl) { fillEl.style.width = `${globalPct.toFixed(1)}%`; fillEl.style.background = progressColor(globalPct); }
  if (textEl) textEl.textContent = `${totalOk} / ${totalAll}`;
  if (pctEl)  pctEl.textContent  = `(${globalPct.toFixed(1)}%)`;

  // ─ Per category
  const catContainer = document.getElementById('progress-categories');
  if (!catContainer) return;

  catContainer.innerHTML = DATASETS.map(ds => {
    const { ok, total } = computeProgress(ds.key);
    const pct   = total > 0 ? (ok / total * 100) : 0;
    const color = progressColor(pct);
    return `
      <div class="progress-cat-item">
        <div class="progress-cat-label">
          <span class="progress-cat-name">${escHtml(ds.labelFR)}</span>
          <span class="progress-cat-count">${ok} / ${total} <span class="progress-cat-pct">(${pct.toFixed(1)}%)</span></span>
        </div>
        <div class="progress-bar-track">
          <div class="progress-bar-fill" style="width:${pct.toFixed(2)}%;background:${color};"></div>
        </div>
      </div>`;
  }).join('');
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function renderTable() {
  const items = getFilteredSorted();
  const tbody = document.getElementById('table-body');
  if (!tbody) return;

  // Count display
  const total = (allData[currentTab] ?? []).length;
  const countEl = document.getElementById('count-info');
  if (countEl) countEl.textContent = `${items.length} / ${total}`;

  // Sort indicators
  document.querySelectorAll('.data-table th[data-col]').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.col === sortCol) {
      th.classList.add(sortDir === 1 ? 'sort-asc' : 'sort-desc');
    }
  });

  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="table-empty">Aucun élément à afficher.</td></tr>';
    return;
  }

  tbody.innerHTML = items.map(item => {
    const status = imageStatuses[item.PictureURL] ?? 'pending';
    const rowClass = status === 'missing' ? ' class="row-missing"' : '';

    let imgCell;
    if (status === 'ok') {
      imgCell = `<img class="item-thumb" src="${escHtml(item.PictureURL)}" alt="${escHtml(item.NameFR ?? '')}">`;
    } else if (status === 'missing') {
      imgCell = `<span class="img-missing" title="${escHtml(item.PictureURL)}">✗</span>`;
    } else {
      imgCell = `<span class="img-pending">…</span>`;
    }

    return `<tr${rowClass}>
      <td class="col-id">${escHtml(item.ID ?? '')}</td>
      <td>${escHtml(item.NameFR ?? '')}</td>
      <td>${escHtml(item.NameEN ?? '')}</td>
      <td class="col-path">${escHtml(item.emplacement ?? '')}</td>
      <td class="col-img">${imgCell}</td>
    </tr>`;
  }).join('');
}

function renderTabs() {
  const container = document.getElementById('data-tabs');
  if (!container) return;

  container.innerHTML = DATASETS.map(ds => {
    const count = (allData[ds.key] ?? []).length;
    const active = ds.key === currentTab ? ' active' : '';
    return `<button class="tab-btn${active}" data-tab="${ds.key}">${escHtml(ds.labelFR)} <span class="tab-count">(${count})</span></button>`;
  }).join('');

  container.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentTab = btn.dataset.tab;
      sortCol = 'ID';
      sortDir = 1;
      renderTabs();
      renderTable();
    });
  });
}

// ─── Controls setup ──────────────────────────────────────────────────────────

function setupControls() {
  document.getElementById('data-search')?.addEventListener('input', renderTable);
  document.getElementById('hide-existing')?.addEventListener('change', renderTable);

  document.querySelectorAll('.data-table th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (col === 'image') return;
      if (sortCol === col) sortDir *= -1;
      else { sortCol = col; sortDir = 1; }
      renderTable();
    });
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  const lang = getLangPref();
  await loadTranslations(lang);
  applyTranslations();
  setActiveNav();
  document.getElementById('nav-toggle')?.addEventListener('click', () =>
    document.getElementById('nav-links')?.classList.toggle('open')
  );

  await loadAllData();
  renderTabs();
  setupControls();
  renderTable();
  renderProgress();
  // Image checks run asynchronously after the table is visible
  checkImages();
}

init();
