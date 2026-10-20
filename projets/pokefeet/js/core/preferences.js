// preferences.js — préférences d'affichage et de son (cookies, actives immédiatement)
const PokefeetPrefs = (function () {
  const COOKIES = Object.freeze({
    animations: 'pk_animations',
    rotate3d: 'pk_rotate3d',
    sound: 'pk_sound',
    newPokemonAlerts: 'pk_new_pokemon_alerts',
    notifications: 'pk_notifications'
  });
  const DEFAULTS = Object.freeze({
    animations: true,
    rotate3d: true,
    sound: true,
    newPokemonAlerts: true,
    notifications: true
  });

  // Volumes (0-100) par famille de son : alerte nouveau Pokémon, notifications, UI.
  const VOLUME_COOKIES = Object.freeze({
    newPokemon: 'pk_volume_new_pokemon',
    notifications: 'pk_volume_notifications',
    ui: 'pk_volume_ui'
  });
  const VOLUME_DEFAULTS = Object.freeze({
    newPokemon: 100,
    notifications: 100,
    ui: 80
  });

  const cache = {};
  const volumeCache = {};

  function readCookie(name) {
    const match = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
    return match ? decodeURIComponent(match.pop()) : null;
  }

  function get(key) {
    if (!Object.prototype.hasOwnProperty.call(COOKIES, key)) return true;
    if (Object.prototype.hasOwnProperty.call(cache, key)) return cache[key];
    const raw = readCookie(COOKIES[key]);
    cache[key] = raw === null || raw === '' ? DEFAULTS[key] : raw !== 'false';
    return cache[key];
  }

  function set(key, value) {
    if (!Object.prototype.hasOwnProperty.call(COOKIES, key)) return;
    const bool = !!value;
    cache[key] = bool;
    const expires = new Date();
    expires.setFullYear(expires.getFullYear() + 10);
    document.cookie = COOKIES[key] + '=' + (bool ? 'true' : 'false') +
      ';expires=' + expires.toUTCString() + ';path=/;SameSite=Lax';
    apply();
  }

  function clampVolume(value) {
    const num = Math.round(Number(value));
    if (!isFinite(num)) return 100;
    return Math.min(100, Math.max(0, num));
  }

  function getVolume(kind) {
    if (!Object.prototype.hasOwnProperty.call(VOLUME_COOKIES, kind)) return 100;
    if (Object.prototype.hasOwnProperty.call(volumeCache, kind)) return volumeCache[kind];
    const raw = readCookie(VOLUME_COOKIES[kind]);
    volumeCache[kind] = raw === null || raw === '' ? VOLUME_DEFAULTS[kind] : clampVolume(raw);
    return volumeCache[kind];
  }

  function setVolume(kind, value) {
    if (!Object.prototype.hasOwnProperty.call(VOLUME_COOKIES, kind)) return;
    const volume = clampVolume(value);
    volumeCache[kind] = volume;
    const expires = new Date();
    expires.setFullYear(expires.getFullYear() + 10);
    document.cookie = VOLUME_COOKIES[kind] + '=' + volume +
      ';expires=' + expires.toUTCString() + ';path=/;SameSite=Lax';
  }

  function apply() {
    const root = document.documentElement;
    if (!root) return;
    root.classList.toggle('no-animations', !get('animations'));
    root.classList.toggle('rotate3d-on', get('rotate3d'));
    root.dataset.sound = get('sound') ? 'on' : 'off';
  }

  function resetCache() {
    Object.keys(cache).forEach(function (key) { delete cache[key]; });
    Object.keys(volumeCache).forEach(function (key) { delete volumeCache[key]; });
    apply();
  }

  // Le module est chargé tôt : la classe doit être posée avant le premier rendu utile.
  apply();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply, { once: true });
  }

  return {
    get: get,
    set: set,
    apply: apply,
    resetCache: resetCache,
    animationsEnabled: function () { return get('animations'); },
    soundEnabled: function () { return get('sound'); },
    newPokemonAlertsEnabled: function () { return get('newPokemonAlerts'); },
    notificationsEnabled: function () { return get('notifications'); },
    getVolume: getVolume,
    setVolume: setVolume,
    VOLUME_DEFAULTS: VOLUME_DEFAULTS,
    DEFAULTS: DEFAULTS
  };
})();
