/**
 * Splitter tab: one video and any number of start/end ranges. Each range is
 * exported as its own file, with the tab's suffix and final fades.
 * @module features/splitter/splitter-feature
 */

import { describeError } from '../../core/app-error.js';
import { $, clear, el } from '../../core/dom.js';
import { fadeFromPreset, fadePresetValues, fadeSummary } from '../../core/fade.js';
import { buildOutputName, downloadBlob, formatBytes, probeVideoDuration, sanitizeSuffix } from '../../core/media.js';
import { saveParams } from '../../core/settings.js';
import { clamp, formatEta, formatTimecode, splitTimecode, timecodeToSeconds } from '../../core/timecode.js';
import { setupDropzone } from '../../ui/dropzone.js';
import { createFadeControl } from '../../ui/fade-control.js';
import { icon } from '../../ui/icons.js';
import { createPresetManager } from '../../ui/preset-manager.js';
import { probeDurationWithFFmpeg, validateVideoFile } from '../shared/video-file.js';
import { processSplit } from './splitter-processor.js';

const BUSY = new Set(['queued', 'importing', 'probing', 'preparing', 'rendering']);

/** @param {unknown} error */
function isCancelled(error) {
  return error instanceof Error && (error.code === 'cancelled' || error.name === 'CancelledError');
}

/**
 * @param {import('../../main.js').AppContext} ctx
 * @param {HTMLElement} panel
 */
export function createSplitterFeature(ctx, panel) {
  const { settings, i18n, ffmpeg, queue, toasts } = ctx;
  const { processing } = settings;
  const params = settings.params.splitter;

  const els = {
    suffix: $('#splitter-suffix', panel),
    fade: $('#splitter-fade', panel),
    presets: $('#splitter-presets', panel),
    run: $('#splitter-run', panel),
    stop: $('#splitter-stop', panel),
    add: $('#splitter-add', panel),
    input: $('#splitter-input', panel),
    dropzone: $('#splitter-dropzone', panel),
    stage: $('#splitter-stage', panel),
    count: $('#splitter-count', panel),
  };

  const state = {
    /** @type {import('../../core/file-source.js').FileSource|null} */
    source: null,
    token: null,
    name: '',
    size: 0,
    duration: 0,
    segments: [],
    nextId: 1,
    status: 'empty',
    progress: 0,
    etaSeconds: 0,
    errorText: '',
    resultCount: 0,
  };

  let running = null;
  /** @type {null | { job: HTMLElement, text: HTMLElement, eta: HTMLElement, percent: HTMLElement, bar: HTMLElement }} */
  let ui = null;
  /** @type {Array<{ segment: object, node: HTMLElement, sync: () => void }>} */
  let rows = [];

  // ---------------------------------------------------------------- settings

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
    id: 'splitter-fade',
    bounds: settings.config.fade,
    onChange: () => saveParams(settings),
    onInvalid: ({ min, max }) => toasts.error(i18n.t('errors.numberRange', { min, max })),
  });
  els.fade?.append(fadeControl.element);

  const presetManager = createPresetManager({
    i18n,
    toasts,
    scope: 'splitter',
    sectionKey: 'nav.splitter',
    storageKey: settings.storageKeys.presets,
    container: els.presets,
    getValues: () => ({ suffix: params.suffix, ...fadePresetValues(params.fade) }),
    applyValues: (values) => {
      params.suffix = sanitizeSuffix(values?.suffix);
      els.suffix.value = params.suffix;
      const fade = fadeFromPreset(values, params.fade, settings.config.fade);
      params.fade = fade;
      fadeControl.setValue(fade);
      saveParams(settings);
      refreshRun();
    },
    summarize: (values) => [
      { label: i18n.t('common.suffix.label'), value: String(values?.suffix ?? '') || '—' },
      ...fadeSummary(i18n.t.bind(i18n), fadeFromPreset(values, params.fade, settings.config.fade)),
    ],
  });

  // ---------------------------------------------------------------- helpers

  function isBusy() {
    return BUSY.has(state.status);
  }

  function minimumGap() {
    return Math.min(1, Math.max(0.1, state.duration));
  }

  function refreshRun() {
    if (!els.run) return;
    els.run.disabled = !state.source || isBusy() || queue.busy || state.segments.length === 0;
    if (els.count) els.count.textContent = String(state.segments.length);
  }

  function syncRow(row) {
    const segment = row.segment;
    const duration = Math.max(0.001, state.duration);
    const startPercent = (segment.start / duration) * 100;
    const endPercent = (segment.end / duration) * 100;

    row.start.range.value = String(startPercent);
    row.start.range.style.setProperty('--fill', `${startPercent}%`);
    row.end.range.value = String(endPercent);
    row.end.range.style.setProperty('--fill', `${endPercent}%`);

    const startParts = splitTimecode(segment.start);
    row.start.inputs.hours.value = String(startParts.hours);
    row.start.inputs.minutes.value = String(startParts.minutes);
    row.start.inputs.seconds.value = String(startParts.seconds);

    const endParts = splitTimecode(segment.end);
    row.end.inputs.hours.value = String(endParts.hours);
    row.end.inputs.minutes.value = String(endParts.minutes);
    row.end.inputs.seconds.value = String(endParts.seconds);

    const durationEl = row.node.querySelector('[data-role="segment-duration"]');
    if (durationEl) durationEl.textContent = formatTimecode(Math.max(0, segment.end - segment.start));
  }

  function syncRows() {
    for (const row of rows) syncRow(row);
  }

  /**
   * @param {object} segment
   * @param {'start'|'end'} kind
   * @param {number} seconds
   * @param {boolean} [feedback]
   */
  function setBoundary(segment, kind, seconds, feedback = false) {
    const duration = state.duration;
    const gap = minimumGap();
    const rounded = Math.round(Number(seconds) || 0);

    if (kind === 'start') {
      const maxStart = Math.max(0, segment.end - gap);
      const next = clamp(rounded, 0, maxStart);
      if (feedback && next !== rounded) toasts.error(i18n.t('errors.startBeforeEnd'));
      segment.start = next;
    } else {
      const minEnd = Math.min(duration, segment.start + gap);
      const next = clamp(rounded, minEnd, Math.floor(duration));
      if (feedback && next !== rounded) toasts.error(i18n.t('errors.endAfterStart'));
      segment.end = next;
    }

    const row = rows.find((entry) => entry.segment === segment);
    if (row) syncRow(row);
  }

  // ---------------------------------------------------------------- rows

  /** @param {'start'|'end'} kind @param {object} segment */
  function buildCutRow(kind, segment) {
    const range = el('input', {
      type: 'range',
      class: 'range',
      min: '0',
      max: '100',
      step: '0.1',
      value: '0',
      'aria-label': i18n.t(`splitter.${kind}`),
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
        const row = rows.find((entry) => entry.segment === segment);
        if (row) syncRow(row);
        toasts.error(i18n.t('errors.timecode'));
        return;
      }

      setBoundary(segment, kind, timecodeToSeconds(values[0], values[1], values[2]), true);
      refreshRun();
    };

    for (const input of Object.values(inputs)) {
      input.addEventListener('change', commit);
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        commit();
        input.blur();
      });
    }

    range.addEventListener('input', () => {
      const seconds = (Number(range.value) / 100) * state.duration;
      setBoundary(segment, kind, seconds);
      refreshRun();
    });

    const row = el(
      'div',
      { class: `cut-row is-${kind}` },
      el('div', { class: 'cut-head' }, el('span', { class: 'cut-title', text: i18n.t(`splitter.${kind}`) }), timecode),
      range,
    );

    return { row, range, inputs };
  }

  function buildSegmentRow(segment, index) {
    const start = buildCutRow('start', segment);
    const end = buildCutRow('end', segment);
    const remove = el(
      'button',
      {
        type: 'button',
        class: 'icon-btn is-danger',
        title: i18n.t('common.remove'),
        'aria-label': i18n.t('common.remove'),
      },
      el('span', { html: icon('trash', 16) }),
    );
    remove.disabled = isBusy();
    remove.addEventListener('click', () => removeSegment(segment));

    const node = el(
      'li',
      { class: 'segment-row' },
      el(
        'div',
        { class: 'segment-head' },
        el('span', { class: 'segment-index', text: `#${index + 1}` }),
        el('span', { class: 'segment-duration', 'data-role': 'segment-duration' }),
        remove,
      ),
      el('div', { class: 'segment-body' }, start.row, end.row),
    );

    const row = { segment, node, start, end, sync: () => syncRow(row) };
    syncRow(row);
    return row;
  }

  // ---------------------------------------------------------------- stage

  function buildFileStrip() {
    const remove = el(
      'button',
      { type: 'button', class: 'icon-btn is-danger', title: i18n.t('common.remove'), 'aria-label': i18n.t('common.remove') },
      el('span', { html: icon('trash', 17) }),
    );
    remove.disabled = isBusy();
    remove.addEventListener('click', removeFile);

    return el(
      'div',
      { class: 'file-strip' },
      el('span', { class: 'video-thumb', html: icon('film', 18) }),
      el(
        'div',
        { class: 'video-info' },
        el('div', { class: 'video-name-row' }, el('span', { class: 'video-name', text: state.name, title: state.name })),
        el('div', { class: 'video-meta', text: `${formatTimecode(state.duration)} · ${formatBytes(state.size)}` }),
      ),
      remove,
    );
  }

  function buildJobPanel() {
    const text = el('span');
    const eta = el('span', { class: 'video-eta', hidden: true });
    const percent = el('span', { class: 'video-percent' });
    const bar = el('div', { class: 'progress-bar' });
    const job = el(
      'div',
      { class: 'job-progress', hidden: true },
      el(
        'div',
        { class: 'job-progress-meta' },
        text,
        el('span', { class: 'video-status-right' }, eta, percent),
      ),
      el('div', { class: 'progress' }, bar),
    );
    return { job, text, eta, percent, bar };
  }

  function renderStage() {
    clear(els.stage);
    ui = null;
    rows = [];

    if (!state.name) {
      els.dropzone.hidden = false;
      if (els.count) els.count.textContent = '0';
      return;
    }

    els.dropzone.hidden = true;
    els.stage.append(buildFileStrip());

    if (state.status === 'importing') {
      els.stage.append(el('p', { class: 'stage-note', text: i18n.t('common.importing') }));
      return;
    }

    if (state.status === 'probing') {
      els.stage.append(el('p', { class: 'stage-note', text: i18n.t('splitter.probing') }));
      return;
    }

    if (!state.duration) {
      els.stage.append(el('p', { class: 'stage-note is-error', text: i18n.t('errors.duration') }));
      return;
    }

    const list = el('ul', { class: 'segment-list' });
    state.segments.forEach((segment, index) => {
      const row = buildSegmentRow(segment, index);
      rows.push(row);
      list.append(row.node);
    });
    els.stage.append(list);

    const add = el(
      'button',
      { type: 'button', class: 'btn btn-secondary btn-compact segment-add' },
      el('span', { class: 'btn-icon', html: icon('plus', 16) }),
      el('span', { text: i18n.t('splitter.addSegment') }),
    );
    add.disabled = isBusy() || state.segments.length >= Number(settings.config.splitter?.maxSegments ?? 50);
    add.addEventListener('click', addSegment);
    els.stage.append(add);

    ui = buildJobPanel();
    els.stage.append(ui.job);
    syncJob();
    refreshRun();
  }

  function syncJob() {
    if (!ui) return;
    const visible = isBusy() || state.status === 'done' || state.status === 'error';
    ui.job.hidden = !visible;
    ui.job.className = 'job-progress';
    if (!visible) return;

    const percent = Math.round((state.progress || 0) * 100);
    ui.bar.style.width = `${percent}%`;
    ui.percent.textContent = isBusy() ? `${percent}%` : state.status === 'done' ? '100%' : '';

    const eta = isBusy() && state.etaSeconds > 0 ? i18n.t('common.eta', { time: formatEta(state.etaSeconds) }) : '';
    ui.eta.textContent = eta;
    ui.eta.hidden = !eta;

    if (state.status === 'error') {
      ui.job.classList.add('is-error');
      ui.text.textContent = state.errorText || i18n.t('common.error');
    } else if (state.status === 'done') {
      ui.job.classList.add('is-done');
      ui.text.textContent = i18n.t('splitter.resultDone', { count: state.resultCount });
    } else {
      ui.text.textContent = i18n.t(`common.${state.status}`);
    }
  }

  // ---------------------------------------------------------------- segments

  function addSegment() {
    if (isBusy() || !state.duration) return;
    const max = Number(settings.config.splitter?.maxSegments ?? 50);
    if (state.segments.length >= max) {
      toasts.error(i18n.t('splitter.tooManySegments', { max }));
      return;
    }

    const last = state.segments[state.segments.length - 1];
    const gap = minimumGap();
    let start = Math.min(state.duration, Math.max(0, last?.end ?? 0));
    let end = Math.min(state.duration, start + Math.max(1, Math.round(state.duration / 4)));
    if (end - start < gap) {
      start = Math.max(0, state.duration - gap);
      end = state.duration;
    }

    state.segments.push({ id: state.nextId, start, end });
    state.nextId += 1;
    renderStage();
    refreshRun();
  }

  function removeSegment(segment) {
    if (isBusy() || state.segments.length <= 1) return;
    state.segments = state.segments.filter((entry) => entry !== segment);
    renderStage();
    refreshRun();
  }

  // ---------------------------------------------------------------- import

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

    const token = Symbol('splitter-import');
    state.token = token;
    state.source = null;
    state.name = file.name;
    state.size = file.size;
    state.duration = 0;
    state.segments = [];
    state.status = 'importing';
    state.progress = 0;
    state.errorText = '';
    state.resultCount = 0;
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

    state.duration = Math.max(1, Math.floor(duration));
    state.segments = [{ id: state.nextId, start: 0, end: state.duration }];
    state.nextId += 1;
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
    state.segments = [];
    state.status = 'empty';
    state.progress = 0;
    state.errorText = '';
    state.resultCount = 0;
    renderStage();
    refreshRun();
  }

  // ---------------------------------------------------------------- render

  function run() {
    if (!state.source || isBusy() || queue.busy || !state.segments.length) return;

    const snapshot = {
      source: state.source,
      name: state.name,
      suffix: params.suffix,
      fade: { ...params.fade },
      segments: state.segments.map((segment) => ({ start: segment.start, end: segment.end })),
    };

    running = { token: { cancelled: false }, cancelled: false };
    state.status = 'queued';
    state.progress = 0;
    state.etaSeconds = 0;
    state.errorText = '';
    state.resultCount = 0;
    syncJob();
    renderStage();
    syncJob();
    refreshRun();

    queue
      .enqueue({
        id: 'splitter',
        label: snapshot.name,
        run: async () => {
          try {
            const result = await processSplit({
              ffmpeg,
              source: snapshot.source,
              segments: snapshot.segments,
              processing,
              fade: snapshot.fade,
              token: running.token,
              hooks: {
                onPhase: (phase, progress, stats) => {
                  if (running?.cancelled) return;
                  state.status = phase;
                  state.progress = progress;
                  state.etaSeconds = stats?.etaSeconds ?? 0;
                  syncJob();
                },
              },
            });

            if (running?.cancelled) return;

            result.files.forEach((file, index) => {
              const filename = buildOutputName(
                snapshot.name,
                `${snapshot.suffix}-${String(index + 1).padStart(2, '0')}`,
              );
              downloadBlob(file.blob, filename);
            });

            state.status = 'done';
            state.progress = 1;
            state.resultCount = result.files.length;
            toasts.success(i18n.t('splitter.resultDone', { count: result.files.length }));
          } catch (error) {
            if (running?.cancelled || isCancelled(error)) {
              state.status = 'idle';
              state.progress = 0;
            } else {
              state.status = 'error';
              state.progress = 0;
              state.errorText = describeError(error, i18n);
              toasts.error(state.errorText);
            }
          } finally {
            running = null;
            state.etaSeconds = 0;
            renderStage();
            syncJob();
            refreshRun();
          }
        },
      })
      .catch((error) => console.error('[Bulkut] splitter job failed', error));
  }

  function stop() {
    if (!running) return;
    running.cancelled = true;
    running.token.cancelled = true;
    ffmpeg.cancel();
    state.status = 'idle';
    state.progress = 0;
    state.etaSeconds = 0;
    syncJob();
    refreshRun();
  }

  // ---------------------------------------------------------------- wiring

  setupDropzone({ zone: els.dropzone, input: els.input, onFiles: addFiles });
  els.add?.addEventListener('click', () => els.input.click());
  els.run?.addEventListener('click', run);
  els.stop?.addEventListener('click', stop);
  queue.subscribe(() => refreshRun());

  function refresh() {
    if (els.suffix !== document.activeElement) els.suffix.value = params.suffix;
    fadeControl.refresh();
    presetManager.refresh();
    renderStage();
    refreshRun();
  }

  refreshRun();
  return { refresh, addFiles, run, stop, getState: () => state };
}
