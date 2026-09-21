/* ============================================================
   Cat Logic Puzzle — main.js
   Logique commune : cookies (langue, thème, sons, notes auto),
   traductions FR/ES/EN, application du thème, sons et utilitaires.
   ============================================================ */
(function (global) {
  'use strict';

  var LANG_KEY = 'lang';
  var THEME_KEY = 'theme';
  var SOUND_KEY = 'sound';
  var NOTES_KEY = 'notes';
  var LANGS = ['fr', 'es', 'en'];
  var THEMES = ['light', 'dark'];
  var DEFAULT_THEME = 'light';

  var SOUND_FILES = {
    click: 'assets/sounds/click.wav',
    error: 'assets/sounds/error.wav',
    victory: 'assets/sounds/victory.wav',
    abandon: 'assets/sounds/abandon.wav'
  };

  var SOUND_VOLUME = {
    click: 0.55,
    error: 0.55,
    victory: 0.8,
    abandon: 0.6
  };

  /* ---------- Stockage : cookie en priorité, localStorage en secours ----------
     Les navigateurs bloquent souvent document.cookie quand les pages sont
     ouvertes en file:// ; le miroir localStorage garde les réglages valables. */
  function setCookie(name, value) {
    try {
      document.cookie = name + '=' + encodeURIComponent(value) +
        ';path=/;max-age=31536000;SameSite=Lax';
    } catch (err) { /* stockage indisponible */ }
  }

  function getCookie(name) {
    try {
      var parts = (document.cookie || '').split(';');
      for (var i = 0; i < parts.length; i++) {
        var pair = parts[i].trim();
        if (pair.indexOf(name + '=') === 0) {
          return decodeURIComponent(pair.slice(name.length + 1));
        }
      }
    } catch (err) { /* stockage indisponible */ }
    return null;
  }

  function readStore(name) {
    var fromCookie = getCookie(name);
    if (fromCookie) return fromCookie;
    try {
      return global.localStorage ? global.localStorage.getItem('catpuzzle.' + name) : null;
    } catch (err) { return null; }
  }

  function writeStore(name, value) {
    setCookie(name, value);
    try {
      if (global.localStorage) global.localStorage.setItem('catpuzzle.' + name, value);
    } catch (err) { /* stockage indisponible */ }
  }

  function oneOf(value, allowed, fallback) {
    return allowed.indexOf(value) >= 0 ? value : fallback;
  }

  /* ---------- Langue ---------- */
  var currentLang = 'en';

  function detectLang() {
    var stored = oneOf(readStore(LANG_KEY), LANGS, null);
    if (stored) return stored;
    var candidates = [];
    if (global.navigator) {
      if (global.navigator.languages && global.navigator.languages.length) {
        candidates = candidates.concat(Array.prototype.slice.call(global.navigator.languages));
      }
      if (global.navigator.language) candidates.push(global.navigator.language);
    }
    for (var i = 0; i < candidates.length; i++) {
      var tag = String(candidates[i] || '').toLowerCase().slice(0, 2);
      if (tag === 'fr' || tag === 'es') return tag;
    }
    return 'en';
  }

  function getLang() { return currentLang; }

  function setLang(lang) {
    currentLang = oneOf(lang, LANGS, 'en');
    writeStore(LANG_KEY, currentLang);
    if (global.document && global.document.documentElement) {
      global.document.documentElement.lang = currentLang;
    }
    return currentLang;
  }

  /* ---------- Thème ---------- */
  function getTheme() {
    return oneOf(readStore(THEME_KEY), THEMES, DEFAULT_THEME);
  }

  function applyTheme(theme) {
    if (!global.document || !global.document.body) return theme;
    var value = oneOf(theme, THEMES, DEFAULT_THEME);
    var cls = global.document.body.classList;
    cls.remove('theme-light', 'theme-dark');
    cls.add('theme-' + value);
    return value;
  }

  function setTheme(theme) {
    var value = oneOf(theme, THEMES, DEFAULT_THEME);
    writeStore(THEME_KEY, value);
    applyTheme(value);
    return value;
  }

  /* ---------- Sons (activés / désactivés) ---------- */
  function isSoundOn() { return readStore(SOUND_KEY) !== 'off'; }
  function setSound(on) { writeStore(SOUND_KEY, on ? 'on' : 'off'); }

  /* ---------- Notes automatiques ---------- */
  function isNotesOn() { return readStore(NOTES_KEY) !== 'off'; }
  function setNotes(on) { writeStore(NOTES_KEY, on ? 'on' : 'off'); }

  /* ---------- Traductions ---------- */
  var i18n = {
    en: {
      app_title: 'Cat Logic Puzzle',
      app_tagline: 'A cosy logic puzzle, full of cats',
      home_footer: 'Made with love and a lot of cats',
      play: 'Play',
      settings: 'Settings',
      home: 'Home',
      play_title: 'Choose a game',
      play_intro: 'Pick a difficulty or build your own grid. Every game follows the same two rules: one cat per colour region and one per row and column.',
      easy: 'Easy',
      medium: 'Medium',
      hard: 'Hard',
      custom: 'Custom',
      custom_desc: 'Drag the slider to choose a grid from 5×5 to 15×15.',
      size_label: 'Grid size',
      grid_size: 'Grid {size}×{size}',
      start: 'Start game',
      level_easy: 'Easy level',
      level_medium: 'Medium level',
      level_hard: 'Hard level',
      level_custom: 'Custom level',
      level_title: '{level} · {size}×{size}',
      rules_title: 'Rules',
      rule1: '1 cat in each colour region',
      rule2: '1 cat in every row and column',
      rule3: 'Cats cannot touch, not even diagonally',
      rules_hint: 'Tap an empty square to place a cat, tap a cat to remove it. You win when every row, every column and every colour region holds exactly one cat and no two cats touch.',
      rules_hint_relaxed: 'Tap an empty square to place a cat, tap a cat to remove it. You win when every row, every column and every colour region holds exactly one cat.',
      angry_mode: 'Angry Cat Mode',
      angry_about: 'About Angry Cat Mode',
      angry_help: 'When Angry Cat Mode is on, rule 3 is added: cats can no longer be next to another cat, not even diagonally. Turn it on here before starting a game.',
      counter: '{placed}/{total} cats',
      replay: 'Play again',
      help: 'Help',
      help_title: 'How to play',
      close: 'Close',
      abandon: 'Give up',
      choose_difficulty: 'Choose another difficulty',
      new_grid: 'New grid',
      victory_title: 'Well done!',
      victory_message: 'Every cat found its square: the puzzle is solved.',
      abandon_message: 'You gave up this puzzle.',
      error_row: 'There is already a cat in this row.',
      error_col: 'There is already a cat in this column.',
      error_region: 'There is already a cat in this colour region.',
      error_touch: 'Cats cannot touch each other, not even diagonally.',
      notes_toggle: 'Auto notes',
      notes_on: 'Auto notes: on',
      notes_off: 'Auto notes: off',
      legend_notes: '✕ = a square that cannot hold a cat',
      legend_region: 'Thick lines separate the colour regions',
      cell_label: 'Row {row}, column {col}',
      cell_label_cat: 'Row {row}, column {col}: cat',
      settings_title: 'Settings',
      settings_intro: 'Your choices are saved on this device and applied to every page of the game.',
      language: 'Language',
      theme: 'Theme',
      light: 'Light',
      dark: 'Dark',
      sounds: 'Sounds',
      on: 'On',
      off: 'Off',
      back_home: 'Back to home',
      saved: 'Settings saved',
      loading: 'Building the puzzle…',
      loading_hint: 'The cats are choosing their squares'
    },
    fr: {
      app_title: 'Puzzle logique de chats',
      app_tagline: 'Un puzzle logique tout doux, plein de chats',
      home_footer: 'Fait avec le cœur et beaucoup de chats',
      play: 'Jouer',
      settings: 'Paramètres',
      home: 'Accueil',
      play_title: 'Choisir une partie',
      play_intro: 'Choisis une difficulté ou crée ta propre grille. Toutes les parties suivent les mêmes deux règles : un chat par région de couleur et un par ligne et par colonne.',
      easy: 'Facile',
      medium: 'Moyen',
      hard: 'Difficile',
      custom: 'Personnalisé',
      custom_desc: 'Déplace le curseur pour choisir une grille de 5×5 à 15×15.',
      size_label: 'Taille de la grille',
      grid_size: 'Grille {size}×{size}',
      start: 'Lancer la partie',
      level_easy: 'Niveau facile',
      level_medium: 'Niveau moyen',
      level_hard: 'Niveau difficile',
      level_custom: 'Niveau personnalisé',
      level_title: '{level} · {size}×{size}',
      rules_title: 'Règles',
      rule1: '1 chat dans chaque région de couleur',
      rule2: '1 chat dans chaque ligne et chaque colonne',
      rule3: 'Les chats ne peuvent pas se toucher, même en diagonale',
      rules_hint: 'Touche une case vide pour placer un chat, touche un chat pour le retirer. La partie est gagnée quand chaque ligne, chaque colonne et chaque région de couleur contient exactement un chat, sans aucun contact.',
      rules_hint_relaxed: 'Touche une case vide pour placer un chat, touche un chat pour le retirer. La partie est gagnée quand chaque ligne, chaque colonne et chaque région de couleur contient exactement un chat.',
      angry_mode: 'Mode Chat Fâché',
      angry_about: 'À propos du Mode Chat Fâché',
      angry_help: 'Quand le Mode Chat Fâché est activé, la règle 3 s’ajoute : les chats ne peuvent plus être autour d’un autre chat, même en diagonale. Active-le ici avant de lancer une partie.',
      counter: '{placed}/{total} chats',
      replay: 'Rejouer',
      help: 'Aide',
      help_title: 'Comment jouer',
      close: 'Fermer',
      abandon: 'Abandonner',
      choose_difficulty: 'Choisir une autre difficulté',
      new_grid: 'Nouvelle grille',
      victory_title: 'Bravo !',
      victory_message: 'Tous les chats ont trouvé leur case : le puzzle est résolu.',
      abandon_message: 'Tu as abandonné cette partie.',
      error_row: 'Il y a déjà un chat sur cette ligne.',
      error_col: 'Il y a déjà un chat sur cette colonne.',
      error_region: 'Il y a déjà un chat dans cette région de couleur.',
      error_touch: 'Les chats ne peuvent pas se toucher, même en diagonale.',
      notes_toggle: 'Notes auto',
      notes_on: 'Notes auto : activées',
      notes_off: 'Notes auto : désactivées',
      legend_notes: '✕ = case impossible',
      legend_region: 'Les traits épais délimitent les régions de couleur',
      cell_label: 'Ligne {row}, colonne {col}',
      cell_label_cat: 'Ligne {row}, colonne {col} : chat',
      settings_title: 'Paramètres',
      settings_intro: 'Tes choix sont enregistrés sur cet appareil et appliqués à toutes les pages du jeu.',
      language: 'Langue',
      theme: 'Thème',
      light: 'Clair',
      dark: 'Sombre',
      sounds: 'Sons',
      on: 'Activés',
      off: 'Désactivés',
      back_home: 'Retour à l’accueil',
      saved: 'Paramètres enregistrés',
      loading: 'Création du puzzle…',
      loading_hint: 'Les chats cherchent leur place'
    },
    es: {
      app_title: 'Rompecabezas lógico de gatos',
      app_tagline: 'Un rompecabezas lógico y tranquilo, lleno de gatos',
      home_footer: 'Hecho con cariño y muchos gatos',
      play: 'Jugar',
      settings: 'Ajustes',
      home: 'Inicio',
      play_title: 'Elegir una partida',
      play_intro: 'Elige una dificultad o crea tu propia cuadrícula. Todas las partidas siguen las mismas dos reglas: un gato por región de color y uno por fila y columna.',
      easy: 'Fácil',
      medium: 'Medio',
      hard: 'Difícil',
      custom: 'Personalizado',
      custom_desc: 'Mueve el control para elegir una cuadrícula de 5×5 a 15×15.',
      size_label: 'Tamaño de la cuadrícula',
      grid_size: 'Cuadrícula {size}×{size}',
      start: 'Empezar la partida',
      level_easy: 'Nivel fácil',
      level_medium: 'Nivel medio',
      level_hard: 'Nivel difícil',
      level_custom: 'Nivel personalizado',
      level_title: '{level} · {size}×{size}',
      rules_title: 'Reglas',
      rule1: '1 gato en cada región de color',
      rule2: '1 gato en cada fila y en cada columna',
      rule3: 'Los gatos no pueden tocarse, ni en diagonal',
      rules_hint: 'Toca una casilla vacía para poner un gato y toca un gato para quitarlo. Ganas cuando cada fila, cada columna y cada región de color tiene exactamente un gato y ninguno se toca.',
      rules_hint_relaxed: 'Toca una casilla vacía para poner un gato y toca un gato para quitarlo. Ganas cuando cada fila, cada columna y cada región de color tiene exactamente un gato.',
      angry_mode: 'Modo Gato Enojado',
      angry_about: 'Acerca del Modo Gato Enojado',
      angry_help: 'Cuando el Modo Gato Enojado está activado, se añade la regla 3: los gatos ya no pueden estar alrededor de otro gato, ni lado a lado ni en diagonal. Actívalo aquí antes de empezar una partida.',
      counter: '{placed}/{total} gatos',
      replay: 'Volver a jugar',
      help: 'Ayuda',
      help_title: 'Cómo jugar',
      close: 'Cerrar',
      abandon: 'Abandonar',
      choose_difficulty: 'Elegir otra dificultad',
      new_grid: 'Nueva cuadrícula',
      victory_title: '¡Bien hecho!',
      victory_message: 'Todos los gatos encontraron su casilla: ¡rompecabezas resuelto!',
      abandon_message: 'Has abandonado esta partida.',
      error_row: 'Ya hay un gato en esta fila.',
      error_col: 'Ya hay un gato en esta columna.',
      error_region: 'Ya hay un gato en esta región de color.',
      error_touch: 'Los gatos no pueden tocarse, ni en diagonal.',
      notes_toggle: 'Notas auto',
      notes_on: 'Notas auto: activadas',
      notes_off: 'Notas auto: desactivadas',
      legend_notes: '✕ = casilla imposible',
      legend_region: 'Las líneas gruesas separan las regiones de color',
      cell_label: 'Fila {row}, columna {col}',
      cell_label_cat: 'Fila {row}, columna {col}: gato',
      settings_title: 'Ajustes',
      settings_intro: 'Tus elecciones se guardan en este dispositivo y se aplican a todas las páginas del juego.',
      language: 'Idioma',
      theme: 'Tema',
      light: 'Claro',
      dark: 'Oscuro',
      sounds: 'Sonidos',
      on: 'Activados',
      off: 'Desactivados',
      back_home: 'Volver al inicio',
      saved: 'Ajustes guardados',
      loading: 'Creando el rompecabezas…',
      loading_hint: 'Los gatos buscan su sitio'
    }
  };

  function translate(key, vars) {
    var table = i18n[currentLang] || i18n.en;
    var text = table[key];
    if (text === undefined) text = i18n.en[key];
    if (text === undefined) return key;
    if (vars) {
      text = text.replace(/\{(\w+)\}/g, function (match, name) {
        return vars[name] === undefined ? match : String(vars[name]);
      });
    }
    return text;
  }

  /* ---------- Sons : lecture ---------- */
  var audioCache = {};
  var soundsPrimed = false;

  function getAudio(name) {
    var src = SOUND_FILES[name];
    if (!src || typeof global.Audio !== 'function') return null;
    var audio = audioCache[name];
    if (!audio) {
      audio = new global.Audio(src);
      audio.preload = 'auto';
      audio.volume = SOUND_VOLUME[name] === undefined ? 0.7 : SOUND_VOLUME[name];
      audioCache[name] = audio;
    }
    return audio;
  }

  function playSound(name) {
    if (!isSoundOn()) return;
    var audio = getAudio(name);
    if (!audio) return;
    try {
      audio.currentTime = 0;
      var promise = audio.play();
      if (promise && typeof promise.catch === 'function') promise.catch(function () {});
    } catch (err) { /* son indisponible : on ignore */ }
  }

  /* Débloque l'audio après la première interaction de l'utilisateur. */
  function primeSounds() {
    if (soundsPrimed) return;
    soundsPrimed = true;
    Object.keys(SOUND_FILES).forEach(function (name) {
      var audio = getAudio(name);
      if (!audio) return;
      try {
        var promise = audio.play();
        if (promise && typeof promise.then === 'function') {
          promise.then(function () {
            try { audio.pause(); audio.currentTime = 0; } catch (e) {}
          }).catch(function () {});
        }
      } catch (err) { /* ignoré */ }
    });
  }

  /* ---------- Traduction du DOM (data-i18n*) ---------- */
  function translatePage(root) {
    var scope = root || global.document;
    if (!scope || !scope.querySelectorAll) return;
    var pairs = [
      ['[data-i18n]', 'text'],
      ['[data-i18n-title]', 'title'],
      ['[data-i18n-aria]', 'aria'],
      ['[data-i18n-placeholder]', 'placeholder']
    ];
    pairs.forEach(function (pair) {
      scope.querySelectorAll(pair[0]).forEach(function (el) {
        var attr = pair[1];
        var key = attr === 'text' ? 'data-i18n' : 'data-i18n-' + attr;
        var value = translate(el.getAttribute(key));
        if (attr === 'text') el.textContent = value;
        else if (attr === 'title') el.setAttribute('title', value);
        else if (attr === 'aria') el.setAttribute('aria-label', value);
        else el.setAttribute('placeholder', value);
      });
    });
  }

  /* ---------- Utilitaires divers ---------- */
  function getParam(name, fallback) {
    var query = global.location && global.location.search ? global.location.search : '';
    try {
      var value = new global.URLSearchParams(query).get(name);
      return value === null || value === '' ? fallback : value;
    } catch (err) {
      return fallback;
    }
  }

  function clampInt(value, min, max, fallback) {
    var n = parseInt(value, 10);
    if (isNaN(n)) n = fallback;
    return Math.min(max, Math.max(min, n));
  }

  var toastEl = null;
  var toastTimer = null;

  function toast(message, duration) {
    if (!global.document || !global.document.body) return;
    if (!toastEl) {
      toastEl = global.document.createElement('div');
      toastEl.className = 'toast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      global.document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.classList.add('is-visible');
    if (toastTimer) global.clearTimeout(toastTimer);
    toastTimer = global.setTimeout(function () {
      toastEl.classList.remove('is-visible');
    }, duration || 2400);
  }

  function setModalOpen(modal, open) {
    if (!modal) return;
    modal.hidden = !open;
    if (global.document && global.document.body) {
      global.document.body.classList.toggle('modal-open', !!open);
    }
    if (open) {
      var focusable = modal.querySelector('.btn, button, [href]');
      if (focusable && focusable.focus) focusable.focus();
    }
  }

  /* Clic sonore sur les boutons de l'interface. Un élément marqué
     data-sound-silent (ex. « Abandonner ») gère son propre son. */
  function bindClickSound() {
    global.document.addEventListener('click', function (event) {
      var target = event.target;
      if (!target || !target.closest) return;
      if (target.closest('[data-sound-silent]')) return;
      if (target.closest('.btn, .icon-btn')) playSound('click');
    });
  }

  /* ---------- Démarrage commun à toutes les pages ---------- */
  function boot() {
    currentLang = detectLang();
    writeStore(LANG_KEY, currentLang);
    applyTheme(getTheme());
    if (global.document && global.document.documentElement) {
      global.document.documentElement.lang = currentLang;
    }
    translatePage(global.document);
    bindClickSound();
    global.document.addEventListener('pointerdown', primeSounds, { once: true });
    global.document.addEventListener('keydown', primeSounds, { once: true });
  }

  global.CatApp = {
    i18n: i18n,
    LANGS: LANGS,
    THEMES: THEMES,
    t: translate,
    translatePage: translatePage,
    getLang: getLang,
    setLang: setLang,
    detectLang: detectLang,
    getTheme: getTheme,
    setTheme: setTheme,
    applyTheme: applyTheme,
    isSoundOn: isSoundOn,
    setSound: setSound,
    isNotesOn: isNotesOn,
    setNotes: setNotes,
    playSound: playSound,
    getParam: getParam,
    clampInt: clampInt,
    toast: toast,
    setModalOpen: setModalOpen,
    setCookie: setCookie,
    getCookie: getCookie,
    boot: boot
  };

  if (global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }
})(typeof window !== 'undefined' ? window : this);
