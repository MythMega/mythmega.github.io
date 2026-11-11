/**
 * StatsView - Booster count, completion, rarity distribution, most drawn card, Mine Pick
 * counters and the last openings.
 *
 * Reference: `.docs/steps/5.md` point 3. Reads `user_state["stats"]`, `user_state["boosterHistory"]`,
 * `user_state["minePick"]` (through `MinePickManager`) and the collection (via
 * `CollectionManager`). Only booster draws feed the opening counters: redeem/gift cards (steps 7 and
 * 8) and minepick-picked cards never touch `stats` — the Mine Pick keeps its own counters, because a
 * pick is not an opened booster.
 *
 * A PAGE OF ITS OWN
 *   These panels used to be a block at the bottom of the profile (`[data-panel="stats"]`) and, before
 *   that, a destination of the bottom bar. They are now the `stats` router view
 *   (`[data-view="stats"]`), opened from the small button of the profile and left with the back
 *   button under the title: the page shows nothing but the statistics, and it owns its lifecycle
 *   again (it follows `VIEW_CHANGED`, plus `LANG_CHANGED`, `BOOSTER_OPENED` and `MINE_PICK_UPDATED`).
 *
 * The history panel shows the last `boosters.historySize` (10) openings with their shareable
 * `minecards:` code, the trusted UTC date of the opening and the 5 cards: each thumbnail opens the
 * shared card detail popup (effects on), exactly like a pick of the Mine Pick history, and the code
 * is copied on click.
 */

import eventBus, { EVENTS } from '../../utils/EventBus.js';
import i18n from '../../utils/I18n.js';
import cardLanguage from '../../utils/CardLanguage.js';
import collectionManager from '../../business/CollectionManager.js';
import boosterManager, { SAVED_OPENINGS_SIZE } from '../../business/BoosterManager.js';
import { storageRepository, STORES } from '../../models/StorageRepository.js';
import { USER_STATE_KEYS } from '../../business/AccountManager.js';
import minePickManager from '../../business/MinePickManager.js';
import {
  SPARKS_EARNED_SOURCES,
  SPARKS_SPENT_SOURCES,
} from '../../business/SparksManager.js';
import miningManager from '../../business/MiningManager.js';
import trophyManager from '../../business/TrophyManager.js';
import { CARD_RARITY, getRarityLabel } from '../../classes/Card.js';
import { writeToClipboard } from '../../utils/Clipboard.js';
import Toast from '../components/Toast.js';
import { applyCardGlow } from '../../utils/Shine.js';
import cardDetailPopup from '../components/CardDetailPopup.js';

/** View name, matching `data-view="stats"` in `index.html`. */
export const STATS_VIEW_NAME = 'stats';

/** View the back button returns to: the profile, which carries the button that opens this page. */
export const STATS_BACK_VIEW = 'profile';

/** Number of past openings displayed. */
export const STATS_HISTORY_SIZE = 10;

export class StatsView {
  /**
   * @param {HTMLElement} rootElement - The statistics `<section>` (`[data-view="stats"]`).
   * @param {object} [options] - View options.
   * @param {(viewName: string) => void} [options.onNavigate] - Called by the back button to switch
   *   view: the router belongs to `app.js`, which passes its `show()`.
   */
  constructor(rootElement, { onNavigate = null, onReplay = null } = {}) {
    if (!rootElement || typeof rootElement.querySelector !== 'function') {
      throw new TypeError('StatsView requires the stats section element.');
    }

    this.root = rootElement;
    /** @type {((viewName: string) => void)|null} */
    this.onNavigate = typeof onNavigate === 'function' ? onNavigate : null;
    /** @type {((entry: object) => boolean)|null} Replays a saved opening in the opening view. */
    this.onReplay = typeof onReplay === 'function' ? onReplay : null;
    this.backButton = this.root.querySelector('[data-stats-back]');
    this.feedbackElement = this.root.querySelector('[data-stats-feedback]');
    this.boostersElement = this.root.querySelector('[data-stats-boosters]');
    this.godpacksElement = this.root.querySelector('[data-stats-godpacks]');
    this.levelElement = this.root.querySelector('[data-stats-level]');
    this.questsElement = this.root.querySelector('[data-stats-quests]');
    this.connectionsElement = this.root.querySelector('[data-stats-connections]');
    this.completionGlobalElement = this.root.querySelector('[data-stats-completion-global]');
    this.completionSetsElement = this.root.querySelector('[data-stats-completion-sets]');
    this.rarityElement = this.root.querySelector('[data-stats-rarity]');
    this.soldElement = this.root.querySelector('[data-stats-sold]');
    this.soldTotalElement = this.root.querySelector('[data-stats-sold-total]');
    this.sparksSummaryElement = this.root.querySelector('[data-stats-sparks-summary]');
    this.sparksEarnedElement = this.root.querySelector('[data-stats-sparks-earned]');
    this.sparksSpentElement = this.root.querySelector('[data-stats-sparks-spent]');
    this.topElement = this.root.querySelector('[data-stats-top]');
    this.historyElement = this.root.querySelector('[data-stats-history]');
    this.historyEmptyElement = this.root.querySelector('[data-stats-history-empty]');
    this.savedElement = this.root.querySelector('[data-stats-saved]');
    this.savedEmptyElement = this.root.querySelector('[data-stats-saved-empty]');
    this.savedCountElement = this.root.querySelector('[data-stats-saved-count]');
    this.minepickSummaryElement = this.root.querySelector('[data-stats-minepick-summary]');
    this.minepickRarityElement = this.root.querySelector('[data-stats-minepick-rarity]');
    this.minepickRarestElement = this.root.querySelector('[data-stats-minepick-rarest]');
    this.minepickHistoryElement = this.root.querySelector('[data-stats-minepick-history]');
    this.miningSummaryElement = this.root.querySelector('[data-stats-mining-summary]');
    this.miningBlocksElement = this.root.querySelector('[data-stats-mining-blocks]');
    this.miningResourcesElement = this.root.querySelector('[data-stats-mining-resources]');

    /** @type {Array<{code: string|null, setId: string, openedAt: string|null, godpack: boolean, set: object|null, cards: Array}>} */
    this.historyEntries = [];
    /** @type {Array<{id: string, setId: string, openedAt: string|null, godpack: boolean, set: object|null, cards: Array}>} */
    this.savedEntries = [];
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
      ['[data-stats-back]', this.backButton],
      ['[data-stats-boosters]', this.boostersElement],
      ['[data-stats-godpacks]', this.godpacksElement],
      ['[data-stats-level]', this.levelElement],
      ['[data-stats-quests]', this.questsElement],
      ['[data-stats-connections]', this.connectionsElement],
      ['[data-stats-completion-global]', this.completionGlobalElement],
      ['[data-stats-completion-sets]', this.completionSetsElement],
      ['[data-stats-rarity]', this.rarityElement],
      ['[data-stats-sold]', this.soldElement],
      ['[data-stats-sold-total]', this.soldTotalElement],
      ['[data-stats-sparks-summary]', this.sparksSummaryElement],
      ['[data-stats-sparks-earned]', this.sparksEarnedElement],
      ['[data-stats-sparks-spent]', this.sparksSpentElement],
      ['[data-stats-top]', this.topElement],
      ['[data-stats-history]', this.historyElement],
      ['[data-stats-saved]', this.savedElement],
      ['[data-stats-minepick-summary]', this.minepickSummaryElement],
      ['[data-stats-minepick-rarity]', this.minepickRarityElement],
      ['[data-stats-minepick-history]', this.minepickHistoryElement],
      ['[data-stats-mining-summary]', this.miningSummaryElement],
      ['[data-stats-mining-blocks]', this.miningBlocksElement],
      ['[data-stats-mining-resources]', this.miningResourcesElement],
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
    this.listen(this.backButton, 'click', () => this.onNavigate?.(STATS_BACK_VIEW));
    this.listen(this.historyElement, 'click', (event) => this.handleHistoryClick(event));
    this.listen(this.savedElement, 'click', (event) => this.handleSavedClick(event));
    this.log('DOM listeners bound.');
  }

  /**
   * Subscribes to the application events the view depends on.
   *
   * @returns {void}
   */
  subscribeToEvents() {
    this.unsubscribers.push(eventBus.on(EVENTS.VIEW_CHANGED, (payload) => {
      if (!payload || typeof payload.view !== 'string') return;
      if (payload.view === STATS_VIEW_NAME) {
        this.handleViewActivated();
      } else if (payload.previousView === STATS_VIEW_NAME) {
        this.handleViewDeactivated();
      }
    }));
    this.unsubscribers.push(eventBus.on(EVENTS.LANG_CHANGED, () => this.handleLanguageChanged()));
    this.unsubscribers.push(eventBus.on(EVENTS.CARD_LANG_CHANGED, () => this.handleLanguageChanged()));
    // An opening moves every counter of the page: it is only repainted while it is on screen, since
    // the activation of the view reloads it anyway.
    this.unsubscribers.push(
      eventBus.on(EVENTS.BOOSTER_OPENED, () => {
        if (this.isActive) this.handleBoosterOpened();
      })
    );
    // The Sparks ledger moves with every sale and purchase, wherever it happens: the panel
    // follows while the page is on screen, like the counters above.
    this.unsubscribers.push(
      eventBus.on(EVENTS.SPARKS_UPDATED, () => {
        if (this.isActive) this.handleBoosterOpened();
      })
    );
    // A mine pick writes a card and its own counters: the dedicated panel follows it, but only
    // while the panels are displayed (the activation of the view reloads them anyway).
    this.unsubscribers.push(
      eventBus.on(EVENTS.MINE_PICK_UPDATED, () => {
        if (this.isActive) this.handleBoosterOpened();
      })
    );
    // A block broken on the mine screen moves its own counters: the panel follows, but only while
    // the panels are displayed (the activation of the view reloads them anyway).
    this.unsubscribers.push(
      eventBus.on(EVENTS.MINING_UPDATED, () => {
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
      // The level is derived from the experience and the unlocked trophies, so it is read from the
      // trophy evaluation rather than copied into `stats`: the panel and the profile can never show
      // two different levels.
      const trophyState = await trophyManager.getSummary();
      const view = await collectionManager.getCollectionView();
      const history = await boosterManager.getBoosterHistory(STATS_HISTORY_SIZE);
      const saved = await boosterManager.getSavedOpenings();
      const minepick = await minePickManager.getState();
      const mining = await miningManager.getState({ lang: cardLanguage.getLang() });
      const miningBlocks = await miningManager.listBlocks(cardLanguage.getLang());
      const miningResources = await miningManager.listResources();
      this.renderBoosters(stats);
      this.renderProgress(stats, trophyState.level?.level);
      this.renderCompletion(view);
      this.renderRarity(stats);
      this.renderSold(stats);
      this.renderSparks(stats);
      this.renderTop(stats, view);
      this.renderMinePick(minepick, view);
      this.renderMining(mining, miningBlocks, miningResources);
      this.renderHistory(history);
      this.renderSaved(saved);
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
    const godpacks = Number.isFinite(stats?.godpacksOpened) ? stats.godpacksOpened : 0;
    this.godpacksElement.textContent = i18n.t('stats.godpacks', { count: Math.max(0, godpacks) });
  }

  /**
   * Renders the account-wide progression counters (level, completed quests and connection days).
   *
   * @param {object} stats - Raw `user_state["stats"]` value.
   * @param {unknown} level - Level returned by the trophy evaluation.
   * @returns {void}
   */
  renderProgress(stats, level) {
    const safeLevel = Number.isInteger(level) && level > 0 ? level : 1;
    const quests = Number.isInteger(stats?.questsCompleted) && stats.questsCompleted >= 0
      ? stats.questsCompleted
      : 0;
    const connections =
      Number.isInteger(stats?.daysConnected) && stats.daysConnected >= 0 ? stats.daysConnected : 0;
    this.levelElement.textContent = String(safeLevel);
    this.questsElement.textContent = String(quests);
    this.connectionsElement.textContent = String(connections);
  }

  /**
   * Renders the global completion line and one native bar per extension.
   *
   * The promo groups are skipped: they have no completion to compare.
   *
   * @param {{completion: object, sets: object}} view - Collection view from the manager.
   * @returns {void}
   */
  renderCompletion(view) {
    // Promo groups carry an empty counter: they are never drawn, so there is no ratio to draw and
    // a 0/0 bar would only be noise (see `CollectionManager`).
    const ratedSets = Object.values(view?.sets ?? {}).filter((set) => set?.promo !== true);
    const total = view?.completion?.total ?? 0;
    const owned = view?.completion?.owned ?? 0;
    if (total === 0) {
      this.completionGlobalElement.textContent = i18n.t('stats.completion.empty');
    } else {
      const percent = Math.round((owned / total) * 100);
      this.completionGlobalElement.textContent = i18n.t('stats.completion.global', { owned, total, percent });
    }

    this.completionSetsElement.textContent = '';
    ratedSets
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
   * Renders one native bar per rarity from `stats.soldByRarity`.
   *
   * Same shape as the draws panel on purpose: the two read against each other, and a missing
   * counter (a save from before sales were recorded) simply shows the empty line.
   *
   * @param {object} stats - Raw `user_state["stats"]` value.
   * @returns {void}
   */
  renderSold(stats) {
    const sold = stats?.soldByRarity ?? {};
    const rarities = Array.from({ length: CARD_RARITY.MAX }, (_, index) => CARD_RARITY.MIN + index);
    const total = rarities.reduce((sum, rarity) => sum + (Number(sold[String(rarity)]) || 0), 0);
    this.soldTotalElement.textContent = i18n.t('stats.sold.total', { count: total });
    this.soldTotalElement.hidden = total === 0;
    this.soldElement.textContent = '';
    if (total === 0) {
      this.soldElement.textContent = i18n.t('stats.sold.empty');
      return;
    }
    rarities.forEach((rarity) => {
      const count = Number(sold[String(rarity)]) || 0;
      const label = getRarityLabel(rarity, (key) => i18n.t(key));
      this.soldElement.appendChild(this.buildBar(label, count, total));
    });
  }

  /**
   * Renders the Sparks ledger: the totals, the net balance and both per-origin breakdowns.
   *
   * The signed net is written here rather than in the dictionaries: the sign is the same in
   * every language, only the surrounding sentence is translated.
   *
   * @param {object} stats - Raw `user_state["stats"]` value.
   * @returns {void}
   */
  renderSparks(stats) {
    const earned = Math.max(0, Number(stats?.sparksEarned) || 0);
    const spent = Math.max(0, Number(stats?.sparksSpent) || 0);
    const net = earned - spent;
    this.sparksSummaryElement.textContent = i18n.t('stats.sparks.summary', {
      earned,
      spent,
      net: net === 0 ? '0' : `${net > 0 ? '+' : '−'}${Math.abs(net)}`,
    });
    this.renderSources(
      this.sparksEarnedElement,
      stats?.sparksEarnedBySource,
      SPARKS_EARNED_SOURCES,
      'stats.sparks.empty.earned'
    );
    this.renderSources(
      this.sparksSpentElement,
      stats?.sparksSpentBySource,
      SPARKS_SPENT_SOURCES,
      'stats.sparks.empty.spent'
    );
  }

  /**
   * Renders one bar per origin that actually moved Sparks.
   *
   * Origins at zero are left out: a player who never used the Wandering Trader does not need a
   * row telling them so, and the breakdown reads as "where my Sparks come from".
   *
   * @param {HTMLElement} target - Bars container.
   * @param {unknown} raw - Stored per-origin map.
   * @param {readonly string[]} sources - Known origins, in display order.
   * @param {string} emptyKey - i18n key shown when nothing was recorded.
   * @returns {void}
   */
  renderSources(target, raw, sources, emptyKey) {
    const map = raw && typeof raw === 'object' ? raw : {};
    const total = sources.reduce((sum, id) => sum + (Number(map[id]) || 0), 0);
    target.textContent = '';
    if (total === 0) {
      target.textContent = i18n.t(emptyKey);
      return;
    }
    sources.forEach((id) => {
      const count = Number(map[id]) || 0;
      if (count <= 0) return;
      target.appendChild(this.buildBar(i18n.t(`stats.sparks.source.${id}`), count, total));
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
      applyCardGlow(wrapper, entry.card);
      const image = document.createElement('img');
      image.className = 'stats__top-image';
      image.loading = 'lazy';
      image.src = i18n.resolveImagePath(entry.card.illustration);
      image.alt = entry.card.getName(cardLanguage.getLang());
      image.addEventListener('error', () => {
        console.warn(`[StatsView] Top card illustration not found for "${key}": ${image.src}`);
        image.hidden = true;
      });
      wrapper.appendChild(image);
    }

    const name = document.createElement('p');
    name.className = 'stats__top-name';
    name.textContent = entry?.card?.getName(cardLanguage.getLang()) ?? key;
    wrapper.appendChild(name);

    const draws = document.createElement('p');
    draws.className = 'stats__top-count';
    draws.textContent = i18n.t('collection.quantity', { count });
    wrapper.appendChild(draws);

    this.topElement.appendChild(wrapper);
    this.log(`Top card: "${key}" drawn ${count} time(s).`);
  }

  // __STATS_MINE_PICK__

  /**
   * Renders the dedicated Mine Pick counters.
   *
   * The feature has its own block on purpose: a picked card is not an opened booster, so it is
   * counted here (picks, distribution by rarity, best pick, last packs) and never in the opening
   * counters above.
   *
   * @param {object} state - State returned by `MinePickManager.getState()`.
   * @param {{entries: object[]}} view - Collection view from the manager (resolves the card keys).
   * @returns {void}
   */
  renderMinePick(state, view) {
    if (this.minepickSummaryElement) {
      const summary = i18n.t('stats.minepick.summary', {
        total: state?.totalPicks ?? 0,
        remaining: state?.remaining ?? 0,
        picksPerDay: state?.picksPerDay ?? 0,
      });
      this.minepickSummaryElement.textContent = summary;
    }

    if (this.minepickRarityElement) {
      this.minepickRarityElement.textContent = '';
      const picks = state?.picksByRarity ?? {};
      const rarities = Array.from({ length: CARD_RARITY.MAX }, (_, index) => CARD_RARITY.MIN + index);
      const total = rarities.reduce((sum, rarity) => sum + (Number(picks[String(rarity)]) || 0), 0);
      if (total === 0) {
        this.minepickRarityElement.textContent = i18n.t('stats.minepick.rarity.empty');
      } else {
        rarities.forEach((rarity) => {
          const count = Number(picks[String(rarity)]) || 0;
          this.minepickRarityElement.appendChild(
            this.buildBar(getRarityLabel(rarity, (key) => i18n.t(key)), count, total)
          );
        });
      }
    }

    if (this.minepickRarestElement) {
      const rarest = this.resolveRarestPick(state, view);
      this.minepickRarestElement.textContent = rarest
        ? i18n.t('stats.minepick.rarest', {
            name: rarest.card.getName(cardLanguage.getLang()),
            rarity: getRarityLabel(rarest.rarity, (key) => i18n.t(key)),
          })
        : i18n.t('stats.minepick.rarest.empty');
    }

    if (this.minepickHistoryElement) {
      this.minepickHistoryElement.textContent = '';
      const picks = Array.isArray(state?.history) ? state.history : [];
      if (picks.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'stats__line';
        empty.textContent = i18n.t('stats.minepick.history.empty');
        this.minepickHistoryElement.appendChild(empty);
      } else {
        picks.forEach((pick) => {
          this.minepickHistoryElement.appendChild(this.buildMinePickEntry(pick, view));
        });
      }
    }

    this.log(`Mine Pick: ${state?.totalPicks ?? 0} pick(s), ${state?.remaining ?? 0} left today.`);
  }

  /**
   * Renders the Mine panel: the allowance, the blocks broken per KIND and the resources harvested.
   *
   * The per-kind counters are the dedicated statistics of the mine (`blocksMined` in
   * `user_state["mining"]`), which is why every declared block gets a bar - including the ones the
   * player never came across, whose bar is simply empty (a catalogue, not a scoreboard).
   *
   * @param {object} state - State returned by `MiningManager.getState()`.
   * @param {Array<{id: string, name: string}>} blocks - Block kinds, in declaration order.
   * @param {Array<{slug: string, type: string, nameKey: string}>} resources - Harvestable resources.
   * @returns {void}
   */
  renderMining(state, blocks, resources) {
    if (this.miningSummaryElement) {
      this.miningSummaryElement.textContent = i18n.t('stats.mining.summary', {
        total: state?.totalMined ?? 0,
        remaining: state?.remaining ?? 0,
        blocksPerDay: state?.blocksPerDay ?? 0,
      });
    }

    if (this.miningBlocksElement) {
      this.miningBlocksElement.textContent = '';
      const mined = state?.blocksMined ?? {};
      const total = Object.values(mined).reduce((sum, count) => sum + (Number(count) || 0), 0);
      if (total === 0) {
        this.miningBlocksElement.textContent = i18n.t('stats.mining.empty');
      } else {
        (blocks ?? []).forEach((block) => {
          const count = Number(mined[block.id]) || 0;
          this.miningBlocksElement.appendChild(this.buildBar(block.name, count, total));
        });
      }
    }

    if (this.miningResourcesElement) {
      const harvested = state?.resources ?? {};
      // Every resource the mine can give is listed, even at zero: the panel is a catalogue, like
      // the bars above it, and a resource that is missing from the line reads as a bug rather than
      // as an empty stock. A resource the configuration no longer declares is appended as well, so
      // a save never hides what the player actually holds.
      const declared = new Map((resources ?? []).map((resource) => [resource.slug, resource]));
      Object.keys(harvested).forEach((slug) => {
        if (!declared.has(slug)) declared.set(slug, { slug, type: slug, nameKey: null });
      });

      const lines = Array.from(declared.values()).map(
        (resource) =>
          `${this.resolveResourceLabel(resource)} : ${Number(harvested[resource.slug]) || 0}`
      );
      this.miningResourcesElement.textContent =
        lines.length > 0 ? lines.join(' · ') : i18n.t('stats.mining.empty');
    }
  }

  /**
   * Label of a resource: its translation, falling back to the raw type of the configuration.
   *
   * `settings/mining.json` decides what a block gives; a resource added there before its two
   * translations still reads as something (`Stone Dust`) instead of a raw key.
   *
   * @param {{nameKey?: string, type?: string}} resource - Resource descriptor.
   * @returns {string} The player-facing label.
   */
  resolveResourceLabel(resource) {
    const key = resource?.nameKey;
    if (!key) return resource?.type ?? '';
    const translated = i18n.t(key);
    return translated === key ? resource.type ?? translated : translated;
  }

  /**
   * Finds the rarest card ever picked.
   *
   * @param {object} state - State returned by `MinePickManager.getState()`.
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
   * Builds one entry of the Mine Pick history: the day, the extension, the kept card and its
   * illustration.
   *
   * A pick has no shareable code and only one card: the thumbnail is the entry point to the large
   * card detail, which already carries the name, the index, the rarity and the extension.
   *
   * @param {{day: string|null, setId: string, setName: string|null, key: string, rarity: number,
   *   godpack: boolean}} pick - History entry written by `MinePickManager`.
   * @param {{entries: object[]}} view - Collection view from the manager.
   * @returns {HTMLElement} The list item.
   */
  buildMinePickEntry(pick, view) {
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
    wrapper.className = 'stats__minepick-pick';

    if (entry?.card) {
      const card = entry.card;
      const thumbnail = document.createElement('button');
      thumbnail.type = 'button';
      thumbnail.className = `stats__history-card stats__history-card--r${card.rarity}`;
      if (card.isFullArt) thumbnail.classList.add('stats__history-card--fullart');
      thumbnail.setAttribute('aria-label', card.getName(cardLanguage.getLang()));
      applyCardGlow(thumbnail, card);
      const image = document.createElement('img');
      image.className = 'stats__history-image';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.src = i18n.resolveImagePath(card.illustration);
      image.alt = '';
      thumbnail.appendChild(image);
      thumbnail.addEventListener('click', () => void cardDetailPopup.open(card, { effects: true }));
      wrapper.appendChild(thumbnail);
    }

    const name = document.createElement('p');
    name.className = 'stats__minepick-name';
    name.textContent = `${entry?.card?.getName(cardLanguage.getLang()) ?? pick.key} · ${getRarityLabel(
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
    cardDetailPopup.close();
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
    applyCardGlow(button, card);
    const name = card.getName(cardLanguage.getLang());
    const rarityLabel = getRarityLabel(card.rarity, (key) => i18n.t(key));
    button.setAttribute('aria-label', `${name} (${rarityLabel})`);

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
   * Renders the openings pinned by the player, one row per slot.
   *
   * @param {Array<object>} entries - Entries returned by `BoosterManager.getSavedOpenings()`.
   * @returns {void}
   */
  renderSaved(entries) {
    const list = Array.isArray(entries) ? entries : [];
    this.savedEntries = list;
    if (!this.savedElement) return;
    this.savedElement.textContent = '';
    if (this.savedCountElement) {
      this.savedCountElement.textContent = i18n.t('stats.saved.count', {
        count: list.length,
        max: SAVED_OPENINGS_SIZE,
      });
    }
    if (this.savedEmptyElement) this.savedEmptyElement.hidden = list.length > 0;
    list.forEach((entry, index) => this.savedElement.appendChild(this.buildSavedRow(entry, index)));
    this.log(`${list.length} saved opening(s) rendered.`);
  }

  /**
   * Builds one saved-opening row: metadata, the five cards and the two actions.
   *
   * @param {object} entry - Resolved saved entry.
   * @param {number} index - Index of the entry in `savedEntries`.
   * @returns {HTMLElement} The `<li>` element.
   */
  buildSavedRow(entry, index) {
    const item = document.createElement('li');
    item.className = 'stats__history-entry stats__saved-entry';

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
    date.textContent = StatsView.formatHistoryDate(entry.openedAt);
    meta.append(setName, date);
    head.appendChild(meta);
    if (entry.godpack) {
      const badge = document.createElement('span');
      badge.className = 'stats__history-badge';
      badge.textContent = i18n.t('stats.history.godpack');
      head.appendChild(badge);
    }
    item.appendChild(head);

    const cards = document.createElement('div');
    cards.className = 'stats__history-cards';
    (entry.cards ?? []).forEach((card) => cards.appendChild(this.buildSavedThumb(card)));
    if (cards.childElementCount === 0) {
      const empty = document.createElement('p');
      empty.className = 'stats__history-cards-empty';
      empty.textContent = i18n.t('stats.history.cardsMissing');
      cards.appendChild(empty);
    }
    item.appendChild(cards);

    const actions = document.createElement('div');
    actions.className = 'stats__saved-actions';
    const replay = document.createElement('button');
    replay.type = 'button';
    replay.className = 'btn btn--primary btn--small';
    replay.dataset.statsSavedReplay = String(index);
    replay.textContent = i18n.t('stats.saved.replay');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn--ghost btn--small';
    remove.dataset.statsSavedDelete = String(index);
    remove.textContent = i18n.t('stats.saved.delete');
    actions.append(replay, remove);
    item.appendChild(actions);

    return item;
  }

  /**
   * Builds one thumbnail of a saved opening (never a button: it opens no dialog).
   *
   * @param {object|null} card - Resolved card, or null when it left the extension file.
   * @returns {HTMLElement} The thumbnail.
   */
  buildSavedThumb(card) {
    if (!card) {
      const missing = document.createElement('span');
      missing.className = 'stats__history-card stats__history-card--missing';
      missing.textContent = '?';
      return missing;
    }
    const thumb = document.createElement('span');
    thumb.className = `stats__history-card stats__history-card--r${card.rarity}`;
    if (card.isFullArt) thumb.classList.add('stats__history-card--fullart');
    applyCardGlow(thumb, card);
    const image = document.createElement('img');
    image.className = 'stats__history-image';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.src = i18n.resolveImagePath(card.illustration);
    image.alt = card.getName(cardLanguage.getLang());
    image.addEventListener('error', () => {
      console.warn(`[StatsView] Saved-opening illustration not found for "${card.uniqueKey}": ${image.src}`);
      image.hidden = true;
    });
    thumb.appendChild(image);
    return thumb;
  }

  /**
   * Handles a click on the saved openings: replay the pack or free its slot.
   *
   * @param {MouseEvent} event - Click event.
   * @returns {void}
   */
  handleSavedClick(event) {
    const target = event?.target;
    if (!(target instanceof HTMLElement)) return;
    const replay = target.closest('[data-stats-saved-replay]');
    if (replay) {
      this.replaySaved(Number(replay.dataset.statsSavedReplay));
      return;
    }
    const remove = target.closest('[data-stats-saved-delete]');
    if (remove) void this.deleteSaved(Number(remove.dataset.statsSavedDelete));
  }

  /**
   * Asks the application to replay one saved opening in the opening view.
   *
   * The replay is visual only: the opening view rebuilds the same cards and shows the reveal, but
   * nothing is drawn, granted or counted.
   *
   * @param {number} index - Index of the entry in `savedEntries`.
   * @returns {void}
   */
  replaySaved(index) {
    const entry = this.savedEntries[index];
    if (!entry) return;
    const started = this.onReplay?.(entry);
    if (!started) {
      Toast.error('stats.saved.busy');
      return;
    }
    this.log(`Saved opening "${entry.id}" replayed.`);
  }

  /**
   * Frees the slot of one saved opening.
   *
   * @param {number} index - Index of the entry in `savedEntries`.
   * @returns {Promise<void>} Resolves once the list is reloaded.
   */
  async deleteSaved(index) {
    const entry = this.savedEntries[index];
    if (!entry) return;
    try {
      await boosterManager.deleteSavedOpening(entry.id);
      Toast.success('stats.saved.deleted');
      await this.reload();
    } catch (error) {
      console.error('[StatsView] The saved opening could not be removed.', error);
      this.setFeedback('stats.saved.deleteError', 'error');
    }
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
      this.openHistoryCardDetail(
        Number(cardButton.dataset.statsHistoryCard),
        Number(cardButton.dataset.cardIndex)
      );
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
   * Opens the large card detail of one card of a past opening.
   *
   * Same popup as the Mine Pick history (and the rest of the game), effects on: the two histories
   * of the page must not preview a card differently. The opening date is the only extra row, since
   * the popup already carries the name, the index, the rarity and the extension.
   *
   * @param {number} index - Index of the entry.
   * @param {number} cardIndex - Index of the card inside the pack.
   * @returns {void}
   */
  openHistoryCardDetail(index, cardIndex) {
    const entry = this.historyEntries[index];
    const card = entry?.cards?.[cardIndex];
    if (!card) return;
    void cardDetailPopup.open(card, {
      effects: true,
      rows: [[i18n.t('stats.history.openedAt'), StatsView.formatHistoryDate(entry.openedAt)]],
    });
    this.log(`History card detail opened for "${card.uniqueKey}".`);
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
    if (typeof value !== 'string' || value.length < 16) return i18n.t('common.unknown');
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
    cardDetailPopup.close();
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
    // The page is left through its back button: a card detail left open must not come back with
    // the next visit (the section is merely hidden, so the dialog would still be displayed).
    cardDetailPopup.close();
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
    this.savedEntries = [];
    this.isInitialized = false;
  }
}

export default StatsView;
