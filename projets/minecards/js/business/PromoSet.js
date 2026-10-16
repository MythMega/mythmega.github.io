/**
 * PromoSet - Identity of a promo group, without loading the promo catalogue.
 *
 * A promo card never belongs to a booster extension: it lives in a group of its own, whose id is
 * the id of the extension it decorates suffixed with `-Promo` (`A1` -> `A1-Promo`). That suffix is
 * what the rest of the application keys on - the collection marks such a group `promo: true`, the
 * statistics leave its completion out, and `SparksManager` refuses to trade its cards.
 *
 * WHY THIS IS A MODULE OF ITS OWN. `PromoManager` knows the catalogue but pulls `BoosterManager` in
 * when it loads it, and `BoosterManager` already imports `SparksManager`: asking `PromoManager` for
 * the suffix would close that loop. This file imports nothing at all, so any module can ask "is this
 * a promo id?" without dragging the catalogue behind it - the same reason `USER_STATE_KEYS` lives in
 * `AccountManager` and not in the management that writes it.
 */

/** Suffix appended to the parent series id to build a promo group id (`A1` -> `A1-Promo`). */
export const PROMO_SET_SUFFIX = '-Promo';

/**
 * Word appended to the parent extension name in the promo group label ("Genesis Blocks · Promo").
 *
 * Deliberately a neutral literal rather than a translation key: the two shipped languages spell it
 * identically, and a business module has no access to the i18n dictionary.
 */
export const PROMO_LABEL = 'Promo';

/**
 * Builds the group id of a promo file.
 *
 * @param {string} parentId - File basename / parent series id (e.g. "A1").
 * @returns {string} The promo group id (e.g. "A1-Promo").
 * @throws {TypeError} When the parent id is not a non-empty string.
 */
export function buildPromoSetId(parentId) {
  if (typeof parentId !== 'string' || parentId.trim() === '') {
    throw new TypeError(`A promo set id must be a non-empty string (received: ${JSON.stringify(parentId)}).`);
  }
  const id = parentId.trim();
  return id.toLowerCase().endsWith(PROMO_SET_SUFFIX.toLowerCase()) ? id : `${id}${PROMO_SET_SUFFIX}`;
}

/**
 * Indicates whether a collection/extension id designates a promo group.
 *
 * @param {unknown} setId - Candidate id.
 * @returns {boolean} True for an id ending with the promo suffix.
 */
export function isPromoSetId(setId) {
  return (
    typeof setId === 'string' && setId.trim().toLowerCase().endsWith(PROMO_SET_SUFFIX.toLowerCase())
  );
}
