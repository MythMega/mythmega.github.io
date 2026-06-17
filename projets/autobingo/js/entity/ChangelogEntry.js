/**
 * Represents a changelog entry
 * AutoBingo.ChangelogEntry
 */
(function(autobingo) {
    'use strict';

    class ChangelogEntry {
        /**
         * @param {number} id - Version ID
         * @param {string} number - Version number (e.g. "Alpha a0.1")
         * @param {string} date - Date string (yyyy-mm-dd)
         * @param {string} nameFr - French name
         * @param {string} nameEn - English name
         * @param {string} descFr - French description
         * @param {string} descEn - English description
         * @param {string} link - Optional commit/release link
         */
        constructor(id, number, date, nameFr, nameEn, descFr, descEn, link) {
            this.id = id;
            this.number = number;
            this.date = date;
            this.nameFr = nameFr;
            this.nameEn = nameEn;
            this.descFr = descFr;
            this.descEn = descEn;
            this.link = link;
        }

        /**
         * Create from raw JSON object
         * @param {Object} raw
         * @returns {ChangelogEntry}
         */
        static fromRaw(raw) {
            const v = raw.Version || {};
            return new ChangelogEntry(
                v.ID,
                v.Number,
                raw.Date,
                raw.Name_FR,
                raw.Name_EN,
                raw.Desc_FR,
                raw.Desc_EN,
                raw.Link
            );
        }
    }

    autobingo.ChangelogEntry = ChangelogEntry;

})(window.AutoBingo = window.AutoBingo || {});