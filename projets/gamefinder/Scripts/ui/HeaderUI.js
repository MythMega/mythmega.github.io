/**
 * HeaderUI.js
 * Construction et gestion de l'en-tête de l'application.
 * Boutons icônes : Accueil, Roulette, Données (dropdown), Paramètres, Profil.
 */

class HeaderUI {
  /** Icônes SVG inline (stroke = currentColor). */
  static ICONS = {
    home: `<path d="M3 11.2 12 4l9 7.2" /><path d="M5.5 9.8V20h13V9.8" /><path d="M10 20v-5h4v5" />`,
    dice: `<rect x="4" y="4" width="16" height="16" rx="3" />
           <circle cx="9" cy="9" r="1.15" fill="currentColor" stroke="none" />
           <circle cx="15" cy="9" r="1.15" fill="currentColor" stroke="none" />
           <circle cx="9" cy="15" r="1.15" fill="currentColor" stroke="none" />
           <circle cx="15" cy="15" r="1.15" fill="currentColor" stroke="none" />`,
    database: `<ellipse cx="12" cy="6" rx="7" ry="3" />
               <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
               <path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />`,
    settings: `<circle cx="12" cy="12" r="3" />
               <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />`,
    profile: `<circle cx="12" cy="8" r="3.5" /><path d="M5 21c0-3.9 3.1-7 7-7s7 3.1 7 7" />`,
  };

  /**
   * @param {Router}       router
   * @param {ListBusiness} listBusiness
   */
  constructor(router, listBusiness) {
    this.router       = router;
    this.listBusiness = listBusiness;
  }

  /** Bouton icône (texte accessible uniquement). */
  _iconButton({ id, icon, label, variant = '' }) {
    const cls = `btn-neon header-icon-btn${variant ? ' ' + variant : ''}`;
    return `<button class="${cls}" id="${id}" type="button"
                    aria-label="${label}" title="${label}">
      <svg class="header-btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${HeaderUI.ICONS[icon]}</svg>
    </button>`;
  }

  /** Injecte le header dans #app-header. */
  render() {
    const header = document.getElementById('app-header');
    if (!header) return;

    const types = ListBusiness.availableTypes();
    const dropdownItems = types
      .map(t => `<button class="dropdown-item" type="button" role="menuitem" data-list="${t.key}">${t.label}</button>`)
      .join('');

    header.innerHTML = `
      <span class="header-logo" id="btn-home-logo" title="Accueil">GF <span class="header-logo-version">2.0</span></span>
      ${this._iconButton({ id: 'btn-home', icon: 'home', label: 'Accueil' })}
      ${this._iconButton({ id: 'btn-roulette', icon: 'dice', label: 'Roulette', variant: 'silver' })}
      <div class="header-dropdown" id="dropdown-donnees">
        <button class="btn-neon header-icon-btn jade" id="btn-dropdown-donnees" type="button"
                aria-label="Données" title="Données" aria-haspopup="menu" aria-expanded="false">
          <svg class="header-btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${HeaderUI.ICONS.database}</svg>
        </button>
        <div class="dropdown-menu" id="dropdown-menu-donnees" role="menu" aria-labelledby="btn-dropdown-donnees">
          ${dropdownItems}
        </div>
      </div>
      ${this._iconButton({ id: 'btn-settings', icon: 'settings', label: 'Paramètres' })}
      ${this._iconButton({ id: 'btn-profile', icon: 'profile', label: 'Profil', variant: 'jade' })}
    `;

    this._bindEvents();
    console.log('[HeaderUI] Header rendu (icônes)');
  }

  /** Met à jour l'état actif des boutons selon la route courante. */
  update(route) {
    const map = {
      home: '#btn-home',
      filters: '#btn-roulette',
      roulette: '#btn-roulette',
      settings: '#btn-settings',
      profile: '#btn-profile',
    };
    document.querySelectorAll('#app-header .header-icon-btn').forEach(btn => btn.classList.remove('active'));
    const selector = map[route?.type];
    if (selector) document.querySelector(selector)?.classList.add('active');
  }

  _bindEvents() {
    document.getElementById('btn-home')?.addEventListener('click', () => {
      this.router.navigate('app.html');
    });
    document.getElementById('btn-home-logo')?.addEventListener('click', () => {
      this.router.navigate('app.html');
    });
    document.getElementById('btn-roulette')?.addEventListener('click', () => {
      this.router.navigate('app.html?state=filters');
    });
    document.getElementById('btn-settings')?.addEventListener('click', () => {
      this.router.navigate('app.html?state=settings');
    });
    document.getElementById('btn-profile')?.addEventListener('click', () => {
      this.router.navigate('app.html?state=profile');
    });

    const wrapper = document.getElementById('dropdown-donnees');
    const trigger = document.getElementById('btn-dropdown-donnees');
    const menu    = document.getElementById('dropdown-menu-donnees');

    const setOpen = open => {
      wrapper?.classList.toggle('open', open);
      trigger?.setAttribute('aria-expanded', String(open));
    };

    if (menu) {
      menu.querySelectorAll('.dropdown-item').forEach(item => {
        item.addEventListener('click', () => {
          const listType = item.dataset.list;
          setOpen(false);
          this.router.navigate(`app.html?list=${listType}&page=1`);
        });
      });
    }

    // Ouverture/fermeture au clic sur le bouton déclencheur uniquement
    trigger?.addEventListener('click', e => {
      e.stopPropagation();
      setOpen(!wrapper?.classList.contains('open'));
    });

    // Fermer au clic ailleurs
    document.addEventListener('click', e => {
      if (wrapper && !wrapper.contains(e.target)) setOpen(false);
    });

    // Fermer avec Échap
    wrapper?.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        setOpen(false);
        trigger?.focus();
      }
    });
  }
}

window.HeaderUI = HeaderUI;
