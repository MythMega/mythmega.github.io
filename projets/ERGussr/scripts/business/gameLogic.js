/**
 * Game logic shared between practice and daily modes.
 */
import { removeDiacritics } from "../entity/Item.js";

/**
 * Normalizes a string for comparison: lowercase + remove diacritics.
 * @param {string} str
 * @returns {string}
 */
export function normalize(str) {
  if (!str) return "";
  return removeDiacritics(str).toLowerCase().trim();
}

/**
 * Checks if a guess matches the item name (case- and accent-insensitive).
 * @param {string} guess
 * @param {import('../entity/Item.js').Item} item
 * @param {string} lang
 * @returns {boolean}
 */
export function checkGuess(guess, item, lang) {
  const target = lang === "fr" ? item.nameFR : item.nameEN;
  return normalize(guess) === normalize(target);
}

/**
 * Returns today's date as "jj-mm-yyyy".
 * @returns {string}
 */
export function getTodayDateStr() {
  const now = new Date();
  const d = String(now.getDate()).padStart(2, "0");
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const y = now.getFullYear();
  return `${d}-${m}-${y}`;
}

/**
 * Parses a "jj-mm-yyyy" string to a Date object (midnight local time).
 * @param {string} dateStr
 * @returns {Date}
 */
export function parseDateStr(dateStr) {
  const [d, m, y] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Returns true if dateStr is today or in the past.
 * @param {string} dateStr
 * @returns {boolean}
 */
export function isDateValid(dateStr) {
  const target = parseDateStr(dateStr);
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  return target <= today;
}

/**
 * Builds the list of all item names for autocomplete, deduplicated and sorted.
 * @param {import('../entity/Item.js').Item[]} items
 * @param {string} lang
 * @returns {string[]}
 */
export function buildAutocompleteList(items, lang) {
  const set = new Set();
  for (const item of items) {
    const name = lang === "fr" ? item.nameFR : item.nameEN;
    if (name) set.add(name);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/**
 * Filters autocomplete suggestions for a given input.
 * Splits the query into words and matches names containing ALL of them (order-independent).
 * Results sorted: names starting with the full query first, then the rest.
 * No hard cap — returns all matches.
 * @param {string[]} list
 * @param {string} input
 * @returns {string[]}
 */
export function filterSuggestions(list, input) {
  if (!input || !input.trim()) return [];
  const norm = normalize(input);
  const words = norm.split(/\s+/).filter(Boolean);

  const filtered = list.filter(name => {
    const normName = normalize(name);
    return words.every(word => normName.includes(word));
  });

  // Sort: full-query prefix first, then alphabetical
  filtered.sort((a, b) => {
    const na = normalize(a), nb = normalize(b);
    const aStarts = na.startsWith(norm);
    const bStarts = nb.startsWith(norm);
    if (aStarts && !bStarts) return -1;
    if (!aStarts && bStarts) return 1;
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  });

  return filtered;
}
