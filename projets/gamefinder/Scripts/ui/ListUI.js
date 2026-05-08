/**
 * ListUI.js
 * Page de liste paginée générique.
 * URL : app.html?list=<type>&page=<n>
 */

class ListUI {
  /**
   * @param {ListBusiness} listBusiness
   * @param {Router}       router
   */
  constructor(listBusiness, router) {
    this.listBusiness = listBusiness;
    this.router       = router;
  }

  render(container, type, page) {
    console.log(`[ListUI] Rendu liste type=${type} page=${page}`);
    const typeLabels = {
      game:      { label: 'Jeux',         icon: '🎮' },
      developer: { label: 'Développeurs', icon: '👨‍💻' },
      franchise: { label: 'Franchises',   icon: '🏆' },
      genre:     { label: 'Genres',       icon: '🎭' },
      platform:  { label: 'Plateformes',  icon: '🖥️' },
      theme:     { label: 'Thèmes',       icon: '🌐' },
    };

    const meta   = typeLabels[type] || { label: type, icon: '📋' };
    const result = this.listBusiness.getList(type, page);
    const items  = result.items;

    const itemsHTML = items.length
      ? items.map(item => this._renderItem(item, type)).join('')
      : '<p style="color:var(--text-muted);grid-column:1/-1">Aucun élément trouvé.</p>';

    container.innerHTML = `
      <div id="page-view">
        <div class="page-title">${meta.icon} ${meta.label}</div>
        <p class="page-subtitle" id="list-subtitle">Page ${page} — ${items.length} éléments affichés</p>
        <hr class="neon-divider" />
        <div class="list-search-bar">
          <input type="text" class="search-input" id="list-search-input"
                 placeholder="Rechercher dans ${meta.label}…" autocomplete="off" />
          <span class="search-icon">🔍</span>
        </div>
        <div class="list-grid" id="list-grid">
          ${itemsHTML}
        </div>
        <div id="list-voir-tout" style="display:none;text-align:center;margin-top:24px;">
          <button class="btn-neon" id="btn-voir-tout">Voir tout les résultats</button>
        </div>
        ${this._paginationHTML(type, page, result.hasNext)}
      </div>
    `;

    this._bindItemClicks(container, type);
    this._bindPagination(container, type, page, result.hasNext);
    this._bindSearch(container, type, page, items);
    this._activateReveal();
  }

  _bindItemClicks(container, type) {
    container.querySelectorAll('.list-item-card[data-id]').forEach(card => {
      card.addEventListener('click', () => {
        const t   = card.dataset.type;
        const id  = card.dataset.id;
        const url = `app.html?${t}=${id}`;
        console.log(`[ListUI] Clic item type=${t} id=${id}`);
        this.router.navigate(url);
      });
    });
  }

  _bindPagination(container, type, page, hasNext) {
    container.querySelector('#btn-page-prev')?.addEventListener('click', () => {
      if (page > 1) this.router.navigate(`app.html?list=${type}&page=${page - 1}`);
    });
    container.querySelector('#btn-page-next')?.addEventListener('click', () => {
      this.router.navigate(`app.html?list=${type}&page=${page + 1}`);
    });
  }

  _bindSearch(container, type, page, paginatedItems) {
    const input      = container.querySelector('#list-search-input');
    const grid       = container.querySelector('#list-grid');
    const subtitle   = container.querySelector('#list-subtitle');
    const voirToutDiv = container.querySelector('#list-voir-tout');
    const voirToutBtn = container.querySelector('#btn-voir-tout');
    const pagination  = container.querySelector('.pagination');

    let debounceTimer = null;

    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const term = input.value.trim();

        if (term.length < 2) {
          // Retour à la vue paginée
          grid.innerHTML = paginatedItems.length
            ? paginatedItems.map(item => this._renderItem(item, type)).join('')
            : '<p style="color:var(--text-muted);grid-column:1/-1">Aucun élément trouvé.</p>';
          subtitle.textContent = `Page ${page} — ${paginatedItems.length} éléments affichés`;
          voirToutDiv.style.display = 'none';
          if (pagination) pagination.style.display = '';
          this._bindItemClicks(container, type);
          this._activateReveal();
          return;
        }

        const allResults = this.listBusiness.search(type, term);
        this._renderSearchResults(container, grid, subtitle, voirToutDiv, voirToutBtn, pagination, allResults, type, term, false);
      }, 250);
    });
  }

  _renderSearchResults(container, grid, subtitle, voirToutDiv, voirToutBtn, pagination, results, type, term, showAll) {
    const PREVIEW = 10;
    const displayed = showAll ? results : results.slice(0, PREVIEW);
    const hasMore   = !showAll && results.length > PREVIEW;

    grid.innerHTML = displayed.length
      ? displayed.map(item => this._renderItem(item, type)).join('')
      : `<p style="color:var(--text-muted);grid-column:1/-1">Aucun résultat pour « ${this._esc(term)} ».</p>`;

    subtitle.textContent = showAll
      ? `${results.length} résultats pour « ${term} »`
      : `${displayed.length} / ${results.length} résultats pour « ${term} »`;

    voirToutDiv.style.display = hasMore ? 'block' : 'none';
    if (pagination) pagination.style.display = 'none';

    if (hasMore) {
      voirToutBtn.onclick = () => {
        this._renderSearchResults(container, grid, subtitle, voirToutDiv, voirToutBtn, pagination, results, type, term, true);
        this._bindItemClicks(container, type);
        this._activateReveal();
      };
    }

    this._bindItemClicks(container, type);
    this._activateReveal();
  }

  _renderItem(item, type) {
    const id   = item.id || item.company_id || '';
    const name = item.name || item.company_name || '—';

    let mediaHTML = '';
    if ((type === 'game' || type === 'franchise') && item.cover_url) {
      mediaHTML = `<img class="list-item-cover" src="${this._esc(item.cover_url)}" alt="${this._esc(name)}" loading="lazy" />`;
    } else if ((type === 'platform' || type === 'developer') && item.logo_url) {
      mediaHTML = `<div class="list-item-logo-box"><img class="list-item-logo" src="${this._esc(item.logo_url)}" alt="${this._esc(name)}" loading="lazy" /></div>`;
    }

    return `
      <div class="list-item-card reveal" data-type="${type}" data-id="${id}">
        ${mediaHTML}
        <div class="list-item-id">#${id}</div>
        <div class="list-item-name">${this._esc(name)}</div>
      </div>
    `;
  }

  _paginationHTML(type, page, hasNext) {
    const prevDisabled = page <= 1;
    return `
      <div class="pagination">
        <button class="btn-neon" id="btn-page-prev" ${prevDisabled ? 'disabled style="opacity:0.4;pointer-events:none"' : ''}>
          ← Précédent
        </button>
        <span class="page-info">Page ${page}</span>
        <button class="btn-neon" id="btn-page-next" ${!hasNext ? 'disabled style="opacity:0.4;pointer-events:none"' : ''}>
          Suivant →
        </button>
      </div>
    `;
  }

  _activateReveal() {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('visible'); observer.unobserve(e.target); }
      });
    }, { threshold: 0.05 });
    document.querySelectorAll('.reveal:not(.visible)').forEach(el => observer.observe(el));
  }

  _esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
}

window.ListUI = ListUI;
