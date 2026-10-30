/**
 * CardEffectsToggle - The "Effets" switch of a card detail.
 *
 * Reference: `css/base.css` (`.switch`), `css/components/card-shine.css` (`.card-effects`, and the
 * `.card-shine.is-off` rules that silence the foil, the brillance and the halo together).
 *
 * WHY IT IS SHARED. The collection and the opening summary show the same large card, so they owe
 * the player the same switch: a card whose effects can be switched off in one place and not in the
 * other is a bug the player reads as a missing feature. The markup is the shared `.switch` control
 * of `css/base.css` - the ROW is the button, so the caption is not a dead label next to a small
 * target, and `aria-checked` carries the state while `aria-label` names the switch.
 *
 * The choice is a reading comfort, not a preference: it lives on the view that owns the detail and
 * is not written to the account.
 */

import i18n from '../../utils/I18n.js';

/** Attribute of the switch, which both views use for their click delegation. */
export const CARD_EFFECTS_ATTRIBUTE = 'data-card-effects';

/** Attribute of the word next to the track ("Activés" / "Coupés"). */
const CARD_EFFECTS_STATE_ATTRIBUTE = 'data-card-effects-state';

/**
 * Builds the switch: its label on the left, the track and its caption on the right.
 *
 * @param {boolean} enabled - Current state.
 * @returns {HTMLButtonElement} The switch.
 */
export function buildCardEffectsToggle(enabled) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'switch card-effects';
  button.dataset.cardEffects = 'toggle';
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-checked', String(enabled));
  button.setAttribute('aria-label', i18n.t('card.effects.aria'));

  const label = document.createElement('span');
  label.className = 'card-effects__label';
  label.textContent = i18n.t('card.effects.toggle');

  const track = document.createElement('span');
  track.className = 'switch__track';
  track.setAttribute('aria-hidden', 'true');
  const thumb = document.createElement('span');
  thumb.className = 'switch__thumb';
  track.appendChild(thumb);

  const state = document.createElement('span');
  state.className = 'switch__state';
  state.setAttribute(CARD_EFFECTS_STATE_ATTRIBUTE, 'state');
  state.textContent = i18n.t(enabled ? 'card.effects.on' : 'card.effects.off');

  button.append(label, track, state);
  return button;
}

/**
 * Republishes a state on the switches already in the document.
 *
 * The view keeps the boolean, this rewrites the two places that show it (`aria-checked` for the
 * assistive technologies and screen readers, the caption for everyone else), so the two can never
 * disagree.
 *
 * @param {ParentNode|null} root - Element holding the switch.
 * @param {boolean} enabled - New state.
 * @returns {void}
 */
export function syncCardEffectsToggle(root, enabled) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll(`[${CARD_EFFECTS_ATTRIBUTE}]`).forEach((button) => {
    button.setAttribute('aria-checked', String(enabled));
  });
  root.querySelectorAll(`[${CARD_EFFECTS_STATE_ATTRIBUTE}]`).forEach((state) => {
    state.textContent = i18n.t(enabled ? 'card.effects.on' : 'card.effects.off');
  });
}

export default { buildCardEffectsToggle, syncCardEffectsToggle, CARD_EFFECTS_ATTRIBUTE };
