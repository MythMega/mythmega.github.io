/**
 * Represents a dataset definition from datasets.json
 * AutoBingo.DatasetDefinition
 */
(function(autobingo) {
    'use strict';

    class DatasetDefinition {
        /**
         * @param {string} name - Unique dataset name
         * @param {string} category - Category name
         * @param {string} subcategory - Subcategory name
         * @param {string} location - File path to the dataset JSON
         */
        constructor(name, category, subcategory, location) {
            this.name = name;
            this.category = category;
            this.subcategory = subcategory;
            this.location = location;
        }

        /**
         * Create from a raw JSON object
         * @param {Object} raw
         * @returns {DatasetDefinition}
         */
        static fromRaw(raw) {
            return new DatasetDefinition(
                raw.Name,
                raw.Category,
                raw.Subcategory,
                raw.Location
            );
        }
    }

    autobingo.DatasetDefinition = DatasetDefinition;

})(window.AutoBingo = window.AutoBingo || {});