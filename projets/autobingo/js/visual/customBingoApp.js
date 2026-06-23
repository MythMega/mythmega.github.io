/**
 * Custom Bingo — two-state app (create / play)
 * AutoBingo.CustomBingoApp
 */
(function(autobingo) {
    'use strict';

    const CustomBingoApp = {
        container: null,
        state: 'create', // 'create' | 'play'
        gameManager: null,
        gridRenderer: null,
        datasetDef: null,
        gridSize: 5,

        /**
         * Initialize
         */
        init() {
            this.container = document.getElementById('custom-bingo-content');
            this.render();
        },

        /**
         * Main render dispatcher
         */
        render() {
            this.container.innerHTML = '';
            if (this.state === 'create') {
                this._renderCreateState();
            } else {
                this._renderPlayState();
            }
        },

        /**
         * Create state: upload JSON + choose grid size
         */
        _renderCreateState() {
            const section = document.createElement('div');
            section.className = 'creator-section';
            section.style.maxWidth = '600px';
            section.style.margin = '40px auto';

            const h2 = document.createElement('h2');
            h2.className = 'page-title';
            h2.setAttribute('data-i18n', 'custombingo.create_title');
            h2.textContent = 'Custom Bingo';
            section.appendChild(h2);

            const p = document.createElement('p');
            p.className = 'page-subtitle';
            p.setAttribute('data-i18n', 'custombingo.create_subtitle');
            p.textContent = 'Upload a dataset JSON and choose grid size';
            section.appendChild(p);

            // Upload area
            const uploadDiv = document.createElement('div');
            uploadDiv.style.marginTop = '24px';

            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.json';
            fileInput.className = 'styled-select';
            fileInput.style.padding = '8px';
            fileInput.style.marginBottom = '12px';

            const statusLabel = document.createElement('p');
            statusLabel.style.fontSize = '0.85rem';
            statusLabel.style.color = 'var(--text-secondary)';
            statusLabel.textContent = 'No file selected';

            fileInput.addEventListener('change', () => {
                const file = fileInput.files[0];
                if (!file) {
                    statusLabel.textContent = 'No file selected';
                    return;
                }
                statusLabel.textContent = `Selected: ${file.name}`;
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const raw = JSON.parse(e.target.result);
                        this.datasetDef = this._buildDatasetDef(raw);
                        statusLabel.textContent = `Loaded: ${this.datasetDef.name} (${this.datasetDef.itemCount} items)`;
                        statusLabel.style.color = '#4caf50';
                    } catch (err) {
                        statusLabel.textContent = 'Error: Invalid JSON file';
                        statusLabel.style.color = '#e74c3c';
                    }
                };
                reader.readAsText(file);
            });

            uploadDiv.appendChild(fileInput);
            uploadDiv.appendChild(statusLabel);
            section.appendChild(uploadDiv);

            // Grid size
            const sizeDiv = document.createElement('div');
            sizeDiv.className = 'creator-field';
            sizeDiv.style.marginTop = '16px';

            const sizeLabel = document.createElement('label');
            sizeLabel.setAttribute('data-i18n', 'custombingo.grid_size');
            sizeLabel.textContent = 'Grid Size';
            sizeDiv.appendChild(sizeLabel);

            const sizeSelect = document.createElement('select');
            sizeSelect.className = 'styled-select';
            [3, 4, 5, 6, 7].forEach(s => {
                const opt = document.createElement('option');
                opt.value = s;
                opt.textContent = `${s}x${s}`;
                if (s === 5) opt.selected = true;
                sizeSelect.appendChild(opt);
            });
            sizeSelect.addEventListener('change', () => {
                this.gridSize = parseInt(sizeSelect.value);
            });
            sizeDiv.appendChild(sizeSelect);
            section.appendChild(sizeDiv);

            // Start button
            const startBtn = document.createElement('button');
            startBtn.className = 'btn btn-primary';
            startBtn.style.marginTop = '24px';
            startBtn.setAttribute('data-i18n', 'custombingo.start_game');
            startBtn.textContent = 'Start Game';
            startBtn.disabled = true;
            startBtn.addEventListener('click', () => {
                if (!this.datasetDef) return;
                this.state = 'play';
                this.render();
            });

            // Enable button when dataset is loaded
            const originalStatusUpdate = statusLabel.textContent;
            const observer = new MutationObserver(() => {
                startBtn.disabled = !this.datasetDef;
            });
            observer.observe(statusLabel, { childList: true, characterData: true, subtree: true });

            section.appendChild(startBtn);
            this.container.appendChild(section);

            if (autobingo.translationManager) {
                setTimeout(() => autobingo.translationManager.translatePage(), 0);
            }
        },

        /**
         * Build a DatasetDefinition from raw JSON
         */
        _buildDatasetDef(raw) {
            const items = (raw.Items || []).map((it, idx) => {
                return new autobingo.DatasetItem(
                    it.Name_EN || '',
                    it.Name_FR || '',
                    it.PictureMain || '',
                    '',
                    it.Index != null ? String(it.Index) : String(idx),
                    it.Quantity || null
                );
            });

            const def = new autobingo.DatasetDefinition({
                name: raw.Name || 'Custom Dataset',
                category: raw.Category || 'Custom',
                subcategory: raw.Subcategory || 'Custom',
                location: '',
                quantizable: raw.Quantizable === true,
                defaultQuantities: raw.DefaultQuantities || { Min: 1, Max: 999 },
                hasAltImages: false
            });

            def.itemCount = items.length;
            def._items = items;
            return def;
        },

        /**
         * Play state: render the bingo grid
         */
        _renderPlayState() {
            const content = this.container;
            if (!content) {
                console.error('CustomBingo: container not found');
                return;
            }

            if (!this.datasetDef) {
                console.error('CustomBingo: no dataset defined');
                content.innerHTML = '<p style="color:red;padding:20px;">Error: No dataset loaded. Go back and upload a file.</p>';
                return;
            }

            console.log('CustomBingo: entering play state, items:', this.datasetDef._items.length);

            // Create a BingoGameManager with the custom dataset
            this.gameManager = new autobingo.BingoGameManager();
            this.gameManager.datasetDefinition = this.datasetDef;
            this.gameManager.allItems = this.datasetDef._items;
            this.gameManager.isQuantizable = this.datasetDef.quantizable;
            this.gameManager.gridSize = this.gridSize;
            this.gameManager.cells = [];

            // Randomize items and create cells
            const shuffled = [...this.gameManager.allItems].sort(() => Math.random() - 0.5);
            const needed = this.gridSize * this.gridSize;
            for (let i = 0; i < needed; i++) {
                const item = shuffled[i % shuffled.length];
                const cell = new autobingo.BingoCell(
                    i,
                    item,
                    this.gameManager.isQuantizable ? this.gameManager._randomQuantityForItem(item) : null
                );
                this.gameManager.cells.push(cell);
            }

            console.log('CustomBingo: cells created:', this.gameManager.cells.length);

            try {
                // Initialize grid renderer with overlay/lang options
                console.log('CustomBingo: getting BingoGridRenderer');
                this.gridRenderer = autobingo.BingoGridRenderer;
                console.log('CustomBingo: calling init with options');
                const isOverlay = window.AutoBingo && window.AutoBingo._customBingoOverlay === true;
                const overrideLang = window.AutoBingo ? (window.AutoBingo._customBingoOverrideLang || null) : null;
                this.gridRenderer.init(content, this.gameManager, {
                    isOverlay: isOverlay,
                    overrideLang: overrideLang
                });
                console.log('CustomBingo: init done');
                
                // Force a manual check
                const gridEl = document.getElementById('bingo-grid');
                console.log('CustomBingo: grid element found:', !!gridEl);
                if (gridEl) {
                    console.log('CustomBingo: grid children count:', gridEl.children.length);
                }
                
                // If nothing was rendered, show debug info
                if (!gridEl || gridEl.children.length === 0) {
                    content.innerHTML = '<p style="color:orange;padding:20px;">Grid initialized but empty. Check console.</p>';
                }

                // Override URL updates to do nothing (isolated from bingo.html URL system)
                const originalUpdateUrl = this.gridRenderer.updateUrl.bind(this.gridRenderer);
                this.gridRenderer.updateUrl = () => {
                    // No URL updates for custom bingo
                };

                // Also override _updateControlsUrl and _updateQuantitiesUrl
                this.gridRenderer._updateControlsUrl = () => {};
                this.gridRenderer._updateQuantitiesUrl = () => {};
            } catch (err) {
                console.error('CustomBingo: grid renderer failed', err);
                content.innerHTML = '<p style="color:red;padding:20px;">Error: ' + err.message + '</p>';
            }
        }
    };

    autobingo.CustomBingoApp = CustomBingoApp;

})(window.AutoBingo = window.AutoBingo || {});