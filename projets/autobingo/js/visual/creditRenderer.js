/**
 * Renders the credits page
 * AutoBingo.CreditRenderer
 */
(function(autobingo) {
    'use strict';

    const CreditRenderer = {
        /**
         * Render credits into a container
         * @param {HTMLElement} container
         * @param {Array} entries - Array of CreditEntry
         */
        render(container, entries) {
            container.innerHTML = '';

            entries.forEach(entry => {
                const card = document.createElement('div');
                card.className = 'credit-card';

                const name = document.createElement('h3');
                name.className = 'credit-name';
                name.textContent = entry.name;
                card.appendChild(name);

                const func = document.createElement('p');
                func.className = 'credit-function';
                func.textContent = entry.function;
                card.appendChild(func);

                const data = document.createElement('p');
                data.className = 'credit-data';
                data.textContent = entry.data;
                card.appendChild(data);

                if (entry.btnUrl) {
                    const btn = document.createElement('a');
                    btn.href = entry.btnUrl;
                    btn.target = '_blank';
                    btn.rel = 'noopener noreferrer';
                    btn.className = 'btn btn-primary credit-btn';
                    // Use translation data attributes
                    btn.setAttribute('data-i18n', 'credit.visit');
                    btn.textContent = 'Website'; // fallback
                    card.appendChild(btn);
                }

                container.appendChild(card);
            });
        }
    };

    autobingo.CreditRenderer = CreditRenderer;

})(window.AutoBingo = window.AutoBingo || {});