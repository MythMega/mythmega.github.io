/**
 * Script principal de `settings.html` : thème, langue, relais CORS et gestion du cache.
 */
import { initSite } from './bootstrap.js';
import { saveSettings } from '../data/settings-store.js';
import { applyTheme, currentTheme } from './theme.js';
import { setLang, currentLanguage, t, formatSize } from './i18n.js';
import { countCached, clearCache } from '../data/streamer-repository.js';
import { $, $$ } from './dom.js';
import { toast } from './toast.js';

async function main() {
  await initSite();

  /* --- Apparence --------------------------------------------------- */

  const themeButtons = $$('.theme-btn');
  themeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      applyTheme(button.dataset.theme);
      saveSettings({ theme: button.dataset.theme });
      renderThemeButtons();
    });
  });

  /* --- Langue ------------------------------------------------------ */

  const langSelect = $('#langSelect');
  langSelect.value = currentLanguage();
  langSelect.addEventListener('change', async () => {
    const target = langSelect.value;
    if (target !== currentLanguage()) {
      await setLang(target);
      resetClearButton();
      await renderCacheStats();
    }
  });

  /* --- Source & relais CORS ---------------------------------------- */

  const PROXY_KEY = 'streamguessr.proxyUrl';
  const USE_ALLORIGINS_KEY = 'streamguessr.useAllorigins';
  const alloriginsToggle = $('#useAlloriginsToggle');
  const proxyInput = $('#proxyUrlInput');

  try {
    proxyInput.value = localStorage.getItem(PROXY_KEY) || '';
  } catch {
    proxyInput.value = '';
  }

  proxyInput.addEventListener('change', () => {
    const value = proxyInput.value.trim().replace(/\/+$/, '');
    try {
      if (value) localStorage.setItem(PROXY_KEY, value);
      else localStorage.removeItem(PROXY_KEY);
    } catch {
      // stockage indisponible : le relais ne sera pas retenu
    }
    toast(t('settings.proxySaved'), { tone: 'is-good' });
  });

  /* --- Toggle relais publics (allorigins) -------------------------- */

  try {
    const stored = localStorage.getItem(USE_ALLORIGINS_KEY);
    alloriginsToggle.checked = stored === null ? true : stored === 'true';
  } catch {
    alloriginsToggle.checked = true;
  }

  alloriginsToggle.addEventListener('change', () => {
    try {
      localStorage.setItem(USE_ALLORIGINS_KEY, String(alloriginsToggle.checked));
    } catch {
      // stockage indisponible
    }
    toast(
      alloriginsToggle.checked
        ? t('settings.publicRelaysEnabled')
        : t('settings.publicRelaysDisabled'),
      { tone: 'is-info' }
    );
  });

  /* --- Cache ------------------------------------------------------- */

  const clearBtn = $('#clearCacheBtn');
  clearBtn.addEventListener('click', async () => {
    if (!clearBtn.classList.contains('is-confirming')) {
      clearBtn.classList.add('is-confirming');
      clearBtn.textContent = t('settings.clearCacheConfirm');
      return;
    }

    await clearCache();
    resetClearButton();
    toast(t('settings.cacheCleared'), { tone: 'is-good' });
    await renderCacheStats();
  });
  clearBtn.addEventListener('blur', resetClearButton);

  await renderThemeButtons();
  await renderCacheStats();

  /* ---------------------------------------------------------------- */

  function renderThemeButtons() {
    const activeTheme = currentTheme();
    themeButtons.forEach((button) => {
      const active = button.dataset.theme === activeTheme;
      button.classList.toggle('is-selected', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function resetClearButton() {
    clearBtn.classList.remove('is-confirming');
    clearBtn.textContent = t('settings.clearCache');
  }

  async function renderCacheStats() {
    const count = await countCached();
    let size = 0;
    if (navigator.storage && typeof navigator.storage.estimate === 'function') {
      try {
        size = (await navigator.storage.estimate()).usage || 0;
      } catch {
        size = 0;
      }
    }
    $('#cacheStats').textContent = t(
      count === 1 ? 'settings.cacheStats' : 'settings.cacheStatsPlural',
      { count, size: formatSize(size) }
    );
  }
}

main();