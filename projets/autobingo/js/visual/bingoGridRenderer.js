/**
 * Renders the bingo grid and its controls
 * AutoBingo.BingoGridRenderer
 */
(function(autobingo) {
    'use strict';

    const BingoGridRenderer = {
        container: null,
        gameManager: null,
        isOverlay: false,
        overrideLang: null,

        /**
         * Initialize and render the grid
         * @param {HTMLElement} container
         * @param {BingoGameManager} gameManager
         * @param {Object} [options] - Optional settings
         * @param {boolean} [options.isOverlay] - OBS overlay mode (hide all controls except input)
         * @param {string} [options.overrideLang] - Force language from URL
         */
        init(container, gameManager, options) {
            this.container = container;
            this.gameManager = gameManager;
            this.isOverlay = options && options.isOverlay === true;
            this.overrideLang = options ? (options.overrideLang || null) : null;
            this.container.innerHTML = '';
            this.render();
        },

        /**
         * Get the effective language (overlay override > URL param > translationManager > fallback)
         * @returns {string}
         */
        _getCurrentLang() {
            if (this.overrideLang) return this.overrideLang;
            if (autobingo.translationManager) return autobingo.translationManager.currentLang;
            return 'en';
        },

        /**
         * Full render of the grid and controls
         */
        render() {
            this.container.innerHTML = '';

            if (!this.isOverlay) {
                // Top controls bar (only in normal mode)
                const controlsBar = this._createControlsBar();
                this.container.appendChild(controlsBar);

                // Timer (only in normal mode)
                const timerBar = this._createTimerBar();
                this.container.appendChild(timerBar);
            }

            // Search autocomplete (hidden in overlay unless hide or blur is on)
            if (!this.isOverlay || this.gameManager.hideItems || this.gameManager.blurItems) {
                const searchBar = this._createSearchBar();
                this.container.appendChild(searchBar);
            }

            // Notification container (floating top-left)
            if (!this.isOverlay) {
                const notifContainer = document.createElement('div');
                notifContainer.className = 'notification-container';
                notifContainer.id = 'notification-container';
                this.container.appendChild(notifContainer);
            }

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

            // OBS overlay button row (only in normal mode)
            if (!this.isOverlay) {
                const obsRow = document.createElement('div');
                obsRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:16px;flex-wrap:wrap;';

                const obsBtn = document.createElement('button');
                obsBtn.className = 'btn btn-secondary';
                obsBtn.setAttribute('data-i18n', 'bingo.obs_overlay');
                obsBtn.textContent = 'Get OBS Overlay URL';
                obsBtn.addEventListener('click', () => this._copyOverlayUrl(obsBtn));
                obsRow.appendChild(obsBtn);

                // Help tooltip
                const helpBtn = document.createElement('button');
                helpBtn.className = 'btn btn-secondary';
                helpBtn.textContent = '?';
                helpBtn.style.cssText = 'width:28px;height:28px;padding:0;font-weight:700;border-radius:50%;font-size:0.9rem;';
                helpBtn.setAttribute('data-i18n', 'bingo.obs_help');
                helpBtn.title = this._getObsHelpText();
                helpBtn.addEventListener('click', () => this._showObsHelp());
                obsRow.appendChild(helpBtn);

                // Custom CSS button
                const cssBtn = document.createElement('button');
                cssBtn.className = 'btn btn-secondary';
                cssBtn.setAttribute('data-i18n', 'bingo.css_custom');
                cssBtn.textContent = 'Custom CSS';
                cssBtn.addEventListener('click', () => this._openCustomCssPopup());
                obsRow.appendChild(cssBtn);

                this.container.appendChild(obsRow);
            }

            // Hidden div for search modal (only in normal mode)
            if (!this.isOverlay) {
                const searchModal = document.createElement('div');
                searchModal.className = 'search-modal hidden';
                searchModal.id = 'search-modal';
                document.body.appendChild(searchModal);
            }

            // Hidden div for bingo popup
            const bingoPopup = document.createElement('div');
            bingoPopup.className = 'bingo-popup hidden';
            bingoPopup.id = 'bingo-popup';
            document.body.appendChild(bingoPopup);
        },

        /**
         * Copy the OBS overlay URL to clipboard
         */
        _copyOverlayUrl(btn) {
            const currentUrl = new URL(window.location.href);
            const lang = this._getCurrentLang();
            currentUrl.searchParams.set('overlay', '1');
            currentUrl.searchParams.set('lang', lang);
            navigator.clipboard.writeText(currentUrl.toString()).then(() => {
                btn.textContent = '✅ Copied!';
                setTimeout(() => {
                    if (btn) {
                        btn.textContent = '📋 Get OBS Overlay URL';
                    }
                }, 1500);
            });
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

            // Switch button (top-right) - only created if NOT locked and NOT overlay
            if (!this.gameManager.locked && !this.isOverlay) {
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
                    <div style="display:flex;gap:8px;margin-bottom:8px;">
                        <input type="text" class="bingo-search-input" id="modal-search-input" placeholder="Search..." autofocus style="flex:1;">
                        <button class="btn btn-secondary" id="modal-random-btn" data-i18n="bingo.random_item" title="Random item">${lang === 'fr' ? '🎲 Aléatoire' : '🎲 Random'}</button>
                    </div>
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

            // Random item button
            document.getElementById('modal-random-btn').addEventListener('click', () => {
                const randomItem = this.gameManager.allItems[Math.floor(Math.random() * this.gameManager.allItems.length)];
                this.gameManager.cells[index].item = randomItem;
                if (this.gameManager.isQuantizable) {
                    const qInput = document.getElementById('modal-quantity-input');
                    if (qInput) {
                        const num = parseInt(qInput.value);
                        this.gameManager.cells[index].quantity = (!isNaN(num) && num > 0) ? num : 0;
                    } else {
                        this.gameManager.cells[index].quantity = this.gameManager._randomQuantityForItem(randomItem);
                    }
                }
                this.refreshCells();
                this.updateUrl();
                modal.classList.add('hidden');
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
        },

        /**
         * Get help text for OBS setup
         */
        _getObsHelpText() {
            const lang = this._getCurrentLang();
            return lang === 'fr'
                ? 'Ajouter une source navigateur avec l\'url copiée via le bouton, de largeur 900, hauteur 930. Pour intéragir avec la grille, clic droit sur la source navigateur > Intéragir.'
                : 'Add a Browser Source with the copied URL, width 900, height 930. To interact, right-click the Browser Source > Interact.';
        },

        /**
         * Show OBS help as an alert
         */
        _showObsHelp() {
            alert(this._getObsHelpText());
        },

        /**
         * Open custom CSS popup with color pickers and preview
         */
        _openCustomCssPopup() {
            const lang = this._getCurrentLang();
            const isDark = document.documentElement.getAttribute('data-theme') !== 'light';

            // Default values based on theme
            const defaults = {
                bg: isDark ? 'rgba(15,52,96,1)' : 'rgba(255,255,255,1)',
                bgValidated: 'rgba(233,69,96,0.2)',
                border: 'rgba(233,69,96,1)'
            };

            // Parse defaults into components
            const parseRgba = (str) => {
                const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
                if (!m) return { r: 0, g: 0, b: 0, a: 1 };
                return { r: parseInt(m[1]), g: parseInt(m[2]), b: parseInt(m[3]), a: m[4] !== undefined ? parseFloat(m[4]) : 1 };
            };

            // Format as hex (without alpha)
            const rgbToHex = (r, g, b) => '#' + [r,g,b].map(c => Math.round(c).toString(16).padStart(2,'0')).join('');

            // Format as rgba string
            const toRgba = (r,g,b,a) => `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;

            // Current state
            const state = {
                bg: parseRgba(defaults.bg),
                bgv: parseRgba(defaults.bgValidated),
                border: parseRgba(defaults.border)
            };

            // Build overlay
            const overlay = document.createElement('div');
            overlay.className = 'search-modal'; // reuse existing modal style
            overlay.style.zIndex = '700';
            overlay.id = 'css-picker-overlay';

            const content = document.createElement('div');
            content.className = 'search-modal-content';
            content.style.maxWidth = '650px';
            content.style.backgroundColor = 'rgba(40, 40, 45, 0.95)';

            const title = document.createElement('h3');
            title.textContent = lang === 'fr' ? 'CSS Personnalisé' : 'Custom CSS';
            title.style.marginBottom = '16px';
            content.appendChild(title);

            // Preview row with 2 example cells
            const previewRow = document.createElement('div');
            previewRow.style.cssText = 'display:flex;gap:16px;justify-content:center;margin-bottom:20px;';

            const createPreviewCell = (label, isValidated) => {
                const cell = document.createElement('div');
                cell.className = 'bingo-cell';
                if (isValidated) cell.classList.add('validated');
                cell.style.cssText = 'width:120px;height:120px;aspect-ratio:1;cursor:default;display:flex;flex-direction:column;align-items:center;justify-content:center;';
                const img = document.createElement('div');
                img.style.cssText = 'width:60%;height:60%;background:#ccc;border-radius:4px;margin-bottom:4px;';
                img.textContent = '📷';
                img.style.cssText = 'width:60%;height:60%;display:flex;align-items:center;justify-content:center;font-size:2rem;';
                cell.appendChild(img);
                const name = document.createElement('span');
                name.className = 'cell-name';
                name.textContent = label;
                cell.appendChild(name);
                return cell;
            };

            const cellUnchecked = createPreviewCell(lang === 'fr' ? 'Pas encore' : 'Not yet', false);
            const cellChecked = createPreviewCell(lang === 'fr' ? 'Obtenu' : 'Got', true);
            previewRow.appendChild(cellUnchecked);
            previewRow.appendChild(cellChecked);
            content.appendChild(previewRow);

            // Color pickers
            const pickersDiv = document.createElement('div');
            pickersDiv.style.cssText = 'display:flex;flex-direction:column;gap:12px;margin-bottom:16px;';

            const createColorRow = (label, rgbaState, onChange) => {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;';

                const lbl = document.createElement('label');
                lbl.style.cssText = 'min-width:140px;font-weight:600;font-size:0.85rem;';
                lbl.textContent = label;
                row.appendChild(lbl);

                const hexInput = document.createElement('input');
                hexInput.type = 'color';
                hexInput.value = rgbToHex(rgbaState.r, rgbaState.g, rgbaState.b);
                hexInput.style.cssText = 'width:40px;height:40px;border:none;padding:0;cursor:pointer;background:none;';
                row.appendChild(hexInput);

                const alphaLabel = document.createElement('span');
                alphaLabel.style.fontSize = '0.8rem';
                alphaLabel.textContent = lang === 'fr' ? 'Alpha:' : 'Alpha:';
                row.appendChild(alphaLabel);

                const alphaInput = document.createElement('input');
                alphaInput.type = 'range';
                alphaInput.min = '0';
                alphaInput.max = '100';
                alphaInput.value = Math.round(rgbaState.a * 100);
                alphaInput.style.cssText = 'width:80px;cursor:pointer;';
                row.appendChild(alphaInput);

                const alphaVal = document.createElement('span');
                alphaVal.style.fontSize = '0.8rem';
                alphaVal.textContent = Math.round(rgbaState.a * 100) + '%';
                row.appendChild(alphaVal);

                const update = () => {
                    const hex = hexInput.value;
                    const r = parseInt(hex.substring(1,3), 16);
                    const g = parseInt(hex.substring(3,5), 16);
                    const b = parseInt(hex.substring(5,7), 16);
                    const a = parseInt(alphaInput.value) / 100;
                    rgbaState.r = r; rgbaState.g = g; rgbaState.b = b; rgbaState.a = a;
                    alphaVal.textContent = Math.round(a * 100) + '%';
                    onChange(r, g, b, a);
                };

                hexInput.addEventListener('input', update);
                alphaInput.addEventListener('input', update);

                return row;
            };

            // Update preview cells
            const applyStyles = () => {
                const bgStr = toRgba(state.bg.r, state.bg.g, state.bg.b, state.bg.a);
                const bgvStr = toRgba(state.bgv.r, state.bgv.g, state.bgv.b, state.bgv.a);
                const borderStr = toRgba(state.border.r, state.border.g, state.border.b, state.border.a);

                cellUnchecked.style.backgroundColor = bgStr;
                cellUnchecked.style.borderColor = 'var(--border)';
                cellChecked.style.backgroundColor = bgvStr;
                cellChecked.style.borderColor = borderStr;

                // Update code block
                updateCode(bgStr, bgvStr, borderStr);
            };

            // BG non-validated
            pickersDiv.appendChild(createColorRow(
                lang === 'fr' ? 'Fond (pas obtenu)' : 'Background (not got)',
                state.bg, () => applyStyles()
            ));
            // BG validated
            pickersDiv.appendChild(createColorRow(
                lang === 'fr' ? 'Fond (obtenu)' : 'Background (got)',
                state.bgv, () => applyStyles()
            ));
            // Border
            pickersDiv.appendChild(createColorRow(
                lang === 'fr' ? 'Bordure' : 'Border',
                state.border, () => applyStyles()
            ));

            content.appendChild(pickersDiv);

            // Code display
            const codeLabel = document.createElement('p');
            codeLabel.style.cssText = 'font-size:0.85rem;font-weight:600;margin-bottom:6px;';
            codeLabel.textContent = lang === 'fr' ? 'Code CSS à copier :' : 'CSS code to copy:';
            content.appendChild(codeLabel);

            const codeBlock = document.createElement('pre');
            codeBlock.id = 'css-code-block';
            codeBlock.style.cssText = 'background:var(--bg-secondary);border:1px solid var(--border);border-radius:6px;padding:12px;font-size:0.8rem;overflow-x:auto;white-space:pre-wrap;word-break:break-all;margin-bottom:12px;';
            content.appendChild(codeBlock);

            const updateCode = (bgStr, bgvStr, borderStr) => {
                const c1 = lang === 'fr' ? '/* Pas encore obtenu */' : '/* Not yet got */';
                const c2 = lang === 'fr' ? '/* Obtenu */' : '/* Got */';
                const cBg = lang === 'fr' ? '/* fond */' : '/* background */';
                const cBdr = lang === 'fr' ? '/* bordure */' : '/* border */';
                codeBlock.textContent = `body { background-color: rgba(0, 0, 0, 0); margin: 0px auto; overflow: hidden; }\n\n${c1}\n.bingo-cell { background-color: ${bgStr}; }\n\n${c2}\n.bingo-cell.validated {\n  ${cBg}\n  background-color: ${bgvStr};\n  ${cBdr}\n  border-color: ${borderStr};\n}`;
            };

            // Buttons row
            const btnRow = document.createElement('div');
            btnRow.style.cssText = 'display:flex;gap:8px;margin-top:8px;';

            const copyBtn = document.createElement('button');
            copyBtn.className = 'btn btn-primary';
            copyBtn.textContent = lang === 'fr' ? '📋 Copier le CSS' : '📋 Copy CSS';
            copyBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(codeBlock.textContent).then(() => {
                    copyBtn.textContent = '✅ ' + (lang === 'fr' ? 'Copié!' : 'Copied!');
                    setTimeout(() => { copyBtn.textContent = lang === 'fr' ? '📋 Copier le CSS' : '📋 Copy CSS'; }, 1500);
                });
            });
            btnRow.appendChild(copyBtn);

            // Help button for where to paste
            const cssHelp = document.createElement('button');
            cssHelp.className = 'btn btn-secondary';
            cssHelp.textContent = '?';
            cssHelp.style.cssText = 'width:28px;height:28px;padding:0;font-weight:700;border-radius:50%;font-size:0.9rem;';
            cssHelp.title = lang === 'fr'
                ? 'À ajouter dans la partie CSS personnalisé de la source navigateur OBS'
                : 'Add this to the Custom CSS section of the OBS Browser Source';
            cssHelp.addEventListener('click', () => {
                alert(cssHelp.title);
            });
            btnRow.appendChild(cssHelp);

            // Close button
            const closeBtn = document.createElement('button');
            closeBtn.className = 'btn btn-secondary';
            closeBtn.textContent = lang === 'fr' ? 'Fermer' : 'Close';
            closeBtn.addEventListener('click', () => overlay.remove());
            btnRow.appendChild(closeBtn);

            content.appendChild(btnRow);

            overlay.appendChild(content);
            document.body.appendChild(overlay);

            // Initial apply
            applyStyles();

            // Close on outside click
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) overlay.remove();
            });
        }
    };

    autobingo.BingoGridRenderer = BingoGridRenderer;

})(window.AutoBingo = window.AutoBingo || {});
