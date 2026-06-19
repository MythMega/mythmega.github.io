/**
 * Renders the dataset viewer page with sortable/filterable table
 * AutoBingo.DatasetViewer
 */
(function(autobingo) {
    'use strict';

    const DatasetViewer = {
        container: null,
        datasetManager: null,
        items: [],
        currentDefinition: null,
        filterValues: {},
        sortColumn: null,
        sortAsc: true,
        hideValidImages: false,
        imageStatus: {},

        /**
         * Initialize
         * @param {HTMLElement} container
         * @param {autobingo.DatasetManager} datasetManager
         */
        init(container, datasetManager) {
            this.container = container;
            this.datasetManager = datasetManager;
            this.container.innerHTML = '<p data-i18n="dataset.select_hint">Select a dataset to view</p>';
            if (autobingo.translationManager) {
                setTimeout(() => autobingo.translationManager.translatePage(), 0);
            }
        },

        /**
         * Called when a dataset is selected
         * @param {Array} items
         * @param {autobingo.DatasetDefinition} definition
         */
        async onDatasetSelected(items, definition) {
            this.items = items;
            this.currentDefinition = definition;
            this.imageStatus = {};
            this.filterValues = {};
            this.sortColumn = null;
            this.sortAsc = true;
            this.hideValidImages = false;
            await this._preloadImages();
            this.render();
        },

        /**
         * Check if current dataset is quantizable
         * @returns {boolean}
         */
        _isQuantizable() {
            return this.currentDefinition && this.currentDefinition.quantizable === true;
        },

        /**
         * Get resolved Min/Max for an item (respecting item-level override)
         * @param {autobingo.DatasetItem} item
         * @returns {{min: number, max: number}}
         */
        _getQuantityBounds(item) {
            const def = this.currentDefinition;
            const defaults = (def && def.defaultQuantities) || { Min: 1, Max: 999 };
            const itemQ = item.quantity || {};
            const min = itemQ.Min !== undefined ? itemQ.Min : (defaults.Min !== undefined ? defaults.Min : 1);
            const max = itemQ.Max !== undefined ? itemQ.Max : (defaults.Max !== undefined ? defaults.Max : 999);
            return { min, max };
        },

        /**
         * Preload all images to check which ones are valid
         */
        async _preloadImages() {
            const promises = [];
            for (let i = 0; i < this.items.length; i++) {
                const item = this.items[i];
                promises.push(
                    this._checkImage(item.pictureMain).then(ok => {
                        this.imageStatus[`main_${i}`] = ok;
                    })
                );
                promises.push(
                    this._checkImage(item.pictureAlt).then(ok => {
                        this.imageStatus[`alt_${i}`] = ok;
                    })
                );
            }
            await Promise.all(promises);
        },

        /**
         * Check if an image URL loads
         */
        _checkImage(url) {
            if (!url) return Promise.resolve(false);
            return new Promise(resolve => {
                const img = new Image();
                img.onload = () => resolve(true);
                img.onerror = () => resolve(false);
                img.src = url;
            });
        },

        /**
         * Render the table
         */
        render() {
            this.container.innerHTML = '';

            // --- Quantizable info bar ---
            const isQuantizable = this._isQuantizable();
            if (isQuantizable) {
                const def = this.currentDefinition;
                const defaults = def.defaultQuantities || { Min: 1, Max: 999 };
                const lang = autobingo.translationManager ? autobingo.translationManager.currentLang : 'en';

                const infoBar = document.createElement('div');
                infoBar.className = 'quantizable-info-bar';
                infoBar.style.cssText = 'margin-bottom:12px;padding:8px 14px;background:rgba(220,20,20,0.1);border:1px solid rgba(220,20,20,0.3);border-radius:8px;font-size:0.9rem;';

                const icon = document.createElement('span');
                icon.textContent = '🔢 ';
                infoBar.appendChild(icon);

                const label = document.createElement('strong');
                label.textContent = lang === 'fr' ? 'Dataset quantifiable' : 'Quantizable dataset';
                infoBar.appendChild(label);

                infoBar.appendChild(document.createTextNode(' — '));

                const minMax = document.createElement('span');
                minMax.textContent = lang === 'fr'
                    ? `Quantités par défaut : Min ${defaults.Min}, Max ${defaults.Max}`
                    : `Default quantities: Min ${defaults.Min}, Max ${defaults.Max}`;
                infoBar.appendChild(minMax);

                this.container.appendChild(infoBar);
            }

            // Controls bar
            const controls = document.createElement('div');
            controls.className = 'dataset-viewer-controls';

            const totalLabel = document.createElement('span');
            totalLabel.className = 'dataset-total';
            controls.appendChild(totalLabel);

            const hideLabel = document.createElement('label');
            hideLabel.className = 'bingo-toggle dataset-hide-toggle';
            const hideCheck = document.createElement('input');
            hideCheck.type = 'checkbox';
            hideCheck.checked = this.hideValidImages;
            hideCheck.addEventListener('change', () => {
                this.hideValidImages = hideCheck.checked;
                this.render();
            });
            const hideSpan = document.createElement('span');
            hideSpan.textContent = 'Hide valid images';
            hideLabel.appendChild(hideCheck);
            hideLabel.appendChild(hideSpan);
            controls.appendChild(hideLabel);
            this.container.appendChild(controls);

            // Get filtered data
            let filtered = this._getFilteredData();

            if (this.hideValidImages) {
                const hidden = this.items.length - filtered.length;
                totalLabel.textContent = `${filtered.length} / ${this.items.length} items (${hidden} hidden)`;
            } else {
                totalLabel.textContent = `${this.items.length} items`;
            }

            // Table
            const table = document.createElement('table');
            table.className = 'dataset-table';
            table.id = 'dataset-table';

            // Render header
            const thead = document.createElement('thead');
            const tr = document.createElement('tr');

            // Columns config
            const columns = [
                { key: 'index', label: 'Index', filter: true },
                { key: 'nameEn', label: 'Name EN', filter: true },
                { key: 'nameFr', label: 'Name FR', filter: true },
                { key: 'pictureMain', label: 'Picture Main', filter: false },
                { key: 'pictureAlt', label: 'Picture Alt', filter: false }
            ];

            if (isQuantizable) {
                columns.push({ key: 'qtyMin', label: 'Min', filter: false });
                columns.push({ key: 'qtyMax', label: 'Max', filter: false });
            }

            columns.forEach(col => {
                const th = document.createElement('th');
                
                // Sort label
                const label = document.createElement('span');
                label.className = 'dataset-th-label';
                label.dataset.column = col.key;
                label.textContent = col.label;
                if (col.filter) {
                    label.style.cursor = 'pointer';
                    if (this.sortColumn === col.key) {
                        label.textContent += this.sortAsc ? ' ▲' : ' ▼';
                    }
                }
                th.appendChild(label);

                // Filter input
                if (col.filter) {
                    const inp = document.createElement('input');
                    inp.type = 'text';
                    inp.className = 'dataset-filter-input';
                    inp.dataset.column = col.key;
                    inp.value = this.filterValues[col.key] || '';
                    th.appendChild(inp);
                }

                tr.appendChild(th);
            });
            thead.appendChild(tr);
            table.appendChild(thead);

            // Body
            const tbody = document.createElement('tbody');
            filtered.forEach((item, idx) => {
                const row = document.createElement('tr');
                const origIdx = this.items.indexOf(item);

                // Index
                const td0 = document.createElement('td');
                td0.textContent = item.index != null ? item.index : '-';
                row.appendChild(td0);

                // Name EN
                const td1 = document.createElement('td');
                td1.textContent = item.nameEn;
                row.appendChild(td1);

                // Name FR
                const td2 = document.createElement('td');
                td2.textContent = item.nameFr || item.nameEn;
                row.appendChild(td2);

                // Picture Main
                const td3 = document.createElement('td');
                if (item.pictureMain) {
                    const copyBtn = this._createCopyFilenameBtn(item.pictureMain);
                    td3.appendChild(copyBtn);
                    const img = document.createElement('img');
                    img.className = 'dataset-thumb';
                    img.src = item.pictureMain;
                    img.loading = 'lazy';
                    td3.appendChild(img);
                    const path = document.createElement('div');
                    path.className = 'dataset-img-path';
                    path.textContent = item.pictureMain.length > 45 ? item.pictureMain.substring(0, 45) + '...' : item.pictureMain;
                    td3.appendChild(path);
                } else {
                    td3.textContent = '/';
                }
                row.appendChild(td3);

                // Picture Alt
                const td4 = document.createElement('td');
                if (item.pictureAlt) {
                    const copyBtn = this._createCopyFilenameBtn(item.pictureAlt);
                    td4.appendChild(copyBtn);
                    const img = document.createElement('img');
                    img.className = 'dataset-thumb';
                    img.src = item.pictureAlt;
                    img.loading = 'lazy';
                    td4.appendChild(img);
                    const path = document.createElement('div');
                    path.className = 'dataset-img-path';
                    path.textContent = item.pictureAlt.length > 45 ? item.pictureAlt.substring(0, 45) + '...' : item.pictureAlt;
                    td4.appendChild(path);
                } else {
                    td4.textContent = '/';
                }
                row.appendChild(td4);

                // Quantizable columns: Min / Max
                if (isQuantizable) {
                    const bounds = this._getQuantityBounds(item);
                    
                    // Min
                    const tdMin = document.createElement('td');
                    tdMin.style.textAlign = 'center';
                    tdMin.style.fontWeight = '600';
                    tdMin.textContent = bounds.min;
                    row.appendChild(tdMin);

                    // Max
                    const tdMax = document.createElement('td');
                    tdMax.style.textAlign = 'center';
                    tdMax.style.fontWeight = '600';
                    tdMax.textContent = bounds.max;
                    row.appendChild(tdMax);
                }

                tbody.appendChild(row);
            });
            table.appendChild(tbody);
            this.container.appendChild(table);

            // Copy indices button below table
            const copyIndicesWrapper = document.createElement('div');
            copyIndicesWrapper.style.marginTop = '12px';
            copyIndicesWrapper.style.textAlign = 'right';
            const copyIndicesBtn = document.createElement('button');
            copyIndicesBtn.className = 'btn btn-secondary';
            copyIndicesBtn.textContent = '📋 Copy displayed indices';
            copyIndicesBtn.addEventListener('click', () => {
                const displayedIndices = filtered.map(item => {
                    const origIdx = this.items.indexOf(item);
                    return this.items[origIdx].index != null ? this.items[origIdx].index : null;
                }).filter(i => i !== null);
                const jsonStr = JSON.stringify(displayedIndices);
                navigator.clipboard.writeText(jsonStr).then(() => {
                    copyIndicesBtn.textContent = '✅ Copied!';
                    setTimeout(() => { copyIndicesBtn.textContent = '📋 Copy displayed indices'; }, 1500);
                }).catch(() => {
                    const ta = document.createElement('textarea');
                    ta.value = jsonStr;
                    ta.style.position = 'fixed';
                    ta.style.left = '-9999px';
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                    copyIndicesBtn.textContent = '✅ Copied!';
                    setTimeout(() => { copyIndicesBtn.textContent = '📋 Copy displayed indices'; }, 1500);
                });
            });
            copyIndicesWrapper.appendChild(copyIndicesBtn);
            this.container.appendChild(copyIndicesWrapper);

            // Bind events on the table using delegation
            this._bindTableEvents();
        },

        /**
         * Bind events on the table using delegation
         */
        _bindTableEvents() {
            const table = document.getElementById('dataset-table');
            if (!table) return;

            // Sort click - delegation on .dataset-th-label
            table.addEventListener('click', (e) => {
                const label = e.target.closest('.dataset-th-label');
                if (!label || !label.dataset.column) return;
                const col = label.dataset.column;
                if (col === 'pictureMain' || col === 'pictureAlt' || col === 'qtyMin' || col === 'qtyMax') return;
                if (this.sortColumn === col) {
                    this.sortAsc = !this.sortAsc;
                } else {
                    this.sortColumn = col;
                    this.sortAsc = true;
                }
                this.render();
            });

            // Filter input - delegation
            table.addEventListener('input', (e) => {
                const inp = e.target.closest('.dataset-filter-input');
                if (!inp || !inp.dataset.column) return;
                this.filterValues[inp.dataset.column] = inp.value;
                // Debounce rendering
                clearTimeout(this._filterTimer);
                this._filterTimer = setTimeout(() => this.render(), 200);
            });
        },

        /**
         * Extract filename from URL without extension
         * @param {string} url
         * @returns {string}
         */
        _extractFilename(url) {
            let filename = url.split('/').pop() || '';
            filename = filename.split('?')[0];
            const dotIndex = filename.lastIndexOf('.');
            if (dotIndex > 0) {
                filename = filename.substring(0, dotIndex);
            }
            return filename;
        },

        /**
         * Create a button that copies the filename to clipboard
         * @param {string} url - The image URL
         * @returns {HTMLElement}
         */
        _createCopyFilenameBtn(url) {
            const btn = document.createElement('button');
            btn.className = 'dataset-copy-btn';
            btn.textContent = '📋 Copy filename';
            btn.title = this._extractFilename(url);
            btn.addEventListener('click', () => {
                const filename = this._extractFilename(url);
                navigator.clipboard.writeText(filename).then(() => {
                    btn.textContent = '✅ Copied!';
                    setTimeout(() => {
                        btn.textContent = '📋 Copy filename';
                    }, 1500);
                }).catch(() => {
                    const textarea = document.createElement('textarea');
                    textarea.value = filename;
                    textarea.style.position = 'fixed';
                    textarea.style.left = '-9999px';
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textarea);
                    btn.textContent = '✅ Copied!';
                    setTimeout(() => {
                        btn.textContent = '📋 Copy filename';
                    }, 1500);
                });
            });
            return btn;
        },

        /**
         * Get filtered and sorted data
         */
        _getFilteredData() {
            let data = [...this.items];

            // Apply filters
            for (const [key, value] of Object.entries(this.filterValues)) {
                if (!value) continue;
                const q = value.toLowerCase();
                data = data.filter(item => {
                    let field = '';
                    if (key === 'index') field = String(item.index != null ? item.index : '-');
                    else if (key === 'nameEn') field = item.nameEn || '';
                    else if (key === 'nameFr') field = item.nameFr || '';
                    return field.toLowerCase().includes(q);
                });
            }

            // Hide valid images
            if (this.hideValidImages) {
                data = data.filter(item => {
                    const origIdx = this.items.indexOf(item);
                    const mainOk = this.imageStatus[`main_${origIdx}`];
                    const altOk = item.pictureAlt ? this.imageStatus[`alt_${origIdx}`] : true;
                    return mainOk === false || altOk === false;
                });
            }

            // Sort
            if (this.sortColumn) {
                data.sort((a, b) => {
                    let va, vb;
                    if (this.sortColumn === 'index') {
                        va = a.index != null ? a.index : -1;
                        vb = b.index != null ? b.index : -1;
                    } else if (this.sortColumn === 'nameEn') {
                        va = (a.nameEn || '').toLowerCase();
                        vb = (b.nameEn || '').toLowerCase();
                    } else if (this.sortColumn === 'nameFr') {
                        va = (a.nameFr || '').toLowerCase();
                        vb = (b.nameFr || '').toLowerCase();
                    }
                    if (va < vb) return this.sortAsc ? -1 : 1;
                    if (va > vb) return this.sortAsc ? 1 : -1;
                    return 0;
                });
            }

            return data;
        }
    };

    autobingo.DatasetViewer = DatasetViewer;

})(window.AutoBingo = window.AutoBingo || {});