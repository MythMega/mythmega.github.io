/**
 * cards.js - Read-only browser for booster and promo-card catalogues.
 *
 * ACCESS
 *   The page is gated by a password. Only the SHA-256 DIGEST is stored here, identical to
 *   `index.html` and `save-editor.html`: the typed value is hashed in the browser and compared to
 *   `PASSWORD_HASH`. This is a UI barrier, not a security boundary.
 *
 * DATA
 *   The page reads `settings/cardsets.json` and then the selected source directly:
 *   `boosters.directory/<id>.json` for a booster, `promos.directory/<id>.json` for a promo
 *   collection. It never checks `releaseDate`, so an unreleased set such as A2 is browsable as soon
 *   as its data file exists. A booster declares its cards under `Cards`, a promo file under `Card`.
 */

import { Card } from '../js/classes/Card.js';
import CardPrint from '../js/UI/components/CardPrint.js';
import { storageRepository } from '../js/models/StorageRepository.js';
import {
  ConfigLoader,
  buildCardGenerateDefaults,
} from '../js/utils/ConfigLoader.js';
import cardGenerateManager from '../js/utils/CardGenerateManager.js';
import { resolveAnimatedLayersDuration } from '../js/utils/CardSourceManager.js';

/** SHA-256 (hex) of the admin password, identical to the other admin pages. */
const PASSWORD_HASH = '19768d6a62452099c450e0e7d1ba4be25597c2669dcab5fea88fe73ae74ca39e';

/** Local-only development password, accepted only on the exact `localhost` host. */
const LOCAL_SKIP_PASSWORD = '--skip';

/** Catalogue of the declared sets (ids, release dates, promo flag). */
const CARDSETS_PATH = '../settings/cardsets.json';

/** Configuration holding the booster and promo directories. */
const CONFIG_PATH = '../settings/config.json';

/** Fallbacks used when `config.json` omits a directory. */
const DEFAULT_BOOSTER_DIRECTORY = 'data/boosters';
const DEFAULT_PROMO_DIRECTORY = 'data/promo_cards';
const DEFAULT_RARITY_PATH = 'settings/defaultRarity.json';

/** `user_state` key of the account preferences (see `AccountManager`). */
const SETTINGS_STATE_KEY = 'settings';

/** Number of complete-collection simulations used by the booster analysis. */
const SIMULATION_TRIALS = 2000;

/** Safety cap for a single simulated collection, so a broken set cannot freeze the page. */
const SIMULATION_MAX_BOOSTERS = 30000;

/** A god pack needs at least three distinct full art printings in the game engine. */
const GODPACK_MIN_FULL_ART = 3;

/** Display labels of the layouts found in the card files. */
const LAYOUT_LABELS = Object.freeze({ classic: 'Classique', fullart: 'Full art' });

/** French number formatting shared by the statistics and the simulation. */
const NUMBER_FORMATTER = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const PERCENT_FORMATTER = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

/** Display labels of the six rarities, matching `settings/i18n/fr.json`. */
const RARITY_LABELS = Object.freeze({
  1: 'Commune',
  2: 'Rare',
  3: 'Super rare',
  4: 'Légendaire',
  5: 'Mythique',
  6: 'Unique',
});

/** Rarities proposed by the filter, from the most common to the rarest. */
const RARITY_VALUES = Object.freeze([1, 2, 3, 4, 5, 6]);

/** Whether the saved account asked the generated layers to move. */
let animatedLayers = false;

/** Sentinel of the "all cards on one page" page size. */
const PAGE_SIZE_ALL = 'all';

/** Natural comparison, so `B2` sorts before `B10`. */
const COLLATOR = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });

/** UTC day formatter used for the release date shown above the table. */
const RELEASE_DATE_FORMATTER = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
});

/** Current view state. `cards` always keeps the source order. */
const state = {
  cards: [],
  source: null,
  simulationRarities: new Set(),
  query: '',
  rarity: 'all',
  sortKey: 'num',
  sortDir: 'asc',
  pageSize: 25,
  page: 1,
};

/** Configuration loaded once the page is unlocked. @type {object|null} */
let config = null;

/** Declared sets, indexed by id. @type {Map<string, object>} */
const setsById = new Map();

/** Monotonic token used to ignore a source load that a newer selection replaced. */
let loadToken = 0;

/** Table loaded from `boosters.rarityConfigPath`; booster files may override it. */
let defaultRarityTable = null;

const lock = document.getElementById('lock');
const lockForm = document.getElementById('lock-form');
const lockInput = document.getElementById('lock-input');
const lockFeedback = document.getElementById('lock-feedback');
const app = document.getElementById('app');
const lockAgain = document.getElementById('lock-again');
const sourceStatus = document.getElementById('source-status');
const sourceSelect = document.getElementById('source-select');
const tabCards = document.getElementById('tab-cards');
const tabAnalysis = document.getElementById('tab-analysis');
const panelCards = document.getElementById('panel-cards');
const panelAnalysis = document.getElementById('panel-analysis');
const cardsTabCount = document.getElementById('cards-tab-count');
const analysisKind = document.getElementById('analysis-kind');
const analysisSummary = document.getElementById('analysis-summary');
const analysisFeedback = document.getElementById('analysis-feedback');
const analysisTotal = document.getElementById('analysis-total');
const analysisRarityCount = document.getElementById('analysis-rarity-count');
const analysisClassic = document.getElementById('analysis-classic');
const analysisFullart = document.getElementById('analysis-fullart');
const rarityChart = document.getElementById('rarity-chart');
const rarityChartSummary = document.getElementById('rarity-chart-summary');
const layoutChart = document.getElementById('layout-chart');
const layoutChartSummary = document.getElementById('layout-chart-summary');
const simulationCard = document.getElementById('simulation-card');
const simulationSource = document.getElementById('simulation-source');
const simulationSummary = document.getElementById('simulation-summary');
const simulationMean = document.getElementById('simulation-mean');
const simulationMeanSuffix = document.getElementById('simulation-mean-suffix');
const simulationMedian = document.getElementById('simulation-median');
const simulationP90 = document.getElementById('simulation-p90');
const simulationTrials = document.getElementById('simulation-trials');
const simulationNote = document.getElementById('simulation-note');
const rarityPicker = document.getElementById('rarity-picker');
const rarityOptions = document.getElementById('rarity-options');
const raritySelectionSummary = document.getElementById('rarity-selection-summary');
const searchInput = document.getElementById('search-input');
const rarityFilter = document.getElementById('rarity-filter');
const sortSelect = document.getElementById('sort-select');
const sortDirection = document.getElementById('sort-direction');
const pageSizeSelect = document.getElementById('page-size');
const resetFilters = document.getElementById('reset-filters');
const catalogFeedback = document.getElementById('catalog-feedback');
const tableTitle = document.getElementById('table-title');
const tableSummary = document.getElementById('table-summary');
const cardsBody = document.getElementById('cards-body');
const pagination = document.getElementById('pagination');
const paginationInfo = document.getElementById('pagination-info');
const pageLabel = document.getElementById('page-label');
const pageFirst = document.getElementById('page-first');
const pagePrev = document.getElementById('page-prev');
const pageNext = document.getElementById('page-next');
const pageLast = document.getElementById('page-last');
const lightbox = document.getElementById('lightbox');
const lightboxImage = document.getElementById('lightbox-image');
const lightboxImageTitle = document.getElementById('lightbox-image-title');
const lightboxGenerated = document.getElementById('lightbox-generated');
const lightboxGeneratedTitle = document.getElementById('lightbox-generated-title');
const lightboxCaption = document.getElementById('lightbox-caption');

/** Reused generated card of the comparison dialog. @type {CardPrint|null} */
let lightboxCardPrint = null;

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Writes a message into a feedback paragraph.
 *
 * @param {HTMLElement|null} element - Target paragraph.
 * @param {string|null} text - Message, or null to hide the paragraph.
 * @param {'info'|'success'|'warning'|'error'} [tone='info'] - Visual tone.
 * @returns {void}
 */
function setFeedback(element, text, tone = 'info') {
  if (!element) return;
  if (!text) {
    element.hidden = true;
    element.textContent = '';
    element.removeAttribute('data-tone');
    return;
  }
  element.hidden = false;
  element.textContent = text;
  element.dataset.tone = tone;
}

/**
 * Hashes a string with SHA-256 and returns its lowercase hexadecimal digest.
 *
 * @param {string} value - Text to hash.
 * @returns {Promise<string>} The digest.
 */
async function sha256Hex(value) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('crypto.subtle est indisponible : servez la page en HTTPS ou sur localhost.');
  }
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Compares two strings without returning early on the first differing byte.
 *
 * @param {string} left - First string.
 * @param {string} right - Second string.
 * @returns {boolean} True when the strings are identical.
 */
function constantTimeEqual(left, right) {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

/**
 * Fetches a JSON file with the network as the source of truth.
 *
 * @param {string} path - URL relative to the admin page.
 * @returns {Promise<unknown>} The parsed JSON.
 * @throws {Error} When the file cannot be fetched.
 */
async function fetchJson(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Impossible de charger ${path} (HTTP ${response.status}).`);
  }
  return response.json();
}

/**
 * Applies the generated-card design and the animation preference of the saved account.
 *
 * The admin browser reads the same IndexedDB account as the game. The configuration gives the
 * shipped design; `settings.cardGenerate` is the per-account override, and `animatedLayers` / its
 * speed decide whether the generated cards move. A missing account or an unavailable database is
 * not fatal: the page keeps the configuration defaults.
 *
 * @returns {Promise<void>} Resolves once the runtime values are published.
 */
async function applySavedCardGenerate() {
  const shippedConfig = ConfigLoader.normalizeCardGenerateSettings(config?.cardGenerate);
  cardGenerateManager.applySettings(buildCardGenerateDefaults(shippedConfig));

  let saved = null;
  try {
    saved = await storageRepository.getUserState(SETTINGS_STATE_KEY);
  } catch (error) {
    console.warn('[Admin cards] Saved account settings unavailable.', error);
  }

  if (saved?.cardGenerate) cardGenerateManager.applySettings(saved.cardGenerate);
  animatedLayers = saved?.animatedLayers === true;
  document.documentElement.dataset.animatedLayers = String(animatedLayers);
  document.documentElement.style.setProperty(
    '--animated-layers-duration',
    `${resolveAnimatedLayersDuration(saved?.animatedLayersSpeed)}s`
  );
}

/**
 * Lets one of the admin's generated cards follow the saved animation preference.
 *
 * The comparison table and the lightbox are both "detail" surfaces: when the account asked for
 * moving layers, they animate just like a card detail of the game.
 *
 * @param {CardPrint} print - Generated card.
 * @returns {CardPrint} The same card.
 */
function applyCardPrintAnimation(print) {
  print.setAnimatedLayers(animatedLayers);
  print.setAnimatedLayersView(animatedLayers);
  return print;
}

/**
 * Normalises a directory read from `config.json`.
 *
 * @param {unknown} value - Declared directory.
 * @param {string} fallback - Directory used when the value is absent.
 * @returns {string} A project-relative directory without leading `./` or trailing slash.
 */
function normalizeDirectory(value, fallback) {
  const directory = typeof value === 'string' ? value.trim() : '';
  const selected = directory === '' ? fallback : directory;
  return selected.replace(/^\.?\//, '').replace(/\/+$/, '');
}

/**
 * Builds the URL of a catalogue file from the admin page.
 *
 * @param {string} directory - Project-relative data directory.
 * @param {string} id - Set identifier.
 * @returns {string} The URL to fetch.
 */
function sourceUrl(directory, id) {
  return `../${directory}/${encodeURIComponent(id)}.json`;
}

/**
 * Builds the URL of a project-relative file from the admin page.
 *
 * @param {unknown} path - File path declared in `config.json`.
 * @param {string} fallback - Path used when the value is absent.
 * @returns {string} The URL to fetch.
 */
function projectFileUrl(path, fallback) {
  const value = typeof path === 'string' && path.trim() !== '' ? path.trim() : fallback;
  return `../${value.replace(/^\.?\//, '')}`;
}

/**
 * Replaces the language placeholder of a card image path.
 *
 * @param {unknown} path - Path declared by the card.
 * @param {'fr'|'en'} language - Requested language.
 * @returns {string} The usable URL, or an empty string when the card has no image.
 */
function resolveImagePath(path, language) {
  if (typeof path !== 'string' || path.trim() === '') return '';
  return path.trim().replace(/<lang>|\{lang\}/gi, language);
}

/**
 * Removes accents and case so a search ignores typography.
 *
 * @param {unknown} value - Text to normalise.
 * @returns {string} The normalised text.
 */
function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Reads a release date without ever using it to hide a set.
 *
 * @param {unknown} value - `YYYY-MM-DD` declared by `cardsets.json`.
 * @returns {{valid: boolean, upcoming: boolean, text: string}} Release information.
 */
function releaseInfo(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return { valid: false, upcoming: false, text: '' };
  }
  const raw = value.trim();
  const date = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return { valid: false, upcoming: false, text: '' };
  }
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return {
    valid: true,
    upcoming: date.getTime() > today,
    text: RELEASE_DATE_FORMATTER.format(date),
  };
}

/**
 * Returns the singular or plural form of "carte".
 *
 * @param {number} count - Number of cards.
 * @returns {string} The word, with its plural mark when needed.
 */
function cardWord(count) {
  return count > 1 ? 'cartes' : 'carte';
}

/* -------------------------------------------------------------------------- */
/* Catalogue loading                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Fills the source selector with every declared booster and promo collection.
 *
 * @returns {void}
 */
function buildSourceSelect() {
  sourceSelect.replaceChildren();
  const boosterGroup = document.createElement('optgroup');
  boosterGroup.label = 'Boosters';
  const promoGroup = document.createElement('optgroup');
  promoGroup.label = 'Collections promo';

  setsById.clear();
  for (const entry of Array.isArray(config?.sets) ? config.sets : []) {
    const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
    if (id === '') continue;
    setsById.set(id, entry);
    const release = releaseInfo(entry.releaseDate);
    const suffix = release.upcoming ? ` - à venir le ${release.text}` : '';
    boosterGroup.append(new Option(`Booster ${id}${suffix}`, `booster:${id}`));
    if (entry.promo === true) {
      promoGroup.append(new Option(`Promo ${id}${suffix}`, `promo:${id}`));
    }
  }

  if (boosterGroup.children.length > 0) sourceSelect.append(boosterGroup);
  if (promoGroup.children.length > 0) sourceSelect.append(promoGroup);
  sourceSelect.disabled = false;
  if (sourceSelect.options.length > 0) sourceSelect.selectedIndex = 0;
}

/**
 * Fills the rarity filter with the six labels used by the game.
 *
 * @returns {void}
 */
function buildRarityFilter() {
  rarityFilter.replaceChildren(new Option('Toutes', 'all'));
  RARITY_VALUES.forEach((rarity) => {
    rarityFilter.append(new Option(RARITY_LABELS[rarity], String(rarity)));
  });
}

/**
 * Normalises one card entry from a booster or promo file.
 *
 * The table keeps the raw entry's generated counterpart alongside its view model. Building it can
 * fail for a malformed catalogue entry, which must never hide the image thumbnails: the generated
 * cell simply shows a dash in that case.
 *
 * @param {object} card - Raw card declared in the JSON.
 * @param {number} index - Position in the source file, zero-based.
 * @param {string} setId - Extension owning the card.
 * @returns {object} The view model used by the table.
 */
function normalizeCard(card, index, setId) {
  const num = index + 1;
  const cardIndex = typeof card?.Index === 'string' && card.Index.trim() !== '' ? card.Index.trim() : '-';
  const nameFr = typeof card?.Name_FR === 'string' && card.Name_FR.trim() !== '' ? card.Name_FR.trim() : '';
  const nameEn = typeof card?.Name_EN === 'string' && card.Name_EN.trim() !== '' ? card.Name_EN.trim() : '';
  const parsedRarity = Number.parseInt(card?.Rarity, 10);
  const rarity = Number.isInteger(parsedRarity) ? parsedRarity : 0;
  const rarityLabel = RARITY_LABELS[rarity] ?? '-';
  const layout = typeof card?.Layout === 'string' ? card.Layout : '';

  let generatedCard = null;
  let generatedError = '';
  try {
    generatedCard = Card.fromSetEntry(card, { set: setId });
  } catch (error) {
    generatedError = error instanceof Error ? error.message : String(error);
    console.warn(`[Admin cards] Generated card unavailable for ${cardIndex}.`, error);
  }

  return {
    num,
    index: cardIndex,
    nameFr: nameFr || nameEn || '-',
    nameEn: nameEn || nameFr || '-',
    rarity,
    rarityLabel,
    layout,
    frImage: resolveImagePath(card?.Path, 'fr'),
    enImage: resolveImagePath(card?.Path, 'en'),
    generatedCard,
    generatedError,
    searchText: normalizeText([num, cardIndex, nameFr, nameEn, rarityLabel, layout].join(' ')),
  };
}

/**
 * Requests the selected source and loads its cards without checking the release date.
 *
 * @returns {Promise<void>} Resolves once the source was rendered or its error displayed.
 */
async function loadSource() {
  const value = sourceSelect.value;
  const separator = value.indexOf(':');
  const kind = separator === -1 ? '' : value.slice(0, separator);
  const id = separator === -1 ? '' : value.slice(separator + 1);
  if ((kind !== 'booster' && kind !== 'promo') || id === '') return;

  const token = (loadToken += 1);
  const kindLabel = kind === 'booster' ? 'Booster' : 'Collection promo';
  sourceSelect.disabled = true;
  setFeedback(catalogFeedback, null);
  state.source = null;
  state.cards = [];
  state.simulationRarities = new Set();
  state.page = 1;
  sourceStatus.textContent = `Chargement de ${kindLabel.toLowerCase()} ${id}…`;
  tableTitle.textContent = kind === 'booster' ? `Cartes du booster ${id}` : `Cartes promo ${id}`;
  tableSummary.textContent = 'Chargement…';
  pagination.hidden = true;
  setTablePlaceholder('Chargement…');
  renderAnalysisLoading(kindLabel, id);

  try {
    const directory = kind === 'booster'
      ? config?.boosters?.directory
      : config?.promos?.directory;
    const fallback = kind === 'booster' ? DEFAULT_BOOSTER_DIRECTORY : DEFAULT_PROMO_DIRECTORY;
    const url = sourceUrl(normalizeDirectory(directory, fallback), id);
    const data = await fetchJson(url);
    if (token !== loadToken) return;

    const rawCards = Array.isArray(data?.Cards)
      ? data.Cards
      : Array.isArray(data?.Card)
        ? data.Card
        : [];
    state.source = { kind, id, data };
    state.cards = rawCards.map((card, index) => normalizeCard(card, index, id));
    state.simulationRarities = new Set(
      state.cards.map((card) => card.rarity).filter((rarity) => Number.isInteger(rarity) && rarity > 0),
    );
    const release = releaseInfo(setsById.get(id)?.releaseDate);
    const releaseText = release.valid
      ? release.upcoming
        ? `sortie prévue le ${release.text}`
        : `sorti le ${release.text}`
      : 'date de sortie non précisée';
    const name = typeof data?.Name === 'string' && data.Name.trim() !== ''
      ? data.Name.trim()
      : typeof data?.Serie === 'string' && data.Serie.trim() !== ''
        ? data.Serie.trim()
        : id;
    sourceStatus.textContent = `${kindLabel} ${id} · ${name} · ${releaseText}`;
    render();
    renderAnalysis();
  } catch (error) {
    if (token !== loadToken) return;
    console.error('[Admin cards] Catalogue load failed.', error);
    state.source = null;
    state.cards = [];
    state.simulationRarities = new Set();
    tableSummary.textContent = 'Aucune carte chargée.';
    pagination.hidden = true;
    setTablePlaceholder('Aucune carte à afficher.');
    setFeedback(catalogFeedback, error.message, 'error');
    sourceStatus.textContent = `${kindLabel} ${id} · chargement impossible`;
    renderAnalysisEmpty('Impossible de charger ce catalogue.');
  } finally {
    if (token === loadToken) sourceSelect.disabled = false;
  }
}

/* -------------------------------------------------------------------------- */
/* Booster analysis                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Formats a number for the analysis cards.
 *
 * @param {number} value - Number to format.
 * @returns {string} The French display value.
 */
function formatNumber(value) {
  return NUMBER_FORMATTER.format(value);
}

/**
 * Formats a percentage with at most one decimal.
 *
 * @param {number} value - Percentage (0-100).
 * @returns {string} The French display value, without the percent sign.
 */
function formatPercent(value) {
  return PERCENT_FORMATTER.format(value);
}

/**
 * Returns the display label of a layout.
 *
 * @param {string} layout - Raw `Layout` value.
 * @returns {string} The French label, or the raw value when unknown.
 */
function layoutLabel(layout) {
  const key = String(layout ?? '').trim().toLowerCase();
  return LAYOUT_LABELS[key] ?? (key === '' ? 'Non défini' : layout);
}

/**
 * Returns the rarity table used by a booster draw.
 *
 * A booster-level `Rarity` object overrides `defaultRarity.json`, exactly like `GachaEngine`.
 *
 * @param {object|null} data - Raw booster JSON.
 * @returns {{table: object, source: 'booster'|'default'}|null} The table and its origin.
 */
function resolveRarityTable(data) {
  const override = data && typeof data === 'object' ? data.Rarity : undefined;
  if (override && typeof override === 'object' && !Array.isArray(override)) {
    return { table: override, source: 'booster' };
  }
  if (defaultRarityTable && typeof defaultRarityTable === 'object' && !Array.isArray(defaultRarityTable)) {
    return { table: defaultRarityTable, source: 'default' };
  }
  return null;
}

/**
 * Counts cards by an arbitrary numeric or string key.
 *
 * @param {object[]} cards - Normalised cards.
 * @param {(card: object) => string|number} selector - Key selector.
 * @returns {Map<string|number, number>} The counts, in first-seen order.
 */
function countCards(cards, selector) {
  const counts = new Map();
  for (const card of cards) {
    const key = selector(card);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Replaces a chart with an empty-state message.
 *
 * @param {HTMLElement} container - Chart container.
 * @param {string} message - Message to display.
 * @returns {void}
 */
function setChartPlaceholder(container, message) {
  const placeholder = document.createElement('p');
  placeholder.className = 'chart-empty';
  placeholder.textContent = message;
  container.replaceChildren(placeholder);
}

/**
 * Builds the horizontal bars of one distribution.
 *
 * @param {HTMLElement} container - Chart container.
 * @param {Array<{label: string, value: number, tone: string, dotTone: string}>} rows - Rows.
 * @param {number} total - Total used for the percentages.
 * @param {string} emptyMessage - Message when there is no row.
 * @returns {void}
 */
function renderBarChart(container, rows, total, emptyMessage) {
  if (rows.length === 0) {
    setChartPlaceholder(container, emptyMessage);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    const rowElement = document.createElement('div');
    rowElement.className = 'chart-row';
    rowElement.setAttribute('role', 'listitem');

    const label = document.createElement('span');
    label.className = 'chart-row__label';
    const dot = document.createElement('span');
    dot.className = `chart-dot ${row.dotTone}`;
    dot.setAttribute('aria-hidden', 'true');
    label.append(dot, document.createTextNode(row.label));

    const track = document.createElement('span');
    track.className = 'chart-row__track';
    const bar = document.createElement('span');
    bar.className = `chart-row__bar ${row.tone}`;
    const percent = total > 0 ? (row.value / total) * 100 : 0;
    bar.style.width = `${Math.max(percent, row.value > 0 ? 1 : 0)}%`;
    track.append(bar);

    const value = document.createElement('span');
    value.className = 'chart-row__value';
    const count = document.createElement('strong');
    count.textContent = formatNumber(row.value);
    const share = document.createElement('small');
    share.textContent = `${formatPercent(percent)} %`;
    value.append(count, share);

    rowElement.append(label, track, value);
    fragment.append(rowElement);
  }
  container.replaceChildren(fragment);
}

/**
 * Updates the line under the rarity picker with the selection and its card count.
 *
 * @returns {void}
 */
function updateRarityPickerSummary() {
  const inputs = rarityOptions.querySelectorAll('input[data-rarity]');
  const selected = state.simulationRarities.size;
  const target = state.cards.reduce(
    (count, card) => count + (state.simulationRarities.has(card.rarity) ? 1 : 0),
    0,
  );
  raritySelectionSummary.textContent = selected === 0
    ? 'Aucune rareté sélectionnée'
    : `${formatNumber(selected)} / ${formatNumber(inputs.length)} raretés · ${formatNumber(target)} ${cardWord(target)} ciblée${target > 1 ? 's' : ''}`;
}

/**
 * Builds one checkbox per rarity present in the selected booster.
 *
 * @param {Map<number, number>} rarityCounts - Number of cards per rarity.
 * @returns {void}
 */
function renderRarityPicker(rarityCounts) {
  const rarities = [...rarityCounts.keys()]
    .filter((rarity) => Number.isInteger(rarity) && rarity > 0)
    .sort((left, right) => left - right);

  if (rarities.length === 0) {
    rarityOptions.replaceChildren();
    rarityPicker.hidden = true;
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const rarity of rarities) {
    const label = document.createElement('label');
    label.className = `rarity-option rarity-option--${rarity}`;

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'rarity-option__input';
    input.value = String(rarity);
    input.dataset.rarity = String(rarity);
    input.checked = state.simulationRarities.has(rarity);

    const dot = document.createElement('span');
    dot.className = `rarity-option__dot chart-dot--rarity-${rarity}`;
    dot.setAttribute('aria-hidden', 'true');

    const text = document.createElement('span');
    text.className = 'rarity-option__label';
    text.textContent = RARITY_LABELS[rarity] ?? 'Non définie';

    label.append(input, dot, text);
    fragment.append(label);
  }

  rarityOptions.replaceChildren(fragment);
  rarityPicker.hidden = false;
  updateRarityPickerSummary();
}

/**
 * Applies a checkbox change to the simulation's target rarities.
 *
 * @param {Event} event - Change event of the picker.
 * @returns {void}
 */
function handleRarityChange(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.type !== 'checkbox') return;
  const rarity = Number(input.dataset.rarity);
  if (!Number.isInteger(rarity)) return;

  if (input.checked) state.simulationRarities.add(rarity);
  else state.simulationRarities.delete(rarity);

  updateRarityPickerSummary();
  renderSimulation();
}

/**
 * Resets every analysis field to its empty state.
 *
 * @param {string} message - Explanation shown above the statistics.
 * @returns {void}
 */
function renderAnalysisEmpty(message) {
  analysisKind.textContent = '-';
  analysisSummary.textContent = message;
  analysisTotal.textContent = '-';
  analysisRarityCount.textContent = '-';
  analysisClassic.textContent = '-';
  analysisFullart.textContent = '-';
  rarityChartSummary.textContent = 'Aucune donnée.';
  layoutChartSummary.textContent = 'Aucune donnée.';
  setChartPlaceholder(rarityChart, 'Aucune carte chargée.');
  setChartPlaceholder(layoutChart, 'Aucune carte chargée.');
  simulationCard.dataset.state = 'na';
  simulationSource.textContent = '-';
  simulationSummary.textContent = 'Aucune simulation disponible.';
  simulationMean.textContent = 'N/A';
  simulationMedian.textContent = 'N/A';
  simulationP90.textContent = 'N/A';
  simulationTrials.textContent = 'N/A';
  simulationMeanSuffix.textContent = 'boosters';
  simulationNote.textContent = 'La simulation se base sur les cartes, la table de rareté et la taille de booster du set.';
  rarityPicker.hidden = true;
  rarityOptions.replaceChildren();
  raritySelectionSummary.textContent = '';
  setFeedback(analysisFeedback, null);
}

/**
 * Shows the analysis fields while a source is loading.
 *
 * @param {string} kindLabel - "Booster" or "Collection promo".
 * @param {string} id - Set identifier.
 * @returns {void}
 */
function renderAnalysisLoading(kindLabel, id) {
  renderAnalysisEmpty(`Chargement de ${kindLabel.toLowerCase()} ${id}…`);
  analysisKind.textContent = `${kindLabel} ${id}`;
  rarityChartSummary.textContent = 'Chargement…';
  layoutChartSummary.textContent = 'Chargement…';
  setChartPlaceholder(rarityChart, 'Chargement…');
  setChartPlaceholder(layoutChart, 'Chargement…');
  simulationSummary.textContent = 'Chargement de la simulation…';
}

/**
 * Builds the distribution rows of the selected set.
 *
 * @returns {void}
 */
function renderAnalysis() {
  const source = state.source;
  if (!source || state.cards.length === 0) {
    renderAnalysisEmpty('Aucune carte chargée.');
    return;
  }

  const isBooster = source.kind === 'booster';
  const kindLabel = isBooster ? 'Booster' : 'Collection promo';
  const data = source.data;
  const name = typeof data?.Name === 'string' && data.Name.trim() !== ''
    ? data.Name.trim()
    : typeof data?.Serie === 'string' && data.Serie.trim() !== ''
      ? data.Serie.trim()
      : source.id;
  const total = state.cards.length;

  setFeedback(analysisFeedback, null);
  analysisKind.textContent = `${kindLabel} ${source.id}`;
  analysisSummary.textContent = `${name} · ${formatNumber(total)} ${cardWord(total)} · ${isBooster ? 'données du booster' : 'cartes hors boosters'}`;

  const rarityCounts = countCards(state.cards, (card) => card.rarity);
  const layoutCounts = countCards(state.cards, (card) => String(card.layout ?? '').trim().toLowerCase());
  const classic = layoutCounts.get('classic') ?? 0;
  const fullart = layoutCounts.get('fullart') ?? 0;

  analysisTotal.textContent = formatNumber(total);
  analysisRarityCount.textContent = formatNumber(rarityCounts.size);
  analysisClassic.textContent = formatNumber(classic);
  analysisFullart.textContent = formatNumber(fullart);

  const rarityRows = [...rarityCounts.entries()]
    .sort(([left], [right]) => left - right)
    .map(([rarity, count]) => ({
      label: RARITY_LABELS[rarity] ?? 'Non définie',
      value: count,
      tone: `chart-row__bar--rarity-${rarity}`,
      dotTone: `chart-dot--rarity-${rarity}`,
    }));
  renderBarChart(rarityChart, rarityRows, total, 'Aucune rareté exploitable.');
  rarityChartSummary.textContent = `${formatNumber(total)} ${cardWord(total)} réparties sur ${formatNumber(rarityCounts.size)} rareté${rarityCounts.size > 1 ? 's' : ''}.`;

  const layoutOrder = ['classic', 'fullart'];
  const extraLayouts = [...layoutCounts.keys()].filter((key) => !layoutOrder.includes(key));
  const layoutRows = [...layoutOrder, ...extraLayouts]
    .filter((key) => layoutCounts.has(key))
    .map((key) => ({
      label: layoutLabel(key),
      value: layoutCounts.get(key) ?? 0,
      tone: `chart-row__bar--layout-${key}`,
      dotTone: `chart-dot--layout-${key}`,
    }));
  renderBarChart(layoutChart, layoutRows, total, 'Aucun layout exploitable.');
  layoutChartSummary.textContent = `${formatNumber(classic)} classique${classic > 1 ? 's' : ''} · ${formatNumber(fullart)} full art.`;

  if (!isBooster) {
    rarityPicker.hidden = true;
    rarityOptions.replaceChildren();
    raritySelectionSummary.textContent = '';
    renderSimulationUnavailable('N/A', 'Les cartes promo ne sortent pas des boosters : cette espérance ne s’applique pas.');
    return;
  }

  renderRarityPicker(rarityCounts);
  renderSimulation();
}

/**
 * Shows the N/A state of the completion simulation.
 *
 * @param {string} summary - Main explanation.
 * @param {string} note - Detail shown under the result cards.
 * @returns {void}
 */
function renderSimulationUnavailable(summary, note) {
  simulationCard.dataset.state = 'na';
  simulationSource.textContent = 'N/A';
  simulationSummary.textContent = summary;
  simulationMean.textContent = 'N/A';
  simulationMedian.textContent = 'N/A';
  simulationP90.textContent = 'N/A';
  simulationTrials.textContent = 'N/A';
  simulationMeanSuffix.textContent = 'boosters';
  simulationNote.textContent = note;
}

/**
 * Validates the rarity table and builds the draw context of the Monte-Carlo simulation.
 *
 * @param {object[]} cards - Normalised cards of the booster.
 * @param {object} rarityTable - Slot table from the booster or `defaultRarity.json`.
 * @param {Set<number>} selectedRarities - Rarities that count toward completion.
 * @returns {object} The context consumed by `simulateCollection()`.
 * @throws {Error} When the table or the card pools are incomplete.
 */
function buildSimulationContext(cards, rarityTable, selectedRarities) {
  const configuredCards = Number(config?.boosters?.cardsPerBooster);
  const cardsPerBooster = Number.isInteger(configuredCards) && configuredCards > 0 ? configuredCards : 5;
  const slots = Object.keys(rarityTable)
    .map((key) => Number(key))
    .filter((slot) => Number.isInteger(slot) && slot > 0)
    .sort((left, right) => left - right);

  if (slots.length !== cardsPerBooster) {
    throw new Error(`La table de rareté déclare ${slots.length} slot(s) pour ${cardsPerBooster} carte(s) par booster.`);
  }

  const cardsByRarity = new Map();
  cards.forEach((card, index) => {
    if (!Number.isInteger(card.rarity) || card.rarity <= 0) return;
    if (!cardsByRarity.has(card.rarity)) cardsByRarity.set(card.rarity, []);
    cardsByRarity.get(card.rarity).push(index);
  });

  const required = new Uint8Array(cards.length);
  let requiredCount = 0;
  cards.forEach((card, index) => {
    if (!selectedRarities.has(card.rarity)) return;
    required[index] = 1;
    requiredCount += 1;
  });

  const slotCdfs = slots.map((slot) => {
    const rawEntries = rarityTable[slot] ?? rarityTable[String(slot)];
    if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
      throw new Error(`Le slot ${slot} de la table de rareté est vide.`);
    }

    const entries = rawEntries.map((entry, index) => {
      const rarity = Number(entry?.rarity);
      const weight = Number(entry?.weight);
      if (!Number.isInteger(rarity) || rarity <= 0) {
        throw new Error(`Rareté invalide dans le slot ${slot}, entrée ${index + 1}.`);
      }
      if (!Number.isFinite(weight) || weight <= 0) {
        throw new Error(`Poids invalide dans le slot ${slot}, entrée ${index + 1}.`);
      }
      const pool = cardsByRarity.get(rarity) ?? [];
      if (pool.length === 0) {
        throw new Error(`Aucune carte de rareté ${rarity} pour le slot ${slot}.`);
      }
      return { rarity, weight };
    });

    const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
    let cumulative = 0;
    return entries.map((entry) => {
      cumulative += entry.weight / totalWeight;
      return { rarity: entry.rarity, cumulative };
    });
  });

  const fullArt = [];
  cards.forEach((card, index) => {
    if (String(card.layout ?? '').trim().toLowerCase() === 'fullart') fullArt.push(index);
  });

  const chancePercent = Number(config?.boosters?.godpackChancePercent);
  const configuredChance = Number.isFinite(chancePercent) ? Math.min(Math.max(chancePercent, 0), 100) : 0;
  const godpackRate = configuredChance > 0 && fullArt.length >= GODPACK_MIN_FULL_ART
    ? configuredChance / 100
    : 0;

  const obtainable = new Uint8Array(cards.length);
  for (const cdf of slotCdfs) {
    for (const entry of cdf) {
      for (const index of cardsByRarity.get(entry.rarity) ?? []) {
        if (required[index] === 1) obtainable[index] = 1;
      }
    }
  }
  if (godpackRate > 0) {
    for (const index of fullArt) {
      if (required[index] === 1) obtainable[index] = 1;
    }
  }
  let missing = 0;
  for (let index = 0; index < required.length; index += 1) {
    if (required[index] === 1 && obtainable[index] === 0) missing += 1;
  }
  if (missing > 0) {
    throw new Error(`${formatNumber(missing)} carte(s) sélectionnée(s) ne peuvent jamais sortir d’un booster avec cette table.`);
  }

  return {
    cardsPerBooster,
    cardsByRarity,
    slotCdfs,
    fullArt,
    godpackRate,
    total: cards.length,
    required,
    requiredCount,
  };
}

/**
 * Deterministic 32-bit PRNG: a reload always yields the same estimate for the same set.
 *
 * @param {number} seed - Initial state.
 * @returns {() => number} A function returning floats in [0, 1).
 */
function mulberry32(seed) {
  let value = seed >>> 0;
  return function random() {
    value = (value + 0x6d2b79f5) | 0;
    let result = Math.imul(value ^ (value >>> 15), 1 | value);
    result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Hashes a string to a 32-bit seed.
 *
 * @param {string} text - Seed text.
 * @returns {number} An unsigned 32-bit integer.
 */
function hashSeed(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Estimates how many boosters are needed to own every card of a booster.
 *
 * Each simulated booster follows `GachaEngine`: five rarity draws from the slot table, then a
 * uniform card inside that rarity, with the configured god pack replacing the whole pack by full
 * art printings. The mean, median and 90th percentile are returned.
 *
 * @param {object} context - Context built by `buildSimulationContext()`.
 * @param {string} seedText - Stable seed for the set.
 * @returns {{mean: number, median: number, p90: number, cappedTrials: number}} The estimate.
 */
function simulateCollection(context, seedText) {
  const random = mulberry32(hashSeed(seedText));
  const seen = new Uint8Array(context.total);
  const times = new Array(SIMULATION_TRIALS);
  let cappedTrials = 0;

  for (let trial = 0; trial < SIMULATION_TRIALS; trial += 1) {
    seen.fill(0);
    let collected = 0;
    let boosters = 0;

    while (collected < context.requiredCount && boosters < SIMULATION_MAX_BOOSTERS) {
      boosters += 1;
      const godpack = context.godpackRate > 0 && random() < context.godpackRate;

      for (let slot = 0; slot < context.cardsPerBooster; slot += 1) {
        let index;
        if (godpack) {
          index = context.fullArt[Math.floor(random() * context.fullArt.length)];
        } else {
          const cdf = context.slotCdfs[slot];
          const roll = random();
          let rarity = cdf[cdf.length - 1].rarity;
          for (const entry of cdf) {
            if (roll < entry.cumulative) {
              rarity = entry.rarity;
              break;
            }
          }
          const pool = context.cardsByRarity.get(rarity);
          index = pool[Math.floor(random() * pool.length)];
        }

        if (context.required[index] === 1 && seen[index] === 0) {
          seen[index] = 1;
          collected += 1;
        }
      }
    }

    if (collected < context.requiredCount) cappedTrials += 1;
    times[trial] = boosters;
  }

  times.sort((left, right) => left - right);
  const mean = times.reduce((sum, value) => sum + value, 0) / times.length;
  const percentile = (fraction) => times[Math.min(times.length - 1, Math.ceil(fraction * times.length) - 1)];
  return {
    mean,
    median: percentile(0.5),
    p90: percentile(0.9),
    cappedTrials,
  };
}

/**
 * Runs and displays the completion simulation for the selected booster.
 *
 * @returns {void}
 */
function renderSimulation() {
  const source = state.source;
  if (!source || source.kind !== 'booster') {
    renderSimulationUnavailable('N/A', 'Les cartes promo ne sortent pas des boosters : cette espérance ne s’applique pas.');
    return;
  }

  const rarity = resolveRarityTable(source.data);
  if (!rarity) {
    renderSimulationUnavailable('N/A', 'Table de rareté introuvable : vérifiez settings/defaultRarity.json ou le champ Rarity du booster.');
    setFeedback(analysisFeedback, 'Simulation impossible : aucune table de rareté utilisable.', 'warning');
    return;
  }

  if (state.simulationRarities.size === 0) {
    renderSimulationUnavailable('N/A', 'Cochez au moins une rareté pour calculer l’espérance de complétion.');
    return;
  }

  try {
    const context = buildSimulationContext(state.cards, rarity.table, state.simulationRarities);
    const result = simulateCollection(context, `admin-cards:${source.id}:${rarity.source}`);
    const capped = result.cappedTrials > 0;
    const prefix = capped ? '≥ ' : '';

    simulationCard.dataset.state = 'ready';
    simulationSource.textContent = `Booster ${source.id}`;
    simulationSummary.textContent = `Estimation sur ${formatNumber(SIMULATION_TRIALS)} collections simulées · ${formatNumber(context.requiredCount)} ${cardWord(context.requiredCount)} ciblée${context.requiredCount > 1 ? 's' : ''}, ${context.cardsPerBooster} cartes par booster.`;
    simulationMean.textContent = `${prefix}${formatNumber(Math.round(result.mean))}`;
    simulationMedian.textContent = `${prefix}${formatNumber(result.median)}`;
    simulationP90.textContent = `${prefix}${formatNumber(result.p90)}`;
    simulationTrials.textContent = formatNumber(SIMULATION_TRIALS);
    simulationMeanSuffix.textContent = 'boosters';

    const chance = Number(config?.boosters?.godpackChancePercent);
    const chanceText = Number.isFinite(chance) ? `${formatPercent(Math.min(Math.max(chance, 0), 100))} %` : '0 %';
    const tableText = rarity.source === 'booster' ? `table Rarity du booster ${source.id}` : 'settings/defaultRarity.json';
    const availableRarities = rarityOptions.querySelectorAll('input[data-rarity]').length;
    const allRaritiesSelected = state.simulationRarities.size >= availableRarities;
    const selectedLabels = [...state.simulationRarities]
      .sort((left, right) => left - right)
      .map((rarityId) => RARITY_LABELS[rarityId] ?? 'Non définie')
      .join(', ');
    const selectionText = allRaritiesSelected ? 'toutes' : selectedLabels;
    const capText = capped
      ? ` ${formatNumber(result.cappedTrials)} simulation(s) ont atteint la limite de ${formatNumber(SIMULATION_MAX_BOOSTERS)} boosters : la moyenne est donc une borne basse.`
      : '';
    simulationNote.textContent = `Raretés : ${selectionText}. Table : ${tableText}. Godpack : ${chanceText}.${capText}`;
  } catch (error) {
    console.warn('[Admin cards] Completion simulation unavailable.', error);
    renderSimulationUnavailable('N/A', error.message);
    setFeedback(analysisFeedback, `Simulation impossible : ${error.message}`, 'warning');
  }
}

/* -------------------------------------------------------------------------- */
/* Filtering, sorting and rendering                                           */
/* -------------------------------------------------------------------------- */

/**
 * Replaces the table body with one message spanning every column.
 *
 * @param {string} message - Message to display.
 * @returns {void}
 */
function setTablePlaceholder(message) {
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = 8;
  cell.className = 'table-placeholder';
  cell.textContent = message;
  row.append(cell);
  cardsBody.replaceChildren(row);
}

/**
 * Sorts two cards according to the current sort key.
 *
 * @param {object} left - First card.
 * @param {object} right - Second card.
 * @returns {number} Negative, zero or positive.
 */
function compareCards(left, right) {
  const key = state.sortKey;
  if (key === 'num' || key === 'rarity') {
    return left[key] - right[key] || left.num - right.num;
  }
  return COLLATOR.compare(left[key], right[key]) || left.num - right.num;
}

/**
 * Applies the search and rarity filters, then the selected sort.
 *
 * @returns {object[]} The cards to paginate.
 */
function getFilteredCards() {
  const query = normalizeText(state.query.trim());
  const filtered = state.cards.filter((card) => {
    if (state.rarity !== 'all' && card.rarity !== Number(state.rarity)) return false;
    return query === '' || card.searchText.includes(query);
  });
  const direction = state.sortDir === 'asc' ? 1 : -1;
  return filtered.sort((left, right) => compareCards(left, right) * direction);
}

/**
 * Builds one thumbnail cell, or the em dash when the card has no image.
 *
 * @param {object} card - Normalised card.
 * @param {'fr'|'en'} language - Image language.
 * @returns {HTMLTableCellElement} The table cell.
 */
function buildImageCell(card, language) {
  const cell = document.createElement('td');
  cell.className = 'image-cell';
  const source = language === 'fr' ? card.frImage : card.enImage;
  if (source === '') {
    cell.textContent = '-';
    return cell;
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'thumb';
  button.title = `Comparer l’image ${language.toUpperCase()} et la carte générée de ${card.nameFr}`;
  button.setAttribute('aria-label', `Comparer l’image ${language.toUpperCase()} et la carte générée de ${card.nameFr}`);

  const image = document.createElement('img');
  image.src = source;
  image.alt = `Carte ${language.toUpperCase()} : ${card.nameFr}`;
  image.loading = 'lazy';
  image.decoding = 'async';
  image.width = 124;
  image.height = 173;
  image.addEventListener('error', () => {
    button.classList.add('thumb--missing');
    button.disabled = true;
    button.replaceChildren(`Image ${language.toUpperCase()} indisponible`);
  }, { once: true });

  const tag = document.createElement('span');
  tag.className = 'thumb__lang';
  tag.textContent = language.toUpperCase();
  button.append(image, tag);
  button.addEventListener('click', () => openLightbox(card, language));
  cell.append(button);
  return cell;
}

/**
 * Builds the generated counterpart of a card for the comparison table.
 *
 * The card is rendered at the same size as the two image thumbnails and with its texts, so the
 * admin can compare the built card with the final artwork directly in the row.
 *
 * @param {object} card - Normalised card.
 * @returns {HTMLTableCellElement} The table cell.
 */
function buildGeneratedCell(card) {
  const cell = document.createElement('td');
  cell.className = 'image-cell generated-cell';
  if (!card.generatedCard) {
    cell.textContent = '-';
    if (card.generatedError) cell.title = card.generatedError;
    return cell;
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'thumb thumb--generated';
  button.title = `Comparer l’image FR et la carte générée de ${card.nameFr}`;
  button.setAttribute('aria-label', `Comparer l’image FR et la carte générée de ${card.nameFr}`);

  const generated = new CardPrint();
  generated.className = 'thumb__card-print';
  generated.setAttribute('aria-hidden', 'true');
  generated.setCard(card.generatedCard, { mini: false, lang: 'fr' });
  applyCardPrintAnimation(generated);

  const tag = document.createElement('span');
  tag.className = 'thumb__lang';
  tag.textContent = 'GÉN';
  button.append(generated, tag);
  button.addEventListener('click', () => openLightbox(card, 'fr'));
  cell.append(button);
  return cell;
}

/**
 * Builds one table row.
 *
 * @param {object} card - Normalised card.
 * @returns {HTMLTableRowElement} The row.
 */
function buildRow(card) {
  const row = document.createElement('tr');

  const numCell = document.createElement('td');
  numCell.className = 'cell-num';
  numCell.textContent = String(card.num);

  const indexCell = document.createElement('td');
  const index = document.createElement('code');
  index.className = 'card-index';
  index.textContent = card.index;
  indexCell.append(index);

  const nameFrCell = document.createElement('td');
  nameFrCell.lang = 'fr';
  const nameFr = document.createElement('span');
  nameFr.className = 'card-name';
  nameFr.textContent = card.nameFr;
  nameFrCell.append(nameFr);

  const nameEnCell = document.createElement('td');
  nameEnCell.lang = 'en';
  const nameEn = document.createElement('span');
  nameEn.className = 'card-name';
  nameEn.textContent = card.nameEn;
  nameEnCell.append(nameEn);

  const rarityCell = document.createElement('td');
  const badge = document.createElement('span');
  badge.className = card.rarity > 0 ? `rarity-badge rarity-badge--${card.rarity}` : 'rarity-badge';
  badge.textContent = card.rarityLabel;
  rarityCell.append(badge);

  row.append(
    numCell,
    indexCell,
    nameFrCell,
    nameEnCell,
    rarityCell,
    buildImageCell(card, 'fr'),
    buildImageCell(card, 'en'),
    buildGeneratedCell(card),
  );
  return row;
}

/**
 * Renders the current page of cards and updates the counters.
 *
 * @returns {void}
 */
function render() {
  cardsTabCount.textContent = formatNumber(state.cards.length);
  const filtered = getFilteredCards();
  const total = filtered.length;
  const pageSize = state.pageSize === PAGE_SIZE_ALL ? Math.max(total, 1) : state.pageSize;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  state.page = Math.min(Math.max(state.page, 1), pageCount);
  const start = state.pageSize === PAGE_SIZE_ALL ? 0 : (state.page - 1) * pageSize;
  const visible = filtered.slice(start, start + pageSize);

  if (visible.length === 0) {
    setTablePlaceholder(state.cards.length === 0
      ? 'Aucune carte dans ce set.'
      : 'Aucune carte ne correspond aux filtres.');
  } else {
    const fragment = document.createDocumentFragment();
    visible.forEach((card) => fragment.append(buildRow(card)));
    cardsBody.replaceChildren(fragment);
  }

  const matching = state.cards.length === total
    ? `${total} ${cardWord(total)}`
    : `${total} ${cardWord(total)} sur ${state.cards.length}`;
  tableSummary.textContent = matching;

  pagination.hidden = total === 0;
  paginationInfo.textContent = total === 0
    ? 'Aucune carte'
    : state.pageSize === PAGE_SIZE_ALL
      ? `${total} ${cardWord(total)} affichée${total > 1 ? 's' : ''}`
      : `${start + 1}–${start + visible.length} sur ${total}`;
  pageLabel.textContent = state.pageSize === PAGE_SIZE_ALL
    ? 'Tout'
    : `Page ${state.page} / ${pageCount}`;
  pageFirst.disabled = state.page <= 1;
  pagePrev.disabled = state.page <= 1;
  pageNext.disabled = state.page >= pageCount;
  pageLast.disabled = state.page >= pageCount;
}

/**
 * Returns the generated card reused by the comparison dialog.
 *
 * @returns {CardPrint} The card element.
 */
function getLightboxCardPrint() {
  if (!lightboxCardPrint) {
    lightboxCardPrint = new CardPrint();
    lightboxCardPrint.className = 'lightbox__card-print';
    // The dialog captions already name both cards: the print itself is decorative there.
    lightboxCardPrint.setAttribute('aria-hidden', 'true');
    applyCardPrintAnimation(lightboxCardPrint);
  }
  return lightboxCardPrint;
}

/**
 * Opens the side-by-side comparison of one image and its generated card.
 *
 * @param {object} card - Normalised card.
 * @param {'fr'|'en'} language - Language of the image and of the generated texts.
 * @returns {void}
 */
function openLightbox(card, language) {
  const source = language === 'fr' ? card.frImage : card.enImage;
  if (source === '') return;
  const tag = language.toUpperCase();

  lightboxImage.src = source;
  lightboxImage.alt = `Carte ${tag} : ${card.nameFr}`;
  lightboxImageTitle.textContent = `Image source ${tag}`;
  lightboxGeneratedTitle.textContent = `Carte générée ${tag}`;

  if (card.generatedCard) {
    const generated = getLightboxCardPrint();
    generated.setCard(card.generatedCard, { mini: false, lang: language });
    applyCardPrintAnimation(generated);
    lightboxGenerated.replaceChildren(generated);
  } else {
    lightboxGenerated.replaceChildren('Carte générée indisponible');
  }

  lightboxCaption.textContent = `${card.nameFr} · ${card.index} · image source et carte reconstruite`;
  if (!lightbox.open) lightbox.showModal();
}

/**
 * Moves to a page, clamped by the current result count.
 *
 * @param {number} page - Requested page.
 * @returns {void}
 */
function goToPage(page) {
  if (state.pageSize === PAGE_SIZE_ALL) return;
  state.page = page;
  render();
}

/**
 * Shows one of the two views and updates the ARIA state of its tab.
 *
 * @param {'cards'|'analysis'} name - View to show.
 * @param {boolean} [focus=false] - Move the keyboard focus to the tab.
 * @returns {void}
 */
function activateTab(name, focus = false) {
  const showCards = name === 'cards';
  tabCards.classList.toggle('is-active', showCards);
  tabAnalysis.classList.toggle('is-active', !showCards);
  tabCards.setAttribute('aria-selected', String(showCards));
  tabAnalysis.setAttribute('aria-selected', String(!showCards));
  tabCards.tabIndex = showCards ? 0 : -1;
  tabAnalysis.tabIndex = showCards ? -1 : 0;
  panelCards.hidden = !showCards;
  panelAnalysis.hidden = showCards;
  if (focus) (showCards ? tabCards : tabAnalysis).focus();
}

/**
 * Moves the active tab with the arrow, Home and End keys.
 *
 * @param {KeyboardEvent} event - Key event of a tab button.
 * @returns {void}
 */
function handleTabKeydown(event) {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  event.preventDefault();
  const current = tabCards.getAttribute('aria-selected') === 'true' ? 0 : 1;
  const next = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? 1
      : (current + (event.key === 'ArrowRight' ? 1 : -1) + 2) % 2;
  activateTab(next === 0 ? 'cards' : 'analysis', true);
}

/* -------------------------------------------------------------------------- */
/* Events and bootstrap                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Locks the interface again. The loaded data stays in memory.
 *
 * @returns {void}
 */
function lockApp() {
  app.hidden = true;
  lock.hidden = false;
  lockInput.value = '';
  setFeedback(lockFeedback, null);
  lockInput.focus();
}

/**
 * Opens the browser and loads the set catalogues.
 *
 * @returns {Promise<void>} Resolves once the first source is rendered or an error is shown.
 */
async function unlockApp() {
  lock.hidden = true;
  app.hidden = false;
  setFeedback(catalogFeedback, null);

  try {
    const [configData, cardsetsData] = await Promise.all([
      fetchJson(CONFIG_PATH),
      fetchJson(CARDSETS_PATH),
    ]);
    config = {
      ...configData,
      sets: Array.isArray(cardsetsData?.sets) ? cardsetsData.sets : [],
    };
    if (config.sets.length === 0) {
      throw new Error('Aucun set déclaré dans settings/cardsets.json.');
    }
    await applySavedCardGenerate();
    try {
      defaultRarityTable = await fetchJson(
        projectFileUrl(config?.boosters?.rarityConfigPath, DEFAULT_RARITY_PATH),
      );
    } catch (error) {
      defaultRarityTable = null;
      console.warn('[Admin cards] Default rarity table unavailable.', error);
    }
    buildSourceSelect();
    buildRarityFilter();
    sourceStatus.textContent = 'Choisissez un booster ou une collection promo.';
    await loadSource();
  } catch (error) {
    console.error('[Admin cards] Catalogues load failed.', error);
    sourceStatus.textContent = 'Catalogues indisponibles.';
    setFeedback(catalogFeedback, error.message, 'error');
    sourceSelect.disabled = true;
    tableSummary.textContent = 'Aucune carte chargée.';
    setTablePlaceholder('Aucune carte à afficher.');
  }
}

lockForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const typed = lockInput.value;
  if (typed === '') {
    setFeedback(lockFeedback, 'Saisissez le mot de passe.', 'error');
    return;
  }
  if (typed === LOCAL_SKIP_PASSWORD && globalThis.location?.hostname === 'localhost') {
    lockInput.value = '';
    await unlockApp();
    return;
  }
  try {
    const digest = await sha256Hex(typed);
    if (!constantTimeEqual(digest, PASSWORD_HASH)) {
      setFeedback(lockFeedback, 'Mot de passe incorrect.', 'error');
      lockInput.value = '';
      return;
    }
  } catch (error) {
    setFeedback(lockFeedback, error.message, 'error');
    return;
  }
  lockInput.value = '';
  await unlockApp();
});

lockAgain.addEventListener('click', () => lockApp());

tabCards.addEventListener('click', () => activateTab('cards'));
tabAnalysis.addEventListener('click', () => activateTab('analysis'));
tabCards.addEventListener('keydown', handleTabKeydown);
tabAnalysis.addEventListener('keydown', handleTabKeydown);
rarityOptions.addEventListener('change', handleRarityChange);

sourceSelect.addEventListener('change', () => {
  void loadSource();
});

searchInput.addEventListener('input', () => {
  state.query = searchInput.value;
  state.page = 1;
  render();
});

rarityFilter.addEventListener('change', () => {
  state.rarity = rarityFilter.value;
  state.page = 1;
  render();
});

sortSelect.addEventListener('change', () => {
  state.sortKey = sortSelect.value;
  state.page = 1;
  render();
});

sortDirection.addEventListener('click', () => {
  state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
  const ascending = state.sortDir === 'asc';
  sortDirection.textContent = ascending ? 'Croissant ↑' : 'Décroissant ↓';
  sortDirection.setAttribute('aria-label', ascending ? 'Trier par ordre croissant' : 'Trier par ordre décroissant');
  state.page = 1;
  render();
});

pageSizeSelect.addEventListener('change', () => {
  state.pageSize = pageSizeSelect.value === PAGE_SIZE_ALL ? PAGE_SIZE_ALL : Number(pageSizeSelect.value);
  state.page = 1;
  render();
});

resetFilters.addEventListener('click', () => {
  state.query = '';
  state.rarity = 'all';
  state.sortKey = 'num';
  state.sortDir = 'asc';
  state.pageSize = 25;
  state.page = 1;
  searchInput.value = '';
  rarityFilter.value = 'all';
  sortSelect.value = 'num';
  pageSizeSelect.value = '25';
  sortDirection.textContent = 'Croissant ↑';
  sortDirection.setAttribute('aria-label', 'Trier par ordre croissant');
  render();
});

pageFirst.addEventListener('click', () => goToPage(1));
pagePrev.addEventListener('click', () => goToPage(state.page - 1));
pageNext.addEventListener('click', () => goToPage(state.page + 1));
pageLast.addEventListener('click', () => {
  const total = getFilteredCards().length;
  const pageSize = state.pageSize === PAGE_SIZE_ALL ? Math.max(total, 1) : state.pageSize;
  goToPage(Math.max(1, Math.ceil(total / pageSize)));
});

lightbox.addEventListener('click', (event) => {
  if (event.target === lightbox) lightbox.close();
});
