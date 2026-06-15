/**
 * Floating button to toggle light/dark theme using SVG icons
 * AutoBingo.ThemeToggle
 */
(function(autobingo) {
    'use strict';

    const ThemeToggle = {
        _button: null,

        /**
         * Create and append the floating theme toggle button
         */
        create() {
            this._button = document.createElement('button');
            this._button.className = 'floating-btn theme-btn';
            this._button.title = autobingo.ThemeManager.get();

            this._updateIcon();

            this._button.addEventListener('click', () => {
                const newTheme = autobingo.ThemeManager.toggle();
                this._updateIcon();
            });

            document.body.appendChild(this._button);
        },

        /**
         * Update the button icon based on current theme
         */
        _updateIcon() {
            const theme = autobingo.ThemeManager.get();
            const icon = theme === 'dark' ? 'moon' : 'sun';

            fetch(`assets/theme/${theme === 'dark' ? 'dark' : 'light'}.svg`)
                .then(response => response.text())
                .then(svg => {
                    this._button.innerHTML = svg;
                    this._button.querySelector('svg').setAttribute('width', '22');
                    this._button.querySelector('svg').setAttribute('height', '22');
                })
                .catch(() => {
                    // Fallback
                    this._button.textContent = theme === 'dark' ? '🌙' : '☀️';
                });
        },

        /**
         * Update the button icon
         */
        update() {
            this._updateIcon();
        }
    };

    autobingo.ThemeToggle = ThemeToggle;

})(window.AutoBingo = window.AutoBingo || {});