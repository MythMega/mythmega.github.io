/**
 * EventBus - Minimal publish/subscribe hub shared by every module of the app.
 *
 * Reference: `.docs/main.md` section 1 (`js/utils/`) and `.docs/steps/2.md` (event names).
 *
 * The bus is intentionally dependency-free and synchronous: listeners are called in
 * registration order, and a throwing listener never prevents the remaining listeners
 * from being notified (the error is logged instead).
 *
 * Usage:
 *   import eventBus, { EVENTS } from '../utils/EventBus.js';
 *   const unsubscribe = eventBus.on(EVENTS.LANG_CHANGED, handler);
 *   eventBus.emit(EVENTS.LANG_CHANGED, { lang: 'en' });
 *   unsubscribe();
 */

/** Canonical event names. Steps 2, 6, 7 and 8 rely on the ones already declared here. */
export const EVENTS = Object.freeze({
  /** Payload: `{ lang, previousLang }`. Emitted by I18n after a successful language switch. */
  LANG_CHANGED: 'LANG_CHANGED',
  /** Payload: `{ theme, previousTheme }`. Emitted by ThemeManager after a successful switch. */
  THEME_CHANGED: 'THEME_CHANGED',
  /** Payload: `{ view, previousView }`. Emitted by the SPA router. */
  VIEW_CHANGED: 'VIEW_CHANGED',
  /** Payload: `{ daily, bonusBySet, bonusTotal, availableForSet }`. Emitted by DateSyncManager. */
  QUOTA_UPDATED: 'QUOTA_UPDATED',
  /** Payload: `{ setId, cards, newKeys, source, quantity, remaining }`. Emitted by
   * BoosterManager once a pack is persisted: the reveal animation only renders it. */
  BOOSTER_OPENED: 'BOOSTER_OPENED',
  /** Payload: `{ online }`. Emitted by DateSyncManager (step 2). */
  CONNECTION_STATUS: 'CONNECTION_STATUS',
  /** Payload: `{ utc: Date, formatted: 'HH:MM:SS', timeUntilReset: 'HH:MM:SS' }`. Emitted every
   * second by DateSyncManager: the header clock listens to it instead of running its own timer. */
  CLOCK_TICK: 'CLOCK_TICK',
  /** Payload: `{ uuid }`. Emitted by AccountManager after the first save is created. */
  ACCOUNT_CREATED: 'ACCOUNT_CREATED',
  /** Payload: `null`. Emitted by AccountManager after a full reset (UUID included). */
  ACCOUNT_REMOVED: 'ACCOUNT_REMOVED',
  /** Payload: `{ uuid }`. Emitted by SaveFile right before an imported save replaces the whole
   * database (step 6): the data changes identity, so the application must release its in-memory
   * state (time anchor, views) the same way it does after a full reset. */
  SAVE_IMPORTED: 'SAVE_IMPORTED',
  /** Payload: `{ count, lines }`. Emitted by GiftManager once a distribution check credited at
   * least one gift (step 8): the gift history reloads itself instead of waiting for the next
   * activation. A booster gift also refreshes the header through `QUOTA_UPDATED`. */
  GIFTS_UPDATED: 'GIFTS_UPDATED',
  /** Payload: `{ balance }`. Emitted by SparksManager whenever the currency balance changes
   * (booster reward, code, distribution, collection sale or purchase): the header listens to it. */
  SPARKS_UPDATED: 'SPARKS_UPDATED',
  /** Payload: `{ profile }`. Emitted by ProfileManager after the name, the photo or the pinned
   * trophies changed: the profile page and the identity displays re-render from it. */
  PROFILE_UPDATED: 'PROFILE_UPDATED',
  /** Payload: `{ favorites }`. Emitted by ProfileManager whenever the favourite cards changed:
   * the collection grid repaints its hearts without reloading the whole catalogue. */
  FAVORITES_UPDATED: 'FAVORITES_UPDATED',
  /** Payload: `{ setId, card, revealed, total }`. Emitted by the opening view every time a card of
   * the reveal is turned face up (including the ones a player who jumped to the summary never
   * flipped): `GameNotifier` announces the collections those cards belong to as they appear. */
  CARD_REVEALED: 'CARD_REVEALED',
  /** Payload: `{ setId }`. Emitted by the opening view when the reveal ends (the summary is shown,
   * or the scene is left with Escape): the notifications prepared for cards that were never turned
   * face up are sent now instead of being lost. */
  REVEAL_FINISHED: 'REVEAL_FINISHED',
  /** Payload: `{ cards, newKeys, source }` where `source` is `'purchase'`, `'redeem'` or `'gift'`.
   * Emitted AFTER the commit by the three flows that credit cards outside an opening — SparksManager
   * (purchase), RedeemManager (promo code) and GiftManager (distribution) — because they own the
   * transactions they write in (see `SparksManager.addSparks`): the trophies are re-evaluated and
   * the experience/collection notifications are announced. */
  CARDS_OBTAINED: 'CARDS_OBTAINED',
  /** Payload: `{ trophies }`. Emitted by TrophyManager once at least one trophy is unlocked for
   * the first time (the state is persisted before the event): the UI announces them. */
  TROPHY_UNLOCKED: 'TROPHY_UNLOCKED',
  /** Payload: `{ experience, level }`. Emitted by TrophyManager whenever the experience total or
   * the level changes: the profile page repaints its progress bar. */
  EXPERIENCE_UPDATED: 'EXPERIENCE_UPDATED',
});

class EventBus {
  constructor() {
    /** @type {Map<string, Array<{handler: Function, context: unknown, once: boolean}>>} */
    this.listeners = new Map();
  }

  /**
   * Registers a listener.
   *
   * @param {string} eventName - One of the `EVENTS` values.
   * @param {Function} handler - Callback invoked with `(payload, eventName)`.
   * @param {unknown} [context=null] - `this` binding used when calling the handler.
   * @returns {Function} An unsubscribe function, convenient for cleanup.
   * @throws {TypeError} When `eventName` is not a non-empty string or `handler` is not a function.
   */
  on(eventName, handler, context = null) {
    this.assertValidRegistration(eventName, handler);
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, []);
    }
    this.listeners.get(eventName).push({ handler, context, once: false });
    return () => this.off(eventName, handler, context);
  }

  /**
   * Registers a listener that is automatically removed after its first call.
   *
   * @param {string} eventName - One of the `EVENTS` values.
   * @param {Function} handler - Callback invoked with `(payload, eventName)`.
   * @param {unknown} [context=null] - `this` binding used when calling the handler.
   * @returns {Function} An unsubscribe function.
   * @throws {TypeError} When `eventName` is not a non-empty string or `handler` is not a function.
   */
  once(eventName, handler, context = null) {
    this.assertValidRegistration(eventName, handler);
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, []);
    }
    this.listeners.get(eventName).push({ handler, context, once: true });
    return () => this.off(eventName, handler, context);
  }

  /**
   * Removes a previously registered listener.
   *
   * @param {string} eventName - Event name.
   * @param {Function} [handler] - Handler to remove. When omitted, every listener of the
   *   event is removed (including the `once` ones).
   * @param {unknown} [context=null] - Context used at registration time.
   * @returns {void}
   */
  off(eventName, handler = null, context = null) {
    const registered = this.listeners.get(eventName);
    if (!registered) return;

    if (typeof handler !== 'function') {
      this.listeners.delete(eventName);
      return;
    }

    const remaining = registered.filter(
      (entry) => entry.handler !== handler || entry.context !== context
    );
    if (remaining.length === 0) {
      this.listeners.delete(eventName);
    } else {
      this.listeners.set(eventName, remaining);
    }
  }

  /**
   * Notifies every listener of an event.
   *
   * @param {string} eventName - Event name.
   * @param {unknown} [payload=null] - Data passed to the listeners.
   * @returns {number} The number of listeners that were called successfully.
   * @throws {TypeError} When `eventName` is not a non-empty string.
   */
  emit(eventName, payload = null) {
    if (typeof eventName !== 'string' || eventName === '') {
      throw new TypeError('EventBus.emit requires a non-empty event name.');
    }
    const registered = this.listeners.get(eventName);
    if (!registered || registered.length === 0) return 0;

    // Iterate over a copy: a listener may subscribe or unsubscribe during the dispatch.
    const snapshot = registered.slice();
    let called = 0;
    snapshot.forEach((entry) => {
      if (entry.once) {
        this.off(eventName, entry.handler, entry.context);
      }
      try {
        entry.handler.call(entry.context, payload, eventName);
        called += 1;
      } catch (error) {
        console.error(`[EventBus] Listener for "${eventName}" failed.`, error);
      }
    });
    return called;
  }

  /**
   * Removes every listener, either for a single event or for the whole bus.
   *
   * @param {string} [eventName] - Event to clear. When omitted, all events are cleared.
   * @returns {void}
   */
  clear(eventName = null) {
    if (eventName) {
      this.listeners.delete(eventName);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * Counts the listeners registered for an event.
   *
   * @param {string} eventName - Event name.
   * @returns {number} The listener count (0 when the event is unknown).
   */
  listenerCount(eventName) {
    const registered = this.listeners.get(eventName);
    return registered ? registered.length : 0;
  }

  /**
   * Validates registration arguments.
   *
   * @param {unknown} eventName - Candidate event name.
   * @param {unknown} handler - Candidate handler.
   * @returns {void}
   * @throws {TypeError} When an argument is invalid.
   */
  assertValidRegistration(eventName, handler) {
    if (typeof eventName !== 'string' || eventName === '') {
      throw new TypeError('EventBus requires a non-empty event name.');
    }
    if (typeof handler !== 'function') {
      throw new TypeError(`EventBus requires a function handler for "${eventName}".`);
    }
  }
}

/** Shared bus instance used by every module. */
export const eventBus = new EventBus();

export { EventBus };
export default eventBus;
