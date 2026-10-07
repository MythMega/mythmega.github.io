/**
 * RedeemView - Promo code entry and reward display.
 *
 * Reference: `.docs/steps/7.md` point 3 and `.docs/main.md` section 3.G (view 6).
 *
 * The view carries no rule of its own: the input is normalized, validated, consumed and credited
 * by `RedeemManager.redeem()`. Here we only translate the outcome: a success toast plus a result
 * panel describing what was granted, or an error toast plus an inline message for a refusal
 * (`getRedeemErrorMessageKey` maps the stable error code to a `redeem.error.*` key).
 *
 * The last result is kept in memory and re-rendered on `LANG_CHANGED`, so switching the language
 * never leaves a half-translated card name on screen.
 */

import eventBus, { EVENTS } from '../../utils/EventBus.js';
import i18n from '../../utils/I18n.js';
import Toast from '../components/Toast.js';
import redeemManager, { getRedeemErrorMessageKey } from '../../business/RedeemManager.js';
import boosterManager from '../../business/BoosterManager.js';
import { getRarityLabel } from '../../classes/Card.js';

/** View name, matching `data-view="redeem"` in `index.html`. */
export const REDEEM_VIEW_NAME = 'redeem';

export class RedeemView {
  /**
   * @param {HTMLElement} rootElement - The redeem `<section>`.
   */
  constructor(rootElement) {
    if (!rootElement || typeof rootElement.querySelector !== 'function') {
      throw new TypeError('RedeemView requires the redeem section element.');
    }

    this.root = rootElement;
    this.form = this.root.querySelector('[data-redeem-form]');
    this.input = this.root.querySelector('[data-redeem-input]');
    this.submitButton = this.root.querySelector('[data-redeem-submit]');
    this.feedbackElement = this.root.querySelector('[data-redeem-feedback]');
    this.resultElement = this.root.querySelector('[data-redeem-result]');
    this.resultBody = this.root.querySelector('[data-redeem-result-body]');

    this.assertMarkup();

    /** @type {boolean} True once `init()` bound everything. */
    this.isInitialized = false;
    /** @type {boolean} True when the view is the active one. */
    this.isActive = false;
    /** @type {boolean} True while a code is being verified. */
    this.isBusy = false;
    /** @type {{key: string, tone: string, params: object|null}|null} Last inline message. */
    this.feedback = null;
    /** @type {object|null} Last granted reward, re-rendered on a language change. */
    this.lastResult = null;
    /** @type {Map<string, string>} Extension display names, keyed by extension id. */
    this.setNames = new Map();

    /** @type {Array<{target: EventTarget, type: string, handler: EventListener}>} */
    this.bindings = [];
    /** @type {Function[]} */
    this.unsubscribers = [];
  }

  /**
   * Logs with the view prefix.
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
      ['[data-redeem-result]', this.resultElement],
      ['[data-redeem-result-body]', this.resultBody],
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
   * Submits the typed code.
   *
   * Triggered by the form (so the mobile/desktop "Enter" key works), and cancelled so the page
   * never navigates.
   *
   * @param {SubmitEvent} event - Form submit event.
   * @returns {Promise<void>} Resolves once the flow finished (success or failure).
   */
  async handleSubmit(event) {
    event?.preventDefault?.();
    if (this.isBusy) return;

    // The catalog comparison is case-insensitive; echoing the normalized value back makes it
    // obvious to the player which code was sent.
    const raw = this.input.value;
    const code = redeemManager.normalizeCode(raw);
    this.input.value = code;

    if (!code) {
      this.setFeedback('redeem.error.emptyCode', 'error');
      return;
    }

    this.setBusy(true);
    this.setFeedback(null);

    try {
      const result = await redeemManager.redeem(code);
      this.lastResult = result;
      this.setFeedback('redeem.success', 'info');
      this.renderResult();
      Toast.success('redeem.success');
      this.input.value = '';
      this.log(`Code "${code}" redeemed.`);
    } catch (error) {
      console.warn(`[RedeemView] Code "${code}" refused.`, error);
      const key = getRedeemErrorMessageKey(error);
      this.setFeedback(key, 'error');
      Toast.error(key);
    } finally {
      this.setBusy(false);
      this.input.focus();
    }
  }

  /**
   * Renders the panel describing the last granted reward.
   *
   * @returns {void}
   */
  renderResult() {
    const result = this.lastResult;
    if (!this.resultElement || !this.resultBody) return;

    if (!result) {
      this.resultElement.hidden = true;
      this.resultBody.textContent = '';
      return;
    }

    this.resultBody.textContent = '';

    if (result.card) {
      this.resultBody.appendChild(this.buildCardResult(result));
    } else {
      const line = document.createElement('p');
      line.className = 'redeem__result-line';
      line.textContent = i18n.t('redeem.result.booster', {
        count: result.amount,
        set: this.setNames.get(result.set) ?? result.set,
      });
      this.resultBody.appendChild(line);
    }

    this.resultElement.hidden = false;
  }

  /**
   * Builds the illustration, name and quantity of a granted card.
   *
   * @param {object} result - Redemption result holding a `Card` instance.
   * @returns {HTMLElement} The card result block.
   */
  buildCardResult(result) {
    const { card } = result;
    const name = card.getName(i18n.getLang());

    const wrapper = document.createElement('div');
    wrapper.className = 'redeem__result-card';

    const image = document.createElement('img');
    image.className = 'redeem__card-image';
    image.loading = 'lazy';
    image.src = i18n.resolveImagePath(card.illustration);
    image.alt = name;
    image.addEventListener('error', () => {
      console.warn(`[RedeemView] Illustration not found for "${card.uniqueKey}": ${image.src}`);
      image.hidden = true;
    });
    wrapper.appendChild(image);

    const line = document.createElement('p');
    line.className = 'redeem__result-line';
    line.textContent = i18n.t('redeem.result.card', {
      name,
      count: result.quantity,
      rarity: getRarityLabel(card.rarity, (key) => i18n.t(key)),
    });
    wrapper.appendChild(line);

    return wrapper;
  }

  /**
   * Enables or disables the form (single source of truth for the busy state).
   *
   * @param {boolean} isBusy - Whether a code is being verified.
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
   * @param {object|null} [params=null] - Interpolation values.
   * @returns {void}
   */
  setFeedback(key, tone = 'info', params = null) {
    this.feedback = key ? { key, tone, params } : null;
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
    this.feedbackElement.textContent = i18n.t(this.feedback.key, this.feedback.params);
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
    this.renderResult();
    if (!this.isBusy) {
      this.submitButton.textContent = i18n.t('redeem.submit');
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
