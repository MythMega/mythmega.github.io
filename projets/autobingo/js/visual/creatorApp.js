/**
 * Bingo Dataset Creator — standalone mini-app
 * AutoBingo.CreatorApp
 */
(function(autobingo) {
    'use strict';

    const CreatorApp = {
        /** @type {Object} Current dataset state */
        data: null,
        /** @type {Array} Item rows (each with internal ID and ui fields) */
        items: [],
        /** @type {number} Auto-increment counter for items */
        _nextItemId: 1,
        /** @type {Object} Image check cache {url: 'valid'|'invalid'|'checking'} */
        _imgCache: {},
        /** @type {number} Refresh counter for redraw */
        _updateCounter: 0,
        /** @type {Object} Flag definitions from metadata/flags.json */
        _flagDefs: null,

        /**
         * Initialize the creator
         */
        init() {
            this._resetData();
            this.render();
        },

        /**
         * Reset dataset to blank state
         */
        _resetData() {
            this.data = {
                name: '',
                category: '',
                subcategory: '',
                quantizable: false,
                defaultMin: 1,
                defaultMax: 999,
                flags: ['Custom']
            };
            this.items = [];
            this._nextItemId = 1;
            this._imgCache = {};
            // Add one empty row by default
            this._addEmptyItem();
        },

        /**
         * Create an empty item object
         * @returns {Object}
         */
        _createEmptyItem() {
            return {
                id: this._nextItemId++,
                index: '',
                nameFr: '',
                nameEn: '',
                pictureMain: '',
                qtyMode: 'default',
                qtyMin: 1,
                qtyMax: 999,
                imgStatus: null
            };
        },

        /**
         * Add an empty item row directly to the DOM
         */
        _addEmptyItem() {
            const newItem = this._createEmptyItem();
            this.items.push(newItem);

            // Append row directly to the existing tbody
            const tbody = document.querySelector('#creator-items-table tbody');
            if (tbody) {
                const row = this._createItemRow(newItem);
                tbody.appendChild(row);
            } else {
                // Fallback: full re-render
                this._fullRender();
            }

            this._updateFloatCounter();

            // Scroll to bottom
            requestAnimationFrame(() => {
                const tableWrap = document.querySelector('.creator-items-table-wrap');
                if (tableWrap) {
                    tableWrap.scrollTop = tableWrap.scrollHeight;
                }
                const itemsSection = document.querySelector('.creator-section:last-child');
                if (itemsSection) {
                    itemsSection.scrollIntoView({ behavior: 'smooth', block: 'end' });
                }
            });
        },

        /**
         * Delete an item row by its id directly from the DOM
         */
        _deleteItem(id) {
            if (this.items.length <= 1) return; // keep at least one
            this.items = this.items.filter(it => it.id !== id);

            // Remove row directly from DOM
            const row = document.querySelector(`tr[data-item-id="${id}"]`);
            if (row) {
                row.remove();
            } else {
                // Fallback: full re-render
                this._fullRender();
            }

            this._updateFloatCounter();
        },

        /**
         * Suggest an index from a name
         */
        _suggestIndex(name) {
            if (!name) return '';
            return name
                .toLowerCase()
                .replace(/[^a-z0-9\s-]/g, '')
                .replace(/\s+/g, '-')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, '');
        },

        /**
         * Check image URL validity
         */
        _checkImage(url, itemId) {
            if (!url) {
                this._setImgStatus(itemId, null);
                return;
            }
            if (this._imgCache[url] === 'valid') {
                this._setImgStatus(itemId, 'valid');
                return;
            }
            if (this._imgCache[url] === 'invalid') {
                this._setImgStatus(itemId, 'invalid');
                return;
            }

            this._imgCache[url] = 'checking';
            this._setImgStatus(itemId, 'checking');

            const img = new Image();
            img.onload = () => {
                this._imgCache[url] = 'valid';
                this._setImgStatus(itemId, 'valid');
            };
            img.onerror = () => {
                this._imgCache[url] = 'invalid';
                this._setImgStatus(itemId, 'invalid');
            };
            img.src = url;
        },

        /**
         * Set image status for an item and update the specific row's image span and badge
         */
        _setImgStatus(itemId, status) {
            const item = this.items.find(it => it.id === itemId);
            if (!item) return;
            item.imgStatus = status;

            // Update the image status span directly
            const span = document.getElementById(`img-status-${itemId}`);
            if (span) {
                this._updateImgStatusSpan(span, item);
            }

            // Update the status badge on the row (including warnings)
            const row = document.querySelector(`tr[data-item-id="${itemId}"]`);
            if (row) {
                this._updateRowValidState(row, item);
            }

            this._updateFloatCounter();
        },

        /**
         * Import from an existing dataset (loads the JSON)
         */
        async importFromDataset(defName) {
            const dm = new autobingo.DatasetManager();
            await dm.loadDefinitions();
            const def = dm.getDatasetByName(defName);
            if (!def) return;

            const rawResp = await fetch(def.location);
            const raw = await rawResp.json();

            // Fill metadata
            this.data.name = raw.Name || def.name;
            this.data.category = raw.Category || def.category;
            this.data.subcategory = raw.Subcategory || def.subcategory;
            this.data.quantizable = raw.Quantizable === true;
            this.data.defaultMin = (raw.DefaultQuantities && raw.DefaultQuantities.Min) || 1;
            this.data.defaultMax = (raw.DefaultQuantities && raw.DefaultQuantities.Max) || 999;
            this.data.flags = Array.isArray(raw.Flags) && raw.Flags.length > 0 ? [...raw.Flags] : ['Custom'];

            // Fill items
            this.items = (raw.Items || []).map(rawItem => {
                const itemQ = rawItem.Quantity || {};
                let qtyMode = 'default';
                if (itemQ.Min !== undefined || itemQ.Max !== undefined) {
                    if ((itemQ.Min === 1 && itemQ.Max === 1) || (itemQ.Min === undefined && itemQ.Max === 1) || (itemQ.Min === 1 && itemQ.Max === undefined)) {
                        qtyMode = 'unique';
                    } else {
                        qtyMode = 'custom';
                    }
                }
                return {
                    id: this._nextItemId++,
                    index: rawItem.Index != null ? String(rawItem.Index) : '',
                    nameFr: rawItem.Name_FR || '',
                    nameEn: rawItem.Name_EN || '',
                    pictureMain: rawItem.PictureMain || '',
                    qtyMode: qtyMode,
                    qtyMin: itemQ.Min !== undefined ? itemQ.Min : 1,
                    qtyMax: itemQ.Max !== undefined ? itemQ.Max : 1
                };
            });

            if (this.items.length === 0) {
                this._addEmptyItem();
            }

            // Pre-check images
            this.items.forEach(it => {
                if (it.pictureMain) {
                    this._checkImage(it.pictureMain, it.id);
                }
            });

            // Full re-render to update metadata fields AND items
            this.render();
        },

        /**
         * Build the final JSON object for download
         */
        _buildJson() {
            const itemsJson = this.items
                .filter(it => it.nameEn.trim() || it.nameFr.trim())
                .map(it => {
                    const entry = {};
                    if (it.index) entry.Index = isNaN(Number(it.index)) ? it.index : Number(it.index);
                    if (it.nameFr) entry.Name_FR = it.nameFr;
                    if (it.nameEn) entry.Name_EN = it.nameEn;
                    if (it.pictureMain) entry.PictureMain = it.pictureMain;

                    // Quantity
                    if (this.data.quantizable) {
                        if (it.qtyMode === 'unique') {
                            entry.Quantity = { Min: 1, Max: 1 };
                        } else if (it.qtyMode === 'custom') {
                            const q = {};
                            if (it.qtyMin !== this.data.defaultMin || it.qtyMax !== this.data.defaultMax) {
                                if (it.qtyMin !== this.data.defaultMin && it.qtyMin !== 1) q.Min = it.qtyMin;
                                if (it.qtyMax !== this.data.defaultMax && it.qtyMax !== 999) q.Max = it.qtyMax;
                            }
                            if (Object.keys(q).length > 0) entry.Quantity = q;
                        }
                        // 'default' mode: no per-item quantity
                    }

                    return entry;
                });

            const result = {
                Name: this.data.name || 'Untitled Dataset',
                Category: this.data.category || 'General',
                Subcategory: this.data.subcategory || 'General'
            };

            if (this.data.quantizable) {
                result.Quantizable = true;
                result.DefaultQuantities = {
                    Min: this.data.defaultMin,
                    Max: this.data.defaultMax
                };
            }

            if (this.data.flags && this.data.flags.length > 0) {
                result.Flags = this.data.flags.filter(f => f && f.trim());
            }

            result.Items = itemsJson;
            return result;
        },

        /**
         * Download the dataset as JSON file
         */
        downloadJson() {
            const json = this._buildJson();
            const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const filename = (this.data.name || 'dataset').replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.json';
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        },

        /**
         * Render the whole UI
         */
        render() {
            const container = document.getElementById('creator-app');
            if (!container) return;
            container.innerHTML = '';

            // --- Floating counter bar (remove old one first) ---
            const oldFloatBar = document.getElementById('creator-float-bar');
            if (oldFloatBar) oldFloatBar.remove();

            const floatBar = document.createElement('div');
            floatBar.className = 'creator-float-bar';
            floatBar.id = 'creator-float-bar';

            const countSpan = document.createElement('span');
            countSpan.className = 'creator-item-count';
            countSpan.id = 'creator-item-count';
            countSpan.textContent = `0 items`;
            floatBar.appendChild(countSpan);

            const downloadBtn = document.createElement('button');
            downloadBtn.className = 'btn btn-primary';
            downloadBtn.setAttribute('data-i18n', 'creator.download');
            downloadBtn.textContent = 'Download JSON';
            downloadBtn.addEventListener('click', () => this.downloadJson());
            floatBar.appendChild(downloadBtn);

            document.body.appendChild(floatBar);

            // --- Layout ---
            const layout = document.createElement('div');
            layout.className = 'creator-layout';

            // === Section: Metadata ===
            const metaSection = this._renderMetaSection();
            layout.appendChild(metaSection);

            // === Section: Items ===
            const itemsSection = this._renderItemsSection();
            layout.appendChild(itemsSection);

            container.appendChild(layout);

            this._updateFloatCounter();
            if (autobingo.translationManager) {
                setTimeout(() => autobingo.translationManager.translatePage(), 0);
            }
        },

        /**
         * Render metadata section
         */
        _renderMetaSection() {
            const section = document.createElement('div');
            section.className = 'creator-section';

            const h3 = document.createElement('h3');
            h3.setAttribute('data-i18n', 'creator.meta_title');
            h3.textContent = 'Dataset Metadata';
            section.appendChild(h3);

            const grid = document.createElement('div');
            grid.className = 'creator-meta-grid';

            // Name
            const nameField = this._makeField('Name', 'creator.name', this.data.name, val => {
                this.data.name = val;
            });
            nameField.classList.add('field-full');
            grid.appendChild(nameField);

            // Category
            const catField = this._makeField('Category', 'creator.category', this.data.category, val => {
                this.data.category = val;
            });
            grid.appendChild(catField);

            // Subcategory
            const subField = this._makeField('Subcategory', 'creator.subcategory', this.data.subcategory, val => {
                this.data.subcategory = val;
            });
            grid.appendChild(subField);

            section.appendChild(grid);

            // Import bar
            const importBar = document.createElement('div');
            importBar.className = 'creator-import-bar';
            importBar.style.marginTop = '16px';
            importBar.style.borderTop = '1px solid var(--border)';
            importBar.style.paddingTop = '16px';
            importBar.style.display = 'flex';
            importBar.style.flexDirection = 'column';
            importBar.style.gap = '8px';

            const importLabel = document.createElement('span');
            importLabel.setAttribute('data-i18n', 'creator.import_label');
            importLabel.textContent = 'Import from:';
            importLabel.style.fontWeight = '600';
            importLabel.style.fontSize = '0.85rem';
            importBar.appendChild(importLabel);

            const searchInput = document.createElement('input');
            searchInput.type = 'text';
            searchInput.placeholder = 'Search dataset...';
            searchInput.className = 'styled-select';
            searchInput.style.flex = '1';
            searchInput.style.maxWidth = '300px';
            searchInput.style.padding = '8px 10px';
            importBar.appendChild(searchInput);

            const dsSelect = document.createElement('select');
            dsSelect.className = 'styled-select';
            dsSelect.style.flex = '1';
            dsSelect.style.maxWidth = '300px';
            dsSelect.size = Math.min(8, 20);
            const placeholderOpt = document.createElement('option');
            placeholderOpt.value = '';
            placeholderOpt.textContent = '-- Dataset --';
            dsSelect.appendChild(placeholderOpt);
            importBar.appendChild(dsSelect);

            const importBtn = document.createElement('button');
            importBtn.className = 'btn btn-secondary';
            importBtn.setAttribute('data-i18n', 'creator.import_btn');
            importBtn.textContent = 'Import';
            importBtn.addEventListener('click', async () => {
                const name = dsSelect.value;
                if (!name) return;
                await this.importFromDataset(name);
            });
            importBar.appendChild(importBtn);

            // Load datasets for the select (with search filter)
            let allDefs = [];
            (async () => {
                const dm = new autobingo.DatasetManager();
                await dm.loadDefinitions();
                allDefs = dm.definitions;
                const renderOptions = (filterText = '') => {
                    dsSelect.innerHTML = '';
                    const placeholder = document.createElement('option');
                    placeholder.value = '';
                    placeholder.textContent = '-- Dataset --';
                    dsSelect.appendChild(placeholder);
                    const text = filterText.toLowerCase();
                    allDefs
                        .filter(def => !text || def.name.toLowerCase().includes(text))
                        .forEach(def => {
                            const opt = document.createElement('option');
                            opt.value = def.name;
                            opt.textContent = def.name;
                            dsSelect.appendChild(opt);
                        });
                };
                renderOptions();
                searchInput.addEventListener('input', () => {
                    renderOptions(searchInput.value);
                });
            })();

            section.appendChild(importBar);

            // Quantizable toggle
            const qRow = document.createElement('div');
            qRow.className = 'creator-toggle-row';
            qRow.style.marginTop = '16px';
            const qCheck = document.createElement('input');
            qCheck.type = 'checkbox';
            qCheck.id = 'creator-quantizable';
            qCheck.checked = this.data.quantizable;
            qCheck.addEventListener('change', () => {
                this.data.quantizable = qCheck.checked;
                this.render();
            });
            const qLabel = document.createElement('label');
            qLabel.htmlFor = 'creator-quantizable';
            qLabel.setAttribute('data-i18n', 'creator.quantizable');
            qLabel.textContent = 'Quantizable';
            qRow.appendChild(qCheck);
            qRow.appendChild(qLabel);
            section.appendChild(qRow);

            // Default quantities (shown if quantizable)
            if (this.data.quantizable) {
                const qDefaults = document.createElement('div');
                qDefaults.className = 'creator-quantity-defaults';

                const minLbl = document.createElement('label');
                minLbl.setAttribute('data-i18n', 'creator.default_min');
                minLbl.textContent = 'Default Min:';
                const minInput = document.createElement('input');
                minInput.type = 'number';
                minInput.value = this.data.defaultMin;
                minInput.min = '1';
                minInput.addEventListener('change', () => {
                    this.data.defaultMin = parseInt(minInput.value) || 1;
                });

                const maxLbl = document.createElement('label');
                maxLbl.setAttribute('data-i18n', 'creator.default_max');
                maxLbl.textContent = 'Default Max:';
                const maxInput = document.createElement('input');
                maxInput.type = 'number';
                maxInput.value = this.data.defaultMax;
                maxInput.min = '1';
                maxInput.addEventListener('change', () => {
                    this.data.defaultMax = parseInt(maxInput.value) || 999;
                });

                qDefaults.appendChild(minLbl);
                qDefaults.appendChild(minInput);
                qDefaults.appendChild(maxLbl);
                qDefaults.appendChild(maxInput);
                section.appendChild(qDefaults);
            }

            // Flags section
            const flagsRow = document.createElement('div');
            flagsRow.className = 'creator-flags-row';
            flagsRow.style.marginTop = '16px';
            flagsRow.style.borderTop = '1px solid var(--border)';
            flagsRow.style.paddingTop = '16px';

            const flagsLabel = document.createElement('span');
            flagsLabel.textContent = 'Flags:';
            flagsLabel.style.fontWeight = '600';
            flagsLabel.style.fontSize = '0.85rem';
            flagsRow.appendChild(flagsLabel);

            const flagsList = document.createElement('div');
            flagsList.className = 'creator-flags-list';
            flagsList.style.display = 'flex';
            flagsList.style.flexWrap = 'wrap';
            flagsList.style.gap = '8px';
            flagsList.style.marginTop = '8px';
            flagsList.style.marginBottom = '8px';

            const renderFlags = () => {
                flagsList.innerHTML = '';
                (this.data.flags || []).forEach((flag, idx) => {
                    const chip = document.createElement('span');
                    chip.className = 'creator-flag-chip';
                    chip.textContent = flag;
                    chip.style.display = 'inline-flex';
                    chip.style.alignItems = 'center';
                    chip.style.gap = '6px';
                    chip.style.padding = '4px 8px';
                    chip.style.borderRadius = '999px';
                    chip.style.background = 'var(--surface-hover)';
                    chip.style.border = '1px solid var(--border)';
                    chip.style.fontSize = '0.85rem';

                    const removeBtn = document.createElement('button');
                    removeBtn.textContent = '✕';
                    removeBtn.style.background = 'transparent';
                    removeBtn.style.border = 'none';
                    removeBtn.style.color = 'inherit';
                    removeBtn.style.cursor = 'pointer';
                    removeBtn.style.fontSize = '0.75rem';
                    removeBtn.addEventListener('click', () => {
                        this.data.flags.splice(idx, 1);
                        renderFlags();
                    });
                    chip.appendChild(removeBtn);
                    flagsList.appendChild(chip);
                });
            };

            const addFlag = () => {
                const val = flagInput.value.trim();
                if (!val) return;
                if (!this.data.flags.includes(val)) {
                    this.data.flags.push(val);
                }
                flagInput.value = '';
                renderFlags();
            };

            const flagInput = document.createElement('input');
            flagInput.type = 'text';
            flagInput.placeholder = 'Add flag...';
            flagInput.style.flex = '1';
            flagInput.style.minWidth = '140px';
            flagInput.style.padding = '6px 10px';
            flagInput.style.borderRadius = '6px';
            flagInput.style.border = '1px solid var(--border)';
            flagInput.style.background = 'var(--surface)';
            flagInput.style.color = 'var(--text)';
            flagInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') addFlag();
            });

            const addFlagBtn = document.createElement('button');
            addFlagBtn.className = 'btn btn-secondary';
            addFlagBtn.textContent = 'Add';
            addFlagBtn.addEventListener('click', addFlag);

            flagsRow.appendChild(flagsList);
            flagsRow.appendChild(flagInput);
            flagsRow.appendChild(addFlagBtn);
            section.appendChild(flagsRow);

            renderFlags();

            return section;
        },

        /**
         * Render items section
         */
        _renderItemsSection() {
            const section = document.createElement('div');
            section.className = 'creator-section';

            const headerRow = document.createElement('div');
            headerRow.style.display = 'flex';
            headerRow.style.justifyContent = 'space-between';
            headerRow.style.alignItems = 'center';
            headerRow.style.marginBottom = '12px';

            const h3 = document.createElement('h3');
            h3.style.marginBottom = '0';
            h3.setAttribute('data-i18n', 'creator.items_title');
            h3.textContent = 'Items';
            headerRow.appendChild(h3);

            const addBtn = document.createElement('button');
            addBtn.className = 'btn btn-secondary';
            addBtn.setAttribute('data-i18n', 'creator.add_item');
            addBtn.textContent = '+ Add Item';
            addBtn.addEventListener('click', () => {
                this._addEmptyItem();
            });
            headerRow.appendChild(addBtn);

            section.appendChild(headerRow);

            // Table
            const tableWrap = document.createElement('div');
            tableWrap.className = 'creator-items-table-wrap';

            const table = document.createElement('table');
            table.className = 'creator-items-table';
            table.id = 'creator-items-table';

            const thead = document.createElement('thead');
            const tr = document.createElement('tr');

            const colDefs = [
                { key: 'index', label: 'Index' },
                { key: 'nameFr', label: 'Name FR' },
                { key: 'nameEn', label: 'Name EN' },
                { key: 'pictureMain', label: 'Picture' },
                { key: 'qty', label: 'Image' }
            ];

            if (this.data.quantizable) {
                colDefs.push({ key: 'qtyMode', label: 'Quantity' });
                colDefs.push({ key: 'qtyMin', label: 'Q.Min' });
                colDefs.push({ key: 'qtyMax', label: 'Q.Max' });
            }

            colDefs.push({ key: 'valid', label: 'Status' });
            colDefs.push({ key: 'delete', label: '' });

            colDefs.forEach(col => {
                const th = document.createElement('th');
                if (col.key === 'delete' || col.key === 'valid' || col.key === 'image') {
                    th.className = 'col-actions';
                }
                th.textContent = col.label;
                tr.appendChild(th);
            });

            thead.appendChild(tr);
            table.appendChild(thead);

            const tbody = document.createElement('tbody');
            this.items.forEach(item => {
                const row = this._createItemRow(item);
                tbody.appendChild(row);
            });
            table.appendChild(tbody);
            tableWrap.appendChild(table);
            section.appendChild(tableWrap);

            return section;
        },

        /**
         * Create a table row for an item
         */
        _createItemRow(item) {
            const row = document.createElement('tr');
            row.dataset.itemId = item.id;

            // Check if item is "valid" (has at least nameEn or nameFr + valid image)
            const isComplete = this._isItemComplete(item);
            if (isComplete) {
                row.classList.add('creator-item-valid-row');
            }

            // Index
            const tdIdx = document.createElement('td');
            const idxInput = document.createElement('input');
            idxInput.type = 'text';
            idxInput.value = item.index;
            idxInput.placeholder = 'auto';
            idxInput.addEventListener('input', () => {
                item.index = idxInput.value;
                this._updateRowValidState(row, item);
                this._updateFloatCounter();
            });
            // On name change, suggest index if not manually set
            tdIdx.appendChild(idxInput);
            row.appendChild(tdIdx);

            // Name FR
            const tdFr = document.createElement('td');
            const frInput = document.createElement('input');
            frInput.type = 'text';
            frInput.value = item.nameFr;
            frInput.placeholder = 'French name';
            frInput.addEventListener('input', () => {
                item.nameFr = frInput.value;
                this._updateRowValidState(row, item);
                this._updateFloatCounter();
            });
            tdFr.appendChild(frInput);
            row.appendChild(tdFr);

            // Name EN
            const tdEn = document.createElement('td');
            const enInput = document.createElement('input');
            enInput.type = 'text';
            enInput.value = item.nameEn;
            enInput.placeholder = 'English name';
            enInput.addEventListener('input', () => {
                item.nameEn = enInput.value;
                // Auto-suggest index from English name
                if (!item.index || item.index === this._suggestIndex(item.nameEn.substring(0, item.nameEn.length - 1))) {
                    idxInput.value = this._suggestIndex(item.nameEn);
                    item.index = idxInput.value;
                }
                this._updateRowValidState(row, item);
                this._updateFloatCounter();
            });
            tdEn.appendChild(enInput);
            row.appendChild(tdEn);

            // Picture
            const tdPic = document.createElement('td');
            const picInput = document.createElement('input');
            picInput.type = 'text';
            picInput.value = item.pictureMain;
            picInput.placeholder = 'https://...';
            picInput.addEventListener('input', () => {
                item.pictureMain = picInput.value;
                this._checkImage(item.pictureMain, item.id);
                this._updateRowValidState(row, item);
            });
            tdPic.appendChild(picInput);
            row.appendChild(tdPic);

            // Image status icon
            const tdImg = document.createElement('td');
            const statusSpan = document.createElement('span');
            statusSpan.className = 'creator-table-img-status';
            statusSpan.id = `img-status-${item.id}`;
            this._updateImgStatusSpan(statusSpan, item);
            tdImg.appendChild(statusSpan);
            row.appendChild(tdImg);

            // Quantity columns (only if quantizable)
            if (this.data.quantizable) {
                // Quantity mode select
                const tdQMode = document.createElement('td');
                const qModeSel = document.createElement('select');
                const modes = [
                    { value: 'default', labelKey: 'creator.qty_default', label: 'Default' },
                    { value: 'unique', labelKey: 'creator.qty_unique', label: 'Unique (1)' },
                    { value: 'custom', labelKey: 'creator.qty_custom', label: 'Custom' }
                ];
                modes.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m.value;
                    opt.setAttribute('data-i18n', m.labelKey);
                    opt.textContent = m.label;
                    if (item.qtyMode === m.value) opt.selected = true;
                    qModeSel.appendChild(opt);
                });
                qModeSel.addEventListener('change', () => {
                    item.qtyMode = qModeSel.value;
                    // Refresh to show/hide min/max (use _fullRender to preserve scroll)
                    this._fullRender();
                });
                tdQMode.appendChild(qModeSel);
                row.appendChild(tdQMode);

                // Q.Min
                const tdQMin = document.createElement('td');
                const qMinInput = document.createElement('input');
                qMinInput.type = 'number';
                qMinInput.value = item.qtyMin;
                qMinInput.min = '1';
                qMinInput.disabled = item.qtyMode !== 'custom';
                qMinInput.addEventListener('change', () => {
                    item.qtyMin = parseInt(qMinInput.value) || 1;
                });
                tdQMin.appendChild(qMinInput);
                row.appendChild(tdQMin);

                // Q.Max
                const tdQMax = document.createElement('td');
                const qMaxInput = document.createElement('input');
                qMaxInput.type = 'number';
                qMaxInput.value = item.qtyMax;
                qMaxInput.min = '1';
                qMaxInput.disabled = item.qtyMode !== 'custom';
                qMaxInput.addEventListener('change', () => {
                    item.qtyMax = parseInt(qMaxInput.value) || 1;
                });
                tdQMax.appendChild(qMaxInput);
                row.appendChild(tdQMax);
            }

            // Status badge (with warnings)
            const tdValid = document.createElement('td');
            tdValid.className = 'col-actions';
            const validBadge = this._createStatusBadge(item);
            tdValid.appendChild(validBadge);
            row.appendChild(tdValid);

            // Delete button
            const tdDel = document.createElement('td');
            tdDel.className = 'col-actions';
            const delBtn = document.createElement('button');
            delBtn.className = 'creator-item-del-btn';
            delBtn.textContent = '✕';
            delBtn.title = 'Delete item';
            delBtn.addEventListener('click', () => {
                this._deleteItem(item.id);
            });
            tdDel.appendChild(delBtn);
            row.appendChild(tdDel);

            return row;
        },

        /**
         * Check if an item is complete
         */
        _isItemComplete(item) {
            const hasName = item.nameEn.trim() || item.nameFr.trim();
            const hasImg = item.imgStatus === 'valid';
            return hasName && hasImg;
        },

        /**
         * Get warnings for an item
         * @param {Object} item
         * @returns {string[]} Array of warning messages
         */
        _getItemWarnings(item) {
            const warnings = [];
            const lang = autobingo.translationManager ? autobingo.translationManager.currentLang : 'en';

            if (!item.nameEn.trim() && !item.nameFr.trim()) {
                warnings.push(lang === 'fr' ? 'Nom manquant (EN et FR)' : 'Missing name (EN and FR)');
            } else if (!item.nameEn.trim()) {
                warnings.push(lang === 'fr' ? 'Nom anglais manquant' : 'Missing English name');
            } else if (!item.nameFr.trim()) {
                warnings.push(lang === 'fr' ? 'Nom français manquant' : 'Missing French name');
            }

            if (item.index) {
                const duplicate = this.items.some(other => other.id !== item.id && other.index === item.index);
                if (duplicate) {
                    warnings.push(lang === 'fr' ? `ID dupliqué : "${item.index}"` : `Duplicate ID: "${item.index}"`);
                }
            }

            return warnings;
        },

        /**
         * Get the status type for an item: 'valid', 'warning', or 'incomplete'
         */
        _getItemStatus(item) {
            const hasName = item.nameEn.trim() || item.nameFr.trim();
            const hasImg = item.imgStatus === 'valid';
            const warnings = this._getItemWarnings(item);

            if (hasName && hasImg && warnings.length === 0) {
                return 'valid';
            }
            if (hasName && warnings.length > 0) {
                return 'warning';
            }
            return 'incomplete';
        },

        /**
         * Create a status badge element for an item (valid/warning/incomplete with tooltip)
         */
        _createStatusBadge(item) {
            const status = this._getItemStatus(item);
            const badge = document.createElement('span');
            badge.className = 'creator-item-valid-badge';
            badge.id = `valid-badge-${item.id}`;

            if (status === 'valid') {
                badge.textContent = '✓ OK';
                badge.style.backgroundColor = '#4caf50';
            } else if (status === 'warning') {
                badge.textContent = '⚠';
                badge.style.backgroundColor = '#ff9800';
                const warnings = this._getItemWarnings(item);
                badge.title = warnings.join('\n');
            } else {
                badge.textContent = '—';
                badge.style.display = 'none';
            }

            return badge;
        },

        /**
         * Update row visual valid state (including warnings)
         */
        _updateRowValidState(row, item) {
            const complete = this._isItemComplete(item);
            const status = this._getItemStatus(item);
            row.classList.toggle('creator-item-valid-row', complete);

            const badge = row.querySelector('.creator-item-valid-badge');
            if (badge) {
                if (status === 'valid') {
                    badge.textContent = '✓ OK';
                    badge.style.backgroundColor = '#4caf50';
                    badge.style.display = '';
                } else if (status === 'warning') {
                    badge.textContent = '⚠';
                    badge.style.backgroundColor = '#ff9800';
                    badge.style.display = '';
                    const warnings = this._getItemWarnings(item);
                    badge.title = warnings.join('\n');
                } else {
                    badge.textContent = '—';
                    badge.style.display = 'none';
                }
            }
        },

        /**
         * Update image status span
         */
        _updateImgStatusSpan(span, item) {
            const status = item.imgStatus;
            span.className = 'creator-table-img-status';
            if (status === 'valid') {
                span.textContent = '✓';
                span.classList.add('creator-img-valid');
            } else if (status === 'invalid') {
                span.textContent = '✗';
                span.classList.add('creator-img-invalid');
            } else if (status === 'checking') {
                span.textContent = '⟳';
                span.classList.add('creator-img-checking');
            } else {
                span.textContent = '?';
            }
        },

        /**
         * Update global UI after changes
         */
        _updateUI() {
            // Update each row's status badge and image icon directly without destroying inputs
            this.items.forEach(item => {
                const row = document.querySelector(`tr[data-item-id="${item.id}"]`);
                if (!row) {
                    // Row doesn't exist yet, trigger full re-render
                    this._fullRender();
                    return;
                }
                // Update row state (including warnings)
                this._updateRowValidState(row, item);

                // Update image status span
                const span = document.getElementById(`img-status-${item.id}`);
                if (span) {
                    this._updateImgStatusSpan(span, item);
                }
            });
            this._updateFloatCounter();
        },

        /**
         * Full re-render (preserves metadata state and scroll position)
         */
        _fullRender() {
            // Save scroll positions
            const tableWrap = document.querySelector('.creator-items-table-wrap');
            let scrollTop = tableWrap ? tableWrap.scrollTop : 0;
            let parentScrollTop = window.scrollY;

            const oldItemsSection = document.querySelector('.creator-section:last-child');
            if (oldItemsSection) {
                const newSection = this._renderItemsSection();
                oldItemsSection.parentNode.replaceChild(newSection, oldItemsSection);
            }
            this._updateFloatCounter();

            // Restore scroll positions
            requestAnimationFrame(() => {
                const newTableWrap = document.querySelector('.creator-items-table-wrap');
                if (newTableWrap) newTableWrap.scrollTop = scrollTop;
                window.scrollTo(0, parentScrollTop);
            });

            // Re-attach image statuses
            this.items.forEach(item => {
                const span = document.getElementById(`img-status-${item.id}`);
                if (span) {
                    this._updateImgStatusSpan(span, item);
                }
            });
        },

        /**
         * Update the floating counter
         */
        _updateFloatCounter() {
            const counter = document.getElementById('creator-item-count');
            if (!counter) return;
            const complete = this.items.filter(it => this._isItemComplete(it)).length;
            const total = this.items.length;
            const lang = autobingo.translationManager ? autobingo.translationManager.currentLang : 'en';
            if (lang === 'fr') {
                counter.textContent = `${complete}/${total} éléments valides`;
            } else {
                counter.textContent = `${complete}/${total} valid items`;
            }
        },

        /**
         * Helper: create a labeled input field
         */
        _makeField(name, i18nKey, value, onChange) {
            const div = document.createElement('div');
            div.className = 'creator-field';
            const label = document.createElement('label');
            label.setAttribute('data-i18n', i18nKey);
            label.textContent = name;
            const input = document.createElement('input');
            input.type = 'text';
            input.value = value;
            input.addEventListener('input', () => {
                onChange(input.value);
            });
            div.appendChild(label);
            div.appendChild(input);
            return div;
        }
    };

    autobingo.CreatorApp = CreatorApp;

})(window.AutoBingo = window.AutoBingo || {});