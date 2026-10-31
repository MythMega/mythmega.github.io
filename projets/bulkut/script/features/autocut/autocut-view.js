/**
 * Autocut list row rendering.
 * @module features/autocut/autocut-view
 */

import { el } from '../../core/dom.js';
import { formatBytes } from '../../core/media.js';
import { outputLabelKey } from '../../core/output-format.js';
import { formatDuration, formatEta } from '../../core/timecode.js';
import { icon } from '../../ui/icons.js';
import { formatParamSummary } from './autocut-fields.js';

const BUSY_STATUSES = new Set(['queued', 'importing', 'preparing', 'analyzing', 'rendering']);

/** @param {string} status */
export function isBusyStatus(status) {
  return BUSY_STATUSES.has(status);
}

/**
 * @param {object} item
 * @param {{ i18n: import('../../core/i18n.js').I18n, onAction: (action: string, item: object) => void }} options
 */
export function createAutocutItemView(item, { i18n, onAction }) {
  const nameEl = el('span', { class: 'video-name', text: item.name });
  const badgeEl = el('span', { class: 'badge' });
  const durationEl = el('span', { class: 'meta-duration' });
  const sizeEl = el('span', { class: 'meta-size' });
  const separator = el('span', { class: 'meta-sep', text: '·', 'aria-hidden': 'true' });
  const paramsEl = el('span', { class: 'video-params' });
  const metaEl = el('div', { class: 'video-meta' }, durationEl, separator, sizeEl, paramsEl);

  const estimateTextEl = el('span', { class: 'video-estimate-text' });
  const estimateEl = el(
    'div',
    { class: 'video-estimate', hidden: true },
    el('span', { class: 'video-estimate-icon', html: icon('clock', 13) }),
    estimateTextEl,
  );

  const progressBar = el('div', { class: 'progress-bar' });
  const progressEl = el(
    'div',
    {
      class: 'progress',
      role: 'progressbar',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': '0',
    },
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

  /** @param {string} action @param {'clock'|'preview'|'gear'|'stop'|'trash'} iconName @param {string} titleKey @param {boolean} danger */
  const makeButton = (action, iconName, titleKey, danger = false) => {
    const button = el(
      'button',
      {
        type: 'button',
        class: `icon-btn${danger ? ' is-danger' : ''}`,
        'data-action': action,
        title: i18n.t(titleKey),
        'aria-label': i18n.t(titleKey),
      },
      el('span', { html: icon(iconName, 17) }),
    );
    button.addEventListener('click', () => onAction(action, item));
    return button;
  };

  const buttons = {
    estimate: makeButton('estimate', 'clock', 'autocut.estimate.button'),
    excerpt: makeButton('excerpt', 'preview', 'autocut.excerpt.title'),
    configure: makeButton('configure', 'gear', 'common.configure'),
    stop: makeButton('stop', 'stop', 'common.stop', true),
    remove: makeButton('remove', 'trash', 'common.remove', true),
  };
  buttons.stop.hidden = true;

  const actions = el(
    'div',
    { class: 'video-actions' },
    buttons.estimate,
    buttons.excerpt,
    buttons.configure,
    buttons.stop,
    buttons.remove,
  );

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
        el('div', { class: 'video-name-row' }, nameEl, badgeEl),
        metaEl,
        estimateEl,
        progressEl,
        statusEl,
      ),
      actions,
    ),
  );

  /**
   * Refresh the row from the item state.
   * @param {{ thresholdDb: number, preCut: number, postCut: number, minClipDuration: number, [key: string]: any }} effectiveParams
   */
  function sync(effectiveParams) {
    const busy = isBusyStatus(item.status);
    const isCustom = Boolean(item.override);
    const stale = Boolean(item.stale) && item.status === 'done';
    const estimate = item.estimate ?? { status: 'idle', progress: 0 };

    nameEl.textContent = item.name;
    nameEl.title = item.name;

    badgeEl.className = `badge ${isCustom ? 'is-custom' : 'is-default'}`;
    badgeEl.textContent = i18n.t(isCustom ? 'common.customBadge' : 'common.defaultBadge');
    badgeEl.title = i18n.t(isCustom ? 'autocut.badge.custom' : 'autocut.badge.default');

    durationEl.textContent = item.duration ? formatDuration(item.duration) : i18n.t('common.unknownDuration');
    sizeEl.textContent = formatBytes(item.size);
    paramsEl.textContent = `${i18n.t(outputLabelKey(effectiveParams.output))} · ${formatParamSummary(effectiveParams)}`;
    paramsEl.title = i18n.t('autocut.params.title');

    // Estimated output duration (silence analysis only, no encoding).
    const showEstimate = estimate.status && estimate.status !== 'idle';
    estimateEl.hidden = !showEstimate;
    if (showEstimate) {
      estimateEl.className = `video-estimate is-${estimate.status}`;
      if (estimate.status === 'queued') {
        estimateTextEl.textContent = i18n.t('autocut.estimate.queued');
      } else if (estimate.status === 'running') {
        estimateTextEl.textContent = i18n.t('autocut.estimate.running', {
          percent: Math.round((estimate.progress || 0) * 100),
        });
      } else if (estimate.status === 'ready') {
        estimateTextEl.textContent = i18n.t('autocut.estimate.ready', {
          duration: formatDuration(estimate.duration),
          clips: estimate.clips,
        });
      } else {
        estimateTextEl.textContent = estimate.errorText || i18n.t('autocut.estimate.failed');
      }
      estimateEl.title = i18n.t('autocut.estimate.hint');
    }

    node.classList.toggle('is-busy', busy);
    node.classList.toggle('is-done', item.status === 'done' && !stale);
    node.classList.toggle('is-error', item.status === 'error');
    node.classList.toggle('is-stale', stale);

    const percent = Math.round((item.progress || 0) * 100);
    progressBar.style.width = `${percent}%`;
    progressEl.setAttribute('aria-valuenow', String(percent));

    const eta = busy && item.etaSeconds > 0 ? i18n.t('common.eta', { time: formatEta(item.etaSeconds) }) : '';
    etaEl.textContent = eta;
    etaEl.hidden = !eta;

    if (busy) {
      statusTextEl.textContent = i18n.t(`common.${item.status}`);
      percentEl.textContent = `${percent}%`;
    } else if (item.status === 'done') {
      statusTextEl.textContent = stale
        ? i18n.t('autocut.stale')
        : item.result?.name
          ? i18n.t('autocut.resultDone', { name: item.result.name })
          : i18n.t('common.done');
      percentEl.textContent = stale ? '' : '100%';
    } else if (item.status === 'error') {
      statusTextEl.textContent = item.errorText || i18n.t('common.error');
      percentEl.textContent = '';
    } else {
      statusTextEl.textContent = i18n.t('common.ready');
      percentEl.textContent = '';
    }

    statusEl.className = `video-status${
      stale ? ' is-stale' : item.status === 'done' ? ' is-done' : item.status === 'error' ? ' is-error' : ''
    }`;

    const estimating = estimate.status === 'queued' || estimate.status === 'running';

    buttons.excerpt.disabled = busy;
    buttons.configure.disabled = busy;
    buttons.remove.disabled = busy;
    buttons.estimate.disabled = busy || estimating;
    buttons.estimate.title = i18n.t(estimating ? 'autocut.estimate.runningShort' : 'autocut.estimate.button');
    buttons.estimate.setAttribute('aria-label', buttons.estimate.title);

    buttons.stop.hidden = !item.jobKind;
    buttons.stop.disabled = !item.jobKind;

    buttons.excerpt.title = i18n.t('autocut.excerpt.title');
    buttons.excerpt.setAttribute('aria-label', i18n.t('autocut.excerpt.title'));
    buttons.configure.title = i18n.t('common.configure');
    buttons.configure.setAttribute('aria-label', i18n.t('common.configure'));
    buttons.stop.title = i18n.t('common.stop');
    buttons.stop.setAttribute('aria-label', i18n.t('common.stop'));
    buttons.remove.title = i18n.t('common.remove');
    buttons.remove.setAttribute('aria-label', i18n.t('common.remove'));
  }

  return { node, sync };
}
