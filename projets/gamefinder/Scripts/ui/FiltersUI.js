/**
 * FiltersUI.js
 * Page Roulette : 5 boxes de filtres + bouton de lancement.
 *
 * Boxes :
 *  1. Plateformes   — vedettes ON par défaut, autres OFF, bouton "voir tout"
 *  2. Date de sortie — double range slider (min/max année)
 *  3. Modes de jeu  — tous ON par défaut
 *  4. Genres        — tous ON par défaut
 *  5. Thèmes        — tous ON par défaut
 *
 * Au lancement, encode les settings dans l'URL et navigue vers la vue Roulette.
 */

class FiltersUI {
  /**
   * @param {FiltersBusiness} filtersBusiness
   * @param {Router}          router
   */
  constructor(filtersBusiness, router) {
    this.filtersBusiness = filtersBusiness;
    this.router          = router;
    this.state           = null;
    this.filterData      = null;
    this._container      = null;
  }

  /**
   * Rend la page filtres dans le container donné.
   * @param {HTMLElement} container    - #app-main
   * @param {Object}      [params={}]  - { preSettings: string|null }
   */
  render(container, params = {}) {
    console.log('[FiltersUI] Rendu de la page filtres', params);
    this._container = container;
    this.filterData = this.filtersBusiness.getFilterData();

    // Initialise l'état — depuis l'URL si fourni, sinon par défaut
    if (params && params.preSettings) {
      const decoded = this.filtersBusiness.decodeSettings(params.preSettings);
      this.state    = decoded || this.filtersBusiness.getDefaultSettings();
      console.log('[FiltersUI] Settings restaurés depuis URL');
    } else {
      this.state = this.filtersBusiness.getDefaultSettings();
    }

    container.innerHTML = this._buildHTML();
    this._bindEvents();
    this._activateReveal();
  }

  // ─────────────────────────────────────────────────────────────────
  // BUILD HTML
  // ─────────────────────────────────────────────────────────────────

  _buildHTML() {
    const fd  = this.filterData;
    const s   = this.state;
    const FID = new Set(FiltersBusiness.FEATURED_PLATFORM_IDS);

    const selP = new Set(s.p);
    const selM = new Set(s.m);
    const selG = new Set(s.g);
    const selT = new Set(s.t);

    // ── Plateformes ──────────────────────────────────────────────
    const featuredPlatforms = fd.platforms.filter(p => FID.has(p.id));
    const otherPlatforms    = fd.platforms.filter(p => !FID.has(p.id));

    const featuredHTML = featuredPlatforms.map(p =>
      this._toggleBtn(p.id, p.name, selP.has(p.id), 'platform')
    ).join('');
    const othersHTML = otherPlatforms.map(p =>
      this._toggleBtn(p.id, p.name, selP.has(p.id), 'platform')
    ).join('');

    // ── Slider dates ──────────────────────────────────────────────
    const minY     = fd.minYear;
    const maxY     = fd.maxYear;
    const yearMin  = s.y[0];
    const yearMax  = s.y[1];
    const total    = maxY - minY || 1;
    const leftPct  = ((yearMin - minY) / total * 100).toFixed(2);
    const rightPct = (100 - (yearMax - minY) / total * 100).toFixed(2);

    // ── Modes / Genres / Thèmes ───────────────────────────────────
    const modesHTML  = fd.gameModes.map(m => this._toggleBtn(m.id, m.name, selM.has(m.id), 'mode')).join('');
    const genresHTML = fd.genres.map(g => this._toggleBtn(g.id, g.name, selG.has(g.id), 'genre')).join('');
    const themesHTML = fd.themes.map(t => this._toggleBtn(t.id, t.name, selT.has(t.id), 'theme')).join('');

    return `
      <div id="page-view" class="filters-page">

        <div class="page-title reveal">🎲 ROULETTE</div>
        <p class="page-subtitle">Affine tes critères — on trouve un jeu pour toi</p>
        <hr class="neon-divider" />

        <div class="filter-boxes-grid">

          <!-- Box 1 : Plateformes -->
          <div class="filter-box reveal">
            <div class="filter-box-title">🖥 Plateformes</div>
            <div class="platforms-featured" id="platforms-featured">
              ${featuredHTML}
            </div>
            <button class="btn-expand-platforms" id="btn-expand-platforms">
              ▸ Voir toutes les plateformes (${otherPlatforms.length})
            </button>
            <div class="platforms-others hidden" id="platforms-others">
              ${othersHTML}
            </div>
          </div>

          <!-- Box 2 : Date de sortie -->
          <div class="filter-box reveal">
            <div class="filter-box-title">📅 Date de sortie</div>
            <div class="range-slider-box">
              <div class="range-slider-container">
                <div class="slider-track">
                  <div class="slider-fill" id="slider-fill"
                       style="left:${leftPct}%;right:${rightPct}%"></div>
                </div>
                <input type="range" class="range-input" id="range-year-min"
                       min="${minY}" max="${maxY}" value="${yearMin}" />
                <input type="range" class="range-input" id="range-year-max"
                       min="${minY}" max="${maxY}" value="${yearMax}" />
              </div>
              <div class="range-label" id="range-label">${yearMin} — ${yearMax}</div>
            </div>
          </div>

          <!-- Box 3 : Modes de jeu -->
          <div class="filter-box reveal">
            <div class="filter-box-title">🕹 Modes de jeu</div>
            <div class="toggle-grid" id="modes-grid">${modesHTML}</div>
          </div>

          <!-- Box 4 : Genres -->
          <div class="filter-box wide reveal">
            <div class="filter-box-title">🎭 Genres</div>
            <div class="toggle-grid" id="genres-grid">${genresHTML}</div>
          </div>

          <!-- Box 5 : Thèmes -->
          <div class="filter-box wide reveal">
            <div class="filter-box-title">🌐 Thèmes</div>
            <div class="toggle-grid" id="themes-grid">${themesHTML}</div>
          </div>

        </div>

        <div class="filters-launch-area">
          <div class="filters-launch-status" id="filters-status"></div>
          <button class="btn-neon btn-neon-cta" id="btn-launch-roulette">
            🎲 LANCER LA ROULETTE
          </button>
        </div>

      </div>
    `;
  }

  /** Génère le HTML d'un bouton toggle. */
  _toggleBtn(id, name, isOn, category) {
    return `<button class="toggle-btn ${isOn ? 'on' : 'off'}"
                    data-id="${id}"
                    data-category="${category}">
      <span class="toggle-dot"></span>${this._esc(name)}
    </button>`;
  }

  // ─────────────────────────────────────────────────────────────────
  // EVENTS
  // ─────────────────────────────────────────────────────────────────

  _bindEvents() {
    // ── Toggle buttons (plateformes / modes / genres / thèmes) ────
    document.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => this._toggleItem(btn));
    });

    // ── Expand / collapse "autres plateformes" ────────────────────
    const btnExpand = document.getElementById('btn-expand-platforms');
    const othersDiv = document.getElementById('platforms-others');
    if (btnExpand && othersDiv) {
      btnExpand.addEventListener('click', () => {
        const opening = othersDiv.classList.contains('hidden');
        othersDiv.classList.toggle('hidden');
        btnExpand.textContent = opening
          ? `▾ Masquer les autres plateformes`
          : `▸ Voir toutes les plateformes (${othersDiv.querySelectorAll('.toggle-btn').length})`;
      });
    }

    // ── Double range slider ───────────────────────────────────────
    const rangeMin = document.getElementById('range-year-min');
    const rangeMax = document.getElementById('range-year-max');
    const fill     = document.getElementById('slider-fill');
    const label    = document.getElementById('range-label');
    const minY     = this.filterData.minYear;
    const maxY     = this.filterData.maxYear;
    const total    = maxY - minY || 1;

    const updateSlider = () => {
      let lo = parseInt(rangeMin.value);
      let hi = parseInt(rangeMax.value);
      if (lo > hi) { rangeMin.value = hi; lo = hi; }
      if (hi < lo) { rangeMax.value = lo; hi = lo; }
      const lPct = ((lo - minY) / total * 100).toFixed(2);
      const rPct = (100 - (hi - minY) / total * 100).toFixed(2);
      fill.style.left  = lPct + '%';
      fill.style.right = rPct + '%';
      label.textContent = `${lo} — ${hi}`;
      this.state.y = [lo, hi];
      console.log(`[FiltersUI] Plage d'années : ${lo} – ${hi}`);
    };

    rangeMin?.addEventListener('input', updateSlider);
    rangeMax?.addEventListener('input', updateSlider);

    // ── Bouton Lancer la Roulette ─────────────────────────────────
    document.getElementById('btn-launch-roulette')?.addEventListener('click', () => {
      this._launchRoulette();
    });
  }

  /** Bascule un item ON/OFF et met à jour l'état. */
  _toggleItem(btn) {
    const id  = Number(btn.dataset.id);
    const cat = btn.dataset.category;

    let arr;
    switch (cat) {
      case 'platform': arr = this.state.p; break;
      case 'mode':     arr = this.state.m; break;
      case 'genre':    arr = this.state.g; break;
      case 'theme':    arr = this.state.t; break;
      default: return;
    }

    const set = new Set(arr);
    if (set.has(id)) {
      set.delete(id);
      btn.classList.replace('on', 'off');
    } else {
      set.add(id);
      btn.classList.replace('off', 'on');
    }

    const updated = [...set];
    switch (cat) {
      case 'platform': this.state.p = updated; break;
      case 'mode':     this.state.m = updated; break;
      case 'genre':    this.state.g = updated; break;
      case 'theme':    this.state.t = updated; break;
    }
    console.log(`[FiltersUI] Toggle ${cat} id=${id} → ${set.has(id) ? 'ON' : 'OFF'}`);
  }

  // ─────────────────────────────────────────────────────────────────
  // LANCEMENT
  // ─────────────────────────────────────────────────────────────────

  _launchRoulette() {
    const statusEl = document.getElementById('filters-status');
    const btnEl    = document.getElementById('btn-launch-roulette');
    if (statusEl) statusEl.textContent = '🔍 Recherche en cours…';
    if (btnEl) { btnEl.disabled = true; btnEl.style.opacity = '0.55'; }

    // setTimeout pour laisser le DOM se mettre à jour avant la requête synchrone
    setTimeout(() => {
      try {
        const ids = this.filtersBusiness.runQuery(this.state);

        if (ids.length === 0) {
          console.log('[FiltersUI] Aucun résultat');
          if (statusEl) statusEl.textContent = '';
          if (btnEl) { btnEl.disabled = false; btnEl.style.opacity = '1'; }
          this._showNoResultsPopup();
          return;
        }

        const encoded = this.filtersBusiness.encodeSettings(this.state);
        console.log(`[FiltersUI] ${ids.length} jeux trouvés, navigation vers la roulette`);
        this.router.navigate(`app.html?roulette=${encoded}&ids=${ids.join(',')}&idx=0`);

      } catch (e) {
        console.error('[FiltersUI] Erreur lors de la recherche :', e);
        if (statusEl) statusEl.textContent = `⚠ Erreur : ${e.message}`;
        if (btnEl) { btnEl.disabled = false; btnEl.style.opacity = '1'; }
      }
    }, 50);
  }

  // ─────────────────────────────────────────────────────────────────
  // POPUP "AUCUN RÉSULTAT"
  // ─────────────────────────────────────────────────────────────────

  _showNoResultsPopup() {
    const popup = document.createElement('div');
    popup.className = 'popup-overlay';
    popup.innerHTML = `
      <div class="popup-card">
        <div class="popup-title">Aucun résultat</div>
        <div class="popup-text">
          Aucun jeu ne correspond à ces critères.<br/>
          Essaie d'élargir tes filtres ou réinitialise tout.
        </div>
        <div class="popup-actions">
          <button class="btn-neon" id="popup-edit">Modifier manuellement</button>
          <button class="btn-neon magenta" id="popup-reset">Réinitialiser</button>
        </div>
      </div>
    `;
    document.body.appendChild(popup);

    popup.querySelector('#popup-edit')?.addEventListener('click', () => {
      popup.remove();
    });
    popup.querySelector('#popup-reset')?.addEventListener('click', () => {
      popup.remove();
      this.state = this.filtersBusiness.getDefaultSettings();
      this.render(this._container, {});
    });
    popup.addEventListener('click', e => { if (e.target === popup) popup.remove(); });
  }

  // ─────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────

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

window.FiltersUI = FiltersUI;
