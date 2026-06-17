/**
 * Manages saving and loading bingo presets via cookies
 * AutoBingo.PresetManager
 */
(function(autobingo) {
    'use strict';

    const PRESET_COOKIE = 'bingo_presets';
    const MAX_PRESETS = 20;

    const PresetManager = {
        /**
         * Load all saved presets
         * @returns {Array} Array of preset objects { id, name, dataset, size, category, subcategory }
         */
        loadAll() {
            const raw = autobingo.CookieManager.get(PRESET_COOKIE);
            if (!raw) return [];
            try {
                return JSON.parse(raw);
            } catch (e) {
                return [];
            }
        },

        /**
         * Save a new preset
         * @param {string} datasetName - Dataset name
         * @param {number} gridSize - Grid size
         * @param {string} category - Category name
         * @param {string} subcategory - Subcategory name
         */
        save(datasetName, gridSize, category, subcategory) {
            const presets = this.loadAll();
            
            // Don't add if identical to last preset
            const last = presets[presets.length - 1];
            if (last && last.dataset === datasetName && last.size === gridSize) return;
            
            const newPreset = {
                id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
                dataset: datasetName,
                size: gridSize,
                category: category,
                subcategory: subcategory,
                created: new Date().toISOString()
            };
            
            presets.push(newPreset);
            
            // Trim to max
            while (presets.length > MAX_PRESETS) {
                presets.shift();
            }
            
            autobingo.CookieManager.set(PRESET_COOKIE, JSON.stringify(presets));
        },

        /**
         * Delete a preset by id
         * @param {string} id
         */
        delete(id) {
            let presets = this.loadAll();
            presets = presets.filter(p => p.id !== id);
            autobingo.CookieManager.set(PRESET_COOKIE, JSON.stringify(presets));
        },

        /**
         * Clear all presets
         */
        clearAll() {
            autobingo.CookieManager.set(PRESET_COOKIE, JSON.stringify([]));
        }
    };

    autobingo.PresetManager = PresetManager;

})(window.AutoBingo = window.AutoBingo || {});