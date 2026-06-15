/**
 * Represents a Bingo game session
 * AutoBingo.BingoGame
 */
(function(autobingo) {
    'use strict';

    class BingoGame {
        /**
         * @param {string} id - Unique bingo identifier
         * @param {string} datasetName - Name of the dataset used
         * @param {number} gridSize - Size of the grid (e.g. 5 for 5x5)
         * @param {Array} items - Array of items in the grid
         */
        constructor(id, datasetName, gridSize, items) {
            this.id = id;
            this.datasetName = datasetName;
            this.gridSize = gridSize;
            this.items = items;
            this.validatedCells = [];
            this.createdAt = new Date().toISOString();
        }
    }

    autobingo.BingoGame = BingoGame;

})(window.AutoBingo = window.AutoBingo || {});