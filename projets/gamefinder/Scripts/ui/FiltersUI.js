/**
 * FiltersUI.js
 * Page Roulette : boxes de filtres + bouton de lancement.
 *
 * Boxes :
 *  1. Plateformes   — vedettes ON par défaut, autres OFF, bouton "voir tout" + All ON/OFF
 *  2. Date de sortie — double range slider (min/max année)
 *  3. Modes de jeu  — tous ON par défaut + All ON/OFF
 *  4. Genres        — tous ON par défaut + All ON/OFF
 *  5. Thèmes        — tous ON par défaut + All ON/OFF (Erotic bloqué si contenu adulte désactivé)
 *
 * Au lancement, encode les settings dans l'URL et navigue vers la vue Roulette.
 */

class FiltersUI {
  /**
   * @param {FiltersBusiness} filtersBusiness
   * @param {Router}          router
   * @param {AppSettings}     appSettings
   * @param {UserProfile}     [userProfile]
   */
  constructor(filtersBusiness, router, appSettings, userProfile) {
    this.filtersBusiness  = filtersBusiness;
    this.router           = router;
    this.appSettings      = appSettings;
    this.userProfile      = userProfile || null;
    this.state            = null;
    this.filterData       = null;
    this._container       = null;
    this.allowAdultContent = false;
    this._eroticThemeId    = null;
  }

  /**
   * Rend la page filtres dans le container donné.
   * @param {HTMLElement} container    - #app-main
   * @param {Object}      [params={}]  - { preSettings: string|null }
   */
  async render(container, params = {}) {
    console.log('[FiltersUI] Rendu de la page filtres', params);
    this._container = container;
    this.filterData = this.filtersBusiness.getFilterData();

    // Charge le setting contenu adulte
    this.allowAdultContent = await this.appSettings.get('allowAdultContent', false);

    // Détecte dynamiquement l'ID du thème Erotic dans la DB
    const eroticEntry = this.filterData.themes.find(t => t.name.toLowerCase() === 'erotic');
    this._eroticThemeId = eroticEntry ? eroticEntry.id : null;
    console.log(`[FiltersUI] Thème Erotic : id=${this._eroticThemeId}, allowAdult=${this.allowAdultContent}`);

    // Initialise l'état — depuis l'URL si fourni, sinon par défaut
    if (params && params.preSettings) {
      const decoded = this.filtersBusiness.decodeSettings(params.preSettings);
      this.state    = decoded || this.filtersBusiness.getDefaultSettings();
      console.log('[FiltersUI] Settings restaurés depuis preSettings :', JSON.stringify(this.state));
    } else {
      this.state = this.filtersBusiness.getDefaultSettings();
      console.log('[FiltersUI] Settings initialisés par défaut.');
    }

    // Force l'exclusion du thème Erotic de l'état si le contenu adulte est désactivé
    if (!this.allowAdultContent && this._eroticThemeId !== null) {
      this.state.t = this.state.t.filter(id => id !== this._eroticThemeId);
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
    const FID = new Set(this.filtersBusiness.pinnedPlatformIds);

    const selP = new Set(s.p);
    const selM = new Set(s.m);
    const selG = new Set(s.g);
    const selT = new Set(s.t);
    const scoreMin      = s.scoreMin    !== undefined ? s.scoreMin    : 0;
    const scoreMax      = s.scoreMax    !== undefined ? s.scoreMax    : 100;
    const allowNoScore  = s.allowNoScore  ?? false;
    const allowFangame  = s.allowFangame  ?? false;
    const onlyGameAwards    = s.onlyGameAwards    ?? false;
    const allowedGameTypes  = new Set(s.allowedGameTypes ?? []);

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
    const themesHTML = fd.themes.map(t => {
      const isErotic   = t.id === this._eroticThemeId;
      const isDisabled = isErotic && !this.allowAdultContent;
      const isOn       = !isDisabled && selT.has(t.id);
      return this._toggleBtn(t.id, t.name, isOn, 'theme', isDisabled);
    }).join('');

    const nonZeroGameTypes = (fd.gameTypes || []).filter(t => t.id !== 0);
    const gameTypesHTML = nonZeroGameTypes.map(t =>
      this._toggleBtn(t.id, t.type, allowedGameTypes.has(t.id), 'game-type')
    ).join('');

    return `
      <div id="page-view" class="filters-page">

        <div class="page-title reveal">🎲 ROULETTE</div>
        <p class="page-subtitle">Affine tes critères — on trouve un jeu pour toi</p>
        <div class="filters-load-area">
          <button class="btn-neon btn-sm" id="btn-load-filter">📂 Charger un filtre</button>
        </div>
        <hr class="neon-divider" />

        <div class="filter-boxes-grid">

          <!-- Box 1 : Plateformes -->
          <div class="filter-box reveal">
            <div class="filter-box-header">
              <div class="filter-box-title">🖥 Plateformes</div>
              <div class="toggle-all-row">
                <button class="btn-toggle-all" data-action="all-on" data-category="platform">All ON</button>
                <button class="btn-toggle-all off" data-action="all-off" data-category="platform">All OFF</button>
              </div>
            </div>
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
            <div class="filter-box-header">
              <div class="filter-box-title">🕹 Modes de jeu</div>
              <div class="toggle-all-row">
                <button class="btn-toggle-all" data-action="all-on" data-category="mode">All ON</button>
                <button class="btn-toggle-all off" data-action="all-off" data-category="mode">All OFF</button>
              </div>
            </div>
            <div class="toggle-grid" id="modes-grid">${modesHTML}</div>
          </div>

          <!-- Box 4 : Genres -->
          <div class="filter-box wide reveal">
            <div class="filter-box-header">
              <div class="filter-box-title">🎭 Genres</div>
              <div class="toggle-all-row">
                <button class="btn-toggle-all" data-action="all-on" data-category="genre">All ON</button>
                <button class="btn-toggle-all off" data-action="all-off" data-category="genre">All OFF</button>
              </div>
            </div>
            <div class="toggle-grid" id="genres-grid">${genresHTML}</div>
          </div>

          <!-- Box 5 : Thèmes -->
          <div class="filter-box wide reveal">
            <div class="filter-box-header">
              <div class="filter-box-title">🌐 Thèmes</div>
              <div class="toggle-all-row">
                <button class="btn-toggle-all" data-action="all-on" data-category="theme">All ON</button>
                <button class="btn-toggle-all off" data-action="all-off" data-category="theme">All OFF</button>
              </div>
            </div>
            <div class="toggle-grid" id="themes-grid">${themesHTML}</div>
          </div>

          <!-- Box 6 : Score -->
          <div class="filter-box reveal">
            <div class="filter-box-title">⭐ Score</div>
            <div class="range-slider-box">
              <div class="range-slider-container">
                <div class="slider-track">
                  <div class="slider-fill" id="score-slider-fill"
                       style="left:${scoreMin}%;right:${100 - scoreMax}%"></div>
                </div>
                <input type="range" class="range-input" id="range-score-min"
                       min="0" max="100" step="5" value="${scoreMin}" />
                <input type="range" class="range-input" id="range-score-max"
                       min="0" max="100" step="5" value="${scoreMax}" />
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

          <!-- Box 7 : Extra -->
          <div class="filter-box reveal">
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

          <!-- Box 8 : Types de jeux -->
          ${nonZeroGameTypes.length ? `
          <div class="filter-box reveal">
            <div class="filter-box-header">
              <div class="filter-box-title">🏷 Types de jeux</div>
              <div class="toggle-all-row">
                <button class="btn-toggle-all" data-action="all-on" data-category="game-type">All ON</button>
                <button class="btn-toggle-all off" data-action="all-off" data-category="game-type">All OFF</button>
              </div>
            </div>
            <p style="font-size:0.75rem;color:var(--text-muted);margin-bottom:10px">Le type «&nbsp;Jeu principal&nbsp;» (id&nbsp;0) est toujours autorisé.</p>
            <div class="toggle-grid" id="game-types-grid">${gameTypesHTML}</div>
          </div>` : ''}

        </div>

        <div class="filters-launch-area">
          <div class="filters-launch-status" id="filters-status"></div>
          <button class="btn-neon btn-neon-cta" id="btn-launch-roulette">
            🎲 LANCER LA ROULETTE
          </button>
          <button class="btn-save-filter" id="btn-save-filter">💾 Sauvegarder les critères</button>
          <div id="save-filter-form" class="save-filter-form hidden">
            <input type="text" id="save-filter-name" class="save-filter-input"
                   placeholder="Nom du filtre…" maxlength="60" autocomplete="off" />
            <div class="save-filter-actions">
              <button class="btn-neon btn-sm green" id="btn-save-filter-confirm">✓ Valider</button>
              <button class="btn-neon btn-sm" id="btn-save-filter-cancel">✕ Annuler</button>
            </div>
          </div>
        </div>

      </div>
    `;
  }

  /** Génère le HTML d'un bouton toggle. */
  _toggleBtn(id, name, isOn, category, disabled = false) {
    if (disabled) {
      return `<button class="toggle-btn off"
                      data-id="${id}"
                      data-category="${category}"
                      disabled
                      title="Activez le contenu adulte dans Paramètres pour accéder à ce thème">
        <span class="toggle-dot"></span>${this._esc(name)}
      </button>`;
    }
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

    // ── Boutons All ON / All OFF ──────────────────────────────────
    document.querySelectorAll('.btn-toggle-all').forEach(btn => {
      btn.addEventListener('click', () => this._toggleAll(btn.dataset.action, btn.dataset.category));
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

    // ── Score slider ──────────────────────────────────────────────
    const scoreRangeMin = document.getElementById('range-score-min');
    const scoreRangeMax = document.getElementById('range-score-max');
    const scoreFill     = document.getElementById('score-slider-fill');
    const scoreLabel    = document.getElementById('score-range-label');

    const updateScoreSlider = () => {
      let lo = parseInt(scoreRangeMin.value);
      let hi = parseInt(scoreRangeMax.value);
      if (lo > hi) { scoreRangeMin.value = hi; lo = hi; }
      if (hi < lo) { scoreRangeMax.value = lo; hi = lo; }
      scoreFill.style.left  = lo + '%';
      scoreFill.style.right = (100 - hi) + '%';
      scoreLabel.textContent = `${lo} — ${hi}`;
      this.state.scoreMin = lo;
      this.state.scoreMax = hi;
      console.log(`[FiltersUI] Plage de score : ${lo} – ${hi}`);
    };

    scoreRangeMin?.addEventListener('input', updateScoreSlider);
    scoreRangeMax?.addEventListener('input', updateScoreSlider);

    // ── Switch : jeux sans note ───────────────────────────────────
    document.getElementById('cb-allow-no-score')?.addEventListener('change', e => {
      this.state.allowNoScore = e.target.checked;
      console.log(`[FiltersUI] Autoriser sans note : ${e.target.checked}`);
    });

    // ── Switch : fangame/mod ──────────────────────────────────────
    document.getElementById('cb-allow-fangame')?.addEventListener('change', e => {
      this.state.allowFangame = e.target.checked;
      console.log(`[FiltersUI] Autoriser fangame/mod : ${e.target.checked}`);
    });

    // ── Switch : uniquement Game Awards ─────────────────────────
    document.getElementById('cb-only-game-awards')?.addEventListener('change', e => {
      this.state.onlyGameAwards = e.target.checked;
      console.log(`[FiltersUI] Uniquement Game Awards : ${e.target.checked}`);
    });

    // ── Bouton Lancer la Roulette ─────────────────────────────────
    document.getElementById('btn-launch-roulette')?.addEventListener('click', () => {
      this._launchRoulette();
    });

    // ── Bouton Charger un filtre ──────────────────────────────────
    document.getElementById('btn-load-filter')?.addEventListener('click', () => {
      this._showLoadFilterPopup();
    });

    // ── Bouton Sauvegarder les critères ───────────────────────────
    document.getElementById('btn-save-filter')?.addEventListener('click', () => {
      this._toggleSaveFilterForm(true);
    });
    document.getElementById('btn-save-filter-cancel')?.addEventListener('click', () => {
      this._toggleSaveFilterForm(false);
    });
    document.getElementById('btn-save-filter-confirm')?.addEventListener('click', () => {
      this._confirmSaveFilter();
    });
    document.getElementById('save-filter-name')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') this._confirmSaveFilter();
      if (e.key === 'Escape') this._toggleSaveFilterForm(false);
    });
  }

  /**
   * Bascule tous les items d'une catégorie ON ou OFF.
   * @param {'all-on'|'all-off'} action
   * @param {string}             category
   */
  _toggleAll(action, category) {
    const isOn = action === 'all-on';
    const btns = document.querySelectorAll(`.toggle-btn[data-category="${category}"]`);

    btns.forEach(btn => {
      if (btn.disabled) return; // Ne jamais toucher les boutons désactivés (ex: Erotic)
      btn.classList.remove('on', 'off');
      btn.classList.add(isOn ? 'on' : 'off');
    });

    switch (category) {
      case 'platform':
        this.state.p = isOn ? this.filterData.platforms.map(p => p.id) : [];
        break;
      case 'mode':
        this.state.m = isOn ? this.filterData.gameModes.map(m => m.id) : [];
        break;
      case 'genre':
        this.state.g = isOn ? this.filterData.genres.map(g => g.id) : [];
        break;
      case 'theme': {
        // Ne jamais inclure le thème Erotic si le contenu adulte est désactivé
        const allowed = this.filterData.themes.filter(
          t => this.allowAdultContent || t.id !== this._eroticThemeId
        );
        this.state.t = isOn ? allowed.map(t => t.id) : [];
        break;
      }
      case 'game-type': {
        const nonZero = (this.filterData.gameTypes || []).filter(t => t.id !== 0);
        this.state.allowedGameTypes = isOn ? nonZero.map(t => t.id) : [];
        break;
      }
    }
    console.log(`[FiltersUI] Toggle All ${action} pour ${category}`);
  }

  /** Bascule un item ON/OFF et met à jour l'état. */
  _toggleItem(btn) {
    const id  = Number(btn.dataset.id);
    const cat = btn.dataset.category;

    let arr;
    switch (cat) {
      case 'platform':  arr = this.state.p; break;
      case 'mode':      arr = this.state.m; break;
      case 'genre':     arr = this.state.g; break;
      case 'theme':     arr = this.state.t; break;
      case 'game-type': arr = this.state.allowedGameTypes; break;
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
      case 'platform':  this.state.p = updated; break;
      case 'mode':      this.state.m = updated; break;
      case 'genre':     this.state.g = updated; break;
      case 'theme':     this.state.t = updated; break;
      case 'game-type': this.state.allowedGameTypes = updated; break;
    }
    console.log(`[FiltersUI] Toggle ${cat} id=${id} → ${set.has(id) ? 'ON' : 'OFF'}`);
  }

  // ─────────────────────────────────────────────────────────────────
  // SAUVEGARDE / CHARGEMENT DE FILTRES
  // ─────────────────────────────────────────────────────────────────

  _toggleSaveFilterForm(show) {
    const form    = document.getElementById('save-filter-form');
    const btnSave = document.getElementById('btn-save-filter');
    if (!form) return;
    if (show) {
      form.classList.remove('hidden');
      btnSave?.classList.add('hidden');
      const input = document.getElementById('save-filter-name');
      if (input) { input.value = ''; input.focus(); }
    } else {
      form.classList.add('hidden');
      btnSave?.classList.remove('hidden');
    }
  }

  async _confirmSaveFilter() {
    if (!this.userProfile) return;
    const input = document.getElementById('save-filter-name');
    const name  = input?.value?.trim();
    if (!name) { input?.focus(); return; }
    try {
      const stateToSave = { ...this.state };
      console.log(`[FiltersUI] 💾 Sauvegarde du filtre « ${name} » :`, JSON.stringify(stateToSave));
      await this.userProfile.saveFilter(name, stateToSave);
      this._toggleSaveFilterForm(false);
      this._showToast(`Filtre « ${name} » sauvegardé.`);
      console.log(`[FiltersUI] ✅ Filtre « ${name} » sauvegardé avec succès.`);
    } catch (e) {
      console.error('[FiltersUI] Erreur sauvegarde filtre :', e);
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
        : filters.map((f, i) => `
            <div class="saved-filter-row" data-index="${i}">
              <span class="saved-filter-name">${this._esc(f.name)}</span>
              <div class="saved-filter-actions">
                <button class="btn-neon btn-sm green btn-load-saved" data-index="${i}">Charger</button>
                <button class="btn-neon btn-sm magenta btn-delete-saved" data-index="${i}">Supprimer</button>
              </div>
            </div>`
          ).join('');

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
          const idx   = Number(btn.dataset.index);
          const saved = filters[idx];
          if (!saved) return;
          console.log(`[FiltersUI] 📂 Chargement du filtre « ${saved.name} » :`, JSON.stringify(saved.state));
          const encoded = this.filtersBusiness.encodeSettings(saved.state);
          console.log(`[FiltersUI] 📂 Encodé en preSettings : ${encoded}`);
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
    }, 2500);
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
        const ids = this.filtersBusiness.runQuery({ ...this.state, allowAdultContent: this.allowAdultContent });

        if (ids.length === 0) {
          console.log('[FiltersUI] Aucun résultat');
          if (statusEl) statusEl.textContent = '';
          if (btnEl) { btnEl.disabled = false; btnEl.style.opacity = '1'; }
          this._showNoResultsPopup();
          return;
        }

        const encoded = this.filtersBusiness.encodeSettings(this.state);
        console.log(`[FiltersUI] ${ids.length} jeux trouvés, navigation vers la roulette`);
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
