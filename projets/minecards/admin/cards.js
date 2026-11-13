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

/** SHA-256 (hex) of the admin password, identical to the other admin pages. */
const PASSWORD_HASH = '19768d6a62452099c450e0e7d1ba4be25597c2669dcab5fea88fe73ae74ca39e';

/** Catalogue of the declared sets (ids, release dates, promo flag). */
const CARDSETS_PATH = '../settings/cardsets.json';

/** Configuration holding the booster and promo directories. */
const CONFIG_PATH = '../settings/config.json';

/** Fallbacks used when `config.json` omits a directory. */
const DEFAULT_BOOSTER_DIRECTORY = 'data/boosters';
const DEFAULT_PROMO_DIRECTORY = 'data/promo_cards';

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

const lock = document.getElementById('lock');
const lockForm = document.getElementById('lock-form');
const lockInput = document.getElementById('lock-input');
const lockFeedback = document.getElementById('lock-feedback');
const app = document.getElementById('app');
const lockAgain = document.getElementById('lock-again');
const sourceStatus = document.getElementById('source-status');
const sourceSelect = document.getElementById('source-select');
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
const lightboxCaption = document.getElementById('lightbox-caption');

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
 * @param {object} card - Raw card declared in the JSON.
 * @param {number} index - Position in the source file, zero-based.
 * @returns {object} The view model used by the table.
 */
function normalizeCard(card, index) {
  const num = index + 1;
  const cardIndex = typeof card?.Index === 'string' && card.Index.trim() !== '' ? card.Index.trim() : '-';
  const nameFr = typeof card?.Name_FR === 'string' && card.Name_FR.trim() !== '' ? card.Name_FR.trim() : '';
  const nameEn = typeof card?.Name_EN === 'string' && card.Name_EN.trim() !== '' ? card.Name_EN.trim() : '';
  const parsedRarity = Number.parseInt(card?.Rarity, 10);
  const rarity = Number.isInteger(parsedRarity) ? parsedRarity : 0;
  const rarityLabel = RARITY_LABELS[rarity] ?? '-';
  const layout = typeof card?.Layout === 'string' ? card.Layout : '';
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
  state.cards = [];
  state.page = 1;
  sourceStatus.textContent = `Chargement de ${kindLabel.toLowerCase()} ${id}…`;
  tableTitle.textContent = kind === 'booster' ? `Cartes du booster ${id}` : `Cartes promo ${id}`;
  tableSummary.textContent = 'Chargement…';
  pagination.hidden = true;
  setTablePlaceholder('Chargement…');

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
    state.cards = rawCards.map(normalizeCard);
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
  } catch (error) {
    if (token !== loadToken) return;
    console.error('[Admin cards] Catalogue load failed.', error);
    state.cards = [];
    tableSummary.textContent = 'Aucune carte chargée.';
    pagination.hidden = true;
    setTablePlaceholder('Aucune carte à afficher.');
    setFeedback(catalogFeedback, error.message, 'error');
    sourceStatus.textContent = `${kindLabel} ${id} · chargement impossible`;
  } finally {
    if (token === loadToken) sourceSelect.disabled = false;
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
  cell.colSpan = 7;
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
  button.title = `Agrandir l’image ${language.toUpperCase()} de ${card.nameFr}`;
  button.setAttribute('aria-label', `Agrandir l’image ${language.toUpperCase()} de ${card.nameFr}`);

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
  );
  return row;
}

/**
 * Renders the current page of cards and updates the counters.
 *
 * @returns {void}
 */
function render() {
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
 * Opens the full-size preview of one card image.
 *
 * @param {object} card - Normalised card.
 * @param {'fr'|'en'} language - Image language.
 * @returns {void}
 */
function openLightbox(card, language) {
  const source = language === 'fr' ? card.frImage : card.enImage;
  if (source === '') return;
  lightboxImage.src = source;
  lightboxImage.alt = `Carte ${language.toUpperCase()} : ${card.nameFr}`;
  lightboxCaption.textContent = `${language.toUpperCase()} · ${card.nameFr} · ${card.index}`;
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
