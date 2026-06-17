/**
 * Renders the common navigation bar with responsive hamburger menu
 * AutoBingo.NavRenderer
 */
(function(autobingo) {
    'use strict';

    const NavRenderer = {
        /**
         * Render the navigation bar into a container element
         * @param {HTMLElement} container - The container to render into
         */
        render(container) {
            const currentPath = window.location.pathname.split('/').pop() || 'index.html';

            const nav = document.createElement('nav');
            nav.className = 'nav-bar';

            const brand = document.createElement('span');
            brand.className = 'nav-brand';
            brand.textContent = 'AutoBingo';
            brand.addEventListener('click', () => {
                window.location.href = 'index.html';
            });

            const links = document.createElement('div');
            links.className = 'nav-links';
            links.id = 'nav-links';

            const pages = [
                { href: 'index.html', i18n: 'nav.home' },
                { href: 'create_bingo.html', i18n: 'nav.create' },
                { href: 'dataset.html', i18n: 'nav.datasets' },
                { href: 'credits.html', i18n: 'nav.credits' },
                { href: 'changelog.html', i18n: 'nav.changelog' }
            ];

            pages.forEach(page => {
                const a = document.createElement('a');
                a.href = page.href;
                a.setAttribute('data-i18n', page.i18n);
                a.className = currentPath === page.href ? 'nav-link active' : 'nav-link';
                a.addEventListener('click', () => {
                    // Close mobile menu on click
                    const linksEl = document.getElementById('nav-links');
                    const hamburger = document.getElementById('hamburger-btn');
                    if (linksEl) linksEl.classList.remove('open');
                    if (hamburger) hamburger.classList.remove('active');
                });
                links.appendChild(a);
            });

            // Hamburger button
            const hamburger = document.createElement('button');
            hamburger.className = 'hamburger-btn';
            hamburger.id = 'hamburger-btn';
            hamburger.setAttribute('aria-label', 'Menu');
            for (let i = 0; i < 3; i++) {
                const span = document.createElement('span');
                hamburger.appendChild(span);
            }
            hamburger.addEventListener('click', () => {
                links.classList.toggle('open');
                hamburger.classList.toggle('active');
            });

            // Close menu when clicking outside
            document.addEventListener('click', (e) => {
                if (!nav.contains(e.target) && links.classList.contains('open')) {
                    links.classList.remove('open');
                    hamburger.classList.remove('active');
                }
            });

            nav.appendChild(brand);
            nav.appendChild(hamburger);
            nav.appendChild(links);
            container.appendChild(nav);

            // Translate nav links
            if (autobingo.translationManager) {
                autobingo.translationManager.translatePage();
            }
        }
    };

    autobingo.NavRenderer = NavRenderer;

})(window.AutoBingo = window.AutoBingo || {});