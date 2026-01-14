// Gestion du langage et des options
class OptionsManager {
  constructor() {
    this.currentLanguage = this.getLanguage() || 'en';
    this.translations = {};
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
}

const optionsManager = new OptionsManager();
