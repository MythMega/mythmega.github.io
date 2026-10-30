/**
 * DailyRewardPopup - The board of the daily connection rewards.
 *
 * Reference: `js/business/DailyRewardManager.js` (the data, the run and the claim) and
 * `css/components/daily-reward.css` (the look and the claim animations).
 *
 * The dialog is appended to `<body>`: it opens from the header button as well as by itself after a
 * booster opening, whatever view the player is on. It carries the `modal` class so the shared
 * interface sounds of `js/utils/UiSounds.js` play on open and close for free, and it is built once:
 * a second opening re-renders the board instead of mounting a second dialog.
 *
 * THE BOARD
 * One tile per day of the chapter: the day number, the texture of its reward, an aura for the
 * rewards that deserve one (gold for a booster and the Void Dust, pink for the Ultima and a card),
 * a check for a day already claimed and a ring for the day of today. Clicking a tile PREVIEWS that
 * day in the line under the board; the "claim" button only acts on the day of today.
 *
 * THE CLAIM
 * A reward is granted by the manager, never here. This class only decides what to show: the
 * extension picker when a booster could go to several sets, then the animation of the kind granted
 * (a puff for an item, a shake for a booster, a flip for a card) before the board is redrawn.
 */

import dailyRewardManager, {
  DAILY_REWARD_AURAS,
  DAILY_REWARD_ERRORS,
  DAILY_REWARD_KINDS,
  DailyRewardManager,
} from '../../business/DailyRewardManager.js';
import eventBus, { EVENTS } from '../../utils/EventBus.js';
import i18n from '../../utils/I18n.js';
import soundManager, { UI_SOUNDS } from '../../utils/SoundManager.js';
import { themeIcon } from '../../utils/ThemeIcons.js';
import { applyCardGlow, clearCardGlow } from '../../utils/Shine.js';
import { getRarityLabel } from '../../classes/Card.js';
import Toast from './Toast.js';

/** Class of the overlay, which is also a `.modal` for the shared dialog sounds. */
export const DAILY_REWARD_CLASS = 'daily-reward';

/** How long one claim animation runs before the board is redrawn, in milliseconds. */
const CLAIM_ANIMATION_MS = 1700;

export class DailyRewardPopup {
  constructor() {
    /** @type {HTMLElement|null} Overlay. */
    this.root = null;
    /** @type {object|null} Last rendered snapshot. */
    this.snapshot = null;
    /** @type {number|null} Day previewed under the board (1-based). */
    this.selectedDay = null;
    /** @type {boolean} True while a claim is being written. */
    this.isBusy = false;
    /** @type {number|null} Pending timer of the claim animation. */
    this.timer = null;
    /** @type {Element|null} Element focused before the dialog opened. */
    this.previousFocus = null;
    /** @type {Array<{setId: string, name: string}>|null} Cached booster choices of the open dialog. */
    this.boosterChoices = null;
    /** @type {string|null} Extension picked for the booster of today, if any. */
    this.pendingSetId = null;
    /** @type {boolean} True once the markup exists. */
    this.mounted = false;
    /** @type {Function[]} */
    this.unsubscribers = [
      eventBus.on(EVENTS.DAILY_REWARDS_UPDATED, (payload) => this.handleUpdated(payload?.snapshot)),
      eventBus.on(EVENTS.LANG_CHANGED, () => this.handleLanguageChanged()),
      // The pack of the board is a single-ink PNG that ships in two inks (`ThemeIcons`): the board is
      // rebuilt on a theme change, exactly like it is on a language change.
      eventBus.on(EVENTS.THEME_CHANGED, () => this.handleThemeChanged()),
      // A new account means a new run: the board must never show the progress of the previous one.
      eventBus.on(EVENTS.ACCOUNT_REMOVED, () => this.clear()),
      eventBus.on(EVENTS.SAVE_IMPORTED, () => this.clear()),
    ];
    /** @type {(event: KeyboardEvent) => void} Escape handler, bound once. */
    this.handleKeyDown = (event) => {
      if (event.key === 'Escape' && this.isOpen()) {
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
    console.info('[DailyRewardPopup]', ...args);
  }

  /**
   * Tells whether the dialog is on screen.
   *
   * @returns {boolean} True when it is open.
   */
  isOpen() {
    return Boolean(this.root) && this.root.hidden === false;
  }

  /**
   * Opens the dialog and remembers that today's offer was seen.
   *
   * @param {object} [options] - Open options.
   * @param {boolean} [options.announce=true] - Marks the day as seen (the automatic offer then stays
   *   quiet until tomorrow). False for a refresh of an already open dialog.
   * @returns {Promise<void>} Resolves once the board is displayed.
   */
  async open({ announce = true } = {}) {
    this.ensureMarkup();
    if (!this.isOpen()) {
      this.previousFocus = document.activeElement;
      this.root.hidden = false;
      document.addEventListener('keydown', this.handleKeyDown);
    }

    try {
      this.snapshot = await dailyRewardManager.getSnapshot();
    } catch (error) {
      console.error('[DailyRewardPopup] The daily rewards could not be read.', error);
      Toast.error('daily.error.load');
      this.close();
      return;
    }

    this.boosterChoices = null;
    this.pendingSetId = null;
    this.selectedDay = this.snapshot.claimable ? this.snapshot.dayNumber : null;
    this.render();

    if (announce) void dailyRewardManager.markSeen();
    this.root.querySelector('[data-daily-reward-close]')?.focus();
    this.log(`Board displayed (status: ${this.snapshot.status}, day ${this.snapshot.dayNumber}).`);
  }

  /**
   * Hides the dialog and gives the focus back.
   *
   * @returns {void}
   */
  close() {
    if (!this.root) return;
    this.root.hidden = true;
    document.removeEventListener('keydown', this.handleKeyDown);
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.previousFocus instanceof HTMLElement && this.previousFocus.isConnected) {
      this.previousFocus.focus();
    }
    this.previousFocus = null;
    this.isBusy = false;
  }

  /**
   * Forgets the board (full reset, imported save, new account).
   *
   * @returns {void}
   */
  clear() {
    this.snapshot = null;
    this.selectedDay = null;
    this.boosterChoices = null;
    this.pendingSetId = null;
    dailyRewardManager.reset();
    this.close();
  }

  /**
   * Opens the dialog only when the automatic offer is due.
   *
   * Called after a booster opening: the request is "the board shows up by itself once the player has
   * opened a pack that day, unless it was already read".
   *
   * @returns {Promise<boolean>} True when the dialog was opened.
   */
  async openIfDue() {
    if (this.isOpen()) return false;
    if (!(await dailyRewardManager.isPopupDue())) return false;
    await this.open();
    return true;
  }

  /**
   * Creates the shell of the dialog once.
   *
   * @returns {void}
   */
  ensureMarkup() {
    if (this.mounted && this.root) return;

    const root = document.createElement('div');
    root.className = `modal ${DAILY_REWARD_CLASS}`;
    root.hidden = true;
    root.dataset.dailyReward = '';
    root.addEventListener('click', (event) => {
      if (event.target === root) this.close();
    });

    const dialog = document.createElement('div');
    dialog.className = `modal__dialog ${DAILY_REWARD_CLASS}__dialog`;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'daily-reward-title');

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'modal__close';
    closeButton.dataset.dailyRewardClose = '';
    closeButton.textContent = '×';
    closeButton.addEventListener('click', () => this.close());

    const badge = document.createElement('p');
    badge.className = `${DAILY_REWARD_CLASS}__badge`;

    const title = document.createElement('h2');
    title.className = 'modal__title';
    title.id = 'daily-reward-title';
    title.dataset.dailyRewardTitle = '';

    const subtitle = document.createElement('p');
    subtitle.className = `${DAILY_REWARD_CLASS}__subtitle`;
    subtitle.dataset.dailyRewardSubtitle = '';

    const progress = document.createElement('div');
    progress.className = `${DAILY_REWARD_CLASS}__progress`;
    const progressFill = document.createElement('span');
    progressFill.className = `${DAILY_REWARD_CLASS}__progress-fill`;
    progressFill.dataset.dailyRewardProgress = '';
    progress.append(progressFill);

    const days = document.createElement('ul');
    days.className = `${DAILY_REWARD_CLASS}__days`;
    days.dataset.dailyRewardDays = '';
    days.addEventListener('click', (event) => this.handleBoardClick(event));

    const detail = document.createElement('div');
    detail.className = `${DAILY_REWARD_CLASS}__detail`;
    detail.dataset.dailyRewardDetail = '';
    detail.addEventListener('click', (event) => this.handleSetChoice(event));

    const gain = document.createElement('div');
    gain.className = `${DAILY_REWARD_CLASS}__gain`;
    gain.dataset.dailyRewardGain = '';
    gain.hidden = true;
    gain.setAttribute('aria-hidden', 'true');
    const gainImage = document.createElement('img');
    gainImage.className = `${DAILY_REWARD_CLASS}__gain-image`;
    gainImage.dataset.dailyRewardGainImage = '';
    gainImage.alt = '';
    const gainLabel = document.createElement('p');
    gainLabel.className = `${DAILY_REWARD_CLASS}__gain-label`;
    gainLabel.dataset.dailyRewardGainLabel = '';
    gain.append(gainImage, gainLabel);

    const actions = document.createElement('div');
    actions.className = 'modal__actions';
    const claimButton = document.createElement('button');
    claimButton.type = 'button';
    claimButton.className = 'btn btn--primary';
    claimButton.dataset.dailyRewardClaim = '';
    claimButton.addEventListener('click', () => void this.handleClaim());
    const closeAction = document.createElement('button');
    closeAction.type = 'button';
    closeAction.className = 'btn btn--ghost';
    closeAction.textContent = i18n.t('daily.close');
    closeAction.addEventListener('click', () => this.close());
    actions.append(closeAction, claimButton);

    dialog.append(closeButton, badge, title, subtitle, progress, days, detail, gain, actions);
    root.append(dialog);
    document.body.append(root);

    this.root = root;
    this.mounted = true;
  }

  /**
   * Writes the last snapshot into the dialog.
   *
   * @returns {void}
   */
  render() {
    if (!this.root || !this.snapshot) return;
    const snapshot = this.snapshot;

    const badge = this.root.querySelector(`.${DAILY_REWARD_CLASS}__badge`);
    const title = this.root.querySelector('[data-daily-reward-title]');
    const subtitle = this.root.querySelector('[data-daily-reward-subtitle]');
    const fill = this.root.querySelector('[data-daily-reward-progress]');
    const claimButton = this.root.querySelector('[data-daily-reward-claim]');

    if (badge) badge.textContent = i18n.t('daily.badge');
    if (title) title.textContent = snapshot.chapter?.name ?? i18n.t('daily.titleFallback');

    if (subtitle) {
      if (!snapshot.trusted) {
        subtitle.textContent = i18n.t('daily.untrusted');
      } else if (snapshot.status === 'upcoming' && snapshot.chapter) {
        subtitle.textContent = i18n.t('daily.upcoming', { date: this.formatDay(snapshot.chapter.start) });
      } else if (!snapshot.chapter) {
        subtitle.textContent = i18n.t('daily.empty');
      } else if (snapshot.claimedToday) {
        subtitle.textContent = i18n.t('daily.claimedToday');
      } else {
        subtitle.textContent = i18n.t('daily.subtitle', {
          day: snapshot.dayNumber,
          total: snapshot.totalDays,
          count: snapshot.claimableDays,
          date: this.formatDay(snapshot.chapter.end),
        });
      }
    }

    if (fill) {
      const percent = snapshot.totalDays > 0
        ? Math.round((Math.min(snapshot.progress, snapshot.totalDays) / snapshot.totalDays) * 100)
        : 0;
      fill.style.width = `${percent}%`;
    }

    this.renderDays();
    this.renderDetail();

    if (claimButton) {
      const selected = this.getSelectedDayInfo();
      const isToday = snapshot.claimable && this.selectedDay === snapshot.dayNumber;
      // The extensions of a booster are a question, not a default: while the picker is on screen
      // the only thing left to do is to answer it.
      const needsChoice = this.needsSetChoice();
      claimButton.textContent = needsChoice ? i18n.t('daily.booster.choose') : i18n.t('daily.claim');
      claimButton.disabled =
        this.isBusy || !isToday || needsChoice || selected?.unavailable === true;
      claimButton.hidden = snapshot.status !== 'active';
    }
  }

  /**
   * Draws one tile per day of the chapter.
   *
   * @returns {void}
   */
  renderDays() {
    const list = this.root?.querySelector('[data-daily-reward-days]');
    if (!list || !this.snapshot) return;
    list.textContent = '';

    this.snapshot.days.forEach((day) => {
      const item = document.createElement('li');
      item.className = `${DAILY_REWARD_CLASS}__day`;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = `${DAILY_REWARD_CLASS}__day-button`;
      button.dataset.dailyRewardDay = String(day.day);
      button.dataset.state = day.state;
      if (this.selectedDay === day.day) button.dataset.selected = 'true';

      const number = document.createElement('span');
      number.className = `${DAILY_REWARD_CLASS}__day-number`;
      number.textContent = String(day.day);

      button.append(number);

      if (day.icon) {
        const icon = document.createElement('img');
        // The two rewards that are drawn rather than spelled (a card printing, the artwork of a pack)
        // keep their own proportions instead of the square of a pictogram: the tile is then read as
        // "a card" or "a pack" before the player reads anything.
        icon.className = `${DAILY_REWARD_CLASS}__day-icon`;
        if (day.reward?.kind === DAILY_REWARD_KINDS.CARD) {
          icon.classList.add(`${DAILY_REWARD_CLASS}__day-icon--card`);
        }
        if (day.reward?.kind === DAILY_REWARD_KINDS.BOOSTER) {
          icon.classList.add(`${DAILY_REWARD_CLASS}__day-icon--booster`);
        }
        // The icon of a reward is an interface glyph (white on the dark palettes for the pack), and a
        // card illustration still carries the `<lang>` placeholder of the catalogue.
        icon.src = i18n.resolveImagePath(themeIcon(day.icon));
        icon.alt = '';
        icon.loading = 'lazy';
        icon.decoding = 'async';
        icon.setAttribute('aria-hidden', 'true');
        button.append(icon);
      }

      if (day.state === 'claimed') {
        const check = document.createElement('span');
        check.className = `${DAILY_REWARD_CLASS}__day-check`;
        check.textContent = '✓';
        check.setAttribute('aria-hidden', 'true');
        button.append(check);
      }

      const aura = day.aura === DAILY_REWARD_AURAS.GOLD || day.aura === DAILY_REWARD_AURAS.PINK
        ? day.aura
        : null;
      if (aura) button.dataset.aura = aura;

      button.setAttribute('aria-label', this.describeEntryLabel(day));
      button.title = button.getAttribute('aria-label');

      item.append(button);
      list.append(item);
    });
  }

  /**
   * Writes the preview of the selected day under the board.
   *
   * @returns {void}
   */
  renderDetail() {
    const detail = this.root?.querySelector('[data-daily-reward-detail]');
    if (!detail || !this.snapshot) return;
    detail.textContent = '';

    const day = this.getSelectedDayInfo();
    if (!day) return;

    const head = document.createElement('p');
    head.className = `${DAILY_REWARD_CLASS}__detail-title`;
    head.textContent = day.label;
    detail.append(head);

    const reward = document.createElement('p');
    reward.className = `${DAILY_REWARD_CLASS}__detail-reward`;
    reward.textContent = this.describeReward(day);
    detail.append(reward);

    const state = document.createElement('p');
    state.className = `${DAILY_REWARD_CLASS}__detail-state`;
    state.dataset.state = day.state;
    state.textContent = day.unavailable
      ? i18n.t('daily.state.unavailable')
      : day.state === 'claimed'
        ? i18n.t('daily.state.claimed')
        : day.state === 'current'
          ? i18n.t('daily.state.current')
          : i18n.t('daily.state.locked');
    detail.append(state);

    // The booster picker: shown only for the reward of today, only when the file gives one and only
    // when several extensions could receive it. One choice is not a question worth asking.
    if (day.state === 'current' && this.boosterChoices && this.boosterChoices.length > 1) {
      const block = document.createElement('div');
      block.className = `${DAILY_REWARD_CLASS}__sets`;
      const hint = document.createElement('p');
      hint.className = `${DAILY_REWARD_CLASS}__sets-hint`;
      hint.textContent = i18n.t('daily.booster.pick');
      block.append(hint);
      const group = document.createElement('div');
      group.className = `${DAILY_REWARD_CLASS}__sets-row`;
      this.boosterChoices.forEach((choice) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn--ghost';
        button.dataset.dailyRewardSet = choice.setId;
        button.textContent = choice.name;
        group.append(button);
      });
      block.append(group);
      detail.append(block);
    }
  }

  /**
   * Returns the snapshot of the previewed day, with its label.
   *
   * @returns {object|null} The day entry, or null when the board is empty.
   */
  getSelectedDayInfo() {
    if (!this.snapshot || this.snapshot.days.length === 0) return null;
    const day = this.snapshot.days.find((entry) => entry.day === this.selectedDay);
    if (!day) return null;
    return {
      ...day,
      label: i18n.t('daily.day', { day: day.day, total: this.snapshot.totalDays }),
    };
  }

  /**
   * Selects a day of the board.
   *
   * @param {Event} event - Click event of the board.
   * @returns {void}
   */
  handleBoardClick(event) {
    const button = event.target instanceof Element
      ? event.target.closest('[data-daily-reward-day]')
      : null;
    if (!button) return;
    const day = Number(button.dataset.dailyRewardDay);
    if (!Number.isInteger(day) || day === this.selectedDay) {
      // A second tap on a booster reward opens the extension picker: that is the only way to learn
      // which sets can receive it.
      if (Number.isInteger(day) && this.isSelectedBooster(day)) void this.prepareBoosterChoice(day);
      return;
    }
    this.selectedDay = day;
    soundManager.playUi(UI_SOUNDS.REVEAL_STEP);
    this.render();
  }

  /**
   * Tells whether the claim still waits for the player to pick an extension.
   *
   * @returns {boolean} True when the booster of today could go to several sets.
   */
  needsSetChoice() {
    return Boolean(this.boosterChoices) && this.boosterChoices.length > 1 && !this.pendingSetId;
  }

  /**
   * Tells whether the previewed day is a booster reward of today.
   *
   * @param {number} day - 1-based day.
   * @returns {boolean} True when the day is today's, claimable, and gives a booster.
   */
  isSelectedBooster(day) {
    const snapshot = this.snapshot;
    if (!snapshot || snapshot.claimedToday) return false;
    if (day !== snapshot.dayNumber) return false;
    return snapshot.current?.reward?.kind === DAILY_REWARD_KINDS.BOOSTER;
  }

  /**
   * Loads the released extensions a booster reward can be spent on.
   *
   * @param {number} day - Day whose reward is being claimed.
   * @returns {Promise<void>} Resolves once the picker is on screen.
   */
  async prepareBoosterChoice(day) {
    this.selectedDay = day;
    if (!this.boosterChoices) {
      try {
        this.boosterChoices = await dailyRewardManager.getBoosterChoices();
      } catch (error) {
        console.error('[DailyRewardPopup] The released extensions could not be read.', error);
        this.boosterChoices = [];
      }
    }
    if (this.boosterChoices.length <= 1) {
      // One extension is not a choice: the claim picks it on its own.
      await this.handleClaim();
      return;
    }
    this.render();
  }

  /**
   * Claims the reward of today, asking for the extension of a booster when needed.
   *
   * @returns {Promise<void>} Resolves once the flow finished (success or failure).
   */
  async handleClaim() {
    if (!this.snapshot || this.isBusy) return;
    const snapshot = this.snapshot;
    if (!snapshot.claimable) return;

    // A booster reward first asks which extension receives the pack, and asking is the whole
    // point: the claim waits for `handleSetChoice()` once the question is on screen.
    if (snapshot.current?.reward?.kind === DAILY_REWARD_KINDS.BOOSTER && !this.boosterChoices) {
      await this.prepareBoosterChoice(snapshot.dayNumber);
      return;
    }
    if (this.needsSetChoice()) return;

    const setId = this.pendingSetId;
    this.isBusy = true;
    const claimButton = this.root?.querySelector('[data-daily-reward-claim]');
    if (claimButton) claimButton.disabled = true;

    try {
      const result = await dailyRewardManager.claim({ setId });
      this.snapshot = result.snapshot;
      this.selectedDay = result.snapshot.claimable ? result.snapshot.dayNumber : result.snapshot.progress;
      this.boosterChoices = null;
      this.pendingSetId = null;
      this.showGain(result);
    } catch (error) {
      console.error('[DailyRewardPopup] The daily reward could not be claimed.', error);
      Toast.error(DailyRewardPopup.errorKey(error));
      this.isBusy = false;
      this.render();
    }
  }

  /**
   * Maps a claim failure to a translation key.
   *
   * @param {unknown} error - Error thrown by the manager.
   * @returns {string} The key the toast displays.
   */
  static errorKey(error) {
    switch (error?.code) {
      case DAILY_REWARD_ERRORS.ALREADY_CLAIMED:
        return 'daily.error.alreadyClaimed';
      case DAILY_REWARD_ERRORS.NOT_TRUSTED:
        return 'daily.error.untrusted';
      case DAILY_REWARD_ERRORS.CONTENT_NOT_RELEASED:
        return 'daily.error.notReleased';
      case DAILY_REWARD_ERRORS.NO_SET:
      case DAILY_REWARD_ERRORS.SET_REQUIRED:
        return 'daily.error.noSet';
      default:
        return 'daily.error.claim';
    }
  }

  /**
   * Claims the booster reward on the extension the player just picked.
   *
   * @param {Event} event - Click event of the details area.
   * @returns {void}
   */
  handleSetChoice(event) {
    const button = event.target instanceof Element
      ? event.target.closest('[data-daily-reward-set]')
      : null;
    if (!button || this.isBusy) return;
    const setId = button.dataset.dailyRewardSet;
    if (!setId) return;
    this.pendingSetId = setId;
    soundManager.playUi(UI_SOUNDS.SECTION_SWITCH);
    void this.handleClaim();
  }

  /**
   * Plays the animation of the reward just granted, then redraws the board.
   *
   * @param {object} result - Return value of `DailyRewardManager.claim()`.
   * @returns {void}
   */
  showGain(result) {
    if (!this.root) return;
    const gain = this.root.querySelector('[data-daily-reward-gain]');
    const image = this.root.querySelector('[data-daily-reward-gain-image]');
    const label = this.root.querySelector('[data-daily-reward-gain-label]');

    const kind = result.kind === DAILY_REWARD_KINDS.CARD
      ? 'card'
      : result.kind === DAILY_REWARD_KINDS.BOOSTER
        ? 'booster'
        : 'item';
    const icon = DailyRewardManager.iconOf(result.reward, result.card);

    if (gain && image && label) {
      clearCardGlow(gain);
      gain.className = `${DAILY_REWARD_CLASS}__gain ${DAILY_REWARD_CLASS}__gain--${kind}`;
      gain.dataset.dailyRewardGain = '';
      if (result.card) applyCardGlow(gain, result.card);
      image.src = icon === '' ? '' : i18n.resolveImagePath(themeIcon(icon));
      image.alt = '';
      image.hidden = icon === '';
      label.textContent = this.describeResult(result);
      gain.hidden = false;
      // Re-reading the class restarts the animation when two rewards are claimed in a row (a new
      // day, a second claim after a reload): an animation already running is never replayed.
      void gain.offsetWidth;
      gain.classList.add('is-active');
    }

    soundManager.playUi(UI_SOUNDS.NOTIFICATION_SHOW);
    this.log(`Reward claimed (${result.kind} ×${result.quantity}).`);

    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      if (gain) {
        gain.classList.remove('is-active');
        gain.hidden = true;
      }
      this.isBusy = false;
      this.render();
    }, CLAIM_ANIMATION_MS);
  }

  /**
   * Sentence describing what was granted, for the animation.
   *
   * @param {object} result - Return value of the claim.
   * @returns {string} The sentence.
   */
  describeResult(result) {
    if (result.kind === DAILY_REWARD_KINDS.CARD && result.card) {
      return i18n.t('daily.gain.card', {
        name: result.card.getName(i18n.getLang()),
        rarity: getRarityLabel(result.card.rarity, (key) => i18n.t(key)),
      });
    }
    if (result.kind === DAILY_REWARD_KINDS.BOOSTER) {
      return i18n.t('daily.gain.booster', { count: result.quantity, set: result.setId ?? '' });
    }
    if (result.kind === DAILY_REWARD_KINDS.RESOURCE) {
      return i18n.t('daily.reward.resource', {
        count: result.quantity,
        name: i18n.t(`mineblock.resource.${result.reward.slug}`),
      });
    }
    return i18n.t('daily.reward.sparks', { count: result.quantity });
  }

  /**
   * Describes a day of the board in one sentence (used for the tooltip and the accessible name).
   *
   * @param {object} day - Day entry of the snapshot.
   * @returns {string} The sentence.
   */
  describeEntryLabel(day) {
    return `${i18n.t('daily.day', { day: day.day, total: this.snapshot?.totalDays ?? 0 })} · ${this.describeReward(day)}`;
  }

  /**
   * Describes the reward of a day.
   *
   * @param {object} day - Day entry of the snapshot.
   * @returns {string} The sentence.
   */
  describeReward(day) {
    const reward = day.reward;
    if (!reward) return i18n.t('daily.reward.unknown');
    switch (reward.kind) {
      case DAILY_REWARD_KINDS.SPARKS:
        return i18n.t('daily.reward.sparks', { count: reward.quantity });
      case DAILY_REWARD_KINDS.RESOURCE:
        return i18n.t('daily.reward.resource', {
          count: reward.quantity,
          name: i18n.t(`mineblock.resource.${reward.slug}`),
        });
      case DAILY_REWARD_KINDS.BOOSTER:
        return i18n.t('daily.reward.booster', { count: reward.quantity });
      case DAILY_REWARD_KINDS.CARD:
        if (!day.card) return i18n.t('daily.reward.cardUnknown', { index: reward.cardId });
        return i18n.t('daily.reward.card', {
          name: day.card.getName(i18n.getLang()),
          rarity: getRarityLabel(day.card.rarity, (key) => i18n.t(key)),
        });
      default:
        return i18n.t('daily.reward.unknown');
    }
  }

  /**
   * Formats a `YYYY-MM-DD` day the way the active language writes dates.
   *
   * @param {string|null} day - The day.
   * @returns {string} The formatted day (the raw value when it cannot be parsed).
   */
  formatDay(day) {
    if (typeof day !== 'string') return '';
    const time = Date.parse(`${day}T00:00:00.000Z`);
    if (!Number.isFinite(time)) return day;
    try {
      return new Intl.DateTimeFormat(i18n.getLang(), { day: 'numeric', month: 'long' }).format(
        new Date(time)
      );
    } catch (error) {
      console.warn('[DailyRewardPopup] The date could not be formatted.', error);
      return day;
    }
  }

  /**
   * Repaints the board when a claim happened elsewhere (another tab, the settings screen).
   *
   * @param {object|null} snapshot - Snapshot carried by the event.
   * @returns {void}
   */
  handleUpdated(snapshot) {
    if (!this.isOpen()) return;
    if (snapshot) this.snapshot = snapshot;
    this.render();
  }

  /**
   * Re-renders the open board in the new language.
   *
   * @returns {void}
   */
  handleLanguageChanged() {
    if (this.isOpen()) this.render();
  }

  /**
   * Repaints the open board in the new palette.
   *
   * The snapshot holds catalogue paths, not the paths of the files being drawn, so a redraw is all a
   * theme change needs: every tile re-asks `themeIcon()` and lands on the right twin.
   *
   * @returns {void}
   */
  handleThemeChanged() {
    if (this.isOpen()) this.render();
  }

  /**
   * Releases the subscriptions and removes the dialog.
   *
   * @returns {void}
   */
  destroy() {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
    document.removeEventListener('keydown', this.handleKeyDown);
    this.root?.remove();
    this.root = null;
    this.mounted = false;
    this.snapshot = null;
  }
}

/** Shared instance used by the application bootstrap. */
export const dailyRewardPopup = new DailyRewardPopup();

export default dailyRewardPopup;
