/**
 * cards.js - The cards of the show, built the way the game builds them.
 *
 * Reference: `js/classes/Card.js` (the value object and `fromSetEntry`),
 * `js/UI/components/CardPrint.js` (the generated printing) and
 * `js/utils/CardGenerateManager.js` (the shipped design, applied with its defaults).
 *
 * A card is never hard-coded here: `assets.json` names a set and an `Index`, this module resolves
 * it against `data/boosters/<set>.json` and hands `<card-print>` the real card object. The artwork,
 * the underlay, the name, the description and the rarity are therefore the ones of the game, and
 * the demo shows the generated source (`settings.cardSource: "generate"`) with the default design.
 */

import { Card } from '../../../js/classes/Card.js';
import { CardPrint } from '../../../js/UI/components/CardPrint.js';
import { applyCardGenerateSettings } from '../../../js/utils/CardGenerateManager.js';
import { resolve, state, create } from './core.js';

/** Rarity of a card, exposed for the scenes that style a frame from it. */
export const RARITY_COLORS = Object.freeze({
  1: '#a0a0b0',
  2: '#4dd0e1',
  3: '#a855f7',
  4: '#e0a63a',
  5: '#f472b6',
  6: '#c25700',
});

/**
 * Fetches and parses one JSON file.
 *
 * @param {string} path - Project-relative path.
 * @returns {Promise<unknown>} The parsed value.
 * @throws {Error} When the response is not a success.
 */
export async function fetchJson(path) {
  const response = await fetch(resolve(path));
  if (!response.ok) {
    throw new Error(`${path} answered ${response.status}.`);
  }
  return response.json();
}

/**
 * Splits a `set:Index` reference of `assets.json`.
 *
 * @param {string} reference - Example: `A1:SERIE-A1 / W001`.
 * @returns {{set: string, index: string}} Both halves.
 * @throws {Error} When the reference has no set prefix.
 */
export function parseReference(reference) {
  const separator = String(reference).indexOf(':');
  if (separator <= 0) {
    throw new Error(`"${reference}" is not a <set>:<Index> card reference.`);
  }
  return {
    set: reference.slice(0, separator).trim(),
    index: reference.slice(separator + 1).trim(),
  };
}

/**
 * Library of the cards of one show: the catalogues, indexed by set and `Index`.
 */
export class CardLibrary {
  /**
   * @param {Map<string, Map<string, Card>>} catalogues - Cards of each set, by `Index`.
   * @param {string} lang - Language of the card texts.
   */
  constructor(catalogues, lang) {
    /** @type {Map<string, Map<string, Card>>} */
    this.catalogues = catalogues;
    /** @type {string} */
    this.lang = lang;
  }

  /**
   * Loads every set named by `assets.json`.
   *
   * @param {object} assets - Parsed `demo/assets.json`.
   * @param {string} lang - Language of the card texts.
   * @returns {Promise<CardLibrary>} The loaded library.
   */
  static async load(assets, lang) {
    const catalogues = new Map();
    const sets = assets.sets ?? {};
    const entries = Object.entries(sets);
    const loaded = await Promise.all(
      entries.map(async ([setId, entry]) => {
        const catalogue = await fetchJson(entry.data);
        const cards = new Map();
        (catalogue.Cards ?? []).forEach((raw) => {
          cards.set(raw.Index, Card.fromSetEntry(raw, { set: setId }));
        });
        return [setId, cards];
      })
    );
    loaded.forEach(([setId, cards]) => catalogues.set(setId, cards));
    return new CardLibrary(catalogues, lang);
  }

  /**
   * Resolves one `set:Index` reference.
   *
   * @param {string} reference - Reference written in `assets.json`.
   * @returns {Card} The card.
   * @throws {Error} When the set or the card is unknown.
   */
  get(reference) {
    const { set, index } = parseReference(reference);
    const catalogue = this.catalogues.get(set);
    if (!catalogue) throw new Error(`Unknown set "${set}".`);
    const card = catalogue.get(index);
    if (!card) throw new Error(`Unknown card "${index}" in set "${set}".`);
    return card;
  }

  /**
   * Builds the visual of one card: a `.demo__card` box around a generated `<card-print>`.
   *
   * @param {string} reference - Reference written in `assets.json`.
   * @param {object} [options] - Display options.
   * @param {string} [options.className] - Extra class of the box.
   * @param {boolean} [options.animated=false] - Let the two layers of the card move.
   * @returns {HTMLElement} The box, ready to append.
   */
  build(reference, { className = '', animated = false } = {}) {
    const card = this.get(reference);
    const box = create('div', `demo__card${className ? ` ${className}` : ''}`);
    box.dataset.rarity = String(card.rarity);
    box.style.setProperty('--rarity-color', RARITY_COLORS[card.rarity] ?? RARITY_COLORS[1]);

    const print = new CardPrint();
    print.setAttribute('aria-hidden', 'true');
    print.setAttribute('title', card.getName(this.lang));
    print.setCard(card, { lang: this.lang });
    print.setAnimatedLayers(animated);
    print.setAnimatedLayersView(animated);
    box.append(print);
    return box;
  }

  /**
   * Lists every picture the cards of one list need.
   *
   * @param {string[]} references - References written in `assets.json`.
   * @returns {string[]} Absolute URLs of the backgrounds and underlays.
   */
  images(references) {
    const urls = new Set();
    references.forEach((reference) => {
      const card = this.get(reference);
      [card.background, card.underlay].forEach((url) => {
        if (typeof url === 'string' && url !== '') urls.add(url);
      });
    });
    return [...urls];
  }
}

/**
 * Applies the shipped generated-card design once, with its default parameters.
 *
 * @returns {void}
 */
export function applyDefaultDesign() {
  applyCardGenerateSettings({});
}

/**
 * Preloads a list of pictures with a small pool of requests.
 *
 * A picture that fails, times out or is blocked never blocks the show: it is counted as loaded so
 * the loader can finish, and the card keeps the gradient of its box.
 *
 * @param {string[]} urls - Absolute or relative picture URLs.
 * @param {object} [options] - Preload options.
 * @param {(done: number, total: number) => void} [options.onProgress] - Called after each picture.
 * @param {number} [options.concurrency=8] - Parallel requests.
 * @param {number} [options.timeout=15000] - Per-picture timeout, in milliseconds.
 * @returns {Promise<{loaded: number, failed: number, total: number}>} The counters.
 */
export async function preloadImages(urls, options = {}) {
  const { onProgress = null, concurrency = 8, timeout = 15000 } = options;
  const unique = [...new Set(urls)];
  const total = unique.length;
  let done = 0;
  let failed = 0;
  let cursor = 0;

  /**
   * Loads one picture.
   *
   * @param {string} url - Picture URL.
   * @returns {Promise<void>} Resolves when the picture settled.
   */
  const loadOne = (url) =>
    new Promise((resolveLoad) => {
      const image = new Image();
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (!ok) failed += 1;
        image.onload = null;
        image.onerror = null;
        resolveLoad();
      };
      const timer = window.setTimeout(() => finish(false), timeout);
      image.onload = () => finish(true);
      image.onerror = () => finish(false);
      image.decoding = 'async';
      image.src = url.startsWith('http') ? url : resolve(url);
    });

  /**
   * Pulls the next picture of the queue.
   *
   * @returns {Promise<void>} Resolves when the queue is empty.
   */
  const worker = async () => {
    while (cursor < total) {
      const index = cursor;
      cursor += 1;
      await loadOne(unique[index]);
      done += 1;
      if (onProgress) onProgress(done, total);
    }
  };

  if (total === 0) return { loaded: 0, failed: 0, total: 0 };
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));
  return { loaded: done, failed, total };
}
