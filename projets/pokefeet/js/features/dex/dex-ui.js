// Dex-ui.js - UI logic for Dex
const DexUI = (function () {
  let dexEntries = {};
  let allPokemons = [];
  let allDexData = {};
  let currentSort = 'index';
  let currentDirection = 'asc';
  let currentPage = 1;
  let currentFiltered = [];

  // Update progress bar
  function updateProgress(found, total) {
    console.log('[DexUI] Updating progress:', found, '/', total);
    const fill = document.getElementById('progressFill');
    const text = document.getElementById('progressText');
    if (fill && text) {
      const pct = total > 0 ? (found / total) * 100 : 0;
      fill.style.width = pct + '%';
      text.textContent = `${found} / ${total}`;
    }
  }

  // Render the dex grid
  function renderDexGrid(pokemons, dexData) {
    console.log('[DexUI] Rendering dex grid with', pokemons.length, 'Pokemon');
    allPokemons = pokemons;
    allDexData = dexData;
    
    const grid = document.getElementById('dexGrid');
    if (!grid) return;

    grid.innerHTML = '';
    dexEntries = dexData.reduce((acc, entry) => {
      acc[entry.index] = entry;
      return acc;
    }, {});

    rebuildGrid();
  }

  // Return sorted copy of allPokemons based on currentSort and currentDirection
  function getSortedPokemons() {
    const sorted = [...allPokemons];
    sorted.sort((a, b) => {
      const entryA = dexEntries[a.Index] || { found: false, count: 0, firstFoundDate: null };
      const entryB = dexEntries[b.Index] || { found: false, count: 0, firstFoundDate: null };
      let valA, valB;

      switch (currentSort) {
        case 'name':
          valA = (a.NameFR || a.NameEN || '').toLowerCase();
          valB = (b.NameFR || b.NameEN || '').toLowerCase();
          return currentDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        case 'count': {
          const aFound = entryA.found;
          const bFound = entryB.found;
          // Non-found always at the end, regardless of direction
          if (!aFound && bFound) return 1;
          if (aFound && !bFound) return -1;
          valA = entryA.count || 0;
          valB = entryB.count || 0;
          break;
        }
        case 'type':
          valA = (a.Type1 || '').toLowerCase();
          valB = (b.Type1 || '').toLowerCase();
          return currentDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        case 'eggGroup':
          valA = (Array.isArray(a.EggGroups) ? a.EggGroups[0] : (a.EggGroups || '')).toLowerCase();
          valB = (Array.isArray(b.EggGroups) ? b.EggGroups[0] : (b.EggGroups || '')).toLowerCase();
          return currentDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        case 'firstFound': {
          valA = entryA.firstFoundDate ? new Date(entryA.firstFoundDate).getTime() : 0;
          valB = entryB.firstFoundDate ? new Date(entryB.firstFoundDate).getTime() : 0;
          break;
        }
        default: // 'index'
          valA = parseInt(a.Index) || 0;
          valB = parseInt(b.Index) || 0;
      }

      if (valA < valB) return currentDirection === 'asc' ? -1 : 1;
      if (valA > valB) return currentDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }

  function getPageSize() {
    if (typeof AppConfig !== 'undefined') {
      const cfg = AppConfig.get();
      if (cfg && Number.isInteger(cfg.dexPageSize) && cfg.dexPageSize > 0) return cfg.dexPageSize;
    }
    return 100;
  }

  function getFilterState() {
    const searchInput = document.getElementById('searchInput');
    const showFoundCheckbox = document.getElementById('showFoundCheckbox');
    const showNotFoundCheckbox = document.getElementById('showNotFoundCheckbox');
    return {
      needle: searchInput ? searchInput.value.toLowerCase().trim() : '',
      showFound: !!(showFoundCheckbox && showFoundCheckbox.checked),
      showNotFound: !!(showNotFoundCheckbox && showNotFoundCheckbox.checked)
    };
  }

  function matchesFilters(p, filters) {
    const nameFr = (p.NameFR || '').toLowerCase();
    const nameEn = (p.NameEN || '').toLowerCase();
    const index = String(p.Index || '');
    if (filters.needle &&
        !nameFr.includes(filters.needle) &&
        !nameEn.includes(filters.needle) &&
        !index.includes(filters.needle)) {
      return false;
    }
    const entry = dexEntries[p.Index] || { found: false };
    if (filters.showFound && filters.showNotFound) return true;
    if (filters.showFound) return !!entry.found;
    if (filters.showNotFound) return !entry.found;
    return true;
  }

  function createEntryCard(p) {
    const entry = dexEntries[p.Index] || { found: false, count: 0, firstFoundDate: null };
    const div = document.createElement('div');
    div.className = 'dex-entry';
    div.setAttribute('data-index', p.Index);
    div.setAttribute('data-name-fr', (p.NameFR || '').toLowerCase());
    div.setAttribute('data-name-en', (p.NameEN || '').toLowerCase());
    div.setAttribute('data-found', entry.found ? 'true' : 'false');

    const img = document.createElement('img');
    img.src = p.Image || '';
    img.alt = p.NameFR || p.NameEN || '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.className = entry.found ? '' : 'black-filter';

    const nameDiv = document.createElement('div');
    nameDiv.className = 'dex-name';
    nameDiv.textContent = `${p.NameFR || p.NameEN} (${p.NameEN}) #${p.Index}`;

    const infoBtn = document.createElement('button');
    const T0 = (k, f) => (typeof Translator !== 'undefined' ? Translator.get(k, f) : f);
    infoBtn.textContent = T0('dex.moreInfo', "+ d'info");
    infoBtn.disabled = !entry.found;
    infoBtn.className = entry.found ? '' : 'disabled';
    infoBtn.onclick = () => showPopup(p, entry);

    div.appendChild(img);
    div.appendChild(nameDiv);
    div.appendChild(infoBtn);
    return div;
  }

  function renderPagination(container, totalPages) {
    if (!container) return;
    container.innerHTML = '';
    container.classList.toggle('hidden', totalPages <= 1);
    if (totalPages <= 1) return;

    const T = (k, f) => (typeof Translator !== 'undefined' ? Translator.get(k, f) : f);

    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'secondary dex-page-btn';
    prev.textContent = T('dex.pagePrev', '‹ Précédent');
    prev.disabled = currentPage <= 1;
    prev.addEventListener('click', () => goToPage(currentPage - 1));

    const status = document.createElement('span');
    status.className = 'dex-page-status';
    status.setAttribute('aria-live', 'polite');
    status.textContent = T('dex.pageOf', 'Page {page} / {total}')
      .replace('{page}', currentPage)
      .replace('{total}', totalPages);

    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'secondary dex-page-btn';
    next.textContent = T('dex.pageNext', 'Suivant ›');
    next.disabled = currentPage >= totalPages;
    next.addEventListener('click', () => goToPage(currentPage + 1));

    container.appendChild(prev);
    container.appendChild(status);
    container.appendChild(next);
  }

  function goToPage(page) {
    currentPage = page;
    rebuildGrid({ scroll: true });
  }

  // Re-render the current page with the current sort and filters
  function rebuildGrid(options) {
    const grid = document.getElementById('dexGrid');
    if (!grid) return;

    const filters = getFilterState();
    const pageSize = getPageSize();
    currentFiltered = getSortedPokemons().filter(p => matchesFilters(p, filters));
    const totalPages = Math.max(1, Math.ceil(currentFiltered.length / pageSize));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    grid.innerHTML = '';
    if (currentFiltered.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'dex-empty';
      empty.textContent = (typeof Translator !== 'undefined')
        ? Translator.get('dex.noResults', 'Aucun Pokémon ne correspond à ces filtres.')
        : 'Aucun Pokémon ne correspond à ces filtres.';
      grid.appendChild(empty);
    } else {
      const start = (currentPage - 1) * pageSize;
      currentFiltered.slice(start, start + pageSize).forEach(p => {
        grid.appendChild(createEntryCard(p));
      });
    }

    renderPagination(document.getElementById('dexPaginationTop'), totalPages);
    renderPagination(document.getElementById('dexPaginationBottom'), totalPages);

    if (options && options.scroll) {
      const top = grid.getBoundingClientRect().top + window.scrollY - 80;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }

    console.log('[DexUI] Page', currentPage, '/', totalPages, '—', currentFiltered.length, 'Pokemon');
  }

  // Filter changes restart from the first page
  function applyFilters() {
    currentPage = 1;
    rebuildGrid();
  }

  // Show popup with details
  function showPopup(pokemon, entry) {
    console.log('[DexUI] Showing popup for Pokemon:', pokemon.Index);
    const popup = document.getElementById('dexPopup');
    const details = document.getElementById('popupDetails');
    if (!popup || !details) return;

    const T = (k, f) => (typeof Translator !== 'undefined' ? Translator.get(k, f) : f);
    const typeLabel = (t) => t ? T('types.' + t.toLowerCase(), t) : 'N/A';
    details.innerHTML = `
      <h2>${pokemon.NameFR} (${pokemon.NameEN})</h2>
      <div class="popup-images">
        <img src="${pokemon.FullImage || ''}" alt="Full sprite" class="popup-full-img">
        <img src="${pokemon.Image || ''}" alt="Foot sprite" class="popup-foot-img">
      </div>
      <p><strong>${T('dex.index', 'Index')}:</strong> ${pokemon.Index}</p>
      <p><strong>${T('dex.generation', 'Génération')}:</strong> ${pokemon.Generation}</p>
      <p><strong>${T('dex.type1', 'Type 1')}:</strong> ${typeLabel(pokemon.Type1)}</p>
      <p><strong>${T('dex.type2', 'Type 2')}:</strong> ${pokemon.Type2 ? typeLabel(pokemon.Type2) : 'N/A'}</p>
      <p><strong>${T('dex.eggGroups', "Groupes d'oeuf")}:</strong> ${pokemon.getEggGroupsDisplay()}</p>
      <p><strong>${T('dex.category', 'Catégorie')}:</strong> ${pokemon.getCategoryDisplay()}</p>
      <p><strong>${T('dex.found', 'Trouvé')}:</strong> ${entry.found ? T('dex.yes', 'Oui') : T('dex.no', 'Non')}</p>
      <p><strong>${T('dex.firstFound', 'Première trouvaille')}:</strong> ${entry.firstFoundDate || 'N/A'}</p>
      <p><strong>${T('dex.count', 'Nombre de fois')}:</strong> ${entry.count}</p>
    `;

    popup.style.display = 'flex';
  }

  // Hide popup
  function hidePopup() {
    console.log('[DexUI] Hiding popup');
    const popup = document.getElementById('dexPopup');
    if (popup) popup.style.display = 'none';
  }

  // Bind UI events
  function bindEvents() {
    console.log('[DexUI] Binding events');
    const closeBtn = document.getElementById('closePopup');
    if (closeBtn) closeBtn.onclick = hidePopup;

    const popup = document.getElementById('dexPopup');
    if (popup) {
      popup.onclick = (e) => {
        if (e.target === popup) hidePopup();
      };
    }

    const forceBtn = document.getElementById('forceUpdateBtn');
    if (forceBtn) forceBtn.onclick = () => {
      console.log('[DexUI] Force update clicked');
      DailyToDexImport.forceUpdate();
    };

    // Search input
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.addEventListener('input', applyFilters);
    }

    // Checkboxes with mutual exclusion
    const showFoundCheckbox = document.getElementById('showFoundCheckbox');
    const showNotFoundCheckbox = document.getElementById('showNotFoundCheckbox');

    if (showFoundCheckbox) {
      showFoundCheckbox.addEventListener('change', () => {
        if (showFoundCheckbox.checked && showNotFoundCheckbox.checked) {
          showNotFoundCheckbox.checked = false;
        }
        applyFilters();
      });
    }

    if (showNotFoundCheckbox) {
      showNotFoundCheckbox.addEventListener('change', () => {
        if (showNotFoundCheckbox.checked && showFoundCheckbox.checked) {
          showFoundCheckbox.checked = false;
        }
        applyFilters();
      });
    }

    // Sort controls
    const sortSelect = document.getElementById('sortSelect');
    if (sortSelect) {
      sortSelect.addEventListener('change', () => {
        currentSort = sortSelect.value;
        applyFilters();
      });
    }

    const sortDirectionBtn = document.getElementById('sortDirectionBtn');
    if (sortDirectionBtn) {
      sortDirectionBtn.addEventListener('click', () => {
        currentDirection = currentDirection === 'asc' ? 'desc' : 'asc';
        const _Tdir = (k, f) => (typeof Translator !== 'undefined' ? Translator.get(k, f) : f);
        sortDirectionBtn.textContent = currentDirection === 'asc' ? _Tdir('dex.sortAsc', '↑ Asc') : _Tdir('dex.sortDesc', '↓ Desc');
        sortDirectionBtn.setAttribute('data-direction', currentDirection);
        applyFilters();
      });
    }
  }

  return {
    updateProgress,
    renderDexGrid,
    bindEvents
  };
})();