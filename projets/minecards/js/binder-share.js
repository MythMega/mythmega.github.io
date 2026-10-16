/**
 * binder-share - The read-only page of a shared binder (`collection.html?code=...`).
 *
 * Reference: `.docs/main.md` section 3.H, `js/utils/BinderCode.js`.
 *
 * It reads the code of the URL, decodes it and paints the page. It shares NOTHING with the game
 * beyond the code format, the foil helper and three stylesheets: no account, no database, no
 * catalogue, no manager. That is the point - the payload carries the master fields of every card it
 * shows, so a shared binder opens on a device that never played the game, and nothing it displays
 * can ever be written back.
 *
 * Three things a visitor can do: read the page, open a card in detail (a click on a slot), and
 * leave to the game. The photo and the pseudo of the author come from the code as well.
 *
 * A card illustration path can still carry the `<lang>` placeholder of the game data: it is
 * resolved here against the language of the visitor, not against a stored preference.
 */

import { decodeBinderCode, readBinderCodeFromUrl } from './utils/BinderCode.js';
import { applyShine } from './utils/Shine.js';

/** Language of the visitor, limited to the two the card data is written in. */
const LANG = (() => {
  const code = (navigator.language || 'fr').slice(0, 2).toLowerCase();
  return code === 'en' ? 'en' : 'fr';
})();

/**
 * The few labels of this page, in the two languages it can be read in.
 *
 * Deliberately a local dictionary rather than the game's `I18n`: this page must not fetch
 * `settings/i18n/*.json`, which is a request, a failure mode and a flash of untranslated text for
 * six words. The rarity and style names are the ones the game itself displays.
 */
const STRINGS = {
  fr: {
    cards: (filled, total) => `${filled} / ${total} carte(s)`,
    hint: 'Cliquez sur une carte pour voir son détail.',
    rarity: 'Rareté',
    style: 'Style',
    set: 'Extension',
    number: 'Numéro',
    classic: 'Normal',
    fullart: 'Full Art',
    close: 'Fermer',
    anonymous: 'Joueur anonyme',
    rarities: { 1: 'Commune', 2: 'Rare', 3: 'Super rare', 4: 'Légendaire', 5: 'Mythique' },
    missingCode: 'Ce lien ne contient aucun binder. Le paramètre « code » est manquant.',
    damaged: 'Ce binder est illisible : le lien est incomplet ou a été abîmé.',
  },
  en: {
    cards: (filled, total) => `${filled} / ${total} card(s)`,
    hint: 'Click a card to see its details.',
    rarity: 'Rarity',
    style: 'Style',
    set: 'Extension',
    number: 'Number',
    classic: 'Normal',
    fullart: 'Full Art',
    close: 'Close',
    anonymous: 'Anonymous player',
    rarities: { 1: 'Common', 2: 'Rare', 3: 'Super rare', 4: 'Legendary', 5: 'Mythic' },
    missingCode: 'This link carries no binder: the "code" parameter is missing.',
    damaged: 'This binder cannot be read: the link is incomplete or has been damaged.',
  },
};

/** Text of this page for a key. */
const T = STRINGS[LANG];

/** Default number of slots of a page, used when a payload does not carry a slot list. */
const FALLBACK_SLOT_COUNT = 30;

/** Number of cards per row: a binder page is ALWAYS laid out on rows of three. */
const COLUMNS = 3;

/**
 * Resolves the `<lang>` placeholder of an illustration path.
 *
 * Mirrors `I18n.resolveImagePath` for the one token the card data uses; a bare path is returned
 * unchanged, so the helper is safe on a payload written by any version.
 *
 * @param {string} path - Illustration path of a card.
 * @returns {string} The path, with the language filled in.
 */
function resolvePath(path) {
  return typeof path === 'string' ? path.split('<lang>').join(LANG) : '';
}

/**
 * Picks the display name of a serialized card.
 *
 * @param {object} master - Compact card master of the payload.
 * @returns {string} The localized name, falling back to the id.
 */
function cardName(master) {
  const names = master?.n ?? {};
  return names[LANG] || names.fr || names.en || Object.values(names)[0] || master?.i || '—';
}

/**
 * Names the rarity of a card.
 *
 * @param {object} master - Compact card master of the payload.
 * @returns {string} The localized rarity, falling back to its number.
 */
function cardRarity(master) {
  const rarity = Number(master?.r);
  return T.rarities[rarity] ?? String(master?.r ?? '—');
}

/**
 * Names the printing of a card.
 *
 * @param {object} master - Compact card master of the payload.
 * @returns {string} "Full Art" or "Normal".
 */
function cardStyle(master) {
  return master?.s === 'fullart' ? T.fullart : T.classic;
}

/**
 * Names the extension of a card.
 *
 * The payload carries the display name of every extension it shows a card of (`sets`); a code
 * written before that field existed falls back to the raw id, which is still readable.
 *
 * @param {object} payload - Decoded binder payload.
 * @param {object} master - Compact card master of the payload.
 * @returns {string} The extension label.
 */
function cardSet(payload, master) {
  const setId = master?.e;
  if (typeof setId !== 'string' || setId === '') return '—';
  return payload.sets?.[setId] ?? setId;
}

/**
 * Builds one row of the card detail ("Rareté — Légendaire").
 *
 * @param {string} label - Row label.
 * @param {string} value - Row value.
 * @returns {HTMLElement} The row.
 */
function buildDetailRow(label, value) {
  const row = document.createElement('div');
  row.className = 'binder-share__row';
  const term = document.createElement('dt');
  term.className = 'binder-share__term';
  term.textContent = label;
  const definition = document.createElement('dd');
  definition.className = 'binder-share__value';
  definition.textContent = value;
  row.append(term, definition);
  return row;
}

/**
 * Opens the detail dialog of one card.
 *
 * @param {object} payload - Decoded binder payload.
 * @param {object} master - Compact card master of the payload.
 * @returns {void}
 */
function openCardDetail(payload, master) {
  const modal = document.querySelector('[data-binder-share-modal]');
  const title = document.querySelector('[data-binder-share-modal-title]');
  const body = document.querySelector('[data-binder-share-modal-body]');
  if (!modal || !body) return;

  const name = cardName(master);
  if (title) title.textContent = name;

  body.textContent = '';

  // The artwork, dressed with the foil of its rarity: the dialog shows the printing, not a copy of
  // it. `applyShine` needs the box to be a positioning context - `.binder-share__art` is.
  const art = document.createElement('div');
  art.className = 'binder-share__art';
  const image = document.createElement('img');
  image.className = 'binder-share__art-image';
  image.src = resolvePath(master?.l);
  image.alt = name;
  art.appendChild(image);
  applyShine(art, { rarity: Number(master?.r) || 1 });

  const rows = document.createElement('dl');
  rows.className = 'binder-share__rows';
  rows.append(
    buildDetailRow(T.rarity, cardRarity(master)),
    buildDetailRow(T.style, cardStyle(master)),
    buildDetailRow(T.set, cardSet(payload, master)),
    buildDetailRow(T.number, String(master?.i ?? '—'))
  );

  body.append(art, rows);

  const close = modal.querySelector('[data-binder-share-modal-close]');
  close?.setAttribute('aria-label', T.close);
  modal.hidden = false;
  close?.focus();
}

/**
 * Closes the card detail dialog.
 *
 * @returns {void}
 */
function closeCardDetail() {
  const modal = document.querySelector('[data-binder-share-modal]');
  if (modal) modal.hidden = true;
}

/**
 * Renders the page into the document.
 *
 * @param {object} payload - Decoded binder payload.
 * @returns {void}
 */
function render(payload) {
  const cards = Array.isArray(payload.cards) ? payload.cards : [];
  const slots = Array.isArray(payload.slots) ? payload.slots : [];
  const page = document.querySelector('[data-binder-share-page]');
  const list = document.querySelector('[data-binder-share-slots]');
  const title = document.querySelector('[data-binder-share-title]');
  const meta = document.querySelector('[data-binder-share-meta]');
  const identity = document.querySelector('[data-binder-share-identity]');
  const author = document.querySelector('[data-binder-share-author]');
  const avatar = document.querySelector('[data-binder-share-avatar]');
  const avatarFallback = document.querySelector('[data-binder-share-avatar-fallback]');
  const hint = document.querySelector('[data-binder-share-hint]');

  const filled = slots.reduce((count, value) => count + (value === null ? 0 : 1), 0);
  const total = slots.length || FALLBACK_SLOT_COUNT;

  document.title = `${payload.name || 'Binder'} — MineCards`;
  if (title) title.textContent = payload.name || 'Binder';
  if (meta) meta.textContent = T.cards(filled, total);

  // --- The identity of the author: the photo and the pseudo, and nothing more ----------------
  // The row is ALWAYS built, whatever the code carries: a link written before the payload carried
  // an author at all, or one shared from an account that has neither a name nor an avatar yet, is
  // still a page of somebody, and a binder that opens on a title with nobody above it reads as a
  // page that failed to load half of itself. An author without a picture gets the question mark of
  // the game's own profile page, and an author without a name gets the wording the game uses for
  // such a player (`profile.anonymous`). The picture is the chosen icon, or - for a save written
  // before the icons existed - the URL of the avatar it used to carry.
  const name = typeof payload.user?.name === 'string' ? payload.user.name.trim() : '';
  const icon = typeof payload.user?.icon === 'string' ? payload.user.icon.trim() : '';
  const photo = typeof payload.user?.photo === 'string' ? payload.user.photo.trim() : '';
  const picture = icon !== '' ? icon : photo;

  if (author) author.textContent = name !== '' ? name : T.anonymous;
  if (avatar) {
    avatar.hidden = picture === '';
    if (picture !== '') {
      avatar.src = picture;
      avatar.alt = '';
      // A picture that never arrives - the URL of an avatar of an older save, pointing at a host
      // that is long gone - must not leave the pill with the broken-image glyph of the browser:
      // the question mark takes over, which is also what an author without a picture gets.
      avatar.onerror = () => {
        avatar.hidden = true;
        if (avatarFallback) avatarFallback.hidden = false;
      };
    }
  }
  if (avatarFallback) avatarFallback.hidden = picture !== '';
  if (identity) identity.hidden = false;

  // --- The page ------------------------------------------------------------------------------
  // The backdrop of the page is the `Background` image of the representative card.
  const cover = cards[payload.cover ?? -1];
  if (page && cover?.b) {
    page.style.setProperty('--binder-backdrop', `url("${cover.b}")`);
  }

  if (hint) {
    hint.hidden = filled === 0;
    hint.textContent = T.hint;
  }

  if (!list) return;

  // Trailing empty rows are dropped: a five-card binder is a two-row page, not thirty squares.
  let lastFilled = -1;
  slots.forEach((value, index) => {
    if (value !== null) lastFilled = index;
  });
  const rows = Math.max(1, Math.ceil((lastFilled + 1) / COLUMNS));
  const shown = Math.min(total, rows * COLUMNS);

  list.textContent = '';
  for (let index = 0; index < shown; index += 1) {
    const cell = document.createElement('li');
    const master = cards[slots[index] ?? -1] ?? null;

    if (master) {
      // A filled slot is a BUTTON: a shared card opens its detail, which is the only interaction
      // this page offers. The foil of its rarity is painted on the slot itself, exactly like the
      // binder of the game does (`CollectionView.renderBinderEditor`).
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'binder-slot binder-slot--shared is-filled';
      // The rarity is duplicated on the slot as a plain class, exactly like `minepick__mini--r5` or
      // `card-reveal__card--r5`: the stylesheet of a page component never has to know what a card
      // master is, and a rule can key on the rarity without parsing `--r` off another class.
      button.classList.add(`binder-slot--r${Number(master.r) || 1}`);
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-label', cardName(master));

      const image = document.createElement('img');
      image.className = 'binder-slot__image';
      image.src = resolvePath(master.l);
      image.alt = '';
      image.loading = 'lazy';
      button.appendChild(image);
      applyShine(button, { rarity: Number(master.r) || 1 });

      button.addEventListener('click', () => {
        button.setAttribute('aria-expanded', 'true');
        openCardDetail(payload, master);
      });
      cell.appendChild(button);
    } else {
      // An empty slot of a shared page is inert: it is a hole of the layout, not a button.
      const hole = document.createElement('span');
      hole.className = 'binder-slot is-empty';
      hole.setAttribute('aria-hidden', 'true');
      cell.appendChild(hole);
    }

    list.appendChild(cell);
  }
}

/**
 * Displays the error message of an unusable share link.
 *
 * @param {string} message - Message to display.
 * @returns {void}
 */
function renderError(message) {
  const panel = document.querySelector('.binder-share__panel');
  const empty = document.querySelector('[data-binder-share-empty]');
  document.querySelector('[data-binder-share-page]')?.remove();
  if (empty) {
    empty.hidden = false;
    empty.textContent = message;
  }
  console.warn('[binder-share]', message);
  if (panel) panel.dataset.state = 'error';
}

/**
 * Binds the dialog: a click on the veil or on the close button dismisses the detail, Escape too.
 *
 * The page has no other script, so the listeners are added once, here, rather than in a component.
 *
 * @returns {void}
 */
function bindCardDetail() {
  const modal = document.querySelector('[data-binder-share-modal]');
  if (!modal) return;
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeCardDetail();
  });
  modal.querySelector('[data-binder-share-modal-close]')?.addEventListener('click', closeCardDetail);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeCardDetail();
  });
}

async function main() {
  const code = readBinderCodeFromUrl();
  if (code === '') {
    renderError(T.missingCode);
    return;
  }

  try {
    bindCardDetail();
    render(await decodeBinderCode(code));
  } catch (error) {
    console.error('[binder-share] The binder code could not be read.', error);
    renderError(T.damaged);
  }
}

void main();
