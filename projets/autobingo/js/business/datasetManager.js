/**
 * Manages loading and filtering datasets from datasets.json
 * AutoBingo.DatasetManager
 */
(function(autobingo) {
    'use strict';

    class DatasetManager {
        constructor() {
            this.definitions = [];
            this.loadedData = {};
        }

        /**
         * Load datasets.json definitions
         * @returns {Promise<Array>} List of DatasetDefinition
         */
        async loadDefinitions() {
            const response = await fetch('datasets.json');
            const raw = await response.json();
            this.definitions = raw.map(autobingo.DatasetDefinition.fromRaw);
            return this.definitions;
        }

        /**
         * Get all unique categories
         * @returns {string[]}
         */
        getCategories() {
            return [...new Set(this.definitions.map(d => d.category))].sort();
        }

        /**
         * Get subcategories for a given category
         * @param {string} category
         * @returns {string[]}
         */
        getSubcategories(category) {
            return [...new Set(
                this.definitions
                    .filter(d => d.category === category)
                    .map(d => d.subcategory)
            )].sort();
        }

        /**
         * Get datasets for a given category and subcategory
         * @param {string} category
         * @param {string} subcategory
         * @returns {DatasetDefinition[]}
         */
        getDatasets(category, subcategory) {
            return this.definitions.filter(
                d => d.category === category && d.subcategory === subcategory
            );
        }

        /**
         * Find a dataset definition by name
         * @param {string} name
         * @returns {DatasetDefinition|null}
         */
        getDatasetByName(name) {
            return this.definitions.find(d => d.name === name) || null;
        }

        /**
         * Load the actual data items for a dataset definition
         * @param {DatasetDefinition} definition
         * @returns {Promise<Array>} List of DatasetItem
         */
        async loadDatasetItems(definition) {
            if (this.loadedData[definition.name]) {
                return this.loadedData[definition.name];
            }
            const response = await fetch(definition.location);
            const raw = await response.json();
            const items = (raw.Items || []).map(autobingo.DatasetItem.fromRaw);
            this.loadedData[definition.name] = items;

            // Update definition with quantizable info from the data file root
            if (raw.Quantizable) {
                definition.quantizable = true;
                definition.defaultQuantities = raw.DefaultQuantities || null;
            }

            return items;
        }
    }

    autobingo.DatasetManager = DatasetManager;

})(window.AutoBingo = window.AutoBingo || {});