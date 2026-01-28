// Dex-ui.js - UI logic for Dex
const DexUI = (function () {
  let dexEntries = {};
  let allPokemons = [];
  let allDexData = {};

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

    pokemons.forEach(p => {
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
      infoBtn.textContent = '+ d\'info';
      infoBtn.disabled = !entry.found;
      infoBtn.className = entry.found ? '' : 'disabled';
      infoBtn.onclick = () => showPopup(p, entry);

      div.appendChild(img);
      div.appendChild(nameDiv);
      div.appendChild(infoBtn);
      grid.appendChild(div);
    });
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

    details.innerHTML = `
      <h2>${pokemon.NameFR} (${pokemon.NameEN})</h2>
      <div class="popup-images">
        <img src="${pokemon.FullImage || ''}" alt="Full sprite" class="popup-full-img">
        <img src="${pokemon.Image || ''}" alt="Foot sprite" class="popup-foot-img">
      </div>
      <p><strong>Index:</strong> ${pokemon.Index}</p>
      <p><strong>Génération:</strong> ${pokemon.Generation}</p>
      <p><strong>Type 1:</strong> ${pokemon.Type1}</p>
      <p><strong>Type 2:</strong> ${pokemon.getDisplayType2()}</p>
      <p><strong>Groupes d'oeuf:</strong> ${pokemon.getEggGroupsDisplay()}</p>
      <p><strong>Catégorie:</strong> ${pokemon.getCategoryDisplay()}</p>
      <p><strong>Trouvé:</strong> ${entry.found ? 'Oui' : 'Non'}</p>
      <p><strong>Première trouvaille:</strong> ${entry.firstFoundDate || 'N/A'}</p>
      <p><strong>Nombre de fois:</strong> ${entry.count}</p>
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
  }

  return {
    updateProgress,
    renderDexGrid,
    bindEvents
  };
})();