/**
 * Manages loading changelog data
 * AutoBingo.ChangelogManager
 */
(function(autobingo) {
    'use strict';

    class ChangelogManager {
        constructor() {
            this.entries = [];
        }

        /**
         * Load changelog from metadata/changelog.json
         * @returns {Promise<Array>} List of ChangelogEntry sorted by ID descending
         */
        async load() {
            const response = await fetch('metadata/changelog.json');
            const raw = await response.json();
            this.entries = raw
                .map(autobingo.ChangelogEntry.fromRaw)
                .sort((a, b) => b.id - a.id); // Highest ID first
            return this.entries;
        }
    }

    autobingo.ChangelogManager = ChangelogManager;

})(window.AutoBingo = window.AutoBingo || {});