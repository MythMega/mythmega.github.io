/**
 * Desktop download page.
 *
 * The release URLs live in `settings/config.json` (`downloads`), so publishing
 * a new build does not require touching the page. Missing files are shown as
 * "not published yet" instead of linking to a 404.
 * @module download
 */

import { $, $all } from './core/dom.js';
import { I18n } from './core/i18n.js';
import { loadSettings } from './core/settings.js';

function detectPlatform() {
  const source = `${navigator.userAgentData?.platform ?? ''} ${navigator.platform ?? ''} ${navigator.userAgent}`;
  if (/android/i.test(source)) return 'android';
  if (/win/i.test(source)) return 'windows';
  if (/mac|iphone|ipad/i.test(source)) return 'macos';
  if (/linux|x11/i.test(source)) return 'linux';
  return '';
}

async function boot() {
  let settings = null;
  try {
    settings = await loadSettings();
  } catch (error) {
    console.warn('[Bulkut] Could not load settings for the download page.', error);
  }

  const config = settings?.config ?? {};
  const i18n = new I18n({
    basePath: config.assets?.translations ?? 'translations',
    languages: config.app?.languages ?? ['en', 'fr', 'es'],
    fallback: 'en',
    defaultLanguage: config.app?.defaultLanguage ?? 'auto',
    storageKey: settings?.storageKeys?.lang ?? 'bulkut.lang',
  });
  await i18n.init();
  i18n.apply(document);

  const version = config.downloads?.version ?? config.app?.version ?? '1.0.0';
  const versionEl = $('#download-version');
  const footerVersion = $('#app-version');
  if (footerVersion) footerVersion.textContent = version;

  const downloads = config.downloads ?? {};
  const baseUrl = String(downloads.baseUrl ?? '').trim();
  const files = downloads.files ?? {};

  const base = baseUrl
    ? new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`, document.baseURI)
    : null;

  const fileLabels = new Map();

  function paintVersion() {
    if (versionEl) versionEl.textContent = i18n.t('download.version', { version });
  }

  for (const link of $all('[data-download]')) {
    const key = link.dataset.download;
    const file = files[key];
    const label = link.querySelector('span[data-i18n="download.action"]');
    if (!base || !file) {
      link.removeAttribute('href');
      link.removeAttribute('download');
      link.setAttribute('aria-disabled', 'true');
      link.classList.add('is-disabled');
      if (label) label.textContent = i18n.t('download.unavailable');
      continue;
    }

    link.href = new URL(file, base).href;
    link.setAttribute('download', file);
    link.setAttribute('rel', 'noopener');
    fileLabels.set(key, file);
  }

  for (const label of $all('[data-download-file]')) {
    const card = label.closest('[data-platform]');
    if (!card) continue;
    const keys = {
      windows: ['windows'],
      linux: ['linux'],
      macos: ['macosAppleSilicon', 'macosIntel'],
      android: ['android'],
    }[card.dataset.platform] ?? [];
    const names = keys.map((key) => fileLabels.get(key)).filter(Boolean);
    label.textContent = names.length ? [...new Set(names)].join(' · ') : i18n.t('download.unavailable');
  }

  const platform = detectPlatform();
  const recommended = platform ? document.querySelector(`[data-platform="${platform}"]`) : null;
  if (recommended) {
    recommended.dataset.recommended = 'true';
    const chip = recommended.querySelector('.download-recommended');
    if (chip) chip.hidden = false;
  }

  const langButtons = $all('#lang-switch [data-lang]');

  function paintLanguageButtons() {
    for (const button of langButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.lang === i18n.lang));
    }
  }

  for (const button of langButtons) {
    button.addEventListener('click', () => {
      i18n.setLang(button.dataset.lang).catch((error) => {
        console.error('[Bulkut] Language switch failed', error);
      });
    });
  }

  i18n.onChange(() => {
    i18n.apply(document);
    paintLanguageButtons();
    paintVersion();
    for (const link of $all('[data-download].is-disabled')) {
      const label = link.querySelector('span[data-i18n="download.action"]');
      if (label) label.textContent = i18n.t('download.unavailable');
    }
  });

  paintVersion();
  paintLanguageButtons();
}

boot().catch((error) => {
  console.error('[Bulkut] Download page failed to start', error);
});
