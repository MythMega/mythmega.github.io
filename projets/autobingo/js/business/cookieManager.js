/**
 * Manages reading and writing cookies
 * AutoBingo.CookieManager
 */
(function(autobingo) {
    'use strict';

    const CookieManager = {
        /**
         * Get a cookie value by name
         * @param {string} name
         * @returns {string|null}
         */
        get(name) {
            const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
            return match ? decodeURIComponent(match[2]) : null;
        },

        /**
         * Set a cookie value
         * @param {string} name
         * @param {string} value
         * @param {number} days - Days until expiration
         */
        set(name, value, days = 365) {
            const expires = new Date(Date.now() + days * 864e5).toUTCString();
            document.cookie = name + '=' + encodeURIComponent(value) + '; expires=' + expires + '; path=/';
        }
    };

    autobingo.CookieManager = CookieManager;

})(window.AutoBingo = window.AutoBingo || {});