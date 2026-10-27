/**
 * Preset controls: the "Save preset" / "Load preset" buttons and their dialogs.
 *
 * The manager stays feature-agnostic: the caller provides the current values,
 * how to apply them and how to summarise them for the recap.
 * @module ui/preset-manager
 */

import { describeError } from '../core/app-error.js';
import { clear, el } from '../core/dom.js';
import { createPresetStore, sanitizePresetName } from '../core/presets.js';
import { createDialogController } from './dialog.js';
import { icon } from './icons.js';

/** Close button shared by both dialogs. */
function closeButton() {
  return el(
    'button',
    {
      type: 'button',
      class: 'icon-btn',
      'data-close-dialog': true,
      'data-i18n-aria-label': 'common.close',
      'data-i18n-title': 'common.close',
    },
    el('span', { html: icon('close', 18) }),
  );
}

/**
 * @param {object} options
 * @param {import('../core/i18n.js').I18n} options.i18n
 * @param {{ success: (m: string) => void, info: (m: string) => void, error: (m: string) => void }} options.toasts
 * @param {'autocut'|'fastcut'|'reverse'|'collage'|'introoutro'} options.scope
 * @param {string} options.sectionKey translation key of the tab name
 * @param {string} [options.storageKey] cookie prefix (`<storagePrefix>.presets`)
 * @param {HTMLElement} options.container
 * @param {() => Record<string, any>} options.getValues
 * @param {(values: Record<string, any>) => void | Promise<void>} options.applyValues
 * @param {(values: Record<string, any>) => Array<{ label: string, value: string }>} options.summarize
 */
export function createPresetManager({
  i18n,
  toasts,
  scope,
  sectionKey,
  storageKey,
  container,
  getValues,
  applyValues,
  summarize,
}) {
  if (!container) return { refresh() {} };

  const store = createPresetStore(scope, storageKey);

  const saveButton = el(
    'button',
    {
      type: 'button',
      class: 'btn btn-secondary btn-compact',
      'data-i18n-title': 'presets.save',
    },
    el('span', { class: 'btn-icon', html: icon('save', 16) }),
    el('span', { 'data-i18n': 'presets.save' }),
  );
  const loadButton = el(
    'button',
    {
      type: 'button',
      class: 'btn btn-secondary btn-compact',
      'data-i18n-title': 'presets.load',
    },
    el('span', { class: 'btn-icon', html: icon('folder', 16) }),
    el('span', { 'data-i18n': 'presets.load' }),
  );

  container.append(saveButton, loadButton);
  i18n.apply(container);

  // ------------------------------------------------------------ save dialog

  const saveDialog = el('dialog', {
    class: 'modal',
    id: `preset-save-${scope}`,
    'aria-labelledby': `preset-save-title-${scope}`,
  });
  const saveForm = el('form', { method: 'dialog', class: 'modal-inner glass' });
  const saveTitle = el('h2', { id: `preset-save-title-${scope}` });
  const saveHint = el('p', { class: 'preset-hint' });
  const recap = el('dl', { class: 'preset-recap' });
  const nameInput = el('input', {
    type: 'text',
    class: 'text-input',
    id: `preset-name-${scope}`,
    maxlength: '40',
    autocomplete: 'off',
    spellcheck: 'false',
    'data-i18n-placeholder': 'presets.namePlaceholder',
    'aria-invalid': 'false',
  });
  const errorEl = el('p', { class: 'preset-error', role: 'alert', hidden: true });

  saveForm.append(
    el('header', { class: 'modal-head' }, el('div', {}, saveTitle, saveHint), closeButton()),
    el(
      'div',
      { class: 'preset-recap-block' },
      el('p', { class: 'preset-subtitle', 'data-i18n': 'presets.recapTitle' }),
      recap,
    ),
    el(
      'div',
      { class: 'field' },
      el('label', { class: 'field-label', for: `preset-name-${scope}`, 'data-i18n': 'presets.nameLabel' }),
      nameInput,
      errorEl,
    ),
    el(
      'footer',
      { class: 'modal-actions' },
      el('button', { type: 'button', class: 'btn btn-ghost', 'data-close-dialog': true, 'data-i18n': 'common.cancel' }),
      el('span', { class: 'spacer' }),
      el('button', { type: 'submit', class: 'btn btn-primary', 'data-i18n': 'presets.saveAction' }),
    ),
  );
  saveDialog.append(saveForm);

  const saveController = createDialogController(saveDialog);

  /** @type {Record<string, any>} */
  let snapshot = {};

  /** @param {Record<string, any>} values */
  function rowsOf(values) {
    try {
      return summarize(values) ?? [];
    } catch (error) {
      console.error('[Bulkut] Could not summarise the preset.', error);
      return [];
    }
  }

  /** @param {string} message */
  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = !message;
    nameInput.setAttribute('aria-invalid', String(Boolean(message)));
  }

  function openSave() {
    snapshot = { ...(getValues() ?? {}) };
    saveTitle.textContent = i18n.t('presets.saveTitle', { section: i18n.t(sectionKey) });
    saveHint.textContent = i18n.t('presets.saveHint');

    clear(recap);
    for (const row of rowsOf(snapshot)) {
      recap.append(el('div', { class: 'preset-recap-row' }, el('dt', { text: row.label }), el('dd', { text: row.value })));
    }

    nameInput.value = '';
    showError('');
    i18n.apply(saveForm);
    saveController.open();
    window.requestAnimationFrame(() => nameInput.focus());
  }

  saveButton.addEventListener('click', openSave);
  nameInput.addEventListener('input', () => showError(''));

  saveForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = sanitizePresetName(nameInput.value);
    if (!name) {
      showError(i18n.t('errors.presetNameEmpty'));
      nameInput.focus();
      return;
    }

    try {
      const preset = store.save(name, snapshot);
      saveController.close();
      toasts.success(i18n.t('presets.saved', { name: preset.name }));
    } catch (error) {
      showError(describeError(error, i18n));
      nameInput.select();
    }
  });

  // ------------------------------------------------------------ load dialog

  const loadDialog = el('dialog', {
    class: 'modal',
    id: `preset-load-${scope}`,
    'aria-labelledby': `preset-load-title-${scope}`,
  });
  const loadInner = el('div', { class: 'modal-inner glass' });
  const loadTitle = el('h2', { id: `preset-load-title-${scope}` });
  const loadHint = el('p', { class: 'preset-hint' });
  const listEl = el('ul', { class: 'preset-list' });
  const emptyEl = el('p', { class: 'preset-empty', 'data-i18n': 'presets.empty' });

  loadInner.append(
    el('header', { class: 'modal-head' }, el('div', {}, loadTitle, loadHint), closeButton()),
    emptyEl,
    listEl,
    el(
      'footer',
      { class: 'modal-actions' },
      el('span', { class: 'spacer' }),
      el('button', { type: 'button', class: 'btn btn-ghost', 'data-close-dialog': true, 'data-i18n': 'common.close' }),
    ),
  );
  loadDialog.append(loadInner);

  const loadController = createDialogController(loadDialog);

  /** @param {string} value */
  function formatDate(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(i18n.lang, { dateStyle: 'medium' }).format(date);
  }

  /** @param {Record<string, any>} values */
  function summaryText(values) {
    return rowsOf(values)
      .map((row) => `${row.label}: ${row.value}`)
      .join(' · ');
  }

  /** @param {{ id: string, name: string, createdAt: string, values: Record<string, any> }} preset */
  function buildRow(preset) {
    const date = formatDate(preset.createdAt);
    const summary = summaryText(preset.values);

    const dateEl = date ? el('span', { class: 'preset-date', text: date }) : null;
    const load = el('button', {
      type: 'button',
      class: 'btn btn-secondary btn-compact',
      text: i18n.t('presets.load'),
    });
    const deleteLabel = el('span', { text: i18n.t('presets.delete') });
    const remove = el('button', { type: 'button', class: 'btn btn-ghost btn-compact preset-delete' }, deleteLabel);

    let resetTimer = 0;
    const resetDelete = () => {
      window.clearTimeout(resetTimer);
      remove.classList.remove('is-confirming');
      deleteLabel.textContent = i18n.t('presets.delete');
    };

    load.addEventListener('click', async () => {
      try {
        await applyValues({ ...preset.values });
        loadController.close();
        toasts.success(i18n.t('presets.loaded', { name: preset.name }));
      } catch (error) {
        toasts.error(describeError(error, i18n));
      }
    });

    // First click asks for confirmation, the second one deletes.
    remove.addEventListener('click', () => {
      if (!remove.classList.contains('is-confirming')) {
        remove.classList.add('is-confirming');
        deleteLabel.textContent = i18n.t('presets.confirmDelete');
        window.clearTimeout(resetTimer);
        resetTimer = window.setTimeout(resetDelete, 4000);
        return;
      }

      window.clearTimeout(resetTimer);
      try {
        store.remove(preset.id);
        toasts.info(i18n.t('presets.deleted', { name: preset.name }));
        renderList();
      } catch (error) {
        toasts.error(describeError(error, i18n));
        resetDelete();
      }
    });

    return el(
      'li',
      { class: 'preset-row' },
      el(
        'div',
        { class: 'preset-info' },
        el(
          'div',
          { class: 'preset-title-row' },
          el('span', { class: 'preset-name', text: preset.name, title: preset.name }),
          dateEl,
        ),
        summary ? el('p', { class: 'preset-summary', text: summary, title: summary }) : null,
      ),
      el('div', { class: 'preset-row-actions' }, load, remove),
    );
  }

  function renderList() {
    clear(listEl);
    const presets = store.list().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    emptyEl.hidden = presets.length > 0;
    listEl.hidden = presets.length === 0;

    for (const preset of presets) listEl.append(buildRow(preset));
  }

  function paintLoadHeader() {
    loadTitle.textContent = i18n.t('presets.loadTitle', { section: i18n.t(sectionKey) });
    loadHint.textContent = i18n.t('presets.loadHint');
  }

  function openLoad() {
    paintLoadHeader();
    i18n.apply(loadInner);
    renderList();
    loadController.open();
  }

  loadButton.addEventListener('click', openLoad);

  document.body.append(saveDialog, loadDialog);

  function refresh() {
    i18n.apply(container);
    i18n.apply(saveForm);
    i18n.apply(loadInner);
    if (!loadController.isOpen()) return;
    paintLoadHeader();
    renderList();
  }

  return { refresh };
}
