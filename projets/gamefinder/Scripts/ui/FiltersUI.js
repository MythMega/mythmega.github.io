/**
 * FiltersUI.js
 * Page Roulette : boîtes de filtres tri-état + lancement.
 *
 * Chaque critère possède trois états, cyclables au clic :
 *   ✓ Inclure  → le jeu doit avoir ce critère (liste blanche)
 *   ✗ Exclure  → le jeu ne doit pas avoir ce critère
 *   N/A Ignorer → aucune contrainte (état neutre par défaut)
 *
 * Au lancement, les réglages sont encodés dans l'URL et la vue Roulette s'ouvre.
 */

class FiltersUI {
  /** Ordre de cycle des états : N/A → Inclure → Exclure → N/A */
  static CYCLE = [0, 1, -1];

  /**
   * @param {FiltersBusiness} filtersBusiness
   * @param {Router}          router
   * @param {AppSettings}     appSettings
   * @param {UserProfile}     [userProfile]
   */
  constructor(filtersBusiness, router, appSettings, userProfile) {
    this.filtersBusiness   = filtersBusiness;
    this.router            = router;
    this.appSettings       = appSettings;
    this.userProfile       = userProfile || null;
    this.state             = null;
    this.filterData        = null;
    this._container        = null;
    this.allowAdultContent = false;
    this._eroticThemeId    = null;
  }

  // ─────────────────────────────────────────────────────────────────
  // RENDU
  // ─────────────────────────────────────────────────────────────────

  /**
   * @param {HTMLElement} container    - #app-main
   * @param {Object}      [params={}]  - { preSettings: string|null }
   */
  async render(container, params = {}) {
    console.log('[FiltersUI] Rendu de la page filtres', params);
    this._container = container;
    this.filterData = this.filtersBusiness.getFilterData();

    this.allowAdultContent = await this.appSettings.get('allowAdultContent', false);
    this._eroticThemeId    = this.filtersBusiness.getEroticThemeId();

    const decoded = params && params.preSettings
      ? this.filtersBusiness.decodeSettings(params.preSettings)
      : null;
    this.state = decoded || this.filtersBusiness.getDefaultSettings();

    this._enforceAdultPolicy();

    container.innerHTML = this._buildHTML();
    this._bindEvents();
    this._syncAllFacetHeaders();
    this._syncSummary();
    this._activateReveal();

    if (window._metaManager) {
      window._metaManager.set({
        title: 'Gamefinder 2.0 — Roulette',
        description: 'Lance la roulette et découvre un jeu aléatoire selon tes critères.',
        url: 'https://mythmega.github.io/app.html?state=filters',
      });
    }
  }

  /**
   * Quand le contenu adulte est désactivé, le thème Erotic est verrouillé
   * en exclusion (il ne peut être ni inclus, ni ignoré).
   */
  _enforceAdultPolicy() {
    if (this.allowAdultContent || this._eroticThemeId === null) return;
    const themeState = this.state.facets.theme;
    themeState.inc = themeState.inc.filter(id => id !== this._eroticThemeId);
    if (!themeState.exc.includes(this._eroticThemeId)) {
      themeState.exc.push(this._eroticThemeId);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // BUILD HTML
  // ─────────────────────────────────────────────────────────────────

  _buildHTML() {
    const fd = this.filterData;
    const s  = this.state;
    const scoreMin     = s.scoreMin;
    const scoreMax     = s.scoreMax;
    const allowNoScore = s.allowNoScore;
    const allowFangame = s.allowFangame;
    const onlyGameAwards = s.onlyGameAwards;

    // Plateformes : épinglées en avant, les autres dépliables
    const pinned = new Set(this.filtersBusiness.pinnedPlatformIds);
    const featuredPlatforms = fd.platforms.filter(p => pinned.has(p.id));
    const otherPlatforms    = fd.platforms.filter(p => !pinned.has(p.id));
    const othersActive      = otherPlatforms.some(p => this._stateOf('platform', p.id) !== 0);

    const featuredHTML = featuredPlatforms.map(p => this._toggleBtn('platform', p)).join('');
    const othersHTML   = otherPlatforms.map(p => this._toggleBtn('platform', p)).join('');

    // Sliders années
    const minY     = fd.minYear;
    const maxY     = fd.maxYear;
    const yearMin  = s.y[0];
    const yearMax  = s.y[1];
    const total    = maxY - minY || 1;
    const leftPct  = ((yearMin - minY) / total * 100).toFixed(2);
    const rightPct = (100 - (yearMax - minY) / total * 100).toFixed(2);

    const gameTypeNote = `<p class="filter-note">
      « Jeu principal » regroupe les jeux sans DLC, extension, mod, remaster, etc.
    </p>`;

    return `
      <div id="page-view" class="filters-page">

        <div class="page-title reveal">🎲 ROULETTE</div>
        <p class="page-subtitle">Affine tes critères — on trouve un jeu pour toi</p>

        <div class="filters-toolbar reveal">
          <div class="tri-legend" aria-hidden="true">
            <span class="legend-item legend-inc"><span class="legend-mark">✓</span> Inclure</span>
            <span class="legend-item legend-exc"><span class="legend-mark">✗</span> Exclure</span>
            <span class="legend-item legend-neutral"><span class="legend-mark">N/A</span> Ignorer</span>
            <span class="legend-hint">Clic : N/A → ✓ voulu → ✗ banni · Ctrl/Shift + clic : ✓ · Ctrl/Shift + clic droit : ✗</span>
          </div>
          <div class="filters-toolbar-actions">
            <button class="btn-neon btn-sm" id="btn-load-filter">📂 Charger un filtre</button>
            <button class="btn-neon btn-sm silver" id="btn-reset-filters" title="Revenir aux critères par défaut">↺ Réinitialiser</button>
          </div>
        </div>

        <hr class="neon-divider" />

        <div class="filter-boxes-grid">

          <!-- Plateformes -->
          <div class="filter-box wide reveal" data-facet="platform">
            <div class="filter-box-header">
              <div class="filter-box-title">
                🖥 Plateformes ${this._facetCountHTML('platform')}
              </div>
              ${this._presetButtonsHTML('platform')}
            </div>
            <div class="platforms-featured" id="platforms-featured">${featuredHTML}</div>
            <button class="btn-expand-platforms" id="btn-expand-platforms" aria-expanded="${othersActive ? 'true' : 'false'}">
              ${othersActive ? '▾ Masquer' : '▸ Voir'} les autres plateformes (${otherPlatforms.length})
            </button>
            <div id="platforms-others-wrapper" class="${othersActive ? '' : 'hidden'}">
              <div class="platforms-search-box">
                <input type="text" class="platforms-search-input" id="platforms-search-input"
                       placeholder="🔍 Rechercher une plateforme…" autocomplete="off" />
              </div>
              <div class="platforms-others-scroll" id="platforms-others-scroll">${othersHTML}</div>
            </div>
          </div>

          <!-- Date de sortie -->
          <div class="filter-box reveal" data-facet="date">
            <div class="filter-box-title">📅 Date de sortie</div>
            <div class="range-slider-box">
              <div class="range-slider-container">
                <div class="slider-track">
                  <div class="slider-fill" id="slider-fill" style="left:${leftPct}%;right:${rightPct}%"></div>
                </div>
                <input type="range" class="range-input" id="range-year-min"
                       min="${minY}" max="${maxY}" value="${yearMin}" aria-label="Année de sortie minimale" />
                <input type="range" class="range-input" id="range-year-max"
                       min="${minY}" max="${maxY}" value="${yearMax}" aria-label="Année de sortie maximale" />
              </div>
              <div class="range-label" id="range-label">${yearMin} — ${yearMax}</div>
            </div>
          </div>

          <!-- Modes de jeu -->
          ${this._facetBoxHTML('mode', '🕹 Modes de jeu', 'toggle-grid')}

          <!-- Genres -->
          ${this._facetBoxHTML('genre', '🎭 Genres', 'toggle-grid wide')}

          <!-- Thèmes -->
          ${this._facetBoxHTML('theme', '🌐 Thèmes', 'toggle-grid wide')}

          <!-- Perspectives -->
          ${this._facetBoxHTML('perspective', '👁 Perspectives', 'toggle-grid')}

          <!-- Score -->
          <div class="filter-box reveal" data-facet="score">
            <div class="filter-box-title">⭐ Score</div>
            <div class="range-slider-box">
              <div class="range-slider-container">
                <div class="slider-track">
                  <div class="slider-fill" id="score-slider-fill"
                       style="left:${scoreMin}%;right:${100 - scoreMax}%"></div>
                </div>
                <input type="range" class="range-input" id="range-score-min"
                       min="0" max="100" step="5" value="${scoreMin}" aria-label="Score minimal" />
                <input type="range" class="range-input" id="range-score-max"
                       min="0" max="100" step="5" value="${scoreMax}" aria-label="Score maximal" />
              </div>
              <div class="range-label" id="score-range-label">${scoreMin} — ${scoreMax}</div>
            </div>
            <div class="filter-switch-row" style="margin-top:14px">
              <label class="switch-row-item">
                <span>Autoriser les jeux sans note</span>
                <span class="switch-toggle">
                  <input type="checkbox" id="cb-allow-no-score" ${allowNoScore ? 'checked' : ''} />
                  <span class="switch-slider"></span>
                </span>
              </label>
            </div>
          </div>

          <!-- Extra -->
          <div class="filter-box reveal" data-facet="extra">
            <div class="filter-box-title">⚙ Extra</div>
            <div class="filter-switch-row">
              <label class="switch-row-item">
                <span>Autoriser fangame / mod</span>
                <span class="switch-toggle">
                  <input type="checkbox" id="cb-allow-fangame" ${allowFangame ? 'checked' : ''} />
                  <span class="switch-slider"></span>
                </span>
              </label>
              <label class="switch-row-item">
                <span>Uniquement Game Awards</span>
                <span class="switch-toggle">
                  <input type="checkbox" id="cb-only-game-awards" ${onlyGameAwards ? 'checked' : ''} />
                  <span class="switch-slider"></span>
                </span>
              </label>
            </div>
          </div>

          <!-- Types de jeux -->
          ${this._facetBoxHTML('gameType', '🏷 Types de jeux', 'toggle-grid', gameTypeNote)}

        </div>

        <div class="filters-launch-area">
          <div class="filters-summary" id="filters-summary"></div>
          <div class="filters-launch-status" id="filters-status" role="status" aria-live="polite"></div>
          <button class="btn-neon btn-neon-cta" id="btn-launch-roulette">
            🎲 LANCER LA ROULETTE
          </button>
          <button class="btn-save-filter" id="btn-save-filter">💾 Sauvegarder les critères</button>
          <div id="save-filter-form" class="save-filter-form hidden">
            <input type="text" id="save-filter-name" class="save-filter-input"
                   placeholder="Nom du filtre…" maxlength="60" autocomplete="off" />
            <div class="save-filter-actions">
              <button class="btn-neon btn-sm mint" id="btn-save-filter-confirm">✓ Valider</button>
              <button class="btn-neon btn-sm silver" id="btn-save-filter-cancel">✕ Annuler</button>
            </div>
          </div>
        </div>

      </div>
    `;
  }

  /** Boîte de facette générique. */
  _facetBoxHTML(facetKey, title, gridClass = 'toggle-grid', note = '') {
    const facet  = FiltersBusiness.FACETS.find(f => f.key === facetKey);
    const items  = this.filtersBusiness.getFacetItems(facetKey);
    const toggle = items.map(item => this._toggleBtn(facetKey, item)).join('');
    const wideCls = gridClass.includes('wide') ? ' wide' : '';

    return `
      <div class="filter-box${wideCls} reveal" data-facet="${facetKey}">
        <div class="filter-box-header">
          <div class="filter-box-title">
            ${title} ${this._facetCountHTML(facetKey)}
          </div>
          ${this._presetButtonsHTML(facetKey)}
        </div>
        ${note}
        <div class="${gridClass.replace(' wide', '')}" id="${facetKey}-grid">${toggle}</div>
      </div>
    `;
  }

  /** Compteur « 2 ✓ · 1 ✗ » dans l'en-tête d'une facette. */
  _facetCountHTML(facetKey) {
    const s = this.state.facets[facetKey];
    const parts = [];
    if (s.inc.length) parts.push(`<span class="facet-count-inc">${s.inc.length} ✓</span>`);
    if (s.exc.length) parts.push(`<span class="facet-count-exc">${s.exc.length} ✗</span>`);
    return `<span class="facet-count" data-count-for="${facetKey}">${parts.join('<span class="facet-count-sep">·</span>')}</span>`;
  }

  /** Presets « tout inclure / tout exclure / tout ignorer ». */
  _presetButtonsHTML(facetKey) {
    return `
      <div class="toggle-all-row">
        <button class="btn-tri-set" data-preset="1" data-category="${facetKey}"
                title="Tout inclure dans cette catégorie" aria-label="Tout inclure">✓</button>
        <button class="btn-tri-set" data-preset="-1" data-category="${facetKey}"
                title="Tout exclure dans cette catégorie" aria-label="Tout exclure">✗</button>
        <button class="btn-tri-set" data-preset="0" data-category="${facetKey}"
                title="Tout ignorer dans cette catégorie (N/A)" aria-label="Tout ignorer">N/A</button>
      </div>
    `;
  }

  /** Génère le HTML d'un bouton tri-état. */
  _toggleBtn(category, item) {
    const state    = this._stateOf(category, item.id);
    const locked   = category === 'theme'
      && item.id === this._eroticThemeId
      && !this.allowAdultContent;

    const cls   = locked ? 'state-exc' : this._stateClass(state);
    const label = state === 1 ? 'inclus' : state === -1 ? 'exclu' : 'ignoré';
    const next  = state === 1 ? 'exclure' : state === -1 ? 'ignorer' : 'inclure';

    if (locked) {
      return `<button class="toggle-btn ${cls} locked" type="button"
                      data-category="${category}" data-id="${item.id}" data-state="-1"
                      data-locked="1" disabled
                      title="Active le contenu adulte dans Paramètres pour modifier ce thème">
        <span class="toggle-dot"></span>${this._esc(item.name)}
      </button>`;
    }

    return `<button class="toggle-btn ${cls}" type="button"
                    data-category="${category}" data-id="${item.id}" data-state="${state}"
                    aria-label="${this._esc(item.name)} : ${label}. Cliquer pour ${next}."
                    title="État : ${label} — clic pour ${next}">
      <span class="toggle-dot"></span>${this._esc(item.name)}
    </button>`;
  }

  _stateClass(state) {
    return state === 1 ? 'state-inc' : state === -1 ? 'state-exc' : 'state-neutral';
  }

  // ─────────────────────────────────────────────────────────────────
  // ÉTAT
  // ─────────────────────────────────────────────────────────────────

  _stateOf(category, id) {
    const facet = this.state.facets[category];
    if (!facet) return 0;
    const numericId = Number(id);
    if (facet.inc.includes(numericId)) return 1;
    if (facet.exc.includes(numericId)) return -1;
    return 0;
  }

  /** Applique l'état d'une valeur dans le modèle. */
  _setState(category, id, state) {
    const facet = this.state.facets[category];
    if (!facet) return;
    const numericId = Number(id);
    facet.inc = facet.inc.filter(v => v !== numericId);
    facet.exc = facet.exc.filter(v => v !== numericId);
    if (state === 1) facet.inc.push(numericId);
    else if (state === -1) facet.exc.push(numericId);
  }

  /** Cycle l'état d'un bouton : N/A → Inclure (voulu) → Exclure (banni) → N/A. */
  _cycle(btn) {
    if (btn.disabled) return;
    const current = Number(btn.dataset.state) || 0;
    const idx     = FiltersUI.CYCLE.indexOf(current);
    const next    = FiltersUI.CYCLE[(idx + 1) % FiltersUI.CYCLE.length];
    this._applyState(btn, next);
  }

  /**
   * Applique directement un état, quel que soit l'état d'origine.
   * Utilisé par les raccourcis Ctrl/Shift (clic = voulu, clic droit = banni).
   */
  _applyState(btn, state) {
    if (btn.disabled) return;
    const category = btn.dataset.category;
    const id       = Number(btn.dataset.id);

    this._setState(category, id, state);
    this._syncButton(btn, state);
    this._syncFacetHeader(category);
    this._syncSummary();
  }

  /** Met à jour un bouton (classe, dataset, libellés) sans re-render complet. */
  _syncButton(btn, state) {
    const name = btn.textContent.trim();
    btn.classList.remove('state-inc', 'state-exc', 'state-neutral');
    btn.classList.add(this._stateClass(state));
    btn.dataset.state = String(state);

    const label = state === 1 ? 'inclus' : state === -1 ? 'exclu' : 'ignoré';
    const next  = state === 1 ? 'exclure' : state === -1 ? 'ignorer' : 'inclure';
    btn.setAttribute('aria-label', `${name} : ${label}. Cliquer pour ${next}. Ctrl ou Maj + clic pour inclure, Ctrl ou Maj + clic droit pour exclure.`);
    btn.title = `État : ${label} — clic pour ${next}\nCtrl/Shift + clic : inclure · Ctrl/Shift + clic droit : bannir`;
  }

  /**
   * Applique un état à toute une facette.
   * @param {string} category
   * @param {1|-1|0} state
   */
  _setFacetState(category, state) {
    const items = this.filtersBusiness.getFacetItems(category);
    for (const item of items) {
      this._setState(category, item.id, state);
    }
    // Le thème Erotic verrouillé reste exclu si le contenu adulte est désactivé
    if (category === 'theme') this._enforceAdultPolicy();

    document.querySelectorAll(`.toggle-btn[data-category="${category}"]`).forEach(btn => {
      if (btn.disabled) return; // thème verrouillé (contenu adulte)
      this._syncButton(btn, state);
    });
    this._syncFacetHeader(category);
    this._syncSummary();
    console.log(`[FiltersUI] Facette ${category} → ${state === 1 ? 'tout inclus' : state === -1 ? 'tout exclu' : 'tout ignoré'}`);
  }

  /** Rafraîchit tous les compteurs de facette (après un rendu complet). */
  _syncAllFacetHeaders() {
    for (const facet of FiltersBusiness.FACETS) {
      this._syncFacetHeader(facet.key);
    }
  }

  /** Rafraîchit le compteur d'une facette dans son en-tête. */
  _syncFacetHeader(category) {
    const el = document.querySelector(`[data-count-for="${category}"]`);
    if (!el) return;
    const s = this.state.facets[category];
    const parts = [];
    if (s.inc.length) parts.push(`<span class="facet-count-inc">${s.inc.length} ✓</span>`);
    if (s.exc.length) parts.push(`<span class="facet-count-exc">${s.exc.length} ✗</span>`);
    el.innerHTML = parts.join('<span class="facet-count-sep">·</span>');
  }

  /** Rafraîchit le résumé global sous la grille. */
  _syncSummary() {
    const el = document.getElementById('filters-summary');
    if (!el) return;
    const summary = this.filtersBusiness.summarize(this.state);
    el.textContent = summary.txt;
    el.classList.toggle('is-empty', summary.activeFacets === 0);
  }

  // ─────────────────────────────────────────────────────────────────
  // ÉVÉNEMENTS
  // ─────────────────────────────────────────────────────────────────

  _bindEvents() {
    const container = this._container;

    // Délégation : critères + presets
    container.addEventListener('click', e => {
      const toggle = e.target.closest('.toggle-btn');
      if (toggle) {
        // Ctrl/Shift + clic : forcer « voulu », quel que soit l'état courant
        if (e.ctrlKey || e.shiftKey) this._applyState(toggle, 1);
        else this._cycle(toggle);
        return;
      }

      const preset = e.target.closest('.btn-tri-set');
      if (preset) {
        this._setFacetState(preset.dataset.category, Number(preset.dataset.preset));
      }
    });

    // Ctrl/Shift + clic droit : forcer « banni » (on bloque le menu contextuel)
    container.addEventListener('contextmenu', e => {
      const toggle = e.target.closest('.toggle-btn');
      if (!toggle || !(e.ctrlKey || e.shiftKey)) return;
      e.preventDefault();
      this._applyState(toggle, -1);
    });

    // Expansion des plateformes secondaires
    const btnExpand     = document.getElementById('btn-expand-platforms');
    const othersWrapper = document.getElementById('platforms-others-wrapper');
    if (btnExpand && othersWrapper) {
      btnExpand.addEventListener('click', () => {
        const opening = othersWrapper.classList.contains('hidden');
        othersWrapper.classList.toggle('hidden', !opening);
        btnExpand.setAttribute('aria-expanded', String(opening));
        const count = othersWrapper.querySelectorAll('.toggle-btn').length;
        btnExpand.textContent = opening
          ? '▾ Masquer les autres plateformes'
          : `▸ Voir les autres plateformes (${count})`;
        if (opening) {
          document.getElementById('platforms-search-input')?.focus();
        }
      });
    }

    document.getElementById('platforms-search-input')
      ?.addEventListener('input', () => this._filterOtherPlatforms());

    // Sliders années
    const rangeMin = document.getElementById('range-year-min');
    const rangeMax = document.getElementById('range-year-max');
    const fill     = document.getElementById('slider-fill');
    const label    = document.getElementById('range-label');
    const minY     = this.filterData.minYear;
    const maxY     = this.filterData.maxYear;
    const total    = maxY - minY || 1;

    const updateYearSlider = () => {
      let lo = parseInt(rangeMin.value, 10);
      let hi = parseInt(rangeMax.value, 10);
      if (lo > hi) { rangeMin.value = hi; lo = hi; }
      if (hi < lo) { rangeMax.value = lo; hi = lo; }
      fill.style.left  = ((lo - minY) / total * 100).toFixed(2) + '%';
      fill.style.right = (100 - (hi - minY) / total * 100).toFixed(2) + '%';
      label.textContent = `${lo} — ${hi}`;
      this.state.y = [lo, hi];
    };
    rangeMin?.addEventListener('input', updateYearSlider);
    rangeMax?.addEventListener('input', updateYearSlider);

    // Slider score
    const scoreRangeMin = document.getElementById('range-score-min');
    const scoreRangeMax = document.getElementById('range-score-max');
    const scoreFill     = document.getElementById('score-slider-fill');
    const scoreLabel    = document.getElementById('score-range-label');

    const updateScoreSlider = () => {
      let lo = parseInt(scoreRangeMin.value, 10);
      let hi = parseInt(scoreRangeMax.value, 10);
      if (lo > hi) { scoreRangeMin.value = hi; lo = hi; }
      if (hi < lo) { scoreRangeMax.value = lo; hi = lo; }
      scoreFill.style.left  = lo + '%';
      scoreFill.style.right = (100 - hi) + '%';
      scoreLabel.textContent = `${lo} — ${hi}`;
      this.state.scoreMin = lo;
      this.state.scoreMax = hi;
    };
    scoreRangeMin?.addEventListener('input', updateScoreSlider);
    scoreRangeMax?.addEventListener('input', updateScoreSlider);

    // Interrupteurs
    document.getElementById('cb-allow-no-score')?.addEventListener('change', e => {
      this.state.allowNoScore = e.target.checked;
    });
    document.getElementById('cb-allow-fangame')?.addEventListener('change', e => {
      this.state.allowFangame = e.target.checked;
    });
    document.getElementById('cb-only-game-awards')?.addEventListener('change', e => {
      this.state.onlyGameAwards = e.target.checked;
    });

    // Actions
    document.getElementById('btn-launch-roulette')?.addEventListener('click', () => this._launchRoulette());
    document.getElementById('btn-load-filter')?.addEventListener('click', () => this._showLoadFilterPopup());
    document.getElementById('btn-reset-filters')?.addEventListener('click', () => {
      this.state = this.filtersBusiness.getDefaultSettings();
      this._enforceAdultPolicy();
      this.render(this._container, {});
    });

    document.getElementById('btn-save-filter')?.addEventListener('click', () => this._toggleSaveFilterForm(true));
    document.getElementById('btn-save-filter-cancel')?.addEventListener('click', () => this._toggleSaveFilterForm(false));
    document.getElementById('btn-save-filter-confirm')?.addEventListener('click', () => this._confirmSaveFilter());
    document.getElementById('save-filter-name')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') this._confirmSaveFilter();
      if (e.key === 'Escape') this._toggleSaveFilterForm(false);
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // SAUVEGARDE / CHARGEMENT
  // ─────────────────────────────────────────────────────────────────

  _toggleSaveFilterForm(show) {
    const form    = document.getElementById('save-filter-form');
    const btnSave = document.getElementById('btn-save-filter');
    if (!form) return;
    form.classList.toggle('hidden', !show);
    btnSave?.classList.toggle('hidden', show);
    if (show) {
      const input = document.getElementById('save-filter-name');
      if (input) { input.value = ''; input.focus(); }
    }
  }

  async _confirmSaveFilter() {
    if (!this.userProfile) return;
    const input = document.getElementById('save-filter-name');
    const name  = input?.value?.trim();
    if (!name) { input?.focus(); return; }
    try {
      const stateToSave = this.filtersBusiness.normalizeSettings(this.state);
      await this.userProfile.saveFilter(name, stateToSave);
      this._toggleSaveFilterForm(false);
      this._showToast(`Filtre « ${name} » sauvegardé.`);
    } catch (e) {
      console.error('[FiltersUI] Erreur sauvegarde filtre :', e);
      this._showToast('⚠ Sauvegarde impossible.');
    }
  }

  async _showLoadFilterPopup() {
    if (!this.userProfile) return;
    const filters = await this.userProfile.getSavedFilters();

    const popup = document.createElement('div');
    popup.className = 'popup-overlay';

    const renderList = () => {
      const listHTML = filters.length === 0
        ? `<p class="saved-filters-empty">Aucun filtre sauvegardé.</p>`
        : filters.map((f, i) => {
            const summary = this.filtersBusiness.summarize(f.state);
            return `
              <div class="saved-filter-row" data-index="${i}">
                <span class="saved-filter-info">
                  <span class="saved-filter-name">${this._esc(f.name)}</span>
                  <span class="saved-filter-meta">${summary.txt}</span>
                </span>
                <div class="saved-filter-actions">
                  <button class="btn-neon btn-sm mint btn-load-saved" data-index="${i}">Charger</button>
                  <button class="btn-neon btn-sm silver btn-delete-saved" data-index="${i}">Supprimer</button>
                </div>
              </div>`;
          }).join('');

      return `
        <div class="popup-card popup-card-wide">
          <div class="popup-title">📂 Filtres sauvegardés</div>
          <div class="saved-filters-list">${listHTML}</div>
          <div class="popup-actions" style="margin-top:20px">
            <button class="btn-neon" id="popup-close-filters">Fermer</button>
          </div>
        </div>`;
    };

    popup.innerHTML = renderList();
    document.body.appendChild(popup);

    const rebindButtons = () => {
      popup.querySelectorAll('.btn-load-saved').forEach(btn => {
        btn.addEventListener('click', () => {
          const saved = filters[Number(btn.dataset.index)];
          if (!saved) return;
          const encoded = this.filtersBusiness.encodeSettings(saved.state);
          popup.remove();
          this.render(this._container, { preSettings: encoded });
        });
      });

      popup.querySelectorAll('.btn-delete-saved').forEach(btn => {
        btn.addEventListener('click', async () => {
          const idx  = Number(btn.dataset.index);
          const name = filters[idx]?.name;
          if (!name) return;
          await this.userProfile.deleteFilter(name);
          filters.splice(idx, 1);
          popup.innerHTML = renderList();
          rebindButtons();
        });
      });

      popup.querySelector('#popup-close-filters')?.addEventListener('click', () => popup.remove());
    };

    rebindButtons();
    popup.addEventListener('click', e => { if (e.target === popup) popup.remove(); });
  }

  _showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'filter-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('filter-toast-visible')));
    setTimeout(() => {
      toast.classList.remove('filter-toast-visible');
      setTimeout(() => toast.remove(), 400);
    }, 2600);
  }

  // ─────────────────────────────────────────────────────────────────
  // LANCEMENT
  // ─────────────────────────────────────────────────────────────────

  _launchRoulette() {
    const statusEl = document.getElementById('filters-status');
    const btnEl    = document.getElementById('btn-launch-roulette');
    if (statusEl) statusEl.textContent = '🔍 Recherche en cours…';
    if (btnEl) { btnEl.disabled = true; btnEl.style.opacity = '0.55'; }

    // Laisse le DOM peindre l'état « recherche » avant la requête synchrone
    setTimeout(() => {
      try {
        const ids = this.filtersBusiness.runQuery(this.state, {
          allowAdultContent: this.allowAdultContent,
        });

        if (ids.length === 0) {
          if (statusEl) statusEl.textContent = '';
          if (btnEl) { btnEl.disabled = false; btnEl.style.opacity = '1'; }
          this._showNoResultsPopup();
          return;
        }

        if (statusEl) {
          statusEl.textContent = `${this.filtersBusiness.lastResultCount} jeu${this.filtersBusiness.lastResultCount > 1 ? 'x' : ''} correspondent — préparation de la roulette…`;
        }

        const encoded = this.filtersBusiness.encodeSettings(this.state);

        // +5 XP au lancement de la roulette
        if (this.userProfile) {
          this.userProfile.addXP(5).then(() => showXPNotif(5));
        }
        this.router.navigate(`app.html?roulette=${encoded}&ids=${ids.join(',')}&idx=0`);

      } catch (e) {
        console.error('[FiltersUI] Erreur lors de la recherche :', e);
        if (statusEl) statusEl.textContent = `⚠ Erreur : ${e.message}`;
        if (btnEl) { btnEl.disabled = false; btnEl.style.opacity = '1'; }
      }
    }, 50);
  }

  // ─────────────────────────────────────────────────────────────────
  // POPUP AUCUN RÉSULTAT
  // ─────────────────────────────────────────────────────────────────

  _showNoResultsPopup() {
    const popup = document.createElement('div');
    popup.className = 'popup-overlay';
    popup.innerHTML = `
      <div class="popup-card">
        <div class="popup-title">Aucun résultat</div>
        <div class="popup-text">
          Aucun jeu ne correspond à ces critères.<br/>
          Une exclusion est peut-être trop large, ou une inclusion trop stricte.
        </div>
        <div class="popup-actions">
          <button class="btn-neon" id="popup-edit">Modifier manuellement</button>
          <button class="btn-neon silver" id="popup-reset">Réinitialiser</button>
        </div>
      </div>
    `;
    document.body.appendChild(popup);

    popup.querySelector('#popup-edit')?.addEventListener('click', () => popup.remove());
    popup.querySelector('#popup-reset')?.addEventListener('click', () => {
      popup.remove();
      this.state = this.filtersBusiness.getDefaultSettings();
      this._enforceAdultPolicy();
      this.render(this._container, {});
    });
    popup.addEventListener('click', e => { if (e.target === popup) popup.remove(); });
  }

  // ─────────────────────────────────────────────────────────────────
  // RECHERCHE PLATEFORMES
  // ─────────────────────────────────────────────────────────────────

  _filterOtherPlatforms() {
    const searchInput = document.getElementById('platforms-search-input');
    const scroll      = document.getElementById('platforms-others-scroll');
    if (!searchInput || !scroll) return;

    const query = searchInput.value.toLowerCase().trim();
    scroll.querySelectorAll('.toggle-btn[data-category="platform"]').forEach(btn => {
      const state = Number(btn.dataset.state) || 0;
      const name  = btn.textContent.toLowerCase().trim();
      // Les critères actifs (inclus/exclus) restent toujours visibles
      btn.style.display = (state !== 0 || !query || name.includes(query)) ? '' : 'none';
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────

  _activateReveal() {
    if (typeof IntersectionObserver === 'undefined') {
      document.querySelectorAll('.reveal').forEach(el => el.classList.add('visible'));
      return;
    }
    const observer = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('visible'); observer.unobserve(e.target); }
      });
    }, { threshold: 0.05 });
    document.querySelectorAll('.reveal:not(.visible)').forEach(el => observer.observe(el));
  }

  _esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

window.FiltersUI = FiltersUI;
