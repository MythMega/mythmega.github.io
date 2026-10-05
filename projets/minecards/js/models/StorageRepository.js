/**
 * StorageRepository - Single access point to the IndexedDB database.
 *
 * Reference: `.docs/main.md` section 2 (data model) and `.docs/steps/1.md` point 3.
 *
 * Database `CardBoosterDB` version 1 with four object stores:
 *   - `collection`      key `key`  = `${id}_${style}`         -> { key, cardId, style, set,
 *                                                                 quantity, firstObtainedAt, lastObtainedAt }
 *   - `user_state`      out-of-line text key                  -> application states (see AccountManager)
 *   - `redeemed_codes`  key `code`                            -> { code, redeemedAt }
 *   - `gifts_received`  key `line`                            -> { line, uuid, type, key, quantity, receivedAt }
 *
 * Every method is promise-based and validates its arguments, so a programming error surfaces
 * immediately instead of silently writing corrupted data.
 *
 * Transactions: `transaction()` resolves only once the IndexedDB transaction has actually
 * committed (`oncomplete`). The callback must not await anything else than the helpers it
 * receives, otherwise the transaction auto-commits in the middle of the work.
 */

/** IndexedDB database name. */
export const DB_NAME = 'CardBoosterDB';

/** Schema version. Increment it and extend `STORE_DEFINITIONS` to migrate the database. */
export const DB_VERSION = 1;

/** Object store names, shared with the business layer and `SaveFile`. */
export const STORES = Object.freeze({
  COLLECTION: 'collection',
  USER_STATE: 'user_state',
  REDEEMED_CODES: 'redeemed_codes',
  GIFTS_RECEIVED: 'gifts_received',
});

/**
 * Declarative definition of every object store.
 * `keyPath: null` means the store uses out-of-line keys (passed to `setItem`).
 */
const STORE_DEFINITIONS = Object.freeze([
  Object.freeze({ name: STORES.COLLECTION, keyPath: 'key' }),
  Object.freeze({ name: STORES.USER_STATE, keyPath: null }),
  Object.freeze({ name: STORES.REDEEMED_CODES, keyPath: 'code' }),
  Object.freeze({ name: STORES.GIFTS_RECEIVED, keyPath: 'line' }),
]);

/** Valid IndexedDB transaction modes. */
const TRANSACTION_MODES = Object.freeze(['readonly', 'readwrite']);

export class StorageRepository {
  /**
   * @param {string} [databaseName=DB_NAME] - Database name (overridable for tooling).
   * @param {number} [databaseVersion=DB_VERSION] - Schema version.
   */
  constructor(databaseName = DB_NAME, databaseVersion = DB_VERSION) {
    this.databaseName = databaseName;
    this.databaseVersion = databaseVersion;
    /** @type {IDBDatabase|null} */
    this.db = null;
    /** @type {Promise<IDBDatabase>|null} */
    this.openPromise = null;
  }

  /**
   * Checks that the runtime exposes IndexedDB.
   *
   * @returns {boolean} True when `indexedDB` is usable (private browsing may disable it).
   */
  static isSupported() {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  }

  /**
   * Wraps an `IDBRequest` into a promise.
   *
   * @param {IDBRequest} request - Request to wait for.
   * @param {string} label - Human readable label used in error messages.
   * @returns {Promise<unknown>} The request result.
   * @throws {Error} When the request fails.
   */
  static wrapRequest(request, label) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        reject(new Error(`IndexedDB request failed: ${label}.`, { cause: request.error }));
      };
    });
  }

  /**
   * Asserts that a value is a known object store name.
   *
   * @param {unknown} storeName - Candidate store name.
   * @returns {string} The validated store name.
   * @throws {RangeError} When the store is unknown.
   */
  static assertStoreName(storeName) {
    if (!Object.values(STORES).includes(storeName)) {
      throw new RangeError(
        `Unknown object store "${storeName}". Expected one of [${Object.values(STORES).join(', ')}].`
      );
    }
    return storeName;
  }

  /**
   * Gets the definition of a store (key path, out-of-line key requirement).
   *
   * @param {string} storeName - Store name.
   * @returns {{name: string, keyPath: string|null}} The store definition.
   * @throws {RangeError} When the store is unknown.
   */
  static getStoreDefinition(storeName) {
    StorageRepository.assertStoreName(storeName);
    return STORE_DEFINITIONS.find((definition) => definition.name === storeName);
  }

  /**
   * Opens (and upgrades when needed) the database connection.
   *
   * @returns {Promise<IDBDatabase>} The opened database.
   * @throws {Error} When IndexedDB is unavailable or when the open/upgrade request fails.
   */
  async open() {
    if (this.db) return this.db;
    if (this.openPromise) return this.openPromise;

    if (!StorageRepository.isSupported()) {
      throw new Error('IndexedDB is not available in this browser.');
    }

    this.openPromise = new Promise((resolve, reject) => {
      let request;
      try {
        request = indexedDB.open(this.databaseName, this.databaseVersion);
      } catch (error) {
        reject(new Error(`Unable to open the IndexedDB database "${this.databaseName}".`, { cause: error }));
        return;
      }

      request.onupgradeneeded = (event) => this.handleUpgrade(request.result, event);
      request.onsuccess = () => {
        this.db = request.result;
        this.installVersionChangeHandler(this.db);
        resolve(this.db);
      };
      request.onerror = () => {
        reject(
          new Error(`Unable to open the IndexedDB database "${this.databaseName}".`, {
            cause: request.error,
          })
        );
      };
      request.onblocked = () => {
        console.warn(`[StorageRepository] Upgrade of "${this.databaseName}" is blocked by another tab.`);
      };
    });

    try {
      return await this.openPromise;
    } catch (error) {
      this.openPromise = null;
      throw error;
    }
  }

  /**
   * Creates the missing object stores during a schema upgrade.
   *
   * @param {IDBDatabase} database - Database being upgraded.
   * @param {IDBVersionChangeEvent} event - Upgrade event carrying `oldVersion`.
   * @returns {void}
   */
  handleUpgrade(database, event) {
    STORE_DEFINITIONS.forEach((definition) => {
      if (database.objectStoreNames.contains(definition.name)) return;
      if (definition.keyPath) {
        database.createObjectStore(definition.name, { keyPath: definition.keyPath });
      } else {
        database.createObjectStore(definition.name);
      }
      console.info(
        `[StorageRepository] Created object store "${definition.name}" (schema v${this.databaseVersion}, from v${event.oldVersion}).`
      );
    });
  }

  /**
   * Closes the connection when another tab requests a higher schema version.
   *
   * @param {IDBDatabase} database - Opened database.
   * @returns {void}
   */
  installVersionChangeHandler(database) {
    database.onversionchange = () => {
      console.warn('[StorageRepository] Database version changed elsewhere: closing this connection.');
      this.close();
    };
  }

  /**
   * Closes the current connection. The next call to `open()` reopens it.
   *
   * @returns {void}
   */
  close() {
    if (this.db) {
      this.db.close();
    }
    this.db = null;
    this.openPromise = null;
  }

  /**
   * Reads a single record.
   *
   * @param {string} storeName - Object store name (one of `STORES`).
   * @param {IDBValidKey} key - Record key.
   * @returns {Promise<unknown>} The stored value, or `undefined` when the key is absent.
   * @throws {RangeError} When the store is unknown.
   * @throws {TypeError} When the key is missing.
   * @throws {Error} When the read fails.
   */
  async getItem(storeName, key) {
    StorageRepository.assertStoreName(storeName);
    if (key === undefined || key === null) {
      throw new TypeError(`StorageRepository.getItem("${storeName}") requires a key.`);
    }
    return this.transaction(storeName, 'readonly', (context) => context.get(storeName, key));
  }

  /**
   * Writes a record (insert or replace).
   *
   * Two call shapes are supported:
   *   - stores with a `keyPath` (collection, redeemed_codes, gifts_received):
   *     `setItem(store, value)` — the key is read from the value itself;
   *   - out-of-line key store (`user_state`): `setItem(store, key, value)`.
   *
   * @param {string} storeName - Object store name.
   * @param {IDBValidKey|unknown} keyOrValue - Key, or the value for keyPath stores.
   * @param {unknown} [value] - Value to persist (out-of-line key stores only).
   * @returns {Promise<IDBValidKey>} The key of the written record.
   * @throws {RangeError} When the store is unknown.
   * @throws {TypeError} When the arguments do not match the store contract.
   * @throws {Error} When the write fails.
   */
  async setItem(storeName, keyOrValue, value) {
    const definition = StorageRepository.getStoreDefinition(storeName);
    const isValueOnlyCall = arguments.length <= 2;

    if (definition.keyPath && isValueOnlyCall) {
      return this.transaction(storeName, 'readwrite', (context) => context.put(storeName, keyOrValue));
    }
    if (!definition.keyPath && isValueOnlyCall) {
      throw new TypeError(
        `StorageRepository.setItem("${storeName}") requires an explicit key: setItem(store, key, value).`
      );
    }
    return this.transaction(storeName, 'readwrite', (context) => context.put(storeName, value, keyOrValue));
  }

  /**
   * Reads every record of a store.
   *
   * @param {string} storeName - Object store name.
   * @returns {Promise<unknown[]>} An array of stored values (empty when the store is empty).
   * @throws {RangeError} When the store is unknown.
   * @throws {Error} When the read fails.
   */
  async getAll(storeName) {
    StorageRepository.assertStoreName(storeName);
    return this.transaction(storeName, 'readonly', (context) => context.getAll(storeName));
  }

  /**
   * Counts the records of a store.
   *
   * @param {string} storeName - Object store name.
   * @returns {Promise<number>} The number of records.
   * @throws {RangeError} When the store is unknown.
   * @throws {Error} When the read fails.
   */
  async count(storeName) {
    StorageRepository.assertStoreName(storeName);
    return this.transaction(storeName, 'readonly', (context) => context.count(storeName));
  }

  /**
   * Deletes a single record.
   *
   * @param {string} storeName - Object store name.
   * @param {IDBValidKey} key - Key of the record to delete.
   * @returns {Promise<undefined>} Always resolves to `undefined` (no error when absent).
   * @throws {RangeError} When the store is unknown.
   * @throws {TypeError} When the key is missing.
   * @throws {Error} When the deletion fails.
   */
  async deleteItem(storeName, key) {
    StorageRepository.assertStoreName(storeName);
    if (key === undefined || key === null) {
      throw new TypeError(`StorageRepository.deleteItem("${storeName}") requires a key.`);
    }
    return this.transaction(storeName, 'readwrite', (context) => context.delete(storeName, key));
  }

  /**
   * Removes every record from every store (the UUID included).
   *
   * Used by the "full reset" flow: the account is destroyed, so the app returns to the
   * onboarding screen on the next start.
   *
   * @returns {Promise<void>} Resolves once the single transaction has committed.
   * @throws {Error} When the transaction fails or is aborted.
   */
  async clearAll() {
    const storeNames = Object.values(STORES);
    await this.transaction(storeNames, 'readwrite', async (context) => {
      for (const storeName of storeNames) {
        await context.clear(storeName);
      }
    });
  }

  /**
   * Runs an atomic operation across one or several object stores.
   *
   * The callback receives a context object exposing awaited helpers
   * (`get`, `getAll`, `count`, `put`, `add`, `delete`, `clear`, `store`) that all target the
   * same IndexedDB transaction. The returned promise resolves with the callback result once
   * the transaction has committed, and rejects as soon as a request fails or the callback
   * throws (the transaction is then aborted, so nothing is partially written).
   *
   * @param {string|string[]} storeNames - Store name(s) involved in the transaction.
   * @param {'readonly'|'readwrite'} mode - IndexedDB transaction mode.
   * @param {(context: object) => unknown|Promise<unknown>} work - Operation to execute.
   * @returns {Promise<unknown>} The value returned by `work`.
   * @throws {RangeError} When a store name or the mode is invalid.
   * @throws {TypeError} When no store or no callback is provided.
   * @throws {Error} When the transaction cannot be started, fails or is aborted.
   */
  async transaction(storeNames, mode, work) {
    const stores = Array.isArray(storeNames) ? storeNames.slice() : [storeNames];
    if (stores.length === 0) {
      throw new TypeError('StorageRepository.transaction requires at least one store name.');
    }
    stores.forEach((storeName) => StorageRepository.assertStoreName(storeName));
    if (!TRANSACTION_MODES.includes(mode)) {
      throw new RangeError(
        `Invalid transaction mode "${mode}". Expected one of [${TRANSACTION_MODES.join(', ')}].`
      );
    }
    if (typeof work !== 'function') {
      throw new TypeError('StorageRepository.transaction requires a callback function.');
    }

    const database = await this.open();

    let idbTransaction;
    try {
      idbTransaction = database.transaction(stores, mode);
    } catch (error) {
      throw new Error(`Unable to start a "${mode}" transaction on [${stores.join(', ')}].`, { cause: error });
    }

    const context = this.createTransactionContext(idbTransaction);
    const failureMessage = `Transaction on [${stores.join(', ')}] failed.`;

    return new Promise((resolve, reject) => {
      const workPromise = Promise.resolve().then(() => work(context));

      workPromise.catch((error) => {
        // Abort so that no partial write survives a business error.
        try {
          idbTransaction.abort();
        } catch (abortError) {
          console.warn('[StorageRepository] Unable to abort the transaction.', abortError);
        }
        reject(error);
      });

      idbTransaction.oncomplete = () => {
        workPromise.then(resolve).catch(reject);
      };
      idbTransaction.onerror = () => {
        reject(new Error(failureMessage, { cause: idbTransaction.error }));
      };
      idbTransaction.onabort = () => {
        reject(new Error(`${failureMessage} The transaction was aborted.`, { cause: idbTransaction.error }));
      };
    });
  }

  /**
   * Builds the awaited helper set handed to a `transaction()` callback.
   *
   * @param {IDBTransaction} idbTransaction - Open IndexedDB transaction.
   * @returns {object} Context with `transaction`, `store`, `get`, `getAll`, `count`, `put`,
   *   `add`, `delete` and `clear` members, every helper returning a promise.
   */
  createTransactionContext(idbTransaction) {
    /**
     * Wraps one store operation into a promise.
     *
     * @param {string} storeName - Target store.
     * @param {string} label - Label used in error messages.
     * @param {(store: IDBObjectStore) => IDBRequest} requestFactory - Request builder.
     * @returns {Promise<unknown>} The request result.
     */
    const run = (storeName, label, requestFactory) => {
      let request;
      try {
        request = requestFactory(idbTransaction.objectStore(StorageRepository.assertStoreName(storeName)));
      } catch (error) {
        return Promise.reject(new Error(`IndexedDB request failed: ${label}.`, { cause: error }));
      }
      return StorageRepository.wrapRequest(request, label);
    };

    return {
      transaction: idbTransaction,
      store: (storeName) => idbTransaction.objectStore(StorageRepository.assertStoreName(storeName)),
      get: (storeName, key) => run(storeName, `${storeName}.get`, (store) => store.get(key)),
      getAll: (storeName) => run(storeName, `${storeName}.getAll`, (store) => store.getAll()),
      count: (storeName) => run(storeName, `${storeName}.count`, (store) => store.count()),
      put: (storeName, value, key) =>
        run(storeName, `${storeName}.put`, (store) => (key === undefined ? store.put(value) : store.put(value, key))),
      add: (storeName, value, key) =>
        run(storeName, `${storeName}.add`, (store) => (key === undefined ? store.add(value) : store.add(value, key))),
      delete: (storeName, key) => run(storeName, `${storeName}.delete`, (store) => store.delete(key)),
      clear: (storeName) => run(storeName, `${storeName}.clear`, (store) => store.clear()),
    };
  }

  /**
   * Reads a `user_state` entry.
   *
   * @param {string} key - State key ("account", "settings", "quota", "timeAnchor",
   *   "stats", "giftSync").
   * @returns {Promise<unknown>} The stored state, or `undefined` when it does not exist.
   * @throws {TypeError} When the key is not a non-empty string.
   * @throws {Error} When the read fails.
   */
  async getUserState(key) {
    this.assertStateKey(key);
    return this.getItem(STORES.USER_STATE, key);
  }

  /**
   * Writes a `user_state` entry (insert or replace).
   *
   * @param {string} key - State key.
   * @param {unknown} value - Value to persist (must be structured-cloneable).
   * @returns {Promise<IDBValidKey>} The written key.
   * @throws {TypeError} When the key is invalid or the value is undefined.
   * @throws {Error} When the write fails.
   */
  async setUserState(key, value) {
    this.assertStateKey(key);
    if (value === undefined) {
      throw new TypeError(`StorageRepository.setUserState("${key}") requires a defined value.`);
    }
    return this.setItem(STORES.USER_STATE, key, value);
  }

  /**
   * Checks the existence of a `user_state` entry.
   *
   * @param {string} key - State key.
   * @returns {Promise<boolean>} True when the entry exists.
   * @throws {TypeError} When the key is invalid.
   * @throws {Error} When the read fails.
   */
  async hasUserState(key) {
    this.assertStateKey(key);
    const value = await this.getUserState(key);
    return value !== undefined && value !== null;
  }

  /**
   * Reads every `user_state` entry.
   *
   * @returns {Promise<unknown[]>} All state values (keys are not returned by IndexedDB).
   * @throws {Error} When the read fails.
   */
  async getAllUserState() {
    return this.getAll(STORES.USER_STATE);
  }

  /**
   * Deletes a `user_state` entry.
   *
   * @param {string} key - State key.
   * @returns {Promise<undefined>} Always resolves to `undefined`.
   * @throws {TypeError} When the key is invalid.
   * @throws {Error} When the deletion fails.
   */
  async deleteUserState(key) {
    this.assertStateKey(key);
    return this.deleteItem(STORES.USER_STATE, key);
  }

  /**
   * Drops the whole database (used by tooling and by a hard reset that must also remove the
   * schema). The regular "full reset" flow only needs `clearAll()`.
   *
   * @returns {Promise<void>} Resolves once the database is deleted.
   * @throws {Error} When IndexedDB is unavailable or the deletion fails.
   */
  async deleteDatabase() {
    this.close();
    if (!StorageRepository.isSupported()) {
      throw new Error('IndexedDB is not available in this browser.');
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(this.databaseName);
      request.onsuccess = () => resolve();
      request.onerror = () => {
        reject(new Error(`Unable to delete the IndexedDB database "${this.databaseName}".`, { cause: request.error }));
      };
      request.onblocked = () => {
        console.warn(`[StorageRepository] Deletion of "${this.databaseName}" is blocked by another open tab.`);
      };
    });
  }

  /**
   * Validates a `user_state` key.
   *
   * @param {unknown} key - Candidate key.
   * @returns {string} The validated key.
   * @throws {TypeError} When the key is not a non-empty string.
   */
  assertStateKey(key) {
    if (typeof key !== 'string' || key.trim() === '') {
      throw new TypeError(`user_state keys must be non-empty strings (received: ${JSON.stringify(key)}).`);
    }
    return key;
  }
}

/** Shared repository instance used by the whole application. */
export const storageRepository = new StorageRepository();

export default storageRepository;
