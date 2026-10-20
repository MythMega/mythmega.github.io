// Dex-ui.js - UI logic for Dex
const DexUI = (function () {
  let dexEntries = {};
  let allPokemons = [];
  let allDexData = {};
  let currentSort = 'index';
  let currentDirection = 'asc';

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

  // Re-render grid with current sort, then re-apply filters
  function rebuildGrid() {
    const grid = document.getElementById('dexGrid');
    if (!grid) return;

    grid.innerHTML = '';
    const sorted = getSortedPokemons();

    sorted.forEach(p => {
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
      grid.appendChild(div);
    });

    applyFilters();
  }

  // Filter and display based on search and checkboxes
  function applyFilters() {
    console.log('[DexUI] Applying filters');
    const searchInput = document.getElementById('searchInput');
    const showFoundCheckbox = document.getElementById('showFoundCheckbox');
    const showNotFoundCheckbox = document.getElementById('showNotFoundCheckbox');
    
    if (!searchInput || !showFoundCheckbox || !showNotFoundCheckbox) return;

    const searchTerm = searchInput.value.toLowerCase().trim();
    const showFound = showFoundCheckbox.checked;
    const showNotFound = showNotFoundCheckbox.checked;

    const entries = document.querySelectorAll('.dex-entry');
    let visibleCount = 0;

    entries.forEach(entry => {
      const index = entry.getAttribute('data-index');
      const nameFr = entry.getAttribute('data-name-fr');
      const nameEn = entry.getAttribute('data-name-en');
      const found = entry.getAttribute('data-found') === 'true';

      // Check search filter
      let matchesSearch = true;
      if (searchTerm) {
        matchesSearch = nameFr.includes(searchTerm) || 
                       nameEn.includes(searchTerm) || 
                       index.includes(searchTerm);
      }

      // Check status filter
      let matchesStatus = true;
      if (showFound && showNotFound) {
        matchesStatus = true; // both checked - show all
      } else if (showFound && !showNotFound) {
        matchesStatus = found; // only show found
      } else if (!showFound && showNotFound) {
        matchesStatus = !found; // only show not found
      }
      // if neither checked, show all

      const shouldDisplay = matchesSearch && matchesStatus;
      entry.style.display = shouldDisplay ? '' : 'none';
      if (shouldDisplay) visibleCount++;
    });

    console.log('[DexUI] Visible Pokemon:', visibleCount);
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
        rebuildGrid();
      });
    }

    const sortDirectionBtn = document.getElementById('sortDirectionBtn');
    if (sortDirectionBtn) {
      sortDirectionBtn.addEventListener('click', () => {
        currentDirection = currentDirection === 'asc' ? 'desc' : 'asc';
        const _Tdir = (k, f) => (typeof Translator !== 'undefined' ? Translator.get(k, f) : f);
        sortDirectionBtn.textContent = currentDirection === 'asc' ? _Tdir('dex.sortAsc', '↑ Asc') : _Tdir('dex.sortDesc', '↓ Desc');
        sortDirectionBtn.setAttribute('data-direction', currentDirection);
        rebuildGrid();
      });
    }
  }

  return {
    updateProgress,
    renderDexGrid,
    bindEvents
  };
})();