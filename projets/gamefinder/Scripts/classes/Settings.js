/**
 * Settings.js
 * Service de gestion des préférences utilisateur via IndexedDB.
 * Stocke des paires clé/valeur dans une base locale persistante.
 */

class AppSettings {
  static DB_NAME    = 'gamefinder-settings';
  static DB_VERSION = 1;
  static STORE_NAME = 'settings';

  constructor() {
    this._db = null;
  }

  /** Ouvre (ou crée) la base IndexedDB. Idempotent. */
  init() {
    if (this._db) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(AppSettings.DB_NAME, AppSettings.DB_VERSION);

      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(AppSettings.STORE_NAME)) {
          db.createObjectStore(AppSettings.STORE_NAME, { keyPath: 'key' });
        }
      };

      req.onsuccess = e => { this._db = e.target.result; resolve(); };
      req.onerror   = e => reject(e.target.error);
    });
  }

  /**
   * Lit une valeur par sa clé.
   * @param {string} key
   * @param {*}      defaultValue - Retourné si la clé n'existe pas.
   * @returns {Promise<*>}
   */
  async get(key, defaultValue = null) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx  = this._db.transaction(AppSettings.STORE_NAME, 'readonly');
      const req = tx.objectStore(AppSettings.STORE_NAME).get(key);
      req.onsuccess = e => resolve(e.target.result !== undefined ? e.target.result.value : defaultValue);
      req.onerror   = e => reject(e.target.error);
    });
  }

  /**
   * Écrit (ou met à jour) une valeur.
   * @param {string} key
   * @param {*}      value
   * @returns {Promise<void>}
   */
  async set(key, value) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx  = this._db.transaction(AppSettings.STORE_NAME, 'readwrite');
      const req = tx.objectStore(AppSettings.STORE_NAME).put({ key, value });
      req.onsuccess = () => resolve();
      req.onerror   = e  => reject(e.target.error);
    });
  }
}

window.AppSettings = AppSettings;
