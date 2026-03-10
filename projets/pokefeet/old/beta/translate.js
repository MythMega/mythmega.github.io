// translate.js
// System de traduction multilingue avec gestion des cookies

const Translator = (function() {
  let currentLanguage = 'fr';
  let translations = {};
  const LANGUAGE_COOKIE = 'pokefeet_language';
  const COOKIE_EXPIRY_DAYS = 365;

  // Cookie helpers
  function setCookie(name, value, days = COOKIE_EXPIRY_DAYS) {
    const d = new Date();
    d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = `${name}=${encodeURIComponent(value)};expires=${d.toUTCString()};path=/;SameSite=Lax`;
  }

  function getCookie(name) {
    const v = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
    return v ? decodeURIComponent(v.pop()) : null;
  }

  // Initialize translation system
  async function init() {
    // Load language from cookie or use default
    const savedLanguage = getCookie(LANGUAGE_COOKIE);
    if (savedLanguage && (savedLanguage === 'fr' || savedLanguage === 'en')) {
      currentLanguage = savedLanguage;
    }

    // Try to load translation files from translations folder
    try {
      const frResponse = await fetch('translations/fr.json');
      const enResponse = await fetch('translations/en.json');
      
      translations.fr = await frResponse.json();
      translations.en = await enResponse.json();
    } catch (e) {
      console.warn('[Translator] Could not load translation files:', e);
      // Fallback to empty object
      translations.fr = {};
      translations.en = {};
    }

    return currentLanguage;
  }

  // Get translated text by key path (e.g., 'home.title')
  function get(keyPath, defaultText = '') {
    if (!translations[currentLanguage]) {
      return defaultText;
    }

    const keys = keyPath.split('.');
    let value = translations[currentLanguage];

    for (let key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return defaultText;
      }
    }

    return typeof value === 'string' ? value : defaultText;
  }

  // Set language and save to cookie
  function setLanguage(lang) {
    if (lang === 'fr' || lang === 'en') {
      currentLanguage = lang;
      setCookie(LANGUAGE_COOKIE, lang, COOKIE_EXPIRY_DAYS);
      return true;
    }
    return false;
  }

  // Get current language
  function getLanguage() {
    return currentLanguage;
  }

  // Get all available languages
  function getAvailableLanguages() {
    return ['fr', 'en'];
  }

  return {
    init,
    get,
    setLanguage,
    getLanguage,
    getAvailableLanguages
  };
})();
