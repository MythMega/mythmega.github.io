/**
 * ProfileUI.js
 * Page profil utilisateur (app.html?state=profile).
 *
 * Affiche :
 *  - Carte identité (avatar + pseudo + badge niveau)
 *  - Barre XP / niveau
 *  - Boutons "À faire" et "Masqués" avec liste inline searchable + paginée
 */

class ProfileUI {
  /**
   * @param {UserProfile}  userProfile
   * @param {GameBusiness} gameBusiness
   * @param {Router}       router
   */
  constructor(userProfile, gameBusiness, router) {
    this.userProfile  = userProfile;
    this.gameBusiness = gameBusiness;
    this.router       = router;
  }

  async render(container) {
    const [username, xp, todoIds, hiddenIds] = await Promise.all([
      this.userProfile.getUsername(),
      this.userProfile.getXP(),
      this.userProfile.getTodoList(),
      this.userProfile.getHiddenList(),
    ]);

    const { level, xpInCurrentLevel, xpRequiredForNext } = UserProfile.calcLevel(xp);
    const pct = Math.min(100, Math.round((xpInCurrentLevel / xpRequiredForNext) * 100));

    // Copies mutables pour la gestion des listes
    const todoList   = todoIds.slice();
    const hiddenList = hiddenIds.slice();

    container.innerHTML = `
      <div id="page-view" class="profile-page">
        <div class="page-title reveal">👤 PROFIL</div>
        <hr class="neon-divider" />

        <div class="profile-sections">

          <!-- Carte identité -->
          <div class="filter-box reveal profile-card">
            <div class="profile-avatar">🎮</div>
            <div class="profile-username">${this._esc(username)}</div>
            <div class="profile-level-badge">NV. ${level}</div>
          </div>

          <!-- XP & Niveau -->
          <div class="filter-box reveal profile-xp-box">
            <div class="filter-box-title">⚡ EXPÉRIENCE</div>
            <div class="profile-xp-total">${xp.toLocaleString('fr-FR')} XP</div>
            <div class="profile-level-info">
              Niveau <strong>${level}</strong>
              — <span class="profile-xp-fraction">${xpInCurrentLevel} / ${xpRequiredForNext} XP</span>
              vers le niveau <strong>${level + 1}</strong>
            </div>
            <div class="profile-progress-wrapper">
              <div class="profile-progress-bar" style="width:${pct}%"></div>
            </div>
            <p class="filter-note" style="margin-top:8px">
              Encore <strong>${xpRequiredForNext - xpInCurrentLevel} XP</strong>
              pour atteindre le niveau ${level + 1}.
            </p>
          </div>

          <!-- Listes -->
          <div class="filter-box reveal">
            <div class="filter-box-title">📋 MES LISTES</div>
            <div class="profile-lists-btns">
              <button class="btn-neon green" id="btn-show-todo">
                ✅ À faire <span class="profile-list-count">${todoList.length}</span>
              </button>
              <button class="btn-neon magenta" id="btn-show-hidden">
                🚫 Masqués <span class="profile-list-count">${hiddenList.length}</span>
              </button>
            </div>
          </div>

        </div>

        <!-- Zone d'affichage de liste inline -->
        <div id="profile-list-view"></div>

      </div>
    `;

    container.querySelector('#btn-show-todo')?.addEventListener('click', () => {
      this._renderListSection('todo', todoList, container);
    });
    container.querySelector('#btn-show-hidden')?.addEventListener('click', () => {
      this._renderListSection('hidden', hiddenList, container);
    });

    this._activateReveal();
  }

  // ─────────────────────────────────────────────────────────────────
  // LISTE INLINE
  // ─────────────────────────────────────────────────────────────────

  _renderListSection(type, masterIds, pageContainer) {
    const listView = pageContainer.querySelector('#profile-list-view');
    if (!listView) return;
    this._renderListPage(type, masterIds, masterIds.slice(), 1, '', listView, pageContainer);
    setTimeout(() => listView.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }

  _renderListPage(type, masterIds, filtered, page, query, listView, pageContainer) {
    const PAGE_SIZE  = 10;
    const title      = type === 'todo' ? '✅ Jeux à faire' : '🚫 Jeux masqués';
    const start      = (page - 1) * PAGE_SIZE;
    const pageIds    = filtered.slice(start, start + PAGE_SIZE);
    const totalPages = Math.ceil(filtered.length / PAGE_SIZE) || 1;

    const itemsHTML = pageIds.length
      ? pageIds.map(id => {
          const game  = this.gameBusiness.getById(id);
          const name  = game ? this._esc(game.name) : `Jeu #${id}`;
          const year  = game?.releaseYear ? ` (${game.releaseYear})` : '';
          const cover = game?.cover_url
            ? `<img src="${this._esc(game.cover_url)}" alt="${name}" class="profile-list-cover" />`
            : `<div class="profile-list-cover profile-list-cover-empty">🎮</div>`;
          return `
            <div class="profile-list-item" data-id="${id}">
              ${cover}
              <div class="profile-list-info">
                <span class="profile-list-name">${name}${year}</span>
              </div>
              <div class="profile-list-actions">
                <button class="btn-neon" style="padding:6px 14px;font-size:0.73rem"
                        data-action="detail" data-id="${id}">Détail ↗</button>
                <button class="btn-neon magenta" style="padding:6px 14px;font-size:0.73rem"
                        data-action="remove" data-id="${id}">✕ Retirer</button>
              </div>
            </div>`;
        }).join('')
      : `<p style="color:var(--text-muted);padding:16px 0">Aucun jeu trouvé.</p>`;

    const paginHTML = totalPages > 1 ? `
      <div class="profile-pagination">
        <button class="btn-neon" id="btn-list-prev"
                style="padding:7px 16px" ${page <= 1 ? 'disabled' : ''}>← Préc.</button>
        <span class="profile-page-info">Page ${page} / ${totalPages}</span>
        <button class="btn-neon" id="btn-list-next"
                style="padding:7px 16px" ${page >= totalPages ? 'disabled' : ''}>Suiv. →</button>
      </div>` : '';

    listView.innerHTML = `
      <div class="filter-box profile-list-box">
        <div class="filter-box-title">${title}
          — ${filtered.length} jeu${filtered.length !== 1 ? 'x' : ''}</div>
        <div class="profile-list-search-row">
          <input type="text" id="profile-list-search" class="search-input"
                 placeholder="Rechercher dans la liste…"
                 value="${this._esc(query)}"
                 style="max-width:420px;padding:10px 18px;margin:0" />
        </div>
        <div class="profile-list-items">${itemsHTML}</div>
        ${paginHTML}
      </div>`;

    // Recherche live
    listView.querySelector('#profile-list-search')?.addEventListener('input', e => {
      const q       = e.target.value;
      const lower   = q.toLowerCase();
      const newFilt = masterIds.filter(id => {
        const game = this.gameBusiness.getById(id);
        return game
          ? game.name.toLowerCase().includes(lower)
          : `jeu #${id}`.includes(lower);
      });
      this._renderListPage(type, masterIds, newFilt, 1, q, listView, pageContainer);
    });

    // Pagination
    listView.querySelector('#btn-list-prev')?.addEventListener('click', () => {
      this._renderListPage(type, masterIds, filtered, page - 1, query, listView, pageContainer);
      listView.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    listView.querySelector('#btn-list-next')?.addEventListener('click', () => {
      this._renderListPage(type, masterIds, filtered, page + 1, query, listView, pageContainer);
      listView.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // Actions par item
    listView.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id     = Number(btn.dataset.id);
        const action = btn.dataset.action;

        if (action === 'detail') {
          this.router.navigate(`app.html?game=${id}`);
          return;
        }

        if (action === 'remove') {
          // Animation de retrait
          const item = listView.querySelector(`.profile-list-item[data-id="${id}"]`);
          if (item) {
            item.classList.add('profile-list-item-out');
            await new Promise(r => setTimeout(r, 380));
          }

          if (type === 'todo') {
            await this.userProfile.removeFromTodo(id);
          } else {
            await this.userProfile.removeFromHidden(id);
          }

          const mIdx = masterIds.indexOf(id);
          if (mIdx > -1) masterIds.splice(mIdx, 1);

          const newFiltered = filtered.filter(fid => fid !== id);
          const newPage     = Math.min(page, Math.ceil(newFiltered.length / PAGE_SIZE) || 1);
          this._renderListPage(type, masterIds, newFiltered, newPage, query, listView, pageContainer);

          // Mettre à jour le compteur sur le bouton du profil
          const btnKey   = type === 'todo' ? '#btn-show-todo' : '#btn-show-hidden';
          const badge    = pageContainer.querySelector(`${btnKey} .profile-list-count`);
          if (badge) badge.textContent = masterIds.length;
        }
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────

  _activateReveal() {
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); }
      });
    }, { threshold: 0.1 });
    document.querySelectorAll('.reveal').forEach(el => obs.observe(el));
  }

  _esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

window.ProfileUI = ProfileUI;
