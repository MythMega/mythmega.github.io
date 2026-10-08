/**
 * RedeemView - Special code entry, reward preview and claim (step 9).
 *
 * Reference: `.docs/steps/9.md` point 5 and `.docs/main.md` section 3.G (view 6).
 *
 * FLOW
 *   `inspect` -> if `ok`, a confirmation modal lists the resolved rewards (extension names,
 *   card previews) with "Récupérer" / "Annuler" -> `claim` -> success toast. Any other status is
 *   shown as an error toast plus an inline message (`getRedeemStatusKey` maps the stable status to
 *   a `redeem.error.*` key). The view carries no rule of its own: normalization, availability,
 *   already-used detection and the atomic granting all live in `RedeemManager`.
 *
 * The "Récupérer" button is disabled from the first click, and the whole form is busy during the
 * network round-trips, so a double click can never claim twice (the manager re-checks the
 * `redeemed_codes` state inside its write transaction anyway).
 *
 * The modal body is rebuilt on `LANG_CHANGED` while it is open, so switching the language never
 * leaves a half-translated reward on screen.
 */

import eventBus, { EVENTS } from '../../utils/EventBus.js';
import i18n from '../../utils/I18n.js';
import Toast from '../components/Toast.js';
import redeemManager, {
  getRedeemErrorMessageKey,
  getRedeemStatusKey,
  REDEEM_STATUSES,
} from '../../business/RedeemManager.js';
import boosterManager from '../../business/BoosterManager.js';
import { getRarityLabel } from '../../classes/Card.js';

/** View name, matching `data-view="redeem"` in `index.html`. */
export const REDEEM_VIEW_NAME = 'redeem';

export class RedeemView {
  /**
   * @param {HTMLElement} rootElement - The redeem `<section>`.
   * @param {object} [options] - View options.
   * @param {(viewName: string) => void} [options.onNavigate=null] - Called when a deep link must
   *   bring the redeem view to the front (`?Redeem=`, step 10).
   */
  constructor(rootElement, { onNavigate = null } = {}) {
    if (!rootElement || typeof rootElement.querySelector !== 'function') {
      throw new TypeError('RedeemView requires the redeem section element.');
    }

    this.root = rootElement;
    this.onNavigate = typeof onNavigate === 'function' ? onNavigate : null;
    this.form = this.root.querySelector('[data-redeem-form]');
    this.input = this.root.querySelector('[data-redeem-input]');
    this.submitButton = this.root.querySelector('[data-redeem-submit]');
    this.feedbackElement = this.root.querySelector('[data-redeem-feedback]');
    this.modal = this.root.querySelector('[data-redeem-modal]');
    this.modalTitle = this.root.querySelector('[data-redeem-modal-title]');
    this.modalBody = this.root.querySelector('[data-redeem-modal-body]');
    this.modalConfirm = this.root.querySelector('[data-redeem-modal-confirm]');
    this.modalCancel = this.root.querySelector('[data-redeem-modal-cancel]');
    this.modalClose = this.root.querySelector('[data-redeem-modal-close]');

    this.assertMarkup();

    /** @type {boolean} True once `init()` bound everything. */
    this.isInitialized = false;
    /** @type {boolean} True when the view is the active one. */
    this.isActive = false;
    /** @type {boolean} True while an inspect or claim is running. */
    this.isBusy = false;
    /** @type {boolean} True while the confirmed code is being claimed. */
    this.isClaiming = false;
    /** @type {{key: string, tone: string, params: object|null}|null} Last inline message. */
    this.feedback = null;
    /** @type {string|null} Code awaiting confirmation. */
    this.pendingCode = null;
    /** @type {object[]|null} Rewards of `pendingCode`, re-rendered on a language change. */
    this.pendingRewards = null;
    /** @type {Map<string, string>} Extension display names, keyed by extension id. */
    this.setNames = new Map();

    /** @type {Array<{target: EventTarget, type: string, handler: EventListener}>} */
    this.bindings = [];
    /** @type {Function[]} */
    this.unsubscribers = [];
  }

  /**
   * Logs with the view prefix. Never receives a code: codes are not logged.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[RedeemView]', ...args);
  }

  /**
   * Verifies that the markup matches the contract expected by this view.
   *
   * @returns {void}
   * @throws {Error} When a required element is missing from `index.html`.
   */
  assertMarkup() {
    const missing = [
      ['[data-redeem-form]', this.form],
      ['[data-redeem-input]', this.input],
      ['[data-redeem-submit]', this.submitButton],
      ['[data-redeem-feedback]', this.feedbackElement],
      ['[data-redeem-modal]', this.modal],
      ['[data-redeem-modal-title]', this.modalTitle],
      ['[data-redeem-modal-body]', this.modalBody],
      ['[data-redeem-modal-confirm]', this.modalConfirm],
      ['[data-redeem-modal-cancel]', this.modalCancel],
      ['[data-redeem-modal-close]', this.modalClose],
    ]
      .filter(([, element]) => !element)
      .map(([selector]) => selector);

    if (missing.length > 0) {
      throw new Error(`RedeemView markup is incomplete, missing: ${missing.join(', ')}.`);
    }
  }

  /**
   * Loads the extension names and binds the interactions.
   *
   * @returns {Promise<void>} Resolves once the view is interactive.
   * @throws {Error} When the extension list cannot be loaded.
   */
  async init() {
    if (this.isInitialized) return;
    this.isInitialized = true;
    this.log('Initializing…');
    await this.loadSetNames();
    this.bindEvents();
    this.subscribeToEvents();
    this.renderModalLabels();
    this.log('Ready.');
  }

  /**
   * Caches the display names of the extensions, used in the reward summary.
   *
   * @returns {Promise<void>} Resolves once the names are cached.
   * @throws {Error} When the extension JSONs cannot be loaded.
   */
  async loadSetNames() {
    const sets = await boosterManager.listBoosterSets();
    this.setNames = new Map(sets.map((set) => [set.setId, set.name || set.setId]));
  }

  /**
   * Attaches the DOM listeners (registration is tracked for `destroy()`).
   *
   * @returns {void}
   */
  bindEvents() {
    this.listen(this.form, 'submit', (event) => this.handleSubmit(event));
    this.listen(this.input, 'input', () => {
      if (this.feedback && this.feedback.tone === 'error') {
        this.setFeedback(null);
      }
    });
    this.listen(this.modalConfirm, 'click', () => this.handleConfirm());
    this.listen(this.modalCancel, 'click', () => this.handleCancel());
    this.listen(this.modalClose, 'click', () => this.handleCancel());
    this.listen(this.modal, 'click', (event) => {
      if (event.target === this.modal) this.handleCancel();
    });
    this.log('DOM listeners bound.');
  }

  /**
   * Registers a listener and remembers it so `destroy()` can remove it.
   *
   * @param {EventTarget} target - Target element.
   * @param {string} type - Event type.
   * @param {EventListener} handler - Listener.
   * @returns {void}
   */
  listen(target, type, handler) {
    target.addEventListener(type, handler);
    this.bindings.push({ target, type, handler });
  }

  /**
   * Subscribes to the application events the view depends on.
   *
   * @returns {void}
   */
  subscribeToEvents() {
    this.unsubscribers.push(eventBus.on(EVENTS.VIEW_CHANGED, (payload) => {
      if (!payload || typeof payload.view !== 'string') return;
      if (payload.view === REDEEM_VIEW_NAME) {
        this.handleViewActivated();
      } else if (payload.previousView === REDEEM_VIEW_NAME) {
        this.handleViewDeactivated();
      }
    }));
    this.unsubscribers.push(eventBus.on(EVENTS.LANG_CHANGED, () => this.handleLanguageChanged()));
    this.log('Event subscriptions registered.');
  }

  /**
   * Inspects the typed code and opens the confirmation modal (or reports the refusal).
   *
   * Triggered by the form, so the mobile/desktop "Enter" key works; the default action is
   * cancelled so the page never navigates.
   *
   * @param {SubmitEvent} event - Form submit event.
   * @returns {Promise<void>} Resolves once the inspection finished.
   */
  async handleSubmit(event) {
    event?.preventDefault?.();
    if (this.isBusy) return;

    // The comparison is case-insensitive; echoing the normalized value back makes it obvious to
    // the player which code was sent.
    const raw = this.input.value;
    const code = redeemManager.normalizeCode(raw);
    this.input.value = code;

    if (!code) {
      this.setFeedback('redeem.error.empty_code', 'error');
      return;
    }

    this.setBusy(true);
    this.setFeedback(null);

    try {
      const inspection = await redeemManager.inspect(code);
      if (inspection.status !== REDEEM_STATUSES.OK) {
        const key = getRedeemStatusKey(inspection.status);
        this.setFeedback(key, 'error');
        Toast.error(key);
        return;
      }

      this.pendingCode = code;
      this.pendingRewards = inspection.rewards;
      this.openConfirmModal();
    } catch (error) {
      console.warn('[RedeemView] The code could not be inspected.', error);
      const key = getRedeemErrorMessageKey(error);
      this.setFeedback(key, 'error');
      Toast.error(key);
    } finally {
      this.setBusy(false);
    }
  }

  /**
   * Claims the code awaiting confirmation.
   *
   * @returns {Promise<void>} Resolves once the claim finished (success or failure).
   */
  async handleConfirm() {
    if (this.isClaiming || !this.pendingCode) return;

    // Disabled from the first click: the code is consumed by the time the request lands.
    this.isClaiming = true;
    this.modalConfirm.disabled = true;
    this.setBusy(true);

    try {
      await redeemManager.claim(this.pendingCode);
      this.closeModal();
      this.setFeedback('redeem.success', 'info');
      Toast.success('redeem.success');
      this.input.value = '';
      this.log('Code claimed.');
    } catch (error) {
      console.warn('[RedeemView] The code was refused.', error);
      this.closeModal();
      const key = getRedeemErrorMessageKey(error);
      this.setFeedback(key, 'error');
      Toast.error(key);
    } finally {
      this.isClaiming = false;
      this.setBusy(false);
      this.input.focus();
    }
  }

  /**
   * Cancels the pending claim and closes the modal.
   *
   * @returns {void}
   */
  handleCancel() {
    if (this.isClaiming) return;
    this.closeModal();
  }

  /**
   * Handles a code captured from the `?Redeem=` deep link (step 10).
   *
   * Never claims automatically: a URL must not modify the database without a click. On success the
   * redeem view is brought to the front and the confirmation modal opens; any other status only
   * produces a translated error toast.
   *
   * @param {string} rawCode - Code read from the URL.
   * @returns {Promise<string>} The inspection status (`ok` when the modal was opened).
   */
  async handlePendingRedeem(rawCode) {
    if (!rawCode || this.isBusy) return REDEEM_STATUSES.UNKNOWN;

    const code = redeemManager.normalizeCode(rawCode);
    if (!code) return REDEEM_STATUSES.UNKNOWN;

    let inspection;
    try {
      inspection = await redeemManager.inspect(code);
    } catch (error) {
      console.warn('[RedeemView] The deep-linked code could not be inspected.', error);
      Toast.error(getRedeemErrorMessageKey(error));
      return REDEEM_STATUSES.INVALID_CONFIG;
    }

    if (inspection.status !== REDEEM_STATUSES.OK) {
      Toast.error(getRedeemStatusKey(inspection.status));
      this.log(`Deep-linked code refused (${inspection.status}).`);
      return inspection.status;
    }

    this.onNavigate?.(REDEEM_VIEW_NAME);
    this.input.value = code;
    this.setFeedback(null);
    this.pendingCode = code;
    this.pendingRewards = inspection.rewards;
    this.openConfirmModal();
    this.log('Deep-linked code ready to claim.');
    return REDEEM_STATUSES.OK;
  }

  /**
   * Opens the confirmation modal and renders the rewards.
   *
   * @returns {void}
   */
  openConfirmModal() {
    this.renderModalLabels();
    this.renderRewards();
    this.modal.hidden = false;
    this.modalConfirm.focus();
  }

  /**
   * Closes the modal and clears the pending claim.
   *
   * @returns {void}
   */
  closeModal() {
    this.modal.hidden = true;
    this.modalBody.textContent = '';
    this.pendingCode = null;
    this.pendingRewards = null;
    this.modalConfirm.disabled = false;
  }

  /**
   * Writes the localized title and button labels of the modal.
   *
   * @returns {void}
   */
  renderModalLabels() {
    if (!this.modalTitle) return;
    this.modalTitle.textContent = i18n.t('redeem.confirm.title');
    this.modalConfirm.textContent = i18n.t('redeem.confirm.accept');
    this.modalCancel.textContent = i18n.t('redeem.confirm.cancel');
  }

  /**
   * Renders the resolved rewards of the pending code.
   *
   * @returns {void}
   */
  renderRewards() {
    if (!this.pendingRewards) return;
    this.modalBody.textContent = '';

    const list = document.createElement('ul');
    list.className = 'redeem__rewards';
    this.pendingRewards.forEach((reward) => list.appendChild(this.buildReward(reward)));
    this.modalBody.appendChild(list);
  }

  /**
   * Builds one reward row (extension line, or card illustration plus localized label).
   *
   * @param {{type: string, key: string, quantity: number, card?: object|null}} reward - Reward.
   * @returns {HTMLElement} The reward element.
   */
  buildReward(reward) {
    const item = document.createElement('li');
    item.className = 'redeem__reward';
    item.dataset.type = reward.type;

    if (reward.type === 'card' && reward.card) {
      const image = document.createElement('img');
      image.className = 'redeem__reward-image';
      image.loading = 'lazy';
      image.src = i18n.resolveImagePath(reward.card.illustration);
      image.alt = reward.card.getName(i18n.getLang());
      image.addEventListener('error', () => {
        console.warn(`[RedeemView] Illustration not found for "${reward.card.uniqueKey}".`);
        image.hidden = true;
      });
      item.appendChild(image);

      const line = document.createElement('p');
      line.className = 'redeem__reward-line';
      line.textContent = i18n.t('redeem.reward.card', {
        name: reward.card.getName(i18n.getLang()),
        count: reward.quantity,
        rarity: getRarityLabel(reward.card.rarity, (key) => i18n.t(key)),
      });
      item.appendChild(line);
      return item;
    }

    const line = document.createElement('p');
    line.className = 'redeem__reward-line';
    line.textContent = i18n.t('redeem.reward.booster', {
      count: reward.quantity,
      set: this.setNames.get(reward.key) ?? reward.key,
    });
    item.appendChild(line);
    return item;
  }

  /**
   * Enables or disables the form (single source of truth for the busy state).
   *
   * @param {boolean} isBusy - Whether a code is being inspected or claimed.
   * @returns {void}
   */
  setBusy(isBusy) {
    this.isBusy = isBusy;
    this.input.disabled = isBusy;
    this.submitButton.disabled = isBusy;
    this.submitButton.textContent = i18n.t(isBusy ? 'redeem.submitting' : 'redeem.submit');
    this.root.setAttribute('aria-busy', isBusy ? 'true' : 'false');
  }

  /**
   * Displays an informational or error message under the form.
   *
   * @param {string|null} key - i18n key, or null to clear the message.
   * @param {'info'|'error'} [tone='info'] - Visual tone, exposed as `data-tone`.
   * @returns {void}
   */
  setFeedback(key, tone = 'info') {
    this.feedback = key ? { key, tone } : null;
    this.renderFeedback();
  }

  /**
   * Writes the stored feedback message into the DOM.
   *
   * @returns {void}
   */
  renderFeedback() {
    if (!this.feedbackElement) return;
    if (!this.feedback) {
      this.feedbackElement.hidden = true;
      this.feedbackElement.textContent = '';
      this.feedbackElement.removeAttribute('data-tone');
      return;
    }

    this.feedbackElement.hidden = false;
    this.feedbackElement.textContent = i18n.t(this.feedback.key);
    this.feedbackElement.dataset.tone = this.feedback.tone;
  }

  /**
   * Re-renders the translated parts when the language changes.
   *
   * @returns {void}
   */
  handleLanguageChanged() {
    this.log(`Language changed, re-rendering (${i18n.getLang()}).`);
    this.renderFeedback();
    if (!this.isBusy) {
      this.submitButton.textContent = i18n.t('redeem.submit');
    }
    if (this.pendingRewards && !this.isClaiming) {
      this.renderModalLabels();
      this.renderRewards();
    }
  }

  /**
   * Focuses the input when the view becomes active.
   *
   * @returns {void}
   */
  handleViewActivated() {
    this.isActive = true;
    this.log('View activated.');
    this.input.focus();
  }

  /**
   * Marks the view as inactive.
   *
   * @returns {void}
   */
  handleViewDeactivated() {
    this.isActive = false;
    this.log('View deactivated.');
  }

  /**
   * Removes every listener and subscription.
   *
   * @returns {void}
   */
  destroy() {
    this.log('Destroying the view.');
    this.bindings.forEach(({ target, type, handler }) => target.removeEventListener(type, handler));
    this.bindings = [];
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
    this.isInitialized = false;
  }
}

export default RedeemView;
