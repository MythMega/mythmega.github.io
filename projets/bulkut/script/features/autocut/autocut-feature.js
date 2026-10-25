/**
 * Autocut tab controller.
 *
 * Global settings apply to every video; a video can store its own override
 * (four FFmpeg parameters) through the gear dialog. Rendering goes through the
 * shared sequential queue, so only one video is processed at a time.
 * @module features/autocut/autocut-feature
 */

import { describeError } from '../../core/app-error.js';
import { $, clear, debounce } from '../../core/dom.js';
import { buildOutputName, downloadBlob, probeVideoDuration, sanitizeSuffix } from '../../core/media.js';
import { saveParams } from '../../core/settings.js';
import { createDialogController } from '../../ui/dialog.js';
import { setupDropzone } from '../../ui/dropzone.js';
import { createSliderField } from '../../ui/slider-field.js';
import { validateVideoFile } from '../shared/video-file.js';
import { getAutocutFieldSpecs, hasRenderParamsChanged, renderParamsOf } from './autocut-fields.js';
import { processAutocut } from './autocut-processor.js';
import { createAutocutItemView, isBusyStatus } from './autocut-view.js';

/**
 * @param {import('../../main.js').AppContext} ctx
 * @param {HTMLElement} panel
 */
export function createAutocutFeature(ctx, panel) {
  const { settings, i18n, ffmpeg, queue, toasts } = ctx;
  const { processing } = settings;
  const params = settings.params.autocut;
  const fieldSpecs = getAutocutFieldSpecs(settings.config);

  const els = {
    fields: $('#autocut-fields', panel),
    suffix: $('#autocut-suffix', panel),
    runAll: $('#autocut-run-all', panel),
    runLabel: $('#autocut-run-all [data-role="label"]', panel),
    add: $('#autocut-add', panel),
    input: $('#autocut-input', panel),
    dropzone: $('#autocut-dropzone', panel),
    list: $('#autocut-list', panel),
    empty: $('#autocut-empty', panel),
    count: $('#autocut-count', panel),
    dialog: $('#autocut-dialog'),
    dialogFields: $('#autocut-dialog-fields'),
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

  const dialog = createDialogController(els.dialog);
  /** @type {null | object} */
  let dialogItem = null;
  /** @type {null | { thresholdDb: number, preCut: number, postCut: number, minClipDuration: number }} */
  let dialogDraft = null;
  /** @type {Array<ReturnType<typeof createSliderField>>} */
  let dialogFields = [];

  const persistLater = debounce(() => saveParams(settings), 250);

  // ---------------------------------------------------------------- helpers

  /** @param {object} item */
  function effectiveParams(item) {
    return item.override ? { ...params, ...item.override } : { ...params };
  }

  /** @param {object} item */
  function canRun(item) {
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
      if (item.status !== 'done' || !item.renderedParams) {
        continue;
      }
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

  function refreshChrome() {
    els.count.textContent = String(state.items.length);
    els.empty.hidden = state.items.length > 0;

    const pending = state.items.filter(canRun).length;
    els.runLabel.textContent = i18n.t('autocut.runAll', { count: pending });
    els.runAll.disabled = pending === 0 || queue.busy;
  }

  // ---------------------------------------------------------------- settings

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
        refreshStaleness();
        syncAllItems();
        refreshChrome();
      },
      onCommit: (value) => {
        params[spec.key] = value;
        saveParams(settings);
        refreshStaleness();
        syncAllItems();
        refreshChrome();
      },
      onInvalid: ({ min, max }) => toasts.error(i18n.t('errors.numberRange', { min, max })),
    });
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

  // ---------------------------------------------------------------- list

  function addFiles(files) {
    let added = 0;
    for (const file of files) {
      const error = validateVideoFile(file, { i18n, processing });
      if (error) {
        toasts.error(error);
        continue;
      }
      addItem(file);
      added += 1;
    }
    if (added > 0) refreshChrome();
  }

  /** @param {File} file */
  function addItem(file) {
    const item = {
      id: state.nextId,
      file,
      name: file.name,
      size: file.size,
      duration: 0,
      override: null,
      status: 'idle',
      progress: 0,
      errorText: '',
      result: null,
      stale: false,
      /** @type {Record<string, number>|null} */
      renderedParams: null,
    };
    state.nextId += 1;

    const view = createAutocutItemView(item, { i18n, onAction: handleAction });
    state.items.push(item);
    state.views.set(item.id, view);
    els.list.append(view.node);
    syncItem(item);

    probeVideoDuration(file).then((duration) => {
      if (!state.views.has(item.id)) return;
      item.duration = duration;
      syncItem(item);
    });
  }

  /**
   * @param {string} action
   * @param {object} item
   */
  function handleAction(action, item) {
    if (action === 'remove') removeItem(item);
    else if (action === 'configure') openItemDialog(item);
    else if (action === 'excerpt') renderPreview(item);
  }

  /** @param {object} item */
  function removeItem(item) {
    if (isBusyStatus(item.status)) {
      toasts.error(i18n.t('errors.busy'));
      return;
    }
    state.items = state.items.filter((entry) => entry !== item);
    const view = state.views.get(item.id);
    if (view) view.node.remove();
    state.views.delete(item.id);
    refreshChrome();
  }

  // ---------------------------------------------------------------- rendering

  /** @param {object} item */
  function enqueueRender(item) {
    if (!canRun(item)) return;

    const snapshot = { ...effectiveParams(item) };
    item.status = 'queued';
    item.progress = 0;
    item.errorText = '';
    item.stale = false;
    syncItem(item);
    refreshChrome();

    queue
      .enqueue({
        id: `autocut-${item.id}`,
        label: item.name,
        run: async () => {
          try {
            const result = await processAutocut({
              ffmpeg,
              file: item.file,
              params: snapshot,
              processing,
              durationHint: item.duration,
              hooks: {
                onPhase: (phase, progress) => {
                  item.status = phase;
                  item.progress = progress;
                  syncItem(item);
                },
              },
            });

            const filename = buildOutputName(item.name, snapshot.suffix);
            downloadBlob(result.blob, filename);
            item.status = 'done';
            item.progress = 1;
            item.result = { name: filename, size: result.blob.size };
            item.renderedParams = renderParamsOf(snapshot);
            refreshStaleness(item);
            toasts.success(i18n.t('autocut.resultDone', { name: filename }));
          } catch (error) {
            item.status = 'error';
            item.progress = 0;
            item.errorText = describeError(error, i18n);
            toasts.error(item.errorText);
          } finally {
            syncItem(item);
            refreshChrome();
          }
        },
      })
      .catch((error) => console.error('[Bulkut] autocut job failed', error));
  }

  function runAll() {
    for (const item of state.items.filter(canRun)) enqueueRender(item);
  }

  /** @param {object} item */
  function renderPreview(item) {
    if (isBusyStatus(item.status)) return;

    const snapshot = { ...effectiveParams(item) };
    const previousStatus = item.status === 'done' ? 'done' : 'idle';

    item.status = 'queued';
    item.progress = 0;
    item.errorText = '';
    syncItem(item);
    refreshChrome();

    queue
      .enqueue({
        id: `autocut-preview-${item.id}`,
        label: `${item.name} — ${i18n.t('common.excerpt')}`,
        run: async () => {
          try {
            const result = await processAutocut({
              ffmpeg,
              file: item.file,
              params: snapshot,
              processing,
              durationHint: item.duration,
              preview: { duration: processing.previewDuration },
              hooks: {
                onPhase: (phase, progress) => {
                  item.status = phase;
                  item.progress = progress;
                  syncItem(item);
                },
              },
            });

            const filename = buildOutputName(item.name, '-preview');
            downloadBlob(result.blob, filename);
            toasts.success(i18n.t('autocut.previewDone', { name: filename }));
          } catch (error) {
            toasts.error(describeError(error, i18n));
          } finally {
            item.status = previousStatus;
            item.progress = previousStatus === 'done' ? 1 : 0;
            refreshStaleness(item);
            syncItem(item);
            refreshChrome();
          }
        },
      })
      .catch((error) => console.error('[Bulkut] preview job failed', error));
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

  if (els.dialogSave) {
    els.dialogSave.addEventListener('click', () => {
      if (!dialogItem || !dialogDraft) return;
      dialogItem.override = {
        thresholdDb: dialogDraft.thresholdDb,
        preCut: dialogDraft.preCut,
        postCut: dialogDraft.postCut,
        minClipDuration: dialogDraft.minClipDuration,
      };
      refreshStaleness(dialogItem);
      syncItem(dialogItem);
      refreshChrome();
      dialog.close();
    });
  }

  if (els.dialogReset) {
    els.dialogReset.addEventListener('click', () => {
      if (!dialogItem) return;
      dialogItem.override = null;
      refreshStaleness(dialogItem);
      syncItem(dialogItem);
      refreshChrome();
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

  queue.subscribe(() => refreshChrome());

  function refresh() {
    syncAllItems();
    refreshChrome();

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
    getItems: () => state.items,
  };
}
