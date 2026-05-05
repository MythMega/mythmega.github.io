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
        <p class="page-subtitle">Page ${page} — ${items.length} éléments affichés</p>
        <hr class="neon-divider" />
        <div class="list-grid" id="list-grid">
          ${itemsHTML}
        </div>
        ${this._paginationHTML(type, page, result.hasNext)}
      </div>
    `;

    // Clic sur les items
    container.querySelectorAll('.list-item-card[data-id]').forEach(card => {
      card.addEventListener('click', () => {
        const t   = card.dataset.type;
        const id  = card.dataset.id;
        const url = `app.html?${t}=${id}`;
        console.log(`[ListUI] Clic item type=${t} id=${id}`);
        this.router.navigate(url);
      });
    });

    // Pagination
    container.querySelector('#btn-page-prev')?.addEventListener('click', () => {
      if (page > 1) this.router.navigate(`app.html?list=${type}&page=${page - 1}`);
    });
    container.querySelector('#btn-page-next')?.addEventListener('click', () => {
      this.router.navigate(`app.html?list=${type}&page=${page + 1}`);
    });

    this._activateReveal();
  }

  _renderItem(item, type) {
    const id   = item.id || item.company_id || '';
    const name = item.name || item.company_name || '—';
    const cover = (type === 'game' && item.cover_url)
      ? `<img class="list-item-cover" src="${this._esc(item.cover_url)}" alt="${this._esc(name)}" loading="lazy" />`
      : '';

    return `
      <div class="list-item-card reveal" data-type="${type}" data-id="${id}">
        ${cover}
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
    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
  }

  _esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
}

window.ListUI = ListUI;
