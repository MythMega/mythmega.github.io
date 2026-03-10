// i18n-setup.js
// Initialise le système de traduction et applique les traductions aux éléments HTML

async function initializeI18n() {
  // Initialize translator
  await Translator.init();
  
  // Apply translations to all elements with data-i18n attributes
  applyTranslations();
  
  // Initialize language switcher
  LanguageSwitcher.init();
}

function applyTranslations() {
  // Find all elements with data-i18n attributes
  const elements = document.querySelectorAll('[data-i18n]');
  
  elements.forEach(el => {
    const key = el.getAttribute('data-i18n');
    const translation = Translator.get(key, el.textContent);
    el.textContent = translation;
  });

  // Find all elements with data-i18n-attr attributes
  const attrElements = document.querySelectorAll('[data-i18n-attr]');
  
  attrElements.forEach(el => {
    const attrDef = el.getAttribute('data-i18n-attr');
    // Format: "attributeName:key" or "attr1:key1|attr2:key2"
    const attrs = attrDef.split('|');
    
    attrs.forEach(attrMapping => {
      const [attrName, key] = attrMapping.split(':');
      if (attrName && key) {
        const translation = Translator.get(key, el.getAttribute(attrName));
        el.setAttribute(attrName, translation);
      }
    });
  });

  // Update lang attribute on html element
  document.documentElement.lang = Translator.getLanguage();
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeI18n);
} else {
  initializeI18n();
}
