/**
 * i18n / Translation loader.
 * Loads translation files and provides a t() helper.
 */

let translations = {};
let currentLang = "fr";

/**
 * Loads the translation file for the given language.
 * @param {string} lang - "fr" or "en"
 */
export async function loadTranslations(lang) {
  console.log(`[i18n] Loading translations for lang: ${lang}`);
  try {
    const resp = await fetch(`./translation/${lang}.json`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    translations = await resp.json();
    currentLang = lang;
    console.log(`[i18n] Translations loaded for ${lang}`);
  } catch (e) {
    console.error(`[i18n] Failed to load translations for ${lang}:`, e);
    // Fallback: try fr
    if (lang !== "fr") {
      console.warn("[i18n] Falling back to fr");
      await loadTranslations("fr");
    }
  }
}

/**
 * Returns the translation for a dot-separated key (e.g. "nav.home").
 * Falls back to the key itself if not found.
 * @param {string} key
 * @returns {string}
 */
export function t(key) {
  const parts = key.split(".");
  let val = translations;
  for (const p of parts) {
    if (val && typeof val === "object" && p in val) {
      val = val[p];
    } else {
      console.warn(`[i18n] Missing key: ${key}`);
      return key;
    }
  }
  return typeof val === "string" ? val : key;
}

/** Returns the currently active language. */
export function getLang() {
  return currentLang;
}
