/**
 * Renders the bingo grid and its controls
 * AutoBingo.BingoGridRenderer
 */
(function(autobingo) {
    'use strict';

    const BingoGridRenderer = {
        container: null,
        gameManager: null,

        /**
         * Initialize and render the grid
         * @param {HTMLElement} container
         * @param {BingoGameManager} gameManager
         */
        init(container, gameManager) {
            this.container = container;
            this.gameManager = gameManager;
            this.container.innerHTML = '';
            this.render();
        },

        /**
         * Full render of the grid and controls
         */
        render() {
            this.container.innerHTML = '';

            // Top controls bar
            const controlsBar = this._createControlsBar();
            this.container.appendChild(controlsBar);

            // Timer
            const timerBar = this._createTimerBar();
            this.container.appendChild(timerBar);

            // Search autocomplete
            const searchBar = this._createSearchBar();
            this.container.appendChild(searchBar);

            // Notification container (floating top-left)
            const notifContainer = document.createElement('div');
            notifContainer.className = 'notification-container';
            notifContainer.id = 'notification-container';
            this.container.appendChild(notifContainer);

            // Grid
            const gridContainer = document.createElement('div');
            gridContainer.className = 'bingo-grid-wrapper';
            const grid = document.createElement('div');
            grid.className = 'bingo-grid';
            grid.style.gridTemplateColumns = `repeat(${this.gameManager.gridSize}, 1fr)`;
            grid.id = 'bingo-grid';

            this.gameManager.cells.forEach((cell, index) => {
                const cellEl = this._createCellElement(cell, index);
                grid.appendChild(cellEl);
            });

            gridContainer.appendChild(grid);
            this.container.appendChild(gridContainer);

            // Hidden div for search modal
            const searchModal = document.createElement('div');
            searchModal.className = 'search-modal hidden';
            searchModal.id = 'search-modal';
            document.body.appendChild(searchModal);

            // Hidden div for bingo popup
            const bingoPopup = document.createElement('div');
            bingoPopup.className = 'bingo-popup hidden';
            bingoPopup.id = 'bingo-popup';
            document.body.appendChild(bingoPopup);
        },

        /**
         * Update the grid URL (called after item changes)
         */
        updateUrl() {
            const encoded = this.gameManager.encodeItemsToBase64();
            const id = this.gameManager.datasetDefinition.name;
            const size = this.gameManager.gridSize;
            autobingo.NavigationManager.setParam('id', id);
            autobingo.NavigationManager.setParam('size', size);
            autobingo.NavigationManager.setParam('items', encoded);
            this._updateControlsUrl();
            this._updateQuantitiesUrl();
        },

        /**
         * Update the controls param in URL
         */
        _updateControlsUrl() {
            const gm = this.gameManager;
            const h = gm.hideItems ? '1' : '0';
            const b = gm.blurItems ? '1' : '0';
            const l = gm.locked ? '1' : '0';
            autobingo.NavigationManager.setParam('controls', h + b + l);
        },

        /**
         * Update the quantities param in URL
         */
        _updateQuantitiesUrl() {
            if (!this.gameManager.isQuantizable) return;
            const encoded = this.gameManager.encodeQuantitiesToBase64();
            if (encoded) {
                autobingo.NavigationManager.setParam('quantities', encoded);
            }
        },

        /**
         * Refresh only the cell visuals (after validation changes / language change)
         */
        refreshCells() {
            const grid = document.getElementById('bingo-grid');
            if (!grid) return;
            const cells = grid.querySelectorAll('.bingo-cell');
            this.gameManager.cells.forEach((cell, index) => {
                if (cells[index]) {
                    this._updateCellVisual(cells[index], cell);
                }
            });
        },

        /**
         * Called when language changes to refresh dynamic names
         */
        onLanguageChange() {
            this.refreshCells();
        },

        /**
         * Rebuild the full grid (after randomize)
         */
        rebuildGrid() {
            // Clean up modals from body
            const oldModal = document.getElementById('search-modal');
            if (oldModal) oldModal.remove();
            const oldPopup = document.getElementById('bingo-popup');
            if (oldPopup) oldPopup.remove();

            this.render();
            this.updateUrl();

            // Re-translate
            if (autobingo.translationManager) {
                autobingo.translationManager.translatePage();
            }
        },

        /**
         * Create controls bar
         */
        _createControlsBar() {
            const bar = document.createElement('div');
            bar.className = 'bingo-controls-bar';

            // Alt image toggle
            const altToggle = document.createElement('label');
            altToggle.className = 'bingo-toggle';
            const altCheckbox = document.createElement('input');
            altCheckbox.type = 'checkbox';
            altCheckbox.checked = this.gameManager.useAltImages;
            if (!this.gameManager.hasAltImages) altCheckbox.disabled = true;
            altCheckbox.addEventListener('change', () => {
                this.gameManager.useAltImages = altCheckbox.checked;
                this.refreshCells();
            });
            const altSpan = document.createElement('span');
            altSpan.setAttribute('data-i18n', 'bingo.alt_images');
            altSpan.textContent = 'Alt Img';
            altToggle.appendChild(altCheckbox);
            altToggle.appendChild(altSpan);
            bar.appendChild(altToggle);

            // Randomize items
            const randItemsBtn = this._createButton('bingo.randomize_items', 'Randomize Items', () => {
                this.gameManager.randomizeItems();
                this.rebuildGrid();
            });
            bar.appendChild(randItemsBtn);

            // Randomize order
            const randOrderBtn = this._createButton('bingo.randomize_order', 'Randomize Order', () => {
                this.gameManager.randomizeOrder();
                this.rebuildGrid();
            });
            bar.appendChild(randOrderBtn);

            // Randomize quantities (only if quantizable)
            if (this.gameManager.isQuantizable) {
                const randQuantBtn = this._createButton('bingo.randomize_quantities', 'Randomize Quantities', () => {
                    this.gameManager.randomizeQuantities();
                    this.rebuildGrid();
                });
                bar.appendChild(randQuantBtn);
            }

            // Lock grid toggle - rebuilds grid to show/hide switch buttons
            const lockCheckbox = this._createControlCheckbox('lockCheckbox', this.gameManager.locked);
            const lockToggle = document.createElement('label');
            lockToggle.className = 'bingo-toggle';
            lockCheckbox.addEventListener('change', () => {
                this.gameManager.locked = lockCheckbox.checked;
                this._updateControlsUrl();
                this.rebuildGrid();
            });
            const lockSpan = document.createElement('span');
            lockSpan.setAttribute('data-i18n', 'bingo.lock_grid');
            lockSpan.textContent = 'Lock Grid';
            lockToggle.appendChild(lockCheckbox);
            lockToggle.appendChild(lockSpan);
            bar.appendChild(lockToggle);

            // Reset completion
            const resetBtn = this._createButton('bingo.reset_completion', 'Reset', () => {
                this.gameManager.resetCompletion();
                this.refreshCells();
            });
            bar.appendChild(resetBtn);

            // Hide items toggle
            const hideCheckbox = this._createControlCheckbox('hideCheckbox', this.gameManager.hideItems);
            const hideToggle = document.createElement('label');
            hideToggle.className = 'bingo-toggle';
            hideCheckbox.addEventListener('change', () => {
                this.gameManager.hideItems = hideCheckbox.checked;
                this.refreshCells();
                this._updateControlsUrl();
            });
            const hideSpan = document.createElement('span');
            hideSpan.setAttribute('data-i18n', 'bingo.hide_items');
            hideSpan.textContent = 'Hide';
            hideToggle.appendChild(hideCheckbox);
            hideToggle.appendChild(hideSpan);
            bar.appendChild(hideToggle);

            // Blur items toggle
            const blurCheckbox = this._createControlCheckbox('blurCheckbox', this.gameManager.blurItems);
            const blurToggle = document.createElement('label');
            blurToggle.className = 'bingo-toggle';
            blurCheckbox.addEventListener('change', () => {
                this.gameManager.blurItems = blurCheckbox.checked;
                this.refreshCells();
                this._updateControlsUrl();
            });
            const blurSpan = document.createElement('span');
            blurSpan.setAttribute('data-i18n', 'bingo.blur_items');
            blurSpan.textContent = 'Blur';
            blurToggle.appendChild(blurCheckbox);
            blurToggle.appendChild(blurSpan);
            bar.appendChild(blurToggle);

            return bar;
        },

        /**
         * Create a checkbox with id for controls tracking
         */
        _createControlCheckbox(id, checked) {
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.id = id;
            cb.checked = checked;
            return cb;
        },

        /**
         * Create timer bar
         */
        _createTimerBar() {
            const bar = document.createElement('div');
            bar.className = 'bingo-timer-bar';

            const display = document.createElement('span');
            display.className = 'timer-display';
            display.id = 'timer-display';
            display.textContent = this.gameManager.getTimerDisplay();
            bar.appendChild(display);

            const playBtn = this._createButton('bingo.timer_play', '\u25B6', () => {
                this.gameManager.startTimer();
                this._updateTimerDisplay();
            });
            playBtn.className = 'btn btn-secondary timer-btn';
            bar.appendChild(playBtn);

            const pauseBtn = this._createButton('bingo.timer_pause', '\u23F8', () => {
                this.gameManager.pauseTimer();
            });
            pauseBtn.className = 'btn btn-secondary timer-btn';
            bar.appendChild(pauseBtn);

            const stopBtn = this._createButton('bingo.timer_stop', '\u23F9', () => {
                this.gameManager.stopTimer();
                this._updateTimerDisplay();
            });
            stopBtn.className = 'btn btn-secondary timer-btn';
            bar.appendChild(stopBtn);

            return bar;
        },

        /**
         * Update timer display
         */
        _updateTimerDisplay() {
            const display = document.getElementById('timer-display');
            if (display) {
                display.textContent = this.gameManager.getTimerDisplay();
            }
            if (this.gameManager.timerRunning) {
                setTimeout(() => this._updateTimerDisplay(), 1000);
            }
        },

        /**
         * Create search autocomplete bar
         */
        _createSearchBar() {
            const bar = document.createElement('div');
            bar.className = 'bingo-search-bar';

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'bingo-search-input';
            input.setAttribute('data-i18n-placeholder', 'bingo.search_placeholder');
            input.placeholder = 'Search item...';
            input.id = 'bingo-search-input';
            bar.appendChild(input);

            const results = document.createElement('div');
            results.className = 'search-results hidden';
            results.id = 'search-results';
            bar.appendChild(results);

            let debounceTimer;
            input.addEventListener('input', () => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    this._handleSearch(input.value, results);
                }, 150);
            });

            // Hide results on blur
            input.addEventListener('blur', () => {
                setTimeout(() => results.classList.add('hidden'), 200);
            });
            input.addEventListener('focus', () => {
                if (input.value.trim()) {
                    results.classList.remove('hidden');
                }
            });

            return bar;
        },

        /**
         * Handle search input - show all matching items, allow selection of any
         */
        _handleSearch(query, resultsContainer) {
            const q = query.trim().toLowerCase();
            if (!q) {
                resultsContainer.classList.add('hidden');
                return;
            }

            const lang = autobingo.translationManager ? autobingo.translationManager.currentLang : 'en';
            const matches = this.gameManager.allItems
                .map((item, idx) => ({ item, idx }))
                .filter(({ item }) => {
                    const nameEn = (item.nameEn || '').toLowerCase();
                    const nameFr = (item.nameFr || '').toLowerCase();
                    return nameEn.includes(q) || nameFr.includes(q);
                })
                .slice(0, 15);

            if (matches.length === 0) {
                resultsContainer.classList.add('hidden');
                return;
            }

            resultsContainer.innerHTML = '';
            resultsContainer.classList.remove('hidden');

            matches.forEach(({ item, idx }) => {
                const div = document.createElement('div');
                div.className = 'search-result-item';
                const name = lang === 'fr' ? (item.nameFr || item.nameEn) : item.nameEn;
                div.textContent = name;
                div.addEventListener('click', () => {
                    this._onSearchSelect(item, idx);
                    resultsContainer.classList.add('hidden');
                    document.getElementById('bingo-search-input').value = '';
                });
                resultsContainer.appendChild(div);
            });
        },

        /**
         * Called when user selects an item from search results
         */
        _onSearchSelect(item, allItemsIndex) {
            const lang = autobingo.translationManager ? autobingo.translationManager.currentLang : 'en';
            const itemName = lang === 'fr' ? (item.nameFr || item.nameEn) : item.nameEn;

            // Check if item is in the grid
            const cellIndex = this.gameManager.cells.findIndex(c =>
                this.gameManager.allItems.indexOf(c.item) === allItemsIndex
            );

            if (cellIndex >= 0) {
                // Found in grid! Activate it
                this.gameManager.startTimer();
                this.gameManager.toggleCell(cellIndex);
                this.refreshCells();
                this._checkBingoAndShow();

                // Show green notification
                const msg = autobingo.translationManager
                    ? autobingo.translationManager.t('bingo.item_found', { item: itemName })
                    : `${itemName} found!`;
                this._showNotification(msg, 'success');
            } else {
                // Not found in grid
                const msg = autobingo.translationManager
                    ? autobingo.translationManager.t('bingo.item_not_found', { item: itemName })
                    : `${itemName} not found!`;
                this._showNotification(msg, 'error');

                // Shake the search input
                const input = document.getElementById('bingo-search-input');
                if (input) {
                    input.classList.remove('shake-animation');
                    void input.offsetWidth;
                    input.classList.add('shake-animation');
                    setTimeout(() => input.classList.remove('shake-animation'), 500);
                }
            }
        },

        /**
         * Show a floating notification
         */
        _showNotification(message, type) {
            const container = document.getElementById('notification-container');
            if (!container) return;

            const notif = document.createElement('div');
            notif.className = `notification notification-${type}`;
            notif.textContent = message;
            container.appendChild(notif);

            setTimeout(() => {
                notif.classList.add('notification-hide');
                setTimeout(() => notif.remove(), 300);
            }, 2000);
        },

        /**
         * Check for bingo and show popup - pause timer on bingo
         */
        _checkBingoAndShow() {
            const result = this.gameManager.checkBingo();
            if (result) {
                this.gameManager.pauseTimer();
                this._updateTimerDisplay();
                this._showBingoPopup(result);
            }
        },

        /**
         * Show bingo popup
         */
        _showBingoPopup(result) {
            const popup = document.getElementById('bingo-popup');
            if (!popup) return;

            const validatedCount = this.gameManager.cells.filter(c => c.validated).length;
            const lang = autobingo.translationManager ? autobingo.translationManager.currentLang : 'en';

            const lineNames = result.cells.map(c => {
                return lang === 'fr' ? (c.item.nameFr || c.item.nameEn) : c.item.nameEn;
            }).join(', ');

            popup.innerHTML = `
                <div class="bingo-popup-content">
                    <h2>\uD83C\uDF89 BINGO! \uD83C\uDF89</h2>
                    <p>${result.type}</p>
                    <p>${validatedCount} / ${this.gameManager.cells.length} items validated</p>
                    <p>${this.gameManager.getTimerDisplay()}</p>
                    <p class="bingo-line-items">${lineNames}</p>
                    <button class="btn btn-primary" id="bingo-popup-close">OK</button>
                </div>
            `;
            popup.classList.remove('hidden');

            document.getElementById('bingo-popup-close').addEventListener('click', () => {
                popup.classList.add('hidden');
            });
        },

        /**
         * Create a cell element
         */
        _createCellElement(cell, index) {
            const div = document.createElement('div');
            div.className = 'bingo-cell';
            div.dataset.index = index;

            // Quantity badge (top-left) - only if quantizable and quantity > 1
            if (this.gameManager.isQuantizable && cell.quantity !== null && cell.quantity > 1) {
                const quantityBadge = document.createElement('span');
                quantityBadge.className = 'cell-quantity-badge';
                quantityBadge.textContent = cell.quantity;
                // Dynamic font-size reduction for large numbers
                const digits = String(cell.quantity).length;
                if (digits >= 4) {
                    quantityBadge.style.fontSize = '0.75em';
                }
                if (digits >= 6) {
                    quantityBadge.style.fontSize = '0.55em';
                }
                div.appendChild(quantityBadge);
            }

            // Switch button (top-right) - only created if NOT locked
            if (!this.gameManager.locked) {
                const switchBtn = document.createElement('button');
                switchBtn.className = 'cell-switch-btn';
                switchBtn.title = 'Change item';
                fetch('assets/switch-vertical.svg')
                    .then(r => r.text())
                    .then(svg => { switchBtn.innerHTML = svg; });
                switchBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._onCellSwitchClick(index, switchBtn);
                });
                div.appendChild(switchBtn);
            }

            // Image
            const img = document.createElement('img');
            img.className = 'cell-image';
            img.loading = 'lazy';
            img.src = cell.item.pictureMain;
            img.alt = cell.item.nameEn;
            img.addEventListener('error', () => {
                img.src = '';
            });
            div.appendChild(img);

            // Name
            const nameSpan = document.createElement('span');
            nameSpan.className = 'cell-name';
            const lang = autobingo.translationManager ? autobingo.translationManager.currentLang : 'en';
            nameSpan.textContent = lang === 'fr' ? (cell.item.nameFr || cell.item.nameEn) : cell.item.nameEn;
            div.appendChild(nameSpan);

            // Click to validate
            div.addEventListener('click', (e) => {
                if (e.target.closest('.cell-switch-btn')) return;
                if (e.target.closest('.cell-quantity-badge')) return;
                this.gameManager.startTimer();
                this._updateTimerDisplay();
                this.gameManager.toggleCell(index);
                this._updateCellVisual(div, cell);
                this._checkBingoAndShow();
            });

            this._updateCellVisual(div, cell);

            return div;
        },

        /**
         * Handle click on the cell switch button: open search modal (with quantity input if quantizable)
         */
        _onCellSwitchClick(index, btn) {
            this._openSearchModal(index);
        },

        /**
         * Commit a quantity value to a cell and update URL
         */
        _commitQuantity(index, value) {
            const cell = this.gameManager.cells[index];
            const num = parseInt(value);
            if (!isNaN(num) && num > 0) {
                cell.quantity = num;
            } else {
                cell.quantity = 0;
            }
            this.updateUrl();
            this.rebuildGrid();
        },

        /**
         * Update a cell's visual state
         */
        _updateCellVisual(el, cell) {
            el.classList.toggle('validated', cell.validated);

            const img = el.querySelector('.cell-image');
            if (img) {
                // Reset all image effect classes
                img.classList.remove('effect-hide', 'effect-blur');

                if (!cell.validated) {
                    const hide = this.gameManager.hideItems;
                    const blur = this.gameManager.blurItems;

                    if (hide) {
                        img.classList.add('effect-hide');
                    }
                    if (blur) {
                        img.classList.add('effect-blur');
                    }
                }

                if (this.gameManager.useAltImages && this.gameManager.hasAltImages && cell.item.pictureAlt) {
                    img.src = cell.item.pictureAlt;
                } else {
                    img.src = cell.item.pictureMain;
                }
            }

            // Update name
            const nameSpan = el.querySelector('.cell-name');
            if (nameSpan) {
                if ((this.gameManager.hideItems || this.gameManager.blurItems ) && !cell.validated) {
                    nameSpan.textContent = '??????';
                } else {
                    const lang = autobingo.translationManager ? autobingo.translationManager.currentLang : 'en';
                    nameSpan.textContent = lang === 'fr' ? (cell.item.nameFr || cell.item.nameEn) : cell.item.nameEn;
                }
            }
        },

        /**
         * Open search modal for replacing a cell
         */
        _openSearchModal(index) {
            const modal = document.getElementById('search-modal');
            if (!modal) return;

            const lang = autobingo.translationManager ? autobingo.translationManager.currentLang : 'en';
            const currentCell = this.gameManager.cells[index];

            let quantitySectionHtml = '';
            if (this.gameManager.isQuantizable) {
                quantitySectionHtml = `
                    <div class="quantity-edit-section" style="margin-bottom:12px;padding:8px;background:var(--bg-secondary);border-radius:8px;display:flex;align-items:center;gap:8px;">
                        <label data-i18n="bingo.quantity_label" style="font-weight:600;">${lang === 'fr' ? 'Quantité' : 'Quantity'}:</label>
                        <input type="number" id="modal-quantity-input" class="bingo-search-input" style="width:80px;flex:none;" value="${currentCell.quantity || 1}" min="1">
                    </div>
                `;
            }

            modal.innerHTML = `
                <div class="search-modal-content">
                    <h3 data-i18n="bingo.replace_item">Replace Item</h3>
                    ${quantitySectionHtml}
                    <input type="text" class="bingo-search-input" id="modal-search-input" placeholder="Search..." autofocus>
                    <div class="modal-search-results" id="modal-search-results"></div>
                    <button class="btn btn-secondary mt-16" id="modal-close">Close</button>
                </div>
            `;
            modal.classList.remove('hidden');

            if (autobingo.translationManager) {
                setTimeout(() => autobingo.translationManager.translatePage(), 0);
            }

            const input = document.getElementById('modal-search-input');
            const results = document.getElementById('modal-search-results');

            let debounceTimer;
            input.addEventListener('input', () => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    const q = input.value.trim().toLowerCase();
                    if (!q) { results.innerHTML = ''; return; }

                    const lang = autobingo.translationManager ? autobingo.translationManager.currentLang : 'en';
                    const matches = this.gameManager.allItems
                        .map((item, idx) => ({ item, idx }))
                        .filter(({ item }) => {
                            const nameEn = (item.nameEn || '').toLowerCase();
                            const nameFr = (item.nameFr || '').toLowerCase();
                            return nameEn.includes(q) || nameFr.includes(q);
                        })
                        .slice(0, 20);

                    results.innerHTML = '';
                    matches.forEach(({ item, idx }) => {
                        const inGrid = this.gameManager.cells.some(c => this.gameManager.allItems.indexOf(c.item) === idx);
                        const div = document.createElement('div');
                        div.className = 'search-result-item';
                        const name = lang === 'fr' ? (item.nameFr || item.nameEn) : item.nameEn;
                        div.textContent = name;
                        if (inGrid) {
                            const badge = document.createElement('span');
                            badge.className = 'in-grid-badge';
                            badge.setAttribute('data-i18n', 'bingo.in_grid');
                            badge.textContent = 'in grid';
                            div.appendChild(badge);
                        }
                        div.addEventListener('click', () => {
                            this.gameManager.cells[index].item = item;
                            // Use quantity from modal input if quantizable
                            if (this.gameManager.isQuantizable) {
                                const qInput = document.getElementById('modal-quantity-input');
                                if (qInput) {
                                    const num = parseInt(qInput.value);
                                    this.gameManager.cells[index].quantity = (!isNaN(num) && num > 0) ? num : 0;
                                } else {
                                    this.gameManager.cells[index].quantity = this.gameManager._randomQuantityForItem(item);
                                }
                            }
                            this.refreshCells();
                            this.updateUrl();
                            modal.classList.add('hidden');
                        });
                        results.appendChild(div);
                    });
                }, 150);
            });

            document.getElementById('modal-close').addEventListener('click', () => {
                // Save quantity before closing if quantizable
                if (this.gameManager.isQuantizable) {
                    const qInput = document.getElementById('modal-quantity-input');
                    if (qInput) {
                        this._commitQuantity(index, qInput.value);
                    }
                }
                modal.classList.add('hidden');
            });

            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    if (this.gameManager.isQuantizable) {
                        const qInput = document.getElementById('modal-quantity-input');
                        if (qInput) {
                            this._commitQuantity(index, qInput.value);
                        }
                    }
                    modal.classList.add('hidden');
                }
            });
        },

        /**
         * Helper to create a button
         */
        _createButton(i18nKey, fallbackText, onClick) {
            const btn = document.createElement('button');
            btn.className = 'btn btn-secondary';
            btn.setAttribute('data-i18n', i18nKey);
            btn.textContent = fallbackText;
            btn.addEventListener('click', onClick);
            return btn;
        }
    };

    autobingo.BingoGridRenderer = BingoGridRenderer;

})(window.AutoBingo = window.AutoBingo || {});