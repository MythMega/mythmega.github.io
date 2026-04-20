/**
 * Item entity — represents a single game item from any dataset.
 */
export class Item {
  /**
   * @param {string} id - Unique item ID (e.g. "Goods-100")
   * @param {string} nameFR
   * @param {string} nameEN
   * @param {string} desc1FR
   * @param {string} desc1EN
   * @param {string} desc2FR
   * @param {string} desc2EN
   * @param {string} desc3FR
   * @param {string} desc3EN
   * @param {string} pictureURL
   * @param {string} category - e.g. "goods", "weapon", "armor", "magic", "accessories"
   */
  constructor(id, nameFR, nameEN, desc1FR, desc1EN, desc2FR, desc2EN, desc3FR, desc3EN, pictureURL, category) {
    this.id = id;
    this.nameFR = nameFR || "";
    this.nameEN = nameEN || "";
    this.desc1FR = desc1FR || "";
    this.desc1EN = desc1EN || "";
    this.desc2FR = desc2FR || "";
    this.desc2EN = desc2EN || "";
    this.desc3FR = desc3FR || "";
    this.desc3EN = desc3EN || "";
    this.pictureURL = pictureURL || "";
    this.category = category;
  }

  /** Returns the display name in the given language. */
  getName(lang) {
    return lang === "fr" ? (this.nameFR || this.nameEN) : (this.nameEN || this.nameFR);
  }

  /** Returns desc1 in the given language. */
  getDesc1(lang) {
    return lang === "fr" ? this.desc1FR : this.desc1EN;
  }

  /** Returns desc2 in the given language. */
  getDesc2(lang) {
    return lang === "fr" ? this.desc2FR : this.desc2EN;
  }

  /** Returns desc3 in the given language (goods only). */
  getDesc3(lang) {
    return lang === "fr" ? this.desc3FR : this.desc3EN;
  }

  /**
   * Replaces all words of the item name in a text string with "###".
   * Case- and accent-insensitive.
   * @param {string} text
   * @param {string} lang
   * @returns {string}
   */
  censorName(text, lang) {
    if (!text) return text;
    const name = this.getName(lang);
    if (!name) return text;
    // Build a list of words from both language names to censor
    const allNames = [this.nameFR, this.nameEN].filter(Boolean);
    let result = text;
    for (const n of allNames) {
      const words = n.split(/\s+/).filter(w => w.length > 2);
      for (const word of words) {
        const normalized = removeDiacritics(word);
        // Replace the word (accent-insensitive) with ###
        const regex = new RegExp(
          normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          "gi"
        );
        // Work on a diacritic-stripped version comparison but replace in original
        result = replaceCaseAccentInsensitive(result, word, "###");
      }
    }
    return result;
  }
}

/**
 * Removes diacritics from a string.
 * @param {string} str
 * @returns {string}
 */
export function removeDiacritics(str) {
  if (!str) return "";
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Replaces all occurrences of `word` in `text` with `replacement`,
 * case- and accent-insensitive.
 * @param {string} text
 * @param {string} word
 * @param {string} replacement
 * @returns {string}
 */
export function replaceCaseAccentInsensitive(text, word, replacement) {
  if (!text || !word) return text;
  // Escape special regex chars in the word (after stripping diacritics)
  const escaped = removeDiacritics(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Build regex that matches diacritic-stripped version
  // We need to iterate char by char to handle accents
  // Simpler approach: normalize both, then do a global replace mapping back positions
  // Use a replace approach on normalized text
  const normalizedText = removeDiacritics(text);
  const regex = new RegExp(escaped, "gi");
  // Find all match positions in normalized text, replace in original by index
  let result = "";
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(normalizedText)) !== null) {
    result += text.slice(lastIndex, match.index) + replacement;
    lastIndex = match.index + match[0].length;
  }
  result += text.slice(lastIndex);
  return result;
}
