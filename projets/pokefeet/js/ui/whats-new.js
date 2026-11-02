// whats-new.js — Popup « nouveautés » ouverte quand le changelog change.
//
// Le changelog vit dans `data/changelog.json`, déjà précaché par le Service
// Worker : l'entrée la plus récente est reprise telle quelle, avec ses textes
// français et anglais, comme sur la page changelog.html.
//
// La version affichée est retenue dans le cookie `pk_changelog_seen` : la popup
// revient donc à la version suivante, et pas à chaque page. Un visiteur sans
// données de jeu (aucune partie, aucun résultat, aucune complétion) ne voit
// rien : la fenêtre ne parle qu'à ceux qui ont quelque chose à retrouver.
//
// Aucun balisage n'est écrit dans les pages : la popup se construit au moment
// de l'affichage, puis se contente d'être masquée.
(function () {
  'use strict';

  /** Cookie qui retient la dernière version dont le changelog a été montré. */
  const SEEN_COOKIE = 'pk_changelog_seen';

  /** Changelog, servi depuis la racine du site par toutes les pages. */
  const CHANGELOG_URL = './data/changelog.json';

  /** Durée du cookie, en jours. */
  const COOKIE_DAYS = 3650;

  /** Textes propres à la fenêtre, à défaut des traductions du site. */
  const FALLBACK_TEXT = {
    fr: {
      intro: 'Voici ce qui change dans cette version.',
      close: "C'est parti",
      link: 'Tout le changelog'
    },
    en: {
      intro: 'Here is what changed in this version.',
      close: 'Got it',
      link: 'Full changelog'
    }
  };

  /** Cookies qui prouvent qu'un joueur a déjà joué sur cet appareil. */
  const PLAYER_COOKIES = ['pk_best', 'pk_best_streak', 'pk_pseudo'];

  /** Bases IndexedDB (et magasins) qui contiennent des données de jeu. */
  const PLAYER_STORES = [
    ['PokefeetDB', 'daily_results'],
    ['PokefeetDB', 'weekly_results'],
    ['PokefeetChallengeDB', 'challenge_completions'],
    ['PokefeetDexDB', 'dex_entries']
  ];

  /** Fond de la popup, créé une seule fois par page. */
  let overlay = null;

  /** Bouton principal, cible du focus à l'ouverture. */
  let closeButton = null;

  /**
   * Langue courante du site.
   * @returns {string} 'fr' ou 'en'.
   */
  function currentLanguage() {
    if (typeof Translator !== 'undefined' && typeof Translator.getLanguage === 'function') {
      const lang = Translator.getLanguage();
      if (lang === 'fr' || lang === 'en') return lang;
    }
    return document.documentElement.lang === 'en' ? 'en' : 'fr';
  }

  /**
   * Texte traduit de la fenêtre.
   * @param {string} key - Clé courte : intro, close, link.
   * @returns {string} Le texte à afficher.
   */
  function text(key) {
    const fallback = FALLBACK_TEXT[currentLanguage()][key] || '';
    if (typeof Translator === 'undefined' || typeof Translator.get !== 'function') return fallback;
    return Translator.get('whatsNew.' + key, fallback);
  }

  /**
   * Lit un cookie.
   * @param {string} name - Nom du cookie.
   * @returns {string|null} Sa valeur, ou null.
   */
  function readCookie(name) {
    const match = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
    return match ? decodeURIComponent(match.pop()) : null;
  }

  /**
   * Écrit un cookie pour COOKIE_DAYS jours.
   * @param {string} name - Nom du cookie.
   * @param {string} value - Valeur à retenir.
   * @returns {void}
   */
  function writeCookie(name, value) {
    const expires = new Date();
    expires.setDate(expires.getDate() + COOKIE_DAYS);
    document.cookie = name + '=' + encodeURIComponent(value) +
      ';expires=' + expires.toUTCString() + ';path=/;SameSite=Lax';
  }

  /**
   * Identifiant court d'une version, tel qu'il est retenu en cookie.
   * @param {object} version - Bloc `Version` du changelog.
   * @returns {string} Par exemple « 6.0.0 » ou « 1.5.0-beta ».
   */
  function versionKey(version) {
    const v = version || {};
    const base = [v.Major, v.Minor, v.Patch].map(function (part) { return Number(part) || 0; }).join('.');
    const stage = String(v.Stage || 'Release').toLowerCase();
    return stage === 'release' ? base : base + '-' + stage;
  }

  /**
   * Étiquette de version affichée dans la popup.
   * @param {object} version - Bloc `Version` du changelog.
   * @returns {{className: string, label: string}} Classe de style et libellé.
   */
  function badgeFor(version) {
    const v = version || {};
    const stage = String(v.Stage || 'Release').toLowerCase();
    if (stage === 'beta') return { className: 'beta', label: 'Beta ' + v.Major + '.' + v.Minor };
    if (stage === 'alpha') return { className: 'alpha', label: 'Alpha ' + v.Major + '.' + v.Minor };
    return { className: 'release', label: 'v' + v.Major + '.' + v.Minor + '.' + v.Patch };
  }

  /**
   * Convertit une date JJ/MM/AAAA en valeur comparable.
   * @param {string} date - Date du changelog.
   * @returns {number} Horodatage, 0 si la date est illisible.
   */
  function dateValue(date) {
    const parts = String(date || '').split('/');
    if (parts.length !== 3) return 0;
    return Date.UTC(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
  }

  /**
   * Rang d'une version, pour départager deux entrées du même jour.
   * @param {object} version - Bloc `Version` du changelog.
   * @returns {number} Rang croissant.
   */
  function versionRank(version) {
    const v = version || {};
    const stage = String(v.Stage || 'Release').toLowerCase();
    const base = (Number(v.Major) || 0) * 1000000 + (Number(v.Minor) || 0) * 1000 + (Number(v.Patch) || 0);
    if (stage === 'beta') return -2000000000 + base;
    if (stage === 'alpha') return -3000000000 + base;
    return base;
  }

  /**
   * Entrée la plus récente, triée comme la page changelog.
   * @param {Array<object>} entries - Toutes les entrées du changelog.
   * @returns {object|null} La dernière version publiée.
   */
  function newestEntry(entries) {
    return entries.slice().sort(function (a, b) {
      const byDate = dateValue(b.Date) - dateValue(a.Date);
      if (byDate !== 0) return byDate;
      return versionRank(b.Version) - versionRank(a.Version);
    })[0] || null;
  }

  /**
   * Compte les lignes d'un magasin IndexedDB.
   * @param {string} dbName - Nom de la base (déjà existante).
   * @param {string} storeName - Nom du magasin.
   * @returns {Promise<number>} Nombre de lignes, 0 en cas d'échec.
   */
  function countRows(dbName, storeName) {
    return new Promise(function (resolve) {
      let request;
      try {
        request = window.indexedDB.open(dbName);
      } catch (error) {
        resolve(0);
        return;
      }
      request.onerror = function () { resolve(0); };
      request.onsuccess = function () {
        const db = request.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.close();
          resolve(0);
          return;
        }
        const count = db.transaction(storeName, 'readonly').objectStore(storeName).count();
        count.onsuccess = function () { const rows = count.result || 0; db.close(); resolve(rows); };
        count.onerror = function () { db.close(); resolve(0); };
      };
    });
  }

  /**
   * Indique si cet appareil contient déjà des données de jeu.
   *
   * Les bases sont listées avant d'être ouvertes : ouvrir une base absente la
   * créerait vide, ce qui rendrait ensuite un nouveau visiteur indiscernable
   * d'un joueur qui a déjà joué sans rien marquer.
   * @returns {Promise<boolean>} Vrai si le joueur a des données.
   */
  async function hasPlayerData() {
    if (PLAYER_COOKIES.some(function (name) {
      const value = readCookie(name);
      return value !== null && value !== '' && value !== '0';
    })) return true;

    if (!window.indexedDB || typeof window.indexedDB.databases !== 'function') return false;

    let names = [];
    try {
      names = (await window.indexedDB.databases())
        .map(function (db) { return db && db.name; })
        .filter(Boolean);
    } catch (error) {
      return false;
    }

    for (const [dbName, storeName] of PLAYER_STORES) {
      if (names.indexOf(dbName) === -1) continue;
      if ((await countRows(dbName, storeName)) > 0) return true;
    }
    return false;
  }

  /**
   * Texte d'une ligne du changelog dans la langue courante.
   * @param {object} item - Ligne du changelog.
   * @returns {string} Le texte à afficher.
   */
  function translatedItem(item) {
    const key = currentLanguage() === 'en' ? 'Translation_EN' : 'Translation_FR';
    return item[key] || item.Translation_EN || item.Translation_FR || '';
  }

  /**
   * Classe de style d'un type de modification, comme sur la page changelog.
   * @param {string} type - Type de la ligne (Feature, Fix, etc.).
   * @returns {string} Classe CSS `type-…`.
   */
  function typeClass(type) {
    return 'type-' + String(type || '').toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
  }

  /**
   * Crée la popup une seule fois et l'ajoute au `<body>`.
   * @returns {void}
   */
  function build() {
    if (overlay) return;

    overlay = document.createElement('div');
    overlay.className = 'whats-new';
    overlay.hidden = true;

    const card = document.createElement('div');
    card.className = 'whats-new__card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'whatsNewTitle');

    const head = document.createElement('div');
    head.className = 'whats-new__head';

    const badge = document.createElement('span');
    badge.className = 'whats-new__badge';

    const date = document.createElement('span');
    date.className = 'whats-new__date';
    head.append(badge, date);

    const title = document.createElement('h2');
    title.className = 'whats-new__title';
    title.id = 'whatsNewTitle';

    const intro = document.createElement('p');
    intro.className = 'whats-new__intro';

    const items = document.createElement('ul');
    items.className = 'whats-new__items';

    const actions = document.createElement('div');
    actions.className = 'whats-new__actions';

    const link = document.createElement('a');
    link.className = 'whats-new__link';
    link.href = 'changelog.html';

    closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'whats-new__btn';
    closeButton.addEventListener('click', hide);

    actions.append(link, closeButton);
    card.append(head, title, intro, items, actions);
    overlay.appendChild(card);
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) hide();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && overlay && !overlay.hidden) {
        event.preventDefault();
        hide();
      }
    });
    document.body.appendChild(overlay);
  }

  /**
   * Écrit les données de la version dans la popup.
   * @param {object} entry - Entrée du changelog à montrer.
   * @returns {void}
   */
  function render(entry) {
    const badge = badgeFor(entry.Version);
    const badgeEl = overlay.querySelector('.whats-new__badge');
    badgeEl.className = 'whats-new__badge whats-new__badge--' + badge.className;
    badgeEl.textContent = badge.label;
    overlay.querySelector('.whats-new__date').textContent = entry.Date || '';
    overlay.querySelector('.whats-new__title').textContent = entry.Title || '';
    overlay.querySelector('.whats-new__intro').textContent = text('intro');

    const list = overlay.querySelector('.whats-new__items');
    list.textContent = '';
    (entry.Changelog || []).forEach(function (item) {
      const line = document.createElement('li');
      line.className = 'whats-new__item ' + typeClass(item.Type) + ' severity-' + item.Severity;
      line.textContent = translatedItem(item);
      list.appendChild(line);
    });

    overlay.querySelector('.whats-new__link').textContent = text('link');
    closeButton.textContent = text('close');
  }

  /**
   * Affiche la popup pour une version, et retient qu'elle a été vue.
   * @param {object} entry - Entrée du changelog à montrer.
   * @returns {void}
   */
  function show(entry) {
    writeCookie(SEEN_COOKIE, versionKey(entry.Version));
    build();
    render(entry);
    overlay.hidden = false;
    closeButton.focus();
  }

  /**
   * Referme la popup sans rien oublier de plus.
   * @returns {void}
   */
  function hide() {
    if (overlay) overlay.hidden = true;
  }

  /**
   * Compare la version publiée à la dernière vue, puis affiche si besoin.
   * @returns {Promise<void>} Résolue quand la décision est prise.
   */
  async function start() {
    let entries;
    try {
      const response = await fetch(CHANGELOG_URL);
      if (!response.ok) throw new Error('HTTP ' + response.status);
      entries = await response.json();
      if (!Array.isArray(entries)) throw new Error('tableau attendu dans ' + CHANGELOG_URL);
    } catch (error) {
      console.warn('[WhatsNew] changelog illisible :', error);
      return;
    }

    const entry = newestEntry(entries);
    if (!entry) return;
    if (readCookie(SEEN_COOKIE) === versionKey(entry.Version)) return;
    if (!(await hasPlayerData())) return;
    show(entry);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
