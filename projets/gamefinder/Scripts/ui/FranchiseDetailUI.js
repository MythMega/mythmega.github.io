/**
 * FranchiseDetailUI.js
 * Page de détail d'une franchise.
 */

class FranchiseDetailUI {
  constructor(franchiseBusiness, router) {
    this.franchiseBusiness = franchiseBusiness;
    this.router            = router;
  }

  render(container, id) {
    console.log('[FranchiseDetailUI] Rendu de la franchise #', id);
    const result = this.franchiseBusiness.getById(id);

    if (!result) {
      container.innerHTML = `
        <div id="page-view">
          <div class="page-title">Franchise introuvable</div>
          <p class="page-subtitle">Aucune franchise avec l'ID ${id}.</p>
        </div>`;
      return;
    }

    const { franchise, games } = result;

    const gamesHTML = games.length
      ? games.map(g => `
          <div class="list-item-card reveal" data-game-id="${g.id}">
            ${g.cover_url ? `<img class="list-item-cover" src="${this._esc(g.cover_url)}" alt="${this._esc(g.name)}" loading="lazy" />` : ''}
            <div class="list-item-id">#${g.id}</div>
            <div class="list-item-name">${this._esc(g.name)}</div>
          </div>`).join('')
      : '<p style="color:var(--text-muted);grid-column:1/-1">Aucun jeu trouvé pour cette franchise.</p>';

    container.innerHTML = `
      <div id="page-view">
        <div class="page-title reveal">🏆 ${this._esc(franchise.name)}</div>
        <p class="page-subtitle">#${franchise.id} — ${games.length} jeu${games.length !== 1 ? 'x' : ''}</p>
        <hr class="neon-divider" />
        <div class="list-grid" id="franchise-games-grid">
          ${gamesHTML}
        </div>
      </div>
    `;

    container.querySelectorAll('.list-item-card[data-game-id]').forEach(card => {
      card.addEventListener('click', () => {
        this.router.navigate(`app.html?game=${card.dataset.gameId}`);
      });
    });

    this._activateReveal();
  }

  _activateReveal() {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); observer.unobserve(e.target); } });
    }, { threshold: 0.1 });
    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
  }

  _esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
}

window.FranchiseDetailUI = FranchiseDetailUI;
