/* ============================================
   KOKORO PROJECT — Shared nav & footer
   ============================================ */
(function () {
  /* Detect if we're one level deep (collection/ subfolder) */
  const inSubdir = window.location.pathname.includes('/collection/');
  const base = inSubdir ? '../' : '';

  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  const isCollectionPage = inSubdir;

  const navLinks = [
    { href: `${base}index.html`,           label: 'Accueil' },
    { href: `${base}collections.html`,     label: 'Nos Decks' },
    { href: `${base}produits.html`,        label: 'Nos Produits' },
    { href: `${base}notre-histoire.html`,  label: 'Notre Histoire' },
    { href: `${base}nos-actions.html`,     label: 'Nos Actions' },
  ];

  function buildNav() {
    const linksHTML = navLinks.map(l => {
      const isActive = currentPage === l.href.split('/').pop();
      return `<a href="${l.href}" class="nav__link${isActive ? ' active' : ''}">${l.label}</a>`;
    }).join('');

    /* Collections dropdown */
    const dropdownHTML = `
      <div class="nav__dropdown-wrap">
        <span class="nav__link nav__dropdown-trigger${isCollectionPage ? ' active' : ''}">
          Collections
          <i class="nav__dropdown-arrow"></i>
        </span>
        <div class="nav__dropdown-menu">
          <a href="${base}collection/kitei.html" class="nav__dropdown-item">
            <span class="nav__dropdown-dot" style="background:#c9a227;"></span>Kitei
          </a>
          <a href="${base}collection/kintsugi.html" class="nav__dropdown-item">
            <span class="nav__dropdown-dot" style="background:#1d1d1f;border:1px solid #c9a227;"></span>Kintsugi
          </a>
        </div>
      </div>
    `;

    const mobileLinksHTML = navLinks.map(l =>
      `<a href="${l.href}" class="mobile-menu__link">${l.label}</a>`
    ).join('') + `
      <p class="mobile-menu__sublabel">Collections</p>
      <a href="${base}collection/kitei.html" class="mobile-menu__link mobile-menu__sublink">Kitei</a>
      <a href="${base}collection/kintsugi.html" class="mobile-menu__link mobile-menu__sublink">Kintsugi</a>
    `;

    const navEl = document.getElementById('app-nav');
    if (navEl) {
      navEl.innerHTML = `
        <nav class="nav">
          <div class="nav__inner">
            <div class="nav__links">${linksHTML}${dropdownHTML}</div>
            <a href="${base}index.html" class="nav__logo">
              <img src="${base}assets/images/logo-noir.svg" alt="Kokoro Project" />
            </a>
            <div class="nav__actions">
              <svg class="nav__cart-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
                <line x1="3" y1="6" x2="21" y2="6"/>
                <path d="M16 10a4 4 0 0 1-8 0"/>
              </svg>
              <button class="nav__hamburger" aria-label="Menu">
                <span></span><span></span><span></span>
              </button>
            </div>
          </div>
        </nav>

        <div class="mobile-menu">
          <button class="mobile-menu__close" aria-label="Fermer">&#x2715;</button>
          ${mobileLinksHTML}
        </div>
      `;
    }
  }

  function buildFooter() {
    const footerEl = document.getElementById('app-footer');
    if (footerEl) {
      footerEl.innerHTML = `
        <footer class="footer">
          <div class="container">
            <div class="footer__grid">
              <div>
                <img src="${base}assets/images/logo-noir.svg" alt="Kokoro Project" class="footer__logo" />
                <p class="footer__desc">Kokoro est une marque de skateboard éthique et artistique, fabriquée en Europe. Planches en érable FSC, design original, projet indépendant.</p>
              </div>
              <div>
                <p class="footer__col-title">Navigation</p>
                <div class="footer__links">
                  <a href="${base}index.html" class="footer__link">Accueil</a>
                  <a href="${base}collections.html" class="footer__link">Nos Decks</a>
                  <a href="${base}produits.html" class="footer__link">Nos Produits</a>
                  <a href="${base}notre-histoire.html" class="footer__link">Notre Histoire</a>
                  <a href="${base}nos-actions.html" class="footer__link">Nos Actions</a>
                </div>
              </div>
              <div>
                <p class="footer__col-title">Collections</p>
                <div class="footer__links">
                  <a href="${base}collection/kitei.html" class="footer__link">Kitei</a>
                  <a href="${base}collection/kintsugi.html" class="footer__link">Kintsugi</a>
                </div>
              </div>
              <div>
                <p class="footer__col-title">Légal</p>
                <div class="footer__links">
                  <a href="#" class="footer__link">Mentions légales</a>
                  <a href="#" class="footer__link">Politique de confidentialité</a>
                  <a href="#" class="footer__link">CGV</a>
                </div>
              </div>
            </div>
            <div class="footer__bottom">
              <span>© 2025 Kokoro Project. Tous droits réservés.</span>
              <span>Fabriqué avec ♥ en Europe</span>
            </div>
          </div>
        </footer>
      `;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    buildNav();
    buildFooter();
  });
})();

