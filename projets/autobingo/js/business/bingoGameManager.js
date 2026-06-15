/**
 * Core bingo game logic - grid generation, validation, URL encoding
 * AutoBingo.BingoGameManager
 */
(function(autobingo) {
    'use strict';

    class BingoGameManager {
        constructor() {
            this.cells = [];
            this.gridSize = 5;
            this.datasetDefinition = null;
            this.allItems = [];
            this.locked = false;
            this.hideItems = false;
            this.blurItems = false;
            this.useAltImages = false;
            this.hasAltImages = false;
            this.timerSeconds = 0;
            this.timerRunning = false;
            this.timerInterval = null;
        }

        /**
         * Initialize from URL parameters
         * @returns {Promise<boolean>} Success
         */
        async initFromUrl() {
            const id = autobingo.NavigationManager.getParam('id');
            const sizeParam = autobingo.NavigationManager.getParam('size');
            const itemsParam = autobingo.NavigationManager.getParam('items');

            if (!id) return false;

            this.gridSize = sizeParam ? parseInt(sizeParam) : 5;
            if (![3,4,5,6,7].includes(this.gridSize)) this.gridSize = 5;

            // Load dataset
            const dm = new autobingo.DatasetManager();
            await dm.loadDefinitions();
            this.datasetDefinition = dm.getDatasetByName(id);
            if (!this.datasetDefinition) return false;

            this.allItems = await dm.loadDatasetItems(this.datasetDefinition);

            // Check for alt images
            this.hasAltImages = this.allItems.length > 0 && this.allItems[0].pictureAlt != null;

            // If items are passed in URL, decode and use them
            if (itemsParam) {
                return this._loadItemsFromBase64(itemsParam);
            }

            // Otherwise generate random items
            this._generateRandomGrid();
            return true;
        }

        /**
         * Generate random grid items
         */
        _generateRandomGrid() {
            const needed = this.gridSize * this.gridSize;
            const available = [...this.allItems];
            const selected = [];

            // First, pick unique items
            const uniqueCount = Math.min(needed, available.length);
            const shuffled = this._shuffle([...available]);
            for (let i = 0; i < uniqueCount; i++) {
                selected.push(shuffled[i]);
            }

            // If need more, fill with random (duplicates)
            if (needed > available.length) {
                for (let i = selected.length; i < needed; i++) {
                    const randomItem = available[Math.floor(Math.random() * available.length)];
                    selected.push(randomItem);
                }
            }

            this._setGridItems(selected);
        }

        /**
         * Set grid items from a flat array
         * @param {Array} items
         */
        _setGridItems(items) {
            this.cells = items.map((item, index) => new autobingo.BingoCell(index, item));
        }

        /**
         * Encode current items to base64 URL param
         * @returns {string}
         */
        encodeItemsToBase64() {
            const indices = this.cells.map(cell => {
                const item = cell.item;
                const idx = this.allItems.indexOf(item);
                return idx >= 0 ? idx : 0;
            });
            const str = indices.join(';');
            return btoa(str);
        }

        /**
         * Load items from base64 encoded string
         * @param {string} base64
         * @returns {boolean}
         */
        _loadItemsFromBase64(base64) {
            try {
                const str = atob(base64);
                const indices = str.split(';').map(s => parseInt(s.trim()));
                const items = indices.map(idx => this.allItems[idx]);
                if (items.length !== this.gridSize * this.gridSize) {
                    this._generateRandomGrid();
                    return true;
                }
                this._setGridItems(items);
                return true;
            } catch (e) {
                this._generateRandomGrid();
                return true;
            }
        }

        /**
         * Randomize the items (new selection)
         */
        randomizeItems() {
            this._generateRandomGrid();
        }

        /**
         * Randomize the order of items
         */
        randomizeOrder() {
            const items = this.cells.map(c => c.item);
            const shuffled = this._shuffle(items);
            this._setGridItems(shuffled);
        }

        /**
         * Toggle cell validation
         * @param {number} index
         */
        toggleCell(index) {
            if (index >= 0 && index < this.cells.length) {
                this.cells[index].validated = !this.cells[index].validated;
                return this.cells[index].validated;
            }
            return false;
        }

        /**
         * Validate/unvalidate a cell by item index in allItems
         * @param {number} allItemsIndex
         */
        validateByItemIndex(allItemsIndex) {
            const cell = this.cells.find(c => this.allItems.indexOf(c.item) === allItemsIndex);
            if (cell) {
                cell.validated = !cell.validated;
                return cell.validated;
            }
            return false;
        }

        /**
         * Reset all cell validations
         */
        resetCompletion() {
            this.cells.forEach(c => c.validated = false);
        }

        /**
         * Check for bingo (any row, column, or diagonal fully validated)
         * @returns {Object|null} { type, cells } or null
         */
        checkBingo() {
            const size = this.gridSize;

            // Check rows
            for (let r = 0; r < size; r++) {
                const cells = [];
                for (let c = 0; c < size; c++) {
                    cells.push(r * size + c);
                }
                if (cells.every(idx => this.cells[idx].validated)) {
                    return { type: `Row ${r + 1}`, cells: cells.map(i => this.cells[i]) };
                }
            }

            // Check columns
            for (let c = 0; c < size; c++) {
                const cells = [];
                for (let r = 0; r < size; r++) {
                    cells.push(r * size + c);
                }
                if (cells.every(idx => this.cells[idx].validated)) {
                    return { type: `Column ${c + 1}`, cells: cells.map(i => this.cells[i]) };
                }
            }

            // Check diagonal top-left to bottom-right
            const diag1 = [];
            for (let i = 0; i < size; i++) {
                diag1.push(i * size + i);
            }
            if (diag1.every(idx => this.cells[idx].validated)) {
                return { type: 'Diagonal \\', cells: diag1.map(i => this.cells[i]) };
            }

            // Check diagonal top-right to bottom-left
            const diag2 = [];
            for (let i = 0; i < size; i++) {
                diag2.push(i * size + (size - 1 - i));
            }
            if (diag2.every(idx => this.cells[idx].validated)) {
                return { type: 'Diagonal /', cells: diag2.map(i => this.cells[i]) };
            }

            return null;
        }

        /**
         * Timer controls
         */
        startTimer() {
            if (this.timerRunning) return;
            this.timerRunning = true;
            this.timerInterval = setInterval(() => {
                this.timerSeconds++;
            }, 1000);
        }

        pauseTimer() {
            this.timerRunning = false;
            if (this.timerInterval) {
                clearInterval(this.timerInterval);
                this.timerInterval = null;
            }
        }

        stopTimer() {
            this.pauseTimer();
            this.timerSeconds = 0;
        }

        getTimerDisplay() {
            const mins = Math.floor(this.timerSeconds / 60);
            const secs = this.timerSeconds % 60;
            return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        }

        /**
         * Shuffle array (Fisher-Yates)
         */
        _shuffle(arr) {
            const a = [...arr];
            for (let i = a.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [a[i], a[j]] = [a[j], a[i]];
            }
            return a;
        }
    }

    autobingo.BingoGameManager = BingoGameManager;

})(window.AutoBingo = window.AutoBingo || {});