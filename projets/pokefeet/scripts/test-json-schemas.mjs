#!/usr/bin/env node
/**
 * Validateur des JSON de données Pokefeet (sans navigateur).
 *
 * Chaque fichier de data/ est d'abord identifié (manifeste, espèces, trophées,
 * récompenses de niveau, défis, cosmétiques, crédits, changelog, version,
 * archive d'export), puis chaque entrée est vérifiée champ par champ, avec ses
 * références croisées : une espèce citée par un défi, un trophée exigé par un
 * prérequis ou un cosmétique offert doivent exister.
 *
 * Un problème est toujours rapporté par fichier, entrée et champ :
 *
 *   data/bonus_challenges/event.json
 *     #1 (ID 1) › Availabilities[1].End · date inexistante « 2027-06-31 »
 *
 * Les archives (data/backup.json, data/trophies.json, …) ne sont pas chargées
 * par l'application : elles ne subissent qu'un contrôle de forme (types,
 * énumérations, identifiants uniques), sans exigence de fichiers ni de
 * références, pour ne pas signaler des chemins historiques.
 *
 * Aucune dépendance npm. Usage : npm run test:json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── Vocabulaire attendu ─────────────────────────────────────
const POKEMON_TYPES = new Set([
  'normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison',
  'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark',
  'steel', 'fairy'
]);
const DIFFICULTIES = new Set(['Easy', 'Medium', 'Hard', 'Impossible']);
const OBTENTION_MODES = new Set([
  'Dex_Count', 'Full_Generation_Register', 'Daily_Count', 'Weekly_Count',
  'Marathon_Streak', 'Type_Registered'
]);
const REQUIREMENT_TYPES = new Set(['level', 'dexcount', 'trophy']);
const REWARD_TYPES = new Set(['Experience', 'Cosmetic']);
const REWARD_ITEM_TYPES = new Set(['Badge', 'Title', 'Currency', 'StreamdexCMD']);
const COSMETIC_TYPES = new Set(['Background', 'Background-Buttons']);
const CHANGELOG_TYPES = new Set(['Content', 'Fix', 'Quality Of Life', 'Feature']);
const CHANGELOG_STAGES = new Set(['Release', 'Beta', 'Alpha']);
const CREDIT_TYPES = new Set(['Coder', 'Artist', 'Data', 'Tester']);

// Familles identifiables, dans l'ordre d'affichage du rapport.
const FAMILY_LABELS = {
  manifest: 'manifestes',
  mons: 'espèces',
  trophies: 'trophées',
  rewards: 'récompenses',
  challenges: 'défis',
  cosmetics: 'cosmétiques',
  credits: 'crédits',
  changelog: 'changelog',
  version: 'versions de données',
  unknown: 'non identifiés'
};

const issues = [];
const uniques = new Map();
const familyStats = new Map();
const monsIndexes = new Set();
const trophyIds = new Set();
const cosmeticIds = new Set();
const creditTranslations = { fr: new Map(), en: new Map() };

function report(file, entry, field, message) {
  issues.push({ file, entry, field, message });
}

function toRel(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

// ── Primitives de contrôle ──────────────────────────────────
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';

function describe(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'tableau';
  if (typeof value === 'object') return 'objet';
  if (typeof value === 'string') return `« ${value.slice(0, 40)} »`;
  return String(value);
}

function assetExists(value) {
  if (!isText(value) || !value.startsWith('./')) return false;
  const target = path.resolve(ROOT, value);
  return target.startsWith(ROOT + path.sep) && fs.existsSync(target);
}

function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isDayFirstDate(value) {
  const parts = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value));
  if (!parts) return false;
  const day = Number(parts[1]);
  const month = Number(parts[2]);
  const year = Number(parts[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// Un identifiant ne doit apparaître qu'une fois par famille (par archive).
// Les archives reprennent les identifiants des fichiers chargés : l'unicité
// se juge donc à leur échelle de fichier, pas de famille.
function scopeKey(ctx, family) {
  return ctx.legacy ? family + ':' + ctx.file : family;
}

function claimUnique(scope, ctx, at, field, value) {
  const key = `${scope}:${String(value)}`;
  if (uniques.has(key)) report(ctx.file, at, field, `doublon de ${uniques.get(key)}`);
  else uniques.set(key, `${ctx.file} ${at}`);
}

function checkText(ctx, entry, at, field, options = {}) {
  const value = entry[field];
  if (value === undefined || value === null) {
    if (!options.optional && !ctx.legacy) report(ctx.file, at, field, 'champ obligatoire absent');
    return;
  }
  if (!isText(value)) {
    report(ctx.file, at, field, `chaîne non vide attendue (reçu ${describe(value)})`);
    return;
  }
  if (options.choices && !options.choices.has(value)) {
    report(ctx.file, at, field, `valeur inconnue « ${value} »`);
  }
  if (options.pattern && !options.pattern.test(value)) {
    report(ctx.file, at, field, `format inattendu « ${value} »`);
  }
  if (options.asset && !ctx.legacy && !assetExists(value)) {
    report(ctx.file, at, field, `fichier introuvable « ${value} »`);
  }
  if (options.url && !isHttpUrl(value)) {
    report(ctx.file, at, field, `URL http(s) attendue « ${value} »`);
  }
  if (options.date === 'iso' && !isIsoDate(value)) {
    report(ctx.file, at, field, `date inexistante ou mal formée « ${value} »`);
  }
  if (options.date === 'day-first' && !isDayFirstDate(value)) {
    report(ctx.file, at, field, `date inexistante ou mal formée « ${value} »`);
  }
}

function checkInt(ctx, entry, at, field, options = {}) {
  const value = entry[field];
  if (value === undefined || value === null) {
    if (!options.optional && !ctx.legacy) report(ctx.file, at, field, 'champ obligatoire absent');
    return;
  }
  if (!Number.isInteger(value)) {
    report(ctx.file, at, field, `entier attendu (reçu ${describe(value)})`);
    return;
  }
  if (options.min !== undefined && value < options.min) {
    report(ctx.file, at, field, `${value} est inférieur au minimum ${options.min}`);
  }
  if (options.max !== undefined && value > options.max) {
    report(ctx.file, at, field, `${value} dépasse le maximum ${options.max}`);
  }
}

function checkBool(ctx, entry, at, field, options = {}) {
  const value = entry[field];
  if (value === undefined || value === null) {
    if (!options.optional && !ctx.legacy) report(ctx.file, at, field, 'champ obligatoire absent');
    return;
  }
  if (typeof value !== 'boolean') report(ctx.file, at, field, `booléen attendu (reçu ${describe(value)})`);
}

// Renvoie le tableau quand il est exploitable, sinon null.
function checkArray(ctx, entry, at, field, options = {}) {
  const value = entry[field];
  if (value === undefined || value === null) {
    if (!options.optional && !ctx.legacy) report(ctx.file, at, field, 'champ obligatoire absent');
    return null;
  }
  if (!Array.isArray(value)) {
    report(ctx.file, at, field, `tableau attendu (reçu ${describe(value)})`);
    return null;
  }
  if (options.min !== undefined && value.length < options.min) {
    report(ctx.file, at, field, `au moins ${options.min} entrée(s) attendue(s), ${value.length} trouvée(s)`);
  }
  return value;
}

function checkObject(ctx, entry, at, field, options = {}) {
  const value = entry[field];
  if (value === undefined || value === null) {
    if (!options.optional && !ctx.legacy) report(ctx.file, at, field, 'champ obligatoire absent');
    return null;
  }
  if (!isObject(value)) {
    report(ctx.file, at, field, `objet attendu (reçu ${describe(value)})`);
    return null;
  }
  return value;
}

function entryLabel(entry, index, keys) {
  if (!isObject(entry)) return `#${index}`;
  const key = keys.find((name) => entry[name] !== undefined && entry[name] !== null);
  return key ? `#${index} (${key} ${entry[key]})` : `#${index}`;
}

// ── Lecture et identification des fichiers ──────────────────
const ARCHIVES = new Map([
  ['data/credits.json', 'credits'],
  ['data/backup.json', 'mons'],
  ['data/new_backup.json', 'mons'],
  ['data/bonus_challenges.json', 'challenges'],
  ['data/cosmetics.json', 'cosmetics'],
  ['data/reward.json', 'rewards'],
  ['data/trophies.json', 'trophies']
]);

function identify(relative) {
  const manifest = /^data\/([a-z_]+)files\.json$/i.exec(relative);
  if (manifest) return { family: 'manifest', directory: manifest[1] };
  if (ARCHIVES.has(relative)) return { family: ARCHIVES.get(relative), legacy: true };
  if (relative === 'data/changelog.json') return { family: 'changelog' };
  if (relative === 'data/version.json') return { family: 'version' };
  if (relative.startsWith('data/mons/')) return { family: 'mons' };
  if (relative.startsWith('data/trophies/')) return { family: 'trophies' };
  if (relative.startsWith('data/rewards/')) return { family: 'rewards' };
  if (relative.startsWith('data/bonus_challenges/')) return { family: 'challenges' };
  if (relative.startsWith('data/cosmetics/')) return { family: 'cosmetics' };
  if (relative.startsWith('data/credits/')) return { family: 'credits' };
  return { family: 'unknown' };
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.json')) out.push(full);
  }
  return out.sort();
}

const files = [];
for (const full of walk(path.join(ROOT, 'data'))) {
  const relative = toRel(full);
  const descriptor = identify(relative);
  const stats = familyStats.get(descriptor.family) || { files: 0, entries: 0 };
  stats.files += 1;
  familyStats.set(descriptor.family, stats);

  let value;
  try {
    value = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (error) {
    report(relative, '—', 'JSON', `illisible : ${String(error.message || error).split('\n')[0]}`);
    files.push({ ...descriptor, relative, value: undefined });
    continue;
  }
  files.push({ ...descriptor, relative, value });
  if (Array.isArray(value)) stats.entries += value.length;
}

// ── Références croisées (uniquement les fichiers chargés par l'app) ──
for (const file of files) {
  if (file.legacy) continue;
  // Les crédits sont répartis en objets (traductions + membres).
  if (file.family === 'credits' && isObject(file.value)) {
    const parts = [
      [file.value.TranslationsFR, creditTranslations.fr],
      [file.value.TranslationsEN, creditTranslations.en]
    ];
    for (const [map, set] of parts) {
      if (!isObject(map)) continue;
      for (const [key, text] of Object.entries(map)) set.set(key, text);
    }
    continue;
  }
  if (!Array.isArray(file.value)) continue;
  if (file.family === 'mons') {
    for (const entry of file.value) if (isObject(entry) && entry.Index !== undefined) monsIndexes.add(String(entry.Index));
  }
  if (file.family === 'trophies') {
    for (const entry of file.value) if (isObject(entry) && Number.isInteger(entry.Id)) trophyIds.add(entry.Id);
  }
  if (file.family === 'cosmetics') {
    for (const entry of file.value) if (isObject(entry) && Number.isInteger(entry.ID)) cosmeticIds.add(entry.ID);
  }
}

// ── Validateurs par famille ─────────────────────────────────
function validateManifest(file) {
  const ctx = { file: file.relative, legacy: false };
  const entries = checkArray(ctx, { list: file.value }, '—', 'list', {});
  if (!entries) return;
  const seen = new Set();
  entries.forEach((name, index) => {
    const at = `#${index}`;
    if (!isText(name)) {
      report(ctx.file, at, '—', `nom de fichier attendu (reçu ${describe(name)})`);
      return;
    }
    if (seen.has(name)) report(ctx.file, at, '—', `déclaré deux fois : ${name}`);
    seen.add(name);
    const target = path.join(ROOT, 'data', file.directory, name);
    if (!fs.existsSync(target)) {
      report(ctx.file, at, '—', `fichier déclaré introuvable : data/${file.directory}/${name}`);
    }
  });

  // Un fichier présent mais absent du manifeste n'est jamais chargé : c'est une
  // donnée morte, presque toujours un oubli d'ajout au manifeste.
  const directory = path.join(ROOT, 'data', file.directory);
  if (!fs.existsSync(directory)) return;
  for (const name of fs.readdirSync(directory).filter((item) => item.endsWith('.json')).sort()) {
    if (!seen.has(name)) report(ctx.file, '—', '—', `fichier non déclaré dans le manifeste : ${name}`);
  }
}

function validateMons(file) {
  const ctx = { file: file.relative, legacy: !!file.legacy };
  file.value.forEach((entry, index) => {
    const at = entryLabel(entry, index, ['Index']);
    if (!isObject(entry)) return report(ctx.file, at, '—', 'objet attendu');

    if (entry.Index === undefined || entry.Index === null || entry.Index === '') {
      if (!ctx.legacy) report(ctx.file, at, 'Index', 'champ obligatoire absent');
    } else if (typeof entry.Index !== 'string' && !Number.isInteger(entry.Index)) {
      report(ctx.file, at, 'Index', `chaîne ou entier attendu (reçu ${describe(entry.Index)})`);
    } else {
      claimUnique(scopeKey(ctx, 'mons'), ctx, at, 'Index', entry.Index);
    }

    checkText(ctx, entry, at, 'NameEN');
    checkText(ctx, entry, at, 'NameFR');
    checkInt(ctx, entry, at, 'Generation', { min: 1, max: 9 });
    checkText(ctx, entry, at, 'Type1', { choices: POKEMON_TYPES });
    // Type2 vide ou null est la norme pour une espèce mono-type.
    if (entry.Type2 !== undefined && entry.Type2 !== null && entry.Type2 !== '') {
      checkText(ctx, entry, at, 'Type2', { choices: POKEMON_TYPES });
    }
    checkText(ctx, entry, at, 'Image', { asset: true });
    checkText(ctx, entry, at, 'FullImage', { asset: true });
    const eggGroups = checkArray(ctx, entry, at, 'EggGroups', { min: ctx.legacy ? 0 : 1 });
    if (eggGroups) {
      eggGroups.forEach((group, i) => {
        if (!isText(group)) report(ctx.file, at, `EggGroups[${i}]`, `chaîne non vide attendue (reçu ${describe(group)})`);
      });
    }
    checkText(ctx, entry, at, 'Category');
    checkInt(ctx, entry, at, 'pokefeet_data_version', { min: 1 });

    if (entry.evolve_from !== undefined && entry.evolve_from !== null && !ctx.legacy) {
      const from = String(entry.evolve_from);
      if (!monsIndexes.has(from)) report(ctx.file, at, 'evolve_from', `espèce inconnue « ${from} »`);
    }
  });
}

function validateTrophies(file) {
  const ctx = { file: file.relative, legacy: !!file.legacy };
  file.value.forEach((entry, index) => {
    const at = entryLabel(entry, index, ['Id']);
    if (!isObject(entry)) return report(ctx.file, at, '—', 'objet attendu');

    if (Number.isInteger(entry.Id)) claimUnique(scopeKey(ctx, 'trophies'), ctx, at, 'Id', entry.Id);
    else checkInt(ctx, entry, at, 'Id', { min: 1 });

    for (const field of ['Name_en', 'Name_fr', 'Desc_en', 'Desc_fr']) checkText(ctx, entry, at, field);
    checkInt(ctx, entry, at, 'XP', { min: 0 });
    checkInt(ctx, entry, at, 'Rarity', { min: 1, max: 4 });
    checkText(ctx, entry, at, 'Picture', { asset: true });
    checkBool(ctx, entry, at, 'Enabled');

    const method = checkObject(ctx, entry, at, 'Obtention_Method');
    if (!method) return;
    const methodAt = `${at} › Obtention_Method`;
    checkText(ctx, method, methodAt, 'Mode', { choices: OBTENTION_MODES });
    checkInt(ctx, method, methodAt, 'Value');
    if (method.Mode === 'Type_Registered') {
      const type = method.Type;
      if (!isText(type) || !POKEMON_TYPES.has(String(type).toLowerCase())) {
        report(ctx.file, methodAt, 'Type', `type inconnu « ${describe(type)} »`);
      }
    }
  });
}

function validateRewards(file) {
  const ctx = { file: file.relative, legacy: !!file.legacy };
  file.value.forEach((entry, index) => {
    const at = entryLabel(entry, index, ['Level']);
    if (!isObject(entry)) return report(ctx.file, at, '—', 'objet attendu');

    if (Number.isInteger(entry.Level)) claimUnique(scopeKey(ctx, 'rewards'), ctx, at, 'Level', entry.Level);
    else checkInt(ctx, entry, at, 'Level', { min: 1, max: 100 });

    checkText(ctx, entry, at, 'ImageUrl', { asset: true });
    for (const field of ['Title_FR', 'Title_EN', 'Description_FR', 'Description_EN']) checkText(ctx, entry, at, field);

    const items = checkArray(ctx, entry, at, 'Reward', { min: 1 });
    if (items) {
      items.forEach((item, i) => {
        const itemAt = `${at} › Reward[${i}]`;
        if (!isObject(item)) return report(ctx.file, itemAt, '—', 'objet attendu');
        checkText(ctx, item, itemAt, 'Type', { choices: REWARD_ITEM_TYPES });
        if (item.Type === 'Currency') {
          checkInt(ctx, item, itemAt, 'Data', { min: 0 });
        } else {
          checkText(ctx, item, itemAt, 'Data', { asset: item.Type === 'Badge' });
        }
      });
    }

    if (entry.Button !== undefined && entry.Button !== null) {
      const button = checkObject(ctx, entry, at, 'Button');
      if (button) {
        const buttonAt = `${at} › Button`;
        checkText(ctx, button, buttonAt, 'TxtButton_FR');
        checkText(ctx, button, buttonAt, 'TxtButton_EN');
        checkText(ctx, button, buttonAt, 'UrlButton', { url: true });
      }
    }
  });
}

function validateChallenges(file) {
  const ctx = { file: file.relative, legacy: !!file.legacy };
  file.value.forEach((entry, index) => {
    const at = entryLabel(entry, index, ['ID']);
    if (!isObject(entry)) return report(ctx.file, at, '—', 'objet attendu');

    if (Number.isInteger(entry.ID)) claimUnique(scopeKey(ctx, 'challenges'), ctx, at, 'ID', entry.ID);
    else checkInt(ctx, entry, at, 'ID', { min: 1 });

    checkText(ctx, entry, at, 'Difficulty', { choices: DIFFICULTIES });
    checkText(ctx, entry, at, 'Tab');
    for (const field of ['Name_En', 'Name_Fr', 'Desc_En', 'Desc_Fr']) checkText(ctx, entry, at, field);

    const feet = checkArray(ctx, entry, at, 'FeetList', { min: 1 });
    if (feet) {
      feet.forEach((index_, i) => {
        const feetAt = `${at} › FeetList[${i}]`;
        if (!isText(index_) && !Number.isInteger(index_)) {
          return report(ctx.file, feetAt, '—', `identifiant d'espèce attendu (reçu ${describe(index_)})`);
        }
        const key = String(index_);
        if (!ctx.legacy && !monsIndexes.has(key)) report(ctx.file, feetAt, '—', `espèce inconnue « ${key} »`);
      });
    }

    const rewards = checkArray(ctx, entry, at, 'Rewards', { min: 1 });
    if (rewards) {
      rewards.forEach((reward, i) => {
        const rewardAt = `${at} › Rewards[${i}]`;
        if (!isObject(reward)) return report(ctx.file, rewardAt, '—', 'objet attendu');
        checkText(ctx, reward, rewardAt, 'TypeReward', { choices: REWARD_TYPES });
        if (reward.TypeReward === 'Experience') {
          checkInt(ctx, reward, rewardAt, 'Value', { min: 1 });
        } else if (reward.TypeReward === 'Cosmetic') {
          if (Number.isInteger(reward.Value)) {
            if (!ctx.legacy && !cosmeticIds.has(reward.Value)) {
              report(ctx.file, rewardAt, 'Value', `cosmétique inconnu ${reward.Value}`);
            }
          } else {
            report(ctx.file, rewardAt, 'Value', `identifiant de cosmétique attendu (reçu ${describe(reward.Value)})`);
          }
        }
      });
    }

    const requirements = checkArray(ctx, entry, at, 'Requirements', { min: 0 });
    if (requirements) {
      requirements.forEach((requirement, i) => {
        const requirementAt = `${at} › Requirements[${i}]`;
        if (!isObject(requirement)) return report(ctx.file, requirementAt, '—', 'objet attendu');
        checkText(ctx, requirement, requirementAt, 'TypeRequirement', { choices: REQUIREMENT_TYPES });
        if (requirement.TypeRequirement === 'level') {
          checkInt(ctx, requirement, requirementAt, 'Value', { min: 1 });
        } else if (requirement.TypeRequirement === 'dexcount') {
          checkInt(ctx, requirement, requirementAt, 'Value', { min: 1 });
        } else if (requirement.TypeRequirement === 'trophy') {
          if (!Number.isInteger(requirement.Value)) {
            report(ctx.file, requirementAt, 'Value', `identifiant de trophée attendu (reçu ${describe(requirement.Value)})`);
          } else if (!ctx.legacy && !trophyIds.has(requirement.Value)) {
            report(ctx.file, requirementAt, 'Value', `trophée inconnu ${requirement.Value}`);
          }
        }
      });
    }

    if (entry.Availabilities !== undefined && entry.Availabilities !== null) {
      if (!Array.isArray(entry.Availabilities)) {
        report(ctx.file, at, 'Availabilities', `tableau ou null attendu (reçu ${describe(entry.Availabilities)})`);
      } else {
        entry.Availabilities.forEach((range, i) => {
          const rangeAt = `${at} › Availabilities[${i}]`;
          if (!isObject(range)) return report(ctx.file, rangeAt, '—', 'objet attendu');
          checkText(ctx, range, rangeAt, 'Start', { date: 'iso' });
          checkText(ctx, range, rangeAt, 'End', { date: 'iso' });
          if (isIsoDate(range.Start) && isIsoDate(range.End) && range.Start > range.End) {
            report(ctx.file, rangeAt, '—', `plage inversée (${range.Start} > ${range.End})`);
          }
        });
      }
    }

    checkBool(ctx, entry, at, 'MustHideIfUnavailable', { optional: true });
    checkText(ctx, entry, at, 'Additional_Info_Fr', { optional: true });
    checkText(ctx, entry, at, 'Additional_Info_En', { optional: true });
  });
}

function validateCosmetics(file) {
  const ctx = { file: file.relative, legacy: !!file.legacy };
  file.value.forEach((entry, index) => {
    const at = entryLabel(entry, index, ['ID']);
    if (!isObject(entry)) return report(ctx.file, at, '—', 'objet attendu');

    if (Number.isInteger(entry.ID)) claimUnique(scopeKey(ctx, 'cosmetics'), ctx, at, 'ID', entry.ID);
    else report(ctx.file, at, 'ID', `entier attendu (reçu ${describe(entry.ID)})`);

    checkText(ctx, entry, at, 'Type', { choices: COSMETIC_TYPES });
    checkText(ctx, entry, at, 'Name');
    checkText(ctx, entry, at, 'Value', { pattern: /^[A-Za-z0-9_-]+$/ });
    checkText(ctx, entry, at, 'File', { pattern: /\.(png|webp)$/i });
    checkBool(ctx, entry, at, 'RequiresUnlock');
    if (entry.Cat !== undefined && entry.Cat !== null) checkText(ctx, entry, at, 'Cat');
    checkBool(ctx, entry, at, 'MustHideIfUnobtained', { optional: true });

    // Le porte-monnaie ne vend que les entrées « Shop » avec un prix : un prix
    // manquant les rend invisibles, un prix hors boutique n'est jamais facturé.
    if (entry.Cat === 'Shop') {
      checkInt(ctx, entry, at, 'Price', { min: 0 });
    } else if (entry.Price !== undefined && entry.Price !== null) {
      report(ctx.file, at, 'Price', `prix défini hors catégorie Shop (Cat ${describe(entry.Cat)})`);
    }
  });
}

function validateCredits(file) {
  const ctx = { file: file.relative, legacy: !!file.legacy };
  const value = file.value;
  if (!isObject(value)) {
    return report(ctx.file, '—', '—', `objet attendu (reçu ${describe(value)})`);
  }

  for (const field of ['TranslationsFR', 'TranslationsEN']) {
    if (value[field] === undefined) continue;
    const map = checkObject(ctx, value, '—', field);
    if (!map) continue;
    for (const [key, text] of Object.entries(map)) {
      const label = `${field} › ${key}`;
      if (!/^Type\.[A-Za-z]+$/.test(key)) report(ctx.file, label, '—', `clé de traduction inattendue « ${key} »`);
      else if (!CREDIT_TYPES.has(key.slice(5))) report(ctx.file, label, '—', `type de crédit inconnu « ${key.slice(5)} »`);
      if (!isText(text)) report(ctx.file, label, '—', `libellé non vide attendu (reçu ${describe(text)})`);
    }
  }

  if (value.Credits === undefined) return;
  const credits = checkArray(ctx, value, '—', 'Credits', { min: 1 });
  if (!credits) return;
  credits.forEach((credit, index) => {
    const at = entryLabel(credit, index, ['Person']);
    if (!isObject(credit)) return report(ctx.file, at, '—', 'objet attendu');
    checkText(ctx, credit, at, 'Person');
    checkText(ctx, credit, at, 'Image', { url: true });
    checkText(ctx, credit, at, 'FunctionFR', { optional: true });
    checkText(ctx, credit, at, 'FunctionEN', { optional: true });

    const types = checkArray(ctx, credit, at, 'Types', { min: 1 });
    if (types) {
      types.forEach((type, i) => {
        const typeAt = `${at} › Types[${i}]`;
        if (!isText(type)) return report(ctx.file, typeAt, '—', `chaîne attendue (reçu ${describe(type)})`);
        if (!CREDIT_TYPES.has(type)) report(ctx.file, typeAt, '—', `type de crédit inconnu « ${type} »`);
        // Sans libellé « Type.X », la carte de crédit affiche la clé brute.
        if (!ctx.legacy && !creditTranslations.fr.has(`Type.${type}`)) {
          report(ctx.file, typeAt, '—', `libellé FR manquant pour Type.${type}`);
        }
        if (!ctx.legacy && !creditTranslations.en.has(`Type.${type}`)) {
          report(ctx.file, typeAt, '—', `libellé EN manquant pour Type.${type}`);
        }
      });
    }

    const buttons = checkArray(ctx, credit, at, 'Buttons', { optional: true, min: 0 });
    if (buttons) {
      buttons.forEach((button, i) => {
        const buttonAt = `${at} › Buttons[${i}]`;
        if (!isObject(button)) return report(ctx.file, buttonAt, '—', 'objet attendu');
        checkText(ctx, button, buttonAt, 'Text');
        checkText(ctx, button, buttonAt, 'Url', { url: true });
      });
    }
  });
}

function validateChangelog(file) {
  const ctx = { file: file.relative, legacy: !!file.legacy };
  file.value.forEach((entry, index) => {
    const at = entryLabel(entry, index, ['Title']);
    if (!isObject(entry)) return report(ctx.file, at, '—', 'objet attendu');

    const version = checkObject(ctx, entry, at, 'Version');
    if (version) {
      const versionAt = `${at} › Version`;
      for (const part of ['Major', 'Minor', 'Patch']) checkInt(ctx, version, versionAt, part, { min: 0 });
      checkText(ctx, version, versionAt, 'Stage', { choices: CHANGELOG_STAGES });

    }

    checkText(ctx, entry, at, 'Title');
    checkText(ctx, entry, at, 'Date', { date: 'day-first' });

    const changes = checkArray(ctx, entry, at, 'Changelog', { min: 1 });
    if (changes) {
      changes.forEach((change, i) => {
        const changeAt = `${at} › Changelog[${i}]`;
        if (!isObject(change)) return report(ctx.file, changeAt, '—', 'objet attendu');
        checkText(ctx, change, changeAt, 'Type', { choices: CHANGELOG_TYPES });
        checkInt(ctx, change, changeAt, 'Severity', { min: 1, max: 3 });
        checkText(ctx, change, changeAt, 'Translation_FR');
        checkText(ctx, change, changeAt, 'Translation_EN');
      });
    }
  });
}

function validateVersion(file) {
  const ctx = { file: file.relative, legacy: !!file.legacy };
  let previous = null;
  file.value.forEach((entry, index) => {
    const at = entryLabel(entry, index, ['pokefeet_data_version']);
    if (!isObject(entry)) return report(ctx.file, at, '—', 'objet attendu');

    checkInt(ctx, entry, at, 'pokefeet_data_version', { min: 1 });
    if (Number.isInteger(entry.pokefeet_data_version)) {
      claimUnique('versions', ctx, at, 'pokefeet_data_version', entry.pokefeet_data_version);
      if (previous !== null && entry.pokefeet_data_version <= previous) {
        report(ctx.file, at, 'pokefeet_data_version', `ordre croissant attendu (après ${previous})`);
      }
      previous = entry.pokefeet_data_version;
    }

    if (entry.deploy_date !== undefined && entry.deploy_date !== null) {
      checkText(ctx, entry, at, 'deploy_date', { date: 'iso' });
    }
    checkText(ctx, entry, at, 'Update_Name');
  });
}

// ── Aiguillage ──────────────────────────────────────────────
const VALIDATORS = {
  manifest: validateManifest,
  mons: validateMons,
  trophies: validateTrophies,
  rewards: validateRewards,
  challenges: validateChallenges,
  cosmetics: validateCosmetics,
  credits: validateCredits,
  changelog: validateChangelog,
  version: validateVersion
};

for (const file of files) {
  if (file.value === undefined) continue;
  const validator = VALIDATORS[file.family];
  if (!validator) {
    report(file.relative, '—', '—', 'type de JSON non identifié');
    continue;
  }
  if (file.family === 'manifest' || file.family === 'credits' || file.family === 'changelog' || file.family === 'version') {
    if (!Array.isArray(file.value) && !isObject(file.value)) {
      report(file.relative, '—', '—', `structure inattendue (reçu ${describe(file.value)})`);
      continue;
    }
    if (file.family !== 'credits' && !Array.isArray(file.value)) {
      report(file.relative, '—', '—', `tableau attendu (reçu ${describe(file.value)})`);
      continue;
    }
  } else if (!Array.isArray(file.value)) {
    report(file.relative, '—', '—', `tableau attendu (reçu ${describe(file.value)})`);
    continue;
  }
  validator(file);
}

// ── Rapport ────────────────────────────────────────────────
const filesCount = files.length;
console.log(`JSON identifiés : ${familyStats.size} familles, ${filesCount} fichier(s)`);
for (const family of Object.keys(FAMILY_LABELS)) {
  const stats = familyStats.get(family);
  if (!stats) continue;
  const label = FAMILY_LABELS[family].padEnd(20);
  const entries = family === 'credits' ? '' : ` — ${stats.entries} entrée(s)`;
  console.log(`  ${label} ${stats.files} fichier(s)${entries}`);
}

if (issues.length > 0) {
  const byFile = new Map();
  for (const issue of issues) {
    if (!byFile.has(issue.file)) byFile.set(issue.file, []);
    byFile.get(issue.file).push(issue);
  }
  for (const [file, fileIssues] of byFile) {
    console.error(`\n${file}`);
    for (const issue of fileIssues.slice(0, 12)) {
      console.error(`  ${issue.entry} › ${issue.field} · ${issue.message}`);
    }
    if (fileIssues.length > 12) console.error(`  … et ${fileIssues.length - 12} autre(s) problème(s) dans ce fichier`);
  }
  console.error(`\n✖ FAIL — ${issues.length} problème(s) dans ${new Set(issues.map((issue) => issue.file)).size} fichier(s)`);
  process.exit(1);
}

console.log('\n✔ PASS — tous les JSON de données sont cohérents');
