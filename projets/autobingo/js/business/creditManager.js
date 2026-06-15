/**
 * Manages loading credit data
 * AutoBingo.CreditManager
 */
(function(autobingo) {
    'use strict';

    class CreditManager {
        constructor() {
            this.entries = [];
        }

        /**
         * Load credits from metadata/credit.json
         * @returns {Promise<Array>} List of CreditEntry
         */
        async load() {
            const response = await fetch('metadata/credit.json');
            const raw = await response.json();
            this.entries = raw.map(autobingo.CreditEntry.fromRaw);
            return this.entries;
        }
    }

    autobingo.CreditManager = CreditManager;

})(window.AutoBingo = window.AutoBingo || {});