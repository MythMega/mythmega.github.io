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

    const { franchise } = result;
    container.innerHTML = `
      <div id="page-view">
        <div class="page-title reveal">🏆 ${this._esc(franchise.name)}</div>
        <p class="page-subtitle">#${franchise.id}</p>
        <hr class="neon-divider" />
        <div class="game-section reveal">
          <p style="color:var(--text-secondary)">
            Les jeux appartenant à cette franchise seront listés ici.
          </p>
        </div>
      </div>
    `;

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
