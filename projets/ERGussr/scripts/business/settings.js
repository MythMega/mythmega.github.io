/**
 * Settings / preferences manager.
 * Stores language and highscore in cookies.
 */

const LANG_COOKIE = "erg_lang";
const HIGHSCORE_COOKIE = "erg_highscore";
const COOKIE_DAYS = 365;

/** Sets a cookie. */
function setCookie(name, value, days) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

/** Gets a cookie value or null. */
function getCookie(name) {
  const match = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : null;
}

/** Returns the stored language preference (default: "fr"). */
export function getLangPref() {
  return getCookie(LANG_COOKIE) || "fr";
}

/** Saves the language preference. */
export function setLangPref(lang) {
  console.log(`[settings] Setting language to: ${lang}`);
  setCookie(LANG_COOKIE, lang, COOKIE_DAYS);
}

/** Returns the stored practice highscore (default: 0). */
export function getHighscore() {
  return parseInt(getCookie(HIGHSCORE_COOKIE) || "0", 10);
}

/** Updates the highscore if newScore is higher. Returns true if updated. */
export function updateHighscore(newScore) {
  const current = getHighscore();
  if (newScore > current) {
    setCookie(HIGHSCORE_COOKIE, String(newScore), COOKIE_DAYS);
    console.log(`[settings] Highscore updated: ${current} → ${newScore}`);
    return true;
  }
  console.log(`[settings] Highscore not updated (${newScore} <= ${current})`);
  return false;
}

/** Force-sets the highscore (used during import). */
export function setHighscore(value) {
  setCookie(HIGHSCORE_COOKIE, String(value), COOKIE_DAYS);
}
