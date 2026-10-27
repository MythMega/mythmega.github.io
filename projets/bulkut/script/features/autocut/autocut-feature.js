/**
 * Autocut tab controller.
 *
 * Global settings apply to every video; a video can store its own override
 * (four FFmpeg parameters) through the gear dialog. Rendering goes through the
 * shared sequential queue, so only one video is processed at a time.
 *
 * Jobs can be cancelled: skipping stops the current render, "cancel following"
 * drops the queued ones, "stop all" does both. Estimating the output duration
 * reuses the same silence analysis without encoding.
 * @module features/autocut/autocut-feature
 */

import { describeError } from '../../core/app-error.js';
import { $, clear, debounce } from '../../core/dom.js';
import { fadeFromPreset, fadePresetValues, fadeSummary } from '../../core/fade.js';
import { buildOutputName, downloadBlob, probeVideoDuration, sanitizeSuffix } from '../../core/media.js';
import { isTimelineFormat, normalizeOutputFormat, outputExtension, outputLabelKey } from '../../core/output-format.js';
import { saveParams } from '../../core/settings.js';
import { clamp, formatNumber } from '../../core/timecode.js';
import { createDialogController } from '../../ui/dialog.js';
import { createFadeControl } from '../../ui/fade-control.js';
import { createPresetManager } from '../../ui/preset-manager.js';
import { setupDropzone } from '../../ui/dropzone.js';
import { createSliderField } from '../../ui/slider-field.js';
import { validateVideoFile } from '../shared/video-file.js';
import { getAutocutFieldSpecs, hasRenderParamsChanged, renderParamsOf } from './autocut-fields.js';
import { estimateAutocut, exportAutocutTimeline, processAutocut } from './autocut-processor.js';
import { createAutocutItemView, isBusyStatus } from './autocut-view.js';

const ESTIMATE_DELAY = 3000;

/** @param {unknown} error */
function isCancelled(error) {
  return error instanceof Error && (error.code === 'cancelled' || error.name === 'CancelledError');
}

/** @returns {{ status: string, progress: number, duration: number, clips: number, paramsKey: string, errorText: string }} */
function emptyEstimate() {
  return { status: 'idle', progress: 0, duration: 0, clips: 0, paramsKey: '', errorText: '' };
}

/**
 * @param {import('../../main.js').AppContext} ctx
 * @param {HTMLElement} panel
 */
export function createAutocutFeature(ctx, panel) {
  const { settings, i18n, ffmpeg, queue, toasts, isPro, createSource } = ctx;
  const { processing } = settings;
  const params = settings.params.autocut;
  const fieldSpecs = getAutocutFieldSpecs(settings.config);

  const els = {
    fields: $('#autocut-fields', panel),
    suffix: $('#autocut-suffix', panel),
    output: $('#autocut-output', panel),
    fade: $('#autocut-fade', panel),
    autoEstimate: $('#autocut-auto-estimate', panel),
    runAll: $('#autocut-run-all', panel),
    runLabel: $('#autocut-run-all [data-role="label"]', panel),
    queuePanel: $('#autocut-queue-panel', panel),
    queueActive: $('#autocut-queue-active', panel),
    skip: $('#autocut-skip', panel),
    cancelNext: $('#autocut-cancel-next', panel),
    stopAll: $('#autocut-stop-all', panel),
    add: $('#autocut-add', panel),
    input: $('#autocut-input', panel),
    dropzone: $('#autocut-dropzone', panel),
    list: $('#autocut-list', panel),
    empty: $('#autocut-empty', panel),
    count: $('#autocut-count', panel),
    dialog: $('#autocut-dialog'),
    dialogFields: $('#autocut-dialog-fields'),
    dialogOutput: $('#autocut-dialog-output'),
    dialogTitle: $('#autocut-dialog-title'),
    dialogHint: $('#autocut-dialog-hint'),
    dialogSave: $('#autocut-dialog-save'),
    dialogReset: $('#autocut-dialog-reset'),
  };

  const state = {
    items: [],
    /** @type {Map<number, ReturnType<typeof createAutocutItemView>>} */
    views: new Map(),
    nextId: 1,
  };

  /** Global slider controls, so a preset can update the UI too. */
  const fieldControls = new Map();

  /** Render and preview jobs, keyed by item id. */
  const jobs = new Map();
  /** Estimate jobs, kept apart so the queue controls can separate them. */
  const estimateJobs = new Map();
  /** @type {null | { item: object, kind: 'render'|'excerpt'|'estimate', started: boolean, cancelled: boolean }} */
  let activeJob = null;

  const dialog = createDialogController(els.dialog);
  /** @type {null | object} */
  let dialogItem = null;
  /** @type {null | Record<string, number>} */
  let dialogDraft = null;
  /** @type {Array<ReturnType<typeof createSliderField>>} */
  let dialogFields = [];

  const persistLater = debounce(() => saveParams(settings), 250);

  const fadeControl = createFadeControl({
    i18n,
    fade: params.fade,
    id: 'autocut-fade',
    bounds: settings.config.fade,
    onChange: () => {
      persistLater();
      handleParamsChanged();
    },
    onInvalid: ({ min, max }) => toasts.error(i18n.t('errors.numberRange', { min, max })),
  });
  els.fade?.append(fadeControl.element);

  let autoEstimate = readAutoEstimate();

  // ---------------------------------------------------------------- helpers

  /** @param {object} item */
  function effectiveParams(item) {
    return item.override ? { ...params, ...item.override } : { ...params };
  }

  /** @param {object} item */
  function estimateKey(item) {
    return JSON.stringify(renderParamsOf(effectiveParams(item)));
  }

  /** @param {object} item */
  function canRun(item) {
    if (!item.source) return false;
    return item.status === 'idle' || item.status === 'error' || (item.status === 'done' && item.stale);
  }

  /**
   * Mark finished videos whose effective settings no longer match the settings
   * used for their last render, so they can be rendered again.
   * @param {object} [target]
   */
  function refreshStaleness(target) {
    const items = target ? [target] : state.items;
    for (const item of items) {
      if (item.status !== 'done' || !item.renderedParams) continue;
      item.stale = hasRenderParamsChanged(item.renderedParams, effectiveParams(item));
    }
  }

  /** @param {object} item */
  function syncItem(item) {
    const view = state.views.get(item.id);
    if (view) view.sync(effectiveParams(item));
  }

  function syncAllItems() {
    for (const item of state.items) syncItem(item);
  }

  function hasAutocutWork() {
    return jobs.size > 0 || estimateJobs.size > 0;
  }

  function pendingRenderCount() {
    let count = 0;
    for (const job of jobs.values()) if (!job.started) count += 1;
    return count;
  }

  function refreshChrome() {
    els.count.textContent = String(state.items.length);
    els.empty.hidden = state.items.length > 0;

    const pending = state.items.filter(canRun).length;
    els.runLabel.textContent = i18n.t('autocut.runAll', { count: pending });
    els.runAll.disabled = pending === 0 || queue.busy;

    if (els.autoEstimate) els.autoEstimate.checked = autoEstimate;

    if (!els.queuePanel) return;
    const work = hasAutocutWork();
    els.queuePanel.hidden = !work;
    if (!work) return;

    const waiting = pendingRenderCount() + [...estimateJobs.values()].filter((job) => !job.started).length;
    els.queueActive.textContent = activeJob
      ? i18n.t('autocut.queue.active', { name: activeJob.item.name })
      : i18n.t('autocut.queue.waiting', { count: waiting });

    els.skip.disabled = !activeJob;
    els.cancelNext.disabled = pendingRenderCount() === 0;
    els.stopAll.disabled = !work;
  }

  // ---------------------------------------------------------------- estimates

  function readAutoEstimate() {
    try {
      return localStorage.getItem(settings.storageKeys.autoEstimate) === 'true';
    } catch {
      return false;
    }
  }

  function persistAutoEstimate() {
    try {
      localStorage.setItem(settings.storageKeys.autoEstimate, String(autoEstimate));
    } catch {
      /* Storage can be unavailable. */
    }
  }

  /** @param {object} item */
  function resetEstimate(item) {
    item.estimate = emptyEstimate();
  }

  /**
   * Drop an estimate that no longer matches the current parameters. A running
   * analysis is flagged so its result is discarded when it lands.
   * @param {object} item
   */
  function invalidateIfOutdated(item) {
    const job = estimateJobs.get(item.id);
    const key = estimateKey(item);

    if (item.estimate.status === 'ready' && item.estimate.paramsKey === key) return;
    if (job && job.paramsKey === key) return;

    if (job) {
      if (!job.started) {
        job.cancelled = true;
        job.token.cancelled = true;
        estimateJobs.delete(item.id);
        resetEstimate(item);
      } else {
        job.stale = true;
      }
      syncItem(item);
      return;
    }

    if (item.estimate.status !== 'idle') {
      resetEstimate(item);
      syncItem(item);
    }
  }

  function invalidateOutdatedEstimates() {
    for (const item of state.items) invalidateIfOutdated(item);
  }

  function cancelQueuedEstimates() {
    for (const [id, job] of [...estimateJobs]) {
      if (job.started) continue;
      job.cancelled = true;
      job.token.cancelled = true;
      estimateJobs.delete(id);
      resetEstimate(job.item);
      syncItem(job.item);
    }
    refreshChrome();
  }

  /**
   * Schedule an estimate. Runs through the shared queue, so it waits for a
   * render in progress and shows up in the queue controls.
   * @param {object} item
   * @param {{ force?: boolean, manual?: boolean }} [options]
   */
  function enqueueEstimate(item, { force = false, manual = false } = {}) {
    if (!item.source || estimateJobs.has(item.id)) return;
    if (!force && item.estimate.status === 'ready' && item.estimate.paramsKey === estimateKey(item)) return;

    const job = {
      item,
      kind: 'estimate',
      started: false,
      cancelled: false,
      stale: false,
      manual,
      token: { cancelled: false },
      paramsKey: estimateKey(item),
      snapshot: { ...effectiveParams(item) },
    };
    estimateJobs.set(item.id, job);

    item.estimate.status = 'queued';
    item.estimate.progress = 0;
    item.estimate.errorText = '';
    item.estimate.duration = 0;
    item.estimate.clips = 0;
    syncItem(item);
    refreshChrome();

    queue
      .enqueue({
        id: `autocut-estimate-${item.id}`,
        label: `${item.name} — ${i18n.t('autocut.estimate.label')}`,
        run: () => runEstimateTask(job),
      })
      .catch((error) => console.error('[Bulkut] autocut estimate failed', error));
  }

  /** @param {{ item: object, cancelled: boolean, stale: boolean, manual: boolean, paramsKey: string, snapshot: Record<string, any> }} job */
  async function runEstimateTask(job) {
    if (job.cancelled) return;

    const item = job.item;
    job.started = true;
    activeJob = job;
    item.estimate.status = 'running';
    item.estimate.progress = 0;
    syncItem(item);
    refreshChrome();

    try {
      const result = await estimateAutocut({
        ffmpeg,
        source: item.source,
        params: job.snapshot,
        processing,
        durationHint: item.duration,
        token: job.token,
        hooks: {
          onPhase: (phase, progress) => {
            if (job.cancelled) return;
            item.estimate.status = 'running';
            item.estimate.progress = Math.min(1, Math.max(0, progress));
            syncItem(item);
          },
        },
      });

      if (job.cancelled) return;

      if (job.stale || estimateKey(item) !== job.paramsKey) {
        resetEstimate(item);
        if (autoEstimate) scheduleEstimates();
      } else {
        item.estimate.status = 'ready';
        item.estimate.progress = 1;
        item.estimate.duration = result.duration;
        item.estimate.clips = result.clips;
        item.estimate.paramsKey = job.paramsKey;
        item.estimate.errorText = '';
      }
    } catch (error) {
      if (job.cancelled || isCancelled(error)) {
        resetEstimate(item);
      } else {
        item.estimate.status = 'error';
        item.estimate.progress = 0;
        item.estimate.errorText = describeError(error, i18n);
        if (job.manual) toasts.error(item.estimate.errorText);
      }
    } finally {
      if (estimateJobs.get(item.id) === job) estimateJobs.delete(item.id);
      if (activeJob === job) activeJob = null;
      if (item.estimate.status === 'queued') resetEstimate(item);
      syncItem(item);
      refreshChrome();
    }
  }

  function estimateAll({ force = false } = {}) {
    for (const item of [...state.items]) {
      if (!item.source) continue;
      enqueueEstimate(item, { force });
    }
  }

  const scheduleEstimates = debounce(() => {
    if (!autoEstimate) return;
    estimateAll();
  }, ESTIMATE_DELAY);

  function handleAutoEstimateChange() {
    autoEstimate = Boolean(els.autoEstimate?.checked);
    persistAutoEstimate();

    if (autoEstimate) {
      estimateAll({ force: true });
    } else {
      cancelQueuedEstimates();
    }
    syncAllItems();
    refreshChrome();
  }

  // ---------------------------------------------------------------- settings

  function handleParamsChanged() {
    refreshStaleness();
    invalidateOutdatedEstimates();
    syncAllItems();
    refreshChrome();
    if (autoEstimate) scheduleEstimates();
  }

  for (const spec of fieldSpecs) {
    const field = createSliderField({
      id: `autocut-${spec.key}`,
      labelKey: `autocut.fields.${spec.label}`,
      hintKey: `autocut.fields.${spec.label}Hint`,
      min: spec.min,
      max: spec.max,
      step: spec.step,
      value: params[spec.key],
      unit: spec.unit,
      decimals: spec.decimals,
      onInput: (value) => {
        params[spec.key] = value;
        persistLater();
        handleParamsChanged();
      },
      onCommit: (value) => {
        params[spec.key] = value;
        saveParams(settings);
        handleParamsChanged();
      },
      onInvalid: ({ min, max }) => toasts.error(i18n.t('errors.numberRange', { min, max })),
    });
    fieldControls.set(spec.key, field);
    els.fields.append(field.element);
  }

  els.suffix.value = params.suffix;

  const commitSuffix = () => {
    const clean = sanitizeSuffix(els.suffix.value);
    els.suffix.value = clean;
    params.suffix = clean;
    saveParams(settings);
  };
  els.suffix.addEventListener('change', commitSuffix);
  els.suffix.addEventListener('blur', commitSuffix);

  if (els.output) {
    els.output.value = normalizeOutputFormat(params.output);
    els.output.addEventListener('change', () => {
      params.output = normalizeOutputFormat(els.output.value);
      saveParams(settings);
      handleParamsChanged();
    });
  }

  const presetManager = createPresetManager({
    i18n,
    toasts,
    scope: 'autocut',
    sectionKey: 'nav.autocut',
    storageKey: settings.storageKeys.presets,
    container: $('#autocut-presets', panel),
    getValues: () => {
      const values = {};
      for (const spec of fieldSpecs) values[spec.key] = params[spec.key];
      values.suffix = params.suffix;
      values.output = normalizeOutputFormat(params.output);
      Object.assign(values, fadePresetValues(params.fade));
      return values;
    },
    applyValues: (values) => {
      for (const spec of fieldSpecs) {
        const raw = Number(values?.[spec.key]);
        if (!Number.isFinite(raw)) continue;
        const next = clamp(raw, spec.min, spec.max);
        params[spec.key] = next;
        fieldControls.get(spec.key)?.setValue(next);
      }
      if (typeof values?.suffix === 'string') {
        params.suffix = sanitizeSuffix(values.suffix);
        els.suffix.value = params.suffix;
      }
      params.output = normalizeOutputFormat(values?.output);
      if (els.output) els.output.value = params.output;
      const fade = fadeFromPreset(values, params.fade, settings.config.fade);
      params.fade = fade;
      fadeControl.setValue(fade);
      saveParams(settings);
      handleParamsChanged();
    },
    summarize: (values) => {
      const rows = fieldSpecs.map((spec) => {
        const raw = Number(values?.[spec.key]);
        return {
          label: i18n.t(`autocut.fields.${spec.label}`),
          value: Number.isFinite(raw) ? `${formatNumber(raw, spec.decimals)} ${spec.unit}` : '—',
        };
      });
      rows.push({
        label: i18n.t('common.suffix.label'),
        value: String(values?.suffix ?? '') || '—',
      });
      rows.push({
        label: i18n.t('autocut.output.title'),
        value: i18n.t(outputLabelKey(values?.output)),
      });
      rows.push(...fadeSummary(i18n.t.bind(i18n), fadeFromPreset(values, params.fade, settings.config.fade)));
      return rows;
    },
  });

  if (els.autoEstimate) {
    els.autoEstimate.checked = autoEstimate;
    els.autoEstimate.addEventListener('change', handleAutoEstimateChange);
  }

  // ---------------------------------------------------------------- list

  async function addFiles(files) {
    for (const file of files) {
      const error = validateVideoFile(file, { i18n, processing, skipSizeLimit: isPro });
      if (error) {
        toasts.error(error);
        continue;
      }
      await addItem(file);
    }
  }

  /** @param {File} file */
  async function addItem(file) {
    const item = {
      id: state.nextId,
      /** @type {import('../../core/file-source.js').FileSource|null} */
      source: null,
      name: file.name,
      size: file.size,
      duration: 0,
      override: null,
      status: 'importing',
      progress: 0,
      etaSeconds: 0,
      errorText: '',
      result: null,
      stale: false,
      /** @type {Record<string, number>|null} */
      renderedParams: null,
      /** @type {'render'|'excerpt'|null} */
      jobKind: null,
      estimate: emptyEstimate(),
    };
    state.nextId += 1;

    const view = createAutocutItemView(item, { i18n, onAction: handleAction });
    state.items.push(item);
    state.views.set(item.id, view);
    els.list.append(view.node);
    syncItem(item);
    refreshChrome();

    let source;
    try {
      source = await createSource(file, {
        onProgress: (ratio) => {
          if (!state.views.has(item.id)) return;
          item.progress = ratio;
          syncItem(item);
        },
      });
    } catch (error) {
      if (!state.views.has(item.id)) return;
      item.status = 'error';
      item.progress = 0;
      item.errorText = describeError(error, i18n);
      toasts.error(item.errorText);
      syncItem(item);
      refreshChrome();
      return;
    }

    if (!state.views.has(item.id)) {
      await source.remove();
      return;
    }

    item.source = source;
    item.status = 'idle';
    item.progress = 0;
    syncItem(item);
    refreshChrome();

    const duration = await probeVideoDuration(await source.getFile());
    if (!state.views.has(item.id)) return;
    item.duration = duration;
    syncItem(item);

    if (autoEstimate) enqueueEstimate(item);
  }

  /**
   * @param {string} action
   * @param {object} item
   */
  function handleAction(action, item) {
    if (action === 'remove') removeItem(item);
    else if (action === 'configure') openItemDialog(item);
    else if (action === 'excerpt') renderPreview(item);
    else if (action === 'estimate') enqueueEstimate(item, { force: true, manual: true });
    else if (action === 'stop') cancelItemJob(item);
  }

  /** @param {object} item */
  function removeItem(item) {
    if (isBusyStatus(item.status) || item.status === 'importing') {
      toasts.error(i18n.t('errors.busy'));
      return;
    }

    const estimateJob = estimateJobs.get(item.id);
    if (estimateJob) {
      estimateJob.cancelled = true;
      estimateJob.token.cancelled = true;
      estimateJobs.delete(item.id);
      if (estimateJob.started) ffmpeg.cancel();
    }
    const renderJob = jobs.get(item.id);
    if (renderJob) return;

    state.items = state.items.filter((entry) => entry !== item);
    const view = state.views.get(item.id);
    if (view) view.node.remove();
    state.views.delete(item.id);
    item.source?.remove();
    refreshChrome();
  }

  // ---------------------------------------------------------------- rendering

  /**
   * @param {object} job
   * @returns {{ status: string, progress: number, stale: boolean, result: any }}
   */
  function previousStateOf(job) {
    return { ...job.previous };
  }

  /** @param {object} job */
  function restorePrevious(job) {
    const item = job.item;
    const previous = previousStateOf(job);
    item.status = previous.status;
    item.progress = previous.progress;
    item.etaSeconds = 0;
    item.stale = previous.stale;
    item.result = previous.result;
    item.errorText = previous.errorText ?? '';
    item.jobKind = null;
    refreshStaleness(item);
    syncItem(item);
  }

  /** @param {object} job */
  function cancelQueuedRender(job) {
    job.cancelled = true;
    job.token.cancelled = true;
    jobs.delete(job.item.id);
    restorePrevious(job);
    refreshChrome();
  }

  /** @param {object} job */
  function cancelRunningRender(job) {
    job.cancelled = true;
    job.token.cancelled = true;
    jobs.delete(job.item.id);
    restorePrevious(job);
    refreshChrome();
  }

  /** @param {object} item */
  function cancelItemJob(item) {
    const job = jobs.get(item.id);
    if (job) {
      if (job.started) {
        cancelRunningRender(job);
        ffmpeg.cancel();
      } else {
        cancelQueuedRender(job);
      }
      return;
    }

    const estimateJob = estimateJobs.get(item.id);
    if (estimateJob) {
      estimateJob.cancelled = true;
      estimateJob.token.cancelled = true;
      estimateJobs.delete(item.id);
      resetEstimate(item);
      syncItem(item);
      if (estimateJob.started) ffmpeg.cancel();
      refreshChrome();
    }
  }

  /** @param {object} item */
  function enqueueRender(item) {
    if (!canRun(item) || !item.source) return;

    const job = {
      item,
      kind: 'render',
      cancelled: false,
      started: false,
      token: { cancelled: false },
      snapshot: { ...effectiveParams(item), fade: { ...effectiveParams(item).fade } },
      previous: {
        status: item.status,
        progress: item.progress,
        stale: item.stale,
        result: item.result,
        errorText: item.errorText,
      },
    };
    jobs.set(item.id, job);

    item.status = 'queued';
    item.progress = 0;
    item.etaSeconds = 0;
    item.errorText = '';
    item.stale = false;
    item.jobKind = 'render';
    syncItem(item);
    refreshChrome();

    queue
      .enqueue({
        id: `autocut-${item.id}`,
        label: item.name,
        run: () => runRenderTask(job),
      })
      .catch((error) => console.error('[Bulkut] autocut job failed', error));
  }

  /** @param {object} job */
  async function runRenderTask(job) {
    if (job.cancelled) return;

    const item = job.item;
    job.started = true;
    activeJob = job;
    item.status = 'preparing';
    item.progress = 0.01;
    syncItem(item);
    refreshChrome();

    try {
      const onPhase = (phase, progress, stats) => {
        if (job.cancelled) return;
        item.status = phase;
        item.progress = progress;
        item.etaSeconds = stats?.etaSeconds ?? 0;
        syncItem(item);
      };

      const artifact = isTimelineFormat(job.snapshot.output)
        ? await buildTimelineArtifact(item, job.snapshot, onPhase)
        : await buildVideoArtifact(item, job.snapshot, onPhase);

      if (job.cancelled) return;

      downloadBlob(artifact.blob, artifact.filename);
      item.status = 'done';
      item.progress = 1;
      item.result = { name: artifact.filename, size: artifact.blob.size };
      item.renderedParams = renderParamsOf(job.snapshot);
      refreshStaleness(item);
      toasts.success(i18n.t('autocut.resultDone', { name: artifact.filename }));
    } catch (error) {
      if (job.cancelled || isCancelled(error)) {
        restorePrevious(job);
      } else {
        item.status = 'error';
        item.progress = 0;
        item.errorText = describeError(error, i18n);
        toasts.error(item.errorText);
      }
    } finally {
      if (jobs.get(item.id) === job) jobs.delete(item.id);
      if (activeJob === job) activeJob = null;
      item.jobKind = null;
      item.etaSeconds = 0;
      if (item.status === 'queued' || item.status === 'preparing' || item.status === 'analyzing' || item.status === 'rendering') {
        item.status = 'idle';
        item.progress = 0;
      }
      syncItem(item);
      refreshChrome();
    }
  }

  /**
   * Render the MP4 that Autocut normally produces.
   * @returns {Promise<{ blob: Blob, filename: string }>}
   */
  async function buildVideoArtifact(item, snapshot, onPhase) {
    const result = await processAutocut({
      ffmpeg,
      source: item.source,
      params: snapshot,
      processing,
      durationHint: item.duration,
      fade: { ...snapshot.fade },
      token: activeToken(item),
      hooks: { onPhase },
    });

    return { blob: result.blob, filename: buildOutputName(item.name, snapshot.suffix) };
  }

  /**
   * Write the kept segments as an editor timeline rather than encoding a video.
   * @returns {Promise<{ blob: Blob, filename: string }>}
   */
  async function buildTimelineArtifact(item, snapshot, onPhase) {
    const format = normalizeOutputFormat(snapshot.output);
    const result = await exportAutocutTimeline({
      ffmpeg,
      source: item.source,
      params: snapshot,
      processing,
      format,
      durationHint: item.duration,
      token: activeToken(item),
      hooks: { onPhase },
    });

    const extension = outputExtension(format);
    return {
      blob: new Blob([result.text], { type: 'application/xml;charset=utf-8' }),
      filename: buildOutputName(item.name, snapshot.suffix, extension),
    };
  }

  /** Token of the running job for this item, if any. */
  function activeToken(item) {
    return jobs.get(item.id)?.token ?? { cancelled: false };
  }

  function runAll() {
    for (const item of state.items) {
      if (canRun(item)) enqueueRender(item);
    }
  }

  /** @param {object} item */
  function renderPreview(item) {
    if (isBusyStatus(item.status) || !item.source) return;

    const job = {
      item,
      kind: 'excerpt',
      cancelled: false,
      started: false,
      token: { cancelled: false },
      snapshot: { ...effectiveParams(item), fade: { ...effectiveParams(item).fade } },
      previous: {
        status: item.status,
        progress: item.progress,
        stale: item.stale,
        result: item.result,
        errorText: item.errorText,
      },
    };
    jobs.set(item.id, job);

    item.status = 'queued';
    item.progress = 0;
    item.etaSeconds = 0;
    item.errorText = '';
    item.jobKind = 'excerpt';
    syncItem(item);
    refreshChrome();

    queue
      .enqueue({
        id: `autocut-preview-${item.id}`,
        label: `${item.name} — ${i18n.t('common.excerpt')}`,
        run: () => runPreviewTask(job),
      })
      .catch((error) => console.error('[Bulkut] preview job failed', error));
  }

  /** @param {object} job */
  async function runPreviewTask(job) {
    if (job.cancelled) return;

    const item = job.item;
    job.started = true;
    activeJob = job;
    item.status = 'preparing';
    item.progress = 0.01;
    syncItem(item);
    refreshChrome();

    try {
      const result = await processAutocut({
        ffmpeg,
        source: item.source,
        params: job.snapshot,
        processing,
        durationHint: item.duration,
        preview: { duration: processing.previewDuration },
        fade: { ...job.snapshot.fade },
        token: job.token,
        hooks: {
          onPhase: (phase, progress, stats) => {
            if (job.cancelled) return;
            item.status = phase;
            item.progress = progress;
            item.etaSeconds = stats?.etaSeconds ?? 0;
            syncItem(item);
          },
        },
      });

      if (job.cancelled) return;

      const filename = buildOutputName(item.name, '-preview');
      downloadBlob(result.blob, filename);
      toasts.success(i18n.t('autocut.previewDone', { name: filename }));
    } catch (error) {
      if (!job.cancelled && !isCancelled(error)) {
        toasts.error(describeError(error, i18n));
      }
    } finally {
      if (jobs.get(item.id) === job) jobs.delete(item.id);
      if (activeJob === job) activeJob = null;
      restorePrevious(job);
      refreshChrome();
    }
  }

  // ---------------------------------------------------------------- queue controls

  function skipCurrent() {
    if (!activeJob) return;
    const job = activeJob;
    const name = job.item.name;

    if (job.kind === 'estimate') {
      job.cancelled = true;
      job.token.cancelled = true;
      estimateJobs.delete(job.item.id);
      resetEstimate(job.item);
      syncItem(job.item);
    } else {
      cancelRunningRender(job);
    }

    ffmpeg.cancel();
    refreshChrome();
    toasts.info(i18n.t('autocut.queue.skipped', { name }));
  }

  function cancelFollowing() {
    let count = 0;
    for (const job of [...jobs.values()]) {
      if (job.started) continue;
      cancelQueuedRender(job);
      count += 1;
    }
    if (count) toasts.info(i18n.t('autocut.queue.cancelledNext', { count }));
    refreshChrome();
  }

  function stopAll() {
    let count = 0;
    let terminate = false;

    for (const job of [...jobs.values()]) {
      if (job.started) {
        cancelRunningRender(job);
        terminate = true;
      } else {
        cancelQueuedRender(job);
      }
      count += 1;
    }

    for (const job of [...estimateJobs.values()]) {
      job.cancelled = true;
      job.token.cancelled = true;
      estimateJobs.delete(job.item.id);
      resetEstimate(job.item);
      syncItem(job.item);
      if (job.started) terminate = true;
      count += 1;
    }

    if (terminate) ffmpeg.cancel();
    if (count) toasts.info(i18n.t('autocut.queue.stoppedAll', { count }));
    refreshChrome();
  }

  // ---------------------------------------------------------------- dialog

  /** @param {object} item */
  function openItemDialog(item) {
    if (isBusyStatus(item.status)) return;

    dialogItem = item;
    const current = effectiveParams(item);
    dialogDraft = {
      thresholdDb: current.thresholdDb,
      preCut: current.preCut,
      postCut: current.postCut,
      minClipDuration: current.minClipDuration,
    };
    if (els.dialogOutput) els.dialogOutput.value = normalizeOutputFormat(current.output);

    clear(els.dialogFields);
    dialogFields = fieldSpecs.map((spec) =>
      createSliderField({
        id: `autocut-item-${spec.key}`,
        labelKey: `autocut.fields.${spec.label}`,
        hintKey: `autocut.fields.${spec.label}Hint`,
        min: spec.min,
        max: spec.max,
        step: spec.step,
        value: dialogDraft[spec.key],
        unit: spec.unit,
        decimals: spec.decimals,
        onInput: (value) => {
          if (dialogDraft) dialogDraft[spec.key] = value;
        },
        onCommit: (value) => {
          if (dialogDraft) dialogDraft[spec.key] = value;
        },
        onInvalid: ({ min, max }) => toasts.error(i18n.t('errors.numberRange', { min, max })),
      }),
    );
    for (const field of dialogFields) els.dialogFields.append(field.element);

    i18n.apply(els.dialogFields);
    els.dialogTitle.textContent = i18n.t('autocut.modal.title', { name: item.name });
    els.dialogHint.textContent = i18n.t('autocut.modal.hint');
    dialog.open();
  }

  /** @param {object} item */
  function afterOverrideChange(item) {
    refreshStaleness(item);
    invalidateIfOutdated(item);
    syncItem(item);
    refreshChrome();

    if (autoEstimate) enqueueEstimate(item);
  }

  if (els.dialogSave) {
    els.dialogSave.addEventListener('click', () => {
      if (!dialogItem || !dialogDraft) return;
      dialogItem.override = {
        thresholdDb: dialogDraft.thresholdDb,
        preCut: dialogDraft.preCut,
        postCut: dialogDraft.postCut,
        minClipDuration: dialogDraft.minClipDuration,
        output: normalizeOutputFormat(els.dialogOutput?.value),
      };
      afterOverrideChange(dialogItem);
      dialog.close();
    });
  }

  if (els.dialogReset) {
    els.dialogReset.addEventListener('click', () => {
      if (!dialogItem) return;
      dialogItem.override = null;
      afterOverrideChange(dialogItem);
      dialog.close();
    });
  }

  if (els.dialog) {
    els.dialog.addEventListener('close', () => {
      dialogItem = null;
      dialogDraft = null;
      dialogFields = [];
    });
  }

  // ---------------------------------------------------------------- wiring

  setupDropzone({ zone: els.dropzone, input: els.input, onFiles: addFiles });
  els.add.addEventListener('click', () => els.input.click());
  els.runAll.addEventListener('click', runAll);
  els.skip?.addEventListener('click', skipCurrent);
  els.cancelNext?.addEventListener('click', cancelFollowing);
  els.stopAll?.addEventListener('click', stopAll);

  queue.subscribe(() => refreshChrome());

  function refresh() {
    syncAllItems();
    refreshChrome();
    fadeControl.refresh();
    presetManager.refresh();

    if (dialog.isOpen() && dialogItem) {
      els.dialogTitle.textContent = i18n.t('autocut.modal.title', { name: dialogItem.name });
      els.dialogHint.textContent = i18n.t('autocut.modal.hint');
    }
  }

  refreshChrome();

  return {
    refresh,
    addFiles,
    runAll,
    estimateAll,
    getItems: () => state.items,
    get autoEstimate() {
      return autoEstimate;
    },
  };
}
