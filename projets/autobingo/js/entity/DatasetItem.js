/**
 * Represents a single item within a dataset
 * AutoBingo.DatasetItem
 */
(function(autobingo) {
    'use strict';

    class DatasetItem {
        /**
         * @param {string} nameEn - English name
         * @param {string} nameFr - French name
         * @param {string} pictureMain - Main picture URL
         * @param {string} pictureAlt - Alternative picture URL (shiny/alt)
         * @param {number|null} index - Optional index
         */
        constructor(nameEn, nameFr, pictureMain, pictureAlt, index) {
            this.nameEn = nameEn;
            this.nameFr = nameFr;
            this.pictureMain = pictureMain;
            this.pictureAlt = pictureAlt;
            this.index = index;
        }

        /**
         * Create from a raw JSON object
         * @param {Object} raw
         * @returns {DatasetItem}
         */
        static fromRaw(raw) {
            return new DatasetItem(
                raw.Name_EN,
                raw.Name_FR,
                raw.PictureMain,
                raw.PictureAlt,
                raw.Index
            );
        }
    }

    autobingo.DatasetItem = DatasetItem;

})(window.AutoBingo = window.AutoBingo || {});