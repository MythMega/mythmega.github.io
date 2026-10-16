/**
 * Shine - Which foil a card carries, and how to dress a box with it.
 *
 * Reference: `css/components/card-shine.css`, `.docs/main.md` section 3.G quinquies.
 *
 * WHY A MODULE OF ITS OWN. These two helpers used to live in `js/UI/components/CardComponent.js`,
 * which is where they were written - but that module imports `I18n`, `EventBus` and `Card`, so the
 * only way to reuse them elsewhere was to pull the whole game in. The read-only page of a shared
 * binder (`js/binder-share.js`) must NOT do that: it paints the foil of the cards of the binder and
 * knows nothing of the account, the database or the catalogue. The two helpers import nothing at
 * all, so they belong here, and `CardComponent` re-exports them so every existing caller keeps
 * importing from where it always did.
 *
 * WHAT A FOIL IS. A stack of shapes painted by `css/components/card-shine.css` on the box that
 * DISPLAYS a card - never on the card element itself, which already owns its `::after`. See that
 * file for the layers; this module only decides the classes and appends the one layer that is a real
 * element (the sweeping line, whose intensity has its own slider).
 */

/**
 * Foil of the three high rarities, from the lightest to the heaviest: rarity 3 (super rare) gets the
 * fine diagonal weave, rarity 4 (legendary) the light version of the shape vocabulary (bloom,
 * embossed grid), rarity 5 (mythic) the full treatment (honeycomb, two crossing glints, 3D tilt).
 * See `css/components/card-shine.css`.
 */
export const SHINE_MODIFIER_BY_RARITY = Object.freeze({
  3: 'card-shine--super-rare',
  4: 'card-shine--legendary',
  5: 'card-shine--mythic',
});

/** Class of the layer drawing the sweeping line (the "brillance") inside a shine window. */
export const SHINE_GLEAM_CLASS = 'card-shine__gleam';

/**
 * Classes that give a card the foil reflection of `css/components/card-shine.css`.
 *
 * They belong on the box the highlight may cover - the front face of a reveal, the artwork of the
 * collection detail, a slot of a binder - never on the card element itself, which already owns its
 * `::after` for the halo and the reveal shockwave. The same helper dresses every place a card is
 * shown large, so the collection and the opening can never disagree on what a legendary looks like.
 *
 * The print style is deliberately ignored: the stylesheet derives the window from the ratio of the
 * illustration, so a full art printing carries the same gloss as a classic one and neither of them
 * paints over the frame. Nothing here would change for a full art card, and asking for it would
 * only invite the two to drift apart.
 *
 * @param {{rarity: number}|null|undefined} card - Card to describe.
 * @returns {string[]} The classes, empty for a rarity that carries no foil.
 */
export function getShineClasses(card) {
  const modifier = SHINE_MODIFIER_BY_RARITY[card?.rarity];
  if (!modifier) return [];
  return ['card-shine', modifier];
}

/**
 * Dresses a box with the foil reflection of a card: the classes of its rarity, plus the sweeping line.
 *
 * The line ("brillance") is a real element rather than a background layer, because it is the one part
 * of the foil with an intensity of its own: `--glare-intensity` scales it without touching the shapes
 * of the print. Appending it here, once, keeps every caller (the reveal, the collection detail, a
 * binder, the shared page) from having to remember it, and the `querySelector` guard makes the call
 * idempotent on a box that is dressed twice.
 *
 * @param {HTMLElement} box - The window the foil is painted on.
 * @param {{rarity: number}|null|undefined} card - Card to describe.
 * @returns {HTMLElement} The same box, for chaining.
 */
export function applyShine(box, card) {
  const classes = getShineClasses(card);
  if (classes.length === 0) return box;

  box.classList.add(...classes);
  if (!box.querySelector(`.${SHINE_GLEAM_CLASS}`)) {
    const gleam = document.createElement('span');
    gleam.className = SHINE_GLEAM_CLASS;
    // Decoration: the artwork of a card is described by its `alt` text, never by its gloss.
    gleam.setAttribute('aria-hidden', 'true');
    box.appendChild(gleam);
  }
  return box;
}

export default { getShineClasses, applyShine };
