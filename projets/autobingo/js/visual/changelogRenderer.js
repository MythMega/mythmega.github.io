/**
 * Renders the changelog page with comma-separated descriptions split into bullet points
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
                badge.className = 'changelog-badge ' + this._getBadgeClass(entry.number);
                badge.textContent = `v${entry.number}`;
                header.appendChild(badge);

                const title = document.createElement('h3');
                title.className = 'changelog-name';
                title.setAttribute('data-i18n-raw', entry.nameEn);
                title.textContent = entry.nameEn;
                header.appendChild(title);

                card.appendChild(header);

                // Description list (split by comma)
                const descList = document.createElement('ul');
                descList.className = 'changelog-desc-list';
                descList.setAttribute('data-i18n-raw-desc', entry.descEn);
                const items = this._splitDesc(entry.descEn);
                items.forEach(item => {
                    const li = document.createElement('li');
                    li.textContent = item;
                    if (this._isGameItem(item)) {
                        li.classList.add('changelog-game-item');
                    }
                    descList.appendChild(li);
                });
                card.appendChild(descList);

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
         * Get the CSS class for the badge based on version number content
         * @param {string} number - Version number (e.g. "Alpha a0.1", "Beta 1.0", "Release 2.0")
         * @returns {string}
         */
        _getBadgeClass(number) {
            if (!number) return 'badge-gray';
            const lower = number.toLowerCase();
            if (lower.includes('alpha')) return 'badge-blue';
            if (lower.includes('beta')) return 'badge-red';
            if (lower.includes('release') || lower.includes('rc') || lower.includes('stable')) return 'badge-green';
            return 'badge-gray';
        },

        /**
         * Split a description string by commas, trim each part, capitalize first letter
         * @param {string} text
         * @returns {string[]}
         */
        _splitDesc(text) {
            if (!text) return [];
            return text.split(',').map(part => {
                part = part.trim();
                if (part.length > 0) {
                    part = part.charAt(0).toUpperCase() + part.slice(1);
                }
                return part;
            }).filter(p => p.length > 0);
        },

        /**
         * Check if an item text contains "Jeu" or "Game"
         * @param {string} text
         * @returns {boolean}
         */
        _isGameItem(text) {
            if (!text) return false;
            const lower = text.toLowerCase();
            return lower.includes('jeu') || lower.includes('game');
        },

        /**
         * Update description list from comma-separated text
         * @param {HTMLElement} listEl
         * @param {string} text
         */
        _updateDescList(listEl, text) {
            const items = this._splitDesc(text);
            listEl.innerHTML = '';
            items.forEach(item => {
                const li = document.createElement('li');
                li.textContent = item;
                if (this._isGameItem(item)) {
                    li.classList.add('changelog-game-item');
                }
                listEl.appendChild(li);
            });
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
                const descList = card.querySelector('.changelog-desc-list');

                if (lang === 'fr') {
                    if (nameEl && entry.nameFr) nameEl.textContent = entry.nameFr;
                    if (descList && entry.descFr) {
                        this._updateDescList(descList, entry.descFr);
                    }
                } else {
                    if (nameEl && entry.nameEn) nameEl.textContent = entry.nameEn;
                    if (descList && entry.descEn) {
                        this._updateDescList(descList, entry.descEn);
                    }
                }
            });
        }
    };

    autobingo.ChangelogRenderer = ChangelogRenderer;

})(window.AutoBingo = window.AutoBingo || {});