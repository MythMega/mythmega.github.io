/**
 * Manages theme switching between light and dark
 * AutoBingo.ThemeManager
 */
(function(autobingo) {
    'use strict';

    const THEME_COOKIE = 'bingo_theme';
    const DEFAULT_THEME = 'dark';

    const ThemeManager = {
        _currentTheme: DEFAULT_THEME,

        /**
         * Initialize theme from cookie
         */
        init() {
            const saved = autobingo.CookieManager.get(THEME_COOKIE);
            this.set(saved || DEFAULT_THEME);
        },

        /**
         * Get current theme
         * @returns {string}
         */
        get() {
            return this._currentTheme;
        },

        /**
         * Set theme and apply to document
         * @param {string} theme - 'light' or 'dark'
         */
        set(theme) {
            this._currentTheme = theme;
            document.documentElement.setAttribute('data-theme', theme);
            autobingo.CookieManager.set(THEME_COOKIE, theme);
        },

        /**
         * Toggle between light and dark
         * @returns {string} The new theme
         */
        toggle() {
            const newTheme = this._currentTheme === 'dark' ? 'light' : 'dark';
            this.set(newTheme);
            return newTheme;
        }
    };

    autobingo.ThemeManager = ThemeManager;

})(window.AutoBingo = window.AutoBingo || {});