/**
 * Reusable fade panel: audio mode, video mode and one shared duration.
 * @module ui/fade-control
 */

import { el } from '../core/dom.js';
import { FADE_FALLBACK_BOUNDS, FADE_MODES, normalizeFade } from '../core/fade.js';
import { createSliderField } from './slider-field.js';

/**
 * @param {object} options
 * @param {import('../core/i18n.js').I18n} options.i18n
 * @param {{ audio: string, video: string, duration: number }} options.fade mutable fade object
 * @param {string} options.id prefix for the field ids
 * @param {{ min?: number, max?: number, step?: number, defaultDuration?: number }} [options.bounds]
 * @param {() => void} [options.onChange]
 * @param {(range: { min: number, max: number }) => void} [options.onInvalid]
 */
export function createFadeControl({ i18n, fade, id, bounds = FADE_FALLBACK_BOUNDS, onChange, onInvalid }) {
  const min = Number.isFinite(Number(bounds.min)) ? Number(bounds.min) : FADE_FALLBACK_BOUNDS.min;
  const max = Number.isFinite(Number(bounds.max)) ? Number(bounds.max) : FADE_FALLBACK_BOUNDS.max;
  const step = Number.isFinite(Number(bounds.step)) ? Number(bounds.step) : FADE_FALLBACK_BOUNDS.step;

  const root = el('section', { class: 'fade-control' });
  const title = el('p', { class: 'field-label', 'data-i18n': 'fade.title' });
  const hint = el('p', { class: 'field-hint', 'data-i18n': 'fade.hint' });
  root.append(title, hint);

  /** @param {'audio'|'video'} kind */
  function buildMode(kind) {
    const select = el('select', {
      class: 'select-input fade-select',
      id: `${id}-${kind}`,
      'data-i18n-aria-label': `fade.${kind}`,
    });
    const label = el('label', { class: 'fade-label', for: `${id}-${kind}`, 'data-i18n': `fade.${kind}` });
    const row = el('div', { class: 'fade-row' }, label, select);

    const paint = () => {
      const current = fade[kind];
      select.replaceChildren(
        ...FADE_MODES.map((mode) =>
          el('option', {
            value: mode,
            text: i18n.t(`fade.modes.${mode}`),
            selected: mode === current,
          }),
        ),
      );
      select.value = current;
    };

    select.addEventListener('change', () => {
      fade[kind] = FADE_MODES.includes(select.value) ? select.value : 'none';
      onChange?.();
    });

    paint();
    return { row, paint };
  }

  const audio = buildMode('audio');
  const video = buildMode('video');
  root.append(audio.row, video.row);

  const duration = createSliderField({
    id: `${id}-duration`,
    labelKey: 'fade.duration',
    hintKey: 'fade.durationHint',
    min,
    max,
    step,
    value: fade.duration,
    unit: 's',
    decimals: 1,
    onInput: (value) => {
      fade.duration = value;
      onChange?.();
    },
    onCommit: (value) => {
      fade.duration = value;
      onChange?.();
    },
    onInvalid,
  });
  root.append(duration.element);

  function paintDuration() {
    duration.setValue(fade.duration);
  }

  return {
    element: root,
    /** @param {{ audio?: string, video?: string, duration?: number }} next */
    setValue(next) {
      const normalized = normalizeFade(next, { min, max, defaultDuration: fade.duration }, fade);
      fade.audio = normalized.audio;
      fade.video = normalized.video;
      fade.duration = normalized.duration;
      audio.paint();
      video.paint();
      paintDuration();
    },
    getValue: () => ({ ...fade }),
    refresh() {
      audio.paint();
      video.paint();
      paintDuration();
      i18n.apply(root);
    },
  };
}
