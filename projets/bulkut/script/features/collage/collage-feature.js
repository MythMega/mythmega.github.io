/**
 * Collage tab controller: join every clip, in list order, into one video.
 *
 * Rows can be dragged (or moved with the arrow buttons) to change the order;
 * the total duration of the collage is recomputed on every change. Rendering
 * goes through the shared queue, so it waits for other tabs and only one job
 * runs at a time.
 * @module features/collage/collage-feature
 */

import { describeError } from '../../core/app-error.js';
import { $, el } from '../../core/dom.js';
import { fadeFromPreset, fadePresetValues, fadeSummary } from '../../core/fade.js';
import { buildOutputName, downloadBlob, formatBytes, sanitizeSuffix } from '../../core/media.js';
import { saveParams } from '../../core/settings.js';
import { formatDuration, formatEta, formatTimecode } from '../../core/timecode.js';
import { setupDropzone } from '../../ui/dropzone.js';
import { icon } from '../../ui/icons.js';
import { createFadeControl } from '../../ui/fade-control.js';
import { createPresetManager } from '../../ui/preset-manager.js';
import { processConcat } from '../shared/concat-processor.js';
import { importVideoFile } from '../shared/import-video.js';

const IMPORTING = 'importing';

/** @param {unknown} error */
function isCancelled(error) {
  return error instanceof Error && (error.code === 'cancelled' || error.name === 'CancelledError');
}

/**
 * @param {import('../../main.js').AppContext} ctx
 * @param {HTMLElement} panel
 */
export function createCollageFeature(ctx, panel) {
  const { settings, i18n, ffmpeg, queue, toasts } = ctx;
  const { processing } = settings;
  const params = settings.params.collage;

  const els = {
    fields: {
      suffix: $('#collage-suffix', panel),
      fade: $('#collage-fade', panel),
    },
    presets: $('#collage-presets', panel),
    run: $('#collage-run', panel),
    runLabel: $('#collage-run [data-role="label"]', panel),
    stop: $('#collage-stop', panel),
    job: $('#collage-job', panel),
    jobText: $('#collage-job-text', panel),
    jobEta: $('#collage-job-eta', panel),
    jobPercent: $('#collage-job-percent', panel),
    jobBar: $('#collage-job-bar', panel),
    add: $('#collage-add', panel),
    input: $('#collage-input', panel),
    dropzone: $('#collage-dropzone', panel),
    list: $('#collage-list', panel),
    empty: $('#collage-empty', panel),
    count: $('#collage-count', panel),
    total: $('#collage-total', panel),
    totalValue: $('#collage-total-value', panel),
  };

  const state = {
    /** @type {Array<object>} */
    items: [],
    /** @type {Map<number, ReturnType<typeof createRow>>} */
    views: new Map(),
    nextId: 1,
  };

  /** @type {null | { token: { cancelled: boolean }, cancelled: boolean, started: boolean }} */
  let running = null;
  /** @type {HTMLElement|null} */
  let draggedRow = null;

  // -------------------------------------------------------------- suffix

  els.fields.suffix.value = params.suffix;

  const commitSuffix = () => {
    const clean = sanitizeSuffix(els.fields.suffix.value);
    els.fields.suffix.value = clean;
    params.suffix = clean;
    saveParams(settings);
  };
  els.fields.suffix.addEventListener('change', commitSuffix);
  els.fields.suffix.addEventListener('blur', commitSuffix);

  const fadeControl = createFadeControl({
    i18n,
    fade: params.fade,
    id: 'collage-fade',
    bounds: settings.config.fade,
    onChange: () => saveParams(settings),
    onInvalid: ({ min, max }) => toasts.error(i18n.t('errors.numberRange', { min, max })),
  });
  els.fields.fade?.append(fadeControl.element);

  const presetManager = createPresetManager({
    i18n,
    toasts,
    scope: 'collage',
    sectionKey: 'nav.collage',
    storageKey: settings.storageKeys.presets,
    container: els.presets,
    getValues: () => ({ suffix: params.suffix, ...fadePresetValues(params.fade) }),
    applyValues: (values) => {
      params.suffix = sanitizeSuffix(values?.suffix);
      els.fields.suffix.value = params.suffix;
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

  function totalDuration() {
    return state.items.reduce((sum, item) => sum + (item.duration || 0), 0);
  }

  function renumber() {
    state.items.forEach((item, index) => {
      state.views.get(item.id)?.setPosition(index + 1);
    });
  }

  function syncAll() {
    for (const item of state.items) state.views.get(item.id)?.sync();
  }

  function refreshChrome() {
    els.count.textContent = String(state.items.length);
    els.empty.hidden = state.items.length > 0;
    els.total.hidden = state.items.length === 0;
    els.totalValue.textContent = formatTimecode(totalDuration());

    const ready = state.items.some((item) => item.source);
    const importing = state.items.some((item) => item.status === IMPORTING);
    els.run.disabled = !ready || importing || Boolean(running) || queue.busy;
    els.runLabel.textContent = i18n.t('collage.run');
    els.stop.hidden = !running;
    els.stop.disabled = !running;
  }

  function paintJob(status, progress, stats) {
    els.job.hidden = false;
    const percent = Math.round(Math.min(1, Math.max(0, Number(progress) || 0)) * 100);

    els.jobText.textContent = i18n.t(`common.${status}`);
    els.jobBar.style.width = `${percent}%`;
    els.jobPercent.textContent = `${percent}%`;

    const eta =
      stats?.etaSeconds > 0 ? i18n.t('common.eta', { time: formatEta(stats.etaSeconds) }) : '';
    els.jobEta.textContent = eta;
    els.jobEta.hidden = !eta;
  }

  function hideJob() {
    els.job.hidden = true;
    els.jobBar.style.width = '0%';
    els.jobEta.hidden = true;
  }

  // -------------------------------------------------------------- rows

  /** @param {object} item */
  function createRow(item) {
    const indexEl = el('span', { class: 'clip-index' });
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

    /** @param {string} action @param {'up'|'down'|'trash'} iconName @param {string} titleKey @param {boolean} [danger] */
    const button = (action, iconName, titleKey, danger = false) => {
      const node = el(
        'button',
        {
          type: 'button',
          class: `icon-btn${danger ? ' is-danger' : ''}`,
          title: i18n.t(titleKey),
          'aria-label': i18n.t(titleKey),
        },
        el('span', { html: icon(iconName, 16) }),
      );
      node.addEventListener('click', () => {
        if (action === 'up') moveItem(item, -1);
        else if (action === 'down') moveItem(item, 1);
        else removeItem(item);
      });
      return node;
    };

    const up = button('up', 'up', 'common.moveUp');
    const down = button('down', 'down', 'common.moveDown');
    const remove = button('remove', 'trash', 'common.remove', true);

    const node = el(
      'li',
      {
        class: 'video-item is-draggable',
        draggable: 'true',
        dataset: { id: String(item.id) },
        title: i18n.t('common.dragToReorder'),
      },
      el(
        'div',
        { class: 'video-row' },
        indexEl,
        el('span', { class: 'video-thumb', html: icon('grip', 18) }),
        el(
          'div',
          { class: 'video-info' },
          el('div', { class: 'video-name-row' }, nameEl),
          metaEl,
          progressEl,
          statusEl,
        ),
        el('div', { class: 'video-actions' }, up, down, remove),
      ),
    );

    function sync() {
      const importing = item.status === IMPORTING;
      const failed = item.status === 'error';
      const percent = Math.round((item.progress || 0) * 100);

      metaEl.textContent = item.duration
        ? `${formatDuration(item.duration)} · ${formatBytes(item.size)}`
        : formatBytes(item.size);

      node.classList.toggle('is-busy', importing);
      node.classList.toggle('is-error', failed);
      progressEl.hidden = !importing && !failed;
      progressBar.style.width = `${percent}%`;
      progressEl.setAttribute('aria-valuenow', String(percent));

      statusEl.hidden = !importing && !failed;
      statusEl.className = `video-status${failed ? ' is-error' : ''}`;
      statusTextEl.textContent = importing
        ? i18n.t('common.importing')
        : failed
          ? item.errorText || i18n.t('common.error')
          : '';
      percentEl.textContent = importing ? `${percent}%` : '';
      if (!importing) progressBar.style.width = failed ? `${percent}%` : '0%';

      remove.disabled = importing || Boolean(running);
      up.disabled = importing || Boolean(running);
      down.disabled = importing || Boolean(running);
      up.title = i18n.t('common.moveUp');
      down.title = i18n.t('common.moveDown');
      remove.title = i18n.t('common.remove');
    }

    return {
      node,
      sync,
      setPosition(position) {
        indexEl.textContent = String(position);
      },
    };
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
    renumber();
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
    for (const file of files) {
      if (running) {
        toasts.error(i18n.t('errors.busy'));
        return;
      }
      await addFile(file);
    }
  }

  /** @param {object} item */
  function removeItem(item) {
    if (item.status === IMPORTING || running) {
      toasts.error(i18n.t('errors.busy'));
      return;
    }

    state.items = state.items.filter((entry) => entry !== item);
    state.views.get(item.id)?.node.remove();
    state.views.delete(item.id);
    item.source?.remove();

    renumber();
    refreshChrome();
  }

  /** @param {object} item @param {number} delta -1 or 1 */
  function moveItem(item, delta) {
    if (running) return;
    const from = state.items.indexOf(item);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= state.items.length) return;

    state.items.splice(from, 1);
    state.items.splice(to, 0, item);
    renderOrder();
    refreshChrome();
  }

  /** Put the DOM rows (and therefore the state) back in list order. */
  function renderOrder() {
    for (const item of state.items) {
      const node = state.views.get(item.id)?.node;
      if (node) els.list.append(node);
    }
    renumber();
  }

  function syncOrderFromDom() {
    const byId = new Map(state.items.map((item) => [item.id, item]));
    state.items = Array.from(els.list.children)
      .map((node) => byId.get(Number(node.dataset.id)))
      .filter(Boolean);
    renumber();
    refreshChrome();
  }

  // -------------------------------------------------------------- render

  function run() {
    if (running || queue.busy) return;
    if (state.items.some((item) => item.status === IMPORTING)) return;

    const clips = state.items.filter((item) => item.source);
    if (!clips.length) return;

    const self = { token: { cancelled: false }, cancelled: false, started: false, fade: { ...params.fade } };
    running = self;
    els.job.hidden = false;
    paintJob('queued', 0);
    refreshChrome();
    syncAll();

    queue
      .enqueue({
        id: 'collage',
        label: i18n.t('collage.label'),
        run: async () => {
          self.started = true;

          try {
            const result = await processConcat({
              ffmpeg,
              sources: clips.map((item) => item.source),
              durations: clips.map((item) => item.duration),
              processing,
              fps: processing.concatFps,
              fade: self.fade,
              token: self.token,
              hooks: {
                onPhase: (status, progress, stats) => {
                  if (self.cancelled) return;
                  paintJob(status, progress, stats);
                },
              },
            });

            if (self.cancelled) return;

            const filename = buildOutputName(clips[0].name, params.suffix);
            downloadBlob(result.blob, filename);
            toasts.success(i18n.t('collage.resultDone', { name: filename }));
          } catch (error) {
            if (!self.cancelled && !isCancelled(error)) {
              toasts.error(describeError(error, i18n));
            }
          } finally {
            if (running === self) running = null;
            hideJob();
            syncAll();
            refreshChrome();
          }
        },
      })
      .catch((error) => console.error('[Bulkut] collage job failed', error));
  }

  function stop() {
    if (!running) return;
    running.cancelled = true;
    running.token.cancelled = true;
    ffmpeg.cancel();
    toasts.info(i18n.t('collage.stopped'));
    refreshChrome();
  }

  // -------------------------------------------------------------- drag & drop

  function clearDragState() {
    draggedRow?.classList.remove('is-dragging');
    draggedRow = null;
    for (const node of els.list.children) node.classList.remove('is-drop-after');
  }

  els.list.addEventListener('dragstart', (event) => {
    const row = event.target.closest?.('.video-item');
    if (!row || running) {
      event.preventDefault();
      return;
    }
    draggedRow = row;
    row.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    try {
      event.dataTransfer.setData('text/plain', row.dataset.id);
    } catch {
      /* Some browsers refuse custom data; the DOM node is enough. */
    }
  });

  els.list.addEventListener('dragover', (event) => {
    if (!draggedRow) return;
    const over = event.target.closest?.('.video-item');
    if (!over || over === draggedRow) return;

    event.preventDefault();
    const rect = over.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    els.list.insertBefore(draggedRow, after ? over.nextSibling : over);
    for (const node of els.list.children) node.classList.toggle('is-drop-after', node === over);
  });

  els.list.addEventListener('drop', (event) => {
    if (!draggedRow) return;
    event.preventDefault();
    syncOrderFromDom();
    clearDragState();
  });

  els.list.addEventListener('dragend', () => {
    if (draggedRow) syncOrderFromDom();
    clearDragState();
  });

  // -------------------------------------------------------------- wiring

  setupDropzone({ zone: els.dropzone, input: els.input, onFiles: addFiles });
  els.add.addEventListener('click', () => els.input.click());
  els.run.addEventListener('click', run);
  els.stop.addEventListener('click', stop);
  queue.subscribe(() => refreshChrome());

  function refresh() {
    if (els.fields.suffix !== document.activeElement) els.fields.suffix.value = params.suffix;
    syncAll();
    refreshChrome();
    fadeControl.refresh();
    presetManager.refresh();
  }

  refreshChrome();

  return {
    refresh,
    addFiles,
    run,
    stop,
    getItems: () => state.items,
    getTotalDuration: totalDuration,
  };
}
