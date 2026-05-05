/**
 * DeveloperDetailUI.js
 * Page de détail d'un développeur.
 */

class DeveloperDetailUI {
  constructor(developerBusiness, router) {
    this.developerBusiness = developerBusiness;
    this.router            = router;
  }

  render(container, id) {
    console.log('[DeveloperDetailUI] Rendu du développeur #', id);
    const result = this.developerBusiness.getById(id);

    if (!result) {
      container.innerHTML = `
        <div id="page-view">
          <div class="page-title">Développeur introuvable</div>
          <p class="page-subtitle">Aucun développeur avec l'ID ${id}.</p>
        </div>`;
      return;
    }

    const { dev, games } = result;
    const gamesHTML = games.length
      ? games.map(g => `
          <div class="list-item-card" data-game-id="${g.id}">
            ${g.cover_url ? `<img class="list-item-cover" src="${this._esc(g.cover_url)}" alt="${this._esc(g.name)}" loading="lazy" />` : ''}
            <div class="list-item-id">#${g.id}</div>
            <div class="list-item-name">${this._esc(g.name)}</div>
          </div>`
        ).join('')
      : '<p style="color:var(--text-muted)">Aucun jeu associé.</p>';

    container.innerHTML = `
      <div id="page-view">
        <div class="page-title reveal">👨‍💻 ${this._esc(dev.name)}</div>
        <p class="page-subtitle">#${dev.id} — ${games.length} jeu(x) développé(s)</p>
        <hr class="neon-divider" />
        <div class="game-section reveal">
          <div class="game-section-title">Jeux</div>
          <div class="list-grid">${gamesHTML}</div>
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

window.DeveloperDetailUI = DeveloperDetailUI;
