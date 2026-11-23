/**
 * ReservedNamesManager - The pseudos a player may not take.
 *
 * The list is a JSON array of words in `settings/blockednames.json`, next to the other shipped
 * settings: it holds the names of the accounts that must not be imitated (the developer, the
 * staff). A display name that CONTAINS one of them is refused when the profile is saved, so
 * nobody can present themselves as `Myth` or as `MythMegaFan` on a trainer card.
 *
 * Reference: `js/business/ProfileManager.js` (the only writer of the display name) and
 * `developpers.json` (the UUID allowlist of `DeveloperAccess`).
 *
 * WHY "CONTAINS" AND NOT "EQUALS"
 *   Renaming a single letter is the oldest impersonation trick. Refusing any name that contains a
 *   reserved word leaves a player free to build their own pseudo (`Mythologue`), which is what a
 *   word list can honestly offer: this is a courtesy guard, not a security boundary.
 *
 * CASE AND ACCENTS
 *   The comparison lowercases and strips the diacritics of both sides (`normalize('NFD')`), so
 *   `MYTH`, `myth` and `Mýth` are all refused. The compared text is never stored: the player keeps
 *   the exact spelling they typed.
 *
 * WHO BYPASSES IT
 *   The UUIDs of `developpers.json` (`DeveloperAccess.isAdvancedDeveloper`) are allowed through:
 *   the accounts of the team test those very names, and locking the developer out of the pseudo
 *   they use everywhere would only push them to disable the check by hand.
 *
 * This check is CLIENT-side by design: the worker does not read this file and accepts any pseudo
 * the game sends. A modified client can therefore ignore it, which is accepted - the goal is that
 * the official game never shows an impersonating card, not that the database forbids the string.
 *
 * The file is read once per page and then cached, exactly like `DeveloperAccess`. A missing or
 * malformed file reserves nothing: a broken setting must never lock the profile editor.
 */

import { isAdvancedDeveloper } from '../utils/DeveloperAccess.js';

/** Public list of reserved words, relative to the page so the game works at the root and in a subfolder. */
export const RESERVED_NAMES_PATH = 'settings/blockednames.json';

/** @type {string[]|null} Normalized words, or null before the first successful load. */
let cachedWords = null;

/** @type {Promise<string[]>|null} In-flight load shared by simultaneous callers. */
let pendingLoad = null;

/**
 * Normalizes a value for a comparison: lowercase, without diacritics, trimmed.
 *
 * The value is only ever compared, never stored: the profile keeps the spelling the player typed.
 *
 * @param {unknown} value - Raw pseudo or reserved word.
 * @returns {string} The comparable text (empty when the value carries no letter).
 */
export function normalizeNameForMatch(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Reads and validates the reserved words of the shipped file.
 *
 * @param {unknown} payload - Parsed JSON.
 * @returns {string[]} Normalized words, without blanks or duplicates.
 * @throws {Error} When the payload is not an array.
 */
function normalizeWords(payload) {
  if (!Array.isArray(payload)) {
    throw new Error(`"${RESERVED_NAMES_PATH}" must contain a JSON array of pseudos.`);
  }
  return [
    ...new Set(
      payload.map(normalizeNameForMatch).filter((word) => word !== '')
    ),
  ];
}

/**
 * Loads the reserved words, with one cached copy per page.
 *
 * A file that cannot be read or parsed reserves nothing: the profile editor stays usable, which
 * is the only safe fallback for a setting nobody can repair from the game.
 *
 * @param {object} [options] - Load options.
 * @param {boolean} [options.force=false] - Ignore the cached copy.
 * @returns {Promise<string[]>} The reserved words (empty when the file is unusable).
 */
export async function loadReservedNames({ force = false } = {}) {
  if (cachedWords && !force) return cachedWords;
  if (pendingLoad && !force) return pendingLoad;

  pendingLoad = (async () => {
    try {
      const response = await fetch(RESERVED_NAMES_PATH, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      cachedWords = normalizeWords(await response.json());
      return cachedWords;
    } catch (error) {
      console.warn('[ReservedNamesManager] The reserved names could not be read.', error);
      cachedWords = [];
      return cachedWords;
    } finally {
      pendingLoad = null;
    }
  })();

  return pendingLoad;
}

/**
 * Finds the reserved word a candidate pseudo contains.
 *
 * @param {unknown} name - Candidate display name.
 * @returns {Promise<string>} The reserved word it contains, or an empty string.
 */
export async function findReservedName(name) {
  const candidate = normalizeNameForMatch(name);
  if (candidate === '') return '';
  const words = await loadReservedNames();
  return words.find((word) => candidate.includes(word)) ?? '';
}

/**
 * Tells whether a display name is reserved for one account.
 *
 * @param {unknown} name - Candidate display name (empty clears the name, which is always allowed).
 * @param {unknown} uuid - UUID of the account choosing it, used for the developer bypass.
 * @returns {Promise<boolean>} True when the name must be refused.
 */
export async function isReservedName(name, uuid) {
  if (normalizeNameForMatch(name) === '') return false;
  if (await isAdvancedDeveloper(uuid)) return false;
  return (await findReservedName(name)) !== '';
}

/** Shared access helper. */
export const reservedNamesManager = {
  load: loadReservedNames,
  find: findReservedName,
  isReserved: isReservedName,
};

export default reservedNamesManager;
