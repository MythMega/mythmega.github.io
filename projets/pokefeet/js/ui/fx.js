// fx.js — sons de feedback
// Les fichiers sont fournis séparément dans sounds/ (voir .docs/sound.txt).
// Les transitions d'images vivent dans js/ui/transitions.js (PokefeetTransitions),
// la visionneuse plein écran dans js/ui/zoom.js (PokefeetZoom).
const PokefeetFX = (function () {
  const SOUNDS = Object.freeze({
    newPokemon: 'sounds/new-pokemon.mp3',
    positive: 'sounds/positive.mp3',
    negative: 'sounds/negative.mp3',
    ui: 'sounds/ui_base.mp3'
  });
  // Famille de volume appliquée à chaque son (voir PokefeetPrefs.getVolume).
  const SOUND_VOLUME = Object.freeze({
    newPokemon: 'newPokemon',
    positive: 'notifications',
    negative: 'notifications',
    ui: 'ui'
  });
  const audioCache = {};

  function pref(name, fallback) {
    return (typeof PokefeetPrefs !== 'undefined') ? PokefeetPrefs.get(name) : fallback;
  }

  function soundEnabled() { return pref('sound', true); }
  function notificationsEnabled() { return pref('notifications', true); }
  function newPokemonAlertsEnabled() { return pref('newPokemonAlerts', true); }

  function volumeFor(kind) {
    if (typeof PokefeetPrefs === 'undefined' || typeof PokefeetPrefs.getVolume !== 'function') return 1;
    const pct = PokefeetPrefs.getVolume(SOUND_VOLUME[kind] || 'notifications');
    return Math.min(1, Math.max(0, pct / 100));
  }

  function playSound(kind) {
    if (!soundEnabled()) return;
    const src = SOUNDS[kind];
    if (!src) return;
    try {
      let audio = audioCache[kind];
      if (!audio) {
        audio = new Audio(src);
        audio.preload = 'auto';
        audioCache[kind] = audio;
      }
      audio.volume = volumeFor(kind);
      audio.currentTime = 0;
      const played = audio.play();
      if (played && typeof played.catch === 'function') {
        played.catch(function () { /* fichier absent ou lecture bloquée : on ignore */ });
      }
    } catch (error) {
      // Audio indisponible (fichier absent, navigateur restrictif) : le jeu continue.
    }
  }

  function notificationSound(type) {
    if (type === 'success') playSound('positive');
    else if (type === 'fail') playSound('negative');
  }

  // --- Son d'UI : contrôles qui ne changent pas de page ---
  // Onglets de réglages, pagination, interrupteurs, sélecteurs, filtres et tri.
  const UI_CLICK_SELECTOR = [
    '.dm-tab-btn',
    '.cosmetic-subtab-btn',
    '.cosmetic-type-toggle button',
    '.dex-page-btn',
    '.page-nav-btn',
    '#language-toggle-btn',
    '#language-menu button',
    '#sortDirectionBtn'
  ].join(', ');
  const UI_CHANGE_SCOPE = '.dm-panel, .dm-tabs, .filter-section, .sort-section';

  function initUiSounds() {
    if (document.__pokefeetUiSounds) return;
    document.__pokefeetUiSounds = true;

    document.addEventListener('click', function (event) {
      const target = event.target instanceof Element ? event.target.closest(UI_CLICK_SELECTOR) : null;
      if (!target || target.disabled) return;
      playSound('ui');
    }, true);

    document.addEventListener('change', function (event) {
      const field = event.target;
      if (!field || !field.matches || field.disabled) return;
      if (!field.matches('select, input[type="checkbox"], input[type="range"]')) return;
      if (!field.closest(UI_CHANGE_SCOPE)) return;
      playSound('ui');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUiSounds, { once: true });
  } else {
    initUiSounds();
  }

  return {
    SOUNDS: SOUNDS,
    playSound: playSound,
    notificationSound: notificationSound,
    soundEnabled: soundEnabled,
    notificationsEnabled: notificationsEnabled,
    newPokemonAlertsEnabled: newPokemonAlertsEnabled,
    initUiSounds: initUiSounds
  };
})();
