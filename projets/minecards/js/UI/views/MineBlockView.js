/**
 * MineBlockView - the Mine screen: ten blocks a day, mined one by one.
 *
 * Reference: `js/business/MiningManager.js` (the rules, the allowance and the loot),
 * `settings/mining.json` (the five kinds of block: weight, hardness, loot) and
 * `css/views/mineblock.css` (the rock, the cracks and the flying rewards).
 *
 * WHAT THE PLAYER SEES
 *   The block of the moment, big, in the middle of the page: its name above it, the blocks left
 *   today under it, and the resources harvested so far below that (their PICTURE and their count:
 *   the name is only in the accessible text and in the inventory). Every tap cracks the block a
 *   little more (the crack texture of the manager's table is laid over the picture) and plays its
 *   `.mine` sound; the tap that breaks it plays the `.break` sound, spits the loot OUT of the
 *   rock - one flying element per unit obtained, each in its own direction - and announces every
 *   reward as a toast (`+1 Stone Dust`). The next block then lands in its place, with its own
 *   picture, its own name and its own hardness.
 *
 * WHAT THIS VIEW OWNS, AND WHAT IT DOES NOT
 *   The view owns the rendering and the feedback (sounds, bursts, toasts, the two dialogs). The
 *   rules, the randomness, the daily allowance and the persistence all live in `MiningManager`: a
 *   tap is one call to `mine()`, whose result carries everything the animation needs (the percent
 *   broken, the crack texture, the rewards with their texture and their number). Nothing is stored
 *   here, so a reload in the middle of a block resumes it with the same number of taps landed.
 *
 * TWO DIALOGS
 *   - the INVENTORY, opened by the chest under the resources: every resource with its picture, its
 *     name and its quantity. The chest is an ANIMATED webp, so a still frame of it is drawn once on
 *     a canvas and shown the rest of the time; clicking it swaps the animated file back in for the
 *     length of one play, so the chest only moves when it is opened.
 *   - the WANDERING TRADER, a screen of the same name implemented later: its button opens a dialog
 *     that only knows how to close itself (button, backdrop or `Escape`).
 */

import eventBus, { EVENTS } from '../../utils/EventBus.js';
import i18n from '../../utils/I18n.js';
import miningManager, { getMiningErrorMessageKey } from '../../business/MiningManager.js';
import dateSyncManager from '../../business/DateSyncManager.js';
import soundManager from '../../utils/SoundManager.js';
import Toast from '../components/Toast.js';

/** View name, matching `data-view="mineblock"` in `index.html`. */
export const MINE_BLOCK_VIEW_NAME = 'mineblock';

/**
 * Delay before the next block lands, in milliseconds.
 *
 * Only a fallback: the real value is `mining.nextBlockDelayMs` of `settings/config.json`, so the
 * pace of the mine is tuned there, next to the daily allowance of blocks.
 */
export const DEFAULT_NEXT_BLOCK_DELAY_MS = 100;

/** Texture of the chest that opens the inventory (an ANIMATED webp). */
export const CHEST_TEXTURE = 'assets/img/chest.webp';

/** How long the chest plays its animation on a click, in milliseconds. */
const CHEST_PLAY_MS = 1600;

/** Lifetime of one flying reward, in milliseconds (must cover the stylesheet animation). */
const BURST_LIFETIME_MS = 1100;

/**
 * Duration of the landing of the next block, in milliseconds.
 *
 * It MUST stay equal to `mineblock-arrive` of `css/views/mineblock.css`: the class only lives for
 * the length of the animation, and taking it off early would cut the landing of the block.
 */
const ARRIVE_ANIMATION_MS = 160;

/** Duration of the flinch under a tap that did not break the block (see `mineblock-hit`). */
const HIT_ANIMATION_MS = 180;

/** Highest number of flying elements for one reward (a safety net for an edited configuration). */
const BURST_MAX_ITEMS = 24;

/** Distance range of a flying reward, in pixels. */
const BURST_MIN_DISTANCE = 70;
const BURST_MAX_DISTANCE = 170;

export class MineBlockView {
  /**
   * @param {HTMLElement} rootElement - The mine `<section>` (`[data-view="mineblock"]`).
   */
  constructor(rootElement) {
    if (!rootElement || typeof rootElement.querySelector !== 'function') {
      throw new TypeError('MineBlockView requires the mine section element.');
    }

    this.root = rootElement;
    this.feedbackElement = this.root.querySelector('[data-mineblock-feedback]');
    this.nameElement = this.root.querySelector('[data-mineblock-name]');
    this.remainingElement = this.root.querySelector('[data-mineblock-remaining]');
    this.countdownElement = this.root.querySelector('[data-mineblock-countdown]');
    this.countdownValue = this.root.querySelector('[data-mineblock-countdown-value]');
    this.rockElement = this.root.querySelector('[data-mineblock-rock]');
    this.textureImage = this.root.querySelector('[data-mineblock-texture]');
    this.crackImage = this.root.querySelector('[data-mineblock-crack]');
    this.burstElement = this.root.querySelector('[data-mineblock-burst]');
    this.hintElement = this.root.querySelector('[data-mineblock-hint]');
    this.emptyElement = this.root.querySelector('[data-mineblock-empty]');
    this.resourcesElement = this.root.querySelector('[data-mineblock-resources]');
    this.inventoryButton = this.root.querySelector('[data-mineblock-inventory]');
    this.inventoryIcon = this.root.querySelector('[data-mineblock-inventory-icon]');
    this.inventoryModal = this.root.querySelector('[data-mineblock-inventory-modal]');
    this.inventoryClose = this.root.querySelector('[data-mineblock-inventory-close]');
    this.inventoryDismiss = this.root.querySelector('[data-mineblock-inventory-dismiss]');
    this.inventoryList = this.root.querySelector('[data-mineblock-inventory-list]');
    this.inventoryEmpty = this.root.querySelector('[data-mineblock-inventory-empty]');
    this.traderButton = this.root.querySelector('[data-mineblock-trader]');
    this.traderModal = this.root.querySelector('[data-mineblock-trader-modal]');
    this.traderClose = this.root.querySelector('[data-mineblock-trader-close]');
    this.traderDismiss = this.root.querySelector('[data-mineblock-trader-dismiss]');

    this.assertMarkup();

    /** @type {object|null} Last state returned by `MiningManager.getState()`. */
    this.state = null;
    /** @type {Array<{slug: string, type: string, nameKey: string, texture: string}>} Harvested kinds. */
    this.resources = [];
    /** @type {number} Delay before the next block lands, in milliseconds (from the configuration). */
    this.nextBlockDelayMs = DEFAULT_NEXT_BLOCK_DELAY_MS;
    /** @type {string|null} Still frame of the chest, drawn once (`null` until it is ready). */
    this.chestStillFrame = null;
    /** @type {number|null} Timer that puts the still frame back on the chest. */
    this.chestTimer = null;
    /** @type {{modal: HTMLElement, trigger: HTMLElement}|null} Dialog currently open. */
    this.openDialog = null;
    /** @type {boolean} True while a tap is being committed (guards double taps). */
    this.isMining = false;
    /** @type {boolean} True while the screen is reading its data. */
    this.isLoading = false;
    /** @type {boolean} True once `init()` bound everything. */
    this.isInitialized = false;
    /** @type {boolean} True when the view is the active one. */
    this.isActive = false;
    /** @type {string|null} Texture currently displayed (avoids re-setting a `src`). */
    this.displayedTexture = null;
    /** @type {string|null} Last feedback message, so a language switch can retranslate it. */
    this.feedback = null;
    /** @type {Set<string>} Sounds already warmed up (a second `load()` would cut a running `play()`). */
    this.prefetchedSounds = new Set();
    /** @type {number[]} Timers of the sequences still in flight. */
    this.timers = [];

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
    console.info('[MineBlockView]', ...args);
  }

  /**
   * Verifies that the markup matches the contract expected by this view.
   *
   * @returns {void}
   * @throws {Error} When a required element is missing from `index.html`.
   */
  assertMarkup() {
    const missing = [
      ['[data-mineblock-feedback]', this.feedbackElement],
      ['[data-mineblock-name]', this.nameElement],
      ['[data-mineblock-remaining]', this.remainingElement],
      ['[data-mineblock-countdown]', this.countdownElement],
      ['[data-mineblock-countdown-value]', this.countdownValue],
      ['[data-mineblock-rock]', this.rockElement],
      ['[data-mineblock-texture]', this.textureImage],
      ['[data-mineblock-crack]', this.crackImage],
      ['[data-mineblock-burst]', this.burstElement],
      ['[data-mineblock-hint]', this.hintElement],
      ['[data-mineblock-empty]', this.emptyElement],
      ['[data-mineblock-resources]', this.resourcesElement],
      ['[data-mineblock-inventory]', this.inventoryButton],
      ['[data-mineblock-inventory-icon]', this.inventoryIcon],
      ['[data-mineblock-inventory-modal]', this.inventoryModal],
      ['[data-mineblock-inventory-close]', this.inventoryClose],
      ['[data-mineblock-inventory-dismiss]', this.inventoryDismiss],
      ['[data-mineblock-inventory-list]', this.inventoryList],
      ['[data-mineblock-inventory-empty]', this.inventoryEmpty],
      ['[data-mineblock-trader]', this.traderButton],
      ['[data-mineblock-trader-modal]', this.traderModal],
      ['[data-mineblock-trader-close]', this.traderClose],
      ['[data-mineblock-trader-dismiss]', this.traderDismiss],
    ]
      .filter(([, element]) => !element)
      .map(([selector]) => selector);

    if (missing.length > 0) {
      throw new Error(`MineBlockView markup is incomplete, missing: ${missing.join(', ')}.`);
    }
  }

  /**
   * Binds the interactions, subscribes to the events and draws the mine.
   *
   * @returns {Promise<void>} Resolves once the screen is displayed.
   * @throws {Error} When the mine rules or the state cannot be read.
   */
  async init() {
    if (this.isInitialized) return;
    this.isInitialized = true;
    this.log('Initializing…');
    this.bindEvents();
    this.subscribeToEvents();
    try {
      this.resources = await miningManager.listResources();
      // The pace of the mine is a setting of `settings/config.json` (`mining.nextBlockDelayMs`).
      if (Number.isFinite(miningManager.settings?.nextBlockDelayMs)) {
        this.nextBlockDelayMs = miningManager.settings.nextBlockDelayMs;
      }
    } catch (error) {
      console.error('[MineBlockView] The resources of the mine could not be listed.', error);
      this.resources = [];
    }
    void this.freezeChest();
    await this.reload();
    this.log('Ready.');
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
   * Attaches the DOM listeners (the block and the two dialogs).
   *
   * @returns {void}
   */
  bindEvents() {
    this.listen(this.rockElement, 'click', () => void this.handleMine());

    // The chest plays its animation while its dialog opens: one click, one gesture.
    this.listen(this.inventoryButton, 'click', () => {
      this.playChest();
      this.openModal(this.inventoryModal, this.inventoryButton);
    });
    this.listen(this.inventoryClose, 'click', () => this.closeModal(this.inventoryModal));
    this.listen(this.inventoryDismiss, 'click', () => this.closeModal(this.inventoryModal));
    this.listen(this.inventoryModal, 'click', (event) => {
      if (event.target === this.inventoryModal) this.closeModal(this.inventoryModal);
    });

    this.listen(this.traderButton, 'click', () => this.openModal(this.traderModal, this.traderButton));
    this.listen(this.traderClose, 'click', () => this.closeModal(this.traderModal));
    this.listen(this.traderDismiss, 'click', () => this.closeModal(this.traderModal));
    // The backdrop closes a dialog: a tap outside is never a dead end.
    this.listen(this.traderModal, 'click', (event) => {
      if (event.target === this.traderModal) this.closeModal(this.traderModal);
    });

    this.listen(document, 'keydown', (event) => {
      if (event.key === 'Escape') this.closeModal();
    });
    this.log('DOM listeners bound.');
  }

  /**
   * Subscribes to the application events the view depends on.
   *
   * @returns {void}
   */
  subscribeToEvents() {
    this.unsubscribers.push(
      eventBus.on(EVENTS.VIEW_CHANGED, (payload) => {
        if (!payload || typeof payload.view !== 'string') return;
        if (payload.view === MINE_BLOCK_VIEW_NAME) {
          this.handleViewActivated();
        } else if (payload.previousView === MINE_BLOCK_VIEW_NAME) {
          this.handleViewDeactivated();
        }
      })
    );
    this.unsubscribers.push(
      eventBus.on(EVENTS.LANG_CHANGED, () => this.handleLanguageChanged())
    );
    this.unsubscribers.push(eventBus.on(EVENTS.CLOCK_TICK, (payload) => this.handleClockTick(payload)));
    this.unsubscribers.push(
      eventBus.on(EVENTS.MINING_UPDATED, () => {
        // The tap that is being committed already rendered its own result (`handleMine`), and
        // reloading here would swap the block BEFORE the loot has finished flying out of the one
        // that just broke: the view only follows the updates it did not cause itself.
        if (this.isActive && !this.isMining) {
          void this.reload().catch((error) => {
            console.warn('[MineBlockView] The mine could not be refreshed.', error);
          });
        }
      })
    );
    // An imported save carries ANOTHER uuid, and therefore another order of the day.
    this.unsubscribers.push(
      eventBus.on(EVENTS.SAVE_IMPORTED, () => {
        void miningManager
          .init({ force: true })
          .then(() => this.reload())
          .catch((error) => console.warn('[MineBlockView] The mine rules could not be reloaded.', error));
      })
    );
    this.log('Event subscriptions registered.');
  }

  /**
   * Reads the state, then renders the screen.
   *
   * The Sparks balance is deliberately NOT read: the mine shows the resources it harvests, and the
   * currency has its own counter in the header (and its own toasts when a block yields some).
   *
   * @returns {Promise<void>} Resolves once the screen is rendered (or the error shown).
   */
  async reload() {
    if (this.isLoading) return;
    this.isLoading = true;
    this.setFeedback(null);
    try {
      this.state = await miningManager.getState({ lang: i18n.getLang() });
      this.render();
    } catch (error) {
      console.error('[MineBlockView] The mine could not be loaded.', error);
      this.setFeedback(getMiningErrorMessageKey(error?.code), 'error');
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Renders the whole screen from the last state.
   *
   * @returns {void}
   */
  render() {
    if (!this.state) return;
    this.renderQuota(this.state);
    this.renderBlock(this.state);
    this.renderResources();
  }

  /**
   * Writes the name of the block, the blocks left today and the countdown to the next reset.
   *
   * @param {object} state - State returned by `MiningManager.getState()`.
   * @returns {void}
   */
  renderQuota(state) {
    this.remainingElement.textContent = i18n.t('mineblock.remaining', {
      remaining: state.remaining,
      total: state.blocksPerDay,
    });

    const exhausted = state.remaining <= 0;
    this.countdownElement.hidden = !exhausted;
    if (exhausted) {
      this.countdownValue.textContent = dateSyncManager.getFormattedTimeUntilReset();
    }
  }

  /**
   * Writes the block of the moment: its name, its picture, its crack and the hint under it.
   *
   * @param {object} state - State returned by `MiningManager.getState()`.
   * @returns {void}
   */
  renderBlock(state) {
    const block = state.block;
    this.root.classList.toggle('is-exhausted', !block);
    this.emptyElement.hidden = Boolean(block);

    if (!block) {
      this.nameElement.textContent = '';
      this.textureImage.hidden = true;
      this.crackImage.hidden = true;
      this.displayedTexture = null;
      this.rockElement.disabled = true;
      this.rockElement.removeAttribute('aria-label');
      // "Every block is mined" and "the mine has no rule at all" are two very different situations:
      // a broken `settings/mining.json` must be reported as a failure, not as a day well spent.
      this.hintElement.textContent =
        miningManager.blocks.length === 0
          ? i18n.t('mineblock.error.load')
          : i18n.t('mineblock.hint.limit');
      return;
    }

    this.rockElement.disabled = false;
    this.rockElement.setAttribute('aria-label', i18n.t('mineblock.rock.aria', { name: block.name }));
    this.nameElement.textContent = block.name;
    this.emptyElement.hidden = true;

    if (this.displayedTexture !== block.texture) {
      this.displayedTexture = block.texture;
      this.textureImage.src = block.texture;
    }
    this.textureImage.hidden = false;
    this.textureImage.alt = '';
    this.renderCrack(state.progress);
    // The hint never counts the taps left: the crack under the player's finger already says how
    // close the block is, and a number next to it turned the ritual into a progress report.
    this.hintElement.textContent = i18n.t('mineblock.hint');

    this.prefetchSounds(block);
  }

  /**
   * Lays the crack texture matching a break percentage over the block.
   *
   * @param {number} percent - Break percentage (0-100).
   * @returns {void}
   */
  renderCrack(percent) {
    const texture = miningManager.getCrackTexture(percent);
    if (!texture) {
      this.crackImage.hidden = true;
      return;
    }
    if (this.crackImage.getAttribute('src') !== texture) {
      this.crackImage.src = texture;
    }
    this.crackImage.hidden = false;
  }

  /**
   * Displays the quantity of every resource of the mine: its picture, then its count.
   *
   * The chips are declared by `settings/mining.json` (the union of the rewards of the five blocks),
   * so adding a resource there is enough to see it here. A resource never harvested yet shows `0`
   * rather than disappearing, which is what makes the row readable as a stock.
   *
   * The NAME is not written on screen (the icon says it, and the inventory spells it out): it only
   * lives in the accessible text of the chip, so a screen reader still reads "12 Poussière de
   * pierre" instead of a lone number. The Sparks are not listed either - they are the currency, and
   * the header already counts them.
   *
   * @returns {void}
   */
  renderResources() {
    this.resourcesElement.textContent = '';
    const counts = this.state?.resources ?? {};

    this.resources.forEach((resource) => {
      this.resourcesElement.appendChild(
        this.buildResourceEntry(resource, counts[resource.slug] ?? 0, 'mineblock__resource')
      );
    });
  }

  /**
   * Builds one resource entry (picture, count, accessible name).
   *
   * Shared by the row under the block and the inventory dialog: both show the same thing, and only
   * the class and the way the name is written differ.
   *
   * @param {{slug: string, type?: string, nameKey?: string, texture: string}} resource - Resource.
   * @param {number} count - Quantity to display.
   * @param {string} className - Class of the built element.
   * @returns {HTMLElement} The `<li>` of the resource.
   */
  buildResourceEntry(resource, count, className) {
    const label = this.resolveResourceLabel(resource);

    const item = document.createElement('li');
    item.className = className;
    item.dataset.resource = resource.slug;

    const icon = document.createElement('img');
    icon.className = `${className}-icon`;
    icon.src = resource.texture;
    icon.alt = '';
    icon.decoding = 'async';
    // A resource whose picture was not shipped still shows its count: the entry never breaks.
    icon.addEventListener('error', () => {
      icon.hidden = true;
    });

    const value = document.createElement('span');
    value.className = `${className}-value`;
    value.textContent = String(count);

    // The name of the resource is the accessible text of the entry, in the order it is read.
    const accessible = document.createElement('span');
    accessible.className = 'sr-only';
    accessible.textContent = label;

    // Visually: the icon, then the count. For a screen reader: the count, then the name.
    item.append(icon, value, accessible);
    return item;
  }

  /**
   * Label of a resource: its translation, falling back to the raw type of the configuration.
   *
   * @param {{nameKey?: string, type?: string}} resource - Resource chip or reward.
   * @returns {string} The player-facing label.
   */
  resolveResourceLabel(resource) {
    const key = resource.nameKey;
    if (!key) return resource.type ?? '';
    const translated = i18n.t(key);
    return translated === key ? resource.type ?? translated : translated;
  }

  /**
   * Lands one tap on the block.
   *
   * The commit happens first (`MiningManager.mine()`), the feedback follows: a refused tap (every
   * block of the day already mined) is reported without touching the screen.
   *
   * @returns {Promise<void>} Resolves once the tap was applied (or the refusal reported).
   */
  async handleMine() {
    if (this.isMining || !this.state?.block) return;
    const block = this.state.block;
    this.isMining = true;
    this.setFeedback(null);

    try {
      const result = await miningManager.mine({ lang: i18n.getLang() });
      soundManager.play(result.broke ? block.sounds.break : block.sounds.mine);

      // A broken block reports its own full hardness and 100 %, but `block` is now the NEXT one,
      // untouched: keeping either would lay the last crack texture of the block that just
      // disappeared over the new block that just landed.
      this.state = {
        ...this.state,
        clicks: result.broke ? 0 : result.clicks,
        progress: result.broke ? 0 : result.percent,
        remaining: result.remaining,
        minedToday: result.minedToday,
        block: result.broke ? result.nextBlock : this.state.block,
        resources: result.resources,
        blocksMined: result.blocksMined,
        totalMined: result.totalMined,
        sparksFound: result.sparksFound,
      };
      this.renderQuota(this.state);

      if (result.broke) {
        this.animateBreak(result);
      } else {
        this.pulseRock();
        this.renderCrack(result.percent);
      }
    } catch (error) {
      console.error('[MineBlockView] The block could not be mined.', error);
      this.setFeedback(getMiningErrorMessageKey(error?.code), 'error');
      void this.reload();
    } finally {
      this.isMining = false;
    }
  }

  /**
   * Plays the breaking sequence: the rock shrinks, the loot flies out, the next one lands.
   *
   * The swap is DELAYED on purpose - but only just: the block that was broken disappears a moment
   * before its replacement drops in, so the picture stays readable while the loot is still flying
   * out of it (the burst has a life of its own, it is not cut by the swap). The delay is
   * `mining.nextBlockDelayMs` of `settings/config.json`. The state is already up to date, so nothing
   * depends on those milliseconds except the picture - a player who leaves the screen mid-sequence
   * loses nothing.
   *
   * @param {object} result - Result returned by `MiningManager.mine()`.
   * @returns {void}
   */
  animateBreak(result) {
    this.rockElement.classList.add('is-broken');
    this.burstRewards(result.rewards);
    this.announceRewards(result.rewards);
    this.renderResources();

    this.setViewTimeout(() => {
      this.rockElement?.classList.remove('is-broken');
      if (!this.state) return;
      this.renderBlock(this.state);
      if (this.state.block) {
        this.rockElement.classList.add('is-arriving');
        this.setViewTimeout(
          () => this.rockElement?.classList.remove('is-arriving'),
          ARRIVE_ANIMATION_MS
        );
      }
    }, this.nextBlockDelayMs);
  }

  /**
   * Makes the rock flinch under a tap that did not break it.
   *
   * @returns {void}
   */
  pulseRock() {
    this.rockElement.classList.remove('is-hit');
    // Reading `offsetWidth` restarts the animation of a repeated tap instead of ignoring it.
    void this.rockElement.offsetWidth;
    this.rockElement.classList.add('is-hit');
    this.setViewTimeout(() => this.rockElement?.classList.remove('is-hit'), HIT_ANIMATION_MS);
  }

  /**
   * Spits one flying element per unit obtained, each in its own direction.
   *
   * Four Sparks give four Sparks flying away, one dust gives one dust: the number of elements is
   * the number obtained, and the direction, the distance, the delay and the spin are drawn at
   * random so two bursts never look alike.
   *
   * @param {Array<{kind: string, slug: string, amount: number, texture: string}>} rewards - Rewards
   *   of the broken block.
   * @returns {void}
   */
  burstRewards(rewards) {
    if (!this.burstElement) return;

    rewards.forEach((reward) => {
      const count = Math.min(Math.max(1, Math.trunc(reward.amount)), BURST_MAX_ITEMS);
      for (let index = 0; index < count; index += 1) {
        const angle = Math.random() * Math.PI * 2;
        const distance = BURST_MIN_DISTANCE + Math.random() * (BURST_MAX_DISTANCE - BURST_MIN_DISTANCE);

        const element = document.createElement('img');
        element.className = 'mineblock__burst-item';
        element.dataset.kind = reward.kind;
        element.src = reward.texture;
        element.alt = '';
        element.decoding = 'async';
        element.style.setProperty('--burst-x', `${Math.round(Math.cos(angle) * distance)}px`);
        element.style.setProperty('--burst-y', `${Math.round(Math.sin(angle) * distance)}px`);
        element.style.setProperty('--burst-spin', `${Math.round((Math.random() - 0.5) * 540)}deg`);
        element.style.setProperty('--burst-delay', `${Math.round(Math.random() * 90)}ms`);
        element.addEventListener('error', () => element.remove());

        this.burstElement.appendChild(element);
        window.setTimeout(() => element.remove(), BURST_LIFETIME_MS);
      }
    });
  }

  /**
   * Announces every reward as a notification (`+1 Stone Dust`).
   *
   * @param {Array<{kind: string, amount: number, nameKey: string, type: string}>} rewards - Rewards
   *   of the broken block.
   * @returns {void}
   */
  announceRewards(rewards) {
    rewards.forEach((reward) => {
      const params = { amount: reward.amount, resource: this.resolveResourceLabel(reward) };
      // The Sparks are the currency the header also shows: they get the louder tone.
      const element =
        reward.kind === 'sparks'
          ? Toast.success('mineblock.reward', { params })
          : Toast.info('mineblock.reward', { params });
      if (element) element.dataset.reward = reward.slug;
    });
  }

  /**
   * Loads the two sounds of the displayed block ahead of the first tap.
   *
   * The mining sounds are per block (`assets/sound/blocks/<id>.mine.mp3`) and therefore not part of
   * `SOUNDS` (which is preloaded as a whole at boot): only the block on screen is downloaded, which
   * is what keeps the page from pulling ten files nobody asked for.
   *
   * A path is warmed up ONCE per visit: `load()` on an element that is already playing aborts that
   * playback ("The play() request was interrupted by a new load request"), so warming the same block
   * again on every re-render would silence the very taps it is meant to serve.
   *
   * @param {{sounds: {mine: string, break: string}}} block - Block of the moment.
   * @returns {void}
   */
  prefetchSounds(block) {
    if (!soundManager.isEnabled()) return;
    Object.values(block.sounds).forEach((path) => {
      if (this.prefetchedSounds.has(path)) return;
      this.prefetchedSounds.add(path);
      try {
        soundManager.getElement(path)?.load();
      } catch (error) {
        console.warn(`[MineBlockView] "${path}" could not be preloaded.`, error);
      }
    });
  }

  /**
   * Runs a callback later, remembering the timer so leaving the view cancels it.
   *
   * @param {Function} callback - Callback to run.
   * @param {number} delay - Delay in milliseconds.
   * @returns {number} The timer id.
   */
  setViewTimeout(callback, delay) {
    const timer = window.setTimeout(() => {
      this.timers = this.timers.filter((candidate) => candidate !== timer);
      callback();
    }, delay);
    this.timers.push(timer);
    return timer;
  }

  /**
   * Cancels every sequence still in flight.
   *
   * @returns {void}
   */
  clearTimers() {
    this.timers.forEach((timer) => window.clearTimeout(timer));
    this.timers = [];
  }

  /**
   * Opens a dialog of the view (the inventory or the wandering trader).
   *
   * One dialog at a time: opening one closes the other, so the two can never be stacked. The
   * inventory is rebuilt on every opening - it is a snapshot of the resources, and it is cheap.
   *
   * @param {HTMLElement} modal - The `.modal` element to display.
   * @param {HTMLElement} trigger - The button it belongs to (receives `aria-expanded`).
   * @returns {void}
   */
  openModal(modal, trigger) {
    if (this.openDialog && this.openDialog.modal !== modal) {
      this.closeModal();
    }
    if (modal === this.inventoryModal) this.renderInventory();
    modal.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    this.openDialog = { modal, trigger };
    modal.querySelector('.modal__close')?.focus();
    this.log(`Dialog displayed: ${modal === this.inventoryModal ? 'inventory' : 'wandering trader'}.`);
  }

  /**
   * Closes the open dialog and gives the focus back to the button that opened it.
   *
   * @param {HTMLElement|null} [modal=null] - Only close this one (null closes whatever is open).
   * @returns {void}
   */
  closeModal(modal = null) {
    if (!this.openDialog) return;
    if (modal && this.openDialog.modal !== modal) return;
    const { modal: open, trigger } = this.openDialog;
    open.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    this.openDialog = null;
    trigger.focus();
  }

  /**
   * Builds the inventory list: every resource of the mine, its picture, its name and its quantity.
   *
   * @returns {void}
   */
  renderInventory() {
    this.inventoryList.textContent = '';
    const counts = this.state?.resources ?? {};
    const entries = this.resources.map((resource) => ({
      resource,
      count: counts[resource.slug] ?? 0,
    }));

    this.inventoryEmpty.hidden = entries.some(({ count }) => count > 0);

    entries.forEach(({ resource, count }) => {
      const item = document.createElement('li');
      item.className = 'mineblock__inventory-item';
      item.dataset.resource = resource.slug;

      const icon = document.createElement('img');
      icon.className = 'mineblock__inventory-item-icon';
      icon.src = resource.texture;
      icon.alt = '';
      icon.decoding = 'async';
      icon.addEventListener('error', () => {
        icon.hidden = true;
      });

      const name = document.createElement('span');
      name.className = 'mineblock__inventory-item-name';
      name.textContent = this.resolveResourceLabel(resource);

      const value = document.createElement('span');
      value.className = 'mineblock__inventory-item-value';
      value.textContent = String(count);

      item.append(icon, name, value);
      this.inventoryList.appendChild(item);
    });
  }

  /**
   * Draws a still frame of the chest, so the animated file is NOT animating the rest of the time.
   *
   * The chest is an animated webp: the browser plays it as soon as it is displayed. The first frame
   * is therefore decoded once, painted on a canvas and kept as a data URL, which becomes the
   * picture of the button. `playChest()` then swaps the animated file back in for one play.
   *
   * A failure leaves the button on the animated file: the chest then simply moves all the time,
   * which is a cosmetic regression, never a broken control.
   *
   * @returns {Promise<void>} Resolves once the still frame is on the button (or has failed).
   */
  async freezeChest() {
    if (typeof Image !== 'function') return;
    try {
      const image = new Image();
      image.src = CHEST_TEXTURE;
      await (typeof image.decode === 'function'
        ? image.decode()
        : new Promise((resolve, reject) => {
            image.addEventListener('load', () => resolve());
            image.addEventListener('error', () => reject(new Error('The chest could not be loaded.')));
          }));

      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext('2d')?.drawImage(image, 0, 0);
      this.chestStillFrame = canvas.toDataURL('image/png');
      if (!this.chestTimer) this.inventoryIcon.src = this.chestStillFrame;
    } catch (error) {
      console.warn('[MineBlockView] The chest could not be frozen on its first frame.', error);
    }
  }

  /**
   * Plays the chest once: the animated file is displayed for `CHEST_PLAY_MS`, then the still frame
   * replaces it. A second click restarts the animation instead of piling the timers up.
   *
   * @returns {void}
   */
  playChest() {
    if (!this.chestStillFrame) return;
    if (this.chestTimer) window.clearTimeout(this.chestTimer);
    // No cache-busting query: the still frame is a data URL, so pointing the picture back at the
    // file IS a change of source, which is all the browser needs to replay the animation from its
    // first frame (and it keeps the service worker's cache on one single URL for the chest).
    this.inventoryIcon.src = CHEST_TEXTURE;
    this.chestTimer = window.setTimeout(() => {
      this.chestTimer = null;
      this.inventoryIcon.src = this.chestStillFrame;
    }, CHEST_PLAY_MS);
  }

  /**
   * Keeps the countdown to the next reset up to date, and follows the UTC day change.
   *
   * The allowance rolls over at midnight UTC, exactly like the daily boosters: while the page stays
   * open, the trusted day carried by the tick is what announces it (the same trigger as the Mine
   * Pick counter of the header). A placeholder tick, emitted before the first synchronization,
   * carries an estimated date and must not be mistaken for a real day change.
   *
   * @param {{utc?: Date, formatted?: string, timeUntilReset?: string}|null} payload - Clock tick.
   * @returns {void}
   */
  handleClockTick(payload) {
    if (!payload || typeof payload.timeUntilReset !== 'string') return;
    if (!this.countdownElement.hidden) {
      this.countdownValue.textContent = payload.timeUntilReset;
    }
    if (!(payload.utc instanceof Date) || payload.formatted === '--:--:--') return;
    const day = payload.utc.toISOString().slice(0, 10);
    if (this.state?.day && day !== this.state.day) {
      this.log(`New UTC day (${day}): reloading the mine.`);
      this.state = null;
      void this.reload().catch((error) => {
        console.warn('[MineBlockView] The new day could not be loaded.', error);
      });
    }
  }

  /**
   * Reloads the mine when the view becomes active (the day, or the state, may have changed).
   *
   * @returns {void}
   */
  handleViewActivated() {
    this.isActive = true;
    this.log('View activated.');
    void this.reload().catch((error) => {
      console.error('[MineBlockView] The mine could not be reloaded.', error);
      this.setFeedback('mineblock.error.load', 'error');
    });
  }

  /**
   * Marks the view as inactive: the sequences in flight are cancelled and the dialogs closed.
   *
   * @returns {void}
   */
  handleViewDeactivated() {
    this.isActive = false;
    this.log('View deactivated.');
    this.clearTimers();
    this.closeModal();
    this.burstElement.textContent = '';
    this.rockElement.classList.remove('is-hit', 'is-broken', 'is-arriving');
  }

  /**
   * Re-translates the labels and the block name when the language changes.
   *
   * @returns {void}
   */
  handleLanguageChanged() {
    this.log(`Language changed, re-rendering (${i18n.getLang()}).`);
    void this.reload().catch((error) => {
      console.warn('[MineBlockView] The mine could not be re-rendered.', error);
    });
    if (this.feedback) {
      this.setFeedback(this.feedback.key, this.feedback.tone, this.feedback.params);
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
    this.feedback = key ? { key, tone, params } : null;
    if (!this.feedbackElement) return;
    if (!key) {
      this.feedbackElement.hidden = true;
      this.feedbackElement.textContent = '';
      return;
    }
    this.feedbackElement.textContent = i18n.t(key, params);
    this.feedbackElement.dataset.tone = tone;
    this.feedbackElement.hidden = false;
  }

  /**
   * Removes every listener, timer and flying element.
   *
   * @returns {void}
   */
  destroy() {
    this.log('Destroying the view.');
    this.clearTimers();
    if (this.chestTimer) window.clearTimeout(this.chestTimer);
    this.chestTimer = null;
    this.bindings.forEach(({ target, type, handler }) => target.removeEventListener(type, handler));
    this.bindings = [];
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
    this.state = null;
    this.displayedTexture = null;
    this.isInitialized = false;
  }
}

export default MineBlockView;
