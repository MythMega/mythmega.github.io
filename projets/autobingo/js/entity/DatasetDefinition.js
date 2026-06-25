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
         * @param {boolean} quantizable - Whether items can have quantities
         * @param {Object|null} defaultQuantities - Default {Min, Max} for quantities
         * @param {Array} flags - Array of flag names (e.g. ["Simplified"])
         */
        constructor(name, category, subcategory, location, quantizable, defaultQuantities, flags) {
            this.name = name;
            this.category = category;
            this.subcategory = subcategory;
            this.location = location;
            this.quantizable = quantizable || false;
            this.defaultQuantities = defaultQuantities || null;
            this.flags = flags || [];
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
                raw.Location,
                raw.Quantizable,
                raw.DefaultQuantities || null,
                raw.Flags || []
            );
        }
    }

    autobingo.DatasetDefinition = DatasetDefinition;

})(window.AutoBingo = window.AutoBingo || {});