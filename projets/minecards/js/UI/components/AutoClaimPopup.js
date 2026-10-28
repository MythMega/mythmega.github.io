/**
 * AutoClaimPopup - The gift popup of the automatic codes (`settings/codes.json`, `AutoClaim`).
 *
 * Reference: `js/business/AutoClaimManager.js` (who earns the gift and when) and
 * `css/components/auto-claim.css`.
 *
 * WHY IT LIVES OUTSIDE A VIEW
 *   The gift is earned by playing, not by opening a screen: the third booster may be opened from
 *   the opening view, a level may be reached from a purchase in the collection, and the check runs
 *   again from the settings screen. The popup is therefore appended to `<body>` and survives any
 *   navigation, like the toasts, but it BLOCKS the page until it is dismissed: the player must see
 *   the card they were given.
 *
 * CONTENT
 *   - a badge, a title and either the `CustomMessage` of the code (in the active language) or the
 *     default `autoclaim.message`;
 *   - the card itself when the code grants one (the illustration, dressed with the halo of its
 *     rarity), with its localized name;
 *   - a compact line per other reward (bonus boosters, Sparks), totalled per type;
 *   - one button that closes the popup. The rewards are ALREADY credited when it appears: there is
 *     nothing to accept.
 *
 * Several codes can become eligible at once (an imported save, a level that unlocks two gifts):
 * the claims are QUEUED and shown one after the other. A language change re-renders the open popup,
 * and `destroy()` is only used by a full teardown.
 */

import eventBus, { EVENTS } from '../../utils/EventBus.js';
import i18n from '../../utils/I18n.js';
import { applyCardGlow } from '../../utils/Shine.js';
import { getRarityLabel } from '../../classes/Card.js';

/** Class of the overlay. */
export const AUTO_CLAIM_CLASS = 'auto-claim';

export class AutoClaimPopup {
  constructor() {
    /** @type {HTMLElement|null} Overlay, created on the first gift. */
    this.root = null;
    /** @type {HTMLElement|null} Dialog element. */
    this.dialog = null;
    /** @type {HTMLButtonElement|null} Dismiss button. */
    this.closeButton = null;
    /** @type {Array<object>} Gifts waiting to be displayed. */
    this.queue = [];
    /** @type {object|null} Gift currently displayed. */
    this.current = null;
    /** @type {Element|null} Element focused before the popup opened. */
    this.previousFocus = null;
    /** @type {Function[]} Unsubscribers of the subscribed events. */
    this.unsubscribers = [
      eventBus.on(EVENTS.AUTO_CLAIM_GRANTED, (payload) => this.enqueue(payload?.claims)),
      eventBus.on(EVENTS.LANG_CHANGED, () => this.handleLanguageChanged()),
    ];
    /** @type {(event: KeyboardEvent) => void} Escape handler, bound once. */
    this.handleKeyDown = (event) => {
      if (event.key === 'Escape' && this.current) {
        event.preventDefault();
        this.close();
      }
    };
  }

  /**
   * Logs with the popup prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[AutoClaimPopup]', ...args);
  }

  /**
   * Queues granted gifts and displays the first one.
   *
   * @param {Array<object>|null|undefined} claims - `AUTO_CLAIM_GRANTED` claims.
   * @returns {void}
   */
  enqueue(claims) {
    const list = Array.isArray(claims) ? claims : [];
    if (list.length === 0) return;
    this.queue.push(...list);
    if (!this.current) this.showNext();
  }

  /**
   * Displays the next queued gift, if any.
   *
   * @returns {void}
   */
  showNext() {
    const next = this.queue.shift() ?? null;
    this.current = next;
    if (!next) {
      this.hide();
      return;
    }
    this.ensureMarkup();
    // Only the FIRST gift of a queue captures the focus: the following ones would otherwise
    // restore it to the close button of the popup itself.
    if (this.root.hidden) this.previousFocus = document.activeElement;
    this.render(next);
    this.root.hidden = false;
    document.addEventListener('keydown', this.handleKeyDown);
    this.closeButton?.focus();
    this.log(`Displayed a gift (${next.rewards?.length ?? 0} reward(s)).`);
  }

  /**
   * Closes the open gift and displays the following one, if any.
   *
   * @returns {void}
   */
  close() {
    if (!this.current) return;
    this.current = null;
    document.removeEventListener('keydown', this.handleKeyDown);
    if (this.queue.length > 0) {
      this.showNext();
      return;
    }
    this.hide();
  }

  /**
   * Drops every queued gift without displaying it (full reset, imported save).
   *
   * @returns {void}
   */
  clear() {
    this.queue = [];
    this.current = null;
    document.removeEventListener('keydown', this.handleKeyDown);
    this.hide();
  }

  /**
   * Hides the overlay and gives the focus back to where it was.
   *
   * @returns {void}
   */
  hide() {
    if (this.root) this.root.hidden = true;
    if (this.previousFocus instanceof HTMLElement && this.previousFocus.isConnected) {
      this.previousFocus.focus();
    }
    this.previousFocus = null;
  }

  /**
   * Creates the overlay once, on the first gift.
   *
   * @returns {void}
   */
  ensureMarkup() {
    if (this.root) return;

    const root = document.createElement('div');
    root.className = AUTO_CLAIM_CLASS;
    root.hidden = true;
    root.addEventListener('click', (event) => {
      if (event.target === root) this.close();
    });

    const dialog = document.createElement('div');
    dialog.className = 'auto-claim__dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'auto-claim-title');

    const badge = document.createElement('p');
    badge.className = 'auto-claim__badge';
    badge.dataset.autoClaimBadge = '';

    const title = document.createElement('h2');
    title.className = 'auto-claim__title';
    title.id = 'auto-claim-title';
    title.dataset.autoClaimTitle = '';

    const card = document.createElement('div');
    card.className = 'auto-claim__card';
    card.dataset.autoClaimCard = '';
    card.hidden = true;

    const image = document.createElement('img');
    image.className = 'auto-claim__image';
    image.loading = 'eager';
    image.dataset.autoClaimImage = '';
    image.alt = '';

    const name = document.createElement('p');
    name.className = 'auto-claim__name';
    name.dataset.autoClaimName = '';

    card.append(image, name);

    const message = document.createElement('p');
    message.className = 'auto-claim__message';
    message.dataset.autoClaimMessage = '';

    const rewards = document.createElement('div');
    rewards.className = 'auto-claim__rewards';
    rewards.dataset.autoClaimRewards = '';

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'btn btn--primary auto-claim__close';
    closeButton.dataset.autoClaimClose = '';
    closeButton.addEventListener('click', () => this.close());

    dialog.append(badge, title, card, message, rewards, closeButton);
    root.appendChild(dialog);
    document.body.appendChild(root);

    this.root = root;
    this.dialog = dialog;
    this.closeButton = closeButton;
  }

  /**
   * Writes one gift into the markup.
   *
   * @param {object} claim - `{ message, rewards }` (see `AutoClaimManager.check()`).
   * @returns {void}
   */
  render(claim) {
    if (!this.root) return;
    const rewards = Array.isArray(claim.rewards) ? claim.rewards : [];
    const cardRewards = rewards.filter((reward) => reward.type === 'card' && reward.card);
    const otherRewards = this.summarizeRewards(rewards.filter((reward) => reward.type !== 'card'));

    this.root.querySelector('[data-auto-claim-badge]').textContent = i18n.t('autoclaim.badge');
    this.root.querySelector('[data-auto-claim-title]').textContent = i18n.t('autoclaim.title');
    this.root.querySelector('[data-auto-claim-message]').textContent =
      this.resolveMessage(claim.message) ?? i18n.t('autoclaim.message');
    this.closeButton.textContent = i18n.t('autoclaim.close');

    const card = this.root.querySelector('[data-auto-claim-card]');
    const image = this.root.querySelector('[data-auto-claim-image]');
    const name = this.root.querySelector('[data-auto-claim-name]');
    const firstCard = cardRewards[0]?.card ?? null;

    card.classList.remove('card-glow', 'card-glow--super-rare', 'card-glow--legendary', 'card-glow--mythic');
    if (firstCard) {
      card.hidden = false;
      applyCardGlow(card, firstCard);
      image.hidden = false;
      image.src = i18n.resolveImagePath(firstCard.illustration);
      image.alt = firstCard.getName(i18n.getLang());
      name.textContent = i18n.t('redeem.reward.card', {
        name: firstCard.getName(i18n.getLang()),
        count: cardRewards.reduce((sum, reward) => sum + (Number(reward.quantity) || 1), 0),
        rarity: getRarityLabel(firstCard.rarity, (key) => i18n.t(key)),
      });
    } else {
      card.hidden = true;
      image.removeAttribute('src');
      name.textContent = '';
    }

    const list = this.root.querySelector('[data-auto-claim-rewards]');
    list.textContent = '';
    otherRewards.forEach((reward) => {
      const line = document.createElement('p');
      line.className = 'auto-claim__reward';
      line.dataset.type = reward.type;
      line.textContent =
        reward.type === 'sparks'
          ? i18n.t('redeem.reward.sparks', { count: reward.quantity })
          : i18n.t('autoclaim.reward.booster', { count: reward.quantity });
      list.appendChild(line);
    });
    // No card and no other line would leave an empty popup: the message alone is enough, but the
    // container must not keep a gap.
    list.hidden = otherRewards.length === 0;
  }

  /**
   * Picks the custom message of the code in the active language.
   *
   * @param {{fr?: string|null, en?: string|null}|null} message - Normalized custom message.
   * @returns {string|null} The sentence, or null when the code declares none.
   */
  resolveMessage(message) {
    if (!message) return null;
    const lang = i18n.getLang();
    return message[lang] ?? message.fr ?? message.en ?? null;
  }

  /**
   * Totals the non-card rewards per type.
   *
   * @param {object[]} rewards - Resolved rewards of the claim.
   * @returns {Array<{type: string, quantity: number}>} One entry per type.
   */
  summarizeRewards(rewards) {
    const totals = new Map();
    rewards.forEach((reward) => {
      if (!Number.isFinite(reward.quantity) || reward.quantity <= 0) return;
      const entry = totals.get(reward.type) ?? { type: reward.type, quantity: 0 };
      entry.quantity += reward.quantity;
      totals.set(reward.type, entry);
    });
    return [...totals.values()];
  }

  /**
   * Re-renders the open gift when the language changes.
   *
   * @returns {void}
   */
  handleLanguageChanged() {
    if (this.current) this.render(this.current);
  }

  /**
   * Releases the subscriptions and removes the overlay.
   *
   * @returns {void}
   */
  destroy() {
    this.queue = [];
    this.current = null;
    document.removeEventListener('keydown', this.handleKeyDown);
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
    this.root?.remove();
    this.root = null;
    this.dialog = null;
    this.closeButton = null;
  }
}

/** Shared instance used by the application bootstrap. */
export const autoClaimPopup = new AutoClaimPopup();

export default autoClaimPopup;
