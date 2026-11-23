/**
 * save-sync.js - Reads a player's `.save` from an admin page.
 *
 * WHY
 * Two admin tools need the content of a save:
 *   - `openings.html` needs the account UUID and the per-extension opening counters, because a pack
 *     is drawn from `<uuid>-<n>-<setId>` and `n` cannot be guessed;
 *   - `save-editor.html` opens the file itself, but may as well fetch it from the online backup.
 *
 * The online service is the one the game already uses (`SaveSyncManager`, same worker, same
 * routes). It is READ-ONLY here: nothing is uploaded and no local database is touched. The worker
 * asks for the account's secret code as well as its UUID, so a UUID alone never exposes a save:
 * the pair is the same one the trainer card shows (`Settings` > compte). The account may be
 * designated by its pseudo instead of its UUID: the pseudo is unique in the database, and the
 * worker's public lookup route translates it before the save is asked for.
 *
 * The downloaded text is the exact `.save` content (Base64 of a deflate stream), so it decodes
 * with the very helpers the game uses (`js/utils/Compression.js`).
 */

import { decompressJson } from '../js/utils/Compression.js';

/** Base URL of the worker that stores the online backups (same as `SocialManager`). */
export const SAVE_SYNC_BASE_URL = 'https://minecard-backend.jordanmorindev.workers.dev';

/** Version 4 UUID of an account, as written by the game. */
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Secret code of an account: 16 letters or digits, stored uppercase. */
const AUTH_CODE_PATTERN = /^[A-Z0-9]{16}$/;

/**
 * Normalizes a typed UUID.
 *
 * @param {unknown} value - Raw value.
 * @returns {string} The lowercase UUID, or an empty string when it is not a v4 UUID.
 */
export function normalizeSaveUuid(value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return UUID_V4_PATTERN.test(text) ? text : '';
}

/**
 * Normalizes a typed secret code.
 *
 * @param {unknown} value - Raw value.
 * @returns {string} The uppercase code, or an empty string when its shape is wrong.
 */
export function normalizeSaveAuthCode(value) {
  const text = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return AUTH_CODE_PATTERN.test(text) ? text : '';
}

/**
 * Resolves a typed pseudo or UUID to the account UUID the save routes are keyed by.
 *
 * A v4 UUID is used as-is. Anything else is a pseudo: the worker's public lookup route
 * (`GET /lookup`) translates it, because a pseudo is unique in the database. Only an account
 * that published its trainer card has a pseudo, which the message says when nobody matches.
 *
 * @param {unknown} value - Pseudo or UUID typed in the page.
 * @returns {Promise<string>} The lowercase UUID of the account.
 * @throws {Error} When the field is empty, malformed, or designates nobody.
 */
export async function resolveSaveIdentifier(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === '') {
    throw new Error("Indiquez l’UUID ou le pseudo du compte.");
  }
  const uuid = normalizeSaveUuid(text);
  if (uuid !== '') return uuid;
  if (text.length > 24) {
    throw new Error("Pseudo ou UUID invalide : un pseudo fait au plus 24 caractères.");
  }

  let response;
  try {
    response = await fetch(`${SAVE_SYNC_BASE_URL}/lookup?query=${encodeURIComponent(text)}`, {
      cache: 'no-store',
    });
  } catch (error) {
    throw new Error("Serveur de sauvegarde injoignable (réseau).", { cause: error });
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(`Le serveur de sauvegarde a répondu HTTP ${response.status}.`);
  }
  const found = typeof payload?.uuid === 'string' ? normalizeSaveUuid(payload.uuid) : '';
  if (payload?.found !== true || found === '') {
    throw new Error(
      "Aucun joueur ne porte ce pseudo : seuls les comptes ayant publié leur carte de dresseur sont trouvables."
    );
  }
  return found;
}

/**
 * Downloads the newest online save of one account.
 *
 * The worker requires the UUID and the secret code even for a read: the game never exposes a
 * backup from an UUID alone, and this page does not try to bypass that rule.
 *
 * @param {object} credentials - Credentials typed in the page.
 * @param {string} credentials.identifier - Account pseudo or UUID.
 * @param {string} credentials.authCode - Account secret code (16 letters or digits).
 * @returns {Promise<{content: string, savedAt: string|null}>} The `.save` text and its upload date.
 * @throws {Error} When a credential is malformed, nothing is online, or the service fails.
 */
export async function downloadOnlineSave({ identifier, authCode }) {
  const cleanUuid = await resolveSaveIdentifier(identifier);
  const cleanCode = normalizeSaveAuthCode(authCode);
  if (cleanCode === '') {
    throw new Error('Code secret invalide : 16 lettres ou chiffres, affiché à côté de l’UUID dans les réglages du jeu.');
  }

  const query = `uuid=${encodeURIComponent(cleanUuid)}&auth_code=${encodeURIComponent(cleanCode)}`;
  let response;
  try {
    response = await fetch(`${SAVE_SYNC_BASE_URL}/saves/last/file?${query}`, { cache: 'no-store' });
  } catch (error) {
    throw new Error('Serveur de sauvegarde injoignable (réseau).', { cause: error });
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }
  if (response.status === 403) {
    throw new Error('Code secret refusé pour cet UUID.');
  }
  if (!response.ok) {
    const detail = typeof payload?.error === 'string' && payload.error !== '' ? ` : ${payload.error}` : '';
    throw new Error(`Le serveur de sauvegarde a répondu HTTP ${response.status}${detail}.`);
  }
  if (payload?.exists !== true || typeof payload.save !== 'string' || payload.save === '') {
    throw new Error('Aucune sauvegarde en ligne pour ce compte.');
  }

  return {
    content: payload.save,
    savedAt: typeof payload.saved_at === 'string' ? payload.saved_at : null,
  };
}

/**
 * Decodes a `.save` text and reads what the admin pages need from it.
 *
 * The payload is not fully validated here (the save editor has its own validator): the structure
 * is only checked far enough to refuse something that is not a MineCards save at all.
 *
 * @param {string} content - Base64 content of a `.save` file.
 * @returns {Promise<{payload: object, uuid: string, exportedAt: string|null,
 *   boostersOpenedBySet: Record<string, number>}>} The decoded save and its account summary.
 * @throws {Error} When the text is not a readable save.
 */
export async function readSavePayload(content) {
  const text = typeof content === 'string' ? content.trim() : '';
  if (text === '') throw new Error('Le fichier .save est vide.');

  let payload;
  try {
    payload = await decompressJson(text);
  } catch (error) {
    throw new Error(`Fichier .save illisible (${error.message}).`, { cause: error });
  }

  const state = payload?.stores?.user_state;
  if (!payload || typeof payload !== 'object' || !state || typeof state !== 'object') {
    throw new Error('Ce fichier n’est pas une sauvegarde MineCards.');
  }

  const rawCounts = state.stats?.boostersOpenedBySet;
  const boostersOpenedBySet = {};
  if (rawCounts && typeof rawCounts === 'object' && !Array.isArray(rawCounts)) {
    Object.entries(rawCounts).forEach(([setId, count]) => {
      if (typeof setId === 'string' && setId !== '' && Number.isInteger(count) && count >= 0) {
        boostersOpenedBySet[setId] = count;
      }
    });
  }

  return {
    payload,
    uuid: typeof state.account?.uuid === 'string' ? state.account.uuid.trim() : '',
    exportedAt: typeof payload.exportedAt === 'string' ? payload.exportedAt : null,
    boostersOpenedBySet,
  };
}
