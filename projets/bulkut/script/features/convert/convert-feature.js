/**
 * Convert tab: re-encode a list of videos into another container, with the
 * bitrate left to FFmpeg or set explicitly. Formats the running FFmpeg build
 * cannot write are hidden from the format list.
 * @module features/convert/convert-feature
 */

import { describeError } from '../../core/app-error.js';
import {
  defaultConvertTargets,
  normalizeBitrateChoice,
  normalizeConvertFormat,
} from '../../core/convert.js';
import { $, clear, el } from '../../core/dom.js';
import { buildOutputName, downloadBlob, formatBytes, sanitizeSuffix } from '../../core/media.js';
import { saveParams } from '../../core/settings.js';
import { formatDuration, formatEta } from '../../core/timecode.js';
import { setupDropzone } from '../../ui/dropzone.js';
import { icon } from '../../ui/icons.js';
import { importVideoFile } from '../shared/import-video.js';
import { detectConvertTargets, processConvert } from './convert-processor.js';

const IMPORTING = 'importing';
const PROBING = 'probing';
const BUSY = new Set(['queued', 'preparing', 'rendering']);

/** @param {unknown} error */
function isCancelled(error) {
  return error instanceof Error && (error.code === 'cancelled' || error.name === 'CancelledError');
}

/**
 * @param {import('../../main.js').AppContext} ctx
 * @param {HTMLElement} panel
 */
export function createConvertFeature(ctx, panel) {
  const { settings, i18n, ffmpeg, queue, toasts } = ctx;
  const { processing } = settings;
  const params = settings.params.convert;

  const els = {
    format: $('#convert-format', panel),
    support: $('#convert-support', panel),
    videoMode: $('#convert-video-mode', panel),
    videoBitrate: $('#convert-video-bitrate', panel),
    audioMode: $('#convert-audio-mode', panel),
    audioBitrate: $('#convert-audio-bitrate', panel),
    suffix: $('#convert-suffix', panel),
    run: $('#convert-run', panel),
    runLabel: $('#convert-run [data-role="label"]', panel),
    stop: $('#convert-stop', panel),
    job: $('#convert-job', panel),
    jobText: $('#convert-job-text', panel),
    jobEta: $('#convert-job-eta', panel),
    jobPercent: $('#convert-job-percent', panel),
    jobBar: $('#convert-job-bar', panel),
    add: $('#convert-add', panel),
    input: $('#convert-input', panel),
    dropzone: $('#convert-dropzone', panel),
    list: $('#convert-list', panel),
    empty: $('#convert-empty', panel),
    count: $('#convert-count', panel),
  };

  const state = {
    /** @type {Array<object>} */
    items: [],
    /** @type {Map<number, ReturnType<typeof createRow>>} */
    views: new Map(),
    nextId: 1,
    targets: defaultConvertTargets(),
    detected: false,
    detecting: null,
  };

  /** @type {null | { token: { cancelled: boolean }, cancelled: boolean }} */
  let running = null;

  // -------------------------------------------------------------- settings

  params.suffix = sanitizeSuffix(params.suffix);
  els.suffix.value = params.suffix;
  const commitSuffix = () => {
    const clean = sanitizeSuffix(els.suffix.value);
    els.suffix.value = clean;
    params.suffix = clean;
    saveParams(settings);
  };
  els.suffix?.addEventListener('change', commitSuffix);
  els.suffix?.addEventListener('blur', commitSuffix);

  function syncBitrateField(kind) {
    const mode = els[`${kind}Mode`];
    const bitrate = els[`${kind}Bitrate`];
    if (!mode || !bitrate) return;

    const auto = normalizeBitrateChoice(params[`${kind}Bitrate`]) === 'auto';
    mode.value = auto ? 'auto' : 'custom';
    bitrate.disabled = auto;
    bitrate.hidden = auto;
    if (!auto) bitrate.value = normalizeBitrateChoice(params[`${kind}Bitrate`]);
  }

  function commitBitrate(kind) {
    const mode = els[`${kind}Mode`];
    const bitrate = els[`${kind}Bitrate`];
    if (!mode || !bitrate) return;

    const value = mode.value === 'auto' ? 'auto' : normalizeBitrateChoice(bitrate.value);
    params[`${kind}Bitrate`] = value;
    saveParams(settings);
    syncBitrateField(kind);
  }

  for (const kind of ['video', 'audio']) {
    els[`${kind}Mode`]?.addEventListener('change', () => commitBitrate(kind));
    els[`${kind}Bitrate`]?.addEventListener('change', () => commitBitrate(kind));
    els[`${kind}Bitrate`]?.addEventListener('blur', () => commitBitrate(kind));
    syncBitrateField(kind);
  }

  // -------------------------------------------------------------- formats

  function selectedTarget() {
    const id = normalizeConvertFormat(params.format);
    return state.targets.find((target) => target.id === id) ?? state.targets[0] ?? null;
  }

  function fillFormats() {
    if (!els.format) return;
    clear(els.format);

    for (const target of state.targets) {
      const option = el('option', { value: target.id, text: target.id.toUpperCase() });
      els.format.append(option);
    }

    const target = selectedTarget();
    if (!target) {
      els.format.disabled = true;
      return;
    }

    if (params.format !== target.id) {
      params.format = target.id;
      saveParams(settings);
    }
    els.format.value = target.id;
    els.format.disabled = false;

    if (els.support) {
      els.support.textContent = i18n.t('convert.support', {
        formats: state.targets.map((entry) => entry.id.toUpperCase()).join(', '),
      });
    }
  }

  els.format?.addEventListener('change', () => {
    params.format = normalizeConvertFormat(els.format.value);
    saveParams(settings);
    syncAll();
  });

  /**
   * Detection loads the engine, so it only runs when the tab is actually
   * opened. A build that cannot answer keeps the standard format list.
   */
  function ensureTargets() {
    if (state.detected || state.detecting) return state.detecting;

    state.detecting = (async () => {
      try {
        const targets = await detectConvertTargets(ffmpeg);
        if (targets?.length) {
          state.targets = targets;
          state.detected = true;
          fillFormats();
          syncAll();
        }
      } catch (error) {
        if (!isCancelled(error)) console.warn('[Bulkut] Could not list the conversion formats.', error);
      } finally {
        state.detecting = null;
      }
    })();

    return state.detecting;
  }

  // -------------------------------------------------------------- helpers

  function readyItems() {
    return state.items.filter((item) => item.source && item.status !== 'error');
  }

  function isImporting() {
    return state.items.some((item) => item.status === IMPORTING || item.status === PROBING);
  }

  function syncAll() {
    for (const item of state.items) state.views.get(item.id)?.sync();
  }

  function refreshChrome() {
    const ready = readyItems().length;
    if (els.count) els.count.textContent = String(state.items.length);
    if (els.empty) els.empty.hidden = state.items.length > 0;

    if (els.run) {
      els.run.disabled = ready === 0 || Boolean(running) || isImporting() || queue.busy;
    }
    if (els.runLabel) els.runLabel.textContent = i18n.t('convert.run', { count: ready });
    if (els.stop) {
      els.stop.hidden = !running;
      els.stop.disabled = !running;
    }
  }

  function paintJob(status, progress, stats) {
    if (!els.job) return;

    els.job.hidden = false;
    const percent = Math.round(Math.min(1, Math.max(0, Number(progress) || 0)) * 100);
    els.jobText.textContent = i18n.t(`common.${status}`);
    els.jobBar.style.width = `${percent}%`;
    els.jobPercent.textContent = `${percent}%`;

    const eta = stats?.etaSeconds > 0 ? i18n.t('common.eta', { time: formatEta(stats.etaSeconds) }) : '';
    els.jobEta.textContent = eta;
    els.jobEta.hidden = !eta;
  }

  function hideJob() {
    if (!els.job) return;
    els.job.hidden = true;
    els.jobBar.style.width = '0%';
    els.jobEta.hidden = true;
  }

  // -------------------------------------------------------------- rows

  /** @param {object} item */
  function createRow(item) {
    const nameEl = el('span', { class: 'video-name', text: item.name, title: item.name });
    const metaEl = el('div', { class: 'video-meta' });

    const progressBar = el('div', { class: 'progress-bar' });
    const progressEl = el(
      'div',
      { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' },
      progressBar,
    );

    const statusTextEl = el('span', { class: 'video-status-text' });
    const percentEl = el('span', { class: 'video-percent' });
    const statusEl = el('div', { class: 'video-status' }, statusTextEl, percentEl);

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
    remove.addEventListener('click', () => removeItem(item));

    const node = el(
      'li',
      { class: 'video-item', dataset: { id: String(item.id) } },
      el(
        'div',
        { class: 'video-row' },
        el('span', { class: 'video-thumb', html: icon('film', 18) }),
        el(
          'div',
          { class: 'video-info' },
          el('div', { class: 'video-name-row' }, nameEl),
          metaEl,
          progressEl,
          statusEl,
        ),
        el('div', { class: 'video-actions' }, remove),
      ),
    );

    function sync() {
      const busy = BUSY.has(item.status) || item.status === IMPORTING;
      const failed = item.status === 'error';
      const done = item.status === 'done';
      const percent = Math.round((item.progress || 0) * 100);
      const format = selectedTarget();

      const details = [];
      if (item.duration) details.push(formatDuration(item.duration));
      details.push(formatBytes(item.size));
      if (format) details.push(`→ ${format.id.toUpperCase()}`);
      metaEl.textContent = details.join(' · ');

      node.classList.toggle('is-busy', busy);
      node.classList.toggle('is-error', failed);
      node.classList.toggle('is-done', done);

      progressEl.hidden = !busy && !done && !failed;
      progressBar.style.width = `${percent}%`;
      progressEl.setAttribute('aria-valuenow', String(percent));

      statusEl.hidden = !busy && !done && !failed && item.status !== 'idle';
      statusEl.className = `video-status${failed ? ' is-error' : done ? ' is-done' : ''}`;
      statusTextEl.textContent =
        item.status === IMPORTING
          ? i18n.t('common.importing')
          : item.status === PROBING
            ? i18n.t('convert.probing')
            : item.status === 'idle'
              ? ''
              : failed
                ? item.errorText || i18n.t('common.error')
                : i18n.t(`common.${item.status}`);
      percentEl.textContent = busy ? `${percent}%` : done ? '100%' : '';

      remove.disabled = busy || Boolean(running);
      remove.title = i18n.t('common.remove');
    }

    return { node, sync };
  }

  // -------------------------------------------------------------- list

  /** @param {File} file */
  async function addFile(file) {
    /** @type {object} */
    const item = {
      id: state.nextId,
      source: null,
      name: file.name,
      size: file.size,
      duration: 0,
      status: IMPORTING,
      progress: 0,
      errorText: '',
    };
    state.nextId += 1;

    const view = createRow(item);
    state.items.push(item);
    state.views.set(item.id, view);
    els.list.append(view.node);
    view.sync();
    refreshChrome();

    try {
      const result = await importVideoFile(file, ctx, {
        onProgress: (ratio) => {
          if (!state.views.has(item.id)) return;
          item.progress = ratio;
          view.sync();
        },
      });

      if (!state.views.has(item.id)) {
        await result.source?.remove();
        return;
      }

      if (result.error) {
        item.status = 'error';
        item.errorText = result.error;
        item.progress = 0;
        toasts.error(result.error);
      } else {
        item.source = result.source;
        item.duration = result.duration || 0;
        item.status = 'idle';
        item.progress = 0;
      }
    } catch (error) {
      if (!state.views.has(item.id)) return;
      item.status = 'error';
      item.progress = 0;
      item.errorText = describeError(error, i18n);
      toasts.error(item.errorText);
    }

    view.sync();
    refreshChrome();
  }

  /** @param {File[]} files */
  async function addFiles(files) {
    if (!files?.length) return;
    for (const file of files) {
      if (running) {
        toasts.error(i18n.t('errors.busy'));
        return;
      }
      await addFile(file);
    }
    ensureTargets();
  }

  /** @param {object} item */
  function removeItem(item) {
    if (running || BUSY.has(item.status) || item.status === IMPORTING) {
      toasts.error(i18n.t('errors.busy'));
      return;
    }

    state.items = state.items.filter((entry) => entry !== item);
    state.views.get(item.id)?.node.remove();
    state.views.delete(item.id);
    item.source?.remove();
    refreshChrome();
  }

  // -------------------------------------------------------------- render

  function run() {
    if (running || queue.busy || isImporting()) return;

    const items = readyItems();
    const target = selectedTarget();
    if (!items.length || !target) return;

    const snapshot = {
      target,
      videoBitrate: normalizeBitrateChoice(params.videoBitrate),
      audioBitrate: normalizeBitrateChoice(params.audioBitrate),
      suffix: params.suffix,
    };

    running = { token: { cancelled: false }, cancelled: false };
    for (const item of items) {
      item.status = 'queued';
      item.progress = 0;
      item.errorText = '';
    }
    paintJob('queued', 0);
    syncAll();
    refreshChrome();

    queue
      .enqueue({
        id: 'convert',
        label: i18n.t('convert.run', { count: items.length }),
        run: async () => {
          let lastResult = null;

          for (let index = 0; index < items.length; index += 1) {
            if (running?.cancelled) break;
            const item = items[index];
            const from = index / items.length;
            const span = 1 / items.length;

            item.status = 'preparing';
            item.progress = 0;
            syncAll();
            paintJob('preparing', from);

            try {
              const result = await processConvert({
                ffmpeg,
                source: item.source,
                target: snapshot.target,
                videoBitrate: snapshot.videoBitrate,
                audioBitrate: snapshot.audioBitrate,
                processing,
                token: running.token,
                hooks: {
                  onPhase: (status, ratio, stats) => {
                    if (running?.cancelled) return;
                    item.status = status;
                    item.progress = ratio;
                    syncAll();
                    paintJob(status, from + ratio * span, stats);
                  },
                },
              });

              if (running?.cancelled) break;

              const filename = buildOutputName(item.name, snapshot.suffix, snapshot.target.extension);
              downloadBlob(result.blob, filename);
              item.status = 'done';
              item.progress = 1;
              lastResult = filename;
            } catch (error) {
              if (running?.cancelled || isCancelled(error)) {
                item.status = 'idle';
                item.progress = 0;
                break;
              }

              item.status = 'error';
              item.progress = 0;
              item.errorText = describeError(error, i18n);
              toasts.error(item.errorText);
            }

            syncAll();
            paintJob(item.status === 'error' ? 'error' : 'rendering', (index + 1) / items.length);
            refreshChrome();
          }

          if (!running?.cancelled) paintJob('done', 1);
          if (lastResult && !running?.cancelled) {
            toasts.success(i18n.t('convert.done', { count: items.filter((item) => item.status === 'done').length }));
          }

          running = null;
          refreshChrome();
        },
      })
      .catch((error) => console.error('[Bulkut] convert job failed', error))
      .finally(() => {
        if (running) running = null;
        syncAll();
        refreshChrome();
      });
  }

  function stop() {
    if (!running) return;
    running.cancelled = true;
    running.token.cancelled = true;
    ffmpeg.cancel();

    for (const item of state.items) {
      if (BUSY.has(item.status)) {
        item.status = 'idle';
        item.progress = 0;
      }
    }

    toasts.info(i18n.t('convert.stopped'));
    hideJob();
    syncAll();
    refreshChrome();
  }

  // -------------------------------------------------------------- wiring

  setupDropzone({ zone: els.dropzone, input: els.input, onFiles: addFiles });
  if (els.add && els.input) els.add.addEventListener('click', () => els.input.click());
  els.run?.addEventListener('click', run);
  els.stop?.addEventListener('click', stop);
  queue.subscribe(() => refreshChrome());

  function refresh() {
    if (els.suffix !== document.activeElement && els.suffix) els.suffix.value = params.suffix;
    syncBitrateField('video');
    syncBitrateField('audio');
    fillFormats();
    syncAll();
    refreshChrome();
  }

  fillFormats();
  refreshChrome();

  return {
    refresh,
    addFiles,
    run,
    stop,
    onActivate: ensureTargets,
    getItems: () => state.items,
    getTargets: () => state.targets,
  };
}
