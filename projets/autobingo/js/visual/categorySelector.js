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

            // Dataset select
            this.datasetSelect = this._createSelect('dataset', 'create.select_dataset', 'create.no_dataset');
            this.datasetSelect.disabled = true;
            this.container.appendChild(this.datasetSelect);

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
         * Handle category change
         */
        _onCategoryChange() {
            const cat = this.categorySelect.value;
            this.subcategorySelect.innerHTML = '';
            this.datasetSelect.innerHTML = '';
            this.datasetSelect.disabled = true;
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
            this.subcategorySelect.value = '';

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
        }

        /**
         * Handle subcategory change
         */
        _onSubcategoryChange() {
            const cat = this.categorySelect.value;
            const sub = this.subcategorySelect.value;
            this.datasetSelect.innerHTML = '';
            this._currentItems = null;
            this._hideWarning();

            if (!cat || !sub) {
                this.datasetSelect.disabled = true;
                this.infoDisplay.setAttribute('data-i18n', 'create.select_subcategory');
                if (autobingo.translationManager) autobingo.translationManager.translatePage();
                return;
            }

            const datasets = this.datasetManager.getDatasets(cat, sub);
            datasets.forEach(ds => {
                const opt = document.createElement('option');
                opt.value = ds.name;
                opt.textContent = ds.name;
                this.datasetSelect.appendChild(opt);
            });
            this.datasetSelect.disabled = false;

            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.disabled = true;
            placeholder.selected = true;
            placeholder.setAttribute('data-i18n', 'create.no_dataset');
            this.datasetSelect.insertBefore(placeholder, this.datasetSelect.firstChild);
            if (autobingo.translationManager) autobingo.translationManager.translatePage();

            this.infoDisplay.setAttribute('data-i18n', 'create.select_dataset');
            if (autobingo.translationManager) autobingo.translationManager.translatePage();

            autobingo.NavigationManager.removeParam('Dataset');
        }

        /**
         * Handle dataset change
         */
        async _onDatasetChange() {
            const name = this.datasetSelect.value;
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
            this._onCategoryChange();

            // Small delay for DOM update, then set subcategory
            await new Promise(r => setTimeout(r, 50));
            this.subcategorySelect.value = def.subcategory;
            this._onSubcategoryChange();

            // Set dataset
            await new Promise(r => setTimeout(r, 50));
            this.datasetSelect.value = def.name;
            await this._onDatasetChange();
        }

        /**
         * Get currently selected dataset definition
         * @returns {DatasetDefinition|null}
         */
        getSelectedDataset() {
            const name = this.datasetSelect ? this.datasetSelect.value : null;
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