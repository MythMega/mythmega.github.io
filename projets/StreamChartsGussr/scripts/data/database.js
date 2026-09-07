/**
 * Couche d'accès IndexedDB pour le cache des profils de streamers.
 *
 * - Store unique `streamers`, clé primaire = `key` (pseudo normalisé).
 * - Durée de vie de 14 jours, définie au niveau du repository.
 * - Si IndexedDB n'est pas disponible (navigation privée sous Firefox,
 *   quota...), on bascule sur un cache mémoire : l'app reste fonctionnelle,
 *   elle perd simplement la persistance.
 */
const DB_NAME = 'streamguessr';
const DB_VERSION = 1;
const STORE = 'streamers';

export const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

let dbPromise = null;
const memoryFallback = new Map();

function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  // On se souvient d'un échec pour ne pas retenter à chaque opération.
  dbPromise.catch(() => {
    dbPromise = null;
  });

  return dbPromise;
}

function runStore(mode, buildRequest) {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        const request = buildRequest(store);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      })
  );
}

export function keyForPseudo(pseudo) {
  return `sg:${pseudo.trim().toLowerCase()}`;
}

export async function readCached(key) {
  try {
    return await runStore('readonly', (store) => store.get(key));
  } catch {
    return memoryFallback.get(key) || null;
  }
}

export async function writeCached(record) {
  try {
    return await runStore('readwrite', (store) => store.put(record));
  } catch {
    memoryFallback.set(record.key, record);
    return record.key;
  }
}

export async function clearCache() {
  try {
    await runStore('readwrite', (store) => store.clear());
  } catch {
    memoryFallback.clear();
  }
}

export async function countCached() {
  try {
    return await runStore('readonly', (store) => store.count());
  } catch {
    return memoryFallback.size;
  }
}

export function isFresh(record) {
  if (!record || !record.cachedAt) return false;
  return Date.now() - record.cachedAt < CACHE_TTL_MS;
}