/**
 * Renders the common navigation bar with responsive hamburger menu
 * and a "Dataset" dropdown submenu
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

            // Helper to close mobile menu
            const closeMobile = () => {
                const linksEl = document.getElementById('nav-links');
                const hamburger = document.getElementById('hamburger-btn');
                if (linksEl) linksEl.classList.remove('open');
                if (hamburger) hamburger.classList.remove('active');
            };

            // Simple page links
            const simplePages = [
                { href: 'index.html', i18n: 'nav.home' },
                { href: 'create_bingo.html', i18n: 'nav.create' }
            ];

            simplePages.forEach(page => {
                const a = document.createElement('a');
                a.href = page.href;
                a.setAttribute('data-i18n', page.i18n);
                a.className = currentPath === page.href ? 'nav-link active' : 'nav-link';
                a.addEventListener('click', closeMobile);
                links.appendChild(a);
            });

            // --- Dataset dropdown ---
            const ddWrapper = document.createElement('div');
            ddWrapper.className = 'nav-dropdown-wrapper';

            const ddToggle = document.createElement('button');
            ddToggle.type = 'button';
            ddToggle.className = 'nav-dropdown-toggle';
            ddToggle.setAttribute('data-i18n', 'nav.datasets');
            ddToggle.textContent = 'Datasets';
            // Highlight if either dataset page is active
            if (currentPath === 'dataset.html' || currentPath === 'creator.html') {
                ddToggle.classList.add('active');
            }

            const ddMenu = document.createElement('div');
            ddMenu.className = 'nav-dropdown-menu';

            const ddItems = [
                { href: 'dataset.html', i18n: 'nav.dataset_viewer' },
                { href: 'creator.html', i18n: 'nav.dataset_maker' }
            ];

            ddItems.forEach(item => {
                const a = document.createElement('a');
                a.href = item.href;
                a.className = 'nav-dropdown-item';
                a.setAttribute('data-i18n', item.i18n);
                a.addEventListener('click', closeMobile);
                if (currentPath === item.href) {
                    a.classList.add('active');
                }
                ddMenu.appendChild(a);
            });

            ddWrapper.appendChild(ddToggle);
            ddWrapper.appendChild(ddMenu);
            links.appendChild(ddWrapper);

            // Toggle dropdown on click
            ddToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                ddMenu.classList.toggle('open');
            });

            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (!ddWrapper.contains(e.target)) {
                    ddMenu.classList.remove('open');
                }
            });

            // Remaining simple links
            const remainingPages = [
                { href: 'credits.html', i18n: 'nav.credits' },
                { href: 'changelog.html', i18n: 'nav.changelog' }
            ];

            remainingPages.forEach(page => {
                const a = document.createElement('a');
                a.href = page.href;
                a.setAttribute('data-i18n', page.i18n);
                a.className = currentPath === page.href ? 'nav-link active' : 'nav-link';
                a.addEventListener('click', closeMobile);
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
                // Close dropdown when closing mobile menu
                if (!links.classList.contains('open')) {
                    ddMenu.classList.remove('open');
                }
            });

            // Close menu when clicking outside
            document.addEventListener('click', (e) => {
                if (!nav.contains(e.target) && links.classList.contains('open')) {
                    links.classList.remove('open');
                    hamburger.classList.remove('active');
                    ddMenu.classList.remove('open');
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