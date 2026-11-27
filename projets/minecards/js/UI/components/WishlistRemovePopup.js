/**
 * "Remove this card from the wishlist?" - the dialog shown after a trade.
 *
 * A card received in a trade is exactly the moment a wishlist entry may become pointless, but it
 * is also a card the player may want to keep hoping for in another printing. So the game asks
 * instead of deciding, unless the player switched `wishlistAutoRemoveTrade` on (OFF by default).
 *
 * The dialog is built here, node by node, and resolves one of three answers:
 *   - `no`     keep the wish;
 *   - `once`   remove it this time only;
 *   - `always` remove it now AND turn the setting on, so the next trades stop asking.
 *
 * A backdrop click or Escape answers `no`: closing the dialog must never erase a wish.
 *
 * Reference: `WishlistManager.handleTradeReceived()` and `TradeView.claim()`.
 */

import i18n from '../../utils/I18n.js';

/** The three answers of the dialog. */
export const WISHLIST_POPUP_ANSWERS = Object.freeze({
  NO: 'no',
  ONCE: 'once',
  ALWAYS: 'always',
});

/**
 * Shows the dialog and waits for the answer.
 *
 * @param {{cardName?: string}} [options] - Card that was received.
 * @returns {Promise<'no'|'once'|'always'>} The answer (`no` when the dialog was dismissed).
 */
export async function askWishlistRemoval({ cardName = '' } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal wishlist-popup';
    overlay.dataset.wishlistPopup = '';

    const dialog = document.createElement('div');
    dialog.className = 'modal__dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'wishlist-popup-title');

    // The cross is the "keep it" answer: every dialog of the game carries one in its header.
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'modal__close';
    closeButton.dataset.wishlistAnswer = WISHLIST_POPUP_ANSWERS.NO;
    closeButton.setAttribute('aria-label', i18n.t('social.detail.close'));
    closeButton.textContent = '×';

    const title = document.createElement('h2');
    title.className = 'modal__title';
    title.id = 'wishlist-popup-title';
    title.textContent = i18n.t('trade.wishlist.title');

    const body = document.createElement('p');
    body.className = 'wishlist-popup__body';
    body.textContent = i18n.t('trade.wishlist.body', {
      card: cardName !== '' ? cardName : i18n.t('trade.wishlist.unknownCard'),
    });

    const actions = document.createElement('div');
    actions.className = 'modal__actions wishlist-popup__actions';

    let closed = false;
    const options = [
      { answer: WISHLIST_POPUP_ANSWERS.NO, key: 'trade.wishlist.no', variant: 'ghost' },
      { answer: WISHLIST_POPUP_ANSWERS.ONCE, key: 'trade.wishlist.once', variant: 'primary' },
      { answer: WISHLIST_POPUP_ANSWERS.ALWAYS, key: 'trade.wishlist.always', variant: 'ghost' },
    ];
    const buttons = [];

    const close = (answer) => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKeyDown);
      overlay.remove();
      resolve(answer);
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') close(WISHLIST_POPUP_ANSWERS.NO);
    };

    options.forEach((option) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `btn btn--${option.variant}`;
      button.dataset.wishlistAnswer = option.answer;
      button.textContent = i18n.t(option.key);
      button.addEventListener('click', () => close(option.answer));
      buttons.push(button);
      actions.appendChild(button);
    });

    closeButton.addEventListener('click', () => close(WISHLIST_POPUP_ANSWERS.NO));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close(WISHLIST_POPUP_ANSWERS.NO);
    });
    document.addEventListener('keydown', onKeyDown);

    dialog.append(closeButton, title, body, actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // The "keep it" answer takes the focus: the safe choice is the one a stray Enter picks.
    buttons[0]?.focus();
  });
}

export default askWishlistRemoval;
