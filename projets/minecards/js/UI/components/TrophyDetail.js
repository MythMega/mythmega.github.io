/**
 * TrophyDetail - Shared rendering of a trophy: title, medal, badge and detail modal body.
 *
 * Reference: `js/business/TrophyManager.js` (trophy state) and `js/business/ProfileIconManager.js`
 * (the icons a trophy unlocks).
 *
 * The trophy catalogue and the pinned trophies of the profile are TWO different screens (a router
 * view and a panel), yet a trophy must look and read exactly the same on both. Everything they
 * share therefore lives here: the title/description resolution, the medal, the pin icon button, the
 * detail rows, the required cards of a collection trophy (in colour when owned, in black and white
 * otherwise) and the avatars the trophy unlocks.
 *
 * This module owns no state: it only builds DOM from a trophy state, which keeps both views free of
 * duplicated markup.
 */

import i18n from '../../utils/I18n.js';
import { DEFAULT_TROPHY_ICON, resolveTrophyIcon } from '../../business/TrophyManager.js';

/** Icon of the "pin this trophy" action. */
export const TROPHY_PIN_ICON = 'assets/img/pin.png';

/** Icon of the "unpin this trophy" action. */
export const TROPHY_UNPIN_ICON = 'assets/img/unpin.png';

export class TrophyDetail {
  /**
   * Translated label of a trophy rarity.
   *
   * @param {string} rarity - Rarity id (`bronze` … `emerald`).
   * @returns {string} The label, falling back to the raw value.
   */
  static rarityLabel(rarity) {
    return i18n.t(`trophy.rarity.${rarity}`);
  }

  /**
   * Builds the interpolation values shared by the title and the description.
   *
   * @param {object} trophy - Trophy state.
   * @returns {object} `{ set, rarity, ...params }`.
   */
  static buildParams(trophy) {
    const params = { ...(trophy.params ?? {}) };
    params.set = trophy.setName ?? '';
    params.rarity = TrophyDetail.rarityLabel(trophy.rarity);
    // A trophy measured against one block of the mine carries the names of that block in the two
    // languages of the game (the mine files them in its own JSON, not in the dictionaries).
    if (trophy.blockNames) {
      params.block = trophy.blockNames[i18n.getLang()] ?? trophy.blockNames.en ?? params.block ?? '';
    }
    // A Mine Pick trophy measured against one card rarity names it through the dictionaries
    // (`rarity.1` … `rarity.5`), never through a label frozen at build time: switching the language
    // must relabel the trophy along with the rest of the screen. `params.rarity` is already taken by
    // the trophy's own rarity (`bronze` … `emerald`), hence the separate placeholder.
    if (trophy.cardRarityKey) {
      params.cardRarity = i18n.t(trophy.cardRarityKey);
    }
    return params;
  }

  /**
   * Resolves the display title of a trophy.
   *
   * The recurring tiers are named through the dictionaries (`trophy.booster.completion.title`…),
   * while a collection trophy keeps the `Name` of its JSON file (documented as language-neutral).
   *
   * @param {object} trophy - Trophy state.
   * @returns {string} The title.
   */
  static trophyTitle(trophy) {
    const params = TrophyDetail.buildParams(trophy);
    if (trophy.titleKey) return i18n.t(trophy.titleKey, params);
    return typeof trophy.name === 'string' && trophy.name !== '' ? trophy.name : i18n.t('trophy.unknown');
  }

  /**
   * Resolves the progress line of a trophy.
   *
   * @param {object} trophy - Trophy state.
   * @returns {string} The description.
   */
  static trophyDescription(trophy) {
    return i18n.t(trophy.descriptionKey, TrophyDetail.buildParams(trophy));
  }

  /**
   * Resolves the XP a trophy granted (its own `Experience`, or the value of its rarity).
   *
   * @param {object} trophy - Trophy state.
   * @param {Record<string, number>} [experiencePerTrophy] - `ExperiencePerTrophy` of the config.
   * @returns {number} The experience value.
   */
  static resolveExperience(trophy, experiencePerTrophy = null) {
    if (Number.isInteger(trophy.experience) && trophy.experience > 0) return trophy.experience;
    const byRarity = experiencePerTrophy?.[trophy.rarity];
    return Number.isInteger(byRarity) ? byRarity : 0;
  }

  /**
   * Builds the medal image of a trophy.
   *
   * The image is decorative (the title next to it already names the trophy). A trophy whose
   * catalogue entry declares no image — and a file that cannot be loaded, a typo in the data or an
   * extension that ships none yet — falls back to the DEFAULT medal instead of leaving a hole. Only
   * if that default is missing too is the image hidden, so no broken-image icon is ever shown.
   *
   * @param {object} trophy - Trophy state.
   * @param {string} [className='trophy__icon'] - Class of the image.
   * @returns {HTMLImageElement} The image, ready to be inserted.
   */
  static buildMedal(trophy, className = 'trophy__icon') {
    const image = document.createElement('img');
    image.className = className;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.src = resolveTrophyIcon(trophy?.icon);
    image.alt = '';
    image.setAttribute('aria-hidden', 'true');
    image.addEventListener('error', () => {
      // `image.src` is absolute by now: the default is recognized by its tail.
      if (image.src.endsWith(DEFAULT_TROPHY_ICON)) {
        console.warn('[TrophyDetail] The default trophy medal is missing.');
        image.hidden = true;
        return;
      }
      console.warn(`[TrophyDetail] Trophy medal not found: ${image.src} (default medal shown instead).`);
      image.src = DEFAULT_TROPHY_ICON;
    });
    return image;
  }

  /**
   * Builds the rarity badge of a trophy.
   *
   * @param {object} trophy - Trophy state.
   * @returns {HTMLSpanElement} The badge.
   */
  static buildRarityBadge(trophy) {
    const badge = document.createElement('span');
    badge.className = 'trophy__rarity';
    badge.dataset.rarity = trophy.rarity;
    badge.textContent = TrophyDetail.rarityLabel(trophy.rarity);
    return badge;
  }

  /**
   * Builds a square icon button (pin, unpin…).
   *
   * The icons are decorative images the stylesheet sizes; the accessible name lives on the button,
   * so a screen reader announces "Épingler"/"Retirer" and never the file name.
   *
   * @param {object} options - Button options.
   * @param {string} options.className - Class of the button.
   * @param {string} options.datasetKey - `data-*` key carrying the trophy id (`trophyPin`).
   * @param {string} options.value - Trophy id.
   * @param {string} options.icon - Image path.
   * @param {string} options.label - Translated accessible label.
   * @param {boolean} [options.pressed] - Value of `aria-pressed`, when the button is a toggle.
   * @returns {HTMLButtonElement} The button.
   */
  static buildIconButton({ className, datasetKey, value, icon, label, pressed = undefined }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.dataset[datasetKey] = value;
    button.title = label;
    button.setAttribute('aria-label', label);
    if (pressed !== undefined) {
      button.setAttribute('aria-pressed', String(pressed));
    }

    const image = document.createElement('img');
    image.className = 'profile__icon';
    image.src = icon;
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.setAttribute('aria-hidden', 'true');
    image.addEventListener('error', () => {
      console.warn(`[TrophyDetail] Icon not found: ${image.src}`);
      image.hidden = true;
    });
    button.appendChild(image);
    return button;
  }

  /**
   * Builds one `<div><dt>term</dt><dd>value</dd></div>` row of a detail list.
   *
   * @param {string} term - Label.
   * @param {string} value - Value.
   * @returns {HTMLElement} The row.
   */
  static buildDetailRow(term, value) {
    const wrapper = document.createElement('div');
    wrapper.className = 'card-modal__row';
    const keyElement = document.createElement('dt');
    keyElement.textContent = term;
    const valueElement = document.createElement('dd');
    valueElement.textContent = value;
    wrapper.append(keyElement, valueElement);
    return wrapper;
  }

  /**
   * Formats an ISO timestamp for the current language.
   *
   * @param {string} value - ISO date.
   * @returns {string} The formatted date.
   */
  static formatDate(value) {
    const time = Date.parse(value);
    if (Number.isNaN(time)) return String(value);
    try {
      return new Intl.DateTimeFormat(i18n.getLang(), { dateStyle: 'medium' }).format(new Date(time));
    } catch (error) {
      console.warn(`[TrophyDetail] Date formatting failed for "${value}".`, error);
      return String(value);
    }
  }

  /**
   * Builds the progress bar of a trophy.
   *
   * @param {object} trophy - Trophy state.
   * @param {string} [className='trophy__track'] - Class of the track.
   * @returns {HTMLDivElement} The track, filled to the trophy progress.
   */
  static buildProgress(trophy, className = 'trophy__track') {
    const percent = Math.round((trophy.progress ?? 0) * 100);
    const track = document.createElement('div');
    track.className = className;
    const fill = document.createElement('div');
    fill.className = 'trophy__fill';
    fill.style.width = `${percent}%`;
    fill.setAttribute('role', 'progressbar');
    fill.setAttribute('aria-valuemin', '0');
    fill.setAttribute('aria-valuemax', '100');
    fill.setAttribute('aria-valuenow', String(percent));
    fill.setAttribute('aria-label', TrophyDetail.trophyTitle(trophy));
    track.appendChild(fill);
    return track;
  }

  /**
   * Builds the complete body of a trophy detail modal.
   *
   * @param {object} trophy - Trophy state.
   * @param {object} [options] - Body options.
   * @param {Record<string, number>} [options.experiencePerTrophy] - `ExperiencePerTrophy` of the config.
   * @param {object[]} [options.icons] - Icons the trophy unlocks (`ProfileIconManager.getIconsForTrophy`).
   * @returns {DocumentFragment} The body content, ready to replace the modal body.
   */
  static buildDetailBody(trophy, { experiencePerTrophy = null, icons = [] } = {}) {
    const fragment = document.createDocumentFragment();

    const header = document.createElement('div');
    header.className = 'trophy-modal__header';
    const medal = TrophyDetail.buildMedal(trophy, 'trophy-modal__medal');
    if (medal) header.appendChild(medal);
    header.appendChild(TrophyDetail.buildRarityBadge(trophy));

    const category = document.createElement('span');
    category.className = 'trophy-modal__category';
    category.textContent = i18n.t(`trophy.category.${trophy.category}`);
    header.appendChild(category);
    fragment.appendChild(header);

    const description = document.createElement('p');
    description.className = 'trophy-modal__text';
    description.textContent = TrophyDetail.trophyDescription(trophy);
    fragment.appendChild(description);
    fragment.appendChild(TrophyDetail.buildProgress(trophy));

    const list = document.createElement('dl');
    list.className = 'card-modal__details';
    const rows = [
      [i18n.t('opening.card.set'), trophy.setName ?? i18n.t('trophies.globalScope')],
      [i18n.t('collection.filter.status'), trophy.unlocked ? i18n.t('trophy.unlocked') : i18n.t('trophy.locked')],
    ];
    if (trophy.unlocked) {
      rows.push([
        i18n.t('trophies.xpEarned'),
        i18n.t('info.experience.value', {
          experience: TrophyDetail.resolveExperience(trophy, experiencePerTrophy),
        }),
      ]);
      rows.push([
        i18n.t('trophies.unlockedAt'),
        trophy.unlockedAt ? TrophyDetail.formatDate(trophy.unlockedAt) : i18n.t('common.unknown'),
      ]);
    }
    rows.forEach(([term, value]) => list.appendChild(TrophyDetail.buildDetailRow(term, value)));
    fragment.appendChild(list);

    const cards = TrophyDetail.buildRequiredCards(trophy);
    if (cards) fragment.appendChild(cards);

    const iconsSection = TrophyDetail.buildUnlockedIcons(icons);
    if (iconsSection) fragment.appendChild(iconsSection);

    return fragment;
  }

  /**
   * Builds the "required cards" block of a collection trophy.
   *
   * Every required index shows the card the requirement designates: the owned printing when the
   * player has one (in full colour), the expected printing otherwise (in black and white). A
   * recurring tier has no card list, so this block is simply absent.
   *
   * @param {object} trophy - Trophy state.
   * @returns {HTMLElement|null} The block, or null when the trophy requires no specific card.
   */
  static buildRequiredCards(trophy) {
    const required = Array.isArray(trophy.requiredCards) ? trophy.requiredCards : [];
    if (required.length === 0) return null;

    const section = document.createElement('section');
    section.className = 'trophy-modal__section';
    section.dataset.trophyCards = String(required.length);

    const title = document.createElement('h3');
    title.className = 'trophy-modal__section-title';
    title.textContent = i18n.t('trophy.cards.title', { count: required.length });
    section.appendChild(title);

    const grid = document.createElement('ul');
    grid.className = 'trophy-modal__cards';
    required.forEach((entry, index) => {
      const item = document.createElement('li');
      item.className = 'trophy-card';
      item.dataset.trophyCard = entry.index;
      item.dataset.owned = String(Boolean(entry.owned));
      item.style.setProperty('--tile-index', String(index));

      const card = entry.card;
      const name = card ? card.getName(i18n.getLang()) : entry.index;
      if (card) {
        const image = document.createElement('img');
        image.className = 'trophy-card__image';
        image.loading = 'lazy';
        image.decoding = 'async';
        image.src = i18n.resolveImagePath(card.illustration);
        image.alt = '';
        image.setAttribute('aria-hidden', 'true');
        image.addEventListener('error', () => {
          console.warn(`[TrophyDetail] Required card illustration not found for "${entry.index}": ${image.src}`);
          image.hidden = true;
        });
        item.appendChild(image);
      }

      const caption = document.createElement('span');
      caption.className = 'trophy-card__name';
      caption.textContent = name;
      item.appendChild(caption);

      item.setAttribute(
        'aria-label',
        `${name}, ${i18n.t(entry.owned ? 'trophy.cards.owned' : 'trophy.cards.missing')}`
      );
      grid.appendChild(item);
    });
    section.appendChild(grid);
    return section;
  }

  /**
   * Builds the "unlocked avatars" block of a trophy.
   *
   * @param {object[]} icons - Icons the trophy grants (`{ name, file, unlocked }`).
   * @returns {HTMLElement|null} The block, or null when the trophy grants no avatar.
   */
  static buildUnlockedIcons(icons) {
    const list = Array.isArray(icons) ? icons : [];
    if (list.length === 0) return null;

    const section = document.createElement('section');
    section.className = 'trophy-modal__section';
    section.dataset.trophyIcons = String(list.length);

    const title = document.createElement('h3');
    title.className = 'trophy-modal__section-title';
    title.textContent = i18n.t('trophy.icons.title', { count: list.length });
    section.appendChild(title);

    const grid = document.createElement('ul');
    grid.className = 'trophy-modal__icons';
    list.forEach((icon, index) => {
      const item = document.createElement('li');
      item.className = 'trophy-icon';
      item.dataset.owned = String(Boolean(icon.unlocked));
      item.style.setProperty('--tile-index', String(index));

      const image = document.createElement('img');
      image.className = 'trophy-icon__image';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.src = i18n.resolveImagePath(icon.file);
      image.alt = '';
      image.setAttribute('aria-hidden', 'true');
      image.addEventListener('error', () => {
        console.warn(`[TrophyDetail] Unlocked icon not found: ${image.src}`);
        image.hidden = true;
      });
      item.appendChild(image);

      const caption = document.createElement('span');
      caption.className = 'trophy-icon__name';
      caption.textContent = icon.name;
      item.appendChild(caption);

      item.setAttribute(
        'aria-label',
        `${icon.name}, ${i18n.t(icon.unlocked ? 'trophy.icons.unlocked' : 'trophy.icons.locked')}`
      );
      grid.appendChild(item);
    });
    section.appendChild(grid);
    return section;
  }
}

export default TrophyDetail;
