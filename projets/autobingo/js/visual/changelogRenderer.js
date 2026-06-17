/**
 * Renders the changelog page with comma-separated descriptions split into bullet points
 * and relative date display
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

                // Date line
                if (entry.date) {
                    const dateEl = document.createElement('div');
                    dateEl.className = 'changelog-date';
                    const relative = this._getRelativeTime(entry.date);
                    const dateDisplay = this._formatDate(entry.date);
                    dateEl.textContent = `${dateDisplay} (${relative})`;
                    dateEl.dataset.date = entry.date;
                    card.appendChild(dateEl);
                }

                // Description list (split by comma)
                const descList = document.createElement('ul');
                descList.className = 'changelog-desc-list';
                descList.setAttribute('data-i18n-raw-desc', entry.descEn);
                const items = this._splitDesc(entry.descEn);
                items.forEach(item => {
                    const li = document.createElement('li');
                    li.textContent = item.text;
                    if (this._isGameItem(item.original)) {
                        li.classList.add('changelog-game-item');
                    }
                    if (this._isMajorItem(item.original)) {
                        li.classList.add('changelog-major-item');
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
         * Format date yyyy-mm-dd to a display format
         * @param {string} dateStr
         * @returns {string}
         */
        _formatDate(dateStr) {
            if (!dateStr) return '';
            const parts = dateStr.split('-');
            if (parts.length !== 3) return dateStr;
            return `${parts[2]}/${parts[1]}/${parts[0]}`;
        },

        /**
         * Get relative time string from a date
         * @param {string} dateStr - yyyy-mm-dd
         * @returns {string}
         */
        _getRelativeTime(dateStr) {
            if (!dateStr) return '';

            const now = new Date();
            const then = new Date(dateStr + 'T00:00:00');
            const diffMs = now - then;
            
            if (diffMs < 0) return '';

            const lang = autobingo.translationManager ? autobingo.translationManager.currentLang : 'en';

            // Same day
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            if (diffDays === 0) {
                return lang === 'fr' ? "aujourd'hui" : 'today';
            }

            // Same month: show days
            if (now.getFullYear() === then.getFullYear() && now.getMonth() === then.getMonth()) {
                const days = diffDays;
                if (lang === 'fr') {
                    return days > 1 ? `il y a ${days} jours` : 'il y a 1 jour';
                }
                return days > 1 ? `${days} days ago` : '1 day ago';
            }

            // Same year: show months
            if (now.getFullYear() === then.getFullYear()) {
                const months = (now.getMonth() - then.getMonth()) + (now.getDate() < then.getDate() ? -1 : 0);
                const adjusted = Math.max(1, months || (now.getMonth() - then.getMonth()));
                if (lang === 'fr') {
                    return adjusted > 1 ? `il y a ${adjusted} mois` : 'il y a 1 mois';
                }
                return adjusted > 1 ? `${adjusted} months ago` : '1 month ago';
            }

            // Different year: show years
            let years = now.getFullYear() - then.getFullYear();
            if (now.getMonth() < then.getMonth() || (now.getMonth() === then.getMonth() && now.getDate() < then.getDate())) {
                years--;
            }
            const adjustedYears = Math.max(1, years);
            if (lang === 'fr') {
                return adjustedYears > 1 ? `il y a ${adjustedYears} ans` : 'il y a 1 an';
            }
            return adjustedYears > 1 ? `${adjustedYears} years ago` : '1 year ago';
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
         * Split a description string by commas, trim each part, capitalize first letter.
         * Strips [MAJOR] prefix (handled by _isMajorItem).
         * @param {string} text
         * @returns {Array<{text: string, original: string}>}
         */
        _splitDesc(text) {
            if (!text) return [];
            return text.split(',').map(part => {
                const original = part.trim();
                let cleaned = original;
                // Strip [MAJOR] prefix for display
                const majorPrefix = '[MAJOR]';
                if (cleaned.toUpperCase().startsWith(majorPrefix)) {
                    cleaned = cleaned.substring(majorPrefix.length).trim();
                }
                if (cleaned.length > 0) {
                    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
                }
                return { text: cleaned, original: original };
            }).filter(p => p.text.length > 0);
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
         * Check if an item starts with "[MAJOR] "
         * @param {string} text
         * @returns {boolean}
         */
        _isMajorItem(text) {
            if (!text) return false;
            return text.toUpperCase().startsWith('[MAJOR]');
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
                li.textContent = item.text;
                if (this._isGameItem(item.original)) {
                    li.classList.add('changelog-game-item');
                }
                if (this._isMajorItem(item.original)) {
                    li.classList.add('changelog-major-item');
                }
                listEl.appendChild(li);
            });
        },

        /**
         * Translate dynamic content (names, descriptions, dates) based on current language
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
                const dateEl = card.querySelector('.changelog-date');

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

                // Update date relative text on language change
                if (dateEl && entry.date) {
                    const relative = this._getRelativeTime(entry.date);
                    const dateDisplay = this._formatDate(entry.date);
                    dateEl.textContent = `${dateDisplay} (${relative})`;
                }
            });
        }
    };

    autobingo.ChangelogRenderer = ChangelogRenderer;

})(window.AutoBingo = window.AutoBingo || {});