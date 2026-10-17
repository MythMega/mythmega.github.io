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

/**
 * Default location of the trophy catalogue, used whenever `settings/config.json` omits a path.
 *
 * `boostersConfigPath` describes the tiers recurring on every extension, `globalConfigPath` the
 * account-wide tiers, and `directory` holds one `<setId>.json` per extension with the collection
 * trophies.
 */
export const DEFAULT_TROPHY_SETTINGS = Object.freeze({
  directory: 'data/trophies',
  boostersConfigPath: 'settings/boosters_trophy.json',
  globalConfigPath: 'settings/global_trophy.json',
});

/**
 * Default profile limits: the number of cards that can be pinned in the collection and the number
 * of unlocked trophies highlighted on the profile page.
 */
export const DEFAULT_PROFILE_SETTINGS = Object.freeze({
  maxFavorites: 5,
  maxFeaturedTrophies: 3,
  defaultName: '',
});

/**
 * Default locations of the profile avatars, used whenever `settings/config.json` omits a path.
 *
 * `defaultPath` holds the icons every account can pick from the start, `unlockablePath` the icons a
 * trophy unlocks, and `directory` one `<setId>.json` per extension mapping a collection trophy name
 * to the icons it unlocks.
 */
export const DEFAULT_PROFILE_ICON_SETTINGS = Object.freeze({
  defaultPath: 'settings/default_profile_icons.json',
  unlockablePath: 'data/icon.json',
  directory: 'data/profile_icons',
});

/**
 * Default levelling curve: the first level-up costs `baseRequiredExpToLevelUp` XP, every next one
 * costs `incrementRequiredXpBy` XP more, and `experience` is what the account itself earns.
 */
export const DEFAULT_LEVELLING_SETTINGS = Object.freeze({
  defaultLevel: 1,
  baseRequiredExpToLevelUp: 100,
  incrementRequiredXpBy: 25,
  experience: Object.freeze({ everyBooster: 5, everyDistinctCard: 3, nameChanged: 10 }),
});

/**
 * Default locations of the promo card catalogue, used whenever `settings/config.json` omits them.
 *
 * Promo cards (`data/promo_cards/<serie>.json`) are only granted by a redeem code or a gift: they
 * are never drawn from a booster and never counted in a completion ratio. `sets` lists the files to
 * load, named after the series they decorate; when it is empty the booster extensions
 * (`boosters.sets`) are used, so a promo file always sits next to the extension it belongs to.
 */
export const DEFAULT_PROMO_SETTINGS = Object.freeze({
  directory: 'data/promo_cards',
  sets: Object.freeze([]),
});

/**
 * Default settings of the Mine Pick, used whenever `settings/config.json` omits a value.
 *
 * The board holds `boosterCount` simulated openings (10) built from the real booster
 * parameters, `picksPerDay` free picks per UTC day (3) and keeps `historySize` picks for the
 * statistics. `seedSalt` + the UTC day + the account UUID seed the deterministic draw;
 * `setWeightExponent` is the exponent of the extension weight (the highest id is the likeliest).
 */
export const DEFAULT_MINE_PICK_SETTINGS = Object.freeze({
  boosterCount: 10,
  picksPerDay: 3,
  extraPickPriceSparks: 1000,
  historySize: 10,
  seedSalt: 'minecards-mine-pick-v1',
  setWeightExponent: 2,
});

/**
 * Default settings of the Mine (MineBlock), used whenever `settings/config.json` omits a value.
 *
 * `configPath` locates the rules of the blocks themselves (`settings/mining.json`: the five kinds,
 * their weight, their hardness and their loot), `blocksPerDay` is the daily allowance of blocks
 * (reset at midnight UTC, like the boosters), `nextBlockDelayMs` is how long the broken block stays
 * on screen before the next one drops in, and `seedSalt` salts the order of the day, which is
 * derived from the account UUID so two accounts never share one.
 */
export const DEFAULT_MINING_SETTINGS = Object.freeze({
  configPath: 'settings/mining.json',
  blocksPerDay: 10,
  nextBlockDelayMs: 100,
  seedSalt: 'minecards-mining-v1',
});

/**
 * Default settings of the shop of the Wandering Trader (`settings/config.json`, section `shop`).
 *
 * `seedSalt` salts the WEEKLY draw, which is derived from the Monday of the current week and from
 * nothing else: every player sees the same shop, and changing the salt rerolls it. `offers` is the
 * composition of that shop (rarity -> how many cards), `rarityValues` what a card of each rarity is
 * worth and `itemsValues` what one unit of each mined resource is worth, both in the same unit, so
 * a price is a sum of resources worth exactly the rarity of the card. `allItemsUniques` decides
 * whether an offer can be bought again once it was bought (false) or is exhausted until the next
 * reroll (true). `pinnedPath` locates the hand-written offers, sold during the window they declare
 * and limited by their own stock.
 */
export const DEFAULT_SHOP_SETTINGS = Object.freeze({
  seedSalt: 'minecards-trader-v1',
  allItemsUniques: true,
  pinnedPath: 'data/shop/pinned_offers.json',
  rarityValues: Object.freeze({ 1: 50, 2: 100, 3: 250, 4: 500 }),
  itemsValues: Object.freeze({
    'Stone Dust': 1,
    'Sculk Dust': 5,
    'Glowstone Dust': 20,
    'Void Dust': 50,
    Ultima: 100,
  }),
  offers: Object.freeze([
    Object.freeze([1, 2]),
    Object.freeze([2, 1]),
    Object.freeze([3, 1]),
    Object.freeze([4, 1]),
  ]),
});

/**
 * Price of one extra booster, bought with Sparks once the free daily boosters are spent.
 *
 * A bought booster lands in its own quota bucket: it survives the daily reset and is only spent
 * after the daily allowance and the bonuses of the selected extension.
 */
export const DEFAULT_EXTRA_BOOSTER_PRICE_SPARKS = 1500;

/**
 * Default durations (milliseconds) of the opening animation, used whenever an entry of the
 * `animations.list` section omits one of them.
 *
 * `tearMs` is the opening of the pack, `flipMs` a card flip and `staggerMs` the delay between two
 * cards of the summary grid. They are published as `--anim-tear-ms` / `--anim-flip-ms` /
 * `--anim-stagger-ms` by `js/utils/AnimationManager.js`.
 */
export const DEFAULT_ANIMATION_TIMING = Object.freeze({
  tearMs: 700,
  flipMs: 220,
  staggerMs: 60,
});

/**
 * Default range of the foil intensity setting (`settings.foil` of `config.json`).
 *
 * The values are PERCENTAGES, not the 0-1 factor the stylesheet reads: a percentage is what the
 * slider shows, what the save file stores and what a human edits in the configuration, while
 * `js/utils/FoilManager.js` is the only place that divides by 100. The default (100 %) is the
 * intensity the foil was tuned at, so a player who never touches the setting sees the cards exactly
 * as they were designed.
 */
export const DEFAULT_FOIL_SETTINGS = Object.freeze({
  min: 0,
  max: 100,
  step: 5,
  default: 100,
});

/**
 * Default range of the "brillance" setting (`settings.foil.glare` of `config.json`).
 *
 * Same unit and same rules as `DEFAULT_FOIL_SETTINGS`, for the OTHER foil effect: the bright line
 * that sweeps across a card (`css/components/card-shine.css`, layer `.card-shine__gleam`) instead of
 * the shapes of the foil itself. Two ranges rather than one, because the two effects are tuned
 * separately: "Brillance" at 0 % keeps the honeycomb and the embossing of a mythic while leaving the
 * moving line out.
 */
export const DEFAULT_GLARE_SETTINGS = Object.freeze({
  min: 0,
  max: 100,
  step: 5,
  default: 100,
});

/**
 * Default XP granted by a trophy, per rarity ("bronze" … "emerald").
 *
 * A trophy JSON may override it with its own `Experience` field.
 */
export const DEFAULT_EXPERIENCE_PER_TROPHY = Object.freeze({
  bronze: 25,
  silver: 100,
  gold: 250,
  diamond: 500,
  emerald: 1000,
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

    // Optional section: a browser still holding an older cached `config.json` must not fail its
    // whole boot over it. An absent `animations` simply means "the neutral mode alone", which is
    // what `AnimationManager` falls back to.
    const animationList = rawConfig.animations?.list;
    if (animationList !== undefined) {
      if (!Array.isArray(animationList) || animationList.length === 0) {
        throw new Error(`"${this.path}" must declare at least one animation in "animations.list".`);
      }
      animationList.forEach((entry, index) => {
        if (!entry || typeof entry.id !== 'string' || entry.id.trim() === '') {
          throw new Error(`"${this.path}" animation #${index} is missing a valid "id".`);
        }
      });
    }

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
   * Animation modes with their labels, durations and their "parodic" flag.
   *
   * @returns {Promise<Array<{id: string, labelKey: string, parodic: boolean, tearMs: number,
   *   flipMs: number, staggerMs: number}>>} Animation descriptors, in declaration order.
   *   Returns an empty array when the section is missing (an older cached `config.json`):
   *   `AnimationManager` then falls back to its built-in neutral mode.
   * @throws {Error} See `load()`.
   */
  async getAnimationOptions() {
    const config = await this.getConfig();
    const list = config.animations?.list;
    if (!Array.isArray(list)) return [];
    return list.map((entry) => ({
      id: entry.id,
      labelKey: entry.labelKey || `settings.animation.${entry.id}`,
      parodic: entry.parodic === true,
      tearMs: ConfigLoader.normalizeDuration(entry.tearMs, DEFAULT_ANIMATION_TIMING.tearMs),
      flipMs: ConfigLoader.normalizeDuration(entry.flipMs, DEFAULT_ANIMATION_TIMING.flipMs),
      staggerMs: ConfigLoader.normalizeDuration(entry.staggerMs, DEFAULT_ANIMATION_TIMING.staggerMs),
    }));
  }

  /**
   * Default animation id (falls back to the first declared mode, then to "normal").
   *
   * @returns {Promise<string>} An animation id guaranteed to be declared.
   * @throws {Error} See `load()`.
   */
  async getDefaultAnimation() {
    const config = await this.getConfig();
    const ids = (config.animations?.list ?? []).map((entry) => entry.id);
    if (ids.length === 0) return 'normal';
    return ids.includes(config.animations?.default) ? config.animations.default : ids[0];
  }

  /**
   * Foil rendering settings: the range of the intensity slider.
   *
   * The four values are made consistent here rather than trusted: `min` stays under `max`, `step`
   * never exceeds the span, and the default sits inside the range. A partially edited section can
   * therefore only cost a wider or narrower slider, never a broken one.
   *
   * @returns {Promise<{min: number, max: number, step: number, default: number}>} The bounds, in
   *   percentages.
   * @throws {Error} See `load()`.
   */
  async getFoilSettings() {
    const config = await this.getConfig();
    return ConfigLoader.normalizePercentRange(config.foil, DEFAULT_FOIL_SETTINGS);
  }

  /**
   * Brillance settings: the range of the slider driving the sweeping line of the foil.
   *
   * It is declared as `foil.glare`, next to the foil it belongs to, so the two sliders of the same
   * panel are configured side by side; a missing or malformed block falls back to its own defaults
   * through the very same validation as the foil above.
   *
   * @returns {Promise<{min: number, max: number, step: number, default: number}>} The bounds, in
   *   percentages.
   * @throws {Error} See `load()`.
   */
  async getGlareSettings() {
    const config = await this.getConfig();
    return ConfigLoader.normalizePercentRange(config.foil?.glare, DEFAULT_GLARE_SETTINGS);
  }

  /**
   * Validates one `{ min, max, step, default }` block of percentages.
   *
   * Shared by the foil and the brillance sliders: both are bounded by the same rules, and having a
   * single implementation is what keeps a partially edited section harmless for either of them.
   *
   * @param {unknown} raw - Raw block read from `config.json`.
   * @param {{min: number, max: number, step: number, default: number}} defaults - Fallback bounds.
   * @returns {{min: number, max: number, step: number, default: number}} Consistent bounds.
   */
  static normalizePercentRange(raw, defaults) {
    const block = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

    const min = ConfigLoader.normalizeIntegerInRange(block.min, defaults.min, 0, defaults.max - 1);
    const max = ConfigLoader.normalizeIntegerInRange(block.max, defaults.max, min + 1, defaults.max);
    const step = ConfigLoader.normalizeIntegerInRange(block.step, defaults.step, 1, max - min);
    const fallbackDefault = Math.min(Math.max(defaults.default, min), max);

    return {
      min,
      max,
      step,
      default: ConfigLoader.normalizeIntegerInRange(block.default, fallbackDefault, min, max),
    };
  }

  /**
   * Promo card catalogue settings.
   *
   * @returns {Promise<{directory: string, sets: string[]}>} The directory holding the promo files
   *   and the list of series to load (empty when the section is absent, which means "every
   *   booster extension").
   * @throws {Error} See `load()`.
   */
  async getPromoSettings() {
    const config = await this.getConfig();
    const promos = config.promos || {};
    const boosterSets = Array.isArray(config.boosters?.sets) ? config.boosters.sets : [];
    const declared = Array.isArray(promos.sets) && promos.sets.length > 0 ? promos.sets : boosterSets;

    return {
      directory:
        typeof promos.directory === 'string' && promos.directory.trim() !== ''
          ? promos.directory.trim()
          : DEFAULT_PROMO_SETTINGS.directory,
      sets: declared
        .filter((setId) => typeof setId === 'string' && setId.trim() !== '')
        .map((setId) => setId.trim()),
    };
  }

  /**
   * Mine Pick settings, completed with `DEFAULT_MINE_PICK_SETTINGS`.
   *
   * Every value falls back to its default when the section is missing or a value is unusable: a
   * partially edited configuration must never break the daily board.
   *
   * @returns {Promise<{boosterCount: number, picksPerDay: number, extraPickPriceSparks: number,
   *   historySize: number, seedSalt: string, setWeightExponent: number}>} The Mine Pick settings.
   * @throws {Error} See `load()`.
   */
  async getMinePickSettings() {
    const config = await this.getConfig();
    const minePick = config.minePick || {};
    const exponent = Number(minePick.setWeightExponent);
    return {
      boosterCount: ConfigLoader.normalizePositiveInteger(
        minePick.boosterCount,
        DEFAULT_MINE_PICK_SETTINGS.boosterCount
      ),
      picksPerDay: ConfigLoader.normalizePositiveInteger(
        minePick.picksPerDay,
        DEFAULT_MINE_PICK_SETTINGS.picksPerDay
      ),
      historySize: ConfigLoader.normalizePositiveInteger(
        minePick.historySize,
        DEFAULT_MINE_PICK_SETTINGS.historySize
      ),
      extraPickPriceSparks: ConfigLoader.normalizePrice(
        minePick.extraPickPriceSparks,
        DEFAULT_MINE_PICK_SETTINGS.extraPickPriceSparks
      ),
      seedSalt:
        typeof minePick.seedSalt === 'string' && minePick.seedSalt.trim() !== ''
          ? minePick.seedSalt.trim()
          : DEFAULT_MINE_PICK_SETTINGS.seedSalt,
      setWeightExponent:
        Number.isFinite(exponent) && exponent >= 0
          ? exponent
          : DEFAULT_MINE_PICK_SETTINGS.setWeightExponent,
    };
  }

  /**
   * Mine (MineBlock) settings, completed with `DEFAULT_MINING_SETTINGS`.
   *
   * The daily allowance of blocks, the path of the block rules and the seed salt fall back to
   * their shipped defaults when the section is missing or a value is unusable: a partially edited
   * configuration must never leave the mine without a block to mine.
   *
   * @returns {Promise<{configPath: string, blocksPerDay: number, nextBlockDelayMs: number,
   *   seedSalt: string}>} The mine settings.
   * @throws {Error} See `load()`.
   */
  async getMiningSettings() {
    const config = await this.getConfig();
    const mining = config.mining || {};
    return {
      configPath: ConfigLoader.normalizePath(mining.configPath, DEFAULT_MINING_SETTINGS.configPath),
      blocksPerDay: ConfigLoader.normalizePositiveInteger(
        mining.blocksPerDay,
        DEFAULT_MINING_SETTINGS.blocksPerDay
      ),
      nextBlockDelayMs: ConfigLoader.normalizePositiveInteger(
        mining.nextBlockDelayMs,
        DEFAULT_MINING_SETTINGS.nextBlockDelayMs
      ),
      seedSalt:
        typeof mining.seedSalt === 'string' && mining.seedSalt.trim() !== ''
          ? mining.seedSalt.trim()
          : DEFAULT_MINING_SETTINGS.seedSalt,
    };
  }

  /**
   * Shop (Wandering Trader) settings, completed with `DEFAULT_SHOP_SETTINGS`.
   *
   * A missing or unusable value falls back to the shipped default, exactly like the mine and the
   * Mine Pick: a partially edited `settings/config.json` must never leave the trader without a shop.
   * An empty list of offers, or a value map without a single usable entry, is read as the default
   * one - a price needs resources to be built from, and a shop needs cards.
   *
   * @returns {Promise<{seedSalt: string, allItemsUniques: boolean, pinnedPath: string,
   *   rarityValues: Record<string, number>, itemsValues: Record<string, number>,
   *   offers: Array<[number, number]>}>} The shop settings. `offers` is a list of
   *   `[rarity, count]`, from the lowest rarity to the highest.
   * @throws {Error} See `load()`.
   */
  async getShopSettings() {
    const config = await this.getConfig();
    const shop = config.shop || {};
    return {
      seedSalt:
        typeof shop.seedSalt === 'string' && shop.seedSalt.trim() !== ''
          ? shop.seedSalt.trim()
          : DEFAULT_SHOP_SETTINGS.seedSalt,
      allItemsUniques:
        typeof shop.allItemsUniques === 'boolean'
          ? shop.allItemsUniques
          : DEFAULT_SHOP_SETTINGS.allItemsUniques,
      pinnedPath: ConfigLoader.normalizePath(shop.pinnedPath, DEFAULT_SHOP_SETTINGS.pinnedPath),
      rarityValues: ConfigLoader.normalizeValueMap(shop.rarityValues, DEFAULT_SHOP_SETTINGS.rarityValues),
      itemsValues: ConfigLoader.normalizeValueMap(shop.itemsValues, DEFAULT_SHOP_SETTINGS.itemsValues),
      offers: ConfigLoader.normalizeOffers(shop.offers, DEFAULT_SHOP_SETTINGS.offers),
    };
  }

  /**
   * Normalizes a `{ key: value }` map of positive numbers (the worth of a rarity or a resource).
   *
   * @param {unknown} raw - Raw value read from the configuration.
   * @param {Record<string, number>} fallback - Value used when nothing usable is declared.
   * @returns {Record<string, number>} The map, without its unusable entries.
   */
  static normalizeValueMap(raw, fallback) {
    const map = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      Object.entries(raw).forEach(([key, value]) => {
        const number = Number(value);
        if (typeof key === 'string' && key.trim() !== '' && Number.isFinite(number) && number > 0) {
          map[key.trim()] = number;
        }
      });
    }
    return Object.keys(map).length > 0 ? map : { ...fallback };
  }

  /**
   * Normalizes the composition of the weekly shop (`{ "1": 2, "2": 1 }`).
   *
   * @param {unknown} raw - Raw value read from the configuration.
   * @param {Array<[number, number]>} fallback - Value used when nothing usable is declared.
   * @returns {Array<[number, number]>} `[rarity, count]`, from the lowest rarity to the highest.
   */
  static normalizeOffers(raw, fallback) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback.map((entry) => [...entry]);
    const entries = Object.entries(raw)
      .map(([rarity, count]) => [Math.trunc(Number(rarity)), ConfigLoader.normalizePositiveInteger(count, 0)])
      .filter(([rarity, count]) => Number.isFinite(rarity) && rarity > 0 && count > 0)
      .sort((left, right) => left[0] - right[0]);
    return entries.length > 0 ? entries : fallback.map((entry) => [...entry]);
  }

  /**
   * Normalizes a Sparks price (a whole number of Sparks, zero meaning "free").
   *
   * @param {unknown} value - Raw value.
   * @param {number} fallback - Value used when the raw one is unusable.
   * @returns {number} A non-negative integer.
   */
  static normalizePrice(value, fallback) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0) return fallback;
    return number;
  }

  /**
   * Normalizes a strictly positive whole number.
   *
   * @param {unknown} value - Raw value.
   * @param {number} fallback - Value used when the raw one is unusable.
   * @returns {number} A positive integer.
   */
  static normalizePositiveInteger(value, fallback) {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0) return fallback;
    return number;
  }

  /**
   * Normalizes a whole number into an allowed range.
   *
   * An unusable value (`null`, `undefined`, an empty string, anything that is not a number) falls
   * back to the given default; a usable but out-of-range value is CLAMPED instead, because a
   * configuration asking for 150 out of a 100 maximum clearly means "as much as possible".
   *
   * @param {unknown} value - Raw value.
   * @param {number} fallback - Value used when the raw one is unusable.
   * @param {number} min - Lower bound, inclusive.
   * @param {number} max - Upper bound, inclusive.
   * @returns {number} A whole number within `[min, max]`.
   */
  static normalizeIntegerInRange(value, fallback, min, max) {
    if (value === null || value === undefined || value === '') return fallback;
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(Math.max(Math.round(number), min), max);
  }

  /**
   * Normalizes one duration of an animation entry.
   *
   * @param {unknown} value - Raw duration in milliseconds.
   * @param {number} fallback - Value used when the entry is missing or unusable.
   * @returns {number} A positive whole number of milliseconds.
   */
  static normalizeDuration(value, fallback) {
    const duration = Number(value);
    if (!Number.isFinite(duration) || duration <= 0) return fallback;
    return Math.round(duration);
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
   * @returns {Promise<{sets: string[], directory: string, rarityConfigPath: string, model: string, cardsPerBooster: number, dailyFreeBoosters: number, extraBoosterPriceSparks: number, godpackChancePercent: number, historySize: number}>}
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
      extraBoosterPriceSparks: ConfigLoader.normalizePrice(
        boosters.extraBoosterPriceSparks,
        DEFAULT_EXTRA_BOOSTER_PRICE_SPARKS
      ),
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
   * Trophy catalogue location (`trophies` section of `settings/config.json`).
   *
   * Every path falls back to `DEFAULT_TROPHY_SETTINGS`, so a partially edited configuration still
   * loads the shipped catalogue.
   *
   * @returns {Promise<{directory: string, boostersConfigPath: string, globalConfigPath: string}>}
   *   The directory of the per-extension trophy files and the two shared tier files.
   * @throws {Error} See `load()`.
   */
  async getTrophySettings() {
    const config = await this.getConfig();
    const trophies = config.trophies || {};
    return {
      directory: ConfigLoader.normalizePath(trophies.directory, DEFAULT_TROPHY_SETTINGS.directory),
      boostersConfigPath: ConfigLoader.normalizePath(
        trophies.boostersConfigPath,
        DEFAULT_TROPHY_SETTINGS.boostersConfigPath
      ),
      globalConfigPath: ConfigLoader.normalizePath(
        trophies.globalConfigPath,
        DEFAULT_TROPHY_SETTINGS.globalConfigPath
      ),
    };
  }

  /**
   * Profile limits (`profile` section of `settings/config.json`).
   *
   * A missing or malformed limit falls back to its shipped default, so a typo in the configuration
   * can never block the feature (a limit of 0 simply disables the corresponding pin).
   *
   * @returns {Promise<{maxFavorites: number, maxFeaturedTrophies: number, defaultName: string}>}
   *   The validated profile settings.
   * @throws {Error} See `load()`.
   */
  async getProfileSettings() {
    const config = await this.getConfig();
    const profile = config.profile || {};
    return {
      maxFavorites: ConfigLoader.normalizePinCount(
        profile.maxFavorites,
        DEFAULT_PROFILE_SETTINGS.maxFavorites
      ),
      maxFeaturedTrophies: ConfigLoader.normalizePinCount(
        profile.maxFeaturedTrophies,
        DEFAULT_PROFILE_SETTINGS.maxFeaturedTrophies
      ),
      defaultName: typeof profile.defaultName === 'string' ? profile.defaultName.trim() : '',
    };
  }

  /**
   * Profile avatar catalogue (`profileIcons` section of `settings/config.json`).
   *
   * Every path falls back to `DEFAULT_PROFILE_ICON_SETTINGS`, so a partially edited configuration
   * still finds the shipped icons.
   *
   * @returns {Promise<{defaultPath: string, unlockablePath: string, directory: string}>}
   *   The default list, the trophy-unlocked list and the per-extension mapping directory.
   * @throws {Error} See `load()`.
   */
  async getProfileIconSettings() {
    const config = await this.getConfig();
    const icons = config.profileIcons || {};
    return {
      defaultPath: ConfigLoader.normalizePath(icons.defaultPath, DEFAULT_PROFILE_ICON_SETTINGS.defaultPath),
      unlockablePath: ConfigLoader.normalizePath(
        icons.unlockablePath,
        DEFAULT_PROFILE_ICON_SETTINGS.unlockablePath
      ),
      directory: ConfigLoader.normalizePath(icons.directory, DEFAULT_PROFILE_ICON_SETTINGS.directory),
    };
  }

  /**
   * Levelling curve (`levelling` section of `settings/config.json`).
   *
   * `baseRequiredExpToLevelUp` is kept strictly positive (a zero requirement would make the level
   * explode to infinity) and none of the XP rewards can be negative.
   *
   * @returns {Promise<{defaultLevel: number, baseRequiredExpToLevelUp: number, incrementRequiredXpBy: number, experience: {everyBooster: number, everyDistinctCard: number, nameChanged: number}}>}
   *   The validated levelling settings.
   * @throws {Error} See `load()`.
   */
  async getLevellingSettings() {
    const config = await this.getConfig();
    const levelling = config.levelling || {};
    const experience = levelling.experience || {};
    return {
      defaultLevel: Math.max(1, ConfigLoader.normalizePinCount(
        levelling.defaultLevel,
        DEFAULT_LEVELLING_SETTINGS.defaultLevel
      )),
      baseRequiredExpToLevelUp: Math.max(
        1,
        ConfigLoader.normalizePinCount(
          levelling.baseRequiredExpToLevelUp,
          DEFAULT_LEVELLING_SETTINGS.baseRequiredExpToLevelUp
        )
      ),
      incrementRequiredXpBy: ConfigLoader.normalizePinCount(
        levelling.incrementRequiredXpBy,
        DEFAULT_LEVELLING_SETTINGS.incrementRequiredXpBy
      ),
      experience: {
        everyBooster: ConfigLoader.normalizePinCount(
          experience.everyBooster,
          DEFAULT_LEVELLING_SETTINGS.experience.everyBooster
        ),
        everyDistinctCard: ConfigLoader.normalizePinCount(
          experience.everyDistinctCard,
          DEFAULT_LEVELLING_SETTINGS.experience.everyDistinctCard
        ),
        nameChanged: ConfigLoader.normalizePinCount(
          experience.nameChanged,
          DEFAULT_LEVELLING_SETTINGS.experience.nameChanged
        ),
      },
    };
  }

  /**
   * XP granted by a trophy of a given rarity (`ExperiencePerTrophy`).
   *
   * Only the five known rarities are returned, so an unknown rarity in a trophy file yields 0 XP
   * instead of `NaN`.
   *
   * @returns {Promise<Record<string, number>>} The XP per rarity ("bronze" … "emerald").
   * @throws {Error} See `load()`.
   */
  async getExperiencePerTrophy() {
    const config = await this.getConfig();
    const raw = config.ExperiencePerTrophy || {};
    const map = {};
    Object.keys(DEFAULT_EXPERIENCE_PER_TROPHY).forEach((rarity) => {
      map[rarity] = ConfigLoader.normalizePinCount(raw[rarity], DEFAULT_EXPERIENCE_PER_TROPHY[rarity]);
    });
    return map;
  }

  /**
   * Normalizes a relative path read from the configuration.
   *
   * @param {unknown} value - Raw value.
   * @param {string} fallback - Path used when the value is absent or blank.
   * @returns {string} The trimmed path without a leading `./`.
   */
  static normalizePath(value, fallback) {
    const raw = typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
    return raw.replace(/^\.\//, '').replace(/\/+$/, '');
  }

  /**
   * Normalizes a small non-negative integer read from the configuration.
   *
   * @param {unknown} value - Raw value.
   * @param {number} fallback - Value used when the input is not a valid integer.
   * @returns {number} The validated integer.
   */
  static normalizePinCount(value, fallback) {
    return Number.isInteger(value) && value >= 0 ? value : fallback;
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
