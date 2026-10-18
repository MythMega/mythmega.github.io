/**
 * GameNotifier - Announces what the GAME grants: collection progress and experience.
 *
 * Reference: `js/UI/components/NotificationCenter.js` (how they are displayed) and
 * `settings/i18n/*.json` (`notif.*`).
 *
 * WHY THIS MODULE EXISTS
 *   Two messages of the same nature were scattered before: the trophy unlocks were announced by
 *   `app.js`, the collection completion by nothing at all. Both answer the same question — "what did
 *   the game just give me?" — so they are produced here, from the events the managers already
 *   publish, and handed to a single queue.
 *
 * THE KEY MOMENTS
 *   1. `BOOSTER_OPENED`  — the pack is persisted BEFORE the reveal, so the experience it grants
 *      (one booster + one per distinct card drawn) and the collections its cards touch are known
 *      immediately: the experience notification is queued at once, and the collections are
 *      PREPARED for the reveal (see 2).
 *   2. `CARD_REVEALED`   — every card the player turns face up announces, once per collection, the
 *      collection it belongs to: "Quinte Flush Royale 7 / 16", or the "validated" variant when that
 *      very card completes it. The count covers the cards ALREADY REVEALED (plus the collection as
 *      it was before the pack): a notification must never tell the player that a card they have not
 *      turned over yet is waiting in the pack. A collection already validated before the opening
 *      stays silent. `REVEAL_FINISHED` sends whatever is left with the final state (a player who
 *      skips the scene with Escape must not lose the progress of the pack).
 *   3. `TROPHY_UNLOCKED` — every trophy unlocked for the first time, with the experience it grants.
 *   4. `TITLE_UNLOCKED`  — every player TITLE that just became selectable (a level reached or a
 *      collection trophy unlocked, both derived by `TitleManager`).
 *   5. `CARDS_OBTAINED`  — a card bought with Sparks, credited by a promo code or a distribution:
 *      its experience (only a FIRST copy is a distinct card) and, straight away, the collections it
 *      moves forward.
 *   6. `PROFILE_UPDATED` — the player chose their own display name (the experience is granted once,
 *      when the name stops being the default one).
 *   7. `EXPERIENCE_UPDATED` — a level was reached.
 *
 * NO NOTIFICATION AT BOOT
 *   The experience and the trophies are evaluated once when the application starts, and a save can
 *   legitimately unlock a dozen trophies at once: `app.js` calls `start()` AFTER that first
 *   evaluation, and `start()` takes the current level as its baseline. Everything announced here is
 *   therefore a gain the player just made, never a catch-up.
 *
 * The notifications carry RESOLVED strings (see `NotificationCenter`): a trophy or card name is a
 * data value, not a translation key.
 */

import eventBus, { EVENTS } from '../../utils/EventBus.js';
import i18n from '../../utils/I18n.js';
import { configLoader } from '../../utils/ConfigLoader.js';
import { storageRepository, STORES } from '../../models/StorageRepository.js';
import boosterManager from '../../business/BoosterManager.js';
import trophyManager, {
  TrophyManager,
  TROPHY_REQUIREMENT_TYPES,
  TROPHY_CARD_TYPES,
  normalizeRarity,
} from '../../business/TrophyManager.js';
import profileManager from '../../business/ProfileManager.js';
import { TitleManager } from '../../business/TitleManager.js';
import TrophyDetail from './TrophyDetail.js';
import notificationCenter, {
  NOTIFICATION_TYPES,
  NOTIFICATION_VARIANTS,
} from './NotificationCenter.js';

export class GameNotifier {
  /**
   * @param {object} [options] - Notifier options.
   * @param {object} [options.center=notificationCenter] - Queue used to display the messages.
   * @param {object} [options.boosters=boosterManager] - Extension loader (cached after the boot).
   * @param {object} [options.trophies=trophyManager] - Trophy catalogue and level source.
   * @param {object} [options.profile=profileManager] - Display name source.
   */
  constructor({
    center = notificationCenter,
    boosters = boosterManager,
    trophies = trophyManager,
    profile = profileManager,
  } = {}) {
    /** @type {object} Queue displaying the notifications. */
    this.center = center;
    /** @type {object} Extension loader. */
    this.boosters = boosters;
    /** @type {object} Trophy manager. */
    this.trophies = trophies;
    /** @type {object} Profile manager. */
    this.profile = profile;
    /** @type {boolean} True while the event subscriptions are registered. */
    this.isBound = false;
    /** @type {boolean} True once the settings and the baseline are known. */
    this.isReady = false;
    /** @type {Function[]} Unsubscribers of the subscribed events. */
    this.unsubscribers = [];
    /** @type {{everyBooster: number, everyDistinctCard: number, nameChanged: number}} XP amounts. */
    this.experience = { everyBooster: 0, everyDistinctCard: 0, nameChanged: 0 };
    /** @type {Record<string, number>} Experience granted by a trophy rarity. */
    this.experiencePerTrophy = {};
    /** @type {string} Name that does NOT grant the name experience (see `profile.defaultName`). */
    this.defaultName = '';
    /** @type {string} Last known display name (detects the first custom name). */
    this.lastName = '';
    /** @type {number|null} Last known level (detects a level-up). */
    this.level = null;
    /**
     * @type {object|null} Opening being revealed: `{ setId, collections, before, after, announced }`.
     * `before` is the collection owned before the pack, `after` the one it just wrote, `announced`
     * the collections already told about this opening.
     */
    this.pending = null;
  }

  /**
   * Logs with the notifier prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[GameNotifier]', ...args);
  }

  /**
   * Reads the settings, takes the current level as the baseline and subscribes to the events.
   *
   * Called by `app.js` once the boot evaluation is done (never before: the very first evaluation
   * must stay silent). A failure leaves the notifications OFF rather than announcing wrong amounts.
   *
   * @returns {Promise<boolean>} True when the notifications are armed.
   */
  async start() {
    if (this.isReady) return true;

    try {
      const [levelling, experiencePerTrophy, limits, profile, summary] = await Promise.all([
        configLoader.getLevellingSettings(),
        configLoader.getExperiencePerTrophy(),
        this.profile.getLimits(),
        this.profile.getProfile(),
        this.trophies.getSummary(),
      ]);
      this.experience = levelling.experience ?? this.experience;
      this.experiencePerTrophy = experiencePerTrophy ?? {};
      this.defaultName = typeof limits.defaultName === 'string' ? limits.defaultName : '';
      this.lastName = typeof profile?.name === 'string' ? profile.name.trim() : '';
      this.level = Number.isInteger(summary?.level?.level) ? summary.level.level : null;
      this.isReady = true;
    } catch (error) {
      console.warn('[GameNotifier] The notification settings could not be read: notifications stay off.', error);
      return false;
    }

    if (!this.isBound) {
      this.isBound = true;
      this.unsubscribers.push(
        eventBus.on(EVENTS.BOOSTER_OPENED, (payload) => void this.handleBoosterOpened(payload))
      );
      this.unsubscribers.push(
        eventBus.on(EVENTS.CARD_REVEALED, (payload) => this.handleCardRevealed(payload))
      );
      this.unsubscribers.push(
        eventBus.on(EVENTS.REVEAL_FINISHED, () => this.flushPendingCollections())
      );
      this.unsubscribers.push(
        eventBus.on(EVENTS.CARDS_OBTAINED, (payload) => void this.handleCardsObtained(payload))
      );
      this.unsubscribers.push(
        eventBus.on(EVENTS.TROPHY_UNLOCKED, (payload) => this.handleTrophyUnlocked(payload))
      );
      this.unsubscribers.push(
        eventBus.on(EVENTS.TITLE_UNLOCKED, (payload) => this.handleTitleUnlocked(payload))
      );
      this.unsubscribers.push(
        eventBus.on(EVENTS.PROFILE_UPDATED, (payload) => this.handleProfileUpdated(payload))
      );
      this.unsubscribers.push(
        eventBus.on(EVENTS.EXPERIENCE_UPDATED, (payload) => this.handleExperienceUpdated(payload))
      );
      this.log('Event subscriptions registered.');
    }

    this.log(
      `Notifications armed (level ${this.level}): ${this.experience.everyBooster} XP per booster, ` +
        `${this.experience.everyDistinctCard} XP per distinct card, ${this.experience.nameChanged} XP for a custom name.`
    );
    return true;
  }

  /**
   * Releases the subscriptions and empties the queue (a full reset, or an imported save).
   *
   * @returns {void}
   */
  stop() {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
    this.isBound = false;
    this.isReady = false;
    this.pending = null;
    this.level = null;
    this.center.clear();
    this.log('Notifications released.');
  }

  /**
   * Announces an opening: its experience now, its collections while the cards are revealed.
   *
   * @param {object} payload - `BOOSTER_OPENED` payload.
   * @param {string} payload.setId - Opened extension.
   * @param {Array<import('../../classes/Card.js').Card>} [payload.cards] - Drawn cards, in slot order.
   * @param {string[]} [payload.newKeys] - Keys obtained for the first time.
   * @returns {Promise<void>} Resolves once the collections are prepared for the reveal.
   */
  async handleBoosterOpened({ setId, cards, newKeys } = {}) {
    if (!this.isReady) return;
    const drawn = Array.isArray(cards) ? cards : [];
    const fresh = Array.isArray(newKeys) ? newKeys : [];

    this.pending = null;
    this.announceExperience({
      amount: this.experience.everyBooster + this.experience.everyDistinctCard * fresh.length,
      titleKey: 'notif.experience.booster',
      message: fresh.length > 0 ? i18n.t('notif.experience.cards', { count: fresh.length }) : '',
    });

    this.pending = await this.prepareCollections({ setId, cards: drawn, newKeys: fresh });
  }

  /**
   * Announces the collections of the card the player just turned face up.
   *
   * @param {object} payload - `CARD_REVEALED` payload.
   * @param {import('../../classes/Card.js').Card} payload.card - Revealed card.
   * @returns {void}
   */
  handleCardRevealed({ card } = {}) {
    const pending = this.pending;
    if (!this.isReady || !pending || !card) return;
    if (card.set !== pending.setId) return;

    const key = typeof card.uniqueKey === 'string' ? card.uniqueKey : '';
    if (key === '') return;
    // The card is now KNOWN by the player: only the cards already turned face up count towards the
    // progress announced below, so a notification never reveals that another card of the same
    // collection is still face down in the pack.
    pending.revealed.add(key);

    this.announceCollections(pending, (collection) =>
      collection.entries.some((entry) => entry.keys.includes(key))
    );
  }

  /**
   * Sends the collections an opening has not announced yet (the reveal is over).
   *
   * The remaining cards are counted as revealed: whether the player revealed them all or left the
   * scene early, they already own them.
   *
   * @returns {void}
   */
  flushPendingCollections() {
    const pending = this.pending;
    if (!pending) return;
    this.revealEverything(pending);
    this.announceCollections(pending, () => true);
    this.pending = null;
  }

  /**
   * Marks every card of a context as known by the player.
   *
   * Used when there is no reveal to follow: a purchase, a promo code or a distribution credits the
   * cards immediately, so their full progress can be announced at once.
   *
   * @param {object} context - Value returned by `prepareCollections()`.
   * @returns {void}
   */
  revealEverything(context) {
    context.revealed = new Set(context.after);
  }

  /**
   * Announces the experience of cards obtained outside an opening (purchase, code, distribution).
   *
   * @param {object} payload - `CARDS_OBTAINED` payload.
   * @param {Array<import('../../classes/Card.js').Card>} [payload.cards] - Granted cards.
   * @param {string[]} [payload.newKeys] - Keys obtained for the first time.
   * @param {string} [payload.source] - `purchase`, `redeem` or `gift` (logged only).
   * @returns {Promise<void>} Resolves once the collections are announced.
   */
  async handleCardsObtained({ cards, newKeys, source = 'unknown' } = {}) {
    if (!this.isReady) return;
    const list = Array.isArray(cards) ? cards : [];
    if (list.length === 0) return;
    const fresh = Array.isArray(newKeys) ? newKeys : [];
    const firstName = fresh.length > 0
      ? list.find((card) => card.uniqueKey === fresh[0])?.getName(i18n.getLang()) ?? ''
      : '';

    // Only a FIRST copy is a distinct card, so buying a duplicate grants nothing.
    this.announceExperience({
      amount: this.experience.everyDistinctCard * fresh.length,
      titleKey: fresh.length === 1 ? 'notif.experience.card' : 'notif.experience.cards',
      titleParams: fresh.length === 1 ? { name: firstName } : { count: fresh.length },
    });

    const pending = await this.prepareCollections({
      setId: list[0].set,
      cards: list,
      newKeys: fresh,
    });
    if (!pending) return;
    // No reveal here: the cards were credited at once, so the collection is announced complete.
    this.revealEverything(pending);
    this.announceCollections(pending, () => true);
    this.log(`Cards obtained (${source}): ${pending.collections.length} collection(s) announced.`);
  }

  /**
   * Announces every trophy unlocked for the first time.
   *
   * @param {object} payload - `TROPHY_UNLOCKED` payload.
   * @param {object[]} [payload.trophies] - Newly unlocked trophies.
   * @returns {void}
   */
  handleTrophyUnlocked({ trophies } = {}) {
    if (!this.isReady) return;
    (Array.isArray(trophies) ? trophies : []).forEach((trophy) => {
      this.announceExperience({
        amount: this.resolveTrophyExperience(trophy),
        titleKey: 'notif.experience.trophy',
        titleParams: { title: TrophyDetail.trophyTitle(trophy) },
      });
    });
  }

  /**
   * Announces every player title that just became selectable.
   *
   * A title comes with no experience of its own (it is not a trophy): it is announced for what it
   * is - a line the player may now wear under their pseudo, written in the pixel face and in the
   * yellow of the notification (`css/components/notifications.css`).
   *
   * @param {object} payload - `TITLE_UNLOCKED` payload.
   * @param {object[]} [payload.titles] - Titles unlocked for the first time.
   * @returns {void}
   */
  handleTitleUnlocked({ titles } = {}) {
    if (!this.isReady) return;
    (Array.isArray(titles) ? titles : []).forEach((title) => {
      this.center.push({
        type: NOTIFICATION_TYPES.TITLE,
        badge: i18n.t('notif.title.badge'),
        title: i18n.t('notif.title.unlocked', { title: TitleManager.titleText(title, i18n.getLang()) }),
      });
    });
  }

  /**
   * Announces the experience of a custom display name, the first time one is set.
   *
   * @param {object} payload - `PROFILE_UPDATED` payload.
   * @param {object} [payload.profile] - Stored profile.
   * @returns {void}
   */
  handleProfileUpdated({ profile } = {}) {
    if (!this.isReady) return;
    const name = typeof profile?.name === 'string' ? profile.name.trim() : '';
    const wasCustom = this.isCustomName(this.lastName);
    const isCustom = this.isCustomName(name);
    this.lastName = name;
    if (wasCustom || !isCustom) return;

    this.announceExperience({
      amount: this.experience.nameChanged,
      titleKey: 'notif.experience.name',
    });
  }

  /**
   * Announces a level reached.
   *
   * The level is not an experience AMOUNT: it is a milestone. It therefore gets its own variant, and
   * only when the level actually moved up since the last evaluation.
   *
   * @param {object} payload - `EXPERIENCE_UPDATED` payload.
   * @param {object} [payload.level] - Resolved level (`{ level, experience, … }`).
   * @returns {void}
   */
  handleExperienceUpdated({ level } = {}) {
    if (!this.isReady) return;
    const next = Number.isInteger(level?.level) ? level.level : null;
    const previous = this.level;
    this.level = next;
    if (next === null || previous === null || next <= previous) return;

    this.center.push({
      type: NOTIFICATION_TYPES.EXPERIENCE,
      variant: NOTIFICATION_VARIANTS.LEVEL,
      badge: i18n.t('notif.experience.levelBadge'),
      title: i18n.t('notif.experience.level', { level: next }),
    });
    this.log(`Level up announced: ${previous} -> ${next}.`);
  }

  /**
   * Tells whether a display name is a CUSTOM one (the configured default earns nothing).
   *
   * @param {string} name - Display name.
   * @returns {boolean} True when the name grants the name experience.
   */
  isCustomName(name) {
    return name !== '' && name !== this.defaultName;
  }

  /**
   * Resolves the experience a trophy granted.
   *
   * @param {object} trophy - Trophy state.
   * @returns {number} The amount (0 when the rarity grants nothing).
   */
  resolveTrophyExperience(trophy) {
    if (Number.isInteger(trophy?.experience) && trophy.experience > 0) return trophy.experience;
    const byRarity = this.experiencePerTrophy?.[trophy?.rarity];
    return Number.isInteger(byRarity) && byRarity > 0 ? byRarity : 0;
  }

  /**
   * Queues an experience notification.
   *
   * @param {object} options - Message options.
   * @param {number} options.amount - Experience granted (nothing is displayed when it is 0).
   * @param {string} options.titleKey - i18n key of the reason.
   * @param {object|null} [options.titleParams=null] - Interpolation values of the reason.
   * @param {string} [options.message=''] - Optional second line (already translated).
   * @returns {void}
   */
  announceExperience({ amount, titleKey, titleParams = null, message = '' }) {
    if (!Number.isFinite(amount) || amount <= 0) return;

    this.center.push({
      type: NOTIFICATION_TYPES.EXPERIENCE,
      badge: i18n.t('notif.experience.amount', { amount }),
      title: i18n.t(titleKey, titleParams),
      message,
    });
  }

  /**
   * Prepares the collections a pack (or a grant) touches: what they were, what they are, what the
   * player has seen.
   *
   * The cards are ALREADY written when this runs (every flow persists before announcing), so the
   * owned rows hold the new state and the owned keys of the previous state are the difference with
   * the keys obtained for the first time. `revealed` starts empty: it is fed by the reveal, or
   * filled at once by `revealEverything()` when the cards are credited without a reveal.
   *
   * @param {object} payload - Cards that were just added.
   * @param {string|null} payload.setId - Extension of the cards.
   * @param {Array<import('../../classes/Card.js').Card>} payload.cards - Added cards.
   * @param {string[]} payload.newKeys - Keys obtained for the first time.
   * @returns {Promise<object|null>} The context, or null when there is nothing to announce.
   */
  async prepareCollections({ setId, cards = [], newKeys = [] }) {
    if (!setId || cards.length === 0) return null;

    try {
      const [catalog, set, rows] = await Promise.all([
        this.trophies.loadCatalog(),
        this.boosters.getBoosterSet(setId),
        storageRepository.getAll(STORES.COLLECTION),
      ]);

      const list = Array.isArray(catalog?.collection?.get(setId)?.TrophyList)
        ? catalog.collection.get(setId).TrophyList
        : [];
      if (list.length === 0) return null;

      const printingsByIndex = new Map();
      (set?.cards ?? []).forEach((card) => {
        if (!printingsByIndex.has(card.id)) printingsByIndex.set(card.id, []);
        printingsByIndex.get(card.id).push(card);
      });

      // Only the collections the added cards actually belong to are prepared: a pack of cards that
      // no collection track must not announce anything.
      const indexes = new Set(cards.map((card) => card.id));
      const collections = list
        .map((entry, index) => this.buildCollection(entry, index, setId, printingsByIndex))
        .filter((collection) => collection !== null)
        .filter((collection) => collection.entries.some((entry) => indexes.has(entry.index)));
      if (collections.length === 0) return null;

      const owned = new Set((rows ?? []).map((row) => row?.key).filter((key) => typeof key === 'string'));
      const fresh = new Set(newKeys);
      const before = new Set([...owned].filter((key) => !fresh.has(key)));

      // `before` = the keys owned before this grant, `after` = the keys owned now, `revealed` =
      // the ones the player has actually seen (empty until the reveal feeds it).
      return { setId, collections, before, after: owned, revealed: new Set(), announced: new Set() };
    } catch (error) {
      console.warn('[GameNotifier] The collections of the cards could not be prepared.', error);
      return null;
    }
  }

  /**
   * Builds the readable descriptor of one collection trophy of `data/trophies/<setId>.json`.
   *
   * The requirements are read exactly like `TrophyManager` reads them (same supported type, same
   * layout filter), so the progress announced here can never disagree with the Trophies page.
   *
   * @param {object} entry - Raw trophy entry.
   * @param {number} index - Position in the file (used in the fallback name).
   * @param {string} setId - Extension id.
   * @param {Map<string, Array<import('../../classes/Card.js').Card>>} printingsByIndex - Catalog.
   * @returns {object|null} The descriptor, or null when the entry is unusable.
   */
  buildCollection(entry, index, setId, printingsByIndex) {
    if (!entry || typeof entry !== 'object') return null;
    const requirement = entry.Requirements ?? {};
    const requirementType = String(requirement.RequirementType ?? '').trim().toLowerCase();
    if (requirementType !== TROPHY_REQUIREMENT_TYPES.CARD_LIST) return null;

    const indexes = TrophyManager.readRequirementIndexes(requirement.Items);
    if (indexes.length === 0) return null;

    const layout = String(requirement.Type ?? TROPHY_CARD_TYPES.ANY).trim().toLowerCase();
    return {
      id: `collection:${setId}:${index}`,
      name: typeof entry.Name === 'string' && entry.Name.trim() !== ''
        ? entry.Name.trim()
        : `#${index + 1}`,
      rarity: normalizeRarity(entry.Rarity) ?? 'bronze',
      // `MusthaveAllRequirementsCompleted: false` means one required card validates the collection.
      requireAll: entry.MusthaveAllRequirementsCompleted !== false,
      entries: indexes.map((cardIndex) => ({
        index: cardIndex,
        keys: GameNotifier.acceptedKeys(cardIndex, layout, printingsByIndex),
      })),
    };
  }

  /**
   * Lists the collection keys one requirement entry accepts.
   *
   * @param {string} cardIndex - Normalized index (`SERIE-A1 _ W001`).
   * @param {string} layout - `any`, `classic` or `fullart`.
   * @param {Map<string, Array<import('../../classes/Card.js').Card>>} printingsByIndex - Catalog.
   * @returns {string[]} The accepted keys.
   */
  static acceptedKeys(cardIndex, layout, printingsByIndex) {
    const printings = printingsByIndex?.get(cardIndex) ?? [];
    const accepted = layout === TROPHY_CARD_TYPES.ANY
      ? printings
      : printings.filter((card) => card.style === layout);
    return accepted.map((card) => card.uniqueKey);
  }

  /**
   * Counts the requirement entries of a collection the player satisfies.
   *
   * @param {object} collection - Descriptor from `buildCollection()`.
   * @param {Set<string>} ownedKeys - Owned collection keys.
   * @returns {number} The satisfied entry count.
   */
  satisfiedCount(collection, ownedKeys) {
    return collection.entries.filter((entry) => entry.keys.some((key) => ownedKeys.has(key))).length;
  }

  /**
   * Announces every collection of a context the predicate selects, at most once each.
   *
   * @param {object} context - Value returned by `prepareCollections()`.
   * @param {(collection: object) => boolean} matches - Selection predicate (receives the descriptor).
   * @returns {void}
   */
  announceCollections(context, matches) {
    context.collections.forEach((collection) => {
      if (context.announced.has(collection.id)) return;
      if (!matches(collection)) return;
      context.announced.add(collection.id);
      this.announceCollection(collection, context);
    });
  }

  /**
   * Queues the notification of one collection.
   *
   * A collection already validated BEFORE the cards were added stays silent: the player did not move
   * it forward, they only drew one of its cards again.
   *
   * @param {object} collection - Descriptor from `buildCollection()`.
   * @param {object} context - Value returned by `prepareCollections()`.
   * @returns {void}
   */
  announceCollection(collection, context) {
    const total = collection.entries.length;
    const isComplete = (count) => (collection.requireAll ? count === total : count > 0);
    const before = this.satisfiedCount(collection, context.before);
    if (isComplete(before)) return;

    // The progress the PLAYER knows: the state before this grant, plus the cards already revealed.
    const known = new Set([...context.before, ...context.revealed]);
    const current = this.satisfiedCount(collection, known);
    const complete = isComplete(current);
    this.center.push(
      {
        type: NOTIFICATION_TYPES.COLLECTION,
        variant: complete ? NOTIFICATION_VARIANTS.COMPLETE : NOTIFICATION_VARIANTS.DEFAULT,
        badge: i18n.t(complete ? 'notif.collection.completeBadge' : 'notif.collection.badge'),
        title: collection.name,
        message: complete
          ? i18n.t('notif.collection.complete')
          : i18n.t('notif.collection.progress', { current, total }),
        progress: total > 0 ? current / total : null,
      },
      // A collection is discovered WHILE the card is revealed: it must not wait for the experience
      // notifications already queued before it.
      { priority: true }
    );
  }
}

/** Shared instance used by `app.js`. */
export const gameNotifier = new GameNotifier();

export default gameNotifier;
