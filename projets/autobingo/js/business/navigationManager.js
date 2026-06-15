/**
 * Manages navigation state and URL parameters
 * AutoBingo.NavigationManager
 */
(function(autobingo) {
    'use strict';

    const NavigationManager = {
        /**
         * Get URL parameter by name
         * @param {string} name - Parameter name
         * @returns {string|null}
         */
        getParam(name) {
            const params = new URLSearchParams(window.location.search);
            return params.get(name);
        },

        /**
         * Set URL parameter without page reload
         * @param {string} name - Parameter name
         * @param {string} value - Parameter value
         */
        setParam(name, value) {
            const url = new URL(window.location);
            url.searchParams.set(name, value);
            window.history.replaceState({}, '', url);
        },

        /**
         * Remove URL parameter
         * @param {string} name - Parameter name
         */
        removeParam(name) {
            const url = new URL(window.location);
            url.searchParams.delete(name);
            window.history.replaceState({}, '', url);
        },

        /**
         * Navigate to another page with optional parameters
         * @param {string} page - Page path
         * @param {Object} params - Query parameters
         */
        navigateTo(page, params = {}) {
            const url = new URL(page, window.location.origin);
            for (const [k, v] of Object.entries(params)) {
                url.searchParams.set(k, v);
            }
            window.location.href = url;
        }
    };

    autobingo.NavigationManager = NavigationManager;

})(window.AutoBingo = window.AutoBingo || {});