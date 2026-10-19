/**
 * CardTilt - Drag-to-tilt of a card DETAIL surface.
 *
 * Reference: `settings/config.json` (section `cardDetail`), `CollectionView`, `ProfileView`,
 * `MineBlockView`, `OpeningView`, `StatsView` and `binder-share.js` (every place a card is shown
 * large enough to be handled).
 *
 * Holding a card with the mouse (or a finger) and moving tilts it by at most
 * `cardDetail.maxRotationDeg` on each axis, and `cardDetail.thicknessPx` paints a slight edge under
 * it. Releasing the pointer springs the card back to its resting position. The limits are read from
 * the configuration once per page, so a designer can make the effect subtler (or switch it off)
 * without touching the code.
 *
 * A controller is deliberately tiny and idempotent: `attach()` returns the SAME controller for the
 * same element, so a detail modal that is rebuilt on every open never stacks listeners. It never
 * prevents the click: a tap that does not move still reaches the button or the link around the card.
 */

import { configLoader, DEFAULT_CARD_DETAIL_SETTINGS } from './ConfigLoader.js';

/** Largest perspective, in pixels, used for the tilt. Smaller values exaggerate the rotation. */
const PERSPECTIVE_PX = 900;

/** Distance, in pixels, a press must travel before it counts as a drag rather than a click. */
const DRAG_THRESHOLD_PX = 3;

/** One shared settings read, so every card detail uses the same limits. */
let settingsPromise = null;

/**
 * Reads the interaction limits (cached for the page).
 *
 * @returns {Promise<{enabled: boolean, maxTiltDegrees: number, thicknessPx: number}>} The settings.
 */
export function getCardDetailSettings() {
  if (!settingsPromise) {
    settingsPromise = configLoader
      .getCardDetailSettings()
      .catch((error) => {
        console.warn('[CardTilt] The card detail settings could not be read: shipped values are used.', error);
        return { ...DEFAULT_CARD_DETAIL_SETTINGS };
      });
  }
  return settingsPromise;
}

/** Controllers already attached, keyed by element. */
const controllers = new WeakMap();

export class CardTilt {
  /**
   * @param {HTMLElement} element - The card (or the image of the card) that is dragged.
   * @param {object} settings - Value returned by `getCardDetailSettings()`.
   */
  constructor(element, settings) {
    if (!(element instanceof HTMLElement)) {
      throw new TypeError('CardTilt requires an HTML element.');
    }
    this.element = element;
    this.settings = settings;
    this.pointerId = null;
    this.startX = 0;
    this.startY = 0;
    this.isDragging = false;
    this.originalBoxShadow = element.style.boxShadow;
    this.originalTouchAction = element.style.touchAction;
    this.originalDraggable = 'draggable' in element ? element.draggable : null;
    this.onPointerDown = this.handlePointerDown.bind(this);
    this.onPointerMove = this.handlePointerMove.bind(this);
    this.onPointerUp = this.handlePointerUp.bind(this);
    // A card detail may WRAP its illustration (the collection artwork is a div): the browser drags
    // the child image as a file unless the gesture is cancelled at the container.
    this.onDragStart = (event) => event.preventDefault();
  }

  /** Applies the resting thickness and binds the pointer listeners. */
  attach() {
    this.element.classList.add('card-tilt');
    // An illustration is a normal image: the browser would otherwise drag the FILE instead of
    // letting the pointer tilt the card.
    if ('draggable' in this.element) this.element.draggable = false;
    this.element.style.setProperty('--card-tilt-thickness', `${this.settings.thicknessPx}px`);
    // The browser must not scroll the modal instead of tracking the finger.
    this.element.style.touchAction = 'none';
    this.element.addEventListener('pointerdown', this.onPointerDown);
    this.element.addEventListener('pointermove', this.onPointerMove);
    this.element.addEventListener('pointerup', this.onPointerUp);
    this.element.addEventListener('pointercancel', this.onPointerUp);
    this.element.addEventListener('lostpointercapture', this.onPointerUp);
    this.element.addEventListener('dragstart', this.onDragStart);
    return this;
  }

  /**
   * Handles the press that starts a drag.
   *
   * @param {PointerEvent} event - Pointer event.
   * @returns {void}
   */
  handlePointerDown(event) {
    if (!this.settings.enabled || event.button !== 0 || !event.isPrimary) return;
    this.pointerId = event.pointerId;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.isDragging = false;
    try {
      this.element.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic pointer (a test, a very old browser) cannot be captured: the listeners still
      // receive the moves while the pointer stays over the card, which is enough.
    }
  }

  /**
   * Tilts the card while the pointer moves.
   *
   * @param {PointerEvent} event - Pointer event.
   * @returns {void}
   */
  handlePointerMove(event) {
    if (this.pointerId === null || event.pointerId !== this.pointerId) return;
    if (!this.isDragging) {
      const travelled = Math.hypot(event.clientX - this.startX, event.clientY - this.startY);
      if (travelled < DRAG_THRESHOLD_PX) return;
      this.isDragging = true;
      this.element.classList.add('is-dragging');
    }

    const rect = this.element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const ratioX = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1));
    const ratioY = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1));
    const max = this.settings.maxTiltDegrees;
    const rotateX = (-ratioY * max).toFixed(2);
    const rotateY = (ratioX * max).toFixed(2);
    this.element.style.transform =
      `perspective(${PERSPECTIVE_PX}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
  }

  /**
   * Springs the card back to rest when the pointer is released or cancelled.
   *
   * @param {PointerEvent} event - Pointer event.
   * @returns {void}
   */
  handlePointerUp(event) {
    if (this.pointerId === null || event.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.isDragging = false;
    this.element.classList.remove('is-dragging');
    this.element.style.transform = '';
    try {
      if (this.element.hasPointerCapture(event.pointerId)) {
        this.element.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Nothing to release: the capture was refused on press.
    }
  }

  /** Restores the element exactly as it was before the controller was attached. */
  destroy() {
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.element.removeEventListener('pointermove', this.onPointerMove);
    this.element.removeEventListener('pointerup', this.onPointerUp);
    this.element.removeEventListener('pointercancel', this.onPointerUp);
    this.element.removeEventListener('lostpointercapture', this.onPointerUp);
    this.element.removeEventListener('dragstart', this.onDragStart);
    this.element.classList.remove('card-tilt', 'is-dragging');
    this.element.style.transform = '';
    this.element.style.boxShadow = this.originalBoxShadow;
    this.element.style.touchAction = this.originalTouchAction;
    if (this.originalDraggable !== null) this.element.draggable = this.originalDraggable;
    this.element.style.removeProperty('--card-tilt-thickness');
    controllers.delete(this.element);
  }
}

/**
 * Attaches the tilt to one card detail (idempotent).
 *
 * The interactive class and its resting thickness are applied immediately, so the card already
 * looks like an object while the (cached) settings load. An element that was already attached gets
 * its existing controller back, listeners included.
 *
 * @param {HTMLElement|null} element - Card or card image.
 * @returns {CardTilt|null} The controller, or null when the element cannot be tilted.
 */
export function attachCardTilt(element) {
  if (!(element instanceof HTMLElement)) return null;
  const existing = controllers.get(element);
  if (existing) return existing;

  // The shipped values are used until the file answers: the thickness is visual only, so starting
  // from 6 px and correcting it a moment later never breaks a layout.
  const controller = new CardTilt(element, { ...DEFAULT_CARD_DETAIL_SETTINGS });
  controllers.set(element, controller);
  controller.attach();
  void getCardDetailSettings().then((settings) => {
    if (!settings.enabled) {
      controller.destroy();
      return;
    }
    controller.settings = settings;
    controller.element.style.setProperty('--card-tilt-thickness', `${settings.thicknessPx}px`);
  });
  return controller;
}
