/**
 * StatsView - Booster count, completion, rarity distribution, most drawn card, Wonder Pick
 * counters and the last openings.
 *
 * Reference: `.docs/steps/5.md` point 3. Reads `user_state["stats"]`, `user_state["boosterHistory"]`,
 * `user_state["wonderPick"]` (through `WonderPickManager`) and the collection (via
 * `CollectionManager`). Only booster draws feed the opening counters: redeem/gift cards (steps 7 and
 * 8) and wonder-picked cards never touch `stats` — the Wonder Pick keeps its own counters, because a
 * pick is not an opened booster.
 *
 * HOSTED BY THE PROFILE
 *   These panels are no longer a destination of the bottom bar: they live under the profile
 *   (`[data-panel="stats"]`). `ProfileView` therefore owns the lifecycle — it calls `init()`,
 *   `handleViewActivated()` / `handleViewDeactivated()`, `handleLanguageChanged()` and `destroy()` —
 *   which is why this view does not listen to `VIEW_CHANGED` anymore. It still follows
 *   `LANG_CHANGED`, `BOOSTER_OPENED` and `WONDER_PICK_UPDATED` on its own.
 *
 * The history panel shows the last `boosters.historySize` (10) openings with their shareable
 * `minecards:` code, the trusted UTC date of the opening and the 5 cards: each thumbnail opens the
 * same kind of detail modal as the opening summary, and the code is copied on click.
 */

import eventBus, { EVENTS } from '../../utils/EventBus.js';
import i18n from '../../utils/I18n.js';
import collectionManager from '../../business/CollectionManager.js';
import boosterManager from '../../business/BoosterManager.js';
import { storageRepository, STORES } from '../../models/StorageRepository.js';
import { USER_STATE_KEYS } from '../../business/AccountManager.js';
import wonderPickManager from '../../business/WonderPickManager.js';
import { CARD_RARITY, getRarityLabel } from '../../classes/Card.js';
import { writeToClipboard } from '../../utils/Clipboard.js';
import Toast from '../components/Toast.js';

/** Panel attribute matching `[data-panel="stats"]` in `index.html` (inside the profile view). */
export const STATS_PANEL_SELECTOR = '[data-panel="stats"]';

/** Number of past openings displayed. */
export const STATS_HISTORY_SIZE = 10;

export class StatsView {
  /**
   * @param {HTMLElement} rootElement - The statistics block of the profile (`[data-panel="stats"]`).
   */
  constructor(rootElement) {
    if (!rootElement || typeof rootElement.querySelector !== 'function') {
      throw new TypeError('StatsView requires the stats section element.');
    }

    this.root = rootElement;
    this.feedbackElement = this.root.querySelector('[data-stats-feedback]');
    this.boostersElement = this.root.querySelector('[data-stats-boosters]');
    this.completionGlobalElement = this.root.querySelector('[data-stats-completion-global]');
    this.completionSetsElement = this.root.querySelector('[data-stats-completion-sets]');
    this.rarityElement = this.root.querySelector('[data-stats-rarity]');
    this.topElement = this.root.querySelector('[data-stats-top]');
    this.historyElement = this.root.querySelector('[data-stats-history]');
    this.historyEmptyElement = this.root.querySelector('[data-stats-history-empty]');
    this.cardModal = this.root.querySelector('[data-stats-modal]');
    this.cardModalTitle = this.root.querySelector('[data-stats-modal-title]');
    this.cardModalBody = this.root.querySelector('[data-stats-modal-body]');
    this.cardModalClose = this.root.querySelector('[data-stats-modal-close]');
    this.wonderSummaryElement = this.root.querySelector('[data-stats-wonder-summary]');
    this.wonderRarityElement = this.root.querySelector('[data-stats-wonder-rarity]');
    this.wonderRarestElement = this.root.querySelector('[data-stats-wonder-rarest]');
    this.wonderHistoryElement = this.root.querySelector('[data-stats-wonder-history]');

    /** @type {Array<{code: string|null, setId: string, openedAt: string|null, godpack: boolean, set: object|null, cards: Array}>} */
    this.historyEntries = [];
    /** @type {Array<{target: EventTarget, type: string, handler: EventListener}>} */
    this.bindings = [];

    this.assertMarkup();

    /** @type {boolean} True once `init()` bound everything. */
    this.isInitialized = false;
    /** @type {boolean} True when the view is the active one. */
    this.isActive = false;
    /** @type {boolean} True while the view is loading its data. */
    this.isLoading = false;

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
    console.info('[StatsView]', ...args);
  }

  /**
   * Verifies that the markup matches the contract expected by this view.
   *
   * @returns {void}
   * @throws {Error} When a required element is missing from `index.html`.
   */
  assertMarkup() {
    const missing = [
      ['[data-stats-boosters]', this.boostersElement],
      ['[data-stats-completion-global]', this.completionGlobalElement],
      ['[data-stats-completion-sets]', this.completionSetsElement],
      ['[data-stats-rarity]', this.rarityElement],
      ['[data-stats-top]', this.topElement],
      ['[data-stats-history]', this.historyElement],
      ['[data-stats-modal]', this.cardModal],
      ['[data-stats-modal-title]', this.cardModalTitle],
      ['[data-stats-modal-body]', this.cardModalBody],
      ['[data-stats-modal-close]', this.cardModalClose],
      ['[data-stats-wonder-summary]', this.wonderSummaryElement],
      ['[data-stats-wonder-rarity]', this.wonderRarityElement],
      ['[data-stats-wonder-history]', this.wonderHistoryElement],
    ]
      .filter(([, element]) => !element)
      .map(([selector]) => selector);

    if (missing.length > 0) {
      throw new Error(`StatsView markup is incomplete, missing: ${missing.join(', ')}.`);
    }
  }

  /**
   * Subscribes to the events and loads the first render.
   *
   * @returns {Promise<void>} Resolves once the first render finished.
   */
  async init() {
    if (this.isInitialized) return;
    this.isInitialized = true;
    this.log('Initializing…');
    this.bindEvents();
    this.subscribeToEvents();
    await this.reload();
    this.log('Ready.');
  }

  /**
   * Registers a listener and remembers it for `destroy()`.
   *
   * @param {EventTarget} target - Event target.
   * @param {string} type - Event type.
   * @param {EventListener} handler - Listener.
   * @param {AddEventListenerOptions|boolean} [options=false] - Listener options.
   * @returns {void}
   */
  listen(target, type, handler, options = false) {
    target.addEventListener(type, handler, options);
    this.bindings.push({ target, type, handler, options });
  }

  /**
   * Attaches the DOM listeners of the history panel (delegated) and of the detail modal.
   *
   * @returns {void}
   */
  bindEvents() {
    this.listen(this.historyElement, 'click', (event) => this.handleHistoryClick(event));
    this.listen(this.cardModal, 'click', (event) => this.handleModalBackdropClick(event));
    this.listen(this.cardModalClose, 'click', () => this.closeCardModal());
    this.listen(document, 'keydown', (event) => this.handleDocumentKeyDown(event));
    this.log('DOM listeners bound.');
  }

  /**
   * Subscribes to the application events the view depends on.
   *
   * @returns {void}
   */
  subscribeToEvents() {
    this.unsubscribers.push(eventBus.on(EVENTS.LANG_CHANGED, () => this.handleLanguageChanged()));
    this.unsubscribers.push(eventBus.on(EVENTS.BOOSTER_OPENED, () => this.handleBoosterOpened()));
    // A wonder pick writes a card and its own counters: the dedicated panel follows it, but only
    // while the panels are displayed (the host reloads them on activation anyway).
    this.unsubscribers.push(
      eventBus.on(EVENTS.WONDER_PICK_UPDATED, () => {
        if (this.isActive) this.handleBoosterOpened();
      })
    );
    this.log('Event subscriptions registered.');
  }

  /**
   * Reloads the stats and the completion, then re-renders every panel.
   *
   * @returns {Promise<void>} Resolves once the view is rendered (or the error shown).
   */
  async reload() {
    if (this.isLoading) return;
    this.isLoading = true;
    this.setFeedback(null);
    this.log('Loading the statistics…');
    try {
      const stats = (await storageRepository.getItem(STORES.USER_STATE, USER_STATE_KEYS.STATS)) ?? {};
      const view = await collectionManager.getCollectionView();
      const history = await boosterManager.getBoosterHistory(STATS_HISTORY_SIZE);
      const wonder = await wonderPickManager.getState();
      this.renderBoosters(stats);
      this.renderCompletion(view);
      this.renderRarity(stats);
      this.renderTop(stats, view);
      this.renderWonder(wonder, view);
      this.renderHistory(history);
    } catch (error) {
      console.error('[StatsView] The statistics could not be loaded.', error);
      this.setFeedback('stats.error.load', 'error');
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Renders the booster counter.
   *
   * @param {object} stats - Raw `user_state["stats"]` value.
   * @returns {void}
   */
  renderBoosters(stats) {
    const count = Number.isFinite(stats?.boostersOpened) ? stats.boostersOpened : 0;
    this.boostersElement.textContent = String(Math.max(0, count));
  }

  /**
   * Renders the global completion line and one native bar per extension.
   *
   * @param {{completion: object, sets: object}} view - Collection view from the manager.
   * @returns {void}
   */
  renderCompletion(view) {
    const total = view?.completion?.total ?? 0;
    const owned = view?.completion?.owned ?? 0;
    if (total === 0) {
      this.completionGlobalElement.textContent = i18n.t('stats.completion.empty');
    } else {
      const percent = Math.round((owned / total) * 100);
      this.completionGlobalElement.textContent = i18n.t('stats.completion.global', { owned, total, percent });
    }

    this.completionSetsElement.textContent = '';
    Object.values(view?.sets ?? {})
      .sort((left, right) => String(left.name ?? left.setId).localeCompare(String(right.name ?? right.setId)))
      .forEach((set) => {
        this.completionSetsElement.appendChild(
          this.buildBar(set.name ?? set.setId, set.completion?.owned ?? 0, set.completion?.total ?? 0)
        );
      });
  }

  /**
   * Renders one native bar per rarity from `stats.drawsByRarity`.
   *
   * @param {object} stats - Raw `user_state["stats"]` value.
   * @returns {void}
   */
  renderRarity(stats) {
    const draws = stats?.drawsByRarity ?? {};
    const rarities = Array.from({ length: CARD_RARITY.MAX }, (_, index) => CARD_RARITY.MIN + index);
    const total = rarities.reduce((sum, rarity) => sum + (Number(draws[String(rarity)]) || 0), 0);
    this.rarityElement.textContent = '';
    if (total === 0) {
      this.rarityElement.textContent = i18n.t('stats.rarity.empty');
      return;
    }
    rarities.forEach((rarity) => {
      const count = Number(draws[String(rarity)]) || 0;
      const label = getRarityLabel(rarity, (key) => i18n.t(key));
      this.rarityElement.appendChild(this.buildBar(label, count, total));
    });
  }

  /**
   * Renders the most drawn card (name, illustration thumbnail, draw count).
   *
   * @param {object} stats - Raw `user_state["stats"]` value.
   * @param {{entries: object[]}} view - Collection view from the manager.
   * @returns {void}
   */
  renderTop(stats, view) {
    this.topElement.textContent = '';
    const drawsByCard = stats?.drawsByCard ?? {};
    const pairs = Object.entries(drawsByCard).filter(([, count]) => Number(count) > 0);
    if (pairs.length === 0) {
      this.topElement.textContent = i18n.t('stats.top.empty');
      return;
    }
    pairs.sort((left, right) => right[1] - left[1]);
    const [key, count] = pairs[0];
    const entry = (view?.entries ?? []).find((candidate) => candidate.key === key);

    const wrapper = document.createElement('div');
    wrapper.className = 'stats__top-card';

    if (entry?.card) {
      const image = document.createElement('img');
      image.className = 'stats__top-image';
      image.loading = 'lazy';
      image.src = i18n.resolveImagePath(entry.card.illustration);
      image.alt = entry.card.getName(i18n.getLang());
      image.addEventListener('error', () => {
        console.warn(`[StatsView] Top card illustration not found for "${key}": ${image.src}`);
        image.hidden = true;
      });
      wrapper.appendChild(image);
    }

    const name = document.createElement('p');
    name.className = 'stats__top-name';
    name.textContent = entry?.card?.getName(i18n.getLang()) ?? key;
    wrapper.appendChild(name);

    const draws = document.createElement('p');
    draws.className = 'stats__top-count';
    draws.textContent = i18n.t('collection.quantity', { count });
    wrapper.appendChild(draws);

    this.topElement.appendChild(wrapper);
    this.log(`Top card: "${key}" drawn ${count} time(s).`);
  }

  // __STATS_WONDER__

  /**
   * Renders the dedicated Wonder Pick counters.
   *
   * The feature has its own block on purpose: a picked card is not an opened booster, so it is
   * counted here (picks, distribution by rarity, best pick, last packs) and never in the opening
   * counters above.
   *
   * @param {object} state - State returned by `WonderPickManager.getState()`.
   * @param {{entries: object[]}} view - Collection view from the manager (resolves the card keys).
   * @returns {void}
   */
  renderWonder(state, view) {
    if (this.wonderSummaryElement) {
      this.wonderSummaryElement.textContent = i18n.t('stats.wonder.summary', {
        total: state?.totalPicks ?? 0,
        remaining: state?.remaining ?? 0,
        picksPerDay: state?.picksPerDay ?? 0,
      });
    }

    if (this.wonderRarityElement) {
      this.wonderRarityElement.textContent = '';
      const picks = state?.picksByRarity ?? {};
      const rarities = Array.from({ length: CARD_RARITY.MAX }, (_, index) => CARD_RARITY.MIN + index);
      const total = rarities.reduce((sum, rarity) => sum + (Number(picks[String(rarity)]) || 0), 0);
      if (total === 0) {
        this.wonderRarityElement.textContent = i18n.t('stats.wonder.rarity.empty');
      } else {
        rarities.forEach((rarity) => {
          const count = Number(picks[String(rarity)]) || 0;
          this.wonderRarityElement.appendChild(
            this.buildBar(getRarityLabel(rarity, (key) => i18n.t(key)), count, total)
          );
        });
      }
    }

    if (this.wonderRarestElement) {
      const rarest = this.resolveRarestPick(state, view);
      this.wonderRarestElement.textContent = rarest
        ? i18n.t('stats.wonder.rarest', {
            name: rarest.card.getName(i18n.getLang()),
            rarity: getRarityLabel(rarest.rarity, (key) => i18n.t(key)),
          })
        : i18n.t('stats.wonder.rarest.empty');
    }

    if (this.wonderHistoryElement) {
      this.wonderHistoryElement.textContent = '';
      const picks = Array.isArray(state?.history) ? state.history : [];
      if (picks.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'stats__line';
        empty.textContent = i18n.t('stats.wonder.history.empty');
        this.wonderHistoryElement.appendChild(empty);
      } else {
        picks.forEach((pick) => {
          this.wonderHistoryElement.appendChild(this.buildWonderEntry(pick, view));
        });
      }
    }

    this.log(`Wonder Pick: ${state?.totalPicks ?? 0} pick(s), ${state?.remaining ?? 0} left today.`);
  }

  /**
   * Finds the rarest card ever picked.
   *
   * @param {object} state - State returned by `WonderPickManager.getState()`.
   * @param {{entries: object[]}} view - Collection view from the manager.
   * @returns {{key: string, rarity: number, card: object, count: number}|null} The best pick.
   */
  resolveRarestPick(state, view) {
    const entries = Array.isArray(view?.entries) ? view.entries : [];
    let best = null;

    Object.entries(state?.picksByCard ?? {}).forEach(([key, count]) => {
      const entry = entries.find((candidate) => candidate.key === key);
      const rarity = entry?.card?.rarity ?? 0;
      if (!entry || rarity <= 0) return;
      if (!best || rarity > best.rarity) {
        best = { key, rarity, card: entry.card, count };
      }
    });
    return best;
  }

  /**
   * Builds one entry of the Wonder Pick history: the day, the extension, the kept card and its
   * illustration.
   *
   * Unlike the opening history these entries are not clickable (a pick has no shareable code and
   * only one card): the kept card is shown as a thumbnail next to the pack it came from.
   *
   * @param {{day: string|null, setId: string, setName: string|null, key: string, rarity: number,
   *   godpack: boolean}} pick - History entry written by `WonderPickManager`.
   * @param {{entries: object[]}} view - Collection view from the manager.
   * @returns {HTMLElement} The list item.
   */
  buildWonderEntry(pick, view) {
    const item = document.createElement('li');
    item.className = 'stats__history-entry';

    const head = document.createElement('div');
    head.className = 'stats__history-head';
    const meta = document.createElement('p');
    meta.className = 'stats__history-meta';
    const setName = document.createElement('span');
    setName.className = 'stats__history-set';
    setName.textContent = pick.setName ?? pick.setId;
    const date = document.createElement('time');
    date.className = 'stats__history-date';
    if (pick.pickedAt) date.setAttribute('datetime', pick.pickedAt);
    date.textContent = i18n.t('stats.history.date', {
      date: pick.day ?? StatsView.formatHistoryDate(pick.pickedAt),
    });
    meta.append(setName, date);
    head.appendChild(meta);
    if (pick.godpack) {
      const badge = document.createElement('span');
      badge.className = 'stats__history-badge';
      badge.textContent = i18n.t('stats.history.godpack');
      head.appendChild(badge);
    }
    item.appendChild(head);

    const entry = (view?.entries ?? []).find((candidate) => candidate.key === pick.key);
    const wrapper = document.createElement('div');
    wrapper.className = 'stats__wonder-pick';

    if (entry?.card) {
      const thumbnail = document.createElement('span');
      thumbnail.className = `stats__history-card stats__history-card--r${entry.card.rarity}`;
      if (entry.card.isFullArt) thumbnail.classList.add('stats__history-card--fullart');
      const image = document.createElement('img');
      image.className = 'stats__history-image';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.src = i18n.resolveImagePath(entry.card.illustration);
      image.alt = '';
      thumbnail.appendChild(image);
      wrapper.appendChild(thumbnail);
    }

    const name = document.createElement('p');
    name.className = 'stats__wonder-name';
    name.textContent = `${entry?.card?.getName(i18n.getLang()) ?? pick.key} — ${getRarityLabel(
      entry?.card?.rarity ?? pick.rarity,
      (key) => i18n.t(key)
    )}`;
    wrapper.appendChild(name);
    item.appendChild(wrapper);

    return item;
  }

  // __STATS_HISTORY__

  /**
   * Renders the last openings: code, date and the 5 cards of each pack.
   *
   * @param {Array<object>} entries - Entries returned by `BoosterManager.getBoosterHistory()`.
   * @returns {void}
   */
  renderHistory(entries) {
    const list = Array.isArray(entries) ? entries : [];
    this.historyEntries = list;
    this.closeCardModal();
    this.historyElement.textContent = '';
    if (this.historyEmptyElement) this.historyEmptyElement.hidden = list.length > 0;

    list.forEach((entry, index) => {
      this.historyElement.appendChild(this.buildHistoryEntry(entry, index));
    });
    this.log(`${list.length} past opening(s) rendered.`);
  }

  /**
   * Builds one history entry (`<li>`): metadata, shareable code and the card thumbnails.
   *
   * @param {object} entry - History entry (see `BoosterManager.getBoosterHistory()`).
   * @param {number} index - Index of the entry in `historyEntries`.
   * @returns {HTMLElement} The `<li>` element.
   */
  buildHistoryEntry(entry, index) {
    const item = document.createElement('li');
    item.className = 'stats__history-entry';

    const head = document.createElement('div');
    head.className = 'stats__history-head';

    const meta = document.createElement('p');
    meta.className = 'stats__history-meta';
    const setName = document.createElement('span');
    setName.className = 'stats__history-set';
    setName.textContent = entry.set?.name ?? entry.setId;
    const date = document.createElement('time');
    date.className = 'stats__history-date';
    if (entry.openedAt) date.setAttribute('datetime', entry.openedAt);
    date.textContent = i18n.t('stats.history.date', { date: StatsView.formatHistoryDate(entry.openedAt) });
    meta.append(setName, date);
    head.appendChild(meta);

    if (entry.godpack) {
      const badge = document.createElement('span');
      badge.className = 'stats__history-badge';
      badge.textContent = i18n.t('stats.history.godpack');
      head.appendChild(badge);
    }
    item.appendChild(head);

    const code = document.createElement('button');
    code.type = 'button';
    code.className = 'stats__history-code';
    code.dataset.statsHistoryCode = String(index);
    code.title = i18n.t('stats.history.copy');
    code.textContent = entry.code ?? i18n.t('stats.history.noCode');
    code.disabled = !entry.code;
    item.appendChild(code);

    const cards = document.createElement('div');
    cards.className = 'stats__history-cards';
    (entry.cards ?? []).forEach((card, cardIndex) => {
      cards.appendChild(this.buildHistoryCard(card, index, cardIndex));
    });
    if (cards.childElementCount === 0) {
      const empty = document.createElement('p');
      empty.className = 'stats__history-cards-empty';
      empty.textContent = i18n.t('stats.history.cardsMissing');
      cards.appendChild(empty);
    }
    item.appendChild(cards);

    return item;
  }

  /**
   * Builds one card thumbnail of a history entry.
   *
   * @param {object|null} card - Resolved card, or null when it left the extension file.
   * @param {number} index - Index of the entry.
   * @param {number} cardIndex - Index of the card inside the pack.
   * @returns {HTMLElement} The thumbnail (a button when the card is known, a div otherwise).
   */
  buildHistoryCard(card, index, cardIndex) {
    if (!card) {
      const missing = document.createElement('span');
      missing.className = 'stats__history-card stats__history-card--missing';
      missing.textContent = '? ';
      return missing;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `stats__history-card stats__history-card--r${card.rarity}`;
    if (card.isFullArt) button.classList.add('stats__history-card--fullart');
    button.dataset.statsHistoryCard = String(index);
    button.dataset.cardIndex = String(cardIndex);
    const name = card.getName(i18n.getLang());
    const rarityLabel = getRarityLabel(card.rarity, (key) => i18n.t(key));
    button.setAttribute('aria-label', `${name} — ${rarityLabel}`);

    const image = document.createElement('img');
    image.className = 'stats__history-image';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.src = i18n.resolveImagePath(card.illustration);
    image.alt = '';
    image.addEventListener('error', () => {
      console.warn(`[StatsView] History illustration not found for "${card.uniqueKey}": ${image.src}`);
      image.hidden = true;
    });
    button.appendChild(image);
    return button;
  }

  /**
   * Handles a click inside the history list: copy the code, or open a card detail.
   *
   * @param {MouseEvent} event - Click event.
   * @returns {void}
   */
  handleHistoryClick(event) {
    const target = event?.target;
    if (!(target instanceof HTMLElement)) return;

    const codeButton = target.closest('[data-stats-history-code]');
    if (codeButton) {
      void this.copyHistoryCode(Number(codeButton.dataset.statsHistoryCode));
      return;
    }

    const cardButton = target.closest('[data-stats-history-card]');
    if (cardButton) {
      this.openCardModal(Number(cardButton.dataset.statsHistoryCard), Number(cardButton.dataset.cardIndex));
    }
  }

  /**
   * Copies the shareable code of one past opening.
   *
   * @param {number} index - Index of the entry in `historyEntries`.
   * @returns {Promise<void>} Resolves once the copy attempt finished.
   */
  async copyHistoryCode(index) {
    const code = this.historyEntries[index]?.code;
    if (!code) return;
    try {
      await writeToClipboard(code);
      Toast.success('stats.history.copied');
      this.log(`History code copied (${code.length} characters).`);
    } catch (error) {
      console.error('[StatsView] The history code could not be copied.', error);
      Toast.error('stats.history.copyError');
    }
  }

  /**
   * Opens the card detail modal of one card of a past opening.
   *
   * @param {number} index - Index of the entry.
   * @param {number} cardIndex - Index of the card inside the pack.
   * @returns {void}
   */
  openCardModal(index, cardIndex) {
    const entry = this.historyEntries[index];
    const card = entry?.cards?.[cardIndex];
    if (!card || !this.cardModal) return;

    const lang = i18n.getLang();
    const name = card.getName(lang);
    this.cardModalTitle.textContent = name;
    this.cardModalBody.textContent = '';

    const image = document.createElement('img');
    image.className = 'card-modal__image';
    image.src = i18n.resolveImagePath(card.illustration);
    image.alt = `${name} — ${getRarityLabel(card.rarity, (key) => i18n.t(key))}`;
    image.addEventListener('error', () => {
      console.warn(`[StatsView] Detail illustration not found for "${card.uniqueKey}": ${image.src}`);
      image.hidden = true;
    });

    const list = document.createElement('dl');
    list.className = 'card-modal__details';
    const rows = [
      [i18n.t('opening.card.rarity'), getRarityLabel(card.rarity, (key) => i18n.t(key))],
      [i18n.t('opening.card.set'), entry.set?.name ?? entry.setId],
      [i18n.t('collection.filter.style'), i18n.t(card.isFullArt ? 'collection.filter.styleFullart' : 'collection.filter.styleClassic')],
      [i18n.t('stats.history.openedAt'), StatsView.formatHistoryDate(entry.openedAt)],
    ];
    rows.forEach(([term, value]) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'card-modal__row';
      const key = document.createElement('dt');
      key.textContent = term;
      const text = document.createElement('dd');
      text.textContent = value;
      wrapper.append(key, text);
      list.appendChild(wrapper);
    });

    this.cardModalBody.append(image, list);
    this.cardModal.hidden = false;
    this.log(`History card detail opened for "${card.uniqueKey}".`);
  }

  /**
   * Closes the card detail modal.
   *
   * @returns {void}
   */
  closeCardModal() {
    if (!this.cardModal || this.cardModal.hidden) return;
    this.cardModal.hidden = true;
  }

  /**
   * Closes the modal when the backdrop itself is clicked.
   *
   * @param {MouseEvent} event - Click event on the modal overlay.
   * @returns {void}
   */
  handleModalBackdropClick(event) {
    if (event?.target === this.cardModal) {
      this.closeCardModal();
    }
  }

  /**
   * Closes the modal on Escape.
   *
   * @param {KeyboardEvent} event - Key event.
   * @returns {void}
   */
  handleDocumentKeyDown(event) {
    if (event?.key === 'Escape' && this.cardModal && !this.cardModal.hidden) {
      this.closeCardModal();
    }
  }

  /**
   * Formats a trusted opening timestamp for display.
   *
   * The stored value is UTC (`YYYY-MM-DDTHH:MM:SS.000Z`), so it is shown as UTC rather than
   * converted to the (untrusted) local clock of the reader.
   *
   * @param {string|null} value - Stored ISO timestamp.
   * @returns {string} `YYYY-MM-DD HH:MM`, or a placeholder when the value is missing.
   */
  static formatHistoryDate(value) {
    if (typeof value !== 'string' || value.length < 16) return '—';
    return `${value.slice(0, 10)} ${value.slice(11, 16)}`;
  }

  /**
   * Builds one labeled native progress bar (`owned / total` + percent).
   *
   * @param {string} label - Bar label.
   * @param {number} owned - Numerator.
   * @param {number} total - Denominator.
   * @returns {HTMLElement} The bar row.
   */
  buildBar(label, owned, total) {
    const safeTotal = Math.max(0, total);
    const safeOwned = Math.min(Math.max(0, owned), Math.max(safeTotal, 0));
    const percent = safeTotal > 0 ? Math.round((safeOwned / safeTotal) * 100) : 0;

    const row = document.createElement('div');
    row.className = 'stats__bar';

    const header = document.createElement('div');
    header.className = 'stats__bar-header';
    const name = document.createElement('span');
    name.className = 'stats__bar-label';
    name.textContent = label;
    const value = document.createElement('span');
    value.className = 'stats__bar-value';
    value.textContent = `${Math.max(0, owned)}/${safeTotal} (${percent} %)`;
    header.appendChild(name);
    header.appendChild(value);

    const track = document.createElement('div');
    track.className = 'stats__track';
    const fill = document.createElement('div');
    fill.className = 'stats__fill';
    fill.style.width = `${percent}%`;
    fill.setAttribute('role', 'progressbar');
    fill.setAttribute('aria-valuenow', String(percent));
    fill.setAttribute('aria-valuemin', '0');
    fill.setAttribute('aria-valuemax', '100');
    fill.setAttribute('aria-label', label);
    track.appendChild(fill);

    row.appendChild(header);
    row.appendChild(track);
    return row;
  }

  /**
   * Displays a translated feedback message.
   *
   * @param {string|null} key - i18n key, or null to hide the message.
   * @param {'info'|'error'} [tone='info'] - Visual tone.
   * @returns {void}
   */
  setFeedback(key, tone = 'info') {
    if (!this.feedbackElement) return;
    if (!key) {
      this.feedbackElement.hidden = true;
      this.feedbackElement.textContent = '';
      return;
    }
    this.feedbackElement.hidden = false;
    this.feedbackElement.textContent = i18n.t(key);
    this.feedbackElement.dataset.tone = tone;
    if (tone === 'error') {
      console.warn(`[StatsView] ${i18n.t(key)}`);
    }
  }

  /**
   * Re-renders everything when the language changes.
   *
   * @returns {void}
   */
  handleLanguageChanged() {
    this.log(`Language changed, re-rendering (${i18n.getLang()}).`);
    if (this.isInitialized && !this.isLoading) {
      void this.reload();
    }
  }

  /**
   * Reloads the panels when a pack was just opened.
   *
   * @returns {void}
   */
  handleBoosterOpened() {
    if (!this.isInitialized) return;
    this.log('Booster opened: reloading the statistics.');
    void this.reload();
  }

  /**
   * Reloads the panels when the view becomes active.
   *
   * @returns {void}
   */
  handleViewActivated() {
    this.isActive = true;
    this.log('View activated.');
    if (this.isInitialized && !this.isLoading) {
      void this.reload();
    }
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
   * Removes every subscription.
   *
   * @returns {void}
   */
  destroy() {
    this.log('Destroying the view.');
    this.bindings.forEach(({ target, type, handler, options }) => target.removeEventListener(type, handler, options));
    this.bindings = [];
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
    this.historyEntries = [];
    this.isInitialized = false;
  }
}

export default StatsView;
