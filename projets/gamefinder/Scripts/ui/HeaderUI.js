/**
 * HeaderUI.js
 * Construction et gestion de l'en-tête de l'application.
 * Contient : Logo, bouton Accueil, bouton Roulette, dropdown Données.
 */

class HeaderUI {
  /**
   * @param {Router}       router
   * @param {ListBusiness} listBusiness
   */
  constructor(router, listBusiness) {
    this.router       = router;
    this.listBusiness = listBusiness;
  }

  /** Injecte le header dans #app-header. */
  render() {
    const header = document.getElementById('app-header');
    if (!header) return;

    const types = ListBusiness.availableTypes();
    const dropdownItems = types
      .map(t => `<div class="dropdown-item" data-list="${t.key}">${t.label}</div>`)
      .join('');

    header.innerHTML = `
      <span class="header-logo" id="btn-home-logo">GF <span style="color:var(--neon-magenta)">2.0</span></span>
      <button class="btn-neon" id="btn-home"><img class="header-btn-icon" src="assets/home.png" alt="Accueil" /><span class="header-btn-label">Accueil</span></button>
      <button class="btn-neon magenta" id="btn-roulette"><img class="header-btn-icon" src="assets/roulette.png" alt="Roulette" /><span class="header-btn-label">Roulette</span></button>
      <div class="header-dropdown" id="dropdown-donnees">
        <button class="btn-neon purple"><img class="header-btn-icon" src="assets/database.png" alt="Données" /><span class="header-btn-label">Données ▾</span></button>
        <div class="dropdown-menu" id="dropdown-menu-donnees">
          ${dropdownItems}
        </div>
      </div>
      <button class="btn-neon" id="btn-settings" title="Paramètres"><img class="header-btn-icon" src="assets/settings.png" alt="Paramètres" /><span class="header-btn-label">Paramètres</span></button>
    `;

    this._bindEvents();
    console.log('[HeaderUI] Header rendu');
  }

  /** Met à jour l'état actif des boutons selon la route courante. */
  update(route) {
    // Optionnel : mettre en évidence le bouton actif
  }

  _bindEvents() {
    document.getElementById('btn-home')?.addEventListener('click', () => {
      console.log('[HeaderUI] Clic Accueil');
      this.router.navigate('app.html');
    });
    document.getElementById('btn-home-logo')?.addEventListener('click', () => {
      this.router.navigate('app.html');
    });
    document.getElementById('btn-roulette')?.addEventListener('click', () => {
      console.log('[HeaderUI] Clic Roulette');
      this.router.navigate('app.html?state=filters');
    });
    document.getElementById('btn-settings')?.addEventListener('click', () => {
      console.log('[HeaderUI] Clic Paramètres');
      this.router.navigate('app.html?state=settings');
    });

    // Dropdown Données
    const menu = document.getElementById('dropdown-menu-donnees');
    if (menu) {
      menu.querySelectorAll('.dropdown-item').forEach(item => {
        item.addEventListener('click', () => {
          const listType = item.dataset.list;
          console.log('[HeaderUI] Données sélectionné :', listType);
          this.router.navigate(`app.html?list=${listType}&page=1`);
          document.getElementById('dropdown-donnees')?.classList.remove('open');
        });
      });
    }

    // Toggle dropdown au clic sur mobile
    document.getElementById('dropdown-donnees')?.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') {
        document.getElementById('dropdown-donnees')?.classList.toggle('open');
      }
    });

    // Fermer le dropdown si clic ailleurs
    document.addEventListener('click', (e) => {
      const dd = document.getElementById('dropdown-donnees');
      if (dd && !dd.contains(e.target)) {
        dd.classList.remove('open');
      }
    });
  }
}

window.HeaderUI = HeaderUI;
