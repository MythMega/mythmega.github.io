/**
 * FocusMode - The RITUAL screen: the app chrome steps aside while a booster is opened or a Mine Pick
 * card is chosen.
 *
 * Reference: `.docs/main.md` (ouverture des boosters, Mine Pick).
 *
 * Two moments of the game are rituals rather than pages: opening a booster - from the moment the
 * player has chosen one, not from the moment the page is displayed - and choosing the card of a
 * Mine Pick booster, once the pack has been dealt. During those, the brand, the counters, the bottom
 * bar, the "Comment ça marche ?" pill and the title of the view are all between the player and the
 * only thing they are looking at, so they are hidden.
 *
 * The state is ONE class on `<body>`, `is-focus`, and `css/base.css` is the only thing that knows
 * what it hides (the same shape as `is-onboarding`, which hides the very same chrome). The shell
 * therefore never has to know which view is running a ritual, and a view left mid-ritual only has to
 * remove the class on its way out.
 *
 * Deliberately not a counter: only one ritual can run at a time (one view is displayed at a time),
 * and a stale count would be far harder to recover from than a stale flag that both views clear in
 * `handleViewDeactivated()` and `destroy()`.
 */

/** Class set on `<body>` while a ritual screen is running. */
export const FOCUS_CLASS = 'is-focus';

/**
 * Turns the focus mode on or off.
 *
 * Idempotent, and safe on a document without a `<body>`: the function then does nothing at all
 * rather than throwing, so a view may call it from any lifecycle hook.
 *
 * @param {boolean} active - True to hide the app chrome, false to bring it back.
 * @returns {void}
 */
export function setFocusMode(active) {
  const { body } = document;
  if (!body) return;
  body.classList.toggle(FOCUS_CLASS, active);
}
