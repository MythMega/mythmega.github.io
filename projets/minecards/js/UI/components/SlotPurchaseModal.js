/**
 * SlotPurchaseModal - Confirmation of one extra profile slot bought with Sparks.
 *
 * Reference: `js/business/FeatureManager.js` (the purchase, the prices and the ladder of slots),
 * `js/business/ProfileManager.js` (the effective limits) and `css/components/modal.css`.
 *
 * The modal is shared by the three screens that can hit a full list: the profile page (its "+"
 * tiles), the collection (a heart on a card) and the trophy catalogue (a pin). It owns its markup,
 * because a dialog appended to `<body>` can be opened from a view that is not the profile one
 * without depending on markup that view does not own.
 *
 * Nothing is bought before the second click: the price and the balance are shown, and the confirm
 * button is only enabled when the balance covers the price.
 */

import i18n from '../../utils/I18n.js';
import featureManager, {
  FEATURE_ERROR_CODES,
  PROFILE_SLOT_KINDS,
} from '../../business/FeatureManager.js';
import sparksManager from '../../business/SparksManager.js';
import Toast from './Toast.js';

/** i18n key naming the list of a slot, by kind. */
const SLOT_LABEL_KEYS = Object.freeze({
  [PROFILE_SLOT_KINDS.FAVORITES]: 'profile.slots.favorites',
  [PROFILE_SLOT_KINDS.FEATURED]: 'profile.slots.featured',
});

export class SlotPurchaseModal {
  /** Builds the dialog lazily: a player who never fills a list never pays for one. */
  constructor() {
    /** @type {HTMLElement|null} Overlay of the dialog. */
    this.root = null;
    /** @type {HTMLElement|null} Element carrying the name of the slot. */
    this.featureElement = null;
    /** @type {HTMLElement|null} Element carrying the price. */
    this.priceElement = null;
    /** @type {HTMLElement|null} Element carrying the balance. */
    this.balanceElement = null;
    /** @type {HTMLElement|null} Explanation / refusal line. */
    this.messageElement = null;
    /** @type {HTMLButtonElement|null} Confirm button. */
    this.confirmButton = null;
    /** @type {string|null} Kind of slot the dialog is about. */
    this.kind = null;
    /** @type {(() => void)|null} Callback run after a successful purchase. */
    this.onPurchased = null;
    /** @type {boolean} True while the purchase is being committed. */
    this.isBusy = false;
  }

  /**
   * Logs with the component prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[SlotPurchaseModal]', ...args);
  }

  /**
   * Builds the dialog once, then reuses it.
   *
   * @returns {HTMLElement} The overlay.
   */
  ensureMarkup() {
    if (this.root) return this.root;

    const overlay = document.createElement('div');
    overlay.className = 'modal';
    overlay.dataset.slotBuyModal = '';
    overlay.hidden = true;

    const dialog = document.createElement('div');
    dialog.className = 'modal__dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'slot-buy-title');

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'modal__close';
    close.dataset.slotBuyClose = '';
    close.setAttribute('aria-label', '×');
    close.textContent = '×';

    const title = document.createElement('h2');
    title.className = 'modal__title';
    title.id = 'slot-buy-title';
    title.dataset.i18n = 'profile.slots.buy.title';
    title.textContent = i18n.t('profile.slots.buy.title');

    const body = document.createElement('div');
    body.className = 'modal__body profile-card-buy';

    this.featureElement = document.createElement('p');
    this.featureElement.className = 'profile-card-buy__feature';
    this.priceElement = document.createElement('p');
    this.priceElement.className = 'profile-card-buy__price';
    this.balanceElement = document.createElement('p');
    this.balanceElement.className = 'profile-card-buy__balance';
    this.messageElement = document.createElement('p');
    this.messageElement.className = 'profile-card-buy__message';
    this.messageElement.dataset.tone = 'info';
    this.messageElement.dataset.slotBuyMessage = '';
    body.append(
      this.featureElement,
      this.priceElement,
      this.balanceElement,
      this.messageElement
    );

    const actions = document.createElement('div');
    actions.className = 'modal__actions';
    this.confirmButton = document.createElement('button');
    this.confirmButton.type = 'button';
    this.confirmButton.className = 'btn btn--primary';
    this.confirmButton.dataset.slotBuyConfirm = '';
    this.confirmButton.textContent = i18n.t('profile.card.buy.confirm');
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn--ghost';
    cancel.dataset.slotBuyClose = '';
    cancel.textContent = i18n.t('profile.card.buy.cancel');
    actions.append(this.confirmButton, cancel);

    dialog.append(close, title, body, actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) this.close();
    });
    overlay.querySelectorAll('[data-slot-buy-close]').forEach((button) => {
      button.addEventListener('click', () => this.close());
    });
    this.confirmButton.addEventListener('click', () => void this.confirm());
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.root && !this.root.hidden) this.close();
    });
    this.root = overlay;
    return overlay;
  }

  /**
   * Opens the dialog for the next slot of one list.
   *
   * @param {object} options - Open options.
   * @param {string} options.kind - `PROFILE_SLOT_KINDS` member.
   * @param {(() => void)|null} [options.onPurchased] - Called after a successful purchase.
   * @returns {Promise<boolean>} True when the dialog was opened (false when every slot is owned).
   * @throws {TypeError} When the kind is unknown.
   */
  async open({ kind, onPurchased = null } = {}) {
    const state = await featureManager.getSlotState(kind);
    if (!state.next) {
      Toast.info('profile.slots.maxed', { params: { max: state.max } });
      return false;
    }
    this.ensureMarkup();
    this.kind = state.kind;
    this.onPurchased = typeof onPurchased === 'function' ? onPurchased : null;

    let balance = 0;
    try {
      balance = await sparksManager.getBalance();
    } catch (error) {
      console.warn('[SlotPurchaseModal] The balance could not be read.', error);
    }

    const enough = balance >= state.next.priceSparks;
    const label = i18n.t(SLOT_LABEL_KEYS[state.kind]);
    this.featureElement.textContent = i18n.t('profile.slots.buy.feature', {
      slot: state.next.slot,
      list: label,
    });
    this.priceElement.textContent = i18n.t('profile.card.buy.price', {
      price: state.next.priceSparks,
    });
    this.balanceElement.textContent = i18n.t('profile.card.buy.balance', { balance });
    this.messageElement.textContent = enough
      ? i18n.t('profile.slots.buy.ask', {
          slot: state.next.slot,
          list: label,
          price: state.next.priceSparks,
        })
      : i18n.t('profile.card.buy.insufficient', {
          balance,
          price: state.next.priceSparks,
        });
    this.messageElement.dataset.tone = enough ? 'info' : 'error';
    this.confirmButton.disabled = !enough;
    this.confirmButton.textContent = i18n.t('profile.card.buy.confirm');

    this.root.hidden = false;
    this.root.classList.remove('is-opening');
    void this.root.offsetWidth;
    this.root.classList.add('is-opening');
    this.log(`Slot ${state.next.slot} of \"${state.kind}\" offered (${state.next.priceSparks} Sparks).`);
    return true;
  }

  /**
   * Closes the dialog without buying anything.
   *
   * @returns {void}
   */
  close() {
    if (!this.root || this.root.hidden) return;
    this.root.hidden = true;
    this.root.classList.remove('is-opening');
    this.kind = null;
    this.onPurchased = null;
  }

  /**
   * Buys the slot the dialog is about, then runs the callback of the caller.
   *
   * A refusal (the balance changed in the meantime) stays in the dialog, so the player reads why.
   *
   * @returns {Promise<void>} Resolves once the purchase finished (or the refusal was reported).
   */
  async confirm() {
    if (!this.kind || this.isBusy) return;
    this.isBusy = true;
    this.confirmButton.disabled = true;
    const kind = this.kind;
    const onPurchased = this.onPurchased;
    try {
      const result = await featureManager.purchaseSlot(kind);
      const label = i18n.t(SLOT_LABEL_KEYS[kind]);
      if (!result.alreadyOwned) {
        Toast.success('profile.slots.buy.bought', {
          params: { slot: result.slot, list: label },
        });
      }
      this.close();
      onPurchased?.();
    } catch (error) {
      console.error('[SlotPurchaseModal] The slot could not be bought.', error);
      if (error?.code === FEATURE_ERROR_CODES.INSUFFICIENT_SPARKS) {
        const [state, balance] = await Promise.all([
          featureManager.getSlotState(kind).catch(() => null),
          sparksManager.getBalance().catch(() => 0),
        ]);
        const price = state?.next?.priceSparks ?? 0;
        this.messageElement.textContent = i18n.t('profile.card.buy.insufficient', {
          balance,
          price,
        });
        this.messageElement.dataset.tone = 'error';
        this.confirmButton.disabled = true;
        return;
      }
      this.messageElement.textContent = i18n.t('profile.card.buy.error');
      this.messageElement.dataset.tone = 'error';
      Toast.error('profile.card.buy.error');
      // A transient failure must leave the dialog usable: only a real refusal (not enough Sparks)
      // keeps the confirmation disabled.
      this.confirmButton.disabled = false;
    } finally {
      this.isBusy = false;
      if (this.root?.hidden) this.confirmButton.disabled = false;
    }
  }
}

/** Shared dialog: one at a time, on top of whatever screen asked for it. */
export const slotPurchaseModal = new SlotPurchaseModal();

export default slotPurchaseModal;
