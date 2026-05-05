/**
 * SearchUI.js
 * Interface utilisateur pour la barre de recherche dynamique.
 * Délègue la logique à SearchBusiness.
 */

class SearchUI {
  /**
   * @param {SearchBusiness} searchBusiness
   * @param {Router}         router
   */
  constructor(searchBusiness, router) {
    this.searchBusiness = searchBusiness;
    this.router         = router;
    this._debounceTimer = null;
    this._DEBOUNCE_MS   = 300;
  }

  /**
   * Retourne le HTML de la barre de recherche.
   * @returns {string}
   */
  getHTML() {
    return `
      <div class="search-wrapper" id="search-wrapper">
        <input
          type="text"
          class="search-input"
          id="search-input"
          placeholder="Rechercher un jeu, une franchise, un développeur…"
          autocomplete="off"
          spellcheck="false"
        />
        <span class="search-icon">⌕</span>
        <div class="search-results" id="search-results" style="display:none;"></div>
      </div>
    `;
  }

  /** Attache les événements après injection du HTML dans le DOM. */
  bind() {
    const input   = document.getElementById('search-input');
    const results = document.getElementById('search-results');
    if (!input || !results) {
      console.warn('[SearchUI] Éléments introuvables, bind ignoré');
      return;
    }

    input.addEventListener('input', () => {
      const val = input.value;
      clearTimeout(this._debounceTimer);
      this.searchBusiness.cancel();

      if (val.trim().length < 3) {
        this._hideResults();
        return;
      }

      // Debounce pour ne pas surcharger la DB
      this._debounceTimer = setTimeout(() => this._doSearch(val), this._DEBOUNCE_MS);
    });

    // Fermer si clic hors de la zone
    document.addEventListener('click', (e) => {
      const wrapper = document.getElementById('search-wrapper');
      if (wrapper && !wrapper.contains(e.target)) {
        this._hideResults();
      }
    });

    // Ré-afficher si focus sur l'input
    input.addEventListener('focus', () => {
      if (input.value.trim().length >= 3 && results.innerHTML) {
        results.style.display = 'block';
      }
    });

    console.log('[SearchUI] Événements attachés');
  }

  async _doSearch(term) {
    console.log('[SearchUI] Lancement recherche pour :', term);
    const items = await this.searchBusiness.search(term);
    if (!items) return; // annulé

    const results = document.getElementById('search-results');
    if (!results) return;

    if (items.length === 0) {
      results.innerHTML = `<div class="search-result-item" style="color:var(--text-muted)">Aucun résultat</div>`;
      results.style.display = 'block';
      return;
    }

    // Grouper par type
    const groups = {};
    items.forEach(item => {
      if (!groups[item.type]) groups[item.type] = [];
      groups[item.type].push(item);
    });

    const typeLabels = {
      game:      'jeu',
      genre:     'genre',
      platform:  'plateforme',
      mode:      'mode',
      theme:     'thème',
      developer: 'développeur',
      franchise: 'franchise',
    };

    let html = '';
    Object.entries(groups).forEach(([type, groupItems]) => {
      groupItems.forEach(item => {
        const idPart   = item.id !== null ? `<span class="search-result-id">[${item.id}]</span> ` : '';
        const typePart = `<span class="search-result-type">(${typeLabels[type] || type})</span>`;
        html += `
          <div class="search-result-item"
               data-type="${type}"
               data-id="${item.id !== null ? item.id : ''}"
               data-name="${this._escape(item.name)}">
            ${idPart}
            <span class="search-result-name">${this._escape(item.name)}</span>
            ${typePart}
          </div>
        `;
      });
    });

    results.innerHTML = html;
    results.style.display = 'block';

    // Clic sur un résultat → navigation
    results.querySelectorAll('.search-result-item').forEach(el => {
      el.addEventListener('click', () => {
        const type = el.dataset.type;
        const id   = el.dataset.id;
        const name = el.dataset.name;
        console.log('[SearchUI] Résultat sélectionné :', type, id, name);

        if (id) {
          this.router.navigate(`app.html?${type}=${id}`);
        } else {
          // Types sans ID (genre, platform, mode, theme) → page list filtrée (future feature)
          console.log('[SearchUI] Type sans ID, navigation list pour :', type);
          this.router.navigate(`app.html?list=${type}&page=1`);
        }
        this._hideResults();
        document.getElementById('search-input').value = '';
      });
    });
  }

  _hideResults() {
    const results = document.getElementById('search-results');
    if (results) results.style.display = 'none';
  }

  _escape(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

window.SearchUI = SearchUI;
