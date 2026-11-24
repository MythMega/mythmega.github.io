/**
 * PriceIcons - a trade price written with the icons of its two currencies.
 *
 * Reference: `InfoView`, the trade dialogs and the trade history.
 *
 * The price of a trade is always the same pair: Ender Eyes, then Sparks. Every place that shows one
 * (the Informations table, the cost line of a dialog, a card tile, a history row) builds it here, so
 * the numbers, the icons, the "+" separator, the tooltip and the accessible label can never drift
 * apart. `trade.cost` is the spoken form ("5 Ender Eye(s) · 3 Sparks"), reused as `title` and as the
 * `aria-label` of the group; the icons themselves are hidden from assistive technologies.
 */

import i18n from '../../utils/I18n.js';

/** Currency illustrations, in the order a price always reads them. */
export const PRICE_ICONS = Object.freeze({
  enderEyes: 'assets/img/endereye.webp',
  sparks: 'assets/img/sparks.png',
});

/**
 * Builds one amount of a price: the number, then the icon of its currency.
 *
 * @param {number|string} amount - Value to show.
 * @param {string} iconPath - Path of the currency icon.
 * @returns {HTMLElement} The amount, icon included.
 */
export function buildPriceAmount(amount, iconPath) {
  const wrapper = document.createElement('span');
  wrapper.className = 'price__amount';
  const value = document.createElement('span');
  value.textContent = String(amount);
  const icon = document.createElement('img');
  icon.className = 'price__icon';
  icon.src = iconPath;
  icon.alt = '';
  icon.loading = 'lazy';
  icon.decoding = 'async';
  icon.setAttribute('aria-hidden', 'true');
  wrapper.append(value, icon);
  return wrapper;
}

/**
 * Builds the "+" between the two currencies of a price.
 *
 * @returns {HTMLElement} The separator.
 */
export function buildPriceSeparator() {
  const separator = document.createElement('span');
  separator.className = 'price__sep';
  separator.textContent = '+';
  separator.setAttribute('aria-hidden', 'true');
  return separator;
}

/**
 * Builds a complete price: Ender Eyes, "+", Sparks.
 *
 * @param {{enderEyes?: number|string, sparks?: number|string}|object} cost - Anything carrying the
 *   two amounts (`getTradeCost()`, a worker trade, a decoded price).
 * @returns {HTMLSpanElement} The price, with its tooltip and accessible label.
 */
export function buildPrice(cost) {
  const eyes = Number(cost?.enderEyes) || 0;
  const sparks = Number(cost?.sparks) || 0;
  const wrapper = document.createElement('span');
  wrapper.className = 'price';
  const label = i18n.t('trade.cost', { eyes, sparks });
  wrapper.title = label;
  wrapper.setAttribute('role', 'img');
  wrapper.setAttribute('aria-label', label);
  wrapper.append(
    buildPriceAmount(eyes, PRICE_ICONS.enderEyes),
    buildPriceSeparator(),
    buildPriceAmount(sparks, PRICE_ICONS.sparks)
  );
  return wrapper;
}
