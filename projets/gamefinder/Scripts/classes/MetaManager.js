/**
 * MetaManager.js
 * Gestion centralisée des meta tags pour le SEO, Open Graph et Twitter Card.
 * Utilisé dans une SPA où le contenu change dynamiquement.
 */

class MetaManager {
  constructor() {
    this._defaults = {
      title: 'Gamefinder 2.0',
      description: 'Trouve ton prochain jeu vidéo grâce à notre roulette de sélection intelligente.',
      image: 'https://mythmega.github.io/assets/roulette.png',
      url: window.location.href,
      type: 'website',
      locale: 'fr_FR',
    };
  }

  /**
   * Met à jour toutes les meta tags de la page.
   * @param {Object} opts
   * @param {string} [opts.title]
   * @param {string} [opts.description]
   * @param {string} [opts.image]
   * @param {string} [opts.url]
   * @param {string} [opts.type]
   * @param {string} [opts.locale]
   * @param {string} [opts.siteName]
   */
  set(opts = {}) {
    const data = { ...this._defaults, ...opts };
    this._setTag('title', data.title, 'title');
    this._setMeta('description', data.description);

    // Open Graph
    this._setMeta('og:title', data.title, 'property');
    this._setMeta('og:description', data.description, 'property');
    this._setMeta('og:image', data.image, 'property');
    this._setMeta('og:url', data.url, 'property');
    this._setMeta('og:type', data.type, 'property');
    this._setMeta('og:locale', data.locale, 'property');
    this._setMeta('og:site_name', data.siteName || 'Gamefinder 2.0', 'property');

    // Twitter Card
    this._setMeta('twitter:card', 'summary_large_image', 'name');
    this._setMeta('twitter:title', data.title, 'name');
    this._setMeta('twitter:description', data.description, 'name');
    this._setMeta('twitter:image', data.image, 'name');

    // Hreflang
    this._setHreflang(data.url);

    // Canonical
    this._setCanonical(data.url);
  }

  /**
   * Réinitialise aux valeurs par défaut.
   */
  reset() {
    this.set();
  }

  /**
   * Créé ou met à jour une balise <meta>.
   * @param {string} key
   * @param {string} content
   * @param {string} [attr='name']
   */
  _setMeta(key, content, attr = 'name') {
    if (!content) return;
    let tag = document.querySelector(`meta[${attr}="${key}"]`);
    if (!tag) {
      tag = document.createElement('meta');
      tag.setAttribute(attr, key);
      document.head.appendChild(tag);
    }
    tag.setAttribute('content', content);
  }

  /**
   * Créé ou met à jour la balise <title>.
   * @param {string} title
   */
  _setTag(tag, content, attr = 'name') {
    if (tag === 'title') {
      document.title = content;
      return;
    }
    let el = document.querySelector(`${tag}[${attr}="${content}"]`);
    if (!el) {
      el = document.createElement(tag);
      el.setAttribute(attr, content);
      document.head.appendChild(el);
    }
  }

  /**
   * Gère les balises hreflang pour le SEO multilingue.
   * @param {string} baseUrl
   */
  _setHreflang(baseUrl) {
    const existing = document.querySelectorAll('link[rel="alternate"][hreflang]');
    existing.forEach(el => el.remove());

    const langs = [
      { code: 'fr', url: baseUrl },
      { code: 'en', url: baseUrl },
      { code: 'x-default', url: baseUrl },
    ];

    langs.forEach(lang => {
      const link = document.createElement('link');
      link.rel = 'alternate';
      link.hreflang = lang.code;
      link.href = lang.url;
      document.head.appendChild(link);
    });
  }

  /**
   * Créé ou met à jour la balise canonical.
   * @param {string} url
   */
  _setCanonical(url) {
    let link = document.querySelector('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'canonical';
      document.head.appendChild(link);
    }
    link.href = url;
  }
}

window.MetaManager = MetaManager;