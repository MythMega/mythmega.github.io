/**
 * Reverse tab controller: one file, a suffix and a single reverse export.
 * @module features/reverse/reverse-feature
 */

import { describeError } from '../../core/app-error.js';
import { $, clear, el } from '../../core/dom.js';
import { buildOutputName, downloadBlob, formatBytes, probeVideoDuration, sanitizeSuffix } from '../../core/media.js';
import { saveParams } from '../../core/settings.js';
import { formatDuration } from '../../core/timecode.js';
import { icon } from '../../ui/icons.js';
import { setupDropzone } from '../../ui/dropzone.js';
import { validateVideoFile } from '../shared/video-file.js';
import { processReverse } from './reverse-processor.js';

const BUSY_STATUSES = new Set(['queued', 'preparing', 'rendering']);

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
  };

  const state = {
    /** @type {File|null} */
    file: null,
    name: '',
    size: 0,
    duration: 0,
    status: 'empty',
    progress: 0,
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

  function isBusy() {
    return BUSY_STATUSES.has(state.status);
  }

  function refreshRun() {
    els.run.disabled = !state.file || isBusy() || queue.busy;
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

    if (!state.file) {
      els.dropzone.hidden = false;
      return;
    }

    els.dropzone.hidden = true;
    els.stage.append(buildFileStrip());

    if (state.duration && state.duration > processing.reverseWarningSeconds) {
      els.stage.append(
        el('p', {
          class: 'stage-note is-warning',
          text: i18n.t('reverse.longWarning', { duration: formatDuration(state.duration) }),
        }),
      );
    }

    const jobText = el('span');
    const jobPercent = el('span', { class: 'video-percent' });
    const jobMeta = el('div', { class: 'job-progress-meta' }, jobText, jobPercent);
    const jobBar = el('div', { class: 'progress-bar' });
    const job = el('div', { class: 'job-progress' }, jobMeta, el('div', { class: 'progress' }, jobBar));
    job.hidden = true;

    els.stage.append(job);
    ui = { job, jobText, jobPercent, jobBar };
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

  function addFiles(files) {
    const file = files[0];
    if (!file) return;
    if (isBusy()) {
      toasts.error(i18n.t('errors.busy'));
      return;
    }

    const error = validateVideoFile(file, { i18n, processing });
    if (error) {
      toasts.error(error);
      return;
    }

    state.file = file;
    state.name = file.name;
    state.size = file.size;
    state.duration = 0;
    state.status = 'idle';
    state.progress = 0;
    state.errorText = '';
    state.result = null;
    renderStage();
    refreshRun();

    probeVideoDuration(file).then((duration) => {
      if (state.file !== file) return;
      state.duration = duration;
      renderStage();
    });
  }

  function removeFile() {
    if (isBusy()) {
      toasts.error(i18n.t('errors.busy'));
      return;
    }
    state.file = null;
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
    if (!state.file || isBusy()) return;

    const snapshot = { file: state.file, name: state.name, suffix: params.suffix };
    state.status = 'queued';
    state.progress = 0;
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
              file: snapshot.file,
              processing,
              hooks: {
                onPhase: (phase, progress) => {
                  state.status = phase;
                  state.progress = progress;
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
  }

  refreshRun();
  return { refresh, addFiles, run, getState: () => state };
}
