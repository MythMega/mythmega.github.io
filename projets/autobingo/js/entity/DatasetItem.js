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
         * @param {Object|null} quantity - Optional Quantity override {Min?, Max?}
         */
        constructor(nameEn, nameFr, pictureMain, pictureAlt, index, quantity) {
            this.nameEn = nameEn;
            this.nameFr = nameFr;
            this.pictureMain = pictureMain ? pictureMain.replace("'", "_") : pictureMain;
            this.pictureAlt = pictureAlt ? pictureAlt.replace("'", "_") : pictureAlt;
            this.index = index;
            this.quantity = quantity || null;
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
                raw.Index,
                raw.Quantity || null
            );
        }
    }

    autobingo.DatasetItem = DatasetItem;

})(window.AutoBingo = window.AutoBingo || {});