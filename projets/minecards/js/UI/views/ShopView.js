/**
 * ShopView - Monthly booster shop.
 *
 * Reference: `BoosterManager.getBoosterShopState()` and `BoosterManager.buyMonthlyBoosters()`.
 *
 * The shop sells at most `boosters.monthlyBoosterLimit` packs per UTC month, shared by every
 * extension, at `boosters.extraBoosterPriceSparks` each. Bought packs land directly in the
 * purchased bucket of the storage, where they survive the daily reset and can be opened from the
 * opening screen.
 *
 * The allowance is authoritative on the data layer: the screen only mirrors it. A quantity is
 * clamped to what is left, the button is disabled when nothing is left or the balance is short,
 * and a refused purchase (stale tab, exact limit reached elsewhere) is reported without changing
 * the displayed total.
 *
 * The booster picker lists the RELEASED extensions by descending id, each with the artwork of its
 * booster. It keeps the product identity visible when several extensions are sold at once, so the
 * player always sees which booster the quantity and the price apply to.
 */

import eventBus, { EVENTS } from '../../utils/EventBus.js';
import i18n from '../../utils/I18n.js';
import boosterManager, {
  BOOSTER_SHOP_ERRORS,
} from '../../business/BoosterManager.js';
import { INSUFFICIENT_SPARKS } from '../../business/SparksManager.js';
import miningManager, { BUNDLE_SHOP_ERRORS } from '../../business/MiningManager.js';
import dateSyncManager from '../../business/DateSyncManager.js';
import Toast from '../components/Toast.js';

/** View name, matching `data-view="shop"` in `index.html`. */
export const SHOP_VIEW_NAME = 'shop';

export class ShopView {
  /**
   * @param {HTMLElement} rootElement - The shop `<section>`.
   */
  constructor(rootElement) {
    if (!rootElement || typeof rootElement.querySelector !== 'function') {
      throw new TypeError('ShopView requires the shop section element.');
    }

    this.root = rootElement;
    this.balanceElement = this.root.querySelector('[data-shop-balance]');
    this.boosterSection = this.root.querySelector('[data-shop-booster-section]');
    this.purchasedElement = this.root.querySelector('[data-shop-purchased]');
    this.setSelect = this.root.querySelector('[data-shop-set]');
    this.setIcon = this.root.querySelector('[data-shop-set-icon]');
    this.refillElement = this.root.querySelector('[data-shop-refill]');
    this.remainingElement = this.root.querySelector('[data-shop-remaining]');
    this.limitElement = this.root.querySelector('[data-shop-limit]');
    this.unitPriceElement = this.root.querySelector('[data-shop-unit-price]');
    this.totalElement = this.root.querySelector('[data-shop-total]');
    this.progressElement = this.root.querySelector('[data-shop-progress]');
    this.quantityInput = this.root.querySelector('[data-shop-quantity]');
    this.minusButton = this.root.querySelector('[data-shop-step="-1"]');
    this.plusButton = this.root.querySelector('[data-shop-step="1"]');
    this.buyButton = this.root.querySelector('[data-shop-buy]');
    this.feedbackElement = this.root.querySelector('[data-shop-feedback]');
    this.bundleSection = this.root.querySelector('[data-shop-bundle-section]');
    this.bundleDescriptionElement = this.root.querySelector('[data-shop-bundle-description]');
    this.bundleBlocksElement = this.root.querySelector('[data-shop-bundle-blocks]');
    this.bundlePriceElement = this.root.querySelector('[data-shop-bundle-price]');
    this.bundlePurchasedElement = this.root.querySelector('[data-shop-bundle-purchased]');
    this.bundleRemainingElement = this.root.querySelector('[data-shop-bundle-remaining]');
    this.bundleLimitElement = this.root.querySelector('[data-shop-bundle-limit]');
    this.bundleProgressElement = this.root.querySelector('[data-shop-bundle-progress]');
    this.bundleTotalElement = this.root.querySelector('[data-shop-bundle-total]');
    this.bundleQuantityInput = this.root.querySelector('[data-shop-bundle-quantity]');
    this.bundleMinusButton = this.root.querySelector('[data-shop-bundle-step="-1"]');
    this.bundlePlusButton = this.root.querySelector('[data-shop-bundle-step="1"]');
    this.bundleBuyButton = this.root.querySelector('[data-shop-bundle-buy]');
    this.bundleFeedbackElement = this.root.querySelector('[data-shop-bundle-feedback]');

    this.assertMarkup();

    /** @type {object|null} Last allowance snapshot. */
    this.state = null;
    /** @type {Array<object>} Released extensions on sale, highest id first. */
    this.sets = [];
    /** @type {string|null} Extension whose booster is currently selected. */
    this.selectedSetId = null;
    /** @type {number} Requested quantity, always inside the remaining allowance. */
    this.quantity = 1;
    /** @type {boolean} True while a purchase is in flight. */
    this.isBuying = false;
    /** @type {object|null} Last block-bundle allowance snapshot. */
    this.bundleState = null;
    /** @type {number} Requested bundle quantity, inside the remaining allowance. */
    this.bundleQuantity = 1;
    /** @type {boolean} True while a bundle purchase is in flight. */
    this.isBuyingBundle = false;
    /** @type {boolean} True once `init()` completed. */
    this.isInitialized = false;
    /** @type {Array<{target: EventTarget, type: string, handler: EventListener}>} DOM bindings. */
    this.bindings = [];
    /** @type {Function[]} EventBus unsubscribers. */
    this.unsubscribers = [];
  }

  /** @param {...unknown} args - Values forwarded to `console.info`. @returns {void} */
  log(...args) {
    console.info('[ShopView]', ...args);
  }

  /** Verifies the markup contract. @returns {void} */
  assertMarkup() {
    const missing = [
      ['[data-shop-balance]', this.balanceElement],
      ['[data-shop-booster-section]', this.boosterSection],
      ['[data-shop-purchased]', this.purchasedElement],
      ['[data-shop-set]', this.setSelect],
      ['[data-shop-set-icon]', this.setIcon],
      ['[data-shop-refill]', this.refillElement],
      ['[data-shop-remaining]', this.remainingElement],
      ['[data-shop-limit]', this.limitElement],
      ['[data-shop-unit-price]', this.unitPriceElement],
      ['[data-shop-total]', this.totalElement],
      ['[data-shop-progress]', this.progressElement],
      ['[data-shop-quantity]', this.quantityInput],
      ['[data-shop-buy]', this.buyButton],
      ['[data-shop-feedback]', this.feedbackElement],
      ['[data-shop-bundle-section]', this.bundleSection],
      ['[data-shop-bundle-description]', this.bundleDescriptionElement],
      ['[data-shop-bundle-blocks]', this.bundleBlocksElement],
      ['[data-shop-bundle-price]', this.bundlePriceElement],
      ['[data-shop-bundle-purchased]', this.bundlePurchasedElement],
      ['[data-shop-bundle-remaining]', this.bundleRemainingElement],
      ['[data-shop-bundle-limit]', this.bundleLimitElement],
      ['[data-shop-bundle-progress]', this.bundleProgressElement],
      ['[data-shop-bundle-total]', this.bundleTotalElement],
      ['[data-shop-bundle-quantity]', this.bundleQuantityInput],
      ['[data-shop-bundle-buy]', this.bundleBuyButton],
      ['[data-shop-bundle-feedback]', this.bundleFeedbackElement],
    ]
      .filter(([, element]) => !element)
      .map(([selector]) => selector);

    if (missing.length > 0) {
      throw new Error(`ShopView markup is incomplete, missing: ${missing.join(', ')}.`);
    }
  }

  /**
   * Registers a listener and remembers it for `destroy()`.
   *
   * @param {EventTarget} target - Event target.
   * @param {string} type - Event type.
   * @param {EventListener} handler - Listener.
   * @returns {void}
   */
  listen(target, type, handler) {
    target.addEventListener(type, handler);
    this.bindings.push({ target, type, handler });
  }

  /**
   * Binds the controls and subscribes to the application events.
   *
   * @returns {Promise<void>} Resolves once the first allowance is rendered.
   */
  async init() {
    if (this.isInitialized) return;
    this.log('Initializing…');
    this.listen(this.setSelect, 'change', () => this.handleSetChange());
    this.listen(this.minusButton, 'click', () => this.setQuantity(this.quantity - 1));
    this.listen(this.plusButton, 'click', () => this.setQuantity(this.quantity + 1));
    this.listen(this.quantityInput, 'input', (event) => this.setQuantity(event.target.value));
    this.listen(this.buyButton, 'click', () => void this.buy());
    this.listen(this.bundleMinusButton, 'click', () =>
      this.setBundleQuantity(this.bundleQuantity - 1)
    );
    this.listen(this.bundlePlusButton, 'click', () =>
      this.setBundleQuantity(this.bundleQuantity + 1)
    );
    this.listen(this.bundleQuantityInput, 'input', (event) =>
      this.setBundleQuantity(event.target.value)
    );
    this.listen(this.bundleBuyButton, 'click', () => void this.buyBundles());
    this.subscribeToEvents();
    await this.refresh();
    await this.loadSets();
    await this.refreshBundle();
    this.updateRefillTimer();
    this.isInitialized = true;
    this.log('Ready.');
  }

  /** Subscribes to the events the view depends on. @returns {void} */
  subscribeToEvents() {
    this.unsubscribers.push(
      eventBus.on(EVENTS.VIEW_CHANGED, (payload) => {
        if (payload?.view === SHOP_VIEW_NAME && this.isInitialized) {
          void this.refresh();
          void this.refreshBundle();
        }
      })
    );
    this.unsubscribers.push(
      eventBus.on(EVENTS.LANG_CHANGED, () => {
        this.render();
        this.renderBundle();
        this.updateRefillTimer();
      })
    );
    this.unsubscribers.push(
      eventBus.on(EVENTS.SPARKS_UPDATED, (payload) => {
        if (!Number.isFinite(payload?.balance)) return;
        if (this.state) {
          this.state.balance = payload.balance;
          this.render();
        }
        if (this.bundleState) {
          this.bundleState.balance = payload.balance;
          this.renderBundle();
        }
      })
    );
    // An imported save carries another account: its month and allowance change with it.
    this.unsubscribers.push(
      eventBus.on(EVENTS.SAVE_IMPORTED, () => {
        if (!this.isInitialized) return;
        void this.refresh();
        void this.refreshBundle();
      })
    );
    // The month can turn over while the screen is open: the allowance then starts again at zero,
    // even if the view was displaying "limit reached" a second earlier.
    this.unsubscribers.push(
      eventBus.on(EVENTS.CLOCK_TICK, (payload) => {
        this.updateRefillTimer(payload?.utc);
        const day = dateSyncManager.getCurrentUtcDay();
        const month = typeof day === 'string' ? day.slice(0, 7) : null;
        if (!this.isInitialized || !month) return;
        if (month !== this.state?.month) void this.refresh();
        if (month !== this.bundleState?.month) void this.refreshBundle();
      })
    );
  }

  /**
   * Loads the released extensions and fills the booster picker.
   *
   * The list is sorted by DESCENDING id, as the shop presents the newest booster first. Upcoming
   * extensions are excluded: a booster that cannot be opened yet must not be sold.
   *
   * @returns {Promise<void>} Resolves once the picker is ready.
   */
  async loadSets() {
    const listed = await boosterManager.listBoosterSets();
    this.sets = listed.slice().sort((left, right) =>
      right.setId.localeCompare(left.setId, undefined, { numeric: true, sensitivity: 'base' })
    );

    const previous = this.selectedSetId;
    this.setSelect.textContent = '';
    this.sets.forEach((set) => {
      const option = document.createElement('option');
      option.value = set.setId;
      option.textContent = `${set.name} · ${set.setId}`;
      this.setSelect.appendChild(option);
    });

    this.selectedSetId =
      previous && this.sets.some((set) => set.setId === previous)
        ? previous
        : this.sets[0]?.setId ?? null;
    if (this.selectedSetId) this.setSelect.value = this.selectedSetId;
    this.setSelect.disabled = this.sets.length === 0;
    this.renderSelection();
    if (this.state) this.render();

    if (this.sets.length === 0) {
      this.setFeedback('shop.error.noBooster', 'error');
    }
    this.log(`Booster picker ready (${this.sets.length} extension(s)).`);
  }

  /** Selects the extension picked in the combo box. @returns {void} */
  handleSetChange() {
    this.selectedSetId = this.setSelect.value || null;
    this.renderSelection();
    this.render();
  }

  /** Draws the artwork and the name of the selected booster. @returns {void} */
  renderSelection() {
    const set = this.sets.find((entry) => entry.setId === this.selectedSetId) ?? null;
    if (set?.texture) {
      this.setIcon.src = i18n.resolveImagePath(set.texture);
      this.setIcon.hidden = false;
    } else {
      this.setIcon.removeAttribute('src');
      this.setIcon.hidden = true;
    }
  }

  /**
   * Writes the countdown to the next monthly stock refill.
   *
   * It follows the trusted UTC clock and is refreshed by `CLOCK_TICK`, once per second. The stock
   * refills at 00:00 UTC on the first day of the next month.
   *
   * @param {Date|null} [utc=null] - Trusted UTC instant carried by the tick, when available.
   * @returns {void}
   */
  updateRefillTimer(utc = null) {
    if (!this.refillElement) return;
    const now = utc instanceof Date && Number.isFinite(utc.getTime())
      ? utc
      : dateSyncManager.getUtcDate();
    if (!dateSyncManager.isTimeTrusted() || !Number.isFinite(now.getTime())) {
      this.refillElement.textContent = '-- j --:--:--';
      return;
    }

    const nextMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0);
    let remaining = Math.max(0, nextMonth - now.getTime());
    const days = Math.floor(remaining / 86_400_000);
    remaining -= days * 86_400_000;
    const hours = Math.floor(remaining / 3_600_000);
    remaining -= hours * 3_600_000;
    const minutes = Math.floor(remaining / 60_000);
    const seconds = Math.floor((remaining - minutes * 60_000) / 1000);
    const time = [hours, minutes, seconds]
      .map((part) => String(part).padStart(2, '0'))
      .join(':');
    this.refillElement.textContent = i18n.t('shop.refill.value', { days, time });
  }

  /**
   * Reloads the allowance and the balance.
   *
   * @returns {Promise<void>} Resolves once the screen is up to date.
   */
  async refresh() {
    try {
      this.state = await boosterManager.getBoosterShopState();
      this.quantity = this.clampQuantity(this.quantity);
      this.setFeedback(null);
      this.render();
    } catch (error) {
      console.error('[ShopView] The shop could not be loaded.', error);
      this.setFeedback('shop.error.load', 'error');
    }
  }

  /**
   * Reloads the block-bundle allowance and the balance.
   *
   * @returns {Promise<void>} Resolves once the bundle panel is up to date.
   */
  async refreshBundle() {
    try {
      this.bundleState = await miningManager.getBundleShopState();
      this.bundleQuantity = this.clampBundleQuantity(this.bundleQuantity);
      this.setBundleFeedback(null);
      this.renderBundle();
    } catch (error) {
      console.error('[ShopView] The block bundles could not be loaded.', error);
      this.setBundleFeedback('shop.bundle.error.load', 'error');
    }
  }

  /**
   * Renders the block-bundle allowance, its price and the state of its button.
   *
   * @returns {void}
   */
  renderBundle() {
    if (!this.bundleState) return;
    const { balance, purchased, remaining, limit, unitPrice, blocksPerBundle, canBuy } =
      this.bundleState;
    const total = unitPrice * this.bundleQuantity;
    const missing = Math.max(0, total - balance);
    const soldOut = remaining <= 0;
    this.bundleSection.dataset.soldOut = String(soldOut);

    this.bundleDescriptionElement.textContent = i18n.t('shop.bundle.description', {
      blocks: blocksPerBundle,
    });
    this.bundleBlocksElement.textContent = String(blocksPerBundle);
    this.bundlePriceElement.textContent = String(unitPrice);
    this.bundlePurchasedElement.textContent = String(purchased);
    this.bundleRemainingElement.textContent = String(remaining);
    this.bundleLimitElement.textContent = String(limit);
    this.bundleTotalElement.textContent = i18n.t('shop.bundle.total', {
      count: this.bundleQuantity,
      unit: unitPrice,
      total,
    });

    const ratio = limit > 0 ? Math.min(1, purchased / limit) : 1;
    this.bundleProgressElement.style.width = `${Math.round(ratio * 100)}%`;
    const progressbar = this.bundleProgressElement.parentElement;
    progressbar.setAttribute('aria-valuenow', String(purchased));
    progressbar.setAttribute('aria-valuemax', String(limit));

    this.bundleQuantityInput.max = String(Math.max(1, remaining));
    this.bundleQuantityInput.value = String(this.bundleQuantity);
    this.bundleQuantityInput.disabled = !canBuy || soldOut || this.isBuyingBundle;
    this.bundleMinusButton.disabled = this.isBuyingBundle || this.bundleQuantity <= 1;
    this.bundlePlusButton.disabled = this.isBuyingBundle || this.bundleQuantity >= remaining;

    this.bundleBuyButton.disabled =
      this.isBuyingBundle || !canBuy || soldOut || missing > 0;
    this.bundleBuyButton.textContent = soldOut
      ? i18n.t('shop.bundle.soldOut')
      : i18n.t('shop.bundle.confirm', { count: this.bundleQuantity, total });

    if (soldOut) {
      this.setBundleFeedback('shop.bundle.error.soldOut', 'error', { limit });
    } else if (!canBuy) {
      this.setBundleFeedback('shop.bundle.error.clock', 'error');
    } else if (missing > 0) {
      this.setBundleFeedback('shop.bundle.error.insufficientSparks', 'error', { missing });
    } else if (
      this.bundleFeedbackElement.dataset.code === 'shop.bundle.error.insufficientSparks' ||
      this.bundleFeedbackElement.dataset.code === 'shop.bundle.error.clock' ||
      this.bundleFeedbackElement.dataset.code === 'shop.bundle.error.soldOut'
    ) {
      this.setBundleFeedback(null);
    }
  }

  /**
   * Writes a bundle quantity, clamped to the remaining allowance.
   *
   * @param {unknown} value - Requested quantity.
   * @returns {void}
   */
  setBundleQuantity(value) {
    this.bundleQuantity = this.clampBundleQuantity(value);
    this.renderBundle();
  }

  /**
   * Clamps a requested bundle quantity between 1 and the remaining allowance.
   *
   * @param {unknown} value - Requested quantity.
   * @returns {number} A usable quantity.
   */
  clampBundleQuantity(value) {
    const remaining = Math.max(1, this.bundleState?.remaining ?? 1);
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 1;
    return Math.min(remaining, Math.max(1, Math.round(parsed)));
  }

  /**
   * Buys the requested block bundles and refreshes the allowance from the save.
   *
   * @returns {Promise<void>} Resolves once the purchase settled.
   */
  async buyBundles() {
    if (this.isBuyingBundle || !this.bundleState) return;
    if (this.bundleState.remaining <= 0) {
      this.setBundleFeedback('shop.bundle.error.limit', 'error', {
        limit: this.bundleState.limit,
      });
      return;
    }
    const total = this.bundleState.unitPrice * this.bundleQuantity;
    if (this.bundleState.balance < total) {
      this.setBundleFeedback('shop.bundle.error.insufficientSparks', 'error', {
        missing: total - this.bundleState.balance,
      });
      return;
    }

    this.isBuyingBundle = true;
    this.setBundleFeedback(null);
    this.renderBundle();
    try {
      const purchase = await miningManager.buyMonthlyBundles(this.bundleQuantity);
      this.bundleQuantity = 1;
      Toast.success('shop.bundle.done', {
        params: { count: purchase.quantity, total: purchase.total },
      });
      await this.refreshBundle();
    } catch (error) {
      console.error('[ShopView] The block-bundle purchase failed.', error);
      if (error?.code === BUNDLE_SHOP_ERRORS.MONTHLY_LIMIT_REACHED) {
        await this.refreshBundle();
        this.setBundleFeedback('shop.bundle.error.limit', 'error', {
          limit: this.bundleState.limit,
        });
      } else if (error?.code === INSUFFICIENT_SPARKS) {
        this.setBundleFeedback('shop.bundle.error.insufficientSparks', 'error', {
          missing: Math.max(0, total - this.bundleState.balance),
        });
      } else if (error?.code === BUNDLE_SHOP_ERRORS.CLOCK_UNAVAILABLE) {
        this.setBundleFeedback('shop.bundle.error.clock', 'error');
      } else {
        this.setBundleFeedback('shop.bundle.error.buy', 'error');
      }
    } finally {
      this.isBuyingBundle = false;
      this.renderBundle();
    }
  }

  /**
   * Writes the feedback line of the bundle panel.
   *
   * @param {string|null} key - Translation key, or null to clear the line.
   * @param {'info'|'error'} [tone='info'] - Tone of the message.
   * @param {object|null} [params=null] - Interpolation values.
   * @returns {void}
   */
  setBundleFeedback(key, tone = 'info', params = null) {
    this.bundleFeedbackElement.dataset.code = key ?? '';
    if (!key) {
      this.bundleFeedbackElement.hidden = true;
      this.bundleFeedbackElement.textContent = '';
      return;
    }
    this.bundleFeedbackElement.hidden = false;
    this.bundleFeedbackElement.textContent = i18n.t(key, params ?? undefined);
    this.bundleFeedbackElement.dataset.tone = tone;
  }

  /**
   * Renders the allowance, the total and the state of the purchase button.
   *
   * @returns {void}
   */
  render() {
    if (!this.state) return;
    const { balance, purchased, remaining, limit, unitPrice, canBuy } = this.state;
    const total = unitPrice * this.quantity;
    const hasBooster = Boolean(this.selectedSetId);
    const missing = Math.max(0, total - balance);
    const soldOut = remaining <= 0;
    this.boosterSection.dataset.soldOut = String(soldOut);

    this.balanceElement.textContent = String(balance);
    this.purchasedElement.textContent = String(purchased);
    this.limitElement.textContent = String(limit);
    this.remainingElement.textContent = String(remaining);
    this.unitPriceElement.textContent = String(unitPrice);
    this.totalElement.textContent = i18n.t('shop.purchase.total', {
      count: this.quantity,
      unit: unitPrice,
      total,
    });

    const ratio = limit > 0 ? Math.min(1, purchased / limit) : 1;
    this.progressElement.style.width = `${Math.round(ratio * 100)}%`;
    const progressbar = this.progressElement.parentElement;
    progressbar.setAttribute('aria-valuenow', String(purchased));
    progressbar.setAttribute('aria-valuemax', String(limit));

    this.quantityInput.max = String(Math.max(1, remaining));
    this.quantityInput.value = String(this.quantity);
    this.quantityInput.disabled = !canBuy || remaining <= 0 || this.isBuying;

    this.minusButton.disabled = this.isBuying || this.quantity <= 1;
    this.plusButton.disabled = this.isBuying || this.quantity >= remaining;

    this.buyButton.disabled = this.isBuying || !canBuy || !hasBooster || soldOut || missing > 0;
    this.buyButton.textContent = soldOut
      ? i18n.t('shop.purchase.soldOut')
      : i18n.t('shop.purchase.confirm', { count: this.quantity, total });

    if (soldOut) {
      this.setFeedback('shop.error.soldOut', 'error', { limit });
    } else if (missing > 0) {
      this.setFeedback('shop.error.insufficientSparks', 'error', { missing });
    } else if (
      this.feedbackElement.dataset.code === 'shop.error.insufficientSparks' ||
      this.feedbackElement.dataset.code === 'shop.error.soldOut'
    ) {
      this.setFeedback(null);
    }
  }

  /**
   * Writes a quantity, clamped to the remaining allowance.
   *
   * @param {unknown} value - Requested quantity.
   * @returns {void}
   */
  setQuantity(value) {
    this.quantity = this.clampQuantity(value);
    this.render();
  }

  /**
   * Clamps a requested quantity between 1 and the remaining allowance.
   *
   * @param {unknown} value - Requested quantity.
   * @returns {number} A usable quantity.
   */
  clampQuantity(value) {
    const remaining = Math.max(1, this.state?.remaining ?? 1);
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 1;
    return Math.min(remaining, Math.max(1, Math.round(parsed)));
  }

  /**
   * Buys the requested quantity and refreshes the allowance from the save.
   *
   * @returns {Promise<void>} Resolves once the purchase settled.
   */
  async buy() {
    if (this.isBuying || !this.state || !this.selectedSetId) return;
    if (this.state.remaining <= 0) {
      this.setFeedback('shop.error.limit', 'error', { limit: this.state.limit });
      return;
    }
    if (this.state.balance < this.state.unitPrice * this.quantity) {
      this.setFeedback('shop.error.insufficientSparks', 'error', {
        missing: this.state.unitPrice * this.quantity - this.state.balance,
      });
      return;
    }

    this.isBuying = true;
    this.setFeedback(null);
    this.render();
    try {
      const purchase = await boosterManager.buyMonthlyBoosters(this.quantity, this.selectedSetId);
      this.quantity = 1;
      this.state = {
        ...this.state,
        purchased: purchase.purchased,
        remaining: purchase.remaining,
        balance: purchase.balance,
        month: purchase.month,
      };
      Toast.success('shop.purchase.done', {
        params: { count: purchase.quantity, total: purchase.total },
      });
      // Reload the authoritative state: the purchase refreshed the quota and the balance mirrors.
      await this.refresh();
    } catch (error) {
      console.error('[ShopView] The purchase failed.', error);
      if (error?.code === BOOSTER_SHOP_ERRORS.MONTHLY_LIMIT_REACHED) {
        await this.refresh();
        this.setFeedback('shop.error.limit', 'error', { limit: this.state.limit });
      } else if (error?.code === INSUFFICIENT_SPARKS) {
        this.setFeedback('shop.error.insufficientSparks', 'error', {
          missing: Math.max(0, this.state.unitPrice * this.quantity - this.state.balance),
        });
      } else if (error?.code === BOOSTER_SHOP_ERRORS.CLOCK_UNAVAILABLE) {
        this.setFeedback('shop.error.clock', 'error');
      } else {
        this.setFeedback('shop.error.buy', 'error');
      }
    } finally {
      this.isBuying = false;
      this.render();
    }
  }

  /**
   * Writes the feedback line.
   *
   * @param {string|null} key - Translation key, or null to clear the line.
   * @param {'info'|'error'} [tone='info'] - Tone of the message.
   * @param {object|null} [params=null] - Interpolation values.
   * @returns {void}
   */
  setFeedback(key, tone = 'info', params = null) {
    this.feedbackElement.dataset.code = key ?? '';
    if (!key) {
      this.feedbackElement.hidden = true;
      this.feedbackElement.textContent = '';
      return;
    }
    this.feedbackElement.hidden = false;
    this.feedbackElement.textContent = i18n.t(key, params ?? undefined);
    this.feedbackElement.dataset.tone = tone;
  }

  /** Releases the listeners. @returns {void} */
  destroy() {
    this.bindings.forEach(({ target, type, handler }) => target.removeEventListener(type, handler));
    this.bindings = [];
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
  }
}

export default ShopView;
