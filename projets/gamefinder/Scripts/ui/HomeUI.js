/**
 * HomeUI.js
 * Page d'accueil : bouton CTA Roulette + barre de recherche.
 */

class HomeUI {
  /**
   * @param {Router}    router
   * @param {SearchUI}  searchUI
   */
  constructor(router, searchUI) {
    this.router   = router;
    this.searchUI = searchUI;
  }

  render(container) {
    console.log('[HomeUI] Rendu de l\'accueil');
    container.innerHTML = `
      <div id="home-view">
        <div>
          <div class="hero-title">GAMEFINDER</div>
          <div class="hero-subtitle">// Trouver votre prochain coup de coeure</div>
        </div>

        <div class="cta-area">
          <button class="btn-neon btn-neon-cta" id="btn-cta-roulette">
            ▶ LANCER LA ROULETTE
          </button>

          ${this.searchUI.getHTML()}
        </div>
      </div>
    `;

    // Attacher les événements de la recherche
    this.searchUI.bind();

    document.getElementById('btn-cta-roulette')?.addEventListener('click', () => {
      console.log('[HomeUI] CTA Roulette cliqué');
      this.router.navigate('app.html?state=filters');
    });
  }
}

window.HomeUI = HomeUI;
