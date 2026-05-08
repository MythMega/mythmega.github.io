/**
 * GameDetailUI.js
 * Page de détail d'un jeu.
 */

class GameDetailUI {
  /**
   * @param {GameBusiness} gameBusiness
   * @param {Router}       router
   */
  constructor(gameBusiness, router) {
    this.gameBusiness = gameBusiness;
    this.router       = router;
  }

  render(container, id) {
    console.log('[GameDetailUI] Rendu du jeu #', id);
    const game = this.gameBusiness.getById(id);

    if (!game) {
      container.innerHTML = `
        <div id="page-view">
          <div class="page-title">Jeu introuvable</div>
          <p class="page-subtitle">Le jeu avec l'ID ${id} n'existe pas dans la base.</p>
        </div>`;
      return;
    }

    const ratingPct  = Math.round(game.aggregated_rating || game.rating || 0);
    const cover      = game.cover_url
      ? `<img class="game-cover-img" src="${this._esc(game.cover_url)}" alt="${this._esc(game.name)}" />`
      : `<div class="game-cover-img" style="background:var(--bg-card);display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:3rem;">🎮</div>`;

    const tagsHTML = (arr, cssClass = '') =>
      arr.map(t => `<span class="tag ${cssClass}">${this._esc(t)}</span>`).join('');

    const devsHTML = game.developers.map(d =>
      `<a class="tag" href="app.html?developer=${d.company_id}" 
          onclick="event.preventDefault();window._router.navigate('app.html?developer=${d.company_id}')"
       >${this._esc(d.company_name)}</a>`
    ).join('');

    const screenshotsHTML = game.screenshots.length
      ? `<div class="screenshots-row">
          ${game.screenshots.map((s, i) => `<img src="${this._esc(s.url)}" alt="screenshot" loading="lazy" class="screenshot-thumb" data-idx="${i}" />`).join('')}
         </div>`
      : '<p style="color:var(--text-muted);font-size:0.85rem">Aucune capture disponible</p>';

    const videosHTML = game.videos.length
      ? game.videos.map(v =>
          `<iframe class="yt-embed" src="https://www.youtube.com/embed/${this._esc(v.youtube_id)}" title="YouTube video" frameborder="0" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe>`
        ).join('')
      : '';

    container.innerHTML = `
      <div id="page-view">
        <div class="game-detail-hero reveal">
          ${cover}
          <div class="game-info-block">
            <div class="game-detail-title">${this._esc(game.name)}</div>

            <div class="game-meta-row">
              <span class="game-meta-label">ID IGDB</span>
              <span class="game-meta-value" style="font-family:var(--font-mono)">#${game.id}</span>
            </div>
            <div class="game-meta-row">
              <span class="game-meta-label">Sortie</span>
              <span class="game-meta-value">${game.releaseYear}</span>
            </div>
            <div class="game-meta-row">
              <span class="game-meta-label">Note</span>
              <span class="game-meta-value">
                ${game.ratingDisplay}/100
                <div class="rating-bar-wrapper" style="margin-top:4px;max-width:180px">
                  <div class="rating-bar" style="width:${ratingPct}%"></div>
                </div>
              </span>
            </div>
            ${game.url ? `<div class="game-meta-row">
              <span class="game-meta-label">Lien IGDB</span>
              <a href="${this._esc(game.url)}" target="_blank" rel="noopener" class="game-meta-value">Voir sur IGDB ↗</a>
            </div>` : ''}

            <!-- Tags rapides -->
            <div class="game-tags-row" style="margin-top:8px">
              ${tagsHTML(game.genres)}
              ${tagsHTML(game.platforms, 'platform')}
            </div>
          </div>
        </div>

        <hr class="neon-divider" />

        ${game.summary ? `
        <div class="game-section reveal">
          <div class="game-section-title">Résumé</div>
          <p style="color:var(--text-primary);line-height:1.7">${this._esc(game.summary)}</p>
        </div>` : ''}

        ${game.storyline ? `
        <div class="game-section reveal">
          <div class="game-section-title">Histoire</div>
          <p style="color:var(--text-secondary);line-height:1.7">${this._esc(game.storyline)}</p>
        </div>` : ''}

        <div class="game-section reveal">
          <div class="game-section-title">Modes de jeu</div>
          <div class="game-tags-row">${tagsHTML(game.modes, 'mode')}</div>
        </div>

        <div class="game-section reveal">
          <div class="game-section-title">Perspectives</div>
          <div class="game-tags-row">${tagsHTML(game.perspectives)}</div>
        </div>

        <div class="game-section reveal">
          <div class="game-section-title">Thèmes</div>
          <div class="game-tags-row">${tagsHTML(game.themes, 'theme')}</div>
        </div>

        ${game.keywords.length ? `
        <div class="game-section reveal">
          <div class="game-section-title">Mots-clés</div>
          <div class="game-tags-row">${tagsHTML(game.keywords, 'keyword')}</div>
        </div>` : ''}

        ${game.developers.length ? `
        <div class="game-section reveal">
          <div class="game-section-title">Développeurs</div>
          <div class="game-tags-row">${devsHTML}</div>
        </div>` : ''}

        ${videosHTML ? `
        <div class="game-section reveal">
          <div class="game-section-title">Vidéos</div>
          <div class="videos-row">${videosHTML}</div>
        </div>` : ''}

        <div class="game-section reveal">
          <div class="game-section-title">Captures d'écran</div>
          ${screenshotsHTML}
        </div>
      </div>
    `;

    // Activer les liens développeurs via le router
    container.querySelectorAll('a[href^="app.html?developer="]').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const url = a.getAttribute('href');
        this.router.navigate(url);
      });
    });

    this._activateReveal();
    if (game.screenshots.length) this._bindLightbox(container, game.screenshots);
  }

  /** Active les animations .reveal au scroll. */
  _activateReveal() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });

    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
  }

  /** Rend les miniatures cliquables pour ouvrir le lightbox. */
  _bindLightbox(container, screenshots) {
    container.querySelectorAll('.screenshot-thumb').forEach(img => {
      img.addEventListener('click', () => {
        this._openLightbox(screenshots, parseInt(img.dataset.idx, 10));
      });
    });
  }

  /** Ouvre le lightbox plein écran avec navigation. */
  _openLightbox(screenshots, startIdx) {
    const urls = screenshots.map(s => s.url);
    let current = startIdx;

    const overlay = document.createElement('div');
    overlay.className = 'lightbox-overlay';
    document.body.appendChild(overlay);

    const update = () => {
      const img = overlay.querySelector('.lightbox-img');
      if (img) { img.src = urls[current]; img.alt = `screenshot ${current + 1}`; }
    };

    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    };

    const prev = () => { current = (current - 1 + urls.length) % urls.length; update(); };
    const next = () => { current = (current + 1) % urls.length; update(); };

    const onKey = (e) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    };

    overlay.innerHTML = `
      <button class="lightbox-close" title="Fermer (Échap)">✕</button>
      <div class="lightbox-inner">
        ${urls.length > 1 ? `<button class="lightbox-nav" id="lb-prev">&#8592;</button>` : ''}
        <img class="lightbox-img" src="${this._esc(urls[current])}" alt="screenshot ${current + 1}" />
        ${urls.length > 1 ? `<button class="lightbox-nav" id="lb-next">&#8594;</button>` : ''}
      </div>`;

    overlay.querySelector('.lightbox-inner').addEventListener('click', e => e.stopPropagation());
    overlay.querySelector('.lightbox-close').addEventListener('click', close);
    overlay.querySelector('#lb-prev')?.addEventListener('click', prev);
    overlay.querySelector('#lb-next')?.addEventListener('click', next);
    overlay.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
  }

  _esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

window.GameDetailUI = GameDetailUI;
