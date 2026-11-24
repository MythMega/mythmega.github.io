/**
 * FriendshipLevel - the star strip of one friendship.
 *
 * One full star per reached threshold, one empty star for the stars still to earn, the percentage
 * of the way to the next star and the raw counters behind it (`xp / target`). The colour follows the
 * number of full stars (`bronze`, `silver`, `gold`, `diamond`, `emerald`), which is also the colour
 * of the matching trophy tier.
 *
 * The component is stateless: the caller passes the object returned by
 * `FriendshipManager.describeXp()`, so the thresholds live in `settings/global_trophy.json` only.
 */

import i18n from '../../utils/I18n.js';

/** Rarity name of each star count, in threshold order. */
const RARITY_BY_STARS = Object.freeze(['', 'bronze', 'silver', 'gold', 'diamond', 'emerald']);

/**
 * Formats a whole XP counter with the separators of the interface language.
 *
 * @param {unknown} value - XP or threshold.
 * @returns {string} The localized non-negative integer.
 */
function formatNumber(value) {
  const amount = Math.max(0, Math.trunc(Number(value) || 0));
  try {
    return new Intl.NumberFormat(i18n.getLang()).format(amount);
  } catch (error) {
    console.warn('[FriendshipLevel] The experience could not be formatted.', error);
    return String(amount);
  }
}

/**
 * Formats a whole percentage with the separators of the interface language.
 *
 * @param {number} percent - Value between 0 and 100.
 * @returns {string} The localized percentage (e.g. `42 %` in French, `42%` in English).
 */
function formatPercent(percent) {
  const ratio = Math.max(0, Math.min(100, Math.trunc(Number(percent) || 0))) / 100;
  try {
    return new Intl.NumberFormat(i18n.getLang(), {
      style: 'percent',
      maximumFractionDigits: 0,
    }).format(ratio);
  } catch (error) {
    console.warn('[FriendshipLevel] The percentage could not be formatted.', error);
    return `${Math.round(ratio * 100)} %`;
  }
}

/**
 * Builds the star strip and the percentage of one friendship.
 *
 * @param {{xp?: number, stars?: number, total?: number, percent?: number, nextTarget?: number|null,
 *   currentTarget?: number, maxed?: boolean}} progress - Object returned by
 *   `FriendshipManager.describeXp()`.
 * @param {{className?: string}} [options] - Extra class for the container.
 * @returns {HTMLElement} The level element, ready to insert.
 */
export function buildFriendshipLevel(progress, { className = '' } = {}) {
  const total = Math.max(1, Math.trunc(Number(progress?.total) || 5));
  const stars = Math.max(0, Math.min(total, Math.trunc(Number(progress?.stars) || 0)));
  const percent = Math.max(0, Math.min(100, Math.trunc(Number(progress?.percent) || 0)));
  const percentLabel = formatPercent(percent);
  const ariaLabel = i18n.t(progress?.maxed === true ? 'friendship.max' : 'friendship.aria', {
    stars: String(stars),
    total: String(total),
    percent: percentLabel,
  });

  const host = document.createElement('span');
  host.className = ['friendship-level', className].filter(Boolean).join(' ');
  host.dataset.stars = String(stars);
  if (stars > 0) host.dataset.color = RARITY_BY_STARS[stars] ?? 'emerald';

  const strip = document.createElement('span');
  strip.className = 'friendship-level__stars';
  strip.setAttribute('role', 'img');
  strip.setAttribute('aria-label', ariaLabel);
  strip.title = ariaLabel;
  for (let index = 0; index < total; index += 1) {
    const star = document.createElement('span');
    star.className = index < stars
      ? 'friendship-level__star is-filled'
      : 'friendship-level__star';
    star.textContent = index < stars ? '★' : '☆';
    star.setAttribute('aria-hidden', 'true');
    strip.appendChild(star);
  }

  const value = document.createElement('span');
  value.className = 'friendship-level__percent';
  value.textContent = percentLabel;

  // The percentage alone hides how far the next star really is: the raw counters say it exactly,
  // and a maxed friendship shows its last threshold instead of an unreachable next one.
  const target = Math.max(
    1,
    Math.trunc(Number(progress?.nextTarget ?? progress?.currentTarget) || 1)
  );
  const experience = document.createElement('span');
  experience.className = 'friendship-level__xp';
  experience.textContent = `${formatNumber(progress?.xp)} / ${formatNumber(target)}`;

  host.append(strip, value, experience);
  return host;
}

export default buildFriendshipLevel;
