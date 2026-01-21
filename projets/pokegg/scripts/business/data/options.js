// Gestion du langage et des options
class OptionsManager {
  constructor() {
    this.currentLanguage = this.getLanguage() || 'en';
    this.translations = {};
    this.idleMode = false;
  }

  async loadLanguage(lang) {
    try {
      const response = await fetch(`./langs/${lang}.json`);
      this.translations = await response.json();
      this.currentLanguage = lang;
      this.setLanguageCookie(lang);
      return this.translations;
    } catch (error) {
      console.error(`Error loading language ${lang}:`, error);
      return {};
    }
  }

  getLanguage() {
    return this.getCookie('language') || 'en';
  }

  setLanguageCookie(lang) {
    document.cookie = `language=${lang}; path=/; max-age=${60 * 60 * 24 * 365}`;
  }

  getCookie(name) {
    const nameEQ = name + "=";
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
      cookie = cookie.trim();
      if (cookie.startsWith(nameEQ)) {
        return cookie.substring(nameEQ.length);
      }
    }
    return null;
  }

  translate(key) {
    return this.translations[key] || key;
  }

  isDarkMode() {
    return this.getCookie('darkMode') === 'true';
  }

  setDarkMode(enabled) {
    document.cookie = `darkMode=${enabled}; path=/; max-age=${60 * 60 * 24 * 365}`;
    this.applyDarkMode(enabled);
  }

  applyDarkMode(enabled) {
    if (enabled) {
      document.documentElement.classList.add('dark-mode');
    } else {
      document.documentElement.classList.remove('dark-mode');
    }
  }

  initializeDarkMode() {
    if (this.isDarkMode()) {
      this.applyDarkMode(true);
    }
  }

  isIdleMode() {
    return this.getCookie('idleMode') === 'true';
  }

  setIdleMode(enabled) {
    document.cookie = `idleMode=${enabled}; path=/; max-age=${60 * 60 * 24 * 365}`;
  }

  initializeIdleMode() {
    // Idle mode will be read from cookie when needed
  }
}

const optionsManager = new OptionsManager();
