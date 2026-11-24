/**
 * CompactNumber - the single wording of a big counter.
 *
 * Sparks, received likes and the account value of the profile card are the same kind of number: one
 * total that can reach millions. They all read through `formatCompactNumber()`, so `10 225` is
 * `10.2K` on every screen instead of three different spellings.
 *
 * THE RULES
 *   - under 10 000 the counter is written in full, with the separators of the language (`9 999`);
 *   - from 10 000 the thousands are `K`, the millions `M`, and the billions `Md` (French) or `B`
 *     (English), as the account value of the profile card already did;
 *   - the decimals are TRUNCATED, never rounded, and there is always exactly one: `10 225` reads
 *     `10.2K` and `10 000` reads `10.0K`.
 *
 * The decimal point is a dot in both languages (the compact label is a unit, not a sentence), and
 * the suffix is glued to it: `1.4M`, never `1.4 M`.
 */

/**
 * Units, largest first: the first threshold the amount reaches is the one it wears.
 *
 * `threshold` is where the unit starts, `scale` what the amount is divided by: the thousands only
 * kick in from 10 000, but they still count in thousands (`10 225` is `10.2K`, not `1.0K`).
 */
const UNITS = Object.freeze([
  { threshold: 1_000_000_000, scale: 1_000_000_000, french: 'Md', english: 'B' },
  { threshold: 1_000_000, scale: 1_000_000, french: 'M', english: 'M' },
  { threshold: 10_000, scale: 1_000, french: 'K', english: 'K' },
]);

/**
 * Formats a counter of any size for display.
 *
 * @param {unknown} value - Raw counter; a negative or unusable value reads `0`.
 * @param {string} [lang='fr'] - Active language (`fr` or `en`), which decides the separators and
 *   the billion suffix.
 * @returns {string} The compact label, e.g. `842`, `9 999`, `10.2K`, `1.4M` or `2.5Md`.
 */
export function formatCompactNumber(value, lang = 'fr') {
  const amount = Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
  const isFrench = String(lang).toLowerCase().startsWith('fr');
  const unit = UNITS.find((candidate) => amount >= candidate.threshold);

  if (!unit) {
    try {
      return new Intl.NumberFormat(isFrench ? 'fr' : 'en').format(Math.trunc(amount));
    } catch (error) {
      console.warn('[CompactNumber] The counter could not be formatted.', error);
      return String(Math.trunc(amount));
    }
  }

  // `Math.trunc` on the tenths, then back to a number: truncation is what the label promises, and
  // `toFixed(1)` alone would round it up.
  const scaled = Math.trunc((amount / unit.scale) * 10) / 10;
  const suffix = isFrench ? unit.french : unit.english;
  return `${scaled.toFixed(1)}${suffix}`;
}

export default formatCompactNumber;
