#!/usr/bin/env node
/**
 * Tests d'intégrité des données de jeu Pokefeet (sans navigateur).
 *
 * Ces fichiers JSON se répondent entre eux : un défi offre un cosmétique par
 * son identifiant, et chaque cosmétique désigne une classe CSS et une image.
 * Une faute de frappe dans l'un des trois ne casse rien au chargement, elle
 * produit simplement une récompense qui n'apparaît nulle part ou une vignette
 * vide. Ces vérifications le disent avant la mise en ligne.
 *
 * Vérifié :
 *   - les manifestes data/cosmeticsfiles.json et
 *     data/bonus_challengesfiles.json sont lisibles et leurs fichiers existent ;
 *   - chaque cosmétique déclare ID, Type, Name, Value et File, avec un ID unique ;
 *   - sa classe `Value` existe dans styles/cosmetics.css ;
 *   - son `File` existe dans img/cosmetics/ (casse comprise, un hébergement
 *     Linux étant sensible à la casse) ;
 *   - chaque récompense `Cosmetic` d'un défi pointe vers un cosmétique existant ;
 *   - aucun type de récompense inconnu ne passe inaperçu.
 *
 * Aucune dépendance npm. Usage : npm run test:data
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const COSMETICS_MANIFEST = 'data/cosmeticsfiles.json';
const COSMETICS_DIR = 'data/cosmetics/';
const COSMETICS_CSS = 'styles/cosmetics.css';
const COSMETICS_IMG = 'img/cosmetics/';
const CHALLENGES_MANIFEST = 'data/bonus_challengesfiles.json';
const CHALLENGES_DIR = 'data/bonus_challenges/';

const COSMETIC_FIELDS = ['ID', 'Type', 'Name', 'Value', 'File'];
const REWARD_TYPES = ['Experience', 'Cosmetic'];

const checks = [];

function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: detail ? String(detail).slice(0, 200) : null });
  return ok;
}

// Lit un JSON du projet ; renvoie { value } ou { error } sans lever d'exception.
function readJson(relative) {
  try {
    return { value: JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8')) };
  } catch (error) {
    return { error: `${relative} : ${String(error.message || error).split('\n')[0]}` };
  }
}

// Charge un jeu de données éclaté : manifeste -> fichiers -> entrées fusionnées.
function loadSet(manifestPath, dir, label) {
  const manifest = readJson(manifestPath);
  if (!check(`${label} : manifeste lisible`, manifest.value && Array.isArray(manifest.value), manifest.error)) {
    return [];
  }
  const files = manifest.value;
  check(`${label} : manifeste non vide`, files.length > 0, `${files.length} fichier(s)`);

  const entries = [];
  const unreadable = [];
  for (const file of files) {
    const content = readJson(dir + file);
    if (!Array.isArray(content.value)) {
      unreadable.push(content.error || `${dir}${file} : tableau attendu`);
      continue;
    }
    entries.push(...content.value);
  }
  check(`${label} : tous les fichiers du manifeste sont lisibles`, unreadable.length === 0, unreadable.join(' · '));
  return entries;
}

// Une classe CSS existe-t-elle telle quelle (pas seulement comme préfixe) ?
function hasCssClass(cssText, className) {
  const escaped = String(className).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\.${escaped}(?![A-Za-z0-9_-])`).test(cssText);
}

// ── Cosmétiques ─────────────────────────────────────────────
const cosmetics = loadSet(COSMETICS_MANIFEST, COSMETICS_DIR, 'cosmétiques');

const cssFile = path.join(ROOT, COSMETICS_CSS);
let css = '';
let cssError = null;
try {
  css = fs.readFileSync(cssFile, 'utf8');
} catch (error) {
  cssError = String(error.message || error).split('\n')[0];
}
check('feuille de style des cosmétiques lisible', !cssError, cssError || COSMETICS_CSS);

const imagesDir = path.join(ROOT, COSMETICS_IMG);
const images = fs.existsSync(imagesDir) ? new Set(fs.readdirSync(imagesDir)) : new Set();
check('dossier des images de cosmétiques lisible', images.size > 0, `${images.size} fichier(s) dans ${COSMETICS_IMG}`);

const incomplete = cosmetics.filter((item) => COSMETIC_FIELDS.some((field) => item[field] === null || item[field] === undefined || item[field] === ''));
check(
  'chaque cosmétique déclare ID, Type, Name, Value et File',
  incomplete.length === 0,
  incomplete.map((item) => `${item.ID ?? '?'} (${item.Name ?? 'sans nom'})`).join(', ')
);

const idCounts = new Map();
for (const item of cosmetics) {
  const id = Number(item.ID);
  idCounts.set(id, (idCounts.get(id) || 0) + 1);
}
const duplicateIds = [...idCounts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
check('les identifiants de cosmétiques sont uniques', duplicateIds.length === 0, `dupliqué(s) : ${duplicateIds.join(', ')}`);

const withoutClass = cosmetics.filter((item) => item.Value && !hasCssClass(css, item.Value));
check(
  `chaque cosmétique a sa classe CSS dans ${COSMETICS_CSS}`,
  withoutClass.length === 0,
  withoutClass.map((item) => `${item.ID} → .${item.Value}`).join(', ')
);

const withoutImage = cosmetics.filter((item) => item.File && !images.has(String(item.File)));
// Une casse différente casse l'image en production tout en marchant sous Windows.
const nearMisses = withoutImage.map((item) => {
  const expected = String(item.File).toLowerCase();
  const actual = [...images].find((name) => name.toLowerCase() === expected);
  return actual ? `${item.ID} → ${item.File} (fichier réel : ${actual})` : `${item.ID} → ${item.File}`;
});
check(
  `chaque cosmétique a son image dans ${COSMETICS_IMG}`,
  withoutImage.length === 0,
  nearMisses.join(', ')
);

// ── Défis ──────────────────────────────────────────────────
const challenges = loadSet(CHALLENGES_MANIFEST, CHALLENGES_DIR, 'défis');

const cosmeticIds = new Set(cosmetics.map((item) => Number(item.ID)));
let cosmeticRewards = 0;
const unknownRewards = [];
const unknownTypes = [];

for (const challenge of challenges) {
  for (const reward of challenge.Rewards || []) {
    if (!REWARD_TYPES.includes(reward.TypeReward)) {
      unknownTypes.push(`défi ${challenge.ID} → ${reward.TypeReward}`);
      continue;
    }
    if (reward.TypeReward !== 'Cosmetic') continue;
    cosmeticRewards += 1;
    if (!cosmeticIds.has(Number(reward.Value))) {
      unknownRewards.push(`défi ${challenge.ID} → cosmétique ${reward.Value}`);
    }
  }
}

check('aucun type de récompense inconnu dans les défis', unknownTypes.length === 0, unknownTypes.join(', '));
check('les défis distribuent des cosmétiques', cosmeticRewards > 0, `${cosmeticRewards} récompense(s) Cosmetic`);
check(
  'chaque récompense Cosmetic pointe vers un cosmétique existant',
  unknownRewards.length === 0,
  unknownRewards.join(', ')
);

// ── Rapport ────────────────────────────────────────────────
for (const item of checks) {
  const line = `${item.ok ? '✔' : '✖'} ${item.name}${item.ok || !item.detail ? '' : ` — ${item.detail}`}`;
  if (item.ok) console.log(line);
  else console.error(line);
}

const failed = checks.filter((item) => !item.ok).length;
const summary = `${checks.length - failed}/${checks.length} vérifications — intégrité des données ` +
  `(${cosmetics.length} cosmétiques, ${challenges.length} défis)`;
if (failed === 0) console.log(`\n✔ PASS — ${summary}`);
else console.error(`\n✖ FAIL — ${summary}`);

process.exit(failed === 0 ? 0 : 1);
