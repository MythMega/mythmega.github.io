/**
 * GiftManager - Distributions: reading the public Google Sheet and crediting the gifts.
 *
 * Reference: `.docs/steps/8.md` and `.docs/main.md` section 3.H.
 *
 * SHEET FORMAT (the sheet must be shared with "anyone with the link")
 *   Line 1 is the header. Columns are matched BY NAME (order does not matter, extra columns are
 *   ignored), with the aliases `uuid`, `type`, `quantity` and `key` / `cardKey`:
 *     - `booster`: the key column holds the extension id (e.g. `A1`) and `quantity` the number of
 *       BONUS boosters of that extension;
 *     - `card`   : the key column holds the card unique key `${id}_${style}`
 *       (e.g. `SERIE-A1 _ Z001_fullart`) and `quantity` the number of copies;
 *     - `sparks` : `quantity` is the number of Sparks credited; the key column is ignored (it may
 *       stay empty).
 *   A missing header column refuses the whole run BEFORE anything is written (the cursor is left
 *   untouched), so a temporarily broken sheet can never swallow a gift.
 *   The sheet is append-only: never sort, insert or delete a row, otherwise the line numbers
 *   (which are the gift identity) change.
 *
 * BROADCAST ROWS (`uuid = "*"`, step 9)
 *   A row whose `uuid` cell is `*` (after trim) is addressed to EVERY account: the UUID comparison
 *   is skipped and the gift is credited to the current account. The record stores the REAL account
 *   UUID plus `broadcast: true`, so the history stays readable and the anti-duplicate key (the line
 *   number) is unchanged.
 *   CONSEQUENCE, accepted on purpose: a `lastCheckedLine` of 1 means an account created later
 *   receives EVERY historical `*` row of the sheet. Only broadcast gifts that may legitimately be
 *   handed out retroactively.
 *
 * RUN SEQUENCE (`checkGifts()`)
 *   1. the CSV is fetched from the first working URL (`gviz` then `export` as a fallback);
 *   2. the CSV is parsed (quotes, embedded commas, CRLF/LF/CR, BOM) and every record keeps the
 *      PHYSICAL line on which it starts;
 *   3. only the lines after `giftSync.lastCheckedLine` whose uuid matches the account are
 *      considered (comparison case- and whitespace-insensitive);
 *   4. every reward, every `gifts_received` record and the new `giftSync` cursor are written in
 *      ONE readwrite transaction: a failure leaves the previous state untouched and the gifts can
 *      be checked again later. `DateSyncManager.addBonusBoosters()` and
 *      `BoosterManager.addCardToCollection()` (the helpers the redeem codes use) each open their
 *      own transaction, which is exactly what a single all-or-nothing run forbids: the two
 *      rewards are therefore applied INLINE here, writing the very same shapes (the `collection`
 *      record and the per-extension `bonusBoosters` merge are byte-for-byte those of the
 *      helpers). The quota cache is re-read and `QUOTA_UPDATED` is emitted just after the commit,
 *      which is what `addBonusBoosters()` does for a single grant;
 *   5. a line already present in `gifts_received` is skipped even when `lastCheckedLine` was
 *      altered (e.g. an imported older save): the line number is the anti-duplicate key;
 *   6. a matching line whose key is unknown or whose type/quantity is invalid is reported in
 *      `ignored` (with a reason) and skipped, but the cursor still moves past it so it is never
 *      retried. The catalog is built from the RELEASED extensions only (`listBoosterSets()` and
 *      `listPromoSets()`, both released-only by default), so a key of an extension that is only
 *      announced resolves to `unknownCard`/`unknownSet`: a distribution can never hand out the
 *      content of a set the player is not allowed to own yet, and the run reports why.
 *
 * CORS
 *   Verified from the browser against a real public sheet: the `gviz` endpoint answers
 *   `Access-Control-Allow-Origin: <page origin>` and a `200` with `text/csv`
 *   (`.../gviz/tq?tqx=out:csv&gid=<gid>`); `.../export?format=csv&gid=<gid>` answers a CORS-enabled
 *   `307` that the browser follows. Both are tried in that order.
 *
 * LIMITS (kept explicit on purpose)
 *   The UUID lives in a public sheet: anybody who knows the link sees every player's UUID and
 *   gifts. The "only once" rule is purely local (client side, and therefore bypassable: clearing
 *   the local data resets it). Acceptable for a game with no stakes; do NOT use it for rewards of
 *   any value.
 */

import { storageRepository, STORES } from '../models/StorageRepository.js';
import accountManager, { USER_STATE_KEYS } from './AccountManager.js';
import dateSyncManager from './DateSyncManager.js';
import boosterManager, { buildCollectionTimestamp } from './BoosterManager.js';
import promoManager from './PromoManager.js';
import { configLoader } from '../utils/ConfigLoader.js';
import eventBus, { EVENTS } from '../utils/EventBus.js';

/** Google Sheets CSV endpoints, tried in order. `{id}` and `{gid}` are replaced. */
export const GIFT_SHEET_URL_TEMPLATES = Object.freeze([
  'https://docs.google.com/spreadsheets/d/{id}/gviz/tq?tqx=out:csv&gid={gid}',
  'https://docs.google.com/spreadsheets/d/{id}/export?format=csv&gid={gid}',
]);

/** Gift types accepted in the sheet. */
export const GIFT_TYPES = Object.freeze({ BOOSTER: 'booster', CARD: 'card', SPARKS: 'sparks' });

/**
 * Cell value that turns a row into a broadcast to every account (step 9).
 * Compared after `trim()` only, so `" * "` is accepted too.
 */
export const BROADCAST_UUID = '*';

/**
 * Categories stored in `gifts_received`.
 * `distribution` comes from the Google Sheet (step 8), `codes` from a redeemed promo code (step 9).
 * A record without a `category` (older saves) is read as `distribution`.
 */
export const GIFT_CATEGORIES = Object.freeze({ DISTRIBUTION: 'distribution', CODES: 'codes' });

/** Header names accepted for each required column (lower-cased, without separators). */
export const GIFT_COLUMN_ALIASES = Object.freeze({
  UUID: Object.freeze(['uuid', 'player', 'playeruuid']),
  TYPE: Object.freeze(['type', 'kind']),
  KEY: Object.freeze(['key', 'cardkey', 'keyid', 'itemkey']),
  QUANTITY: Object.freeze(['quantity', 'qty', 'amount', 'count']),
});

/**
 * Error codes thrown by `GiftManager`. The values are the suffixes of the `gifts.error.*`
 * translation keys resolved by `getGiftErrorMessageKey()`.
 */
export const GIFT_ERROR_CODES = Object.freeze({
  NO_SHEET: 'noSheet',
  NETWORK: 'network',
  INVALID_SHEET: 'invalidSheet',
  ACCOUNT_MISSING: 'accountMissing',
  UNKNOWN: 'unknown',
});

/**
 * Reasons recorded for a matching line that could not be credited.
 * The values are the suffixes of the `gifts.reason.*` translation keys.
 */
export const GIFT_IGNORE_REASONS = Object.freeze({
  INVALID_TYPE: 'invalidType',
  INVALID_QUANTITY: 'invalidQuantity',
  EMPTY_KEY: 'emptyKey',
  UNKNOWN_SET: 'unknownSet',
  UNKNOWN_CARD: 'unknownCard',
});

/**
 * Error raised by the gift subsystem.
 *
 * `code` is stable (one of `GIFT_ERROR_CODES`) so the UI can translate the failure without
 * parsing a message.
 */
export class GiftError extends Error {
  /**
   * @param {string} code - One of `GIFT_ERROR_CODES`.
   * @param {string} message - Technical description (logged, not shown to the player).
   * @param {object} [options] - Standard `Error` options (`cause`).
   */
  constructor(code, message, options = undefined) {
    super(message, options);
    this.name = 'GiftError';
    this.code = code;
  }
}

/**
 * Resolves the i18n key describing a gift synchronization failure.
 *
 * @param {unknown} error - Error thrown by `GiftManager`.
 * @returns {string} A `gifts.error.*` translation key.
 */
export function getGiftErrorMessageKey(error) {
  const code = error instanceof GiftError ? error.code : GIFT_ERROR_CODES.UNKNOWN;
  return `gifts.error.${code}`;
}

/**
 * Resolves the i18n key describing why a line was ignored.
 *
 * @param {string} reason - One of `GIFT_IGNORE_REASONS`.
 * @returns {string} A `gifts.reason.*` translation key.
 */
export function getGiftIgnoreReasonKey(reason) {
  return `gifts.reason.${Object.values(GIFT_IGNORE_REASONS).includes(reason) ? reason : GIFT_IGNORE_REASONS.EMPTY_KEY}`;
}

/**
 * Builds the CSV URLs of a gift sheet, in fallback order.
 *
 * @param {{id: string, gid?: string}} sheet - Sheet identifiers from `settings/config.json`.
 * @returns {string[]} The URLs to try, in order.
 * @throws {GiftError} With the code `noSheet` when no sheet id is configured.
 */
export function buildGiftSheetUrls(sheet) {
  const id = typeof sheet?.id === 'string' ? sheet.id.trim() : '';
  if (!id) {
    throw new GiftError(
      GIFT_ERROR_CODES.NO_SHEET,
      'settings/config.json declares no "giftSheet.id": there is no distribution source to read.'
    );
  }
  const gid = typeof sheet?.gid === 'string' && sheet.gid.trim() !== '' ? sheet.gid.trim() : '0';
  return GIFT_SHEET_URL_TEMPLATES.map((template) =>
    template.replace('{id}', encodeURIComponent(id)).replace('{gid}', encodeURIComponent(gid))
  );
}

/**
 * Parses a CSV payload.
 *
 * Handles double-quoted fields (with `""` escaping the quote character), embedded commas and
 * line breaks, CRLF/LF/CR endings and a leading BOM. Every record keeps the physical line on
 * which it starts, so the line number stays the row number of the sheet even when a quoted field
 * spans several lines. Fully blank records are dropped (their line numbers are not reused).
 *
 * @param {string} text - Raw CSV content.
 * @returns {Array<{line: number, fields: string[]}>} The parsed records, header included.
 * @throws {TypeError} When the payload is not a string.
 */
export function parseCsv(text) {
  if (typeof text !== 'string') {
    throw new TypeError(`GiftManager.parseCsv expects a string (received: ${typeof text}).`);
  }

  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records = [];
  let fields = [];
  let field = '';
  let inQuotes = false;
  let physicalLine = 1;
  let recordLine = 1;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (inQuotes) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (character === '\n') physicalLine += 1;
        field += character;
      }
      continue;
    }

    if (character === '"') {
      inQuotes = true;
    } else if (character === ',') {
      fields.push(field);
      field = '';
    } else if (character === '\r' || character === '\n') {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      fields.push(field);
      records.push({ line: recordLine, fields });
      fields = [];
      field = '';
      physicalLine += 1;
      recordLine = physicalLine;
    } else {
      field += character;
    }
  }

  // Last record of a file that does not end with a line break.
  if (field !== '' || fields.length > 0) {
    fields.push(field);
    records.push({ line: recordLine, fields });
  }

  return records.filter((record) => record.fields.some((value) => value.trim() !== ''));
}

/**
 * Checks whether a value is an integer strictly greater than zero.
 *
 * @param {unknown} value - Candidate value (a sheet cell is always a string).
 * @returns {boolean} True for "1", "12", 3, ...
 */
function isPositiveIntegerText(value) {
  const text = String(value ?? '').trim();
  return /^\d+$/.test(text) && Number(text) > 0;
}

/**
 * Normalizes an identifier for comparison (trimmed, lower-cased, without inner spaces).
 *
 * The UUID is compared that way because a sheet cell may keep a stray space or a different case.
 *
 * @param {unknown} value - Raw value.
 * @returns {string} The normalized value.
 */
function normalizeIdentifier(value) {
  return String(value ?? '').trim().replace(/\s+/g, '').toLowerCase();
}

export class GiftManager {
  /**
   * @param {object} [options] - Manager options.
   * @param {(url: string) => Promise<string>|null} [options.fetcher=null] - Transport override used
   *   to exercise the manager against a fixture instead of the network. The default fetcher
   *   performs a `no-store` request and refuses an HTML answer (a login or error page is not a
   *   CSV).
   */
  constructor({ fetcher = null } = {}) {
    /** @type {(url: string) => Promise<string>} Fetches the CSV text of one URL. */
    this.fetcher = typeof fetcher === 'function' ? fetcher : (url) => this.requestCsv(url);
    /** @type {Map<string, import('../classes/Card.js').default>|null} Cards by unique key. */
    this.cardsByKey = null;
    /** @type {Map<string, {setId: string, name: string}>|null} Extensions by id. */
    this.setsById = null;
  }

  /**
   * Fetches a URL and returns its text.
   *
   * @param {string} url - URL to read.
   * @returns {Promise<string>} The response body.
   * @throws {GiftError} With the code `network` (request failed or non-2xx answer) or
   *   `invalidSheet` (the answer is HTML: the sheet is private, or the id is wrong).
   */
  async requestCsv(url) {
    let response;
    try {
      response = await fetch(url, { cache: 'no-store', redirect: 'follow' });
    } catch (error) {
      throw new GiftError(GIFT_ERROR_CODES.NETWORK, `Unable to fetch "${url}".`, { cause: error });
    }
    if (!response.ok) {
      throw new GiftError(GIFT_ERROR_CODES.NETWORK, `Unable to fetch "${url}" (HTTP ${response.status}).`);
    }

    const text = await response.text();
    if (/^\s*</.test(text)) {
      throw new GiftError(
        GIFT_ERROR_CODES.INVALID_SHEET,
        `"${url}" answered a web page instead of a CSV: the sheet is probably not shared with "anyone with the link".`
      );
    }
    return text;
  }

  /**
   * Reads the CSV, trying every URL in order.
   *
   * @param {string[]} urls - URLs to try.
   * @returns {Promise<{url: string, text: string}>} The first usable answer.
   * @throws {GiftError} The last failure met (never a partial document).
   */
  async fetchCsv(urls) {
    let lastError = null;
    for (const url of urls) {
      try {
        const text = await this.fetcher(url);
        if (typeof text !== 'string' || text.trim() === '') {
          throw new GiftError(GIFT_ERROR_CODES.INVALID_SHEET, `"${url}" answered an empty document.`);
        }
        return { url, text };
      } catch (error) {
        lastError = error;
        console.warn(`[GiftManager] Distribution source "${url}" is unusable.`, error);
      }
    }
    throw lastError ?? new GiftError(GIFT_ERROR_CODES.NETWORK, 'No distribution source could be read.');
  }

  /**
   * Maps the header row to the column indexes actually used.
   *
   * @param {{fields: string[]}} headerRecord - First record of the CSV.
   * @returns {{uuid: number, type: number, key: number, quantity: number}} Column indexes.
   * @throws {GiftError} With the code `invalidSheet` when a required column is missing.
   */
  static mapColumns(headerRecord) {
    const headers = headerRecord.fields.map((value) => normalizeIdentifier(value).replace(/[_-]/g, ''));
    const indexes = {};

    Object.entries(GIFT_COLUMN_ALIASES).forEach(([field, aliases]) => {
      const index = headers.findIndex((header) => aliases.includes(header));
      if (index === -1) {
        throw new GiftError(
          GIFT_ERROR_CODES.INVALID_SHEET,
          `The header of the distribution sheet has no "${field.toLowerCase()}" column (found: [${headerRecord.fields.join(', ')}]).`
        );
      }
      indexes[field.toLowerCase()] = index;
    });

    return indexes;
  }

  /**
   * Loads (once) the card and extension indexes used to resolve the sheet keys.
   *
   * @param {object} [options] - Load options.
   * @param {boolean} [options.force=false] - Rebuild the indexes.
   * @returns {Promise<{cardsByKey: Map<string, object>, setsById: Map<string, {setId: string, name: string}>}>}
   *   The indexes.
   * @throws {Error} When the extension JSONs cannot be loaded.
   */
  async loadCatalog({ force = false } = {}) {
    if (this.cardsByKey && this.setsById && !force) {
      return { cardsByKey: this.cardsByKey, setsById: this.setsById };
    }

    const sets = await boosterManager.listBoosterSets();
    const cardsByKey = new Map();
    const setsById = new Map();

    for (const descriptor of sets) {
      setsById.set(descriptor.setId, { setId: descriptor.setId, name: descriptor.name || descriptor.setId });
      const loadedSet = await boosterManager.getBoosterSet(descriptor.setId);
      (loadedSet?.cards ?? []).forEach((card) => cardsByKey.set(card.uniqueKey, card));
    }

    // Promo cards are distributed like any other card - an event sheet is exactly how one is
    // handed out - so a gift sheet must be able to name one, and the gift history to display it.
    // A broken promo file degrades to "no promo is giftable", never to a failed synchronization.
    try {
      for (const group of await promoManager.listPromoSets()) {
        setsById.set(group.setId, { setId: group.setId, name: group.name || group.setId });
        (group.cards ?? []).forEach((card) => cardsByKey.set(card.uniqueKey, card));
      }
    } catch (error) {
      console.warn('[GiftManager] The promo cards could not be loaded.', error);
    }

    this.cardsByKey = cardsByKey;
    this.setsById = setsById;
    return { cardsByKey, setsById };
  }

  /**
   * Resolves the display information of a stored gift.
   *
   * Used by the gift history (step 8): a record only stores the raw key, the catalog turns it
   * back into a readable extension or card.
   *
   * @param {{type: string, key: string}} gift - Record read from `gifts_received`.
   * @returns {Promise<{type: string, key: string, setName: string|null, card: object|null, unknown: boolean}>}
   *   The resolved information (`unknown` is true when the key no longer exists in the catalog).
   */
  async describeGift(gift) {
    const { cardsByKey, setsById } = await this.loadCatalog();
    const key = String(gift?.key ?? '');
    const type = String(gift?.type ?? '');

    if (type === GIFT_TYPES.BOOSTER) {
      const set = setsById.get(key) ?? null;
      return { type, key, setName: set?.name ?? null, card: null, unknown: !set };
    }
    if (type === GIFT_TYPES.CARD) {
      const card = cardsByKey.get(key) ?? null;
      return { type, key, setName: card?.set ? (setsById.get(card.set)?.name ?? card.set) : null, card, unknown: !card };
    }
    if (type === GIFT_TYPES.SPARKS) {
      return { type, key, setName: null, card: null, unknown: false };
    }
    return { type, key, setName: null, card: null, unknown: true };
  }

  /**
   * Normalizes the stored gift synchronization state.
   *
   * @param {unknown} raw - Value read from `user_state["giftSync"]`.
   * @returns {{lastCheckedLine: number, lastCheckAt: string|null}} A usable state.
   */
  normalizeGiftSync(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
      lastCheckedLine: Number.isInteger(source.lastCheckedLine) && source.lastCheckedLine >= 1
        ? source.lastCheckedLine
        : 1,
      lastCheckAt: typeof source.lastCheckAt === 'string' ? source.lastCheckAt : null,
    };
  }

  /**
   * Reads the state of a matching line: is it creditable, or should it be ignored?
   *
   * @param {{type: string, key: string, quantity: string}} cells - Raw cells of the line.
   * @param {{cardsByKey: Map<string, object>, setsById: Map<string, {setId: string, name: string}>}} catalog
   *   Catalog indexes.
   * @returns {{ok: true, target: object}|{ok: false, reason: string}} The analysis of the line.
   */
  static analyzeLine(cells, catalog) {
    const type = cells.type.trim().toLowerCase();
    if (!Object.values(GIFT_TYPES).includes(type)) {
      return { ok: false, reason: GIFT_IGNORE_REASONS.INVALID_TYPE };
    }
    if (!isPositiveIntegerText(cells.quantity)) {
      return { ok: false, reason: GIFT_IGNORE_REASONS.INVALID_QUANTITY };
    }

    const quantity = Number(cells.quantity.trim());
    const key = cells.key.trim();

    // Sparks need no catalog key: the quantity is the whole reward.
    if (type === GIFT_TYPES.SPARKS) {
      return { ok: true, target: { type, key: key || 'sparks', quantity } };
    }

    if (key === '') {
      return { ok: false, reason: GIFT_IGNORE_REASONS.EMPTY_KEY };
    }

    if (type === GIFT_TYPES.BOOSTER) {
      const set = catalog.setsById.get(key);
      if (!set) return { ok: false, reason: GIFT_IGNORE_REASONS.UNKNOWN_SET };
      return { ok: true, target: { type, key, setId: set.setId, setName: set.name, quantity } };
    }

    const card = catalog.cardsByKey.get(key);
    if (!card) return { ok: false, reason: GIFT_IGNORE_REASONS.UNKNOWN_CARD };
    return {
      ok: true,
      target: { type, key, quantity, card, setId: card.set, setName: catalog.setsById.get(card.set)?.name ?? card.set },
    };
  }

  /**
   * Checks the distributions and credits every gift addressed to the account.
   *
   * @returns {Promise<{received: object[], ignored: object[], duplicates: number, scannedFrom: number,
   *   scannedTo: number, lastCheckAt: string, source: string}>} The run report. `received` holds the
   *   credited gifts, `ignored` the matching lines that were skipped (with a `reason`).
   * @throws {GiftError} With the code `noSheet`, `network`, `invalidSheet` or `accountMissing`.
   *   In every failure case `giftSync.lastCheckedLine` is left untouched.
   * @throws {Error} When the storage transaction fails; nothing is written in that case.
   */
  async checkGifts() {
    const sheet = await configLoader.getGiftSheet();
    const urls = buildGiftSheetUrls(sheet);
    const { url, text } = await this.fetchCsv(urls);
    const records = parseCsv(text);

    if (records.length === 0) {
      throw new GiftError(GIFT_ERROR_CODES.INVALID_SHEET, `"${url}" contains no header row.`);
    }
    const columns = GiftManager.mapColumns(records[0]);

    const uuid = await accountManager.getUuid();
    if (!uuid) {
      throw new GiftError(GIFT_ERROR_CODES.ACCOUNT_MISSING, 'No account exists yet: nothing can be credited.');
    }
    const accountUuid = normalizeIdentifier(uuid);

    const catalog = await this.loadCatalog();
    const storedSync = this.normalizeGiftSync(await storageRepository.getUserState(USER_STATE_KEYS.GIFT_SYNC));
    const scannedFrom = storedSync.lastCheckedLine;

    const plan = [];
    const ignored = [];
    let lastLineRead = scannedFrom;

    for (const record of records.slice(1)) {
      if (record.line <= scannedFrom) continue;
      lastLineRead = Math.max(lastLineRead, record.line);

      const cells = {
        uuid: record.fields[columns.uuid] ?? '',
        type: record.fields[columns.type] ?? '',
        key: record.fields[columns.key] ?? '',
        quantity: record.fields[columns.quantity] ?? '',
      };
      // A `*` origin addresses every account: no UUID comparison (step 9).
      const isBroadcast = cells.uuid.trim() === BROADCAST_UUID;
      if (!isBroadcast && normalizeIdentifier(cells.uuid) !== accountUuid) continue;

      const analysis = GiftManager.analyzeLine(cells, catalog);
      if (!analysis.ok) {
        ignored.push({
          line: record.line,
          type: cells.type.trim().toLowerCase(),
          key: cells.key.trim(),
          quantity: cells.quantity.trim(),
          reason: analysis.reason,
        });
        continue;
      }
      plan.push({ line: record.line, broadcast: isBroadcast, ...analysis.target });
    }

    const hasBoosterGift = plan.some((item) => item.type === GIFT_TYPES.BOOSTER);
    const hasSparksGift = plan.some((item) => item.type === GIFT_TYPES.SPARKS);
    if (hasBoosterGift) {
      // The daily allowance has to be part of the quota record rewritten below.
      await dateSyncManager.ensureDailyReset();
    }

    const receivedAt = buildCollectionTimestamp();
    // Cards credited by the distributions, collected during the transaction: they are published
    // AFTER the commit (`CARDS_OBTAINED`), next to the quota and the balance.
    const grantedCards = [];
    const grantedNewKeys = [];
    const result = await storageRepository.transaction(
      [STORES.USER_STATE, STORES.COLLECTION, STORES.GIFTS_RECEIVED],
      'readwrite',
      async (context) => {
        const sync = this.normalizeGiftSync(await context.get(STORES.USER_STATE, USER_STATE_KEYS.GIFT_SYNC));
        const alreadyReceived = [];

        let quota = hasBoosterGift
          ? dateSyncManager.normalizeQuota(await context.get(STORES.USER_STATE, USER_STATE_KEYS.QUOTA))
          : null;
        let sparks = 0;

        for (const item of plan) {
          // Anti-duplicate: the line number is the identity of a gift.
          const existing = await context.get(STORES.GIFTS_RECEIVED, item.line);
          if (existing) {
            alreadyReceived.push(item.line);
            continue;
          }

          if (item.type === GIFT_TYPES.BOOSTER) {
            quota = {
              ...quota,
              bonusBoosters: {
                ...quota.bonusBoosters,
                [item.setId]: (quota.bonusBoosters[item.setId] ?? 0) + item.quantity,
              },
            };
          } else if (item.type === GIFT_TYPES.SPARKS) {
            if (sparks === 0) {
              // Read once, lazily: a run without a Sparks gift never touches the balance.
              const stored = await context.get(STORES.USER_STATE, USER_STATE_KEYS.SPARKS);
              sparks = Number.isInteger(stored) && stored >= 0 ? stored : 0;
            }
            sparks += item.quantity;
          } else {
            const existingEntry = await context.get(STORES.COLLECTION, item.card.uniqueKey);
            const quantity = (existingEntry?.quantity ?? 0) + item.quantity;
            grantedCards.push(item.card);
            if (!existingEntry) grantedNewKeys.push(item.card.uniqueKey);
            await context.put(
              STORES.COLLECTION,
              existingEntry
                ? { ...existingEntry, quantity, lastObtainedAt: receivedAt }
                : {
                    key: item.card.uniqueKey,
                    cardId: item.card.id,
                    style: item.card.style,
                    set: item.card.set,
                    quantity,
                    firstObtainedAt: receivedAt,
                    lastObtainedAt: receivedAt,
                  }
            );
          }

          await context.put(STORES.GIFTS_RECEIVED, {
            line: item.line,
            category: GIFT_CATEGORIES.DISTRIBUTION,
            // Always the REAL account UUID, even for a `*` row: the history must stay readable and
            // identify the player (step 9 point 1).
            uuid,
            type: item.type,
            key: item.key,
            quantity: item.quantity,
            receivedAt,
            ...(item.broadcast ? { broadcast: true } : {}),
          });
        }

        if (hasBoosterGift && quota) {
          await context.put(STORES.USER_STATE, quota, USER_STATE_KEYS.QUOTA);
        }
        if (hasSparksGift) {
          await context.put(STORES.USER_STATE, sparks, USER_STATE_KEYS.SPARKS);
        }

        const nextCursor = Math.max(sync.lastCheckedLine, lastLineRead);
        await context.put(
          STORES.USER_STATE,
          { lastCheckedLine: nextCursor, lastCheckAt: receivedAt },
          USER_STATE_KEYS.GIFT_SYNC
        );

        return { alreadyReceived, nextCursor, sparks };
      }
    );

    if (hasSparksGift) {
      eventBus.emit(EVENTS.SPARKS_UPDATED, { balance: result.sparks });
    }

    if (hasBoosterGift) {
      // `DateSyncManager` caches the quota: read it back before publishing it to the header.
      const firstSetId = plan.find((item) => item.type === GIFT_TYPES.BOOSTER).setId;
      await dateSyncManager.getRemainingBoosters(firstSetId);
      dateSyncManager.emitQuotaUpdated(firstSetId);
    }

    if (grantedCards.length > 0) {
      eventBus.emit(EVENTS.CARDS_OBTAINED, {
        cards: grantedCards,
        newKeys: grantedNewKeys,
        source: 'gift',
      });
    }

    const received = plan.filter((item) => !result.alreadyReceived.includes(item.line));
    if (received.length > 0) {
      eventBus.emit(EVENTS.GIFTS_UPDATED, { count: received.length, lines: received.map((item) => item.line) });
    }
    // `nextCursor` never moves backwards, so the reported range would be empty ("8-7") when the
    // sheet has nothing new: say so instead of printing a reversed range.
    const scannedRange =
      result.nextCursor > scannedFrom
        ? `lines ${scannedFrom + 1}-${result.nextCursor}`
        : `nothing new after line ${scannedFrom}`;
    console.info(
      `[GiftManager] Distributions checked (${scannedRange}): ` +
        `${received.length} gift(s) credited, ${ignored.length} ignored, ${result.alreadyReceived.length} already received.`
    );

    return {
      received,
      ignored,
      duplicates: result.alreadyReceived.length,
      scannedFrom,
      scannedTo: result.nextCursor,
      lastCheckAt: receivedAt,
      source: url,
    };
  }
}

/** Shared instance used by the settings view and the gift history. */
export const giftManager = new GiftManager();

export default giftManager;
