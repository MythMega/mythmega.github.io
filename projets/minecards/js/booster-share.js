/**
 * booster-share - The read-only page of a shared booster (`booster.html`).
 *
 * Reference: `js/utils/BoosterCode.js` (writer), `overlay.html` / `js/overlay.js` (consumer).
 *
 * It reads the URL, decodes the booster code and paints the pack. Like the overlay it shares
 * NOTHING with the game beyond the data files: no account, no database, no catalogue, no manager.
 * The payload carries the extension id and the POSITIONS of the drawn cards, so the page reloads
 * `data/boosters/<setId>.json` for the names, illustrations and rarities - exactly what makes a
 * code short enough to paste in a chat.
 *
 * URL: booster.html?code=minecards:{code}&lang={fr|en}&username={name}&profileiconurl={url}
 *
 * The two actions build the overlay link of THIS pack with the same parameters:
 *   - copy it to the clipboard, for a post or a message;
 *   - play it in a new tab, which is the animation the streamer would put on screen.
 *
 * A missing or invalid code leaves an explanation panel rather than an empty page; an illustration
 * that never arrives is hidden instead of showing the broken-image glyph.
 */

/** Prefix of a MineCards booster code (mirrors `js/utils/BoosterCode.js`, intentionally duplicated). */
const CODE_PREFIX = 'minecards:';

/** Supported payload version. */
const CODE_VERSION = 2;

/** Directory of the booster JSON files. */
const BOOSTER_DIRECTORY = 'data/boosters';

/** The animation page, relative to this one. */
const OVERLAY_PAGE = 'overlay.html';

/** Language of the cards: the `lang` parameter, then the language of the visitor. */
const LANG = (() => {
  const requested = (new URLSearchParams(window.location.search).get('lang') ?? '').trim().toLowerCase();
  if (requested === 'fr' || requested === 'en') return requested;
  const code = (navigator.language || 'fr').slice(0, 2).toLowerCase();
  return code === 'en' ? 'en' : 'fr';
})();

/**
 * The few labels of this page, in the two languages it can be read in.
 *
 * A local dictionary rather than the game's `I18n`: this page must not fetch
 * `settings/i18n/*.json`, which would be a request, a failure mode and a flash of untranslated
 * text for a dozen words.
 */
const STRINGS = {
  fr: {
    pageTitle: 'MineCards : {name}',
    fallbackTitle: 'Booster partagé',
    cards: (count) => `${count} carte(s)`,
    anonymous: 'Joueur anonyme',
    copy: 'Copier le lien du booster',
    play: "Jouer l'animation booster",
    copied: 'Lien du booster copié dans le presse-papier.',
    copyError: 'Impossible de copier le lien du booster.',
    playError: "L'onglet de l'animation a été bloqué par le navigateur.",
    missingCode: 'Ce lien ne contient aucun booster. Le paramètre « code » est manquant.',
    damaged: 'Ce booster est illisible : le lien est incomplet ou a été abîmé.',
    unknown: 'Inconnu',
    rarities: { 1: 'Commune', 2: 'Rare', 3: 'Super rare', 4: 'Légendaire', 5: 'Mythique' },
  },
  en: {
    pageTitle: 'MineCards: {name}',
    fallbackTitle: 'Shared booster',
    cards: (count) => `${count} card(s)`,
    anonymous: 'Anonymous player',
    copy: 'Copy the booster link',
    play: 'Play the booster animation',
    copied: 'Booster link copied to the clipboard.',
    copyError: 'The booster link could not be copied.',
    playError: 'The animation tab was blocked by the browser.',
    missingCode: 'This link carries no booster: the "code" parameter is missing.',
    damaged: 'This booster cannot be read: the link is incomplete or has been damaged.',
    unknown: 'Unknown',
    rarities: { 1: 'Common', 2: 'Rare', 3: 'Super rare', 4: 'Legendary', 5: 'Mythic' },
  },
};

/** Text of this page for a key. */
const T = STRINGS[LANG];

/** Query string of the page, read once. */
const PARAMS = new URLSearchParams(window.location.search);

/**
 * Decodes a URL-safe (or standard) Base64 string into bytes.
 *
 * @param {string} value - Base64 text.
 * @returns {Uint8Array} The decoded bytes.
 */
function decodeBase64Bytes(value) {
  const normalized = value.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * Parses the `code` query parameter into `{ setId, positions }`.
 *
 * @param {string} code - Raw code (with or without the `minecards:` prefix).
 * @returns {{setId: string, positions: number[]}|null} The decoded record, or null when invalid.
 */
function parseCode(code) {
  if (typeof code !== 'string' || code.trim() === '') return null;
  const trimmed = code.trim();
  const raw = trimmed.startsWith(CODE_PREFIX) ? trimmed.slice(CODE_PREFIX.length) : trimmed;
  if (raw === '') return null;
  try {
    const bytes = decodeBase64Bytes(raw);
    if (bytes.length < 3 || bytes[0] !== CODE_VERSION) return null;
    const idLength = bytes[1];
    if (bytes.length < 2 + idLength) return null;
    const setId = String.fromCharCode(...bytes.subarray(2, 2 + idLength));
    const rest = bytes.subarray(2 + idLength);
    if (rest.length === 0 || rest.length % 2 !== 0) return null;
    const positions = [];
    for (let index = 0; index < rest.length; index += 2) {
      positions.push((rest[index] << 8) | rest[index + 1]);
    }
    return { setId, positions };
  } catch (error) {
    console.warn('[booster-share] The booster code could not be read.', error);
    return null;
  }
}

/**
 * Resolves the `<lang>` placeholder of an asset path.
 *
 * Supports the two shapes of the game data (`<lang>` placeholder and a `/fr/` path segment)
 * without importing `I18n`.
 *
 * @param {string} path - Raw path stored in the booster JSON.
 * @returns {string} The resolved path (empty when the input is empty).
 */
function resolveAssetPath(path) {
  if (typeof path !== 'string' || path === '') return '';
  if (path.includes('<lang>')) return path.split('<lang>').join(LANG);
  return path.replace(/(^|\/)(fr|en)(?=\/)/i, (match, prefix) => `${prefix}${LANG}`);
}

/**
 * Loads the booster JSON and turns the stored card positions into display cards.
 *
 * @param {string} setId - Extension id.
 * @param {number[]} positions - Positions of the drawn cards in the booster `Cards` array.
 * @returns {Promise<{name: string, cards: Array}|null>} The resolved pack, or null when the booster
 *   file is missing/unreadable or a position is out of range.
 */
async function loadPack(setId, positions) {
  let data;
  try {
    const response = await fetch(`${BOOSTER_DIRECTORY}/${setId}.json`, { cache: 'no-store' });
    if (!response.ok) return null;
    data = await response.json();
  } catch (error) {
    console.warn(`[booster-share] Booster "${setId}" could not be loaded.`, error);
    return null;
  }
  if (!data || !Array.isArray(data.Cards)) return null;

  const cards = [];
  for (const position of positions) {
    const entry = data.Cards[position];
    if (!entry) return null;
    cards.push({
      rarity: Number(entry.Rarity ?? 1),
      illustration: resolveAssetPath(entry.Path ?? ''),
      names: { fr: entry.Name_FR ?? '', en: entry.Name_EN ?? '' },
    });
  }

  return { name: data.Name ?? setId, cards };
}

/**
 * Formats a small template (`{token}` placeholders).
 *
 * @param {string} template - Template text.
 * @param {Record<string, string>} values - Replacement values.
 * @returns {string} The formatted text.
 */
function format(template, values) {
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  );
}

/**
 * Resolves the display name of a card for the page language (falls back to fr, then en).
 *
 * @param {object} card - Display card.
 * @returns {string} The localized name, falling back to the unknown label.
 */
function cardName(card) {
  const names = card?.names ?? {};
  return names[LANG] || names.fr || names.en || T.unknown;
}

/**
 * Names the rarity of a card.
 *
 * @param {object} card - Display card.
 * @returns {string} The localized rarity, falling back to its number.
 */
function cardRarity(card) {
  const rarity = Number(card?.rarity);
  return T.rarities[rarity] ?? String(card?.rarity ?? T.unknown);
}

/**
 * Builds the absolute URL of the overlay animation for this pack.
 *
 * The parameters are copied from this page, so the overlay shows the same cards, the same author
 * and the same card language. A missing optional parameter is simply left out rather than written
 * as an empty one.
 *
 * @param {string} code - The booster code of this page.
 * @returns {string} The absolute overlay URL.
 */
function buildOverlayUrl(code) {
  const url = new URL(OVERLAY_PAGE, window.location.href);
  url.searchParams.set('code', code);
  url.searchParams.set('lang', LANG);
  const username = (PARAMS.get('username') ?? '').trim();
  const profileIconUrl = (PARAMS.get('profileiconurl') ?? '').trim();
  if (username !== '') url.searchParams.set('username', username);
  if (profileIconUrl !== '') url.searchParams.set('profileiconurl', profileIconUrl);
  return url.href;
}

/**
 * Renders the pack into the document.
 *
 * @param {{name: string, cards: Array}} pack - Resolved pack.
 * @returns {void}
 */
function render(pack) {
  const title = document.querySelector('[data-booster-share-title]');
  const meta = document.querySelector('[data-booster-share-meta]');
  const list = document.querySelector('[data-booster-share-cards]');
  const actions = document.querySelector('[data-booster-share-actions]');
  const identity = document.querySelector('[data-booster-share-identity]');
  const author = document.querySelector('[data-booster-share-author]');
  const avatar = document.querySelector('[data-booster-share-avatar]');
  const avatarFallback = document.querySelector('[data-booster-share-avatar-fallback]');

  const name = pack.name || T.fallbackTitle;
  document.title = format(T.pageTitle, { name });
  if (title) title.textContent = name;
  if (meta) meta.textContent = T.cards(pack.cards.length);

  // --- The identity of the author ---------------------------------------------------------
  // The row is built whatever the URL carries: a link written before the author parameters
  // existed is still a page of somebody, and a pack that opens on a title with nobody above it
  // reads as a page that failed to load half of itself. An author without a picture gets the
  // question mark, an author without a name the wording the game uses for such a player.
  const username = (PARAMS.get('username') ?? '').trim();
  const picture = (PARAMS.get('profileiconurl') ?? '').trim();

  if (author) author.textContent = username !== '' ? username : T.anonymous;
  if (avatar) {
    avatar.hidden = picture === '';
    if (picture !== '') {
      avatar.src = picture;
      avatar.alt = '';
      avatar.onerror = () => {
        avatar.hidden = true;
        if (avatarFallback) avatarFallback.hidden = false;
      };
    }
  }
  if (avatarFallback) avatarFallback.hidden = picture !== '';
  if (identity) identity.hidden = false;

  // --- The cards --------------------------------------------------------------------------
  if (list) {
    list.textContent = '';
    pack.cards.forEach((card) => {
      const item = document.createElement('li');
      item.className = 'booster-share__card';
      item.classList.add(`booster-share__card--r${Number(card.rarity) || 1}`);

      const frame = document.createElement('div');
      frame.className = 'booster-share__art';
      const image = document.createElement('img');
      image.className = 'booster-share__art-image';
      image.src = card.illustration;
      image.alt = cardName(card);
      image.loading = 'lazy';
      // An illustration that never arrives is hidden rather than shown as a broken image: the
      // name and the rarity below still describe the card.
      image.addEventListener('error', () => {
        image.hidden = true;
      });
      frame.appendChild(image);

      const label = document.createElement('p');
      label.className = 'booster-share__card-name';
      label.textContent = cardName(card);
      const rarity = document.createElement('p');
      rarity.className = 'booster-share__card-rarity';
      rarity.textContent = cardRarity(card);

      item.append(frame, label, rarity);
      list.appendChild(item);
    });
  }

  if (actions) actions.hidden = false;
}

/**
 * Displays the error message of an unusable share link.
 *
 * @param {string} message - Message to display.
 * @returns {void}
 */
function renderError(message) {
  document.querySelector('[data-booster-share-cards]')?.remove();
  document.querySelector('[data-booster-share-identity]')?.remove();
  const empty = document.querySelector('[data-booster-share-empty]');
  if (empty) {
    empty.hidden = false;
    empty.textContent = message;
  }
  console.warn('[booster-share]', message);
}

/**
 * Writes a text in the clipboard, with a fallback for non-secure contexts.
 *
 * The game has a shared helper for this (`js/utils/Clipboard.js`), but this page deliberately
 * imports nothing from `js/`: the same two strategies live here in a dozen lines.
 *
 * @param {string} text - Text to copy.
 * @returns {Promise<void>} Resolves when the text is in the clipboard.
 * @throws {Error} When both strategies fail.
 */
async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      // A page opened over plain HTTP, or a browser that refuses the write without a trusted
      // gesture, must still be able to copy: the legacy path below is what the game itself uses.
      console.warn('[booster-share] The clipboard API refused the write, trying the fallback.', error);
    }
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand('copy');
  field.remove();
  if (!copied) throw new Error('document.execCommand("copy") was refused.');
}

/**
 * Binds the two actions of the page: copy the overlay link, or play it in a new tab.
 *
 * @param {string} code - The booster code of this page.
 * @returns {void}
 */
function bindActions(code) {
  const copyButton = document.querySelector('[data-booster-share-copy]');
  const playButton = document.querySelector('[data-booster-share-play]');
  const feedback = document.querySelector('[data-booster-share-feedback]');

  const tell = (message) => {
    if (feedback) feedback.textContent = message;
  };

  copyButton?.addEventListener('click', async () => {
    try {
      await copyText(buildOverlayUrl(code));
      tell(T.copied);
    } catch (error) {
      console.error('[booster-share] The overlay link could not be copied.', error);
      tell(T.copyError);
    }
  });

  playButton?.addEventListener('click', () => {
    const opened = window.open(buildOverlayUrl(code), '_blank', 'noopener');
    if (!opened) tell(T.playError);
  });

  // The labels are written from the dictionary rather than from the markup: the page has no
  // translation files, and the two languages must not drift from the strings of the errors.
  if (copyButton) copyButton.textContent = T.copy;
  if (playButton) playButton.textContent = T.play;
}

/**
 * Entry point: decodes the code of the URL and renders the pack or the explanation panel.
 *
 * @returns {Promise<void>} Resolves once the pack or the error panel was rendered.
 */
async function main() {
  const code = (PARAMS.get('code') ?? '').trim();
  if (code === '') {
    renderError(T.missingCode);
    return;
  }

  const decoded = parseCode(code);
  if (!decoded) {
    renderError(T.damaged);
    return;
  }

  const pack = await loadPack(decoded.setId, decoded.positions);
  if (!pack) {
    renderError(T.damaged);
    return;
  }

  render(pack);
  bindActions(code);
  document.documentElement.lang = LANG;
}

void main();
