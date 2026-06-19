/**
 * Represents a single cell in the bingo grid
 * AutoBingo.BingoCell
 */
(function(autobingo) {
    'use strict';

    class BingoCell {
        /**
         * @param {number} index - Cell index in the grid
         * @param {autobingo.DatasetItem} item - The dataset item
         * @param {number|null} quantity - Optional quantity value
         */
        constructor(index, item, quantity) {
            this.index = index;
            this.item = item;
            this.validated = false;
            this.quantity = quantity || null;
        }
    }

    autobingo.BingoCell = BingoCell;

})(window.AutoBingo = window.AutoBingo || {});