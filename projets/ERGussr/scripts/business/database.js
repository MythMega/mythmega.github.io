/**
 * IndexedDB wrapper for storing daily results.
 */
import { DailyResult } from "../entity/DailyResult.js";

const DB_NAME = "ERGussr";
const DB_VERSION = 1;
const STORE_NAME = "daily_results";

/** @type {IDBDatabase|null} */
let db = null;

/**
 * Opens (or creates) the IndexedDB database.
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
  if (db) return Promise.resolve(db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "date" });
        console.log("[DB] Object store created:", STORE_NAME);
      }
    };
    req.onsuccess = e => {
      db = e.target.result;
      console.log("[DB] Database opened successfully");
      resolve(db);
    };
    req.onerror = e => {
      console.error("[DB] Failed to open database:", e.target.error);
      reject(e.target.error);
    };
  });
}

/**
 * Saves a DailyResult to IndexedDB.
 * @param {DailyResult} result
 * @returns {Promise<void>}
 */
export async function saveDailyResult(result) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.put({ date: result.date, scoreTotal: result.scoreTotal, rounds: result.rounds });
    req.onsuccess = () => {
      console.log(`[DB] Daily saved for date: ${result.date}`);
      resolve();
    };
    req.onerror = e => {
      console.error("[DB] Failed to save daily result:", e.target.error);
      reject(e.target.error);
    };
  });
}

/**
 * Gets a DailyResult by date string, or null if not found.
 * @param {string} date - "jj-mm-yyyy"
 * @returns {Promise<DailyResult|null>}
 */
export async function getDailyResult(date) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(date);
    req.onsuccess = e => {
      const raw = e.target.result;
      if (!raw) {
        resolve(null);
      } else {
        resolve(new DailyResult(raw.date, raw.scoreTotal, raw.rounds));
      }
    };
    req.onerror = e => {
      console.error("[DB] Failed to get daily result:", e.target.error);
      reject(e.target.error);
    };
  });
}

/**
 * Returns all DailyResults, sorted by date descending.
 * @returns {Promise<DailyResult[]>}
 */
export async function getAllDailyResults() {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = e => {
      const all = (e.target.result || []).map(
        r => new DailyResult(r.date, r.scoreTotal, r.rounds)
      );
      // Sort by date descending (dd-mm-yyyy → parse to comparable)
      all.sort((a, b) => parseDateStr(b.date) - parseDateStr(a.date));
      console.log(`[DB] Retrieved ${all.length} daily results`);
      resolve(all);
    };
    req.onerror = e => {
      console.error("[DB] Failed to get all daily results:", e.target.error);
      reject(e.target.error);
    };
  });
}

/**
 * Deletes all entries from the store.
 * @returns {Promise<void>}
 */
export async function clearAllDailyResults() {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.clear();
    req.onsuccess = () => {
      console.log("[DB] All daily results cleared");
      resolve();
    };
    req.onerror = e => {
      console.error("[DB] Failed to clear daily results:", e.target.error);
      reject(e.target.error);
    };
  });
}

/**
 * Parses a "jj-mm-yyyy" date string to a timestamp for comparison.
 * @param {string} dateStr
 * @returns {number}
 */
function parseDateStr(dateStr) {
  if (!dateStr) return 0;
  const [d, m, y] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

/** Exports parseDateStr for use elsewhere. */
export { parseDateStr };
