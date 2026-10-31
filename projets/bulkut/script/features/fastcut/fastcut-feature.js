/**
 * Fastcut tab controller: one file, two percentage sliders (0–100 %) kept in
 * sync with hh:mm:ss textboxes, live output duration, suffix and export.
 * @module features/fastcut/fastcut-feature
 */

import { describeError } from '../../core/app-error.js';
import { $, clear, el } from '../../core/dom.js';
import { fadeFromPreset, fadePresetValues, fadeSummary } from '../../core/fade.js';
import { buildOutputName, downloadBlob, formatBytes, probeVideoDuration, sanitizeSuffix } from '../../core/media.js';
import { saveParams } from '../../core/settings.js';
import { clamp, formatEta, formatTimecode, splitTimecode, timecodeToSeconds } from '../../core/timecode.js';
import { icon } from '../../ui/icons.js';
import { setupDropzone } from '../../ui/dropzone.js';
import { createFadeControl } from '../../ui/fade-control.js';
import { createPresetManager } from '../../ui/preset-manager.js';
import { probeDurationWithFFmpeg, validateVideoFile } from '../shared/video-file.js';
import { processFastcut } from './fastcut-processor.js';

const BUSY_STATUSES = new Set(['queued', 'importing', 'preparing', 'rendering']);

/**
 * @param {import('../../main.js').AppContext} ctx
 * @param {HTMLElement} panel
 */
export function createFastcutFeature(ctx, panel) {
  const { settings, i18n, ffmpeg, queue, toasts } = ctx;
  const { processing } = settings;
  const params = settings.params.fastcut;

  const els = {
    dropzone: $('#fastcut-dropzone', panel),
    input: $('#fastcut-input', panel),
    stage: $('#fastcut-stage', panel),
    run: $('#fastcut-run', panel),
    suffix: $('#fastcut-suffix', panel),
    fade: $('#fastcut-fade', panel),
  };

  const state = {
    /** @type {import('../../core/file-source.js').FileSource|null} */
    source: null,
    /** @type {symbol|null} */
    token: null,
    name: '',
    size: 0,
    duration: 0,
    start: 0,
    end: 0,
    status: 'empty',
    progress: 0,
    etaSeconds: 0,
    errorText: '',
    /** @type {{ name: string, size: number }|null} */
    result: null,
  };

  /** @type {null | Record<string, any>} */
  let ui = null;

  // -------------------------------------------------------------- suffix

  els.suffix.value = params.suffix;
  const commitSuffix = () => {
    const clean = sanitizeSuffix(els.suffix.value);
    els.suffix.value = clean;
    params.suffix = clean;
    saveParams(settings);
  };
  els.suffix.addEventListener('change', commitSuffix);
  els.suffix.addEventListener('blur', commitSuffix);

  const fadeControl = createFadeControl({
    i18n,
    fade: params.fade,
    id: 'fastcut-fade',
    bounds: settings.config.fade,
    onChange: () => saveParams(settings),
    onInvalid: ({ min, max }) => toasts.error(i18n.t('errors.numberRange', { min, max })),
  });
  els.fade?.append(fadeControl.element);

  const presetManager = createPresetManager({
    i18n,
    toasts,
    scope: 'fastcut',
    sectionKey: 'nav.fastcut',
    storageKey: settings.storageKeys.presets,
    container: $('#fastcut-presets', panel),
    getValues: () => ({ suffix: params.suffix, ...fadePresetValues(params.fade) }),
    applyValues: (values) => {
      params.suffix = sanitizeSuffix(values?.suffix);
      els.suffix.value = params.suffix;
      const fade = fadeFromPreset(values, params.fade, settings.config.fade);
      params.fade = fade;
      fadeControl.setValue(fade);
      saveParams(settings);
    },
    summarize: (values) => [
      { label: i18n.t('common.suffix.label'), value: String(values?.suffix ?? '') || '—' },
      ...fadeSummary(i18n.t.bind(i18n), fadeFromPreset(values, params.fade, settings.config.fade)),
    ],
  });

  // -------------------------------------------------------------- helpers

  function isBusy() {
    return BUSY_STATUSES.has(state.status);
  }

  function outputLength() {
    return Math.max(0, state.end - state.start);
  }

  function refreshRun() {
    els.run.disabled =
      !state.source || state.status === 'probing' || isBusy() || queue.busy || outputLength() < 1;
  }

  /** @param {number} seconds @param {boolean} [feedback] */
  function setStart(seconds, feedback = false) {
    const maxStart = Math.max(0, Math.min(state.end - 1, Math.floor(state.duration) - 1));
    const rounded = Math.round(seconds);
    const clamped = clamp(rounded, 0, maxStart);
    if (feedback && clamped !== rounded) toasts.error(i18n.t('errors.startBeforeEnd'));
    state.start = clamped;
    syncStage();
    refreshRun();
  }

  /** @param {number} seconds @param {boolean} [feedback] */
  function setEnd(seconds, feedback = false) {
    const maxEnd = Math.max(1, Math.floor(state.duration));
    const minEnd = Math.min(maxEnd, state.start + 1);
    const rounded = Math.round(seconds);
    const clamped = clamp(rounded, minEnd, maxEnd);
    if (feedback && clamped !== rounded) toasts.error(i18n.t('errors.endAfterStart'));
    state.end = clamped;
    syncStage();
    refreshRun();
  }

  // -------------------------------------------------------------- stage

  function buildFileStrip() {
    const remove = el(
      'button',
      {
        type: 'button',
        class: 'icon-btn is-danger',
        title: i18n.t('common.remove'),
        'aria-label': i18n.t('common.remove'),
      },
      el('span', { html: icon('trash', 17) }),
    );
    remove.addEventListener('click', removeFile);

    return el(
      'div',
      { class: 'file-strip' },
      el('span', { class: 'video-thumb', html: icon('film', 18) }),
      el(
        'div',
        { class: 'video-info' },
        el('div', { class: 'video-name-row' }, el('span', { class: 'video-name', text: state.name, title: state.name })),
        el('div', {
          class: 'video-meta',
          text: state.duration
            ? `${formatTimecode(state.duration)} · ${formatBytes(state.size)}`
            : formatBytes(state.size),
        }),
      ),
      remove,
    );
  }

  /**
   * @param {'start'|'end'} kind
   */
  function buildCutRow(kind) {
    const range = el('input', {
      type: 'range',
      class: 'range',
      min: '0',
      max: '100',
      step: '0.1',
      value: '0',
      'aria-label': i18n.t(`fastcut.${kind}`),
    });

    const inputs = {};
    const part = (name, max) => {
      const input = el('input', {
        type: 'number',
        class: 'tc-input',
        min: '0',
        max: String(max),
        step: '1',
        value: '0',
        inputmode: 'numeric',
      });
      inputs[name] = input;
      return el('div', { class: 'tc' }, input, el('span', { class: 'tc-label', text: i18n.t(`common.${name}`) }));
    };

    const timecode = el(
      'div',
      { class: 'tc-group' },
      part('hours', 99),
      el('span', { class: 'tc-sep', text: ':' }),
      part('minutes', 59),
      el('span', { class: 'tc-sep', text: ':' }),
      part('seconds', 59),
    );

    const commit = () => {
      const values = [inputs.hours.valueAsNumber, inputs.minutes.valueAsNumber, inputs.seconds.valueAsNumber];
      const valid =
        values.every((value) => Number.isFinite(value)) &&
        values[0] >= 0 &&
        values[0] <= 99 &&
        values[1] >= 0 &&
        values[1] <= 59 &&
        values[2] >= 0 &&
        values[2] <= 59;

      if (!valid) {
        syncStage();
        toasts.error(i18n.t('errors.timecode'));
        return;
      }

      const total = timecodeToSeconds(values[0], values[1], values[2]);
      if (kind === 'start') setStart(total, true);
      else setEnd(total, true);
    };

    for (const input of Object.values(inputs)) {
      input.addEventListener('change', commit);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
          input.blur();
        }
      });
    }

    range.addEventListener('input', () => {
      const seconds = (Number(range.value) / 100) * state.duration;
      if (kind === 'start') setStart(seconds);
      else setEnd(seconds);
    });

    const row = el(
      'div',
      { class: `cut-row is-${kind}` },
      el(
        'div',
        { class: 'cut-head' },
        el('span', { class: 'cut-title', text: i18n.t(`fastcut.${kind}`) }),
        timecode,
      ),
      range,
    );

    return { row, range, inputs };
  }

  function buildTimeline() {
    const start = buildCutRow('start');
    const end = buildCutRow('end');
    const timeline = el('div', { class: 'timeline' }, start.row, end.row);

    const outputValue = el('div', { class: 'output-value', text: '00:00:00' });
    const outputSub = el('div', { class: 'output-sub' });
    const output = el(
      'div',
      { class: 'output-card' },
      el(
        'div',
        {},
        el('div', { class: 'output-label', text: i18n.t('common.outputDuration') }),
        el('div', { class: 'output-sub', text: i18n.t('fastcut.outputHint') }),
      ),
      el('div', { class: 'output-readout' }, outputValue, outputSub),
    );

    const jobText = el('span');
    const jobEta = el('span', { class: 'video-eta' });
    const jobPercent = el('span', { class: 'video-percent' });
    const jobMeta = el(
      'div',
      { class: 'job-progress-meta' },
      jobText,
      el('span', { class: 'video-status-right' }, jobEta, jobPercent),
    );
    const jobBar = el('div', { class: 'progress-bar' });
    const jobBarWrap = el('div', { class: 'progress' }, jobBar);
    const job = el('div', { class: 'job-progress' }, jobMeta, jobBarWrap);
    job.hidden = true;

    els.stage.append(timeline, output, job);

    ui = { start, end, outputValue, outputSub, job, jobText, jobEta, jobPercent, jobBar, jobBarWrap };
    syncStage();
  }

  function renderStage() {
    clear(els.stage);
    ui = null;

    if (!state.name) {
      els.dropzone.hidden = false;
      return;
    }

    els.dropzone.hidden = true;
    els.stage.append(buildFileStrip());

    if (state.status === 'importing') {
      els.stage.append(el('p', { class: 'stage-note', text: i18n.t('common.importing') }));
      return;
    }

    if (state.status === 'probing') {
      els.stage.append(el('p', { class: 'stage-note', text: i18n.t('fastcut.probing') }));
      return;
    }

    if (!state.duration) {
      els.stage.append(el('p', { class: 'stage-note is-error', text: i18n.t('errors.duration') }));
      return;
    }

    buildTimeline();
    syncJob();
  }

  function syncStage() {
    if (!ui) return;

    const duration = Math.max(0.001, state.duration);
    const startPercent = (state.start / duration) * 100;
    const endPercent = (state.end / duration) * 100;

    ui.start.range.value = String(startPercent);
    ui.start.range.style.setProperty('--fill', `${startPercent}%`);
    ui.end.range.value = String(endPercent);
    ui.end.range.style.setProperty('--fill', `${endPercent}%`);

    const startParts = splitTimecode(state.start);
    ui.start.inputs.hours.value = String(startParts.hours);
    ui.start.inputs.minutes.value = String(startParts.minutes);
    ui.start.inputs.seconds.value = String(startParts.seconds);

    const endParts = splitTimecode(state.end);
    ui.end.inputs.hours.value = String(endParts.hours);
    ui.end.inputs.minutes.value = String(endParts.minutes);
    ui.end.inputs.seconds.value = String(endParts.seconds);

    const length = outputLength();
    ui.outputValue.textContent = formatTimecode(length);
    ui.outputSub.textContent = i18n.t('fastcut.lengthSeconds', { seconds: Math.round(length) });

    const disabled = isBusy();
    ui.start.range.disabled = disabled;
    ui.end.range.disabled = disabled;
    for (const input of Object.values(ui.start.inputs)) input.disabled = disabled;
    for (const input of Object.values(ui.end.inputs)) input.disabled = disabled;
  }

  function syncJob() {
    if (!ui) return;

    const status = state.status;
    const visible = isBusy() || status === 'done' || status === 'error';
    ui.job.hidden = !visible;
    ui.job.className = 'job-progress';
    if (!visible) return;

    const percent = Math.round((state.progress || 0) * 100);
    ui.jobBar.style.width = `${percent}%`;
    ui.jobPercent.textContent = isBusy() ? `${percent}%` : status === 'done' ? '100%' : '';

    const eta =
      isBusy() && state.etaSeconds > 0
        ? i18n.t('common.eta', { time: formatEta(state.etaSeconds) })
        : '';
    ui.jobEta.textContent = eta;
    ui.jobEta.hidden = !eta;

    if (status === 'error') {
      ui.job.classList.add('is-error');
      ui.jobText.textContent = state.errorText || i18n.t('common.error');
    } else if (status === 'done') {
      ui.job.classList.add('is-done');
      ui.jobText.textContent = state.result?.name
        ? i18n.t('fastcut.resultDone', { name: state.result.name })
        : i18n.t('common.done');
    } else {
      ui.jobText.textContent = i18n.t(`common.${status}`);
    }
  }

  // -------------------------------------------------------------- actions

  async function addFiles(files) {
    const file = files[0];
    if (!file) return;
    if (isBusy()) {
      toasts.error(i18n.t('errors.busy'));
      return;
    }

    const error = validateVideoFile(file, { i18n, processing, skipSizeLimit: ctx.isPro });
    if (error) {
      toasts.error(error);
      return;
    }

    const token = Symbol('fastcut-import');
    state.token = token;
    state.source = null;
    state.name = file.name;
    state.size = file.size;
    state.duration = 0;
    state.start = 0;
    state.end = 0;
    state.status = 'importing';
    state.progress = 0;
    state.errorText = '';
    state.result = null;
    renderStage();
    refreshRun();

    let source;
    try {
      source = await ctx.createSource(file);
    } catch (importError) {
      if (state.token !== token) return;
      state.status = 'error';
      state.errorText = describeError(importError, i18n);
      toasts.error(state.errorText);
      renderStage();
      refreshRun();
      return;
    }
    if (state.token !== token) {
      await source.remove();
      return;
    }

    state.source = source;
    state.status = 'probing';
    renderStage();
    refreshRun();

    let duration = await probeVideoDuration(await source.getFile());
    if (state.token !== token) return;
    if (!duration) {
      const info = await probeDurationWithFFmpeg(ffmpeg, source);
      duration = info.duration;
    }
    if (state.token !== token) return;

    if (!duration) {
      state.status = 'error';
      state.errorText = i18n.t('errors.duration');
      toasts.error(state.errorText);
      renderStage();
      refreshRun();
      return;
    }

    state.duration = duration;
    state.start = 0;
    state.end = Math.max(1, Math.floor(duration));
    state.status = 'idle';
    renderStage();
    refreshRun();
  }

  function removeFile() {
    if (isBusy()) {
      toasts.error(i18n.t('errors.busy'));
      return;
    }
    const previous = state.source;
    state.token = null;
    state.source = null;
    previous?.remove();
    state.name = '';
    state.size = 0;
    state.duration = 0;
    state.start = 0;
    state.end = 0;
    state.status = 'empty';
    state.progress = 0;
    state.errorText = '';
    state.result = null;
    renderStage();
    refreshRun();
  }

  function run() {
    if (!state.source || isBusy() || state.status === 'probing') return;

    const snapshot = {
      source: state.source,
      name: state.name,
      start: state.start,
      end: state.end,
      suffix: params.suffix,
      fade: { ...params.fade },
    };

    state.status = 'queued';
    state.progress = 0;
    state.etaSeconds = 0;
    state.errorText = '';
    state.result = null;
    syncStage();
    syncJob();
    refreshRun();

    queue
      .enqueue({
        id: 'fastcut',
        label: snapshot.name,
        run: async () => {
          try {
            const result = await processFastcut({
              ffmpeg,
              source: snapshot.source,
              start: snapshot.start,
              end: snapshot.end,
              processing,
              fade: snapshot.fade,
              hooks: {
                onPhase: (phase, progress, stats) => {
                  state.status = phase;
                  state.progress = progress;
                  state.etaSeconds = stats?.etaSeconds ?? 0;
                  syncJob();
                },
              },
            });

            const filename = buildOutputName(snapshot.name, snapshot.suffix);
            downloadBlob(result.blob, filename);
            state.status = 'done';
            state.progress = 1;
            state.result = { name: filename, size: result.blob.size };
            toasts.success(i18n.t('fastcut.resultDone', { name: filename }));
          } catch (error) {
            state.status = 'error';
            state.progress = 0;
            state.errorText = describeError(error, i18n);
            toasts.error(state.errorText);
          } finally {
            state.etaSeconds = 0;
            syncStage();
            syncJob();
            refreshRun();
          }
        },
      })
      .catch((error) => console.error('[Bulkut] fastcut job failed', error));
  }

  // -------------------------------------------------------------- wiring

  setupDropzone({ zone: els.dropzone, input: els.input, onFiles: addFiles });
  els.run.addEventListener('click', run);
  queue.subscribe(() => refreshRun());

  function refresh() {
    renderStage();
    refreshRun();
    fadeControl.refresh();
    presetManager.refresh();
  }

  refreshRun();
  return { refresh, addFiles, run, getState: () => state };
}
