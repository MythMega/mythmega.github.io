// config.js — chargement et validation de settings/config.json
const AppConfig = (function () {
  const DEFAULTS = Object.freeze({
    historyChartDays: 60,
    oldDailyPageSize: 30
  });

  let config = { ...DEFAULTS };
  let loading = null;

  function positiveInteger(value, fallback, max) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) return fallback;
    return parsed;
  }

  function normalize(raw) {
    return {
      historyChartDays: positiveInteger(raw.historyChartDays, DEFAULTS.historyChartDays, 3650),
      oldDailyPageSize: positiveInteger(raw.oldDailyPageSize, DEFAULTS.oldDailyPageSize, 500)
    };
  }

  async function load() {
    if (loading) return loading;
    loading = (async function () {
      try {
        const response = await fetch('settings/config.json', { cache: 'no-cache' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        config = normalize(await response.json());
      } catch (error) {
        console.warn('[Config] Impossible de charger settings/config.json, valeurs par défaut utilisées.', error);
        config = { ...DEFAULTS };
      }
      return config;
    })();
    return loading;
  }

  function get() {
    return config;
  }

  return { load, get, DEFAULTS };
})();
