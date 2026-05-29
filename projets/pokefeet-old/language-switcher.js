// language-switcher.js
// Interfaceà flottante pour changer la langue

const LanguageSwitcher = (function() {
  let isOpen = false;

  function createSwitcher() {
    // Create main floating button container
    const container = document.createElement('div');
    container.id = 'language-switcher-container';
    container.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 9999;
      font-family: inherit;
    `;

    // Create the floating button
    const button = document.createElement('button');
    button.id = 'language-toggle-btn';
    button.setAttribute('aria-label', 'Changer la langue / Change language');
    button.style.cssText = `
      width: 56px;
      height: 56px;
      border-radius: 50%;
      border: none;
      background: var(--accent, #22c55e);
      color: #052018;
      font-weight: 700;
      font-size: 16px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(34, 197, 94, 0.4);
      transition: all 200ms ease;
      box-sizing: border-box;
      padding: 0;
    `;

    const currentLang = Translator.getLanguage();
    button.textContent = currentLang === 'fr' ? '🇫🇷' : '🇬🇧';
    button.dataset.lang = currentLang;

    button.addEventListener('mouseover', () => {
      button.style.transform = 'scale(1.1)';
      button.style.boxShadow = '0 6px 16px rgba(34, 197, 94, 0.6)';
    });

    button.addEventListener('mouseout', () => {
      button.style.transform = 'scale(1)';
      button.style.boxShadow = '0 4px 12px rgba(34, 197, 94, 0.4)';
    });

    button.addEventListener('click', toggleMenu);

    // Create menu (initially hidden)
    const menu = document.createElement('div');
    menu.id = 'language-menu';
    menu.style.cssText = `
      position: absolute;
      bottom: 70px;
      right: 0;
      background: var(--card, #1a2332);
      border: 1px solid rgba(34, 197, 94, 0.3);
      border-radius: 12px;
      padding: 8px;
      min-width: 140px;
      box-shadow: 0 8px 24px rgba(2, 6, 23, 0.8);
      display: none;
      flex-direction: column;
      gap: 4px;
    `;

    // Create menu items
    const languages = [
      { code: 'fr', label: '🇫🇷 Français', flag: '🇫🇷' },
      { code: 'en', label: '🇬🇧 English', flag: '🇬🇧' }
    ];

    languages.forEach(lang => {
      const item = document.createElement('button');
      item.style.cssText = `
        width: 100%;
        padding: 10px 12px;
        border: none;
        background: transparent;
        color: var(--muted, #94a3b8);
        font-size: 14px;
        cursor: pointer;
        text-align: left;
        border-radius: 8px;
        transition: all 200ms ease;
        font-weight: 500;
        border: 1px solid transparent;
      `;

      if (lang.code === currentLang) {
        item.style.background = 'rgba(34, 197, 94, 0.15)';
        item.style.color = 'var(--accent, #22c55e)';
        item.style.borderColor = 'rgba(34, 197, 94, 0.3)';
        item.style.fontWeight = '700';
      }

      item.textContent = lang.label;
      item.dataset.lang = lang.code;

      item.addEventListener('mouseover', () => {
        if (lang.code !== currentLang) {
          item.style.background = 'rgba(148, 163, 184, 0.15)';
          item.style.color = 'var(--muted, #cbd5e1)';
        }
      });

      item.addEventListener('mouseout', () => {
        if (lang.code === currentLang) {
          item.style.background = 'rgba(34, 197, 94, 0.15)';
          item.style.color = 'var(--accent, #22c55e)';
        } else {
          item.style.background = 'transparent';
          item.style.color = 'var(--muted, #94a3b8)';
        }
      });

      item.addEventListener('click', () => changeLanguage(lang.code));
      menu.appendChild(item);
    });

    container.appendChild(button);
    container.appendChild(menu);

    return { container, button, menu };
  }

  function toggleMenu() {
    isOpen = !isOpen;
    const menu = document.getElementById('language-menu');
    if (menu) {
      if (isOpen) {
        menu.style.display = 'flex';
        menu.style.animation = 'slideUp 200ms ease forwards';
      } else {
        menu.style.display = 'none';
      }
    }
  }

  function changeLanguage(lang) {
    if (Translator.setLanguage(lang)) {
      // Close menu
      toggleMenu();
      
      // Update button
      const button = document.getElementById('language-toggle-btn');
      if (button) {
        button.textContent = lang === 'fr' ? '🇫🇷' : '🇬🇧';
        button.dataset.lang = lang;
      }

      // Update menu items
      const items = document.querySelectorAll('#language-menu button');
      items.forEach(item => {
        const itemLang = item.dataset.lang;
        if (itemLang === lang) {
          item.style.background = 'rgba(34, 197, 94, 0.15)';
          item.style.color = 'var(--accent, #22c55e)';
          item.style.borderColor = 'rgba(34, 197, 94, 0.3)';
          item.style.fontWeight = '700';
        } else {
          item.style.background = 'transparent';
          item.style.color = 'var(--muted, #94a3b8)';
          item.style.borderColor = 'transparent';
          item.style.fontWeight = '500';
        }
      });

      // Reload page to apply translations
      window.location.reload();
    }
  }

  function init() {
    // Add CSS for animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideUp {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      
      #language-switcher-container button:active {
        transform: scale(0.95) !important;
      }
    `;
    document.head.appendChild(style);

    // Create and insert switcher
    const { container } = createSwitcher();
    document.body.appendChild(container);

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
      const button = document.getElementById('language-toggle-btn');
      const menu = document.getElementById('language-menu');
      if (button && menu && !button.contains(e.target) && !menu.contains(e.target)) {
        if (isOpen) {
          isOpen = false;
          menu.style.display = 'none';
        }
      }
    });
  }

  return {
    init
  };
})();
