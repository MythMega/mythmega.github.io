/**
 * DeveloperAccess - Who may enable the advanced developer options.
 *
 * The allowlist is a manually maintained JSON array of account UUIDs at the root of the site
 * (`developpers.json`, with the historical spelling). It is deliberately separate from
 * `settings/config.json`: a player can edit their own save, not this shipped file.
 *
 * The list is fetched once per page and then cached. A failed or malformed file grants nobody:
 * advanced options are an explicit privilege, so the safe fallback is always "denied".
 */

/** Public allowlist, relative to the page so the game works at the domain root and in a subfolder. */
const DEVELOPERS_PATH = 'developpers.json';

/** @type {string[]|null} Normalized UUIDs, or null before the first successful load. */
let cachedUuids = null;

/** @type {Promise<string[]>|null} In-flight load shared by simultaneous callers. */
let pendingLoad = null;

/**
 * Reads and validates the allowlist payload.
 *
 * @param {unknown} payload - Parsed JSON.
 * @returns {string[]} Lowercase UUIDs, without blank entries or duplicates.
 * @throws {Error} When the payload is not an array.
 */
function normalizeUuids(payload) {
  if (!Array.isArray(payload)) {
    throw new Error(`"${DEVELOPERS_PATH}" must contain a JSON array of UUIDs.`);
  }
  return [...new Set(
    payload
      .filter((uuid) => typeof uuid === 'string' && uuid.trim() !== '')
      .map((uuid) => uuid.trim().toLowerCase())
  )];
}

/**
 * Loads the allowlist, with one cached copy per page.
 *
 * @param {object} [options] - Load options.
 * @param {boolean} [options.force=false] - Ignore the cached copy.
 * @returns {Promise<string[]>} The allowed UUIDs (empty when the file cannot be read).
 */
export async function loadDevelopers({ force = false } = {}) {
  if (cachedUuids && !force) return cachedUuids;
  if (pendingLoad && !force) return pendingLoad;

  pendingLoad = (async () => {
    try {
      const response = await fetch(DEVELOPERS_PATH);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      cachedUuids = normalizeUuids(await response.json());
      return cachedUuids;
    } catch (error) {
      console.warn('[DeveloperAccess] The developer allowlist could not be read.', error);
      cachedUuids = [];
      return cachedUuids;
    } finally {
      pendingLoad = null;
    }
  })();

  return pendingLoad;
}

/**
 * Tells whether an account UUID is allowed to use the advanced developer options.
 *
 * @param {unknown} uuid - Account UUID.
 * @returns {Promise<boolean>} True only when the UUID is explicitly listed.
 */
export async function isAdvancedDeveloper(uuid) {
  if (typeof uuid !== 'string' || uuid.trim() === '') return false;
  const uuids = await loadDevelopers();
  return uuids.includes(uuid.trim().toLowerCase());
}

/** Shared access helper. */
export const developerAccess = {
  load: loadDevelopers,
  isAdvancedDeveloper,
};

export default developerAccess;
