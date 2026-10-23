/**
 * GenericDetailUI.js
 * Page de détail pour les types simples : genre et thème.
 *
 * Les jeux sont retrouvés par leur libellé dans les tables relationnelles
 * (game_genres.genre / game_themes.theme), conformément au schéma.
 */

class GenericDetailUI {
  /**
   * @param {Database} db
   * @param {Router}   router
   */
  constructor(db, router) {
    this.db     = db;
    this.router = router;
  }

  /**
   * @param {HTMLElement} container
   * @param {'genre'|'theme'} type
   * @param {number} id
   */
  render(container, type, id) {
    console.log(`[GenericDetailUI] Rendu type=${type} id=${id}`);

    const config = {
      genre: { label: 'Genre',     dictionary: 'genres', relation: 'game_genres', column: 'genre',     icon: '🎭' },
      theme: { label: 'Thème',     dictionary: 'themes', relation: 'game_themes', column: 'theme',     icon: '🌐' },
    }[type];

    if (!config) {
      container.innerHTML = `
        <div id="page-view">
          <div class="page-title">Type inconnu</div>
          <p class="page-subtitle">Aucune page de détail pour « ${this._esc(type)} ».</p>
        </div>`;
      return;
    }

    const row = this.db.queryOne(
      `SELECT id, name FROM ${config.dictionary} WHERE id = ?`, [id]
    );

    if (!row) {
      container.innerHTML = `
        <div id="page-view">
          <div class="page-title">${config.label} introuvable</div>
          <p class="page-subtitle">Aucun ${config.label.toLowerCase()} avec l'ID ${id}.</p>
        </div>`;
      return;
    }

    const countRow = this.db.queryOne(
      `SELECT COUNT(*) AS cnt FROM ${config.relation} WHERE ${config.column} = ?`, [row.name]
    );
    const totalGames = countRow ? (countRow.cnt || 0) : 0;

    const gameRows = this.db.query(
      `SELECT g.id, g.name, g.cover_url
         FROM ${config.relation} rel
         JOIN games g ON g.id = rel.game_id
        WHERE rel.${config.column} = ?
        ORDER BY g.first_release_date DESC
        LIMIT 60`,
      [row.name]
    );

    const gamesHTML = gameRows.length
      ? gameRows.map(g => `
          <div class="list-item-card" data-game-id="${g.id}">
            ${g.cover_url ? `<img class="list-item-cover" src="${this._esc(g.cover_url)}" alt="${this._esc(g.name)}" loading="lazy" />` : ''}
            <div class="list-item-id">#${g.id}</div>
            <div class="list-item-name">${this._esc(g.name)}</div>
          </div>`).join('')
      : '<p style="color:var(--text-muted);grid-column:1/-1">Aucun jeu associé.</p>';

    container.innerHTML = `
      <div id="page-view">
        <div class="page-title reveal">${config.icon} ${this._esc(row.name)}</div>
        <p class="page-subtitle">#${row.id} — ${totalGames} jeu${totalGames !== 1 ? 'x' : ''}</p>
        <hr class="neon-divider" />
        <div class="game-section reveal">
          <div class="game-section-title">
            Jeux${totalGames > gameRows.length ? ` — ${gameRows.length} plus récents sur ${totalGames}` : ''}
          </div>
          <div class="list-grid">${gamesHTML}</div>
        </div>
      </div>
    `;

    container.querySelectorAll('.list-item-card[data-game-id]').forEach(card => {
      card.addEventListener('click', () => {
        this.router.navigate(`app.html?game=${card.dataset.gameId}`);
      });
    });

    if (window._metaManager) {
      window._metaManager.set({
        title: `${row.name} — Gamefinder 2.0`,
        description: `Découvre les jeux associés à ${row.name} (${totalGames} référencés).`,
        url: `https://mythmega.github.io/app.html?${type}=${row.id}`,
      });
    }

    this._activateReveal();
  }

  _activateReveal() {
    if (typeof IntersectionObserver === 'undefined') {
      document.querySelectorAll('.reveal').forEach(el => el.classList.add('visible'));
      return;
    }
    const observer = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); observer.unobserve(e.target); } });
    }, { threshold: 0.1 });
    document.querySelectorAll('.reveal:not(.visible)').forEach(el => observer.observe(el));
  }

  _esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
}

window.GenericDetailUI = GenericDetailUI;
