/**
 * save-editor.js - Visual editor for a MineCards `.save` file (admin back-office).
 *
 * The `.save` container is the exact format of `js/classes/SaveFile.js`: a deflated JSON
 * payload encoded in Base64. This page imports the same compression helpers the game uses, so
 * an edited file re-imports in the game with no conversion step.
 *
 * DESIGN
 *   - The payload is kept in memory and edited in place. Nothing is written to IndexedDB and no
 *     game manager is booted: the editor only touches the four stores of the selected save.
 *   - The catalogues (extensions, promo cards, colours, icons, titles, mining, currencies, daily
 *     rewards, feature prices) are the shipped JSON files. Card codes, keys and purchase ids are
 *     therefore built with the same rules as the game instead of being retyped by hand.
 *   - Every visual control edits a real field; the "Avancé" tab is only a fallback for shapes that
 *     do not have a dedicated panel yet.
 *
 * ACCESS
 *   Same UI barrier as `admin/index.html`: only the SHA-256 digest of the password is stored.
 *   Like the code generator, this is not a server-side security boundary.
 */

import { compressJson, decompressJson } from '../js/utils/Compression.js';

/** SHA-256 (hex) of the admin password, identical to `admin/index.html`. */
const PASSWORD_HASH = '19768d6a62452099c450e0e7d1ba4be25597c2669dcab5fea88fe73ae74ca39e';

/** Root of the application, seen from the `admin/` directory. */
const APP_ROOT = '../';

/** Required stores of a save container (see `SaveFile.SAVE_STORES`). */
const STORE_NAMES = Object.freeze(['collection', 'user_state', 'redeemed_codes', 'gifts_received']);

/** `user_state` entries a save cannot omit (see `SaveFile.REQUIRED_USER_STATE_KEYS`). */
const REQUIRED_STATES = Object.freeze(['account', 'settings', 'quota', 'stats', 'giftSync']);

/** Rarity labels shown by the editor. */
const RARITY_LABELS = Object.freeze({
  1: 'Commune',
  2: 'Peu commune',
  3: 'Rare',
  4: 'Épique',
  5: 'Mythique',
});

/** Prefixes of the purchase ids, mirrored from `FeatureManager.js`. */
const PURCHASE_PREFIX = Object.freeze({
  TITLE_COLOR: 'cardTitleColor.',
  USERNAME_COLOR: 'usernameColor.',
  BORDER_COLOR: 'cardBorderColor.',
  ICON: 'profileIcon.',
  FAVORITE_SLOT: 'profileFavoriteSlot.',
  FEATURED_SLOT: 'profileFeaturedSlot.',
});

/** Number of slots of a binder (`BinderManager.BINDER_SLOT_COUNT`). */
const BINDER_SLOT_COUNT = 30;

/** @type {{cards: object[], cardsByKey: Map<string, object>, sets: object[], chapters: object[], colors: object[], icons: object[], titles: object[], currencies: object[], resources: object[], config: object|null}|null} */
let catalogs = null;

/** @type {{payload: object, fileName: string, dirty: boolean}|null} */
let loaded = null;

/** Card dialog mode: `add`, `favorite`, `binder-cover` or `binder-slot`. */
let pickerMode = 'add';

/** Binder selected in the Binders tab. */
let activeBinderId = null;

/** Slot being filled by the picker, or null while choosing a cover. */
let binderSlotIndex = null;

/** @type {number|undefined} */
let pickerSearchTimer;

/** @type {number|undefined} */
let toastTimer;

/* -------------------------------------------------------------------------- */
/* DOM helpers                                                                */
/* -------------------------------------------------------------------------- */

const byId = (id) => document.getElementById(id);

/**
 * Creates an element with attributes and children.
 *
 * @param {string} tag - Tag name.
 * @param {object} [attributes] - Properties, `dataset`, event handlers (`onclick`) or attributes.
 * @param {...(Node|string|null|undefined|false)} children - Children to append.
 * @returns {HTMLElement} The created element.
 */
function h(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(attributes ?? {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === false) return;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  });
  children.flat().forEach((child) => {
    if (child === null || child === undefined || child === false) return;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return node;
}

/**
 * Removes every child of an element.
 *
 * @param {HTMLElement} element - Target element.
 * @returns {void}
 */
function clear(element) {
  while (element.firstChild) element.removeChild(element.firstChild);
}

/**
 * Writes a message in a feedback paragraph.
 *
 * @param {HTMLElement|null} element - Target paragraph.
 * @param {string|null} text - Message, or null to hide it.
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
 * Shows a transient toast.
 *
 * @param {string} text - Message.
 * @param {'info'|'success'|'error'} [tone='info'] - Visual tone.
 * @returns {void}
 */
function toast(text, tone = 'info') {
  const element = byId('toast');
  if (!element) return;
  window.clearTimeout(toastTimer);
  element.textContent = text;
  element.dataset.tone = tone;
  element.hidden = false;
  toastTimer = window.setTimeout(() => {
    element.hidden = true;
  }, 2600);
}

/**
 * Computes the SHA-256 hex digest of a text.
 *
 * @param {string} text - Text to hash.
 * @returns {Promise<string>} Lowercase digest.
 * @throws {Error} When `crypto.subtle` is unavailable.
 */
async function sha256Hex(text) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('crypto.subtle est indisponible : servez la page en HTTPS ou sur localhost.');
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Compares two strings without an early exit.
 *
 * @param {string} left - First string.
 * @param {string} right - Second string.
 * @returns {boolean} True when identical.
 */
function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

/* -------------------------------------------------------------------------- */
/* Catalogue                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Fetches and parses one JSON file relative to the application root.
 *
 * @param {string} path - Path such as `settings/config.json`.
 * @returns {Promise<any>} Parsed payload.
 * @throws {Error} When the request fails or the payload is invalid JSON.
 */
async function fetchJson(path) {
  let response;
  try {
    response = await fetch(`${APP_ROOT}${path.replace(/^\.\//, '')}`, { cache: 'no-store' });
  } catch (error) {
    throw new Error(`Impossible de lire ${path} (réseau).`, { cause: error });
  }
  if (!response.ok) {
    throw new Error(`Impossible de lire ${path} (HTTP ${response.status}).`);
  }
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${path} n’est pas un JSON valide.`, { cause: error });
  }
}

/**
 * Resolves an asset path read from a catalogue for the `admin/` page.
 *
 * @param {string|null|undefined} value - Catalogue path.
 * @param {string} [fallback='assets/img/card_back.png'] - Used when the value is empty.
 * @returns {string} A URL usable by an `<img>`.
 */
function resolveAsset(value, fallback = 'assets/img/card_back.png') {
  const raw = typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
  const localized = raw.replaceAll('<lang>', 'fr');
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(localized)) return localized;
  return `${APP_ROOT}${localized.replace(/^\.\//, '')}`;
}

/**
 * Normalizes a card id from its illustration path, exactly like `Card.deriveIdFromPath`.
 *
 * @param {string} path - Illustration path.
 * @param {string} style - Card layout.
 * @param {string} index - Raw `Index`, used when the path is unusable.
 * @returns {string} Derived card id.
 */
function deriveCardId(path, style, index) {
  const fileName = String(path ?? '').split(/[\\/]/).pop() ?? '';
  const baseName = fileName.replace(/\.[a-z0-9]+$/i, '').trim();
  const suffix = `_${style}`;
  if (baseName.toLowerCase().endsWith(suffix)) {
    const id = baseName.slice(0, baseName.length - suffix.length).trim();
    if (id !== '') return id;
  }
  return String(index ?? '')
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(' _ ');
}

/**
 * Reads the card rows of a booster or promo file.
 *
 * @param {object} raw - Parsed catalogue file.
 * @returns {object[]} Raw card entries.
 */
function readCardRows(raw) {
  if (Array.isArray(raw?.Cards)) return raw.Cards;
  if (Array.isArray(raw?.cards)) return raw.cards;
  if (Array.isArray(raw?.Card)) return raw.Card;
  return [];
}

/**
 * Builds the catalogue card descriptor used by the editor.
 *
 * @param {object} entry - Raw card entry.
 * @param {string} setId - Displayed extension id.
 * @param {boolean} promo - Whether the card is a promo printing.
 * @returns {object|null} The descriptor, or null when the entry cannot be a collection key.
 */
function buildCatalogCard(entry, setId, promo) {
  if (!entry || typeof entry !== 'object') return null;
  const style = String(entry.Layout ?? entry.Style ?? '').trim().toLowerCase();
  if (style !== 'classic' && style !== 'fullart') return null;
  const path = typeof entry.Path === 'string' ? entry.Path : entry.illustration;
  if (typeof path !== 'string' || path.trim() === '') return null;
  const cardId = deriveCardId(path, style, entry.Index);
  if (cardId === '') return null;
  const rarity = Number(entry.Rarity);
  return {
    key: `${cardId}_${style}`,
    cardId,
    style,
    set: setId,
    promo,
    rarity: Number.isInteger(rarity) && rarity >= 1 && rarity <= 5 ? rarity : 1,
    name:
      (typeof entry.Name_FR === 'string' && entry.Name_FR) ||
      (typeof entry.Name_EN === 'string' && entry.Name_EN) ||
      cardId,
    nameEn: typeof entry.Name_EN === 'string' ? entry.Name_EN : '',
    index: typeof entry.Index === 'string' ? entry.Index : cardId,
    path,
  };
}

/**
 * Loads every catalogue the editor uses. A failing optional catalogue is skipped; the required
 * configuration and extension list make the page unusable when they fail.
 *
 * @returns {Promise<void>} Resolves once every available catalogue is loaded.
 */
async function loadCatalogs() {
  const config = await fetchJson('settings/config.json');
  const cardsets = await fetchJson('settings/cardsets.json');
  const sets = Array.isArray(cardsets?.sets) ? cardsets.sets : [];
  const cards = [];
  const displaySets = [];

  const boosterDirectory = String(config?.boosters?.directory ?? 'data/boosters').replace(/^\.\//, '');
  for (const entry of sets) {
    const setId = typeof entry?.id === 'string' ? entry.id.trim() : '';
    if (setId === '') continue;
    const raw = await fetchJson(`${boosterDirectory}/${setId}.json`);
    displaySets.push({
      id: setId,
      name: typeof raw?.Name === 'string' && raw.Name !== '' ? raw.Name : setId,
      promo: false,
    });
    readCardRows(raw).forEach((row) => {
      const card = buildCatalogCard(row, setId, false);
      if (card) cards.push(card);
    });

    if (entry?.promo !== true) continue;
    const promoDirectory = String(config?.promos?.directory ?? 'data/promo_cards').replace(/^\.\//, '');
    try {
      const promoRaw = await fetchJson(`${promoDirectory}/${setId}.json`);
      const promoSets = `${setId}-Promo`;
      displaySets.push({
        id: promoSets,
        name: typeof promoRaw?.Name === 'string' && promoRaw.Name !== '' ? promoRaw.Name : promoSets,
        promo: true,
      });
      readCardRows(promoRaw).forEach((row) => {
        const card = buildCatalogCard(row, promoSets, true);
        if (card) cards.push(card);
      });
    } catch (error) {
      console.info(`[SaveEditor] Pas de cartes promo pour ${setId}.`, error);
    }
  }

  const cardsByKey = new Map();
  cards.forEach((card) => {
    if (!cardsByKey.has(card.key)) cardsByKey.set(card.key, card);
  });

  const icons = [];
  try {
    const defaultIcons = await fetchJson(
      String(config?.profileIcons?.defaultPath ?? 'settings/default_profile_icons.json')
    );
    const unlockableIcons = await fetchJson(
      String(config?.profileIcons?.unlockablePath ?? 'data/icon.json')
    );
    [...(Array.isArray(defaultIcons) ? defaultIcons : []), ...(Array.isArray(unlockableIcons) ? unlockableIcons : [])]
      .forEach((entry) => {
        if (!entry || typeof entry.file !== 'string' || entry.file.trim() === '') return;
        const file = entry.file.trim().replace(/^\.\//, '');
        if (icons.some((icon) => icon.file === file)) return;
        icons.push({
          file,
          name: typeof entry.name === 'string' ? entry.name : file,
          price: Number.isInteger(entry.price) && entry.price > 0 ? entry.price : 0,
          requiredLevel: Number.isInteger(entry.requiredLevel) ? entry.requiredLevel : 0,
        });
      });
  } catch (error) {
    console.warn('[SaveEditor] Catalogue d’avatars incomplet.', error);
  }

  const titles = [];
  try {
    const defaults = await fetchJson(String(config?.titles?.defaultPath ?? 'settings/default_titles.json'));
    (Array.isArray(defaults) ? defaults : []).forEach((entry) => {
      if (!entry || typeof entry.id !== 'string') return;
      titles.push({
        id: entry.id,
        name: entry.text?.fr || entry.text?.en || entry.id,
        requiredLevel: Number.isInteger(entry.requiredLevel) ? entry.requiredLevel : 0,
      });
    });
    const directory = String(config?.titles?.directory ?? 'data/titles').replace(/^\.\//, '');
    for (const set of displaySets.filter((entry) => !entry.promo)) {
      try {
        const raw = await fetchJson(`${directory}/${set.id}.json`);
        (Array.isArray(raw?.CollectionTitle) ? raw.CollectionTitle : []).forEach((group) => {
          (Array.isArray(group?.UnlockedTitle) ? group.UnlockedTitle : []).forEach((entry) => {
            if (!entry || typeof entry.id !== 'string') return;
            titles.push({
              id: entry.id,
              name: entry.text?.fr || entry.text?.en || entry.id,
              requiredLevel: 0,
            });
          });
        });
      } catch {
        // A set may legitimately unlock no title.
      }
    }
  } catch (error) {
    console.warn('[SaveEditor] Catalogue de titres incomplet.', error);
  }

  const colors = [];
  try {
    const raw = await fetchJson('settings/colors.json');
    (Array.isArray(raw?.colors) ? raw.colors : []).forEach((entry) => {
      if (!entry || typeof entry.id !== 'string') return;
      colors.push({
        id: entry.id,
        name: entry.name?.fr || entry.name?.en || entry.id,
        hex: entry.hex,
        direction: Number.isFinite(entry.direction) ? entry.direction : 90,
        titlePrice: entry.titlePrice,
        usernamePrice: entry.usernamePrice,
        borderPrice: entry.borderPrice,
      });
    });
  } catch (error) {
    console.warn('[SaveEditor] Catalogue de couleurs incomplet.', error);
  }

  const currencies = [];
  try {
    const raw = await fetchJson('data/illager_shop/illager_currencies.json');
    (Array.isArray(raw) ? raw : []).forEach((entry) => {
      if (!entry || typeof entry.ID !== 'string') return;
      currencies.push({
        id: entry.ID,
        name: typeof entry.Name === 'string' ? entry.Name : entry.ID,
        texture: entry.Texture,
      });
    });
  } catch (error) {
    console.warn('[SaveEditor] Catalogue de monnaies incomplet.', error);
  }

  const resources = [];
  try {
    const raw = await fetchJson(String(config?.mining?.configPath ?? 'settings/mining.json'));
    (Array.isArray(raw?.Blocks) ? raw.Blocks : []).forEach((block) => {
      (Array.isArray(block?.Rewards) ? block.Rewards : []).forEach((reward) => {
        const type = typeof reward?.Type === 'string' ? reward.Type.trim() : '';
        if (type === '' || type.toLowerCase() === 'sparks') return;
        const slug = type
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '');
        if (resources.some((resource) => resource.slug === slug)) return;
        resources.push({ slug, name: type });
      });
    });
  } catch (error) {
    console.warn('[SaveEditor] Catalogue de ressources incomplet.', error);
  }

  const chapters = [];
  try {
    const raw = await fetchJson('settings/daily_connect_rewards.json');
    (Array.isArray(raw) ? raw : []).forEach((entry) => {
      if (!entry || typeof entry.ID !== 'string') return;
      chapters.push({
        id: entry.ID,
        name: entry.RewardListName || entry.ID,
        totalDays: Array.isArray(entry.Days) ? entry.Days.length : 0,
      });
    });
  } catch (error) {
    console.warn('[SaveEditor] Chapitres de connexion illisibles.', error);
  }

  // The shipped extension files can declare the same key twice (a card pair sharing one
  // illustration): the editor shows one entry per collection key, exactly like the game.
  const uniqueCards = [...cardsByKey.values()];

  catalogs = {
    cards: uniqueCards,
    cardsByKey,
    sets: displaySets,
    chapters,
    colors,
    icons,
    titles,
    currencies,
    resources,
    config,
  };

  populateSetSelect(byId('collection-set'), true);
  populateSetSelect(byId('picker-set'), true);
}

/**
 * Fills a set filter with the catalogue sets and the sets found in the loaded save.
 *
 * @param {HTMLSelectElement|null} select - Target select.
 * @param {boolean} [includeEmpty=false] - Add the "Toutes" option.
 * @returns {void}
 */
function populateSetSelect(select, includeEmpty = false) {
  if (!select) return;
  const current = select.value;
  clear(select);
  if (includeEmpty) select.append(h('option', { value: '' }, 'Toutes'));
  const sets = new Map((catalogs?.sets ?? []).map((set) => [set.id, set]));
  (loaded?.payload?.stores?.collection ?? []).forEach((row) => {
    if (typeof row?.set === 'string' && row.set !== '' && !sets.has(row.set)) {
      sets.set(row.set, { id: row.set, name: row.set, promo: false });
    }
  });
  [...sets.values()]
    .sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }))
    .forEach((set) => {
      select.append(h('option', { value: set.id }, `${set.promo ? 'Promo · ' : ''}${set.name} (${set.id})`));
    });
  if ([...select.options].some((option) => option.value === current)) select.value = current;
}

/* -------------------------------------------------------------------------- */
/* Payload validation                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Validates the shape of a decoded save before the editor touches it.
 *
 * @param {unknown} payload - Decoded value.
 * @returns {object} The same payload.
 * @throws {Error} When the file is not a supported MineCards save.
 */
function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Le fichier ne contient pas un objet de sauvegarde.');
  }
  if (payload.version !== 1) {
    throw new Error(`Version de sauvegarde non prise en charge (${payload.version}).`);
  }
  if (!payload.stores || typeof payload.stores !== 'object' || Array.isArray(payload.stores)) {
    throw new Error('La sauvegarde ne contient pas son objet « stores ».');
  }
  STORE_NAMES.forEach((storeName) => {
    if (payload.stores[storeName] === undefined || payload.stores[storeName] === null) {
      throw new Error(`Le store « ${storeName} » est absent.`);
    }
  });
  if (!Array.isArray(payload.stores.collection)) {
    throw new Error('Le store « collection » doit être une liste.');
  }
  if (!Array.isArray(payload.stores.redeemed_codes) || !Array.isArray(payload.stores.gifts_received)) {
    throw new Error('Les stores « redeemed_codes » et « gifts_received » doivent être des listes.');
  }
  const state = payload.stores.user_state;
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('Le store « user_state » doit être un objet.');
  }
  REQUIRED_STATES.forEach((key) => {
    if (!state[key] || typeof state[key] !== 'object' || Array.isArray(state[key])) {
      throw new Error(`L’état « ${key} » est absent ou invalide.`);
    }
  });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(state.account.uuid ?? '')) {
    throw new Error('L’UUID du compte est absent ou invalide.');
  }
  payload.stores.collection.forEach((entry, index) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof entry.key !== 'string' ||
      entry.key.trim() === '' ||
      !Number.isInteger(entry.quantity) ||
      entry.quantity < 1
    ) {
      throw new Error(`La carte n°${index + 1} de la collection est invalide.`);
    }
  });
  return payload;
}

/* -------------------------------------------------------------------------- */
/* Save state access                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Reads the `user_state` object of the loaded save.
 *
 * @returns {object|null} The state, or null when no save is loaded.
 */
function userState() {
  return loaded?.payload?.stores?.user_state ?? null;
}

/**
 * Returns one `user_state` entry as a writable object, creating it when missing.
 *
 * @param {string} key - State key (`profile`, `stats`, `mining`…).
 * @returns {object} The writable state entry.
 */
function ensureState(key) {
  const state = userState();
  if (!state) return {};
  if (!state[key] || typeof state[key] !== 'object' || Array.isArray(state[key])) state[key] = {};
  return state[key];
}

/**
 * Reads the collection array of the loaded save.
 *
 * @returns {object[]} The collection records.
 */
function collectionRows() {
  return loaded?.payload?.stores?.collection ?? [];
}

/**
 * Finds one collection record by key.
 *
 * @param {string} key - Card key (`<cardId>_<style>`).
 * @returns {object|null} The record, or null.
 */
function findCollectionRow(key) {
  return collectionRows().find((row) => row?.key === key) ?? null;
}

/**
 * Marks the save as edited and refreshes the visible counters.
 *
 * @returns {void}
 */
function markDirty() {
  if (!loaded) return;
  loaded.dirty = true;
  renderSummary();
  const metadata = byId('summary-metadata');
  if (metadata) metadata.textContent = `${loaded.fileName} · modifications non téléchargées`;
}

/**
 * Formats a number for the French UI.
 *
 * @param {number} value - Number to format.
 * @returns {string} Localized number.
 */
function number(value) {
  return new Intl.NumberFormat('fr-FR').format(Number.isFinite(value) ? value : 0);
}

/**
 * Formats a timestamp.
 *
 * @param {string|null|undefined} value - ISO timestamp.
 * @returns {string} Localized date, or a placeholder.
 */
function formatDate(value) {
  if (typeof value !== 'string' || value === '') return 'Non renseignée';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('fr-FR');
}

/**
 * Normalizes a text for search.
 *
 * @param {unknown} value - Text to normalize.
 * @returns {string} Accent-free lowercase text.
 */
function normalizeSearch(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Returns the display name of an extension id found in a save.
 *
 * @param {string} setId - Extension id.
 * @returns {string} Display name.
 */
function setLabel(setId) {
  const set = (catalogs?.sets ?? []).find((entry) => entry.id === setId);
  return set ? `${set.name} (${set.id})` : String(setId ?? 'Inconnue');
}

/**
 * Builds an image with a graceful fallback.
 *
 * @param {string|null|undefined} source - Image path.
 * @param {string} alt - Alternative text.
 * @param {string} [className=''] - CSS class.
 * @param {string} [fallback='assets/img/card_back.png'] - Used when the source is missing.
 * @returns {HTMLImageElement} The image.
 */
function image(source, alt, className = '', fallback = 'assets/img/card_back.png') {
  const element = h('img', {
    src: resolveAsset(source, fallback),
    alt,
    loading: 'lazy',
    decoding: 'async',
    class: className,
  });
  element.addEventListener('error', () => {
    element.classList.add('is-missing');
  });
  return element;
}

/* -------------------------------------------------------------------------- */
/* Reusable fields                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Builds a labelled text/select/date control.
 *
 * @param {string} label - Visible label.
 * @param {HTMLElement} control - Control.
 * @param {string} [help=''] - Optional help line.
 * @returns {HTMLElement} The field wrapper.
 */
function field(label, control, help = '') {
  const wrapper = h('label', { class: 'field' }, h('span', { class: 'field__label' }, label), control);
  if (help) wrapper.append(h('span', { class: 'field__help' }, help));
  return wrapper;
}

/**
 * Builds a numeric field with minus/plus buttons. Every change is written immediately.
 *
 * @param {string} label - Visible label.
 * @param {number} value - Initial value.
 * @param {(value: number) => void} onChange - Applied when the value changes.
 * @param {object} [options] - Bounds and display options.
 * @param {number} [options.min=0] - Minimum.
 * @param {number} [options.max=Number.MAX_SAFE_INTEGER] - Maximum.
 * @param {number} [options.step=1] - Increment.
 * @param {string} [options.help=''] - Optional help line.
 * @returns {HTMLElement} The field.
 */
function numberField(label, value, onChange, { min = 0, max = Number.MAX_SAFE_INTEGER, step = 1, help = '' } = {}) {
  let current = Number.isFinite(value) ? value : min;
  const input = h('input', {
    class: 'stepper__input',
    type: 'number',
    min,
    max,
    step,
    value: String(current),
    inputmode: 'numeric',
    'aria-label': label,
  });

  /**
   * Applies a new value, clamped to the field bounds.
   *
   * @param {number} next - Candidate value.
   * @param {boolean} [writeInput=false] - Update the input text too.
   * @returns {void}
   */
  const apply = (next, writeInput = false) => {
    const parsed = Number(next);
    current = Math.min(max, Math.max(min, Number.isFinite(parsed) ? Math.floor(parsed) : min));
    if (writeInput) input.value = String(current);
    onChange(current);
    markDirty();
  };

  const decrement = h('button', {
    type: 'button',
    class: 'stepper__button',
    'aria-label': `Diminuer ${label}`,
    onclick: () => apply(current - step, true),
  }, '−');
  const increment = h('button', {
    type: 'button',
    class: 'stepper__button',
    'aria-label': `Augmenter ${label}`,
    onclick: () => apply(current + step, true),
  }, '+');

  input.addEventListener('change', () => apply(input.value, true));
  input.addEventListener('input', () => {
    if (input.value === '') return;
    const parsed = Number(input.value);
    if (Number.isFinite(parsed) && parsed >= min && parsed <= max) apply(parsed);
  });

  return field(label, h('div', { class: 'stepper' }, decrement, input, increment), help);
}

/**
 * Builds a plain text/date input that writes on change.
 *
 * @param {string} label - Visible label.
 * @param {string} value - Initial value.
 * @param {(value: string) => void} onChange - Applied on change.
 * @param {object} [options] - Input options.
 * @param {'text'|'date'|'url'} [options.type='text'] - Input type.
 * @param {string} [options.placeholder=''] - Placeholder.
 * @param {string} [options.help=''] - Optional help line.
 * @returns {HTMLElement} The field.
 */
function textField(label, value, onChange, { type = 'text', placeholder = '', help = '' } = {}) {
  const input = h('input', {
    class: 'field__input',
    type,
    value: String(value ?? ''),
    placeholder,
    autocomplete: 'off',
    spellcheck: 'false',
  });
  input.addEventListener('change', () => {
    onChange(input.value);
    markDirty();
  });
  return field(label, input, help);
}

/**
 * Builds a select from options.
 *
 * @param {string} label - Visible label.
 * @param {Array<{value: string, label: string}>} options - Options.
 * @param {string} value - Selected value.
 * @param {(value: string) => void} onChange - Applied on change.
 * @param {string} [help=''] - Optional help line.
 * @returns {HTMLElement} The field.
 */
function selectField(label, options, value, onChange, help = '') {
  const select = h('select', { class: 'field__select' });
  options.forEach((entry) => select.append(h('option', { value: entry.value }, entry.label)));
  if (options.some((entry) => entry.value === value)) select.value = value;
  else if (options.length > 0) select.value = options[0].value;
  select.addEventListener('change', () => {
    onChange(select.value);
    markDirty();
  });
  return field(label, select, help);
}

/**
 * Builds a titled block.
 *
 * @param {string} title - Block title.
 * @param {...(Node|string|null)} children - Block body.
 * @returns {HTMLElement} The block.
 */
function section(title, ...children) {
  return h('section', { class: 'section-block' }, h('h3', { class: 'section-block__title' }, title), ...children);
}

/* -------------------------------------------------------------------------- */
/* Summary and tabs                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Refreshes the summary counters and metadata.
 *
 * @returns {void}
 */
function renderSummary() {
  if (!loaded) return;
  const rows = collectionRows();
  const state = userState();
  const copies = rows.reduce((sum, row) => sum + (Number.isInteger(row.quantity) ? row.quantity : 0), 0);
  const sparks = Number(state?.sparks);
  const trophies = state?.trophies?.unlocked && typeof state.trophies.unlocked === 'object'
    ? Object.keys(state.trophies.unlocked).length
    : 0;
  const uuid = byId('summary-uuid');
  const metadata = byId('summary-metadata');
  if (uuid) uuid.textContent = state?.account?.uuid ?? 'Non renseigné';
  if (metadata) {
    metadata.textContent = `${loaded.fileName} · exporté le ${formatDate(loaded.payload.exportedAt)}`;
  }
  if (byId('summary-cards')) byId('summary-cards').textContent = number(rows.length);
  if (byId('summary-copies')) byId('summary-copies').textContent = number(copies);
  if (byId('summary-sparks')) byId('summary-sparks').textContent = number(Number.isFinite(sparks) ? sparks : 0);
  if (byId('summary-trophies')) byId('summary-trophies').textContent = number(trophies);
}

/**
 * Shows one editor tab and renders its panel.
 *
 * @param {string} name - Tab name.
 * @returns {void}
 */
function activateTab(name) {
  if (name !== 'binders') {
    pickerMode = pickerMode.startsWith('binder-') ? 'add' : pickerMode;
    binderSlotIndex = null;
  }
  document.querySelectorAll('.editor-tab').forEach((button) => {
    const active = button.dataset.tab === name;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.panel').forEach((panel) => {
    panel.hidden = panel.dataset.panel !== name;
  });
  if (name === 'overview') renderOverview();
  else if (name === 'cards') renderCollection();
  else if (name === 'profile') renderProfile();
  else if (name === 'binders') renderBinders();
  else if (name === 'progress') renderProgress();
  else if (name === 'purchases') renderPurchases();
  else if (name === 'advanced') renderAdvanced();
}

/* -------------------------------------------------------------------------- */
/* Overview                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Builds a small metric tile.
 *
 * @param {string} label - Caption.
 * @param {number} value - Value.
 * @param {string} [iconPath='assets/img/sparks.png'] - Icon.
 * @returns {HTMLElement} The tile.
 */
function metricTile(label, value, iconPath = 'assets/img/sparks.png') {
  return h('div', { class: 'tile' },
    h('span', { class: 'tile__label' }, image(iconPath, '', 'tile__icon'), label),
    h('strong', { class: 'tile__value' }, number(value))
  );
}

/**
 * Renders the overview panel.
 *
 * @returns {void}
 */
function renderOverview() {
  const root = byId('overview-content');
  if (!root || !loaded) return;
  const state = userState();
  const stats = ensureState('stats');
  const quota = ensureState('quota');
  const profile = ensureState('profile');
  const minePick = ensureState('minePick');
  const mining = ensureState('mining');
  const daily = ensureState('dailyRewards');
  const rows = collectionRows();
  const sparks = Number.isFinite(Number(state.sparks)) ? Number(state.sparks) : 0;

  clear(root);
  root.append(
    section('Identité et profil', h('div', { class: 'profile-preview' },
      image(profile.icon || profile.photo, profile.name || 'Profil', 'profile-preview__avatar'),
      h('div', null,
        h('div', { class: 'profile-preview__name' }, profile.name || 'Sans pseudo'),
        h('div', { class: 'profile-preview__title' }, state.account?.uuid ?? 'Non renseigné')
      )
    ))
  );

  root.append(section('Ressources', h('div', { class: 'tile-grid' },
    metricTile('Sparks', sparks),
    metricTile('Boosters restants', Number(quota.dailyRemaining) || 0, 'assets/img/booster.png'),
    metricTile('Picks restants', Number(minePick.remaining) || 0, 'assets/img/minepick.png'),
    metricTile('Blocs minés', Number(mining.totalMined) || 0, 'assets/img/blocks/stone.webp'),
    metricTile('Cartes distinctes', rows.length, 'assets/img/card_back.png'),
    metricTile('Classeurs', binderRows().length, 'assets/img/card_back.png'),
    metricTile('Connexions', Number(stats.daysConnected) || 0, 'assets/img/daily_boosters.png')
  )));

  root.append(section('Réglages rapides', h('div', { class: 'field-grid' },
    numberField('Sparks', sparks, (value) => {
      userState().sparks = value;
    }, { max: 999999999 }),
    numberField('Boosters journaliers restants', Number(quota.dailyRemaining) || 0, (value) => {
      ensureState('quota').dailyRemaining = value;
    }),
    numberField('Picks journaliers restants', Number(minePick.remaining) || 0, (value) => {
      ensureState('minePick').remaining = value;
    }),
    numberField('Jours de connexion', Number(stats.daysConnected) || 0, (value) => {
      ensureState('stats').daysConnected = value;
    }),
    numberField('Quêtes terminées', Number(stats.questsCompleted) || 0, (value) => {
      ensureState('stats').questsCompleted = value;
    }),
    numberField('Cartes vendues', Number(stats.cardsSold) || 0, (value) => {
      ensureState('stats').cardsSold = value;
    }),
    numberField('Récompenses de connexion réclamées', Number(daily.progress) || 0, (value) => {
      ensureState('dailyRewards').progress = value;
    }, { help: 'Position dans le chapitre courant.' })
  )));
}

/* -------------------------------------------------------------------------- */
/* Collection                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Returns the display descriptor of one collection row.
 *
 * @param {object} row - Collection record.
 * @returns {object} Descriptor usable by the card row renderer.
 */
function collectionCard(row) {
  const known = catalogs?.cardsByKey.get(row.key);
  if (known) return known;
  return {
    key: row.key,
    cardId: row.cardId || row.key,
    style: row.style || '',
    set: row.set || '',
    promo: false,
    rarity: 0,
    name: row.cardId || row.key,
    index: row.cardId || row.key,
    path: 'assets/img/card_back.png',
  };
}

/**
 * Checks whether a collection row matches the current filters.
 *
 * @param {object} row - Collection record.
 * @param {object} card - Display card.
 * @returns {boolean} True when visible.
 */
function collectionMatches(row, card) {
  const search = normalizeSearch(byId('collection-search')?.value);
  const setId = byId('collection-set')?.value ?? '';
  const rarity = byId('collection-rarity')?.value ?? '';
  if (setId && row.set !== setId && card.set !== setId) return false;
  if (rarity && String(card.rarity) !== rarity) return false;
  if (search) {
    const haystack = normalizeSearch(`${card.name} ${card.nameEn} ${card.index} ${card.cardId} ${row.set}`);
    if (!haystack.includes(search)) return false;
  }
  return true;
}

/**
 * Renders the collection grid.
 *
 * @returns {void}
 */
function renderCollection() {
  const grid = byId('collection-grid');
  const empty = byId('collection-empty');
  const count = byId('collection-count');
  if (!grid || !loaded) return;

  const rows = collectionRows();
  const visible = rows
    .map((row) => ({ row, card: collectionCard(row) }))
    .filter(({ row, card }) => collectionMatches(row, card))
    .sort((left, right) => {
      const setCompare = String(left.card.set).localeCompare(String(right.card.set), undefined, { numeric: true });
      if (setCompare !== 0) return setCompare;
      return String(left.card.index).localeCompare(String(right.card.index), undefined, { numeric: true });
    });

  if (count) {
    const totalCopies = rows.reduce((sum, row) => sum + (Number.isInteger(row.quantity) ? row.quantity : 0), 0);
    count.textContent = `${number(rows.length)} carte(s) distincte(s) · ${number(totalCopies)} exemplaire(s) · ${number(visible.length)} affichée(s)`;
  }

  clear(grid);
  const fragment = document.createDocumentFragment();
  visible.forEach(({ row, card }) => fragment.append(buildCollectionRow(row, card)));
  grid.append(fragment);
  if (empty) empty.hidden = visible.length > 0;
}

/**
 * Builds one editable card row.
 *
 * @param {object} row - Collection record.
 * @param {object} card - Display card.
 * @returns {HTMLElement} The row.
 */
function buildCollectionRow(row, card) {
  const quantityInput = h('input', {
    type: 'number',
    min: 1,
    max: 65535,
    value: String(row.quantity),
    'aria-label': `Exemplaires de ${card.name}`,
  });

  /**
   * Applies the number typed in the row.
   *
   * @param {number} next - Candidate quantity.
   * @returns {void}
   */
  const apply = (next) => {
    row.quantity = Math.min(65535, Math.max(1, Math.floor(Number(next) || 1)));
    quantityInput.value = String(row.quantity);
    markDirty();
    renderSummary();
  };

  quantityInput.addEventListener('change', () => apply(quantityInput.value));
  quantityInput.addEventListener('input', () => {
    if (quantityInput.value !== '') apply(quantityInput.value);
  });

  return h('article', { class: 'card-row' },
    h('div', { class: 'card-row__media' }, image(card.path, card.name)),
    h('div', { class: 'card-row__body' },
      h('span', { class: 'card-row__name', title: card.name }, card.name),
      h('span', { class: 'card-row__meta' },
        h('span', { class: 'rarity', dataset: { rarity: String(card.rarity) } },
          RARITY_LABELS[card.rarity] ?? 'Inconnue'),
        ` · ${setLabel(card.set)}`
      ),
      h('span', { class: 'card-row__code', title: card.index }, card.index),
      h('div', { class: 'card-row__footer' },
        h('div', { class: 'card-row__quantity' },
          h('button', {
            type: 'button',
            'aria-label': `Retirer un exemplaire de ${card.name}`,
            onclick: () => apply(row.quantity - 1),
          }, '−'),
          quantityInput,
          h('button', {
            type: 'button',
            'aria-label': `Ajouter un exemplaire de ${card.name}`,
            onclick: () => apply(row.quantity + 1),
          }, '+')
        ),
        h('button', {
          type: 'button',
          class: 'icon-button',
          title: 'Supprimer cette carte de la collection',
          'aria-label': `Supprimer ${card.name}`,
          onclick: () => removeCollectionRow(row, card),
        }, '✕')
      )
    )
  );
}

/**
 * Removes one owned card from the save.
 *
 * @param {object} row - Collection record.
 * @param {object} card - Display card.
 * @returns {void}
 */
function removeCollectionRow(row, card) {
  if (!window.confirm(`Supprimer ${card.name} de la collection ?`)) return;
  const rows = collectionRows();
  const index = rows.indexOf(row);
  if (index >= 0) rows.splice(index, 1);
  markDirty();
  renderCollection();
  renderSummary();
  toast(`${card.name} supprimée de la collection.`, 'success');
}

/**
 * Adds one copy of a catalogue card to the collection.
 *
 * @param {object} card - Catalogue card.
 * @returns {void}
 */
function addCatalogCard(card) {
  const existing = findCollectionRow(card.key);
  if (existing) {
    existing.quantity = Math.min(65535, existing.quantity + 1);
    existing.lastObtainedAt = new Date().toISOString();
  } else {
    const now = new Date().toISOString();
    collectionRows().push({
      key: card.key,
      cardId: card.cardId,
      style: card.style,
      set: card.set,
      quantity: 1,
      firstObtainedAt: now,
      lastObtainedAt: now,
    });
  }
  markDirty();
  renderCollection();
  renderSummary();
  if (byId('card-picker')?.open) renderPicker();
  toast(`${card.name} ajoutée à la collection.`, 'success');
}

/* -------------------------------------------------------------------------- */
/* Card picker                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Opens the card picker in one mode.
 *
 * @param {'add'|'favorite'} mode - Purpose of the selection.
 * @returns {void}
 */
function openCardPicker(mode = 'add') {
  pickerMode = mode;
  const dialog = byId('card-picker');
  if (!dialog) return;
  const titles = {
    add: ['Ajouter une carte', 'Choisissez une carte du catalogue. Cliquer augmente la quantité.'],
    favorite: ['Ajouter un favori', 'Choisissez une carte déjà possédée.'],
    'binder-cover': ['Choisir la couverture', 'Choisissez une carte possédée : son illustration habillera le classeur.'],
    'binder-slot': ['Placer une carte', 'Seules les cartes possédées sont proposées, dans la limite des exemplaires disponibles.'],
  };
  const [title, subtitle] = titles[mode] ?? titles.add;
  if (byId('picker-title')) byId('picker-title').textContent = title;
  if (byId('picker-subtitle')) byId('picker-subtitle').textContent = subtitle;
  if (byId('picker-search')) byId('picker-search').value = '';
  if (byId('picker-set')) byId('picker-set').value = '';
  renderPicker();
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

/**
 * Closes the card picker.
 *
 * @returns {void}
 */
function closeCardPicker() {
  const dialog = byId('card-picker');
  if (!dialog) return;
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

/**
 * Filters the picker source with its search and set controls.
 *
 * @returns {object[]} Matching catalogue cards.
 */
function pickerSource() {
  const search = normalizeSearch(byId('picker-search')?.value);
  const setId = byId('picker-set')?.value ?? '';
  const ownedKeys = new Set(collectionRows().map((row) => row.key));
  const favorites = new Set(Array.isArray(ensureState('profile').favorites) ? ensureState('profile').favorites : []);
  const binder = activeBinder();
  const binderMode = pickerMode === 'binder-cover' || pickerMode === 'binder-slot';
  return (catalogs?.cards ?? [])
    .filter((card) => {
      if (binderMode && !ownedKeys.has(card.key)) return false;
      if (pickerMode === 'favorite' && (!ownedKeys.has(card.key) || favorites.has(card.key))) return false;
      if (pickerMode === 'binder-slot' && binder) {
        const current = binder.slots[binderSlotIndex];
        if (binderPlacements(binder, card.key, binderSlotIndex) >= ownedQuantity(card.key)) return false;
        if (current === card.key && ownedQuantity(card.key) === 0) return false;
      }
      if (setId && card.set !== setId) return false;
      if (!search) return true;
      return normalizeSearch(`${card.name} ${card.nameEn} ${card.index} ${card.cardId}`).includes(search);
    })
    .sort((left, right) => {
      if (left.set !== right.set) return left.set.localeCompare(right.set, undefined, { numeric: true });
      return left.index.localeCompare(right.index, undefined, { numeric: true });
    });
}

/**
 * Renders the card picker results.
 *
 * @returns {void}
 */
function renderPicker() {
  const grid = byId('picker-grid');
  if (!grid) return;
  const results = pickerSource();
  const limited = results.slice(0, 240);
  if (byId('picker-count')) {
    byId('picker-count').textContent = results.length > limited.length
      ? `${number(results.length)} résultats · les 240 premiers sont affichés, affinez la recherche.`
      : `${number(results.length)} résultat(s).`;
  }
  clear(grid);
  const fragment = document.createDocumentFragment();
  limited.forEach((card) => {
    const row = findCollectionRow(card.key);
    const binderMode = pickerMode === 'binder-cover' || pickerMode === 'binder-slot';
    const handler = pickerMode === 'favorite'
      ? () => addFavorite(card.key)
      : binderMode
        ? () => assignBinderCard(card.key)
        : () => addCatalogCard(card);
    fragment.append(h('button', { type: 'button', class: 'picker-card', onclick: handler },
      image(card.path, card.name),
      h('span', { class: 'picker-card__body' },
        h('span', { class: 'picker-card__name', title: card.name }, card.name),
        h('span', { class: 'picker-card__meta' },
          `${RARITY_LABELS[card.rarity] ?? 'Inconnue'} · ${setLabel(card.set)}${row ? ` · ×${row.quantity}` : ''}`
        ),
        h('span', { class: 'picker-card__meta' }, card.index)
      ),
      h('span', { class: 'picker-card__plus', 'aria-hidden': 'true' }, '+')
    ));
  });
  grid.append(fragment);
}

/* -------------------------------------------------------------------------- */
/* Binders                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Reads and repairs the binders carried by the loaded save.
 *
 * The shape is the one `BinderManager.normalizeBinder()` expects: id, name, cover, createdAt and
 * exactly 30 slots. Repairs happen in memory and only reach the file when the operator edits it.
 *
 * @returns {object[]} The usable binders.
 */
function binderRows() {
  const state = userState();
  if (!state) return [];
  if (!Array.isArray(state.binders)) state.binders = [];
  return state.binders
    .filter((binder) => binder && typeof binder === 'object' && !Array.isArray(binder))
    .map((binder) => {
      if (typeof binder.id !== 'string' || binder.id === '') {
        binder.id = crypto.randomUUID();
      }
      if (typeof binder.name !== 'string') binder.name = '';
      if (typeof binder.createdAt !== 'string') binder.createdAt = new Date().toISOString();
      if (binder.cover !== null && typeof binder.cover !== 'string') binder.cover = null;
      const slots = new Array(BINDER_SLOT_COUNT).fill(null);
      (Array.isArray(binder.slots) ? binder.slots : []).forEach((key, index) => {
        if (index >= BINDER_SLOT_COUNT) return;
        slots[index] = typeof key === 'string' && key !== '' ? key : null;
      });
      binder.slots = slots;
      return binder;
    });
}

/**
 * Returns the binder currently being edited.
 *
 * @returns {object|null} The binder, or null.
 */
function activeBinder() {
  return binderRows().find((binder) => binder.id === activeBinderId) ?? null;
}

/**
 * Counts how many times one card is placed in a binder.
 *
 * @param {object} binder - Binder being edited.
 * @param {string} key - Collection key.
 * @param {number|null} [ignoredSlot=null] - Slot excluded from the count (the one being replaced).
 * @returns {number} The placement count.
 */
function binderPlacements(binder, key, ignoredSlot = null) {
  return binder.slots.reduce(
    (total, slotKey, index) => total + (slotKey === key && index !== ignoredSlot ? 1 : 0),
    0
  );
}

/**
 * Returns the owned quantity of one collection key.
 *
 * @param {string} key - Collection key.
 * @returns {number} Owned copies.
 */
function ownedQuantity(key) {
  const row = findCollectionRow(key);
  return Number.isFinite(row?.quantity) ? Math.max(0, Math.floor(row.quantity)) : 0;
}

/**
 * Builds the illustration of a binder cover.
 *
 * @param {object} binder - Binder.
 * @returns {HTMLElement} The cover preview.
 */
function binderCoverPreview(binder) {
  const card = binder.cover ? catalogs?.cardsByKey.get(binder.cover) ?? null : null;
  return image(card?.path ?? null, card?.name ?? 'Couverture', 'binder-admin__cover-image');
}

/**
 * Creates one binder and selects it.
 *
 * @returns {void}
 */
function createBinder() {
  const binders = binderRows();
  const binder = {
    id: crypto.randomUUID(),
    name: `Classeur ${binders.length + 1}`,
    cover: null,
    createdAt: new Date().toISOString(),
    slots: new Array(BINDER_SLOT_COUNT).fill(null),
  };
  userState().binders.push(binder);
  activeBinderId = binder.id;
  markDirty();
  renderBinders();
  toast('Classeur créé.', 'success');
}

/**
 * Deletes the selected binder after confirmation.
 *
 * @returns {void}
 */
function deleteActiveBinder() {
  const binder = activeBinder();
  if (!binder || !window.confirm(`Supprimer le classeur « ${binder.name || 'sans nom'} » ?`)) return;
  userState().binders = binderRows().filter((entry) => entry.id !== binder.id);
  activeBinderId = userState().binders[0]?.id ?? null;
  markDirty();
  renderBinders();
  toast('Classeur supprimé.', 'success');
}

/**
 * Opens the illustrated picker for a binder cover or slot.
 *
 * @param {'binder-cover'|'binder-slot'} mode - Target.
 * @param {number|null} [slot=null] - Slot index for `binder-slot`.
 * @returns {void}
 */
function openBinderPicker(mode, slot = null) {
  if (!activeBinder()) return;
  binderSlotIndex = slot;
  openCardPicker(mode);
}

/**
 * Writes the picked card into the active binder.
 *
 * @param {string} key - Collection key.
 * @returns {void}
 */
function assignBinderCard(key) {
  const binder = activeBinder();
  if (!binder) return;
  if (pickerMode === 'binder-cover') {
    binder.cover = key;
  } else {
    const slot = binderSlotIndex;
    if (!Number.isInteger(slot) || slot < 0 || slot >= BINDER_SLOT_COUNT) return;
    if (binderPlacements(binder, key, slot) >= ownedQuantity(key)) {
      toast('Toutes les copies possédées sont déjà placées dans ce classeur.', 'error');
      return;
    }
    binder.slots[slot] = key;
  }
  markDirty();
  closeCardPicker();
  renderBinders();
}

/**
 * Empties one slot of the active binder.
 *
 * @param {number} slot - Slot index.
 * @returns {void}
 */
function clearBinderSlot(slot) {
  const binder = activeBinder();
  if (!binder || !Number.isInteger(slot)) return;
  binder.slots[slot] = null;
  markDirty();
  renderBinders();
}

/**
 * Removes the cover of the active binder.
 *
 * @returns {void}
 */
function clearBinderCover() {
  const binder = activeBinder();
  if (!binder) return;
  binder.cover = null;
  markDirty();
  renderBinders();
}

/**
 * Renders one slot of the binder page.
 *
 * @param {object} binder - Binder being edited.
 * @param {number} index - Slot index.
 * @returns {HTMLElement} The slot.
 */
function buildBinderSlot(binder, index) {
  const key = binder.slots[index];
  const card = key ? catalogs?.cardsByKey.get(key) ?? null : null;
  const fill = h('button', {
    type: 'button',
    class: `binder-admin__slot${card ? ' is-filled' : ''}`,
    title: card ? `${card.name} (${card.index})` : `Slot ${index + 1} : choisir une carte`,
    onclick: () => openBinderPicker('binder-slot', index),
  },
    card ? image(card.path, card.name, 'binder-admin__slot-image') : h('span', { class: 'binder-admin__slot-plus' }, '+'),
    h('span', { class: 'binder-admin__slot-index' }, String(index + 1))
  );
  if (!card) return fill;
  return h('div', { class: 'binder-admin__slot-wrap' },
    fill,
    h('button', {
      type: 'button',
      class: 'binder-admin__slot-remove',
      title: 'Vider ce slot',
      'aria-label': `Vider le slot ${index + 1}`,
      onclick: () => clearBinderSlot(index),
    }, '×')
  );
}

/**
 * Renders the Binders tab.
 *
 * @returns {void}
 */
function renderBinders() {
  const root = byId('binders-content');
  if (!root || !loaded) return;
  const binders = binderRows();
  if (!binders.some((binder) => binder.id === activeBinderId)) {
    activeBinderId = binders[0]?.id ?? null;
  }
  clear(root);

  const list = h('div', { class: 'binder-admin__list' });
  binders.forEach((binder) => {
    const placed = binder.slots.filter(Boolean).length;
    list.append(h('button', {
      type: 'button',
      class: `binder-admin__list-item${binder.id === activeBinderId ? ' is-active' : ''}`,
      onclick: () => {
        activeBinderId = binder.id;
        renderBinders();
      },
    },
      binderCoverPreview(binder),
      h('span', { class: 'binder-admin__list-body' },
        h('strong', null, binder.name || 'Sans nom'),
        h('span', { class: 'muted' }, `${placed}/${BINDER_SLOT_COUNT} cartes`)
      )
    ));
  });

  const binder = activeBinder();
  const editor = h('div', { class: 'binder-admin__editor' });
  if (!binder) {
    editor.append(h('p', { class: 'empty' }, 'Aucun classeur. Créez-en un pour commencer.'));
  } else {
    const name = h('input', {
      class: 'field__input',
      type: 'text',
      maxlength: '40',
      value: binder.name,
      placeholder: 'Nom du classeur',
      'aria-label': 'Nom du classeur',
      oninput: () => {
        binder.name = name.value;
        markDirty();
      },
      onchange: () => renderBinders(),
    });

    const placed = binder.slots.filter(Boolean).length;
    const coverCard = binder.cover ? catalogs?.cardsByKey.get(binder.cover) ?? null : null;
    const cover = h('div', { class: 'binder-admin__cover' },
      binderCoverPreview(binder),
      h('div', { class: 'binder-admin__cover-body' },
        h('strong', null, coverCard ? coverCard.name : 'Aucune couverture'),
        h('span', { class: 'muted' }, coverCard ? setLabel(coverCard.set) : 'Choisissez une carte possédée.'),
        h('div', { class: 'actions' },
          h('button', {
            type: 'button',
            class: 'btn btn--ghost',
            onclick: () => openBinderPicker('binder-cover'),
          }, binder.cover ? 'Changer la couverture' : 'Choisir une couverture'),
          binder.cover
            ? h('button', { type: 'button', class: 'btn btn--ghost', onclick: clearBinderCover }, 'Retirer')
            : null
        )
      )
    );

    const slots = h('div', { class: 'binder-admin__slots' });
    binder.slots.forEach((slotKey, index) => slots.append(buildBinderSlot(binder, index)));

    editor.append(
      h('div', { class: 'binder-admin__head' },
        h('label', { class: 'field binder-admin__name' },
          h('span', { class: 'field__label' }, 'Nom du classeur'),
          name
        ),
        h('div', { class: 'actions' },
          h('span', { class: 'badge' }, `${placed}/${BINDER_SLOT_COUNT} cartes`),
          h('button', { type: 'button', class: 'btn btn--ghost', onclick: deleteActiveBinder }, 'Supprimer')
        )
      ),
      cover,
      h('h3', { class: 'section-block__title' }, 'Page du classeur'),
      h('p', { class: 'muted' }, 'Cliquez sur un slot pour choisir une carte possédée. Une carte ne peut pas apparaître plus de fois que son nombre d’exemplaires.'),
      slots
    );
  }

  root.append(
    h('div', { class: 'binder-admin__head' },
      h('p', { class: 'muted' }, `${number(binders.length)} classeur(s).`),
      h('button', { type: 'button', class: 'btn btn--primary', onclick: createBinder }, '+ Nouveau classeur')
    ),
    h('div', { class: 'binder-admin__layout' }, list, editor)
  );
}

/**
 * Pins one owned card in the profile favorites.
 *
 * @param {string} key - Card key.
 * @returns {void}
 */
function addFavorite(key) {
  const profile = ensureState('profile');
  if (!Array.isArray(profile.favorites)) profile.favorites = [];
  if (profile.favorites.includes(key)) {
    toast('Cette carte est déjà en favori.');
    return;
  }
  const max = Number.isInteger(catalogs?.config?.profile?.maxFavorites)
    ? catalogs.config.profile.maxFavorites
    : 5;
  if (profile.favorites.length >= max) {
    toast(`Le profil accepte au maximum ${max} favoris.`, 'error');
    return;
  }
  profile.favorites.push(key);
  markDirty();
  closeCardPicker();
  renderProfile();
  toast('Carte ajoutée aux favoris.', 'success');
}

/* -------------------------------------------------------------------------- */
/* Profile                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Finds an icon descriptor by its normalized path.
 *
 * @param {string} file - Normalized icon path.
 * @returns {object|null} The icon descriptor.
 */
function findIcon(file) {
  return (catalogs?.icons ?? []).find((entry) => entry.file === file) ?? null;
}

/**
 * Renders the profile panel.
 *
 * @returns {void}
 */
function renderProfile() {
  const root = byId('profile-content');
  if (!root || !loaded) return;
  const profile = ensureState('profile');
  if (!Array.isArray(profile.favorites)) profile.favorites = [];
  if (!Array.isArray(profile.featured)) profile.featured = [];
  const title = (catalogs?.titles ?? []).find((entry) => entry.id === profile.title);
  const color = (catalogs?.colors ?? []).find((entry) => entry.id === profile.usernameColor);

  clear(root);
  root.append(section('Aperçu',
    h('div', { class: 'profile-preview' },
      image(profile.icon || profile.photo, 'Avatar', 'profile-preview__avatar'),
      h('div', null,
        h('div', {
          class: 'profile-preview__name',
          style: color ? `color: ${Array.isArray(color.hex) ? color.hex[0] : color.hex}` : '',
        }, profile.name || 'Sans pseudo'),
        h('div', { class: 'profile-preview__title' }, title?.name || 'Aucun titre')
      )
    )
  ));

  root.append(section('Identité', h('div', { class: 'field-grid' },
    textField('Pseudo', profile.name ?? '', (value) => {
      ensureState('profile').name = value.trim().slice(0, 32);
    }, { help: 'Vide = nom par défaut du jeu.' }),
    selectField('Titre', [
      { value: '', label: 'Aucun' },
      ...(catalogs?.titles ?? []).map((entry) => ({ value: entry.id, label: `${entry.name} (${entry.id})` })),
    ], profile.title ?? '', (value) => {
      ensureState('profile').title = value;
    }),
    selectField('Couleur du pseudo', [
      { value: 'auto', label: 'Automatique' },
      ...(catalogs?.colors ?? []).map((entry) => ({ value: entry.id, label: entry.name })),
    ], profile.usernameColor ?? 'auto', (value) => {
      ensureState('profile').usernameColor = value;
    })
  )));

  const iconGrid = h('div', { class: 'icon-grid' });
  (catalogs?.icons ?? []).forEach((entry) => {
    const selected = profile.icon === entry.file;
    iconGrid.append(h('button', {
      type: 'button',
      class: `icon-choice${selected ? ' is-selected' : ''}`,
      onclick: () => {
        ensureState('profile').icon = entry.file;
        markDirty();
        renderProfile();
      },
    }, image(entry.file, entry.name), h('span', null, entry.name)));
  });
  root.append(section('Avatar', iconGrid));

  const favorites = h('div', { class: 'chips' });
  profile.favorites.forEach((key) => {
    const card = catalogs?.cardsByKey.get(key) ?? collectionCard({ key });
    favorites.append(h('span', { class: 'chip chip--card' },
      image(card.path, card.name),
      h('span', null, card.name),
      h('button', {
        type: 'button',
        'aria-label': `Retirer ${card.name} des favoris`,
        onclick: () => {
          const current = ensureState('profile');
          current.favorites = current.favorites.filter((candidate) => candidate !== key);
          markDirty();
          renderProfile();
        },
      }, '✕')
    ));
  });
  if (profile.favorites.length === 0) favorites.append(h('span', { class: 'muted' }, 'Aucun favori.'));
  root.append(section('Cartes favorites',
    favorites,
    h('div', { class: 'actions' }, h('button', {
      type: 'button',
      class: 'btn btn--ghost',
      onclick: () => openCardPicker('favorite'),
    }, '+ Ajouter un favori'))
  ));

  const trophySelect = h('select', { class: 'field__select' });
  trophySelect.append(h('option', { value: '' }, 'Choisir un trophée…'));
  Object.keys(ensureState('trophies').unlocked ?? {})
    .filter((id) => !profile.featured.includes(id))
    .sort()
    .forEach((id) => trophySelect.append(h('option', { value: id }, id)));
  const addFeatured = h('button', {
    type: 'button',
    class: 'btn btn--ghost',
    onclick: () => {
      const value = trophySelect.value;
      if (!value) return;
      const current = ensureState('profile');
      if (current.featured.length >= 5) {
        toast('Le profil accepte au maximum cinq trophées mis en avant.', 'error');
        return;
      }
      current.featured.push(value);
      markDirty();
      renderProfile();
    },
  }, 'Mettre en avant');

  const featured = h('div', { class: 'chips' });
  profile.featured.forEach((id) => {
    featured.append(h('span', { class: 'chip' }, id, h('button', {
      type: 'button',
      'aria-label': `Retirer ${id}`,
      onclick: () => {
        const current = ensureState('profile');
        current.featured = current.featured.filter((candidate) => candidate !== id);
        markDirty();
        renderProfile();
      },
    }, '✕')));
  });
  if (profile.featured.length === 0) featured.append(h('span', { class: 'muted' }, 'Aucun trophée mis en avant.'));
  root.append(section('Trophées mis en avant', featured, h('div', { class: 'filters' },
    h('div', { class: 'search' }, trophySelect), addFeatured
  )));
}

/* -------------------------------------------------------------------------- */
/* Progression                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Builds the editable rarity counters of one stats object.
 *
 * @param {string} label - Section label.
 * @param {string} key - Stats key (`drawsByRarity`, `soldByRarity`).
 * @returns {HTMLElement} The section.
 */
function rarityCounters(label, key) {
  const stats = ensureState('stats');
  if (!stats[key] || typeof stats[key] !== 'object') stats[key] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const grid = h('div', { class: 'field-grid' });
  for (let rarity = 1; rarity <= 5; rarity += 1) {
    const current = Number(stats[key][String(rarity)]);
    grid.append(numberField(
      RARITY_LABELS[rarity],
      Number.isFinite(current) ? current : 0,
      (value) => {
        ensureState('stats')[key][String(rarity)] = value;
      }
    ));
  }
  return section(label, grid);
}

/**
 * Renders the progression panel.
 *
 * @returns {void}
 */
function renderProgress() {
  const root = byId('progress-content');
  if (!root || !loaded) return;
  const stats = ensureState('stats');
  const quota = ensureState('quota');
  const minePick = ensureState('minePick');
  const mining = ensureState('mining');
  const daily = ensureState('dailyRewards');
  const quests = ensureState('illagerQuests');
  const illager = ensureState('illagerShop');

  clear(root);

  const statsGrid = h('div', { class: 'field-grid' });
  [
    ['boostersOpened', 'Boosters ouverts'],
    ['godpacksOpened', 'Godpacks ouverts'],
    ['questsCompleted', 'Quêtes terminées'],
    ['daysConnected', 'Jours de connexion'],
    ['cardsSold', 'Cartes vendues'],
    ['sparksEarned', 'Sparks gagnés'],
    ['sparksSpent', 'Sparks dépensés'],
  ].forEach(([key, label]) => {
    const value = Number(stats[key]);
    statsGrid.append(numberField(label, Number.isFinite(value) ? value : 0, (next) => {
      ensureState('stats')[key] = next;
    }));
  });
  root.append(section('Statistiques générales', statsGrid));
  root.append(rarityCounters('Tirages par rareté', 'drawsByRarity'));
  root.append(rarityCounters('Ventes par rareté', 'soldByRarity'));

  const chapterOptions = [
    ...(catalogs?.chapters ?? []).map((entry) => ({
      value: entry.id,
      label: `${entry.name} (${entry.id})`,
    })),
  ];
  if (typeof daily.chapterId === 'string' && daily.chapterId !== '' && !chapterOptions.some((entry) => entry.value === daily.chapterId)) {
    chapterOptions.push({ value: daily.chapterId, label: daily.chapterId });
  }
  root.append(section('Récompenses de connexion', h('div', { class: 'field-grid' },
    selectField('Chapitre', chapterOptions, daily.chapterId ?? '', (value) => {
      ensureState('dailyRewards').chapterId = value === '' ? null : value;
    }),
    numberField('Récompenses réclamées', Number(daily.progress) || 0, (value) => {
      ensureState('dailyRewards').progress = value;
    }),
    textField('Dernier jour réclamé', daily.lastClaimDay ?? '', (value) => {
      ensureState('dailyRewards').lastClaimDay = value.trim() === '' ? null : value.trim();
    }, { type: 'date' })
  )));

  const questGrid = h('div', { class: 'field-grid' },
    numberField('Expérience des quêtes', Number(quests.experience) || 0, (value) => {
      ensureState('illagerQuests').experience = value;
    })
  );
  const progressTable = h('div', { class: 'chips' });
  const questProgress = quests.progress && typeof quests.progress === 'object' ? quests.progress : {};
  Object.entries(questProgress).forEach(([id, value]) => {
    const count = Number(value?.count) || 0;
    progressTable.append(h('span', { class: 'chip' },
      `${id} · ${count}`,
      h('button', {
        type: 'button',
        'aria-label': `Modifier ${id}`,
        onclick: () => {
          const next = window.prompt(`Progression de la quête ${id}`, String(count));
          if (next === null) return;
          const parsed = Math.max(0, Math.floor(Number(next) || 0));
          ensureState('illagerQuests').progress[id] = {
            ...ensureState('illagerQuests').progress[id],
            count: parsed,
          };
          markDirty();
          renderProgress();
        },
      }, '✎')
    ));
  });
  if (Object.keys(questProgress).length === 0) progressTable.append(h('span', { class: 'muted' }, 'Aucune quête commencée.'));
  root.append(section('Quêtes Illager', questGrid, progressTable));

  const mineGrid = h('div', { class: 'field-grid' },
    numberField('Blocs minés aujourd’hui', Number(mining.minedToday) || 0, (value) => {
      ensureState('mining').minedToday = value;
    }),
    numberField('Clics sur le bloc courant', Number(mining.clicks) || 0, (value) => {
      ensureState('mining').clicks = value;
    }),
    numberField('Blocs minés au total', Number(mining.totalMined) || 0, (value) => {
      ensureState('mining').totalMined = value;
    }),
    numberField('Sparks trouvés en minant', Number(mining.sparksFound) || 0, (value) => {
      ensureState('mining').sparksFound = value;
    })
  );
  const resourceGrid = h('div', { class: 'tile-grid' });
  if (!mining.resources || typeof mining.resources !== 'object') mining.resources = {};
  (catalogs?.resources ?? []).forEach((resource) => {
    const current = Number(mining.resources[resource.slug]) || 0;
    resourceGrid.append(numberField(
      resource.name,
      current,
      (value) => {
        const state = ensureState('mining');
        if (!state.resources || typeof state.resources !== 'object') state.resources = {};
        state.resources[resource.slug] = value;
      }
    ));
  });
  root.append(section('Mine', mineGrid));
  if ((catalogs?.resources ?? []).length > 0) root.append(section('Ressources minières', resourceGrid));

  const pickGrid = h('div', { class: 'field-grid' },
    numberField('Picks restants', Number(minePick.remaining) || 0, (value) => {
      ensureState('minePick').remaining = value;
    }),
    numberField('Cartes prises au total', Number(minePick.totalPicks) || 0, (value) => {
      ensureState('minePick').totalPicks = value;
    })
  );
  root.append(section('Mine Pick', pickGrid));

  if (!illager.balances || typeof illager.balances !== 'object') illager.balances = {};
  const currencyGrid = h('div', { class: 'tile-grid' });
  (catalogs?.currencies ?? []).forEach((currency) => {
    const current = Number(illager.balances[currency.id]) || 0;
    const wrapper = numberField(currency.name, current, (value) => {
      const state = ensureState('illagerShop');
      if (!state.balances || typeof state.balances !== 'object') state.balances = {};
      state.balances[currency.id] = value;
    });
    wrapper.prepend(image(currency.texture, currency.name, 'tile__icon'));
    currencyGrid.append(wrapper);
  });
  root.append(section('Illager Shop', currencyGrid));

  const quotaGrid = h('div', { class: 'field-grid' },
    numberField('Boosters journaliers restants', Number(quota.dailyRemaining) || 0, (value) => {
      ensureState('quota').dailyRemaining = value;
    }),
    numberField('Boosters achetés restants', Number(quota.purchasedBoosters) || 0, (value) => {
      ensureState('quota').purchasedBoosters = value;
    })
  );
  if (!quota.bonusBoosters || typeof quota.bonusBoosters !== 'object') quota.bonusBoosters = {};
  Object.entries(quota.bonusBoosters).forEach(([setId, value]) => {
    quotaGrid.append(numberField(`Bonus ${setId}`, Number(value) || 0, (next) => {
      ensureState('quota').bonusBoosters[setId] = next;
    }));
  });
  root.append(section('Boosters', quotaGrid));

  const trophies = ensureState('trophies');
  if (!trophies.unlocked || typeof trophies.unlocked !== 'object') trophies.unlocked = {};
  const chips = h('div', { class: 'chips' });
  const ids = Object.keys(trophies.unlocked).sort();
  ids.forEach((id) => chips.append(h('span', { class: 'chip' }, id, h('button', {
    type: 'button',
    'aria-label': `Verrouiller ${id}`,
    onclick: () => {
      delete ensureState('trophies').unlocked[id];
      markDirty();
      renderProgress();
      renderSummary();
    },
  }, '✕'))));
  if (ids.length === 0) chips.append(h('span', { class: 'muted' }, 'Aucun trophée débloqué.'));
  const trophyInput = h('input', {
    class: 'field__input',
    type: 'text',
    placeholder: 'global:quest:gold',
    'aria-label': 'Identifiant du trophée à ajouter',
  });
  const addTrophy = h('button', {
    type: 'button',
    class: 'btn btn--ghost',
    onclick: () => {
      const id = trophyInput.value.trim();
      if (id === '') return;
      ensureState('trophies').unlocked[id] = { unlockedAt: new Date().toISOString() };
      trophyInput.value = '';
      markDirty();
      renderProgress();
      renderSummary();
    },
  }, '+ Débloquer');
  root.append(section('Trophées débloqués',
    chips,
    h('div', { class: 'filters' }, h('div', { class: 'search' }, trophyInput), addTrophy)
  ));
}

/* -------------------------------------------------------------------------- */
/* Purchases                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Builds a gradient/solid background for a colour entry.
 *
 * @param {object} color - Colour catalogue entry.
 * @returns {string} CSS background value.
 */
function colorBackground(color) {
  if (Array.isArray(color?.hex)) {
    return `linear-gradient(${Number(color.direction) || 90}deg, ${color.hex.join(', ')})`;
  }
  return color?.hex ?? 'var(--surface-alt)';
}

/**
 * Toggles one purchase id.
 *
 * @param {string} id - Purchase id.
 * @returns {void}
 */
function togglePurchase(id) {
  const purchases = ensureState('purchases');
  if (Object.prototype.hasOwnProperty.call(purchases, id)) {
    delete purchases[id];
    toast(`${id} retiré.`);
  } else {
    purchases[id] = { boughtAt: new Date().toISOString() };
    toast(`${id} ajouté.`, 'success');
  }
  markDirty();
  renderPurchases();
}

/**
 * Builds one purchase tile.
 *
 * @param {string} id - Purchase id.
 * @param {string} label - Visible name.
 * @param {string} meta - Secondary line.
 * @param {object} [options] - Display options.
 * @param {string} [options.icon] - Image path.
 * @param {string} [options.background] - Swatch background.
 * @returns {HTMLElement} The tile.
 */
function purchaseTile(id, label, meta, { icon = null, background = null } = {}) {
  const purchases = ensureState('purchases');
  const owned = Object.prototype.hasOwnProperty.call(purchases, id);
  return h('button', {
    type: 'button',
    class: `purchase${owned ? ' is-owned' : ''}${icon ? ' purchase--icon' : ''}`,
    onclick: () => togglePurchase(id),
    title: id,
  },
    h('span', { class: 'purchase__check', 'aria-hidden': 'true' }, '✓'),
    icon ? image(icon, label) : null,
    background ? h('span', { class: 'purchase__swatch', style: `background: ${background}` }) : null,
    h('span', { class: 'purchase__body' },
      h('span', { class: 'purchase__name' }, label),
      h('span', { class: 'purchase__meta' }, `${meta}${owned ? ' · possédé' : ''}`)
    )
  );
}

/**
 * Renders the purchases panel.
 *
 * @returns {void}
 */
function renderPurchases() {
  const root = byId('purchases-content');
  if (!root || !loaded) return;
  const purchases = ensureState('purchases');
  clear(root);

  const items = catalogs?.config?.features?.items ?? {};
  const featureGrid = h('div', { class: 'purchase-grid' });
  Object.entries(items).forEach(([id, entry]) => {
    featureGrid.append(purchaseTile(
      id,
      id,
      `${Number(entry?.priceSparks) || 0} Sparks`,
      { icon: 'assets/img/sparks.png' }
    ));
  });
  if (Object.keys(items).length === 0) featureGrid.append(h('span', { class: 'muted' }, 'Aucune option déclarée.'));
  root.append(section('Options et fonctionnalités', featureGrid));

  const colorUses = h('div', { class: 'color-uses' });
  (catalogs?.colors ?? []).forEach((color) => {
    const uses = [
      { prefix: PURCHASE_PREFIX.TITLE_COLOR, label: 'Titre', price: color.titlePrice },
      { prefix: PURCHASE_PREFIX.USERNAME_COLOR, label: 'Pseudo', price: color.usernamePrice },
      { prefix: PURCHASE_PREFIX.BORDER_COLOR, label: 'Cadre', price: color.borderPrice },
    ];
    colorUses.append(h('div', { class: 'color-use' },
      h('div', { class: 'color-use__identity' },
        h('span', { class: 'color-use__swatch', style: `background: ${colorBackground(color)}` }),
        h('strong', null, color.name)
      ),
      ...uses.map((use) => {
        const id = `${use.prefix}${color.id}`;
        const owned = Object.prototype.hasOwnProperty.call(purchases, id);
        return h('button', {
          type: 'button',
          class: `toggle${owned ? ' is-on' : ''}`,
          title: id,
          onclick: () => togglePurchase(id),
        }, `${use.label}${owned ? ' ✓' : ''}`);
      })
    ));
  });
  root.append(section('Couleurs du profil', colorUses));

  const paidIcons = (catalogs?.icons ?? []).filter((entry) => entry.price > 0);
  const iconGrid = h('div', { class: 'purchase-grid' });
  paidIcons.forEach((icon) => {
    iconGrid.append(purchaseTile(
      `${PURCHASE_PREFIX.ICON}${icon.file}`,
      icon.name,
      `${icon.price} Sparks`,
      { icon: icon.file }
    ));
  });
  if (paidIcons.length === 0) iconGrid.append(h('span', { class: 'muted' }, 'Aucun avatar payant déclaré.'));
  root.append(section('Avatars payants', iconGrid));

  const slots = h('div', { class: 'purchase-grid' });
  const profileConfig = catalogs?.config?.profile ?? {};
  Object.entries(profileConfig.favoriteSlotPrices ?? {}).forEach(([slot, price]) => {
    slots.append(purchaseTile(
      `${PURCHASE_PREFIX.FAVORITE_SLOT}${slot}`,
      `Favori n°${slot}`,
      `${Number(price) || 0} Sparks`,
      { icon: 'assets/img/pin.png' }
    ));
  });
  Object.entries(profileConfig.featuredSlotPrices ?? {}).forEach(([slot, price]) => {
    slots.append(purchaseTile(
      `${PURCHASE_PREFIX.FEATURED_SLOT}${slot}`,
      `Trophée mis en avant n°${slot}`,
      `${Number(price) || 0} Sparks`,
      { icon: 'assets/img/trophy/Global/quest/bronze.png' }
    ));
  });
  root.append(section('Emplacements du profil', slots));

  const knownIds = new Set([
    ...Object.keys(items),
    ...(catalogs?.colors ?? []).flatMap((color) => [
      `${PURCHASE_PREFIX.TITLE_COLOR}${color.id}`,
      `${PURCHASE_PREFIX.USERNAME_COLOR}${color.id}`,
      `${PURCHASE_PREFIX.BORDER_COLOR}${color.id}`,
    ]),
    ...(catalogs?.icons ?? []).filter((entry) => entry.price > 0)
      .map((entry) => `${PURCHASE_PREFIX.ICON}${entry.file}`),
    ...Object.keys(profileConfig.favoriteSlotPrices ?? {}).map((slot) => `${PURCHASE_PREFIX.FAVORITE_SLOT}${slot}`),
    ...Object.keys(profileConfig.featuredSlotPrices ?? {}).map((slot) => `${PURCHASE_PREFIX.FEATURED_SLOT}${slot}`),
  ]);
  const custom = Object.keys(purchases).filter((id) => !knownIds.has(id));
  const customChips = h('div', { class: 'chips' });
  custom.forEach((id) => customChips.append(h('span', { class: 'chip' }, id, h('button', {
    type: 'button',
    'aria-label': `Retirer ${id}`,
    onclick: () => togglePurchase(id),
  }, '✕'))));
  if (custom.length === 0) customChips.append(h('span', { class: 'muted' }, 'Aucun achat personnalisé.'));
  root.append(section('Achats personnalisés', customChips));
}

/* -------------------------------------------------------------------------- */
/* Advanced                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Builds one collapsible JSON editor.
 *
 * @param {string} label - Visible label.
 * @param {unknown} value - Current value.
 * @param {(parsed: unknown) => void} onApply - Called with the parsed replacement.
 * @returns {HTMLElement} The editor.
 */
function jsonEditor(label, value, onApply) {
  const textarea = h('textarea', {
    class: 'field__textarea',
    spellcheck: 'false',
    'aria-label': `JSON de ${label}`,
  });
  textarea.value = JSON.stringify(value ?? null, null, 2);
  const details = h('details', { class: 'advanced-entry' },
    h('summary', null, label),
    h('div', { class: 'advanced-entry__body' },
      textarea,
      h('button', {
        type: 'button',
        class: 'btn btn--ghost',
        onclick: () => {
          try {
            const parsed = JSON.parse(textarea.value);
            onApply(parsed);
            validatePayload(loaded.payload);
            markDirty();
            toast(`${label} appliqué.`, 'success');
          } catch (error) {
            toast(`JSON invalide : ${error.message}`, 'error');
          }
        },
      }, 'Appliquer')
    )
  );
  return details;
}

/**
 * Renders the advanced panel.
 *
 * @returns {void}
 */
function renderAdvanced() {
  const root = byId('advanced-content');
  if (!root || !loaded) return;
  const state = userState();
  clear(root);

  const stateBlock = h('div', null);
  Object.keys(state)
    .sort()
    .forEach((key) => {
      stateBlock.append(jsonEditor(`user_state.${key}`, state[key], (parsed) => {
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('cet état doit être un objet.');
        }
        state[key] = parsed;
        populateSetSelect(byId('collection-set'), true);
        renderSummary();
      }));
    });
  root.append(section('États du compte', stateBlock));

  const otherBlock = h('div', null);
  STORE_NAMES.filter((name) => name !== 'user_state').forEach((storeName) => {
    otherBlock.append(jsonEditor(storeName, loaded.payload.stores[storeName], (parsed) => {
      if (!Array.isArray(parsed)) throw new Error('ce store doit être une liste.');
      loaded.payload.stores[storeName] = parsed;
      if (storeName === 'collection') {
        renderCollection();
        renderSummary();
        populateSetSelect(byId('collection-set'), true);
      }
    }));
  });
  root.append(section('Autres stores', otherBlock));
}

/* -------------------------------------------------------------------------- */
/* Load and export                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Loads and validates one `.save` file.
 *
 * @param {File} file - Dragged or selected file.
 * @returns {Promise<void>} Resolves once the editor is ready.
 */
async function loadFile(file) {
  if (!file) return;
  if (loaded?.dirty && !window.confirm('La sauvegarde en cours contient des modifications non téléchargées. La remplacer ?')) {
    return;
  }
  const feedback = byId('file-feedback');
  setFeedback(feedback, 'Lecture de la sauvegarde…');
  try {
    if (Number.isFinite(file.size) && file.size > 32 * 1024 * 1024) {
      throw new Error('Le fichier dépasse la limite de 32 Mo.');
    }
    const text = (await file.text()).trim();
    if (text === '') throw new Error('Le fichier est vide.');
    const payload = validatePayload(await decompressJson(text));
    loaded = { payload, fileName: file.name || 'backup_cards.save', dirty: false };
    setFeedback(feedback, null);
    byId('dropzone').hidden = true;
    byId('workspace').hidden = false;
    byId('change-file').hidden = false;
    byId('download').disabled = false;
    populateSetSelect(byId('collection-set'), true);
    populateSetSelect(byId('picker-set'), true);
    renderSummary();
    activateTab('overview');
    toast('Sauvegarde chargée.', 'success');
  } catch (error) {
    console.error('[SaveEditor] Import failed.', error);
    setFeedback(feedback, `Sauvegarde illisible : ${error.message}`, 'error');
  }
}

/**
 * Builds a download file name from the imported one.
 *
 * @returns {string} A `.save` file name.
 */
function exportFileName() {
  const base = (loaded?.fileName ?? 'backup_cards.save').replace(/\.save$/i, '');
  const day = new Date().toISOString().slice(0, 10);
  return `${base}_edited_${day}.save`;
}

/**
 * Validates, compresses and downloads the edited save.
 *
 * @returns {Promise<void>} Resolves once the download was triggered.
 */
async function downloadSave() {
  if (!loaded) return;
  try {
    validatePayload(loaded.payload);
    const content = await compressJson(loaded.payload);
    const blob = new Blob([content], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const anchor = h('a', { href: url, download: exportFileName(), rel: 'noopener' });
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    loaded.dirty = false;
    renderSummary();
    toast('Sauvegarde téléchargée. Réimportez-la depuis les réglages du jeu.', 'success');
  } catch (error) {
    console.error('[SaveEditor] Export failed.', error);
    toast(`Export impossible : ${error.message}`, 'error');
  }
}

/* -------------------------------------------------------------------------- */
/* Wiring                                                                     */
/* -------------------------------------------------------------------------- */

const lock = byId('lock');
const lockForm = byId('lock-form');
const lockInput = byId('lock-input');
const lockFeedback = byId('lock-feedback');
const app = byId('app');

/**
 * Reveals the editor and loads its catalogues.
 *
 * @returns {Promise<void>} Resolves once the catalogues settled.
 */
async function unlockApp() {
  lock.hidden = true;
  app.hidden = false;
  const status = byId('key-status');
  setFeedback(status, 'Chargement des catalogues…');
  try {
    await loadCatalogs();
    setFeedback(
      status,
      `${number(catalogs.cards.length)} cartes, ${number(catalogs.sets.length)} extensions et ${number(catalogs.colors.length)} couleurs chargées.`,
      'success'
    );
  } catch (error) {
    console.error('[SaveEditor] Catalogue load failed.', error);
    setFeedback(status, `Catalogues incomplets : ${error.message}`, 'error');
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

byId('lock-again').addEventListener('click', () => {
  app.hidden = true;
  lock.hidden = false;
  lockInput.value = '';
  setFeedback(lockFeedback, null);
  lockInput.focus();
});

byId('change-file').addEventListener('click', () => byId('file-input').click());
byId('file-input').addEventListener('change', () => {
  const [file] = byId('file-input').files ?? [];
  byId('file-input').value = '';
  void loadFile(file);
});

const dropzone = byId('dropzone');
dropzone.addEventListener('click', () => byId('file-input').click());
dropzone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    byId('file-input').click();
  }
});
['dragenter', 'dragover'].forEach((type) => {
  dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.add('is-over');
  });
});
['dragleave', 'drop'].forEach((type) => {
  dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.remove('is-over');
  });
});
dropzone.addEventListener('drop', (event) => {
  const [file] = event.dataTransfer?.files ?? [];
  void loadFile(file);
});

byId('download').addEventListener('click', () => void downloadSave());
byId('add-card').addEventListener('click', () => openCardPicker('add'));
byId('picker-close').addEventListener('click', closeCardPicker);
byId('card-picker').addEventListener('click', (event) => {
  if (event.target === byId('card-picker')) closeCardPicker();
});
byId('picker-search').addEventListener('input', () => {
  window.clearTimeout(pickerSearchTimer);
  pickerSearchTimer = window.setTimeout(renderPicker, 120);
});
byId('picker-set').addEventListener('change', renderPicker);
['collection-search'].forEach((id) => {
  byId(id).addEventListener('input', () => {
    window.clearTimeout(pickerSearchTimer);
    pickerSearchTimer = window.setTimeout(renderCollection, 120);
  });
});
byId('collection-set').addEventListener('change', renderCollection);
byId('collection-rarity').addEventListener('change', renderCollection);

document.querySelectorAll('.editor-tab').forEach((button) => {
  button.addEventListener('click', () => activateTab(button.dataset.tab));
});

window.addEventListener('beforeunload', (event) => {
  if (!loaded?.dirty) return;
  event.preventDefault();
  event.returnValue = '';
});

lockInput.focus();
