/**
 * RouletteUI.js
 * Affiche les résultats de la roulette : un jeu à la fois avec navigation.
 *
 * URL : app.html?roulette=<settings_b64>&ids=<id1,id2,...>&idx=<n>
 *
 * Comportement :
 *  - Affiche le jeu à l'index idx dans la liste ids
 *  - Barre de progression (idx / total)
 *  - Boutons : Précédent | Suivant | IGDB ↗ | Retour aux filtres
 *  - Résumé et histoire tronqués à 100 chars avec "voir plus / voir moins"
 *  - À la fin de la liste → popup proposant de recommencer
 *  - Si ids est vide → message d'erreur
 */

class RouletteUI {
  /**
   * @param {GameBusiness}    gameBusiness
   * @param {FiltersBusiness} filtersBusiness
   * @param {Router}          router
   */
  constructor(gameBusiness, filtersBusiness, router) {
    this.gameBusiness    = gameBusiness;
    this.filtersBusiness = filtersBusiness;
    this.router          = router;
  }

  /**
   * @param {HTMLElement} container
   * @param {string}      settingsEncoded - base64url des settings
   * @param {number[]}    ids             - liste des IDs de jeux
   * @param {number}      idx             - index courant (0-based)
   */
  render(container, settingsEncoded, ids, idx) {
    console.log(`[RouletteUI] Rendu idx=${idx} total=${ids.length}`);

    // Liste vide
    if (!ids || ids.length === 0) {
      container.innerHTML = `
        <div id="page-view" style="text-align:center;padding-top:80px">
          <div class="page-title">Liste vide</div>
          <p class="page-subtitle" style="margin-top:12px">
            Aucun jeu dans cette sélection.
          </p>
          <div style="margin-top:28px">
            <button class="btn-neon" id="btn-back-filters">← Retour aux filtres</button>
          </div>
        </div>`;
      container.querySelector('#btn-back-filters')
        ?.addEventListener('click', () => this.router.navigate('app.html?state=filters'));
      return;
    }

    // Fin de liste dépassée (navigation directe par URL)
    if (idx >= ids.length) {
      this._renderEndView(container, settingsEncoded);
      return;
    }

    // Chargement du jeu courant
    const game = this.gameBusiness.getById(ids[idx]);

    if (!game) {
      // Jeu introuvable → passe au suivant silencieusement
      console.warn(`[RouletteUI] Jeu #${ids[idx]} introuvable, passage au suivant`);
      const nextIdx = idx + 1;
      if (nextIdx < ids.length) {
        this.router.navigate(this._buildUrl(settingsEncoded, ids, nextIdx));
      } else {
        this._renderEndView(container, settingsEncoded);
      }
      return;
    }

    // ── Calculs ───────────────────────────────────────────────────
    const pct       = Math.round(((idx + 1) / ids.length) * 100);
    const ratingPct = Math.round(game.aggregated_rating || game.rating || 0);
    const isFirst   = idx === 0;
    const isLast    = idx === ids.length - 1;
    const prevUrl   = isFirst ? null : this._buildUrl(settingsEncoded, ids, idx - 1);
    const nextUrl   = isLast  ? null : this._buildUrl(settingsEncoded, ids, idx + 1);

    // ── Helpers HTML ─────────────────────────────────────────────
    const tagsHTML = (arr, css = '') =>
      arr.map(t => `<span class="tag ${css}">${this._esc(t)}</span>`).join('');

    const devsHTML = game.developers.map(d =>
      `<a class="tag" href="#" data-dev="${d.company_id}">${this._esc(d.company_name)}</a>`
    ).join('');

    const cover = game.cover_url
      ? `<img class="game-cover-img" src="${this._esc(game.cover_url)}" alt="${this._esc(game.name)}" />`
      : `<div class="game-cover-img" style="background:var(--bg-card);display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:3rem;">🎮</div>`;

    const screenshotsHTML = game.screenshots.slice(0, 8).map(s =>
      `<img src="${this._esc(s.url)}" alt="screenshot" loading="lazy" />`
    ).join('');

    const videosHTML = game.videos.slice(0, 3).map(v =>
      `<a class="tag" href="https://youtube.com/watch?v=${this._esc(v.youtube_id)}" target="_blank" rel="noopener">▶ YouTube</a>`
    ).join(' ');

    const summaryBlock   = this._truncated(game.summary,   100, 'block-summary');
    const storylineBlock = this._truncated(game.storyline, 100, 'block-storyline');

    // ── Template ─────────────────────────────────────────────────
    container.innerHTML = `
      <div id="page-view">

        <!-- Barre nav roulette -->
        <div class="roulette-topbar reveal">
          <span class="roulette-counter">Jeu ${idx + 1} / ${ids.length}</span>
          <button class="btn-neon" id="btn-back-filters" title="Retour aux filtres">
            ⇦ Filtres
          </button>
          ${prevUrl ? `<button class="btn-neon" id="btn-prev">← Précédent</button>` : ''}
          ${game.url ? `<a class="btn-neon purple" href="${this._esc(game.url)}" target="_blank" rel="noopener">IGDB ↗</a>` : ''}
          ${nextUrl
            ? `<button class="btn-neon magenta" id="btn-next">Suivant →</button>`
            : `<button class="btn-neon magenta" id="btn-end-list">Fin de liste ⚑</button>`}
        </div>

        <!-- Barre de progression -->
        <div class="roulette-progress-bar">
          <div class="roulette-progress-fill" style="width:${pct}%"></div>
        </div>

        <!-- Fiche jeu -->
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
          <p style="color:var(--text-primary);line-height:1.7">${summaryBlock}</p>
        </div>` : ''}

        ${game.storyline ? `
        <div class="game-section reveal">
          <div class="game-section-title">Histoire</div>
          <p style="color:var(--text-secondary);line-height:1.7">${storylineBlock}</p>
        </div>` : ''}

        ${game.modes.length ? `
        <div class="game-section reveal">
          <div class="game-section-title">Modes de jeu</div>
          <div class="game-tags-row">${tagsHTML(game.modes, 'mode')}</div>
        </div>` : ''}

        ${game.perspectives.length ? `
        <div class="game-section reveal">
          <div class="game-section-title">Perspectives</div>
          <div class="game-tags-row">${tagsHTML(game.perspectives)}</div>
        </div>` : ''}

        ${game.themes.length ? `
        <div class="game-section reveal">
          <div class="game-section-title">Thèmes</div>
          <div class="game-tags-row">${tagsHTML(game.themes, 'theme')}</div>
        </div>` : ''}

        ${game.developers.length ? `
        <div class="game-section reveal">
          <div class="game-section-title">Développeurs</div>
          <div class="game-tags-row">${devsHTML}</div>
        </div>` : ''}

        ${videosHTML ? `
        <div class="game-section reveal">
          <div class="game-section-title">Vidéos</div>
          <div class="game-tags-row">${videosHTML}</div>
        </div>` : ''}

        ${screenshotsHTML ? `
        <div class="game-section reveal">
          <div class="game-section-title">Captures d'écran</div>
          <div class="screenshots-row">${screenshotsHTML}</div>
        </div>` : ''}

      </div>
    `;

    // ── Event listeners ───────────────────────────────────────────
    container.querySelector('#btn-back-filters')
      ?.addEventListener('click', () =>
        this.router.navigate(`app.html?state=filters&s=${settingsEncoded}`)
      );

    container.querySelector('#btn-prev')
      ?.addEventListener('click', () => this.router.navigate(prevUrl));

    container.querySelector('#btn-next')
      ?.addEventListener('click', () => this.router.navigate(nextUrl));

    container.querySelector('#btn-end-list')
      ?.addEventListener('click', () => this._showEndPopup(settingsEncoded));

    // Liens développeurs via router
    container.querySelectorAll('a[data-dev]').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        this.router.navigate(`app.html?developer=${a.dataset.dev}`);
      });
    });

    // Boutons voir plus / voir moins
    container.querySelectorAll('.btn-read-more').forEach(btn => {
      btn.addEventListener('click', () => {
        const blockId = btn.dataset.block;
        const block   = document.getElementById(blockId);
        if (!block) return;
        const short = block.querySelector('.text-short');
        const full  = block.querySelector('.text-full');
        const isExpanded = full.classList.contains('visible');
        full.classList.toggle('visible', !isExpanded);
        short.classList.toggle('hidden', !isExpanded);
        btn.textContent = isExpanded ? '… voir plus' : 'voir moins';
      });
    });

    this._activateReveal();
  }

  // ─────────────────────────────────────────────────────────────────
  // VUE "FIN DE LISTE"
  // ─────────────────────────────────────────────────────────────────

  _renderEndView(container, settingsEncoded) {
    container.innerHTML = `
      <div id="page-view" style="text-align:center;padding-top:80px">
        <div class="page-title">🏁 Fin de la sélection</div>
        <p class="page-subtitle" style="margin-top:12px">
          Tu as parcouru tous les jeux de cette sélection.
        </p>
        <div style="margin-top:32px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
          <button class="btn-neon" id="btn-new-blank">Nouvelle recherche vierge</button>
          <button class="btn-neon purple" id="btn-new-same">Mêmes critères</button>
          <button class="btn-neon magenta" id="btn-home">Accueil</button>
        </div>
      </div>`;

    container.querySelector('#btn-new-blank')
      ?.addEventListener('click', () => this.router.navigate('app.html?state=filters'));
    container.querySelector('#btn-new-same')
      ?.addEventListener('click', () =>
        this.router.navigate(`app.html?state=filters&s=${settingsEncoded}`)
      );
    container.querySelector('#btn-home')
      ?.addEventListener('click', () => this.router.navigate('app.html'));
  }

  // ─────────────────────────────────────────────────────────────────
  // POPUP FIN DE LISTE (depuis le dernier jeu)
  // ─────────────────────────────────────────────────────────────────

  _showEndPopup(settingsEncoded) {
    const popup = document.createElement('div');
    popup.className = 'popup-overlay';
    popup.innerHTML = `
      <div class="popup-card">
        <div class="popup-title">🏁 Fin de la liste !</div>
        <div class="popup-text">
          Tu as consulté tous les jeux de cette sélection.<br/>
          Que veux-tu faire maintenant ?
        </div>
        <div class="popup-actions">
          <button class="btn-neon" id="pop-blank">Nouvelle recherche vierge</button>
          <button class="btn-neon purple" id="pop-same">Mêmes critères</button>
          <button class="btn-neon magenta" id="pop-home">Accueil</button>
        </div>
      </div>
    `;
    document.body.appendChild(popup);

    popup.querySelector('#pop-blank')
      ?.addEventListener('click', () => {
        popup.remove();
        this.router.navigate('app.html?state=filters');
      });
    popup.querySelector('#pop-same')
      ?.addEventListener('click', () => {
        popup.remove();
        this.router.navigate(`app.html?state=filters&s=${settingsEncoded}`);
      });
    popup.querySelector('#pop-home')
      ?.addEventListener('click', () => {
        popup.remove();
        this.router.navigate('app.html');
      });
    popup.addEventListener('click', e => { if (e.target === popup) popup.remove(); });
  }

  // ─────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────

  /**
   * Retourne le HTML d'un texte tronqué avec bouton "voir plus".
   * @param {string} text
   * @param {number} maxChars
   * @param {string} blockId
   */
  _truncated(text, maxChars, blockId) {
    if (!text) return '';
    const esc = this._esc(text);
    if (text.length <= maxChars) return esc;

    const short = this._esc(text.substring(0, maxChars));
    const rest  = this._esc(text.substring(maxChars));
    return `<span id="${blockId}"><span class="text-short">${short}</span><span class="text-full">${rest}</span><button class="btn-read-more" data-block="${blockId}">… voir plus</button></span>`;
  }

  /** Construit l'URL de navigation de la roulette. */
  _buildUrl(settingsEncoded, ids, idx) {
    return `app.html?roulette=${settingsEncoded}&ids=${ids.join(',')}&idx=${idx}`;
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
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

window.RouletteUI = RouletteUI;
