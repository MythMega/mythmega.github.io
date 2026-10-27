/**
 * Intro/Outro tab controller.
 *
 * A shared intro and a shared outro can be defined above the list. Every video
 * stays independent: it is exported with the intro, the outro, or both,
 * depending on the mode chosen on its row. The expected output duration is
 * recomputed whenever the list, the slots or a mode changes.
 * @module features/introoutro/introoutro-feature
 */

import { describeError } from '../../core/app-error.js';
import { $, clear, el } from '../../core/dom.js';
import { fadeFromPreset, fadePresetValues, fadeSummary } from '../../core/fade.js';
import { buildOutputName, downloadBlob, formatBytes, sanitizeSuffix } from '../../core/media.js';
import { saveParams } from '../../core/settings.js';
import { formatDuration, formatEta } from '../../core/timecode.js';
import { setupDropzone } from '../../ui/dropzone.js';
import { icon } from '../../ui/icons.js';
import { createFadeControl } from '../../ui/fade-control.js';
import { createPresetManager } from '../../ui/preset-manager.js';
import { processConcat } from '../shared/concat-processor.js';
import { importVideoFile } from '../shared/import-video.js';

const IMPORTING = 'importing';
const SLOTS = ['intro', 'outro'];

/** @param {unknown} error */
function isCancelled(error) {
  return error instanceof Error && (error.code === 'cancelled' || error.name === 'CancelledError');
}

/**
 * @param {import('../../main.js').AppContext} ctx
 * @param {HTMLElement} panel
 */
export function createIntroOutroFeature(ctx, panel) {
  const { settings, i18n, ffmpeg, queue, toasts } = ctx;
  const { processing } = settings;
  const params = settings.params.introoutro;

  const slotEls = Object.fromEntries(
    SLOTS.map((kind) => [
      kind,
      {
        zone: $(`#introoutro-${kind}-drop`, panel),
        input: $(`#introoutro-${kind}-input`, panel),
        file: $(`#introoutro-${kind}-file`, panel),
      },
    ]),
  );

  const els = {
    suffix: $('#introoutro-suffix', panel),
    fade: $('#introoutro-fade', panel),
    presets: $('#introoutro-presets', panel),
    runAll: $('#introoutro-run-all', panel),
    runLabel: $('#introoutro-run-all [data-role="label"]', panel),
    queuePanel: $('#introoutro-queue-panel', panel),
    queueActive: $('#introoutro-queue-active', panel),
    stopAll: $('#introoutro-stop-all', panel),
    hint: $('#introoutro-hint', panel),
    add: $('#introoutro-add', panel),
    input: $('#introoutro-input', panel),
    dropzone: $('#introoutro-dropzone', panel),
    list: $('#introoutro-list', panel),
    empty: $('#introoutro-empty', panel),
    count: $('#introoutro-count', panel),
  };

  const state = {
    /** @type {Array<object>} */
    items: [],
    /** @type {Map<number, ReturnType<typeof createRow>>} */
    views: new Map(),
    nextId: 1,
    /** @type {null | object} */
    intro: null,
    /** @type {null | object} */
    outro: null,
  };

  /** @type {Map<number, object>} */
  const jobs = new Map();
  /** @type {null | object} */
  let activeJob = null;

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
    id: 'introoutro-fade',
    bounds: settings.config.fade,
    onChange: () => saveParams(settings),
    onInvalid: ({ min, max }) => toasts.error(i18n.t('errors.numberRange', { min, max })),
  });
  els.fade?.append(fadeControl.element);

  const presetManager = createPresetManager({
    i18n,
    toasts,
    scope: 'introoutro',
    sectionKey: 'nav.introoutro',
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
    },
    summarize: (values) => [
      { label: i18n.t('common.suffix.label'), value: String(values?.suffix ?? '') || '—' },
      ...fadeSummary(i18n.t.bind(i18n), fadeFromPreset(values, params.fade, settings.config.fade)),
    ],
  });

  // -------------------------------------------------------------- helpers

  function locked() {
    return jobs.size > 0;
  }

  /** @param {object} item */
  function modeOf(item) {
    const modes = availableModes();
    if (!modes.length) return 'both';
    return modes.includes(item.mode) ? item.mode : modes.includes('both') ? 'both' : modes[0];
  }

  function availableModes() {
    const hasIntro = Boolean(state.intro?.source);
    const hasOutro = Boolean(state.outro?.source);
    if (hasIntro && hasOutro) return ['both', 'intro', 'outro'];
    if (hasIntro) return ['intro'];
    if (hasOutro) return ['outro'];
    return [];
  }

  /** @param {object} item */
  function includesIntro(item) {
    return Boolean(state.intro?.source) && ['both', 'intro'].includes(modeOf(item));
  }

  /** @param {object} item */
  function includesOutro(item) {
    return Boolean(state.outro?.source) && ['both', 'outro'].includes(modeOf(item));
  }

  /** @param {object} item */
  function expectedDuration(item) {
    let total = item.duration || 0;
    if (includesIntro(item)) total += state.intro?.duration || 0;
    if (includesOutro(item)) total += state.outro?.duration || 0;
    return total;
  }

  /** @param {object} item */
  function canRun(item) {
    return (
      Boolean(item.source) &&
      availableModes().length > 0 &&
      ['idle', 'error', 'done'].includes(item.status)
    );
  }

  function refreshRows() {
    for (const item of state.items) state.views.get(item.id)?.sync();
  }

  function renderSlot(kind) {
    const slot = state[kind];
    const { zone, file } = slotEls[kind];

    clear(file);
    zone.hidden = Boolean(slot);
    file.hidden = !slot;

    if (!slot) return;

    const nameEl = el('span', { class: 'video-name', text: slot.name, title: slot.name });
    const metaEl = el('div', { class: 'video-meta' });
    if (slot.status === IMPORTING) {
      metaEl.textContent = i18n.t('common.importing');
    } else if (slot.duration) {
      metaEl.textContent = `${formatDuration(slot.duration)} · ${formatBytes(slot.size)}`;
    } else {
      metaEl.textContent = formatBytes(slot.size);
    }

    const remove = el(
      'button',
      {
        type: 'button',
        class: 'icon-btn is-danger',
        'data-remove-slot': kind,
        title: i18n.t('common.remove'),
        'aria-label': i18n.t('common.remove'),
        disabled: locked(),
      },
      el('span', { html: icon('trash', 17) }),
    );
    remove.addEventListener('click', () => removeSlot(kind));

    file.append(
      el(
        'div',
        { class: 'file-strip' },
        el('span', { class: 'video-thumb', html: icon(kind === 'intro' ? 'in' : 'out', 18) }),
        el('div', { class: 'video-info' }, el('div', { class: 'video-name-row' }, nameEl), metaEl),
        remove,
      ),
    );
  }

  function refreshChrome() {
    els.count.textContent = String(state.items.length);
    els.empty.hidden = state.items.length > 0;

    const modes = availableModes();
    const pending = state.items.filter(canRun).length;
    els.runLabel.textContent = i18n.t('introoutro.runAll', { count: pending });
    els.runAll.disabled = pending === 0 || queue.busy || modes.length === 0;

    const needEdge = state.items.length > 0 && modes.length === 0;
    els.hint.hidden = !needEdge;
    els.hint.textContent = needEdge ? i18n.t('introoutro.needEdge') : '';

    els.queuePanel.hidden = jobs.size === 0;
    if (jobs.size > 0) {
      els.queueActive.textContent = activeJob
        ? i18n.t('introoutro.queue.active', { name: activeJob.item.name })
        : i18n.t('introoutro.queue.waiting', { count: jobs.size });
    }

    for (const kind of SLOTS) {
      const remove = slotEls[kind].file.querySelector('[data-remove-slot]');
      if (remove) remove.disabled = locked();
      slotEls[kind].zone.classList.toggle('is-disabled', locked());
    }

    refreshRows();
  }

  // -------------------------------------------------------------- slots

  /** @param {'intro'|'outro'} kind @param {File} file */
  async function setSlot(kind, file) {
    if (locked()) {
      toasts.error(i18n.t('errors.busy'));
      return;
    }

    /** @type {object} */
    const slot = {
      source: null,
      name: file.name,
      size: file.size,
      duration: 0,
      status: IMPORTING,
    };
    state[kind] = slot;
    renderSlot(kind);
    refreshChrome();

    try {
      const result = await importVideoFile(file, ctx);
      if (state[kind] !== slot) {
        await result.source?.remove();
        return;
      }

      if (result.error) {
        state[kind] = null;
        toasts.error(result.error);
      } else {
        slot.source = result.source;
        slot.duration = result.duration || 0;
        slot.status = 'ready';
      }
    } catch (error) {
      if (state[kind] === slot) state[kind] = null;
      toasts.error(describeError(error, i18n));
    }

    renderSlot(kind);
    refreshChrome();
  }

  /** @param {'intro'|'outro'} kind */
  function removeSlot(kind) {
    if (locked()) {
      toasts.error(i18n.t('errors.busy'));
      return;
    }
    const slot = state[kind];
    state[kind] = null;
    slot?.source?.remove();
    renderSlot(kind);
    refreshChrome();
  }

  // -------------------------------------------------------------- rows

  /** @param {object} item */
  function createRow(item) {
    const nameEl = el('span', { class: 'video-name', text: item.name, title: item.name });

    const select = el('select', {
      class: 'select-input',
      'aria-label': i18n.t('introoutro.modeLabel'),
    });
    select.addEventListener('change', () => {
      item.mode = select.value;
      refreshChrome();
    });

    const metaEl = el('div', { class: 'video-meta' });
    const expectedEl = el('span', { class: 'video-expected' });
    /** Avoid rebuilding the options on every progress tick. */
    let modesSignature = null;

    const progressBar = el('div', { class: 'progress-bar' });
    const progressEl = el(
      'div',
      { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' },
      progressBar,
    );

    const statusTextEl = el('span', { class: 'video-status-text' });
    const etaEl = el('span', { class: 'video-eta' });
    const percentEl = el('span', { class: 'video-percent' });
    const statusEl = el(
      'div',
      { class: 'video-status' },
      statusTextEl,
      el('span', { class: 'video-status-right' }, etaEl, percentEl),
    );

    /** @param {string} action @param {'preview'|'stop'|'trash'} iconName @param {string} titleKey @param {boolean} [danger] */
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
        if (action === 'remove') removeItem(item);
        else if (action === 'stop') cancelItem(item);
        else enqueueRender(item);
      });
      return node;
    };

    const render = button('render', 'preview', 'introoutro.run');
    const stop = button('stop', 'stop', 'common.stop', true);
    const remove = button('remove', 'trash', 'common.remove', true);
    stop.hidden = true;

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
          el('div', { class: 'video-name-row' }, nameEl, select),
          metaEl,
          progressEl,
          statusEl,
        ),
        el('div', { class: 'video-actions' }, render, stop, remove),
      ),
    );

    function sync() {
      const busy = ['queued', 'preparing', 'rendering'].includes(item.status);
      const failed = item.status === 'error';
      const modes = availableModes();
      // Keep the stored preference (`item.mode`) as-is: while only one edge is
      // defined the effective mode is narrower, and it widens back to "both"
      // when the second edge is added.
      const mode = modeOf(item);

      nameEl.textContent = item.name;
      nameEl.title = item.name;

      const signature = `${i18n.lang}|${modes.join(',')}|${locked()}`;
      if (signature !== modesSignature) {
        modesSignature = signature;
        clear(select);
        for (const value of modes) {
          select.append(el('option', { value, text: i18n.t(`introoutro.mode.${value}`) }));
        }
      }
      select.value = mode;
      select.hidden = modes.length === 0;
      select.disabled = modes.length <= 1 || locked();
      select.title = i18n.t('introoutro.modeLabel');

      const parts = [];
      parts.push(item.duration ? formatDuration(item.duration) : i18n.t('common.unknownDuration'));
      parts.push(formatBytes(item.size));
      metaEl.textContent = parts.join(' · ');
      expectedEl.textContent = i18n.t('introoutro.expected', {
        duration: formatDuration(expectedDuration(item)),
      });
      metaEl.append(expectedEl);

      const percent = Math.round((item.progress || 0) * 100);
      node.classList.toggle('is-busy', busy);
      node.classList.toggle('is-done', item.status === 'done');
      node.classList.toggle('is-error', failed);

      progressEl.hidden = !busy && !failed;
      progressBar.style.width = `${percent}%`;
      progressEl.setAttribute('aria-valuenow', String(percent));

      statusEl.className = `video-status${failed ? ' is-error' : item.status === 'done' ? ' is-done' : ''}`;
      if (busy) {
        statusTextEl.textContent = i18n.t(`common.${item.status}`);
        percentEl.textContent = `${percent}%`;
      } else if (failed) {
        statusTextEl.textContent = item.errorText || i18n.t('common.error');
        percentEl.textContent = '';
      } else if (item.status === 'done') {
        statusTextEl.textContent = item.result?.name
          ? i18n.t('introoutro.resultDone', { name: item.result.name })
          : i18n.t('common.done');
        percentEl.textContent = '100%';
      } else {
        statusTextEl.textContent = i18n.t('common.ready');
        percentEl.textContent = '';
      }

      const eta = busy && item.etaSeconds > 0
        ? i18n.t('common.eta', { time: formatEta(item.etaSeconds) })
        : '';
      etaEl.textContent = eta;
      etaEl.hidden = !eta;

      render.disabled = !canRun(item) || queue.busy;
      render.title = i18n.t('introoutro.run');
      stop.hidden = !item.jobKind;
      stop.disabled = !item.jobKind;
      remove.disabled = busy || locked();
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
      mode: 'both',
      status: IMPORTING,
      progress: 0,
      etaSeconds: 0,
      errorText: '',
      result: null,
      jobKind: null,
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
        item.progress = 0;
        item.errorText = result.error;
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
      if (locked()) {
        toasts.error(i18n.t('errors.busy'));
        return;
      }
      await addFile(file);
    }
  }

  /** @param {object} item */
  function removeItem(item) {
    if (item.status === IMPORTING || jobs.has(item.id) || locked()) {
      toasts.error(i18n.t('errors.busy'));
      return;
    }

    state.items = state.items.filter((entry) => entry !== item);
    state.views.get(item.id)?.node.remove();
    state.views.delete(item.id);
    item.source?.remove();
    refreshChrome();
  }

  // -------------------------------------------------------------- rendering

  /** @param {object} item */
  function enqueueRender(item) {
    if (!canRun(item) || jobs.has(item.id)) return;

    const job = {
      item,
      cancelled: false,
      started: false,
      token: { cancelled: false },
      mode: modeOf(item),
      fade: { ...params.fade },
    };
    jobs.set(item.id, job);

    item.status = 'queued';
    item.progress = 0;
    item.etaSeconds = 0;
    item.errorText = '';
    item.jobKind = 'render';
    refreshChrome();

    queue
      .enqueue({
        id: `introoutro-${item.id}`,
        label: item.name,
        run: () => runTask(job),
      })
      .catch((error) => console.error('[Bulkut] intro/outro job failed', error));
  }

  function runAll() {
    for (const item of state.items) {
      if (canRun(item)) enqueueRender(item);
    }
  }

  /** @param {object} job */
  async function runTask(job) {
    if (job.cancelled) return;

    const item = job.item;
    job.started = true;
    activeJob = job;
    item.status = 'preparing';
    item.progress = 0.02;
    refreshChrome();

    const sources = [];
    const durations = [];
    const usesIntro = ['both', 'intro'].includes(job.mode);
    const usesOutro = ['both', 'outro'].includes(job.mode);

    if (usesIntro && state.intro?.source) {
      sources.push(state.intro.source);
      durations.push(state.intro.duration);
    }
    sources.push(item.source);
    durations.push(item.duration);
    if (usesOutro && state.outro?.source) {
      sources.push(state.outro.source);
      durations.push(state.outro.duration);
    }

    try {
      const result = await processConcat({
        ffmpeg,
        sources,
        durations,
        processing,
        fps: processing.concatFps,
        fade: job.fade,
        token: job.token,
        hooks: {
          onPhase: (status, progress, stats) => {
            if (job.cancelled) return;
            item.status = status;
            item.progress = progress;
            item.etaSeconds = stats?.etaSeconds ?? 0;
            state.views.get(item.id)?.sync();
          },
        },
      });

      if (job.cancelled) return;

      const filename = buildOutputName(item.name, params.suffix);
      downloadBlob(result.blob, filename);
      item.status = 'done';
      item.progress = 1;
      item.result = { name: filename, size: result.blob.size };
      toasts.success(i18n.t('introoutro.resultDone', { name: filename }));
    } catch (error) {
      if (!job.cancelled && !isCancelled(error)) {
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
      if (['queued', 'preparing', 'rendering'].includes(item.status)) {
        item.status = 'idle';
        item.progress = 0;
      }
      refreshChrome();
    }
  }

  /** @param {object} item */
  function cancelItem(item) {
    const job = jobs.get(item.id);
    if (!job) return;

    job.cancelled = true;
    job.token.cancelled = true;
    jobs.delete(item.id);
    if (activeJob === job) activeJob = null;

    item.status = 'idle';
    item.progress = 0;
    item.etaSeconds = 0;
    item.errorText = '';
    item.jobKind = null;

    if (job.started) ffmpeg.cancel();
    refreshChrome();
  }

  function stopAll() {
    if (!jobs.size) return;

    let terminate = false;
    for (const job of [...jobs.values()]) {
      job.cancelled = true;
      job.token.cancelled = true;
      if (job.started) terminate = true;
      job.item.status = 'idle';
      job.item.progress = 0;
      job.item.etaSeconds = 0;
      job.item.errorText = '';
      job.item.jobKind = null;
    }
    jobs.clear();
    activeJob = null;

    if (terminate) ffmpeg.cancel();
    toasts.info(i18n.t('introoutro.queue.stoppedAll'));
    refreshChrome();
  }

  // -------------------------------------------------------------- wiring

  for (const kind of SLOTS) {
    setupDropzone({
      zone: slotEls[kind].zone,
      input: slotEls[kind].input,
      onFiles: (files) => {
        if (files[0]) setSlot(kind, files[0]);
      },
    });
  }

  setupDropzone({ zone: els.dropzone, input: els.input, onFiles: addFiles });
  els.add.addEventListener('click', () => els.input.click());
  els.runAll.addEventListener('click', runAll);
  els.stopAll.addEventListener('click', stopAll);
  queue.subscribe(() => refreshChrome());

  function refresh() {
    if (els.suffix !== document.activeElement) els.suffix.value = params.suffix;
    for (const kind of SLOTS) renderSlot(kind);
    refreshChrome();
    fadeControl.refresh();
    presetManager.refresh();
  }

  for (const kind of SLOTS) renderSlot(kind);
  refreshChrome();

  return {
    refresh,
    addFiles,
    runAll,
    stopAll,
    getItems: () => state.items,
    getSlots: () => ({ intro: state.intro, outro: state.outro }),
    expectedDuration,
  };
}
