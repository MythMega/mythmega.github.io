/**
 * PlatformDetailUI.js
 * Page de détail d'une plateforme.
 */

class PlatformDetailUI {
  constructor(db, router) {
    this.db     = db;
    this.router = router;
  }

  render(container, id) {
    console.log('[PlatformDetailUI] Rendu de la plateforme #', id);

    const platform = this.db.queryOne(
      `SELECT id, name, url, logo_url FROM platforms WHERE id = ?`, [id]
    );

    if (!platform) {
      container.innerHTML = `
        <div id="page-view">
          <div class="page-title">Plateforme introuvable</div>
          <p class="page-subtitle">Aucune plateforme avec l'ID ${id}.</p>
        </div>`;
      return;
    }

    // Jeux associés via game_platforms (joint par nom de plateforme)
    const countRow = this.db.queryOne(
      `SELECT COUNT(*) AS cnt FROM game_platforms WHERE platform = ?`, [platform.name]
    );
    const totalGames = countRow ? (countRow.cnt || 0) : 0;

    // Liste bornée : certaines plateformes comptent des dizaines de milliers de jeux.
    const gameRows = this.db.query(
      `SELECT g.id, g.name, g.cover_url
         FROM game_platforms gp
         JOIN games g ON g.id = gp.game_id
        WHERE gp.platform = ?
        ORDER BY g.first_release_date DESC
        LIMIT 60`,
      [platform.name]
    );

    const logoHTML = platform.logo_url
      ? `<div class="entity-logo-wrapper"><img class="entity-logo-img" src="${this._esc(platform.logo_url)}" alt="${this._esc(platform.name)}" /></div>`
      : `<div class="entity-logo-wrapper entity-logo-placeholder">🖥️</div>`;

    const gamesHTML = gameRows.length
      ? gameRows.map(g => `
          <div class="list-item-card" data-game-id="${g.id}">
            ${g.cover_url ? `<img class="list-item-cover" src="${this._esc(g.cover_url)}" alt="${this._esc(g.name)}" loading="lazy" />` : ''}
            <div class="list-item-id">#${g.id}</div>
            <div class="list-item-name">${this._esc(g.name)}</div>
          </div>`
        ).join('')
      : '<p style="color:var(--text-muted)">Aucun jeu associé.</p>';

    container.innerHTML = `
      <div id="page-view">
        <div class="game-detail-hero reveal">
          ${logoHTML}
          <div class="game-info-block">
            <div class="game-detail-title">${this._esc(platform.name)}</div>
            <div class="game-meta-row">
              <span class="game-meta-label">ID</span>
              <span class="game-meta-value" style="font-family:var(--font-mono)">#${platform.id}</span>
            </div>
            <div class="game-meta-row">
              <span class="game-meta-label">Jeux référencés</span>
              <span class="game-meta-value">${totalGames}</span>
            </div>
            ${platform.url ? `<div class="game-meta-row">
              <span class="game-meta-label">Lien IGDB</span>
              <a href="${this._esc(platform.url)}" target="_blank" rel="noopener" class="game-meta-value">Voir sur IGDB ↗</a>
            </div>` : ''}
          </div>
        </div>
        <hr class="neon-divider" />
        <div class="game-section reveal">
          <div class="game-section-title">Jeux sur cette plateforme${totalGames > gameRows.length ? ` — ${gameRows.length} plus récents sur ${totalGames}` : ''}</div>
          <div class="list-grid">${gamesHTML}</div>
        </div>
      </div>
    `;

    container.querySelectorAll('.list-item-card[data-game-id]').forEach(card => {
      card.addEventListener('click', () => {
        this.router.navigate(`app.html?game=${card.dataset.gameId}`);
      });
    });

    // Meta tags dynamiques
    if (window._metaManager) {
      window._metaManager.set({
        title: `${platform.name} — Gamefinder 2.0`,
        description: `Découvre les jeux disponibles sur ${platform.name}.`,
        image: platform.logo_url || 'https://mythmega.github.io/assets/roulette.png',
        url: `https://mythmega.github.io/app.html?platform=${platform.id}`,
      });
    }

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

window.PlatformDetailUI = PlatformDetailUI;
