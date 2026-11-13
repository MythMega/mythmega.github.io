/**
 * In-memory replacement for `StorageRepository`, used by the resource-safety tests.
 *
 * The real database is IndexedDB and cannot run under Node. Every business flow under test only
 * needs the transaction contract: a callback receives `get`/`put`/`delete` helpers, and every
 * write is committed together or discarded when the callback throws. This module implements that
 * contract on plain Maps, with a deep copy at the transaction boundary (so an object mutated after
 * `put` cannot leak into the committed state) and a failure hook that simulates a storage error at
 * a precise write.
 */

import { storageRepository, STORES } from '../../../js/models/StorageRepository.js';

/** Every store, in the order the real repository declares them. */
const STORE_NAMES = Object.values(STORES);

/** @type {Map<string, Map<unknown, unknown>>} The committed tables. */
let tables = buildEmptyTables();

/** @type {((store: string, key: unknown, value: unknown) => boolean)|null} Injected write failure. */
let writeFailure = null;

/**
 * Builds one empty table per object store.
 *
 * @returns {Map<string, Map<unknown, unknown>>} The empty tables.
 */
function buildEmptyTables() {
  return new Map(STORE_NAMES.map((name) => [name, new Map()]));
}

/**
 * Deep-copies a value so the caller can never mutate committed state through a reference.
 *
 * @param {unknown} value - Value to copy.
 * @returns {unknown} The copy.
 */
function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

/**
 * Returns the key a record is stored under.
 *
 * `user_state` uses an out-of-line key supplied by the caller; the three other stores use the
 * `keyPath` declared by the real repository (`key`, `code` or `line`).
 *
 * @param {string} store - Store name.
 * @param {unknown} value - Record being written.
 * @param {unknown} explicitKey - Key passed to `put`, when any.
 * @returns {unknown} The effective key.
 */
function resolveKey(store, value, explicitKey) {
  if (store === STORES.USER_STATE) return explicitKey;
  if (store === STORES.COLLECTION) return explicitKey ?? value?.key;
  if (store === STORES.REDEEMED_CODES) return explicitKey ?? value?.code;
  if (store === STORES.GIFTS_RECEIVED) return explicitKey ?? value?.line;
  return explicitKey;
}

/**
 * Copies the committed table of one store into a transaction-local map.
 *
 * @param {string} store - Store name.
 * @returns {Map<unknown, unknown>} The staged table.
 */
function stageTable(store) {
  return new Map(
    Array.from(tables.get(store) ?? [], ([key, value]) => [key, clone(value)])
  );
}

/**
 * Builds the context handed to a transaction callback.
 *
 * @param {Map<string, Map<unknown, unknown>>} staged - Transaction-local tables.
 * @returns {object} The transaction context.
 */
function buildContext(staged) {
  /**
   * Returns a staged table or fails loudly when the transaction did not declare the store.
   *
   * @param {string} store - Store name.
   * @returns {Map<unknown, unknown>} The staged table.
   */
  const table = (store) => {
    const found = staged.get(store);
    if (!found) throw new Error(`The transaction did not open the store "${store}".`);
    return found;
  };

  return {
    /**
     * Reads one record.
     *
     * @param {string} store - Store name.
     * @param {unknown} key - Record key.
     * @returns {Promise<unknown>} The copy, or undefined.
     */
    get: async (store, key) => clone(table(store).get(key)),

    /**
     * Reads every record of a store.
     *
     * @param {string} store - Store name.
     * @returns {Promise<unknown[]>} The copies.
     */
    getAll: async (store) => Array.from(table(store).values(), (value) => clone(value)),

    /**
     * Counts the records of a store.
     *
     * @param {string} store - Store name.
     * @returns {Promise<number>} The count.
     */
    count: async (store) => table(store).size,

    /**
     * Writes one record.
     *
     * @param {string} store - Store name.
     * @param {unknown} value - Record.
     * @param {unknown} [key] - Out-of-line key.
     * @returns {Promise<unknown>} The effective key.
     */
    put: async (store, value, key) => {
      const effectiveKey = resolveKey(store, value, key);
      if (effectiveKey === undefined || effectiveKey === null) {
        throw new TypeError(`A record of "${store}" has no key.`);
      }
      if (writeFailure && writeFailure(store, effectiveKey, value)) {
        throw new Error(`Injected storage failure while writing "${store}/${String(effectiveKey)}".`);
      }
      table(store).set(effectiveKey, clone(value));
      return effectiveKey;
    },

    /**
     * Adds one record, refusing to replace an existing key.
     *
     * @param {string} store - Store name.
     * @param {unknown} value - Record.
     * @param {unknown} [key] - Out-of-line key.
     * @returns {Promise<unknown>} The effective key.
     */
    add: async (store, value, key) => {
      const effectiveKey = resolveKey(store, value, key);
      if (table(store).has(effectiveKey)) {
        throw new Error(`A record "${store}/${String(effectiveKey)}" already exists.`);
      }
      return buildContext(staged).put(store, value, key);
    },

    /**
     * Deletes one record.
     *
     * @param {string} store - Store name.
     * @param {unknown} key - Record key.
     * @returns {Promise<void>} Resolves once the staged delete is done.
     */
    delete: async (store, key) => {
      table(store).delete(key);
    },

    /**
     * Clears one store.
     *
     * @param {string} store - Store name.
     * @returns {Promise<void>} Resolves once the staged table is empty.
     */
    clear: async (store) => {
      table(store).clear();
    },
  };
}

/**
 * Replaces the real `StorageRepository.transaction` with the in-memory implementation.
 *
 * The other repository methods (`getUserState`, `setUserState`, `getItem`, `getAll`, …) all go
 * through `transaction`, so patching this one method is enough. The patch is process-wide, which is
 * why each test file runs in its own Node test worker.
 *
 * @returns {void}
 */
export function installFakeStorage() {
  storageRepository.transaction = async (storeNames, mode, work) => {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const staged = new Map(names.map((name) => [name, stageTable(name)]));
    const context = buildContext(staged);
    const result = await work(context);
    names.forEach((name) => tables.set(name, staged.get(name)));
    return clone(result);
  };
}

/**
 * Empties every table and applies optional initial records.
 *
 * Initial values are plain objects:
 * `{ user_state: { sparks: 100 }, collection: { 'CARD_classic': { … } } }`.
 *
 * @param {Record<string, Record<string, unknown>>} [initial] - Records to seed.
 * @returns {void}
 */
export function resetStorage(initial = {}) {
  tables = buildEmptyTables();
  writeFailure = null;
  Object.entries(initial).forEach(([store, values]) => {
    if (!tables.has(store)) throw new RangeError(`Unknown store "${store}".`);
    Object.entries(values ?? {}).forEach(([key, value]) => {
      tables.get(store).set(key, clone(value));
    });
  });
}

/**
 * Reads a committed `user_state` value.
 *
 * @param {string} key - State key.
 * @returns {unknown} The copy, or undefined.
 */
export function readState(key) {
  return clone(tables.get(STORES.USER_STATE)?.get(key));
}

/**
 * Writes a committed `user_state` value without going through a transaction.
 *
 * @param {string} key - State key.
 * @param {unknown} value - Value to store.
 * @returns {void}
 */
export function writeState(key, value) {
  tables.get(STORES.USER_STATE).set(key, clone(value));
}

/**
 * Reads a committed collection row.
 *
 * @param {string} key - Collection key.
 * @returns {unknown} The copy, or undefined.
 */
export function readCollection(key) {
  return clone(tables.get(STORES.COLLECTION)?.get(key));
}

/**
 * Returns every committed row of one store, keyed by its stored key.
 *
 * @param {string} store - Store name.
 * @returns {Record<string, unknown>} The copies.
 */
export function readStore(store) {
  return Object.fromEntries(
    Array.from(tables.get(store) ?? [], ([key, value]) => [String(key), clone(value)])
  );
}

/**
 * Makes the next matching write fail, simulating an IndexedDB error mid-transaction.
 *
 * The predicate is consumed by the test itself (`clearWriteFailure`) so a test can fail one
 * specific write and then let the rollback assertions run.
 *
 * @param {(store: string, key: unknown, value: unknown) => boolean} predicate - Which write fails.
 * @returns {void}
 */
export function failWrite(predicate) {
  writeFailure = predicate;
}

/**
 * Removes the injected write failure.
 *
 * @returns {void}
 */
export function clearWriteFailure() {
  writeFailure = null;
}

export { STORES };
