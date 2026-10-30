/**
 * UiSounds - Plays the interface moments declared by `settings/sounds.json`.
 *
 * Reference: `js/utils/SoundManager.js` (the map and the families), `settings/sounds.json` (the
 * stable event ids and their files) and `js/UI/SpaRouter.js` (navigation).
 *
 * Most interface sounds are triggered explicitly by the code that owns the moment (a view switch,
 * a filter, a section choice, a reveal step). Dialogs are the exception: the game builds a dozen
 * of them, each with its own markup, and they all share the same contract - an element with the
 * `modal` class whose `hidden` attribute is toggled. Observing that one attribute covers every
 * dialog (including the ones added later) without touching each view, and it can tell a card detail
 * from a generic dialog by its content.
 *
 * Some dialogs have their OWN sound (the Wandering Trader, the chest of the mine): they are listed
 * in `SPECIFIC_MODAL_SOUNDS` and take precedence over the generic/card detection, so replacing the
 * sound of one dialog never requires touching the view that opens it.
 */

import soundManager, { UI_SOUNDS } from './SoundManager.js';

/** Modals whose content IS a card: opening one plays `card.open`, not `modal.open`. */
const CARD_MODAL_SELECTORS = [
  '[data-card-modal]',
  '[data-collection-modal]',
  '[data-profile-card-modal]',
  '[data-stats-modal]',
];

/** Dialogs with a sound of their own, checked before the generic/card detection. */
const SPECIFIC_MODAL_SOUNDS = [
  {
    selector: '[data-mineblock-inventory-modal]',
    open: UI_SOUNDS.CHEST_OPEN,
    close: UI_SOUNDS.CHEST_CLOSE,
  },
  {
    selector: '[data-mineblock-trader-modal]',
    open: UI_SOUNDS.TRADER_OPEN,
    close: UI_SOUNDS.TRADER_CLOSE,
  },
];

/** Content clues for a card dialog that does not have a dedicated attribute. */
const CARD_CONTENT_SELECTOR = [
  '.profile-modal__card',
  '.card-modal__image',
  '.collection-modal__art',
].join(', ');

/**
 * Tells whether one dialog shows a card.
 *
 * @param {Element} modal - The `.modal` element.
 * @returns {boolean} True when the dialog is a card detail.
 */
function isCardModal(modal) {
  if (CARD_MODAL_SELECTORS.some((selector) => modal.matches(selector))) return true;
  return modal.querySelector(CARD_CONTENT_SELECTOR) !== null;
}

/**
 * Starts observing the dialogs of the document.
 *
 * @param {object} [options] - Observer options.
 * @param {Document} [options.root=document] - Document to observe.
 * @returns {() => void} Stops the observer.
 */
export function startUiSounds({ root = document } = {}) {
  if (!root?.body || typeof MutationObserver !== 'function') return () => {};

  const observer = new MutationObserver((records) => {
    records.forEach((record) => {
      if (record.type !== 'attributes' || record.attributeName !== 'hidden') return;
      const modal = record.target;
      if (!(modal instanceof Element) || !modal.classList.contains('modal')) return;
      // `oldValue !== null` means the attribute was present, i.e. the dialog was hidden before.
      const wasHidden = record.oldValue !== null;
      const isHidden = modal.hasAttribute('hidden');
      if (wasHidden === isHidden) return;
      const specific = SPECIFIC_MODAL_SOUNDS.find((entry) => modal.matches(entry.selector)) ?? null;
      const card = !specific && isCardModal(modal);
      if (!wasHidden && isHidden) {
        soundManager.playUi(
          specific?.close ?? (card ? UI_SOUNDS.CARD_CLOSE : UI_SOUNDS.MODAL_CLOSE)
        );
      } else if (wasHidden && !isHidden) {
        soundManager.playUi(
          specific?.open ?? (card ? UI_SOUNDS.CARD_OPEN : UI_SOUNDS.MODAL_OPEN)
        );
      }
    });
  });

  observer.observe(root.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden'],
    attributeOldValue: true,
  });

  return () => observer.disconnect();
}

export default startUiSounds;
