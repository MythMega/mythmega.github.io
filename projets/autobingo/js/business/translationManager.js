/**
 * Manages translations (i18n) for the application
 * AutoBingo.TranslationManager
 */
(function(autobingo) {
    'use strict';

    const DEFAULT_LANG = 'en';

    class TranslationManager {
        constructor() {
            this.translations = {};
            this.currentLang = DEFAULT_LANG;
        }

        /**
         * Set the current language
         * @param {string} lang - 'en' or 'fr'
         */
        setLanguage(lang) {
            this.currentLang = lang || DEFAULT_LANG;
            autobingo.CookieManager.set('bingo_lang', this.currentLang);
        }

        /**
         * Load translations for a language
         * @param {string} lang - Language code
         * @returns {Promise}
         */
        async load(lang) {
            this.currentLang = lang || DEFAULT_LANG;
            const response = await fetch(`translations/${this.currentLang}.json`);
            this.translations = await response.json();
        }

        /**
         * Translate a key with optional interpolation
         * @param {string} key - Translation key
         * @param {Object} params - Optional interpolation parameters
         * @returns {string}
         */
        t(key, params = {}) {
            let text = this.translations[key] || key;
            for (const [k, v] of Object.entries(params)) {
                text = text.replace(`{${k}}`, v);
            }
            return text;
        }

        /**
         * Translate to all elements with data-i18n attribute
         */
        translatePage() {
            document.querySelectorAll('[data-i18n]').forEach(el => {
                const key = el.getAttribute('data-i18n');
                el.textContent = this.t(key);
            });
            document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
                const key = el.getAttribute('data-i18n-placeholder');
                el.placeholder = this.t(key);
            });
            document.title = this.t('app.title');
        }
    }

    autobingo.TranslationManager = TranslationManager;

})(window.AutoBingo = window.AutoBingo || {});