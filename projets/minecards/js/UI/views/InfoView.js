/**
 * InfoView - "How it works" page: mechanics, drop rates and credits.
 *
 * Reference: the information page added with the sound/history/god pack batch.
 *
 * CONTENTS
 *   1. a static explanation of the application (translated through `data-i18n` in `index.html`);
 *   2. the DROP RATES of the selected extension, read LIVE from the data files
 *      (`data/boosters/<setId>.json` and `settings/defaultRarity.json`) so the displayed numbers
 *      can never drift from the real draw:
 *        - one table per booster slot: the rarity probabilities of that slot (`rarityConfig`),
 *        - then, for every card, its chance to come out of one booster, computed from the same
 *          table: `sum over slots of P(slot -> rarity) / number of cards of that rarity`;
 *   3. the RELEASES list: the date of every extension, a countdown on the ones that are not out
 *      yet, and a button that plays the announcement popup again (the automatic one only fires
 *      once, at the first load after the release);
 *   4. the EXPERIENCE panel: every XP source and its exact value, read live from
 *      `settings/config.json` (`levelling` and `ExperiencePerTrophy`) with the same loaders the
 *      level calculation uses, so the displayed numbers can never drift from the real rewards;
 *   5. the credits (illustrations, sounds, icons).
 *
 * The view is read-only: it never writes anything and never consumes a booster.
 */

import eventBus, { EVENTS } from '../../utils/EventBus.js';
import i18n from '../../utils/I18n.js';
import boosterManager from '../../business/BoosterManager.js';
import dateSyncManager from '../../business/DateSyncManager.js';
import { configLoader } from '../../utils/ConfigLoader.js';
import { getRarityLabel } from '../../classes/Card.js';
import setAnnouncementPopup from '../components/SetAnnouncementPopup.js';

/** View name, matching `data-view="info"` in `index.html`. */
export const INFO_VIEW_NAME = 'info';

export class InfoView {
  /**
   * @param {HTMLElement} rootElement - The info `<section>`.
   */
  constructor(rootElement) {
    if (!rootElement || typeof rootElement.querySelector !== 'function') {
      throw new TypeError('InfoView requires the info section element.');
    }

    this.root = rootElement;
    this.feedbackElement = this.root.querySelector('[data-info-feedback]');
    this.tocElement = this.root.querySelector('[data-info-toc]');
    this.setSelect = this.root.querySelector('[data-info-set]');
    this.slotsElement = this.root.querySelector('[data-info-slots]');
    this.raritySourceElement = this.root.querySelector('[data-info-rarity-source]');
    this.cardsElement = this.root.querySelector('[data-info-cards]');
    this.setsPanel = this.root.querySelector('#info-sets');
    this.setsElement = this.root.querySelector('[data-info-sets]');
    this.setsTocLink = this.root.querySelector('[data-info-toc-link="info-sets"]');
    this.experienceElement = this.root.querySelector('[data-info-experience]');
    this.experienceTrophiesElement = this.root.querySelector('[data-info-experience-trophies]');
    this.experienceLevelElement = this.root.querySelector('[data-info-experience-level]');

    this.assertMarkup();

    /** @type {Map<string, object>} Extension descriptors, keyed by id. */
    this.sets = new Map();
    /** @type {string|null} Currently displayed extension. */
    this.selectedSetId = null;
    /** @type {Map<string, object>} Released extensions, the ones the announcement can be replayed for. */
    this.announceable = new Map();
    /** @type {Map<string, {element: HTMLElement, releaseAt: number}>} Countdowns of the upcoming ones. */
    this.upcoming = new Map();
    /** @type {boolean} True while the list is being rebuilt after a release day was reached. */
    this.isRefreshingSets = false;
    /** @type {boolean} True once `init()` completed. */
    this.isInitialized = false;
    /** @type {boolean} True while the data is being loaded. */
    this.isLoading = false;
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
    console.info('[InfoView]', ...args);
  }

  /**
   * Verifies that the markup matches the contract expected by this view.
   *
   * @returns {void}
   * @throws {Error} When a required element is missing from `index.html`.
   */
  assertMarkup() {
    const missing = [
      ['[data-info-toc]', this.tocElement],
      ['[data-info-set]', this.setSelect],
      ['[data-info-slots]', this.slotsElement],
      ['[data-info-rarity-source]', this.raritySourceElement],
      ['[data-info-cards]', this.cardsElement],
      ['#info-sets', this.setsPanel],
      ['[data-info-sets]', this.setsElement],
      ['[data-info-experience]', this.experienceElement],
      ['[data-info-experience-trophies]', this.experienceTrophiesElement],
      ['[data-info-experience-level]', this.experienceLevelElement],
    ]
      .filter(([, element]) => !element)
      .map(([selector]) => selector);

    if (missing.length > 0) {
      throw new Error(`InfoView markup is incomplete, missing: ${missing.join(', ')}.`);
    }
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
   * Loads the extensions, fills the picker and renders the first table.
   *
   * @returns {Promise<void>} Resolves once the view is ready.
   * @throws {Error} When the booster data cannot be loaded (the caller shows the error).
   */
  async init() {
    if (this.isInitialized) return;
    this.log('Initializing…');
    this.listen(this.setSelect, 'change', () => this.handleSetChange());
    this.listen(this.tocElement, 'click', (event) => this.handleTocClick(event));
    this.listen(this.setsElement, 'click', (event) => this.handleSetsClick(event));
    this.subscribeToEvents();
    await this.loadSets();
    await this.renderSetsPanel();
    await this.renderExperience();
    this.isInitialized = true;
    this.log('Ready.');
  }

  /**
   * Loads the declared extensions and builds the picker options.
   *
   * @returns {Promise<void>} Resolves once the options are rendered and the first table drawn.
   * @throws {Error} When the extension JSONs cannot be loaded.
   */
  async loadSets() {
    const listed = await boosterManager.listBoosterSets();
    this.sets.clear();
    listed.forEach((set) => this.sets.set(set.setId, set));

    this.setSelect.textContent = '';
    listed.forEach((set) => {
      const option = document.createElement('option');
      option.value = set.setId;
      option.textContent = `${set.name} (${set.cardCount})`;
      this.setSelect.appendChild(option);
    });

    this.selectedSetId = listed[0]?.setId ?? null;
    if (this.selectedSetId) this.setSelect.value = this.selectedSetId;
    await this.renderSelected();
  }

  /**
   * Subscribes to the events the view depends on.
   *
   * @returns {void}
   */
  subscribeToEvents() {
    this.unsubscribers.push(eventBus.on(EVENTS.VIEW_CHANGED, (payload) => {
      if (payload?.view === INFO_VIEW_NAME && this.isInitialized) {
        void this.renderSelected();
        void this.renderSetsPanel();
      }
    }));
    this.unsubscribers.push(eventBus.on(EVENTS.LANG_CHANGED, () => {
      if (!this.isInitialized) return;
      void this.renderSelected();
      void this.renderSetsPanel();
      void this.renderExperience();
    }));
    this.unsubscribers.push(eventBus.on(EVENTS.CLOCK_TICK, (payload) => this.handleClockTick(payload)));
    this.log('Event subscriptions registered.');
  }

  /**
   * Renders the release dates, newest first, with a replay button on the released ones.
   *
   * The section hides itself when no extension declares a release date: an empty list would only
   * promise something the catalogue does not have.
   *
   * @returns {Promise<void>} Resolves once the list is drawn (an error leaves it empty).
   */
  async renderSetsPanel() {
    let listed;
    try {
      listed = await boosterManager.listBoosterSets({ includeUpcoming: true });
    } catch (error) {
      console.warn('[InfoView] The release dates could not be read.', error);
      listed = [];
    }

    const dated = listed.filter((set) => Boolean(set.releaseDate));
    const released = dated
      .filter((set) => set.released !== false)
      .sort((left, right) => right.releaseDate.localeCompare(left.releaseDate));
    const upcoming = dated
      .filter((set) => set.released === false)
      .sort((left, right) => left.releaseDate.localeCompare(right.releaseDate));

    this.announceable = new Map(released.map((set) => [set.setId, set]));
    this.upcoming = new Map();
    this.setsElement.textContent = '';
    [...released, ...upcoming].forEach((set) => this.setsElement.appendChild(this.buildSetRow(set)));

    const isEmpty = dated.length === 0;
    this.setsPanel.hidden = isEmpty;
    if (this.setsTocLink) this.setsTocLink.hidden = isEmpty;
    this.isRefreshingSets = false;
  }

  /**
   * Builds one row of the releases list.
   *
   * @param {object} set - Extension descriptor from `listBoosterSets()`.
   * @returns {HTMLLIElement} The row: name, release date, and either the replay button or a badge.
   */
  buildSetRow(set) {
    const item = document.createElement('li');
    item.className = 'info__set';

    const name = document.createElement('span');
    name.className = 'info__set-name';
    name.textContent = set.name ?? set.setId;

    const date = document.createElement('span');
    date.className = 'info__set-date';
    date.textContent = i18n.t(
      set.released === false ? 'info.sets.releaseUpcoming' : 'info.sets.release',
      { date: i18n.formatUtcDay(set.releaseDate) }
    );

    item.append(name, date);

    if (set.released === false) {
      const countdown = document.createElement('span');
      countdown.className = 'info__set-countdown';
      countdown.dataset.infoSetCountdown = set.setId;
      this.writeCountdown(
        countdown,
        dateSyncManager.getEstimatedUtcMs(),
        Date.parse(`${set.releaseDate}T00:00:00.000Z`)
      );
      this.upcoming.set(set.setId, {
        element: countdown,
        releaseAt: Date.parse(`${set.releaseDate}T00:00:00.000Z`),
      });

      const badge = document.createElement('span');
      badge.className = 'info__set-badge';
      badge.textContent = i18n.t('info.sets.upcoming');
      item.append(countdown, badge);
      return item;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn--ghost info__set-action';
    button.dataset.infoSetReplay = set.setId;
    button.textContent = i18n.t('info.sets.replay');
    item.appendChild(button);
    return item;
  }

  /**
   * Writes the time left before a release day, `--:--:--` when the clock is not anchored yet.
   *
   * @param {HTMLElement} element - Target element.
   * @param {number} now - Current trusted UTC time in milliseconds (0 when unknown).
   * @param {number} releaseAt - Release instant in milliseconds.
   * @returns {void}
   */
  writeCountdown(element, now, releaseAt) {
    if (!(now > 0) || !Number.isFinite(releaseAt)) {
      element.textContent = i18n.t('info.sets.countdown', { time: '--:--:--' });
      return;
    }

    const { days, time } = InfoView.formatCountdown(releaseAt - now);
    element.textContent =
      days > 0
        ? i18n.t('info.sets.countdownDays', { days, time })
        : i18n.t('info.sets.countdown', { time });
  }

  /**
   * Splits a remaining duration into whole days and a `HH:MM:SS` rest.
   *
   * @param {number} milliseconds - Remaining time (negative values read as zero).
   * @returns {{days: number, time: string}} The days left and the clock of the last day.
   */
  static formatCountdown(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return {
      days,
      time: [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':'),
    };
  }

  /**
   * Keeps the countdowns of the upcoming extensions up to date.
   *
   * The application clock is the only timer (`CLOCK_TICK`): the view runs no interval of its own.
   * When a release day is reached the list is rebuilt, so the extension moves to the released block
   * with its replay button.
   *
   * @param {{utc?: Date}|null} payload - Clock tick payload.
   * @returns {void}
   */
  handleClockTick(payload) {
    if (this.upcoming.size === 0) return;
    const now = payload?.utc instanceof Date ? payload.utc.getTime() : 0;
    if (!(now > 0)) return;

    let reachedRelease = false;
    this.upcoming.forEach((entry) => {
      this.writeCountdown(entry.element, now, entry.releaseAt);
      if (now >= entry.releaseAt) reachedRelease = true;
    });

    if (reachedRelease && !this.isRefreshingSets) {
      this.isRefreshingSets = true;
      void this.renderSetsPanel();
    }
  }

  /**
   * Replays the announcement of the clicked extension.
   *
   * The popup only reads the descriptor: the announcement is not recorded again, so the automatic
   * one keeps its "already seen" state.
   *
   * @param {MouseEvent} event - Click on the releases list.
   * @returns {void}
   */
  handleSetsClick(event) {
    const button = event.target instanceof Element
      ? event.target.closest('[data-info-set-replay]')
      : null;
    if (!button) return;

    const set = this.announceable.get(button.dataset.infoSetReplay);
    if (!set) return;

    void setAnnouncementPopup.show([set]);
    this.log(`Announcement replayed for "${set.setId}".`);
  }

  /**
   * Renders the experience panel from `settings/config.json`.
   *
   * The values come from the very loaders `TrophyManager` uses (`getLevellingSettings()` and
   * `getExperiencePerTrophy()`), so the panel always explains the rules the code actually applies —
   * including the fallbacks, should the configuration lose a key.
   *
   * @returns {Promise<void>} Resolves once the panel is rendered (or the error displayed).
   */
  async renderExperience() {
    try {
      const [levelling, experiencePerTrophy] = await Promise.all([
        configLoader.getLevellingSettings(),
        configLoader.getExperiencePerTrophy(),
      ]);

      this.experienceElement.textContent = '';
      [
        ['info.experience.booster', levelling.experience.everyBooster],
        ['info.experience.card', levelling.experience.everyDistinctCard],
        ['info.experience.name', levelling.experience.nameChanged],
      ].forEach(([key, value]) => {
        this.experienceElement.appendChild(InfoView.buildSourceRow(i18n.t(key), i18n.t('info.experience.value', { experience: value })));
      });

      this.experienceTrophiesElement.textContent = '';
      Object.entries(experiencePerTrophy).forEach(([rarity, value]) => {
        this.experienceTrophiesElement.appendChild(InfoView.buildSourceRow(
          i18n.t(`trophy.rarity.${rarity}`),
          i18n.t('info.experience.value', { experience: value }),
          rarity
        ));
      });

      this.experienceLevelElement.textContent = i18n.t('info.experience.levelText', {
        base: levelling.baseRequiredExpToLevelUp,
        increment: levelling.incrementRequiredXpBy,
        next: levelling.defaultLevel + 1,
      });
      this.log('Experience panel rendered.');
    } catch (error) {
      console.error('[InfoView] The experience panel could not be rendered.', error);
      this.setFeedback('info.error.load', 'error');
    }
  }

  /**
   * Builds one `<li>` of an experience list: the source on the left, its value on the right.
   *
   * @param {string} label - Translated source name.
   * @param {string} value - Translated value (`+5 XP`).
   * @param {string} [rarity] - Rarity id, to tint the value with the trophy palette.
   * @returns {HTMLLIElement} The row.
   */
  static buildSourceRow(label, value, rarity = undefined) {
    const item = document.createElement('li');
    item.className = 'info__source';

    const name = document.createElement('span');
    name.className = 'info__source-name';
    name.textContent = label;

    const amount = document.createElement('span');
    amount.className = 'info__source-value';
    amount.textContent = value;
    if (rarity) {
      amount.dataset.rarity = rarity;
    }

    item.append(name, amount);
    return item;
  }

  /**
   * Scrolls to one section of the page from the table of contents.
   *
   * The section is focused after the scroll (`tabindex="-1"`) so a keyboard or screen-reader user
   * lands inside the section instead of staying on the link: the arrow keys then read it. The scroll
   * respects `prefers-reduced-motion`, like every animation of the project.
   *
   * @param {MouseEvent} event - Click on one entry of the table of contents.
   * @returns {void}
   */
  handleTocClick(event) {
    const link = event.target instanceof Element
      ? event.target.closest('[data-info-toc-link]')
      : null;
    if (!link) return;

    const id = link.dataset.infoTocLink;
    const target = id ? this.root.querySelector(`#${CSS.escape(id)}`) : null;
    if (!target) return;

    event.preventDefault();
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
    target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    this.log(`Scrolled to "${id}".`);
  }

  /**
   * Handles the extension picker change.
   *
   * @returns {Promise<void>} Resolves once the tables are redrawn.
   */
  async handleSetChange() {
    this.selectedSetId = this.setSelect.value || null;
    this.log(`Extension selected: ${this.selectedSetId}.`);
    await this.renderSelected();
  }

  /**
   * Renders the drop rates of the selected extension.
   *
   * @returns {Promise<void>} Resolves once the tables are drawn (or the error displayed).
   */
  async renderSelected() {
    if (!this.selectedSetId || this.isLoading) return;
    this.isLoading = true;
    this.setFeedback(null);
    try {
      const set = await boosterManager.getBoosterSet(this.selectedSetId);
      const { slots, tables } = InfoView.buildSlotTables(set.rarityConfig);
      this.renderSlots(set, slots, tables);
      this.renderRaritySource(set);
      this.renderCardRates(set, tables);
    } catch (error) {
      console.error('[InfoView] The drop rates could not be computed.', error);
      this.setFeedback('info.error.load', 'error');
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Normalizes the rarity table into percentages per slot.
   *
   * Mirrors `GachaEngine.normalizeWeights()` (the weights are normalized, so a table whose weights
   * do not sum up to 100 stays readable), without instantiating the engine: the info page must
   * show exactly what the draw does.
   *
   * @param {Record<string, Array<{rarity: number, weight: number}>>} rarityConfig - Slot table of the extension.
   * @returns {{slots: number[], tables: Map<number, Map<number, number>>}} Slot numbers in
   *   ascending order and, per slot, the probability (in percent) of each rarity.
   */
  static buildSlotTables(rarityConfig) {
    const slots = Object.keys(rarityConfig ?? {})
      .map((key) => Number(key))
      .filter((slot) => Number.isInteger(slot) && slot > 0)
      .sort((left, right) => left - right);

    const tables = new Map();
    slots.forEach((slot) => {
      const entries = Array.isArray(rarityConfig[String(slot)]) ? rarityConfig[String(slot)] : [];
      const total = entries.reduce((sum, entry) => sum + (Number(entry?.weight) || 0), 0);
      const probabilities = new Map();
      entries.forEach((entry) => {
        const weight = Number(entry?.weight) || 0;
        probabilities.set(Number(entry?.rarity), total > 0 ? (weight / total) * 100 : 0);
      });
      tables.set(slot, probabilities);
    });
    return { slots, tables };
  }

  /**
   * Computes the chance of each card to come out of one booster.
   *
   * `P(card) = Σ_slots P(slot -> rarity of the card) / number of cards of that rarity`, which is
   * exactly the two-step draw of `GachaEngine.drawPack()`.
   *
   * @param {object} set - Loaded extension.
   * @param {Map<number, Map<number, number>>} tables - Slot tables from `buildSlotTables()`.
   * @returns {Map<string, number>} Chance in percent, keyed by `card.uniqueKey`.
   */
  static buildCardRates(set, tables) {
    const countsByRarity = new Map();
    (set.cards ?? []).forEach((card) => {
      countsByRarity.set(card.rarity, (countsByRarity.get(card.rarity) ?? 0) + 1);
    });

    const rates = new Map();
    (set.cards ?? []).forEach((card) => {
      const count = countsByRarity.get(card.rarity) ?? 0;
      if (count === 0) {
        rates.set(card.uniqueKey, 0);
        return;
      }
      let perSlot = 0;
      tables.forEach((probabilities) => {
        perSlot += probabilities.get(card.rarity) ?? 0;
      });
      rates.set(card.uniqueKey, perSlot / count);
    });
    return rates;
  }

  /**
   * Formats a percentage with enough precision for the very small values.
   *
   * @param {number} value - Percentage value.
   * @returns {string} The formatted percentage (e.g. `0.045 %`).
   */
  static formatPercent(value) {
    const safe = Number.isFinite(value) ? value : 0;
    const digits = safe >= 10 ? 1 : safe >= 1 ? 2 : 3;
    return `${safe.toFixed(digits)} %`;
  }

  /**
   * Renders one block per booster slot, with a bar per rarity.
   *
   * The bars reuse the `.stats__*` classes of `css/views/stats.css`: the markup is identical and
   * the stylesheet is loaded on every page.
   *
   * @param {object} set - Loaded extension.
   * @param {number[]} slots - Slot numbers.
   * @param {Map<number, Map<number, number>>} tables - Probabilities per slot.
   * @returns {void}
   */
  renderSlots(set, slots, tables) {
    this.slotsElement.textContent = '';

    slots.forEach((slot) => {
      const probabilities = tables.get(slot) ?? new Map();
      const block = document.createElement('div');
      block.className = 'info__slot panel';

      const title = document.createElement('h5');
      title.className = 'info__slot-title';
      title.textContent = i18n.t('info.rates.slot', { slot });
      block.appendChild(title);

      const bars = document.createElement('div');
      bars.className = 'stats__bars';
      Array.from(probabilities.entries())
        .sort(([left], [right]) => left - right)
        .forEach(([rarity, percent]) => {
          const count = (set.cards ?? []).filter((card) => card.rarity === rarity).length;
          bars.appendChild(
            this.buildBar(
              `${getRarityLabel(rarity, (key) => i18n.t(key))} · ${i18n.t('info.rates.cardsOf', { count })}`,
              percent,
              InfoView.formatPercent(percent)
            )
          );
        });
      block.appendChild(bars);
      this.slotsElement.appendChild(block);
    });
  }

  /**
   * Writes which rarity table the displayed extension actually uses.
   *
   * @param {object} set - Loaded extension (`raritySource` = "booster" | "default").
   * @returns {void}
   */
  renderRaritySource(set) {
    this.raritySourceElement.textContent = i18n.t(
      set.raritySource === 'booster' ? 'info.rates.source.booster' : 'info.rates.source.default'
    );
  }

  /**
   * Renders every card of the extension, grouped by rarity, with its drop rate.
   *
   * @param {object} set - Loaded extension.
   * @param {Map<number, Map<number, number>>} tables - Slot tables from `buildSlotTables()`.
   * @returns {void}
   */
  renderCardRates(set, tables) {
    const rates = InfoView.buildCardRates(set, tables);
    const lang = i18n.getLang();
    this.cardsElement.textContent = '';

    const byRarity = new Map();
    (set.cards ?? []).forEach((card) => {
      if (!byRarity.has(card.rarity)) byRarity.set(card.rarity, []);
      byRarity.get(card.rarity).push(card);
    });

    Array.from(byRarity.keys())
      .sort((left, right) => right - left)
      .forEach((rarity) => {
        const cards = byRarity.get(rarity).slice().sort((left, right) => left.getName(lang).localeCompare(right.getName(lang)));

        const group = document.createElement('div');
        group.className = 'info__group';
        const title = document.createElement('h5');
        title.className = 'info__group-title';
        title.textContent = `${getRarityLabel(rarity, (key) => i18n.t(key))} · ${i18n.t('info.rates.cardsOf', { count: cards.length })}`;
        group.appendChild(title);

        const list = document.createElement('ul');
        list.className = 'info__card-list';
        cards.forEach((card) => {
          const item = document.createElement('li');
          item.className = 'info__card';
          item.dataset.rarity = String(card.rarity);

          const name = document.createElement('span');
          name.className = 'info__card-name';
          name.textContent = card.getName(lang);

          const style = document.createElement('span');
          style.className = 'info__card-style';
          style.textContent = i18n.t(card.isFullArt ? 'collection.filter.styleFullart' : 'collection.filter.styleClassic');

          const rate = document.createElement('span');
          rate.className = 'info__card-rate';
          rate.textContent = InfoView.formatPercent(rates.get(card.uniqueKey) ?? 0);

          item.append(name, style, rate);
          list.appendChild(item);
        });
        group.appendChild(list);
        this.cardsElement.appendChild(group);
      });
  }

  /**
   * Builds one labeled bar (same markup as the statistics panels).
   *
   * @param {string} label - Bar label.
   * @param {number} percent - Fill width in percent.
   * @param {string} valueText - Text displayed on the right.
   * @returns {HTMLElement} The bar row.
   */
  buildBar(label, percent, valueText) {
    const safePercent = Math.min(Math.max(Number(percent) || 0, 0), 100);
    const row = document.createElement('div');
    row.className = 'stats__bar';

    const header = document.createElement('div');
    header.className = 'stats__bar-header';
    const name = document.createElement('span');
    name.className = 'stats__bar-label';
    name.textContent = label;
    const value = document.createElement('span');
    value.className = 'stats__bar-value';
    value.textContent = valueText;
    header.append(name, value);

    const track = document.createElement('div');
    track.className = 'stats__track';
    const fill = document.createElement('div');
    fill.className = 'stats__fill';
    fill.style.width = `${safePercent}%`;
    track.appendChild(fill);

    row.append(header, track);
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
      console.warn(`[InfoView] ${i18n.t(key)}`);
    }
  }

  /**
   * Removes every subscription and listener.
   *
   * @returns {void}
   */
  destroy() {
    this.log('Destroying the view.');
    this.bindings.forEach(({ target, type, handler, options }) => target.removeEventListener(type, handler, options));
    this.bindings = [];
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
    this.isInitialized = false;
  }
}

export default InfoView;
