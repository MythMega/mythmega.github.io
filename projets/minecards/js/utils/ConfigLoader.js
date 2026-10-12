/**
 * ConfigLoader - Loads, validates and caches `settings/config.json`.
 *
 * Reference: `.docs/steps/1.md` (languages list for I18n, themes list for ThemeManager)
 * and `.docs/steps/8.md` (gift sheet identifiers).
 *
 * A single cached copy is shared by I18n, ThemeManager and the business layer so the
 * file is fetched exactly once per page load. The loader is intentionally the only
 * module reading `settings/config.json`: consumers use the typed accessors below, so
 * adding a language, a theme or a new set requires no code change anywhere else.
 */

/** Default configuration file path, relative to the application root. */
export const CONFIG_PATH = 'settings/config.json';

/** Supported timestamp interpretation modes for the time synchronization providers. */
export const TIME_UNITS = Object.freeze(['seconds', 'milliseconds', 'iso', 'http-date']);

/**
 * Supported response formats of the time synchronization providers:
 *   - `json`    : the value is read from `payload[field]`;
 *   - `trace`   : the value is read from a `key=value` line of a plain-text body
 *                 (Cloudflare's `/cdn-cgi/trace` answers `ts=1790903600.000`);
 *   - `headers` : the value is read from `response.headers.get(field)`. Only usable on a
 *                 same-origin URL, where CORS does not filter the response headers.
 */
export const TIME_FORMATS = Object.freeze(['json', 'trace', 'headers']);

/**
 * Default Sparks economy (currency), used whenever `settings/config.json` omits a value.
 * `sellPrice` / `buyPrice` map a card rarity (1-5) to its value in Sparks; `boosterReward`
 * is credited on every booster opening.
 */
export const DEFAULT_SPARKS_SETTINGS = Object.freeze({
  sellPrice: Object.freeze({ 1: 1, 2: 3, 3: 10, 4: 25, 5: 100 }),
  buyPrice: Object.freeze({ 1: 10, 2: 25, 3: 100, 4: 500, 5: 2500 }),
  boosterReward: 5,
});

export class ConfigLoader {
  /**
   * @param {string} [path=CONFIG_PATH] - Path of the configuration file to fetch.
   */
  constructor(path = CONFIG_PATH) {
    this.path = path;
    /** @type {object|null} Parsed configuration kept in memory. */
    this.cachedConfig = null;
    /** @type {Promise<object>|null} In-flight request used to de-duplicate concurrent loads. */
    this.pendingLoad = null;
  }

  /**
   * Loads `settings/config.json` (cached).
   *
   * @param {object} [options] - Load options.
   * @param {boolean} [options.force=false] - Re-fetch the file even when a cached copy exists.
   * @returns {Promise<object>} The validated configuration object.
   * @throws {Error} When the request fails, when the payload is not valid JSON, or when the
   *   mandatory sections (`languages`, `themes`) are missing or malformed.
   */
  async load({ force = false } = {}) {
    if (this.cachedConfig && !force) return this.cachedConfig;
    if (this.pendingLoad && !force) return this.pendingLoad;

    this.pendingLoad = this.fetchConfig(force);

    try {
      return await this.pendingLoad;
    } catch (error) {
      this.pendingLoad = null;
      throw error;
    }
  }

  /**
   * Performs the fetch, parse and validate steps of `load()`.
   *
   * @param {boolean} force - When true, the browser HTTP cache is bypassed.
   * @returns {Promise<object>} The validated configuration object.
   * @throws {Error} See `load()`.
   */
  async fetchConfig(force) {
    let response;
    try {
      response = await fetch(this.path, { cache: force ? 'no-store' : 'default' });
    } catch (error) {
      throw new Error(`Unable to fetch "${this.path}" (network error).`, { cause: error });
    }
    if (!response.ok) {
      throw new Error(`Unable to fetch "${this.path}" (HTTP ${response.status}).`);
    }

    let rawConfig;
    try {
      rawConfig = await response.json();
    } catch (error) {
      throw new Error(`"${this.path}" is not valid JSON.`, { cause: error });
    }

    this.cachedConfig = this.validate(rawConfig);
    this.pendingLoad = null;
    return this.cachedConfig;
  }

  /**
   * Returns the cached configuration, loading it when needed.
   *
   * @returns {Promise<object>} The validated configuration object.
   * @throws {Error} See `load()`.
   */
  async getConfig() {
    return this.cachedConfig ?? this.load();
  }

  /**
   * Validates the raw configuration payload.
   *
   * @param {unknown} rawConfig - Parsed JSON payload.
   * @returns {object} The same object, validated (treated as read-only by convention).
   * @throws {Error} When mandatory sections are missing or malformed.
   */
  validate(rawConfig) {
    if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
      throw new Error(`"${this.path}" must contain a JSON object.`);
    }

    const languages = rawConfig.languages;
    if (!Array.isArray(languages) || languages.length === 0) {
      throw new Error(`"${this.path}" must declare at least one language in "languages".`);
    }
    languages.forEach((entry, index) => {
      if (!entry || typeof entry.code !== 'string' || entry.code.trim() === '') {
        throw new Error(`"${this.path}" language #${index} is missing a valid "code".`);
      }
    });

    const themes = rawConfig.themes;
    if (!Array.isArray(themes) || themes.length === 0) {
      throw new Error(`"${this.path}" must declare at least one theme in "themes".`);
    }
    themes.forEach((entry, index) => {
      if (!entry || typeof entry.id !== 'string' || entry.id.trim() === '') {
        throw new Error(`"${this.path}" theme #${index} is missing a valid "id".`);
      }
    });

    return rawConfig;
  }

  /**
   * Available language codes, in declaration order.
   *
   * @returns {Promise<string[]>} Language codes (e.g. `["fr", "en"]`).
   * @throws {Error} See `load()`.
   */
  async getLanguages() {
    const config = await this.getConfig();
    return config.languages.map((entry) => entry.code);
  }

  /**
   * Available languages with their display labels.
   *
   * @returns {Promise<Array<{code: string, label: string}>>} Language descriptors.
   * @throws {Error} See `load()`.
   */
  async getLanguageOptions() {
    const config = await this.getConfig();
    return config.languages.map((entry) => ({ code: entry.code, label: entry.label || entry.code }));
  }

  /**
   * Available themes with their i18n label keys.
   *
   * @returns {Promise<Array<{id: string, labelKey: string}>>} Theme descriptors.
   * @throws {Error} See `load()`.
   */
  async getThemeOptions() {
    const config = await this.getConfig();
    return config.themes.map((entry) => ({
      id: entry.id,
      labelKey: entry.labelKey || `settings.theme.${entry.id}`,
    }));
  }

  /**
   * Default language code (falls back to the first declared language).
   *
   * @returns {Promise<string>} A language code guaranteed to be available.
   * @throws {Error} See `load()`.
   */
  async getDefaultLang() {
    const config = await this.getConfig();
    const codes = config.languages.map((entry) => entry.code);
    return codes.includes(config.defaultLang) ? config.defaultLang : codes[0];
  }

  /**
   * Default theme id (falls back to the first declared theme).
   *
   * @returns {Promise<string>} A theme id guaranteed to be available.
   * @throws {Error} See `load()`.
   */
  async getDefaultTheme() {
    const config = await this.getConfig();
    const ids = config.themes.map((entry) => entry.id);
    return ids.includes(config.defaultTheme) ? config.defaultTheme : ids[0];
  }

  /**
   * Booster-related global settings.
   *
   * @returns {Promise<{sets: string[], directory: string, rarityConfigPath: string, model: string, cardsPerBooster: number, dailyFreeBoosters: number, godpackChancePercent: number, historySize: number}>}
   *   Booster settings completed with safe defaults. `directory` locates the extension JSONs
   *   (`data/boosters`), `rarityConfigPath` the default rarity table
   *   (`settings/defaultRarity.json`) and `model` the 3D booster model used in step 4.
   *   `godpackChancePercent` is the probability (0-100) of a "god pack": a booster made only of
   *   full art printings. `historySize` is the number of past openings kept for the stats view.
   * @throws {Error} See `load()`.
   */
  async getBoosterSettings() {
    const config = await this.getConfig();
    const boosters = config.boosters || {};
    return {
      sets: Array.isArray(boosters.sets) ? boosters.sets.slice() : [],
      directory:
        typeof boosters.directory === 'string' && boosters.directory.trim() !== ''
          ? boosters.directory.trim()
          : 'data/boosters',
      rarityConfigPath:
        typeof boosters.rarityConfigPath === 'string' && boosters.rarityConfigPath.trim() !== ''
          ? boosters.rarityConfigPath.trim()
          : 'settings/defaultRarity.json',
      model:
        typeof boosters.model === 'string' && boosters.model.trim() !== ''
          ? boosters.model.trim()
          : 'assets/boostermodel.glb',
      cardsPerBooster: Number.isInteger(boosters.cardsPerBooster) ? boosters.cardsPerBooster : 5,
      dailyFreeBoosters: Number.isInteger(boosters.dailyFreeBoosters) ? boosters.dailyFreeBoosters : 3,
      // A percentage (0.5 = 0.5 %, 5 = 5 %), clamped to the documented 0-100 range.
      godpackChancePercent:
        typeof boosters.godpackChancePercent === 'number' && Number.isFinite(boosters.godpackChancePercent)
          ? Math.min(Math.max(boosters.godpackChancePercent, 0), 100)
          : 0.5,
      historySize:
        Number.isInteger(boosters.historySize) && boosters.historySize > 0 ? boosters.historySize : 10,
    };
  }

  /**
   * Gift sheet identifiers used by GiftManager (step 8).
   *
   * @returns {Promise<{id: string|null, gid: string}>} Sheet id and tab id ("0" when absent).
   * @throws {Error} See `load()`.
   */
  async getGiftSheet() {
    const config = await this.getConfig();
    const sheet = config.giftSheet || {};
    return {
      id: typeof sheet.id === 'string' && sheet.id.trim() !== '' ? sheet.id.trim() : null,
      gid: typeof sheet.gid === 'string' && sheet.gid.trim() !== '' ? sheet.gid.trim() : '0',
    };
  }

  /**
   * Personal code settings (step 10).
   *
   * `key` is the 32-byte shared secret (base64) used to verify the `useritem` codes. It is only
   * read lazily, when a code is actually being verified, and never logged.
   *
   * @returns {Promise<{version: number, key: string}>} The section (empty strings when absent).
   * @throws {Error} See `load()`.
   */
  async getUserItemCode() {
    const config = await this.getConfig();
    const section = config.useritemCode || {};
    return {
      version: Number.isInteger(section.version) ? section.version : 1,
      key: typeof section.key === 'string' ? section.key.trim() : '',
    };
  }

  /**
   * Sparks economy (currency): sell/buy price per rarity and the booster reward.
   *
   * Every price falls back to `DEFAULT_SPARKS_SETTINGS` when the section is missing, incomplete
   * or malformed, so a partially edited `config.json` can never make a card free or unaffordable.
   *
   * @returns {Promise<{sellPrice: Record<string, number>, buyPrice: Record<string, number>, boosterReward: number}>}
   *   The validated economy (rarity keys are strings, as in the JSON).
   * @throws {Error} See `load()`.
   */
  async getSparksSettings() {
    const config = await this.getConfig();
    const sparks = config.sparks || {};
    return {
      sellPrice: ConfigLoader.normalizePriceMap(sparks.sellPrice, DEFAULT_SPARKS_SETTINGS.sellPrice),
      buyPrice: ConfigLoader.normalizePriceMap(sparks.buyPrice, DEFAULT_SPARKS_SETTINGS.buyPrice),
      boosterReward:
        Number.isInteger(sparks.boosterReward) && sparks.boosterReward >= 0
          ? sparks.boosterReward
          : DEFAULT_SPARKS_SETTINGS.boosterReward,
    };
  }

  /**
   * Normalizes a `{ rarity: price }` map against its built-in defaults.
   *
   * Only the rarities declared by the defaults are kept, and a negative or non-integer price is
   * replaced by the default: a typo yields the shipped price instead of `NaN` or a free card.
   *
   * @param {unknown} raw - Raw map read from `config.json`.
   * @param {Record<string, number>} defaults - Reference prices.
   * @returns {Record<string, number>} The normalized map.
   */
  static normalizePriceMap(raw, defaults) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const map = {};
    Object.keys(defaults).forEach((rarity) => {
      const value = source[rarity];
      map[rarity] = Number.isInteger(value) && value >= 0 ? value : defaults[rarity];
    });
    return map;
  }

  /**
   * Time synchronization settings used by `DateSyncManager` (step 2).
   *
   * `providers` is tried in order until one answers. Each descriptor carries:
   *   - `url`    : endpoint to fetch. A relative URL (e.g. `index.html`) targets our own origin;
   *   - `format` : how to read the timestamp ("json", "trace" or "headers");
   *   - `field`  : where the timestamp lives inside that format;
   *   - `unit`   : how to convert it ("seconds", "milliseconds", "iso", "http-date").
   *
   * @returns {Promise<{providers: Array<{url: string, format: string, field: string, unit: string}>, requestTimeoutMs: number, resyncIntervalMs: number}>}
   *   The validated time synchronization settings (`providers` is empty when nothing is declared,
   *   in which case `DateSyncManager` falls back to its own built-in providers).
   * @throws {Error} See `load()`.
   */
  async getTimeSyncSettings() {
    const config = await this.getConfig();
    const timeSync = config.timeSync || {};
    const providers = Array.isArray(timeSync.providers) ? timeSync.providers : [];

    return {
      providers: providers
        .filter((provider) => provider && typeof provider.url === 'string' && provider.url.trim() !== '')
        .map((provider) => {
          const format = TIME_FORMATS.includes(provider.format) ? provider.format : 'json';
          return {
            url: provider.url.trim(),
            format,
            field:
              typeof provider.field === 'string' && provider.field !== ''
                ? provider.field
                : format === 'json'
                  ? 'unixtime'
                  : 'date',
            unit: TIME_UNITS.includes(provider.unit) ? provider.unit : 'seconds',
          };
        }),
      requestTimeoutMs: Number.isInteger(timeSync.requestTimeoutMs) ? timeSync.requestTimeoutMs : 4000,
      resyncIntervalMs: Number.isInteger(timeSync.resyncIntervalMs) ? timeSync.resyncIntervalMs : 900000,
    };
  }

  /**
   * Drops the cached configuration (used for a forced reload).
   *
   * @returns {void}
   */
  reset() {
    this.cachedConfig = null;
    this.pendingLoad = null;
  }
}

/** Shared loader instance used by I18n, ThemeManager and the business layer. */
export const configLoader = new ConfigLoader();

export default configLoader;
