/**
 * Renders the changelog page
 * AutoBingo.ChangelogRenderer
 */
(function(autobingo) {
    'use strict';

    const ChangelogRenderer = {
        /**
         * Render changelog entries into a container
         * @param {HTMLElement} container
         * @param {Array} entries - Array of ChangelogEntry, sorted desc by ID
         */
        render(container, entries) {
            container.innerHTML = '';

            entries.forEach(entry => {
                const card = document.createElement('div');
                card.className = 'changelog-card';

                const header = document.createElement('div');
                header.className = 'changelog-header';

                const badge = document.createElement('span');
                badge.className = 'changelog-badge';
                badge.textContent = `v${entry.number}`;
                header.appendChild(badge);

                const title = document.createElement('h3');
                title.className = 'changelog-name';
                title.setAttribute('data-i18n-raw', entry.nameEn);
                title.textContent = entry.nameEn;
                header.appendChild(title);

                card.appendChild(header);

                const desc = document.createElement('p');
                desc.className = 'changelog-desc';
                desc.setAttribute('data-i18n-raw', entry.descEn);
                desc.textContent = entry.descEn;
                card.appendChild(desc);

                if (entry.link) {
                    const link = document.createElement('a');
                    link.href = entry.link;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    link.className = 'changelog-link';
                    link.setAttribute('data-i18n', 'changelog.view_commit');
                    link.textContent = 'View Commit';
                    card.appendChild(link);
                }

                container.appendChild(card);
            });

            // Translate dynamic content if translation manager is available
            if (autobingo.translationManager) {
                this._translateDynamic(entries);
            }
        },

        /**
         * Translate dynamic content (names, descriptions) based on current language
         * @param {Array} entries
         */
        _translateDynamic(entries) {
            const lang = autobingo.translationManager.currentLang;
            const cards = document.querySelectorAll('.changelog-card');

            cards.forEach((card, i) => {
                if (i >= entries.length) return;
                const entry = entries[i];

                const nameEl = card.querySelector('.changelog-name');
                const descEl = card.querySelector('.changelog-desc');

                if (lang === 'fr') {
                    if (nameEl && entry.nameFr) nameEl.textContent = entry.nameFr;
                    if (descEl && entry.descFr) descEl.textContent = entry.descFr;
                } else {
                    if (nameEl && entry.nameEn) nameEl.textContent = entry.nameEn;
                    if (descEl && entry.descEn) descEl.textContent = entry.descEn;
                }
            });
        }
    };

    autobingo.ChangelogRenderer = ChangelogRenderer;

})(window.AutoBingo = window.AutoBingo || {});