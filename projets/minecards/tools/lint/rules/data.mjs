/**
 * data.mjs - The rules of the game data: the card catalogues, every file that names a card, and the
 * settings that price them.
 *
 * A card is one `Index` printed in one `Layout` (`classic` or `fullart`). That pair is the identity
 * of an impression, because the collection key is built from it (`Card.uniqueKey`): the same index
 * may exist once per layout, never twice in the same one, in any catalogue. A duplicate silently
 * merges two cards into one entry no screen can show, which is why it is a rule and not a review.
 *
 * The rest follows the same line: a file naming a card, a trophy, an icon or a resource must name
 * one that exists, and the settings must agree with the data they describe. Directories are read
 * from `settings/config.json`, like the game reads them; the shape of each file is described in
 * `.docs/projet/04-donnees-et-configuration.md`.
 */

/** Settings files read by more than one rule below. */
const CONFIG_FILE = 'settings/config.json';
const CARDSETS_FILE = 'settings/cardsets.json';
const CODES_FILE = 'settings/codes.json';
const MINING_FILE = 'settings/mining.json';
const RARITY_FILE = 'settings/defaultRarity.json';
const PINNED_OFFERS_FILE = 'data/shop/pinned_offers.json';

/** Print layouts a card may declare. */
const LAYOUTS = new Set(['classic', 'fullart']);

/** Requirement layouts of a trophy: `any` accepts either printing. */
const REQUIREMENT_LAYOUTS = new Set(['any', 'classic', 'fullart']);

const TROPHY_RARITIES = new Set(['bronze', 'silver', 'gold', 'diamond', 'emerald']);

/** A calendar day, as every date of the project is written. */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Reward kinds a redeem code understands. */
const REWARD_TYPES = new Set(['Booster', 'Card', 'Sparks']);

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** True for a string that still holds something once trimmed. */
const isFilled = (value) => typeof value === 'string' && value.trim() !== '';

const isIntegerBetween = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

/**
 * The languages a record is translated in: `Name_FR` and `Desc_EN` give `['EN', 'FR']`.
 *
 * @param {object} record - Object to read.
 * @param {string} prefix - Field name without its language (`Name`, `Desc`).
 * @returns {string[]} The language codes, sorted.
 */
function localisedLanguages(record, prefix) {
  return Object.keys(record)
    .filter((key) => key.startsWith(`${prefix}_`) && /^[A-Z]{2,3}$/.test(key.slice(prefix.length + 1)))
    .map((key) => key.slice(prefix.length + 1))
    .sort();
}

/**
 * Line of a fragment in a text, or the line it was searched from when it is not found.
 *
 * A diagnostic has to point at the entry it talks about, and `JSON.parse` loses positions: each
 * caller therefore looks its fragment up from the block it already located (`from`), so a value
 * repeated in two entries still points at the right one.
 *
 * @param {string} text - Raw content of the file.
 * @param {string} needle - Fragment to look for, quotes included.
 * @param {number} [from=0] - Offset to start the search from.
 * @returns {number} The 1-based line number.
 */
function lineAt(text, needle, from = 0) {
  const index = isFilled(needle) ? text.indexOf(needle, from) : -1;
  const offset = index >= 0 ? index : Math.max(0, from);
  if (offset <= 0) return 1;
  return text.slice(0, offset).split('\n').length;
}

/** Reads a JSON file, or null: `data/json` already reports the ones that do not parse. */
function readOrNull(context, file) {
  try {
    return context.readJsonValue(file);
  } catch (error) {
    return null;
  }
}

/** Directories and paths the game reads from `settings/config.json`, with the code's fallbacks. */
function readPaths(context) {
  const config = readOrNull(context, CONFIG_FILE);
  const root = isRecord(config) ? config : {};
  const boosters = isRecord(root.boosters) ? root.boosters : {};
  const promos = isRecord(root.promos) ? root.promos : {};
  const trophies = isRecord(root.trophies) ? root.trophies : {};
  const profileIcons = isRecord(root.profileIcons) ? root.profileIcons : {};
  const titles = isRecord(root.titles) ? root.titles : {};
  const path = (value, fallback) => (isFilled(value) ? value : fallback);
  return {
    boosters: path(boosters.directory, 'data/boosters'),
    promos: path(promos.directory, 'data/promo_cards'),
    trophies: path(trophies.directory, 'data/trophies'),
    iconFile: path(profileIcons.unlockablePath, 'data/icon.json'),
    iconsDirectory: path(profileIcons.directory, 'data/profile_icons'),
    titlesDirectory: path(titles.directory, 'data/titles'),
    titlesFile: path(titles.defaultPath, 'settings/default_titles.json'),
  };
}

/** The `.json` files of a project directory, without their directory, in alphabetical order. */
function listJsonFiles(context, directory) {
  return context
    .listDirectory(directory)
    .filter((name) => name.endsWith('.json'))
    .sort();
}

/** Every card catalogue, with the set its file name stands for (`data/boosters/A1.json` is `A1`). */
function listCatalogues(context) {
  const { boosters, promos } = readPaths(context);
  const found = [];
  listJsonFiles(context, boosters).forEach((name) => {
    found.push({ file: `${boosters}/${name}`, setId: name.slice(0, -'.json'.length), kind: 'booster' });
  });
  listJsonFiles(context, promos).forEach((name) => {
    found.push({ file: `${promos}/${name}`, setId: name.slice(0, -'.json'.length), kind: 'promo' });
  });
  return found;
}

/** Cards of a catalogue: `Cards` for a booster, `Card` for a promo (`Card.fromAnySchema`). */
function readCards(context, catalogue) {
  const root = readOrNull(context, catalogue.file);
  if (!isRecord(root)) return null;
  if (Array.isArray(root.Cards)) return root.Cards;
  if (Array.isArray(root.Card)) return root.Card;
  return null;
}

/** Fragment that finds a card in its catalogue; `Path` is what tells two printings of an index apart. */
function cardNeedle(card) {
  if (isRecord(card) && isFilled(card.Path)) return `"Path": ${JSON.stringify(card.Path)}`;
  if (isRecord(card) && typeof card.Index === 'string') return `"Index": ${JSON.stringify(card.Index)}`;
  return '"Index"';
}

/** Every declared index, with the layouts it is printed in. */
function readCardIndex(context) {
  const index = new Map();
  listCatalogues(context).forEach((catalogue) => {
    const cards = readCards(context, catalogue);
    if (cards === null) return;
    cards.forEach((card) => {
      if (!isRecord(card) || typeof card.Index !== 'string') return;
      if (!index.has(card.Index)) index.set(card.Index, new Set());
      if (typeof card.Layout === 'string') index.get(card.Index).add(card.Layout);
    });
  });
  return index;
}

/** The sets declared by `settings/cardsets.json`, or null when the file lists none. */
function readSets(context) {
  const root = readOrNull(context, CARDSETS_FILE);
  if (!isRecord(root) || !Array.isArray(root.sets)) return null;
  return root.sets.filter(isRecord);
}

/** Language codes of the dictionaries (`['fr', 'en']`). */
function readLanguages(context) {
  const config = readOrNull(context, CONFIG_FILE);
  const languages = isRecord(config) ? config.languages : null;
  if (!Array.isArray(languages)) return [];
  return languages.map((entry) => (isRecord(entry) ? entry.code : null)).filter(isFilled);
}

/** True for a day that exists, not just for one written `YYYY-MM-DD`. */
function isDay(value) {
  if (!isFilled(value) || !DAY_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export default [
  {
    id: 'data/card-catalogue',
    summary: 'A card is complete, and its index, layout and image path agree.',
    severity: 'error',
    /** Walks every catalogue, card by card. */
    run(context) {
      const config = readOrNull(context, CONFIG_FILE);
      const defaultLang =
        isRecord(config) && typeof config.defaultLang === 'string' ? config.defaultLang.toUpperCase() : '';

      listCatalogues(context).forEach((catalogue) => {
        const cards = readCards(context, catalogue);
        if (cards === null) {
          context.report({
            file: catalogue.file,
            line: 1,
            column: 1,
            message: 'no "Cards" (booster) or "Card" (promo) array: the catalogue declares no card',
          });
          return;
        }
        if (cards.length === 0) {
          context.report({ file: catalogue.file, line: 1, column: 1, message: 'the catalogue is empty' });
          return;
        }

        const text = context.readText(catalogue.file);
        const prefix = `${catalogue.kind === 'promo' ? 'PROMO' : 'SERIE'}-${catalogue.setId} / `;

        cards.forEach((card, position) => {
          const label = `card #${position + 1}`;
          if (!isRecord(card)) {
            context.report({
              file: catalogue.file,
              line: lineAt(text, '"Index"'),
              column: 1,
              message: `${label} is not an object`,
            });
            return;
          }

          const line = lineAt(text, cardNeedle(card));
          const fail = (message, severity) =>
            context.report({ file: catalogue.file, line, column: 1, message, severity });

          const index = card.Index;
          const named = isFilled(index);
          if (!named) {
            fail(`${label} has no Index`);
          } else if (!index.startsWith(prefix) || index.slice(prefix.length).trim() === '') {
            fail(`${label} index "${index}" does not start with "${prefix}"`);
          }

          const layout = card.Layout;
          const knownLayout = typeof layout === 'string' && LAYOUTS.has(layout);
          if (!knownLayout) {
            fail(`${label} layout ${JSON.stringify(layout)} is not "classic" or "fullart"`);
          }

          if (!isIntegerBetween(card.Rarity, 1, 5)) {
            fail(`${label} rarity ${JSON.stringify(card.Rarity)} is not an integer from 1 to 5`);
          }
          if (!isFilled(card.Style)) fail(`${label} has no Style`);

          const path = card.Path;
          if (!isFilled(path)) {
            fail(`${label} has no Path`);
          } else {
            if (!path.includes('<lang>')) fail(`${label} path has no <lang> placeholder`);
            if (knownLayout && named) {
              const expected = `${index.replace(/\s*\/\s*/, ' _ ')}_${layout}.png`;
              const actual = path.slice(path.lastIndexOf('/') + 1);
              if (actual !== expected) {
                fail(`${label} path "${actual}" does not match its index and layout ("${expected}")`);
              }
            }
          }

          const nameLangs = localisedLanguages(card, 'Name');
          const descLangs = localisedLanguages(card, 'Desc');
          if (nameLangs.length === 0) fail(`${label} has no Name_XX`);
          if (defaultLang !== '' && !nameLangs.includes(defaultLang)) {
            fail(`${label} has no Name_${defaultLang} for the default language`);
          }
          if (nameLangs.join() !== descLangs.join()) {
            fail(
              `${label} declares names in [${nameLangs.join(', ')}] but descriptions in [${descLangs.join(', ')}]`
            );
          }
          nameLangs.forEach((code) => {
            if (!isFilled(card[`Name_${code}`])) fail(`${label} has an empty Name_${code}`);
          });
          descLangs.forEach((code) => {
            if (!isFilled(card[`Desc_${code}`])) fail(`${label} has an empty Desc_${code}`);
          });

          ['Background', 'Underlay'].forEach((field) => {
            const value = card[field];
            // An absent backdrop is a card the game draws without one; a relative one is a picture
            // that will not load from another page of the site, hence a warning rather than an error.
            if (value === undefined || value === null) return;
            if (typeof value !== 'string') {
              fail(`${label} ${field} must be a string`, 'warning');
              return;
            }
            if (value.trim() === '') return;
            if (!/^https?:\/\//.test(value)) {
              fail(`${label} ${field} is not an absolute http(s) URL`, 'warning');
            }
          });
        });
      });
    },
  },
  {
    id: 'data/card-unique',
    summary: 'One index is printed at most once per layout, in every catalogue.',
    severity: 'error',
    /** Keeps the first declaration, so a later one is reported against it. */
    run(context) {
      /** First declaration of each printing, `${Index}|${Layout}`. */
      const declared = new Map();

      listCatalogues(context).forEach((catalogue) => {
        const cards = readCards(context, catalogue);
        if (cards === null) return;
        const text = context.readText(catalogue.file);

        cards.forEach((card) => {
          if (!isRecord(card) || typeof card.Index !== 'string' || typeof card.Layout !== 'string') return;
          const key = `${card.Index}|${card.Layout}`;
          const line = lineAt(text, cardNeedle(card));
          const first = declared.get(key);
          if (first) {
            context.report({
              file: catalogue.file,
              line,
              column: 1,
              message: `index "${card.Index}" is already printed in layout "${card.Layout}" (${first.file}:${first.line})`,
            });
            return;
          }
          declared.set(key, { file: catalogue.file, line });
        });
      });
    },
  },
  {
    id: 'data/card-references',
    summary: 'A code, a pinned offer or a trophy requirement points at a card that exists.',
    severity: 'error',
    /** Reads the card index once, then every file that names a card. */
    run(context) {
      const cards = readCardIndex(context);

      const codes = readOrNull(context, CODES_FILE);
      if (Array.isArray(codes)) {
        const text = context.readText(CODES_FILE);
        codes.forEach((entry) => {
          if (!isRecord(entry) || !Array.isArray(entry.Rewards)) return;
          const block = isFilled(entry.Code) ? text.indexOf(`"Code": ${JSON.stringify(entry.Code)}`) : 0;
          entry.Rewards.forEach((reward) => {
            if (!isRecord(reward) || reward.RewardType !== 'Card') return;
            const itemId = reward.ItemId;
            const line = lineAt(text, `"ItemId": ${JSON.stringify(itemId)}`, Math.max(0, block));
            if (typeof itemId !== 'string' || !cards.has(itemId)) {
              context.report({
                file: CODES_FILE,
                line,
                column: 1,
                message: `code "${entry.Code}" rewards card "${itemId}", which no catalogue declares`,
              });
              return;
            }
            const preferred = reward.PreferedLayout;
            if (preferred === undefined || preferred === null) return;
            const wanted = String(preferred).trim().toLowerCase();
            const layout = wanted === 'normal' ? 'classic' : wanted;
            const layoutLine = lineAt(text, `"PreferedLayout": ${JSON.stringify(preferred)}`, Math.max(0, block));
            if (!LAYOUTS.has(layout)) {
              context.report({
                file: CODES_FILE,
                line: layoutLine,
                column: 1,
                message: `code "${entry.Code}" prefers layout "${preferred}", expected "classic", "fullart" or null`,
              });
              return;
            }
            if (!cards.get(itemId).has(layout)) {
              context.report({
                file: CODES_FILE,
                line: layoutLine,
                column: 1,
                severity: 'warning',
                message: `code "${entry.Code}" prefers the "${layout}" printing of "${itemId}", which does not exist (the first printing is used instead)`,
              });
            }
          });
        });
      }

      const offers = readOrNull(context, PINNED_OFFERS_FILE);
      if (Array.isArray(offers)) {
        const text = context.readText(PINNED_OFFERS_FILE);
        offers.forEach((offer) => {
          if (!isRecord(offer) || !isRecord(offer.Card)) return;
          const index = offer.Card.Index;
          if (typeof index !== 'string' || !cards.has(index)) {
            context.report({
              file: PINNED_OFFERS_FILE,
              line: lineAt(text, `"Index": ${JSON.stringify(index)}`),
              column: 1,
              message: `pinned offer ${JSON.stringify(offer.OfferID)} points at "${index}", which no catalogue declares`,
            });
          }
        });
      }

      const { trophies } = readPaths(context);
      listJsonFiles(context, trophies).forEach((name) => {
        const file = `${trophies}/${name}`;
        const root = readOrNull(context, file);
        if (!isRecord(root) || !Array.isArray(root.TrophyList)) return;
        const text = context.readText(file);

        root.TrophyList.forEach((trophy) => {
          if (!isRecord(trophy) || !isRecord(trophy.Requirements)) return;
          const requirement = trophy.Requirements;
          const type = isFilled(requirement.Type) ? requirement.Type.trim().toLowerCase() : 'any';
          const items = Array.isArray(requirement.Items) ? requirement.Items : [];
          const block = isFilled(trophy.Name) ? text.indexOf(`"Name": ${JSON.stringify(trophy.Name)}`) : 0;

          items.forEach((item) => {
            if (typeof item !== 'string') return;
            const line = lineAt(text, `"${item}"`, Math.max(0, block));
            if (!cards.has(item)) {
              context.report({
                file,
                line,
                column: 1,
                message: `trophy "${trophy.Name}" requires "${item}", which no catalogue declares`,
              });
              return;
            }
            if (type !== 'classic' && type !== 'fullart') return;
            if (!cards.get(item).has(type)) {
              context.report({
                file,
                line,
                column: 1,
                message: `trophy "${trophy.Name}" requires the "${type}" printing of "${item}", which does not exist`,
              });
            }
          });
        });
      });
    },
  },
  {
    id: 'data/codes',
    summary: 'A redeem code is unique, its rewards are known, and its availability window is valid.',
    severity: 'error',
    files: (relativePath) => relativePath === CODES_FILE,
    /** The run is already restricted to one file, so it reads it directly. */
    run(context) {
      const codes = readOrNull(context, CODES_FILE);
      if (!Array.isArray(codes)) return;

      const sets = readSets(context);
      const setIds = new Set((sets ?? []).map((set) => set.id));
      const text = context.readText(CODES_FILE);
      /** Normalized code, to the spelling that declared it first. */
      const seen = new Map();

      codes.forEach((entry, position) => {
        if (!isRecord(entry)) {
          context.report({
            file: CODES_FILE,
            line: 1,
            column: 1,
            message: `code entry #${position + 1} is not an object`,
          });
          return;
        }

        const code = entry.Code;
        const line = lineAt(text, `"Code": ${JSON.stringify(code)}`);
        const fail = (message) => context.report({ file: CODES_FILE, line, column: 1, message });

        if (!isFilled(code)) {
          fail(`code entry #${position + 1} has no Code`);
        } else {
          // The RedeemManager compares case-insensitively: two spellings of one code would grant
          // two different rewards for the same word typed by the player.
          const first = seen.get(code.trim().toUpperCase());
          if (first) {
            context.report({
              file: CODES_FILE,
              line,
              column: 1,
              message: `code "${code}" is declared twice (same code as "${first}", case notwithstanding)`,
            });
          } else {
            seen.set(code.trim().toUpperCase(), code);
          }
        }

        if (entry.Repeatable !== undefined && typeof entry.Repeatable !== 'boolean') {
          fail(`code "${code}" Repeatable must be a boolean`);
        }

        const rewards = entry.Rewards;
        if (!Array.isArray(rewards) || rewards.length === 0) {
          fail(`code "${code}" declares no Rewards`);
        } else {
          rewards.forEach((reward) => {
            if (!isRecord(reward)) {
              fail(`code "${code}" holds a reward that is not an object`);
              return;
            }
            if (!REWARD_TYPES.has(reward.RewardType)) {
              fail(`code "${code}" has reward type ${JSON.stringify(reward.RewardType)}, expected Booster, Card or Sparks`);
            }
            if (!Number.isInteger(reward.Quantity) || reward.Quantity <= 0) {
              fail(`code "${code}" rewards ${JSON.stringify(reward.Quantity)} ${reward.RewardType}(s), expected a positive integer`);
            }
            if (reward.RewardType === 'Booster' && !setIds.has(reward.ItemId)) {
              fail(`code "${code}" rewards booster "${reward.ItemId}", which is not a set of ${CARDSETS_FILE}`);
            }
          });
        }

        const availability = entry.Availabilities;
        if (availability === undefined || availability === null) return;
        if (!isRecord(availability)) {
          fail(`code "${code}" Availabilities must be null or an object`);
          return;
        }
        const start = availability.StartDate;
        const end = availability.EndDate;
        if (start !== undefined && start !== null && !isDay(start)) {
          fail(`code "${code}" StartDate ${JSON.stringify(start)} is not a YYYY-MM-DD day`);
        }
        if (end !== undefined && end !== null && !isDay(end)) {
          fail(`code "${code}" EndDate ${JSON.stringify(end)} is not a YYYY-MM-DD day`);
        }
        if (isDay(start) && isDay(end) && start > end) {
          fail(`code "${code}" is available from ${start} to ${end}: the window is empty`);
        }
      });
    },
  },
  {
    id: 'data/sets',
    summary: 'A set is declared once, its catalogue exists, and its release date is a real day.',
    severity: 'error',
    /** The declared sets first (the only thing that may name a missing catalogue), then the catalogues. */
    run(context) {
      const sets = readSets(context);
      const { boosters, promos } = readPaths(context);
      if (sets === null) {
        context.report({
          file: CARDSETS_FILE,
          line: 1,
          column: 1,
          message: 'no "sets" array: the game would load no extension at all',
        });
        return;
      }

      const text = context.readText(CARDSETS_FILE);
      /** Declared set, by id. */
      const declared = new Map();

      sets.forEach((set) => {
        const id = set.id;
        const line = isFilled(id) ? lineAt(text, `"id": ${JSON.stringify(id)}`) : 1;
        const fail = (message) => context.report({ file: CARDSETS_FILE, line, column: 1, message });

        if (!isFilled(id) || !/^[A-Za-z0-9_-]+$/.test(id)) {
          fail(`set id ${JSON.stringify(id)} must be a non-empty name (letters, digits, "_" or "-")`);
          return;
        }
        if (declared.has(id)) {
          fail(`set "${id}" is declared twice`);
          return;
        }
        declared.set(id, set);

        if (!context.exists(`${boosters}/${id}.json`)) {
          fail(`set "${id}" has no catalogue (${boosters}/${id}.json)`);
        }

        const releaseDate = set.releaseDate;
        if (releaseDate !== undefined && releaseDate !== null && !isDay(releaseDate)) {
          fail(`set "${id}" releaseDate ${JSON.stringify(releaseDate)} is not a YYYY-MM-DD day`);
        }

        if (set.promo !== undefined && typeof set.promo !== 'boolean') {
          fail(`set "${id}" promo must be a boolean`);
        }
        // A set declaring promos before their file exists is normal: those cards arrive with the
        // release. The reverse is not - the game only loads a promo file its set points at.
        if (set.promo !== true && context.exists(`${promos}/${id}.json`)) {
          fail(`set "${id}" has promo cards (${promos}/${id}.json) but is not declared with "promo": true`);
        }
      });

      listCatalogues(context)
        .filter((catalogue) => catalogue.kind === 'booster')
        .forEach((catalogue) => {
          const file = catalogue.file;
          if (!declared.has(catalogue.setId)) {
            context.report({
              file: CARDSETS_FILE,
              line: 1,
              column: 1,
              message: `${file} declares the cards of "${catalogue.setId}", which this file does not list`,
            });
          }

          const root = readOrNull(context, file);
          if (!isRecord(root)) return;
          if (!isFilled(root.Name)) {
            context.report({ file, line: 1, column: 1, message: 'the set has no display Name' });
          }
          if (root.ID !== undefined && !Number.isInteger(root.ID)) {
            context.report({ file, line: 1, column: 1, message: 'the set ID must be an integer' });
          }
          if (root.Serie !== undefined && root.Serie !== catalogue.setId) {
            context.report({
              file,
              line: lineAt(context.readText(file), `"Serie": ${JSON.stringify(root.Serie)}`),
              column: 1,
              message: `"Serie" is "${root.Serie}", expected "${catalogue.setId}"`,
            });
          }
        });
    },
  },
  {
    id: 'data/trophies',
    summary: 'The trophy catalogue, the icons and the titles it unlocks agree with each other.',
    severity: 'error',
    /** Trophies, then the icons and the titles: the later two must name trophies the first declared. */
    run(context) {
      const paths = readPaths(context);
      const languages = readLanguages(context);
      /** Trophy names of each extension, by set id. */
      const trophyNames = new Map();

      listJsonFiles(context, paths.trophies).forEach((name) => {
        const setId = name.slice(0, -'.json'.length);
        const file = `${paths.trophies}/${name}`;
        const root = readOrNull(context, file);
        if (!isRecord(root)) return;
        const text = context.readText(file);

        if (root.Booster !== undefined && root.Booster !== setId) {
          context.report({
            file,
            line: lineAt(text, `"Booster": ${JSON.stringify(root.Booster)}`),
            column: 1,
            message: `"Booster" is "${root.Booster}", expected "${setId}"`,
          });
        }

        const list = Array.isArray(root.TrophyList) ? root.TrophyList : null;
        if (list === null || list.length === 0) {
          context.report({ file, line: 1, column: 1, message: 'the set declares no TrophyList' });
          return;
        }

        const names = new Set();
        list.forEach((trophy, position) => {
          if (!isRecord(trophy)) {
            context.report({ file, line: 1, column: 1, message: `trophy #${position + 1} is not an object` });
            return;
          }
          const trophyName = isFilled(trophy.Name) ? trophy.Name.trim() : '';
          const line = trophyName === '' ? 1 : lineAt(text, `"Name": ${JSON.stringify(trophy.Name)}`);
          const fail = (message, severity) => context.report({ file, line, column: 1, message, severity });

          if (trophyName === '') fail(`trophy #${position + 1} has no Name`);
          else if (names.has(trophyName)) fail(`trophy "${trophyName}" is declared twice`);
          else names.add(trophyName);

          if (!TROPHY_RARITIES.has(trophy.Rarity)) {
            fail(`trophy "${trophyName}" rarity ${JSON.stringify(trophy.Rarity)} is not bronze, silver, gold, diamond or emerald`);
          }

          const requirement = trophy.Requirements;
          if (!isRecord(requirement)) {
            fail(`trophy "${trophyName}" has no Requirements`);
          } else {
            const requirementType = isFilled(requirement.RequirementType)
              ? requirement.RequirementType.trim().toLowerCase()
              : '';
            if (requirementType !== 'cardlist') {
              fail(
                `trophy "${trophyName}" requirement type ${JSON.stringify(requirement.RequirementType)} is ignored by the game (only "CardList" is read)`,
                'warning'
              );
            }
            const type = isFilled(requirement.Type) ? requirement.Type.trim().toLowerCase() : 'any';
            if (!REQUIREMENT_LAYOUTS.has(type)) {
              fail(`trophy "${trophyName}" requirement Type ${JSON.stringify(requirement.Type)} is not any, classic or fullart`);
            }
            if (!Array.isArray(requirement.Items) || requirement.Items.length === 0) {
              fail(`trophy "${trophyName}" requires no card`);
            }
          }

          if (!isFilled(trophy.Icon)) fail(`trophy "${trophyName}" has no Icon`);
          if (trophy.Experience !== undefined && trophy.Experience !== null) {
            if (!Number.isFinite(trophy.Experience) || trophy.Experience < 0) {
              fail(`trophy "${trophyName}" Experience ${JSON.stringify(trophy.Experience)} is not a non-negative number`);
            }
          }
        });

        trophyNames.set(setId, names);
      });

      const icons = readOrNull(context, paths.iconFile);
      const iconNames = new Set();
      if (icons !== null && !Array.isArray(icons)) {
        context.report({ file: paths.iconFile, line: 1, column: 1, message: 'the icon catalogue must be an array' });
      } else if (Array.isArray(icons)) {
        const text = context.readText(paths.iconFile);
        icons.forEach((icon, position) => {
          if (!isRecord(icon)) {
            context.report({ file: paths.iconFile, line: 1, column: 1, message: `icon #${position + 1} is not an object` });
            return;
          }
          const name = isFilled(icon.name) ? icon.name.trim() : '';
          const line = name === '' ? 1 : lineAt(text, `"name": ${JSON.stringify(icon.name)}`);
          if (name === '') {
            context.report({ file: paths.iconFile, line, column: 1, message: `icon #${position + 1} has no name` });
          } else if (iconNames.has(name)) {
            context.report({ file: paths.iconFile, line, column: 1, message: `icon "${name}" is declared twice` });
          } else {
            iconNames.add(name);
          }
          if (!isFilled(icon.file)) {
            context.report({ file: paths.iconFile, line, column: 1, message: `icon "${name}" has no file` });
          }
        });
      }

      listJsonFiles(context, paths.iconsDirectory).forEach((name) => {
        const setId = name.slice(0, -'.json'.length);
        const file = `${paths.iconsDirectory}/${name}`;
        const root = readOrNull(context, file);
        if (!isRecord(root)) return;
        const text = context.readText(file);
        const known = trophyNames.get(setId);

        if (root.Booster !== undefined && root.Booster !== setId) {
          context.report({
            file,
            line: lineAt(text, `"Booster": ${JSON.stringify(root.Booster)}`),
            column: 1,
            message: `"Booster" is "${root.Booster}", expected "${setId}"`,
          });
        }

        const list = Array.isArray(root.CollectionTrophy) ? root.CollectionTrophy : [];
        list.forEach((entry) => {
          if (!isRecord(entry)) return;
          const trophyName = entry.CollectionTrophy;
          const line = lineAt(text, `"CollectionTrophy": ${JSON.stringify(trophyName)}`);
          if (!isFilled(trophyName)) {
            context.report({ file, line, column: 1, message: 'an entry names no CollectionTrophy' });
            return;
          }
          if (!known) {
            context.report({
              file,
              line,
              column: 1,
              severity: 'warning',
              message: `${paths.trophies}/${setId}.json does not exist yet: the icons of "${trophyName}" cannot be unlocked`,
            });
          } else if (!known.has(trophyName)) {
            context.report({
              file,
              line,
              column: 1,
              message: `collection trophy "${trophyName}" is not declared in ${paths.trophies}/${setId}.json`,
            });
          }

          const unlocked = Array.isArray(entry.UnlockedIcon) ? entry.UnlockedIcon : [];
          if (unlocked.length === 0) {
            context.report({ file, line, column: 1, message: `trophy "${trophyName}" unlocks no icon` });
          }
          unlocked.forEach((iconName) => {
            if (typeof iconName === 'string' && !iconNames.has(iconName)) {
              context.report({
                file,
                line,
                column: 1,
                message: `icon "${iconName}" is not declared in ${paths.iconFile}`,
              });
            }
          });
        });
      });

      /** Title id, to the file that declares it (level titles and trophy titles share the namespace). */
      const titleIds = new Map();

      /** Builds the checker of one file: its titles exist once and are translated everywhere. */
      const titleChecker = (file) => (id, titleText, label, line) => {
        if (!isFilled(id)) {
          context.report({ file, line, column: 1, message: `${label} has no id` });
        } else if (titleIds.has(id)) {
          context.report({ file, line, column: 1, message: `title "${id}" is already declared in ${titleIds.get(id)}` });
        } else {
          titleIds.set(id, file);
        }
        if (!isRecord(titleText)) {
          context.report({ file, line, column: 1, message: `${label} has no text` });
          return;
        }
        languages.forEach((code) => {
          if (!isFilled(titleText[code])) {
            context.report({ file, line, column: 1, message: `${label} has no "${code}" text` });
          }
        });
      };

      const defaultTitles = readOrNull(context, paths.titlesFile);
      if (Array.isArray(defaultTitles)) {
        const text = context.readText(paths.titlesFile);
        const check = titleChecker(paths.titlesFile);
        defaultTitles.forEach((title, position) => {
          if (!isRecord(title)) {
            context.report({
              file: paths.titlesFile,
              line: 1,
              column: 1,
              message: `title #${position + 1} is not an object`,
            });
            return;
          }
          const label = `level title ${JSON.stringify(title.id)}`;
          const line = lineAt(text, `"id": ${JSON.stringify(title.id)}`);
          check(title.id, title.text, label, line);
          if (!Number.isInteger(title.requiredLevel) || title.requiredLevel < 1) {
            context.report({
              file: paths.titlesFile,
              line,
              column: 1,
              message: `${label} requiredLevel ${JSON.stringify(title.requiredLevel)} is not a positive integer`,
            });
          }
        });
      }

      listJsonFiles(context, paths.titlesDirectory).forEach((name) => {
        const setId = name.slice(0, -'.json'.length);
        const file = `${paths.titlesDirectory}/${name}`;
        const root = readOrNull(context, file);
        if (!isRecord(root)) return;
        const text = context.readText(file);
        const known = trophyNames.get(setId);
        const check = titleChecker(file);

        if (root.Booster !== undefined && root.Booster !== setId) {
          context.report({
            file,
            line: lineAt(text, `"Booster": ${JSON.stringify(root.Booster)}`),
            column: 1,
            message: `"Booster" is "${root.Booster}", expected "${setId}"`,
          });
        }

        const list = Array.isArray(root.CollectionTitle) ? root.CollectionTitle : [];
        list.forEach((entry) => {
          if (!isRecord(entry)) return;
          const trophyName = entry.CollectionTrophy;
          const line = lineAt(text, `"CollectionTrophy": ${JSON.stringify(trophyName)}`);
          if (!isFilled(trophyName)) {
            context.report({ file, line, column: 1, message: 'an entry names no CollectionTrophy' });
            return;
          }
          if (!known) {
            context.report({
              file,
              line,
              column: 1,
              severity: 'warning',
              message: `${paths.trophies}/${setId}.json does not exist yet: the titles of "${trophyName}" cannot be unlocked`,
            });
          } else if (!known.has(trophyName)) {
            context.report({
              file,
              line,
              column: 1,
              message: `collection trophy "${trophyName}" is not declared in ${paths.trophies}/${setId}.json`,
            });
          }

          const unlocked = Array.isArray(entry.UnlockedTitle) ? entry.UnlockedTitle : [];
          if (unlocked.length === 0) {
            context.report({ file, line, column: 1, message: `trophy "${trophyName}" unlocks no title` });
          }
          unlocked.forEach((title) => {
            if (!isRecord(title)) {
              context.report({ file, line, column: 1, message: `a title of "${trophyName}" is not an object` });
              return;
            }
            check(title.id, title.text, `title ${JSON.stringify(title.id)}`, line);
          });
        });
      });
    },
  },
  {
    id: 'data/economy',
    summary: 'The Sparks, the shop and the mine price the same resources.',
    severity: 'error',
    /** The configuration first, then the files that pay with what it prices. */
    run(context) {
      const config = readOrNull(context, CONFIG_FILE);
      if (!isRecord(config)) return;
      const configText = context.readText(CONFIG_FILE);

      const sparks = isRecord(config.sparks) ? config.sparks : {};
      ['sellPrice', 'buyPrice'].forEach((field) => {
        const prices = sparks[field];
        const line = lineAt(configText, `"${field}"`);
        if (!isRecord(prices)) {
          context.report({
            file: CONFIG_FILE,
            line,
            column: 1,
            message: `sparks.${field} must map a rarity (1-5) to a price`,
          });
          return;
        }
        for (let rarity = 1; rarity <= 5; rarity += 1) {
          if (!Number.isInteger(prices[rarity]) || prices[rarity] < 0) {
            context.report({
              file: CONFIG_FILE,
              line,
              column: 1,
              message: `sparks.${field}["${rarity}"] must be a non-negative integer`,
            });
          }
        }
      });
      if (!Number.isInteger(sparks.boosterReward) || sparks.boosterReward < 0) {
        context.report({
          file: CONFIG_FILE,
          line: lineAt(configText, '"boosterReward"'),
          column: 1,
          message: 'sparks.boosterReward must be a non-negative integer',
        });
      }

      const mining = readOrNull(context, MINING_FILE);
      const miningText = mining === null ? '' : context.readText(MINING_FILE);
      /** Resources the mine actually gives, so a price can be compared to something. */
      const resources = new Set();
      if (isRecord(mining) && Array.isArray(mining.Blocks)) {
        mining.Blocks.forEach((block) => {
          if (!isRecord(block) || !Array.isArray(block.Rewards)) return;
          block.Rewards.forEach((reward) => {
            if (isRecord(reward) && isFilled(reward.Type)) resources.add(reward.Type);
          });
        });
      }

      const shop = isRecord(config.shop) ? config.shop : {};
      const itemsValues = isRecord(shop.itemsValues) ? shop.itemsValues : null;
      const itemsLine = lineAt(configText, '"itemsValues"');
      if (itemsValues === null) {
        context.report({
          file: CONFIG_FILE,
          line: itemsLine,
          column: 1,
          message: 'shop.itemsValues must map a mined resource to its value',
        });
      } else {
        Object.keys(itemsValues).forEach((item) => {
          if (!Number.isInteger(itemsValues[item]) || itemsValues[item] <= 0) {
            context.report({
              file: CONFIG_FILE,
              line: itemsLine,
              column: 1,
              message: `shop.itemsValues["${item}"] must be a positive integer`,
            });
          }
          // Nothing to compare against when the mine could not be read at all: `data/json` reports
          // that once instead of one failure per priced resource.
          if (resources.size > 0 && !resources.has(item)) {
            context.report({
              file: CONFIG_FILE,
              line: itemsLine,
              column: 1,
              message: `shop.itemsValues prices "${item}", which no block of ${MINING_FILE} rewards: no offer could ever be paid with it`,
            });
          }
        });
      }

      const rarityValues = isRecord(shop.rarityValues) ? shop.rarityValues : {};
      const shopOffers = isRecord(shop.offers) ? shop.offers : {};
      const offersLine = lineAt(configText, '"offers"');
      const rarityLine = lineAt(configText, '"rarityValues"');

      Object.keys(shopOffers).forEach((rarity) => {
        if (!isIntegerBetween(Number(rarity), 1, 5)) {
          context.report({
            file: CONFIG_FILE,
            line: offersLine,
            column: 1,
            message: `shop.offers["${rarity}"] must be a card rarity (1-5)`,
          });
        }
        if (!Number.isInteger(shopOffers[rarity]) || shopOffers[rarity] <= 0) {
          context.report({
            file: CONFIG_FILE,
            line: offersLine,
            column: 1,
            message: `shop.offers["${rarity}"] must be a positive integer`,
          });
        }
        if (!Object.prototype.hasOwnProperty.call(rarityValues, rarity)) {
          context.report({
            file: CONFIG_FILE,
            line: offersLine,
            column: 1,
            message: `shop.offers sells rarity ${rarity} but shop.rarityValues prices no such rarity`,
          });
        }
      });

      Object.keys(rarityValues).forEach((rarity) => {
        if (!isIntegerBetween(Number(rarity), 1, 5)) {
          context.report({
            file: CONFIG_FILE,
            line: rarityLine,
            column: 1,
            message: `shop.rarityValues["${rarity}"] must be a card rarity (1-5)`,
          });
        }
        if (!Number.isInteger(rarityValues[rarity]) || rarityValues[rarity] <= 0) {
          context.report({
            file: CONFIG_FILE,
            line: rarityLine,
            column: 1,
            message: `shop.rarityValues["${rarity}"] must be a positive integer`,
          });
        }
      });

      const pinnedOffers = readOrNull(context, PINNED_OFFERS_FILE);
      if (pinnedOffers !== null && !Array.isArray(pinnedOffers)) {
        context.report({
          file: PINNED_OFFERS_FILE,
          line: 1,
          column: 1,
          message: 'the pinned offers must be an array',
        });
      } else if (Array.isArray(pinnedOffers)) {
        const text = context.readText(PINNED_OFFERS_FILE);
        const seenIds = new Set();
        pinnedOffers.forEach((offer, position) => {
          if (!isRecord(offer)) {
            context.report({
              file: PINNED_OFFERS_FILE,
              line: 1,
              column: 1,
              message: `pinned offer #${position + 1} is not an object`,
            });
            return;
          }

          const label = `pinned offer ${JSON.stringify(offer.OfferID)}`;
          const line = lineAt(text, `"OfferID": ${JSON.stringify(offer.OfferID)}`);
          const fail = (message) => context.report({ file: PINNED_OFFERS_FILE, line, column: 1, message });

          if (!Number.isInteger(offer.OfferID) || offer.OfferID <= 0) {
            fail(`pinned offer #${position + 1} has no positive integer OfferID`);
          } else if (seenIds.has(offer.OfferID)) {
            fail(`${label} is declared twice`);
          } else {
            seenIds.add(offer.OfferID);
          }

          if (!Number.isInteger(offer.MaxUse) || offer.MaxUse <= 0) {
            fail(`${label} MaxUse must be a positive integer`);
          }

          const price = offer.Price;
          if (!isRecord(price) || Object.keys(price).length === 0) {
            fail(`${label} has no Price`);
          } else {
            Object.keys(price).forEach((item) => {
              if (!Number.isInteger(price[item]) || price[item] <= 0) {
                fail(`${label} prices "${item}" at ${JSON.stringify(price[item])}, expected a positive integer`);
              }
              if (itemsValues && !Object.prototype.hasOwnProperty.call(itemsValues, item)) {
                fail(`${label} asks for "${item}", which shop.itemsValues does not price`);
              }
            });
          }

          const period = offer.Period;
          if (period === undefined || period === null) return;
          if (!isRecord(period)) {
            fail(`${label} Period must be an object`);
            return;
          }
          const start = period.Min;
          const end = period.Max;
          if (start !== undefined && start !== null && !isDay(start)) {
            fail(`${label} starts on ${JSON.stringify(start)}, which is not a YYYY-MM-DD day`);
          }
          if (end !== undefined && end !== null && !isDay(end)) {
            fail(`${label} ends on ${JSON.stringify(end)}, which is not a YYYY-MM-DD day`);
          }
          if (isDay(start) && isDay(end) && start > end) {
            fail(`${label} is sold from ${start} to ${end}: the window is empty`);
          }
        });
      }

      if (!isRecord(mining)) return;

      const blocks = Array.isArray(mining.Blocks) ? mining.Blocks : null;
      if (blocks === null || blocks.length === 0) {
        context.report({ file: MINING_FILE, line: 1, column: 1, message: 'the mine declares no Blocks' });
      } else {
        const seenIds = new Set();
        blocks.forEach((block, position) => {
          if (!isRecord(block)) {
            context.report({ file: MINING_FILE, line: 1, column: 1, message: `block #${position + 1} is not an object` });
            return;
          }

          const id = block.ID;
          const line = isFilled(id) ? lineAt(miningText, `"ID": ${JSON.stringify(id)}`) : 1;
          const label = `block ${JSON.stringify(id)}`;
          const fail = (message) => context.report({ file: MINING_FILE, line, column: 1, message });

          if (!isFilled(id)) {
            fail(`block #${position + 1} has no ID`);
          } else if (seenIds.has(id)) {
            fail(`${label} is declared twice`);
          } else {
            seenIds.add(id);
          }
          if (!Number.isFinite(block.Weight) || block.Weight <= 0) fail(`${label} Weight must be a positive number`);
          if (!Number.isInteger(block.Hardness) || block.Hardness <= 0) {
            fail(`${label} Hardness must be a positive integer`);
          }
          // Only the languages the block already declares: a missing one falls back to the default
          // language at runtime, and this rule is not a translation checklist.
          localisedLanguages(block, 'Name').forEach((code) => {
            if (!isFilled(block[`Name_${code}`])) fail(`${label} has an empty Name_${code}`);
          });

          const rewards = block.Rewards;
          if (!Array.isArray(rewards) || rewards.length === 0) {
            fail(`${label} gives nothing`);
            return;
          }
          rewards.forEach((reward) => {
            if (!isRecord(reward)) {
              fail(`${label} holds a reward that is not an object`);
              return;
            }
            if (!isFilled(reward.Type)) fail(`${label} holds a reward without Type`);
            if (reward.Chance !== undefined && reward.Chance !== null) {
              if (!Number.isFinite(reward.Chance) || reward.Chance <= 0 || reward.Chance > 1) {
                fail(
                  `${label} reward ${JSON.stringify(reward.Type)} Chance ${JSON.stringify(reward.Chance)} is not a number from 0 (excluded) to 1`
                );
              }
            }
            const range = reward.Range;
            if (range === undefined || range === null) return;
            if (!isRecord(range) || !Number.isInteger(range.Min) || !Number.isInteger(range.Max)) {
              fail(`${label} reward ${JSON.stringify(reward.Type)} Range must declare integer Min and Max`);
            } else if (range.Min < 0 || range.Max < range.Min) {
              fail(`${label} reward ${JSON.stringify(reward.Type)} Range ${range.Min}-${range.Max} is not a valid interval`);
            }
          });
        });
      }

      const cracks = Array.isArray(mining.Cracks) ? mining.Cracks : null;
      if (cracks === null || cracks.length === 0) {
        context.report({ file: MINING_FILE, line: 1, column: 1, message: 'the mine declares no Cracks' });
        return;
      }

      const cracksLine = lineAt(miningText, '"Cracks"');
      let broken = -1;
      cracks.forEach((crack, position) => {
        const fail = (message) => context.report({ file: MINING_FILE, line: cracksLine, column: 1, message });
        const range = isRecord(crack) ? crack.Range : null;
        if (!isRecord(range) || !Number.isInteger(range.Min) || !Number.isInteger(range.Max)) {
          fail(`crack #${position + 1} must declare integer Min and Max`);
          return;
        }
        if (range.Min < 0 || range.Max < range.Min) {
          fail(`crack #${position + 1} range ${range.Min}-${range.Max} is not a valid interval`);
        }
        if (range.Min <= broken) {
          fail(`crack #${position + 1} starts at ${range.Min}, inside the previous range (ends at ${broken})`);
        }
        broken = Math.max(broken, range.Max);
      });
      // The cracks are the shares of the block: an incomplete table leaves a part nobody can break.
      if (broken !== 100) {
        context.report({
          file: MINING_FILE,
          line: cracksLine,
          column: 1,
          severity: 'warning',
          message: `the crack ranges end at ${broken}, expected 100 (the share of the block broken)`,
        });
      }
    },
  },
  {
    id: 'data/rarity-table',
    summary: 'A rarity table draws real rarities with weights that add up to 1.',
    severity: 'error',
    /** Each table, whatever its name: a new draw is one more key. */
    run(context) {
      const table = readOrNull(context, RARITY_FILE);
      if (!isRecord(table)) return;
      const text = context.readText(RARITY_FILE);

      Object.keys(table).forEach((key) => {
        if (key.startsWith('_')) return;
        const buckets = table[key];
        const line = lineAt(text, `"${key}"`);
        const fail = (message, severity) => context.report({ file: RARITY_FILE, line, column: 1, message, severity });

        if (!Array.isArray(buckets) || buckets.length === 0) {
          fail(`"${key}" must be a non-empty array of { rarity, weight }`);
          return;
        }

        let total = 0;
        buckets.forEach((bucket) => {
          if (!isRecord(bucket)) {
            fail(`"${key}" holds an entry that is not an object`);
            return;
          }
          if (!isIntegerBetween(bucket.rarity, 1, 5)) {
            fail(`"${key}" draws rarity ${JSON.stringify(bucket.rarity)}, expected an integer from 1 to 5`);
          }
          if (!Number.isFinite(bucket.weight) || bucket.weight <= 0 || bucket.weight > 1) {
            fail(
              `"${key}" gives rarity ${JSON.stringify(bucket.rarity)} the weight ${JSON.stringify(bucket.weight)}, expected a number from 0 (excluded) to 1`
            );
            return;
          }
          total += bucket.weight;
        });

        if (Math.abs(total - 1) > 0.001) {
          fail(`"${key}" weights add up to ${Number(total.toFixed(6))}, expected 1`, 'warning');
        }
      });
    },
  },
];
