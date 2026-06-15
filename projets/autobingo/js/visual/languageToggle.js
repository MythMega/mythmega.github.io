/**
 * Floating button to toggle between English and French using flag icons
 * AutoBingo.LanguageToggle
 */
(function(autobingo) {
    'use strict';

    const LanguageToggle = {
        _button: null,

        /**
         * Create and append the floating language toggle button
         */
        create() {
            this._button = document.createElement('button');
            this._button.className = 'floating-btn lang-btn';
            this._button.title = autobingo.translationManager
                ? autobingo.translationManager.currentLang.toUpperCase()
                : 'EN';

            this._updateFlag();

            this._button.addEventListener('click', async () => {
                const currentLang = autobingo.translationManager.currentLang;
                const newLang = currentLang === 'en' ? 'fr' : 'en';
                autobingo.translationManager.setLanguage(newLang);
                await autobingo.translationManager.load(newLang);
                autobingo.translationManager.translatePage();
                this._updateFlag();

                // Refresh grid size labels if categorySelector exists
                if (AutoBingo.currentSelector && AutoBingo.currentSelector.refreshSizeLabels) {
                    AutoBingo.currentSelector.refreshSizeLabels();
                }

                // Refresh bingo grid names if on bingo page
                if (AutoBingo.BingoGridRenderer && AutoBingo.bingoGameManager) {
                    AutoBingo.BingoGridRenderer.onLanguageChange();
                }

                // Also re-translate dynamic content for changelog if present
                if (AutoBingo.ChangelogRenderer && document.querySelector('.changelog-card')) {
                    const container = document.getElementById('changelog-container');
                    if (container && AutoBingo.changelogEntries) {
                        AutoBingo.ChangelogRenderer._translateDynamic(AutoBingo.changelogEntries);
                    }
                }
            });

            document.body.appendChild(this._button);
        },

        /**
         * Update button with flag image for current language
         */
        _updateFlag() {
            const lang = autobingo.translationManager
                ? autobingo.translationManager.currentLang
                : 'en';
            const flagFile = lang === 'en' ? 'gb.png' : 'fr.png';

            const img = document.createElement('img');
            img.src = `assets/flag/${flagFile}`;
            img.alt = lang.toUpperCase();
            img.width = 22;
            img.height = 22;
            img.style.borderRadius = '2px';
            img.style.objectFit = 'cover';

            this._button.innerHTML = '';
            this._button.appendChild(img);
            this._button.title = lang.toUpperCase();
        },

        /**
         * Update button flag
         */
        update() {
            this._updateFlag();
        }
    };

    autobingo.LanguageToggle = LanguageToggle;

})(window.AutoBingo = window.AutoBingo || {});