/**
 * Represents a credit entry
 * AutoBingo.CreditEntry
 */
(function(autobingo) {
    'use strict';

    class CreditEntry {
        /**
         * @param {string} name - Person/entity name
         * @param {string} func - Function/role
         * @param {string} data - Data contribution description
         * @param {string|null} btnTextFr - Button text in French
         * @param {string|null} btnTextEn - Button text in English
         * @param {string|null} btnUrl - Button URL
         */
        constructor(name, func, data, btnTextFr, btnTextEn, btnUrl) {
            this.name = name;
            this.function = func;
            this.data = data;
            this.btnTextFr = btnTextFr;
            this.btnTextEn = btnTextEn;
            this.btnUrl = btnUrl;
        }

        /**
         * Create from raw JSON object
         * @param {Object} raw
         * @returns {CreditEntry}
         */
        static fromRaw(raw) {
            const btn = raw.Button || {};
            return new CreditEntry(
                raw.Name,
                raw.Function,
                raw.Data,
                btn.Text_FR || null,
                btn.Text_EN || null,
                btn.Url || null
            );
        }
    }

    autobingo.CreditEntry = CreditEntry;

})(window.AutoBingo = window.AutoBingo || {});