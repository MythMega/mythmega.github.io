/**
 * Slider + numeric textbox pair, kept in sync.
 *
 * - Dragging the slider updates the textbox live.
 * - Typing in the textbox updates the slider live when the value is in range.
 * - On blur/change the value is validated, clamped and normalised.
 * @module ui/slider-field
 */

import { el } from '../core/dom.js';
import { clamp, formatNumber, roundTo } from '../core/timecode.js';

/**
 * @param {object} options
 * @param {string} options.id
 * @param {string} options.labelKey translation key
 * @param {string} [options.hintKey]
 * @param {number} options.min
 * @param {number} options.max
 * @param {number} options.step
 * @param {number} options.value
 * @param {string} [options.unit]
 * @param {number} [options.decimals]
 * @param {(value: number) => void} [options.onInput] fired on every valid change
 * @param {(value: number) => void} [options.onCommit] fired on blur/change
 * @param {(range: { min: number, max: number }) => void} [options.onInvalid]
 */
export function createSliderField({
  id,
  labelKey,
  hintKey,
  min,
  max,
  step,
  value,
  unit = '',
  decimals = 2,
  onInput,
  onCommit,
  onInvalid,
}) {
  let current = clamp(Number(value) || 0, min, max);
  let lastValid = current;

  const label = el('label', { class: 'field-label', for: `${id}-number`, 'data-i18n': labelKey });
  const badge = el('span', { class: 'value-badge' });
  const head = el('div', { class: 'field-head' }, label, badge);

  const range = el('input', {
    type: 'range',
    class: 'range',
    id: `${id}-range`,
    min,
    max,
    step,
    value: current,
    'data-i18n-aria-label': labelKey,
  });

  const number = el('input', {
    type: 'number',
    class: 'number-input',
    id: `${id}-number`,
    min,
    max,
    step,
    value: current,
    inputmode: 'decimal',
    'data-i18n-aria-label': labelKey,
  });

  const numberWrap = el(
    'div',
    { class: 'number-wrap' },
    number,
    unit ? el('span', { class: 'unit', text: unit }) : null,
  );

  const row = el('div', { class: 'slider-row' }, range, numberWrap);
  const root = el(
    'div',
    { class: 'field slider-field' },
    head,
    row,
    hintKey ? el('p', { class: 'field-hint', 'data-i18n': hintKey }) : null,
  );

  function paint() {
    range.value = String(current);
    const span = max - min || 1;
    const fill = clamp(((current - min) / span) * 100, 0, 100);
    range.style.setProperty('--fill', `${fill}%`);
    badge.textContent = `${formatNumber(current, decimals)}${unit ? ` ${unit}` : ''}`;
  }

  /**
   * @param {number} next
   * @param {{ emit?: boolean, renderNumber?: boolean }} [options]
   */
  function setValue(next, { emit = true, renderNumber = true } = {}) {
    const parsed = Number(next);
    if (!Number.isFinite(parsed)) return;
    current = roundTo(clamp(parsed, min, max), Math.max(decimals, 2));
    paint();
    if (renderNumber) number.value = formatNumber(current, decimals);
    if (emit) onInput?.(current);
  }

  function flagInvalid() {
    number.value = formatNumber(lastValid, decimals);
    number.classList.remove('is-invalid');
    void number.offsetWidth;
    number.classList.add('is-invalid');
    window.setTimeout(() => number.classList.remove('is-invalid'), 800);
    onInvalid?.({ min, max });
  }

  function commit() {
    const parsed = number.valueAsNumber;
    if (!Number.isFinite(parsed)) {
      flagInvalid();
      return;
    }
    if (parsed < min || parsed > max) {
      flagInvalid();
      return;
    }
    setValue(parsed, { emit: true, renderNumber: true });
    lastValid = current;
    onCommit?.(current);
  }

  range.addEventListener('input', () => {
    const parsed = Number(range.value);
    setValue(parsed, { emit: true, renderNumber: true });
    lastValid = current;
  });

  range.addEventListener('change', () => {
    lastValid = current;
    onCommit?.(current);
  });

  number.addEventListener('input', () => {
    const parsed = number.valueAsNumber;
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) return;
    setValue(parsed, { emit: true, renderNumber: false });
    lastValid = current;
  });

  number.addEventListener('change', commit);
  number.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
      number.blur();
    }
  });

  paint();

  return {
    element: root,
    getValue: () => current,
    /** @param {number} next */
    setValue: (next) => {
      setValue(next, { emit: false, renderNumber: true });
      lastValid = current;
    },
    /** @param {boolean} disabled */
    setDisabled: (disabled) => {
      range.disabled = disabled;
      number.disabled = disabled;
      root.classList.toggle('is-disabled', disabled);
    },
  };
}
