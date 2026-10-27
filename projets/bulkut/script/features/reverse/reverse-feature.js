/**
 * Reverse tab controller: one file, a suffix and a single reverse export.
 * @module features/reverse/reverse-feature
 */

import { describeError } from '../../core/app-error.js';
import { $, clear, el } from '../../core/dom.js';
import { fadeFromPreset, fadePresetValues, fadeSummary } from '../../core/fade.js';
import { buildOutputName, downloadBlob, formatBytes, probeVideoDuration, sanitizeSuffix } from '../../core/media.js';
import { saveParams } from '../../core/settings.js';
import { formatDuration, formatEta } from '../../core/timecode.js';
import { icon } from '../../ui/icons.js';
import { setupDropzone } from '../../ui/dropzone.js';
import { createFadeControl } from '../../ui/fade-control.js';
import { createPresetManager } from '../../ui/preset-manager.js';
import { validateVideoFile } from '../shared/video-file.js';
import { processReverse } from './reverse-processor.js';

const BUSY_STATUSES = new Set(['queued', 'importing', 'preparing', 'rendering']);

/**
 * @param {import('../../main.js').AppContext} ctx
 * @param {HTMLElement} panel
 */
export function createReverseFeature(ctx, panel) {
  const { settings, i18n, ffmpeg, queue, toasts } = ctx;
  const { processing } = settings;
  const params = settings.params.reverse;

  const els = {
    dropzone: $('#reverse-dropzone', panel),
    input: $('#reverse-input', panel),
    stage: $('#reverse-stage', panel),
    run: $('#reverse-run', panel),
    suffix: $('#reverse-suffix', panel),
    fade: $('#reverse-fade', panel),
  };

  const state = {
    /** @type {import('../../core/file-source.js').FileSource|null} */
    source: null,
    /** @type {symbol|null} */
    token: null,
    name: '',
    size: 0,
    duration: 0,
    status: 'empty',
    progress: 0,
    etaSeconds: 0,
    errorText: '',
    /** @type {{ name: string, size: number }|null} */
    result: null,
  };

  /** @type {null | Record<string, any>} */
  let ui = null;

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
    id: 'reverse-fade',
    bounds: settings.config.fade,
    onChange: () => saveParams(settings),
    onInvalid: ({ min, max }) => toasts.error(i18n.t('errors.numberRange', { min, max })),
  });
  els.fade?.append(fadeControl.element);

  const presetManager = createPresetManager({
    i18n,
    toasts,
    scope: 'reverse',
    sectionKey: 'nav.reverse',
    storageKey: settings.storageKeys.presets,
    container: $('#reverse-presets', panel),
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

  function isBusy() {
    return BUSY_STATUSES.has(state.status);
  }

  function refreshRun() {
    els.run.disabled = !state.source || isBusy() || queue.busy;
  }

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
        el('div', { class: 'video-meta', text: state.duration ? formatDuration(state.duration) : formatBytes(state.size) }),
      ),
      remove,
    );
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

    if (state.duration && state.duration > processing.reverseWarningSeconds) {
      els.stage.append(
        el('p', {
          class: 'stage-note is-warning',
          text: i18n.t('reverse.longWarning', { duration: formatDuration(state.duration) }),
        }),
      );
    }

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
    const job = el('div', { class: 'job-progress' }, jobMeta, el('div', { class: 'progress' }, jobBar));
    job.hidden = true;

    els.stage.append(job);
    ui = { job, jobText, jobEta, jobPercent, jobBar };
    syncJob();
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
        ? i18n.t('reverse.resultDone', { name: state.result.name })
        : i18n.t('common.done');
    } else {
      ui.jobText.textContent = i18n.t(`common.${status}`);
    }
  }

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

    const token = Symbol('reverse-import');
    state.token = token;
    state.source = null;
    state.name = file.name;
    state.size = file.size;
    state.duration = 0;
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
    state.status = 'idle';
    renderStage();
    refreshRun();

    probeVideoDuration(await source.getFile()).then((duration) => {
      if (state.token !== token) return;
      state.duration = duration;
      renderStage();
    });
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
    state.status = 'empty';
    state.progress = 0;
    state.errorText = '';
    state.result = null;
    renderStage();
    refreshRun();
  }

  function run() {
    if (!state.source || isBusy()) return;

    const snapshot = { source: state.source, name: state.name, suffix: params.suffix, fade: { ...params.fade } };
    state.status = 'queued';
    state.progress = 0;
    state.etaSeconds = 0;
    state.errorText = '';
    state.result = null;
    syncJob();
    refreshRun();

    queue
      .enqueue({
        id: 'reverse',
        label: snapshot.name,
        run: async () => {
          try {
            const result = await processReverse({
              ffmpeg,
              source: snapshot.source,
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
            toasts.success(i18n.t('reverse.resultDone', { name: filename }));
          } catch (error) {
            state.status = 'error';
            state.progress = 0;
            state.errorText = describeError(error, i18n);
            toasts.error(state.errorText);
          } finally {
            state.etaSeconds = 0;
            syncJob();
            refreshRun();
          }
        },
      })
      .catch((error) => console.error('[Bulkut] reverse job failed', error));
  }

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
