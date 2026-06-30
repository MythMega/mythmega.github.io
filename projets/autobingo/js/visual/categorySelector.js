/**
 * Cascading category → subcategory → dataset selector with grid size
 * AutoBingo.CategorySelector
 */
(function(autobingo) {
    'use strict';

    const GRID_SIZES = [3, 4, 5, 6, 7];
    const DEFAULT_SIZE = 5;

    class CategorySelector {
        /**
         * @param {HTMLElement} container - Container element
         * @param {autobingo.DatasetManager} datasetManager - Dataset manager instance
         */
        constructor(container, datasetManager) {
            this.container = container;
            this.datasetManager = datasetManager;
            this.categorySelect = null;
            this.subcategorySelect = null;
            this.datasetSelect = null;
            this.sizeSelect = null;
            this.infoDisplay = null;
            this.warningDisplay = null;
            this.onReady = null; // callback when a dataset is fully selected
            this._currentItems = null;
        }

        /**
         * Render the three-level selector + grid size
         */
        async render() {
            this.container.innerHTML = '';

            // Info display for item count
            this.infoDisplay = document.createElement('p');
            this.infoDisplay.className = 'dataset-info';
            this.infoDisplay.setAttribute('data-i18n', 'create.select_category');
            this.container.appendChild(this.infoDisplay);

            // Warning display for duplicates
            this.warningDisplay = document.createElement('p');
            this.warningDisplay.className = 'dataset-warning hidden';
            this.warningDisplay.setAttribute('data-i18n', 'create.duplicate_warning');
            this.container.appendChild(this.warningDisplay);

            // Category select
            this.categorySelect = this._createSelect('category', 'create.select_category', 'create.no_category');
            this.container.appendChild(this.categorySelect);

            // Subcategory select
            this.subcategorySelect = this._createSelect('subcategory', 'create.select_subcategory', 'create.no_subcategory');
            this.subcategorySelect.disabled = true;
            this.container.appendChild(this.subcategorySelect);

            // Dataset select - custom dropdown with quantity badges
            this.datasetSelect = this._createDatasetSelect();

            // Grid size select
            this.sizeSelect = this._createSizeSelect();
            this.container.appendChild(this.sizeSelect);

            // Populate categories
            const categories = this.datasetManager.getCategories();
            categories.forEach(cat => {
                const opt = document.createElement('option');
                opt.value = cat;
                opt.textContent = cat;
                this.categorySelect.appendChild(opt);
            });

            // Event handlers
            this.categorySelect.addEventListener('change', () => this._onCategoryChange());
            this.subcategorySelect.addEventListener('change', () => this._onSubcategoryChange());
            this.datasetSelect.addEventListener('change', () => this._onDatasetChange());
            this.sizeSelect.addEventListener('change', () => this._onSizeChange());

            // Auto-select from URL
            await this._autoSelectFromUrl();
        }

        /**
         * Create a grid size select
         */
        _createSizeSelect() {
            const wrapper = document.createElement('div');
            wrapper.className = 'select-wrapper';

            const label = document.createElement('label');
            label.setAttribute('data-i18n', 'create.select_size');
            wrapper.appendChild(label);

            const select = document.createElement('select');
            select.name = 'gridSize';
            select.className = 'styled-select';

            GRID_SIZES.forEach(size => {
                const opt = document.createElement('option');
                opt.value = size;
                const totalCells = size * size;
                // We'll store the count as data attribute for dynamic i18n
                opt.textContent = `${size}x${size} (${totalCells} ${this._getItemsText()})`;
                if (size === DEFAULT_SIZE) {
                    opt.selected = true;
                }
                select.appendChild(opt);
            });

            wrapper.appendChild(select);
            this.container.appendChild(wrapper);

            if (autobingo.translationManager) {
                setTimeout(() => autobingo.translationManager.translatePage(), 0);
            }

            return select;
        }

        /**
         * Get localized "items" text
         * @returns {string}
         */
        _getItemsText() {
            if (autobingo.translationManager) {
                return autobingo.translationManager.currentLang === 'fr' ? 'éléments' : 'items';
            }
            return 'items';
        }

        /**
         * Refresh grid size option labels to match current language
         */
        refreshSizeLabels() {
            if (!this.sizeSelect) return;
            const options = this.sizeSelect.options;
            for (let i = 0; i < options.length; i++) {
                const size = parseInt(options[i].value);
                if (isNaN(size)) continue;
                const totalCells = size * size;
                options[i].textContent = `${size}x${size} (${totalCells} ${this._getItemsText()})`;
            }
        }

        /**
         * Create a styled select element
         */
        _createSelect(name, labelKey, placeholderKey) {
            const wrapper = document.createElement('div');
            wrapper.className = 'select-wrapper';

            const label = document.createElement('label');
            label.setAttribute('data-i18n', labelKey);
            wrapper.appendChild(label);

            const select = document.createElement('select');
            select.name = name;
            select.className = 'styled-select';

            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.disabled = true;
            placeholder.selected = true;
            placeholder.setAttribute('data-i18n', placeholderKey);
            select.appendChild(placeholder);

            wrapper.appendChild(select);
            this.container.appendChild(wrapper);

            if (autobingo.translationManager) {
                setTimeout(() => autobingo.translationManager.translatePage(), 0);
            }

            return select;
        }

        /**
         * Load metadata/flags.json definitions (cached)
         * @returns {Promise<Object>} Map of flag name -> {color, text: {FR, EN}}
         */
        async _loadFlagDefs() {
            if (this._flagDefsCache) return this._flagDefsCache;
            try {
                const resp = await fetch('metadata/flags.json');
                const list = await resp.json();
                const map = {};
                list.forEach(f => { map[f.Name] = f; });
                this._flagDefsCache = map;
                return map;
            } catch (e) {
                return {};
            }
        }

        /**
         * Create a custom dataset dropdown with quantity badges
         * @returns {HTMLElement} The custom dropdown root element
         */
        _createDatasetSelect() {
            const wrapper = document.createElement('div');
            wrapper.className = 'select-wrapper dataset-select-wrapper';

            const label = document.createElement('label');
            label.setAttribute('data-i18n', 'create.select_dataset');
            wrapper.appendChild(label);

            // Custom dropdown container
            const dropdown = document.createElement('div');
            dropdown.className = 'custom-dataset-dropdown';

            // Trigger button (looks like a select)
            const trigger = document.createElement('button');
            trigger.type = 'button';
            trigger.className = 'custom-dataset-trigger';
            trigger.disabled = true;
            trigger.setAttribute('data-i18n', 'create.no_dataset');
            trigger.textContent = '-- Select a dataset --';

            // Options list
            const optionsList = document.createElement('div');
            optionsList.className = 'custom-dataset-options hidden';

            dropdown.appendChild(trigger);
            dropdown.appendChild(optionsList);
            wrapper.appendChild(dropdown);
            this.container.appendChild(wrapper);

            // Store references
            this._datasetDropdown = dropdown;
            this._datasetTrigger = trigger;
            this._datasetOptionsList = optionsList;

            // Toggle dropdown on click
            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                if (trigger.disabled) return;
                optionsList.classList.toggle('hidden');
            });

            // Close on outside click
            document.addEventListener('click', () => {
                optionsList.classList.add('hidden');
            });

            if (autobingo.translationManager) {
                setTimeout(() => autobingo.translationManager.translatePage(), 0);
            }

            return dropdown;
        }

        /**
         * Update dataset select options, adding flag badges then quantizable badge
         * @param {Array} datasets - Array of DatasetDefinition
         */
        async _populateDatasetOptions(datasets) {
            const optionsList = this._datasetOptionsList;
            optionsList.innerHTML = '';

            const lang = autobingo.translationManager ? autobingo.translationManager.currentLang : 'en';
            const qLabel = lang === 'fr' ? 'avec quantité' : 'with quantity';

            // Fetch flag definitions (colors, translations) once
            const flagDefs = await this._loadFlagDefs();

            datasets.forEach(ds => {
                const item = document.createElement('div');
                item.className = 'custom-dataset-option';
                item.dataset.value = ds.name;

                const nameSpan = document.createElement('span');
                nameSpan.className = 'custom-dataset-option-name';
                nameSpan.textContent = ds.name;
                item.appendChild(nameSpan);

                // Flag badges (add before quantity) — flags are directly on ds.flags
                const dsFlags = ds.flags || [];
                dsFlags.forEach(flagName => {
                    const flagDef = flagDefs[flagName];
                    if (!flagDef) return;
                    const badge = document.createElement('span');
                    badge.className = 'dataset-flag-badge';
                    badge.textContent = lang === 'fr' ? (flagDef.TextDisplay.FR || flagName) : (flagDef.TextDisplay.EN || flagName);
                    if (flagDef.Color) {
                        badge.style.backgroundColor = flagDef.Color;
                    }
                    item.appendChild(badge);
                });

                // Quantity badge (after flags)
                if (ds.quantizable === true) {
                    const badge = document.createElement('span');
                    badge.className = 'dataset-qty-badge';
                    badge.textContent = qLabel;
                    item.appendChild(badge);
                }

                item.addEventListener('click', () => {
                    this._datasetTrigger.textContent = ds.name;
                    this._datasetTrigger.dataset.value = ds.name;
                    optionsList.classList.add('hidden');
                    this._onDatasetChange();
                });

                optionsList.appendChild(item);
            });

            this._datasetTrigger.disabled = false;

            if (autobingo.translationManager) {
                setTimeout(() => autobingo.translationManager.translatePage(), 0);
            }
        }

        /**
         * Handle category change
         */
        async _onCategoryChange() {
            const cat = this.categorySelect.value;
            this.subcategorySelect.innerHTML = '';
            if (this._datasetOptionsList) this._datasetOptionsList.innerHTML = '';
            if (this._datasetTrigger) {
                this._datasetTrigger.textContent = '-- Select a dataset --';
                this._datasetTrigger.dataset.value = '';
                this._datasetTrigger.disabled = true;
            }
            this._currentItems = null;
            this._hideWarning();

            if (!cat) {
                this.subcategorySelect.disabled = true;
                this.infoDisplay.setAttribute('data-i18n', 'create.select_category');
                if (autobingo.translationManager) autobingo.translationManager.translatePage();
                return;
            }

            const subcategories = this.datasetManager.getSubcategories(cat);
            subcategories.forEach(sub => {
                const opt = document.createElement('option');
                opt.value = sub;
                opt.textContent = sub;
                this.subcategorySelect.appendChild(opt);
            });
            this.subcategorySelect.disabled = false;

            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.disabled = true;
            placeholder.selected = true;
            placeholder.setAttribute('data-i18n', 'create.no_subcategory');
            this.subcategorySelect.insertBefore(placeholder, this.subcategorySelect.firstChild);
            if (autobingo.translationManager) autobingo.translationManager.translatePage();

            this.infoDisplay.setAttribute('data-i18n', 'create.select_subcategory');
            if (autobingo.translationManager) autobingo.translationManager.translatePage();

            autobingo.NavigationManager.removeParam('Dataset');

            // Auto-select if only one subcategory
            if (subcategories.length === 1) {
                this.subcategorySelect.value = subcategories[0];
                await this._onSubcategoryChange();
            }
        }

        /**
         * Handle subcategory change
         */
        async _onSubcategoryChange() {
            const cat = this.categorySelect.value;
            const sub = this.subcategorySelect.value;
            if (this._datasetOptionsList) this._datasetOptionsList.innerHTML = '';
            if (this._datasetTrigger) {
                this._datasetTrigger.textContent = '-- Select a dataset --';
                this._datasetTrigger.dataset.value = '';
                this._datasetTrigger.disabled = true;
            }
            this._currentItems = null;
            this._hideWarning();

            if (!cat || !sub) {
                this.datasetSelect.disabled = true;
                this.infoDisplay.setAttribute('data-i18n', 'create.select_subcategory');
                if (autobingo.translationManager) autobingo.translationManager.translatePage();
                return;
            }

            const datasets = this.datasetManager.getDatasets(cat, sub);
            await this._populateDatasetOptions(datasets);

            this.infoDisplay.setAttribute('data-i18n', 'create.select_dataset');
            if (autobingo.translationManager) autobingo.translationManager.translatePage();

            autobingo.NavigationManager.removeParam('Dataset');

            // Auto-select if only one dataset
            if (datasets.length === 1) {
                const ds = datasets[0];
                this._datasetTrigger.textContent = ds.name;
                this._datasetTrigger.dataset.value = ds.name;
                await this._onDatasetChange(ds.name);
            }
        }

        /**
         * Handle dataset change
         * @param {string} [forcedName] - Optional dataset name for programmatic selection
         */
        async _onDatasetChange(forcedName) {
            const name = forcedName || (this._datasetTrigger ? this._datasetTrigger.dataset.value : null);
            this._currentItems = null;
            this._hideWarning();

            if (!name) {
                this.infoDisplay.setAttribute('data-i18n', 'create.select_dataset');
                if (autobingo.translationManager) autobingo.translationManager.translatePage();
                return;
            }

            // Update URL
            autobingo.NavigationManager.setParam('Dataset', name);

            // Load and display item count
            const def = this.datasetManager.getDatasetByName(name);
            if (def) {
                const items = await this.datasetManager.loadDatasetItems(def);
                this._currentItems = items;
                if (autobingo.translationManager) {
                    this.infoDisplay.textContent = autobingo.translationManager.t('create.items_count', { count: items.length });
                } else {
                    this.infoDisplay.textContent = `Items available: ${items.length}`;
                }

                this._checkDuplicateWarning();

                if (this.onReady) {
                    this.onReady(def, items);
                }
            }
        }

        /**
         * Handle grid size change
         */
        _onSizeChange() {
            this._checkDuplicateWarning();
        }

        /**
         * Check if grid size exceeds items count and show warning
         */
        _checkDuplicateWarning() {
            if (!this._currentItems || !this.sizeSelect) return;

            const size = parseInt(this.sizeSelect.value);
            const needed = size * size;
            const available = this._currentItems.length;

            if (needed > available) {
                this.warningDisplay.classList.remove('hidden');
                // Update warning text with counts
                const lang = autobingo.translationManager ? autobingo.translationManager.currentLang : 'en';
                if (lang === 'fr') {
                    this.warningDisplay.textContent = `⚠️ Attention : seulement ${available} éléments disponibles pour ${needed} cases. Des doublons seront générés.`;
                } else {
                    this.warningDisplay.textContent = `⚠️ Warning: only ${available} items available for ${needed} cells. Duplicates will be generated.`;
                }
            } else {
                this._hideWarning();
            }
        }

        /**
         * Hide warning
         */
        _hideWarning() {
            this.warningDisplay.classList.add('hidden');
        }

        /**
         * Try to auto-select a dataset from URL parameter
         */
        async _autoSelectFromUrl() {
            // Check for grid size in URL
            const sizeParam = autobingo.NavigationManager.getParam('Size');
            if (sizeParam) {
                const size = parseInt(sizeParam);
                if (GRID_SIZES.includes(size) && this.sizeSelect) {
                    // Find the option with this value
                    for (const opt of this.sizeSelect.options) {
                        if (parseInt(opt.value) === size) {
                            this.sizeSelect.value = size;
                            break;
                        }
                    }
                }
            }

            const datasetName = autobingo.NavigationManager.getParam('Dataset');
            if (!datasetName) return;

            const def = this.datasetManager.getDatasetByName(datasetName);
            if (!def) return;

            // Set category
            this.categorySelect.value = def.category;
            await this._onCategoryChange();

            // Small delay for DOM update, then set subcategory
            await new Promise(r => setTimeout(r, 50));
            this.subcategorySelect.value = def.subcategory;
            await this._onSubcategoryChange();

            // Set dataset
            await new Promise(r => setTimeout(r, 50));
            this.datasetSelect.value = def.name;
            await this._onDatasetChange();

            // Restore control checkboxes from URL
            const controlsParam = autobingo.NavigationManager.getParam('controls');
            if (controlsParam && controlsParam.length === 3) {
                const lockCb = document.getElementById('ctrl-lock');
                const hideCb = document.getElementById('ctrl-hide');
                const blurCb = document.getElementById('ctrl-blur');
                if (lockCb) lockCb.checked = controlsParam[0] === '1';
                if (hideCb) hideCb.checked = controlsParam[1] === '1';
                if (blurCb) blurCb.checked = controlsParam[2] === '1';
            }
        }

        /**
         * Get currently selected dataset definition
         * @returns {DatasetDefinition|null}
         */
        getSelectedDataset() {
            const name = this._datasetTrigger ? this._datasetTrigger.dataset.value : null;
            return name ? this.datasetManager.getDatasetByName(name) : null;
        }

        /**
         * Get selected grid size
         * @returns {number}
         */
        getSelectedSize() {
            return this.sizeSelect ? parseInt(this.sizeSelect.value) : DEFAULT_SIZE;
        }
    }

    autobingo.CategorySelector = CategorySelector;

})(window.AutoBingo = window.AutoBingo || {});