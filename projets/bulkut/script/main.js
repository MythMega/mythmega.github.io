/**
 * Application bootstrap.
 * @module main
 */

import { $, $all, el } from './core/dom.js';
import { FFmpegService } from './core/ffmpeg-service.js';
import { I18n } from './core/i18n.js';
import { loadSettings } from './core/settings.js';
import { TaskQueue } from './core/task-queue.js';
import { createAutocutFeature } from './features/autocut/autocut-feature.js';
import { createFastcutFeature } from './features/fastcut/fastcut-feature.js';
import { createReverseFeature } from './features/reverse/reverse-feature.js';
import { Toasts } from './ui/toasts.js';

/**
 * @typedef {object} AppContext
 * @property {Awaited<ReturnType<typeof loadSettings>>} settings
 * @property {I18n} i18n
 * @property {FFmpegService} ffmpeg
 * @property {TaskQueue} queue
 * @property {Toasts} toasts
 */

/**
 * Replace the app with a readable error card when the configuration is unusable.
 * @param {unknown} error
 */
function renderFatal(error) {
  console.error('[Bulkut] Startup failed', error);
  const main = $('#main');
  if (!main) return;
  main.innerHTML = '';
  main.append(
    el(
      'section',
      { class: 'card glass fatal' },
      el('h2', { text: 'Bulkut could not start' }),
      el('p', {
        text: 'The configuration could not be loaded. Check that settings/config.json and settings/default.json are reachable, then reload the page.',
      }),
      el('pre', { text: String(error?.message ?? error) }),
    ),
  );
}

async function boot() {
  let settings;
  try {
    settings = await loadSettings();
  } catch (error) {
    renderFatal(error);
    return;
  }

  const { config } = settings;
  const i18n = new I18n({
    basePath: config.assets?.translations ?? 'translations',
    languages: config.app?.languages ?? ['en'],
    fallback: 'en',
    defaultLanguage: config.app?.defaultLanguage ?? 'auto',
    storageKey: settings.storageKeys.lang,
  });
  await i18n.init();
  i18n.apply(document);

  const toasts = new Toasts($('#toasts'), { duration: config.ui?.toastDuration ?? 4500 });
  const ffmpeg = new FFmpegService(config);
  const queue = new TaskQueue({ concurrency: 1 });

  /** @type {AppContext} */
  const ctx = { settings, i18n, ffmpeg, queue, toasts };

  const features = {
    autocut: createAutocutFeature(ctx, $('#panel-autocut')),
    fastcut: createFastcutFeature(ctx, $('#panel-fastcut')),
    reverse: createReverseFeature(ctx, $('#panel-reverse')),
  };

  // Dynamic labels built by the features (slider fields, etc.).
  i18n.apply(document);

  // ---------------------------------------------------------------- engine

  const engineChip = $('#engine-chip');
  const engineLabel = $('#engine-label');

  const paintEngine = () => {
    const status = ffmpeg.status;
    if (engineChip) engineChip.dataset.state = status;
    if (engineLabel) engineLabel.textContent = i18n.t(`engine.${status}`);
    if (engineChip) engineChip.title = i18n.t('engine.hint');
  };

  ffmpeg.onStatus(paintEngine);
  paintEngine();

  // ---------------------------------------------------------------- tabs

  const tabs = $all('.tab');
  const panels = new Map($all('.tab-panel').map((panel) => [panel.dataset.panel, panel]));

  /** @param {string} name @param {boolean} [focusTab] */
  function activateTab(name, focusTab = false) {
    if (!panels.has(name)) return;
    for (const tab of tabs) {
      const active = tab.dataset.tab === name;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focusTab) tab.focus();
    }
    for (const [panelName, panel] of panels) {
      const active = panelName === name;
      panel.hidden = !active;
      panel.classList.toggle('is-active', active);
    }
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => activateTab(tab.dataset.tab));
  }

  const tabList = $('.tabs');
  tabList?.addEventListener('keydown', (event) => {
    const currentIndex = tabs.findIndex((tab) => tab.dataset.tab === document.activeElement?.dataset?.tab);
    if (currentIndex === -1) return;
    let nextIndex = null;

    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;

    if (nextIndex !== null) {
      event.preventDefault();
      activateTab(tabs[nextIndex].dataset.tab, true);
    }
  });

  // ---------------------------------------------------------------- language

  const langButtons = $all('#lang-switch [data-lang]');

  function paintLanguageButtons() {
    for (const button of langButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.lang === i18n.lang));
    }
  }

  for (const button of langButtons) {
    button.addEventListener('click', () => {
      i18n.setLang(button.dataset.lang).catch((error) => console.error('[Bulkut] Language switch failed', error));
    });
  }

  i18n.onChange((language) => {
    i18n.apply(document);
    paintLanguageButtons();
    paintEngine();
    for (const feature of Object.values(features)) feature.refresh();
    toasts.info(i18n.t('toasts.languageChanged', { language: i18n.languageLabel(language) }));
  });

  paintLanguageButtons();

  // ---------------------------------------------------------------- misc

  const version = config.app?.version ?? '1.0.0';
  const versionEl = $('#app-version');
  if (versionEl) versionEl.textContent = version;

  window.addEventListener('beforeunload', (event) => {
    if (!queue.busy) return;
    event.preventDefault();
    event.returnValue = '';
  });

  // Debug / automation hooks (no effect on the UI).
  window.Bulkut = {
    version,
    settings,
    i18n,
    ffmpeg,
    queue,
    features,
  };
}

boot().catch((error) => {
  console.error('[Bulkut] Unexpected startup error', error);
  renderFatal(error);
});
