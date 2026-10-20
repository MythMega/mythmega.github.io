#!/usr/bin/env node
/**
 * Lint statique strict de Pokefeet (aucune dépendance npm).
 *
 * Vérifie :
 *  - la syntaxe de tous les scripts JS ;
 *  - les références locales des pages HTML (scripts, styles, images) ;
 *  - les ids HTML dupliqués et les clés i18n utilisées ;
 *  - l'équilibre des blocs CSS et les url()/@import locaux ;
 *  - la validité de tous les fichiers JSON ;
 *  - le schéma de settings/config.json ;
 *  - la parité des clés entre translations/fr.json et translations/en.json.
 *
 * Usage : npm run lint
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

function toRel(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function report(file, message, line = 1) {
  errors.push({ file: toRel(file), line, message });
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function walk(dir, accept) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, accept));
    else if (accept(full)) out.push(full);
  }
  return out.sort();
}

function lineAt(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function isExternal(value) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value);
}

function isLocalPath(value) {
  return value !== '' && !value.includes('${') && !isExternal(value);
}

function checkLocalReference(file, value, source, index) {
  if (!isLocalPath(value)) return;
  let clean = value.split('?')[0].split('#')[0];
  try {
    clean = decodeURIComponent(clean);
  } catch {
    // on garde la valeur brute, le fichier sera simplement signalé absent
  }
  if (!clean) return;
  const target = clean.startsWith('/')
    ? path.join(ROOT, clean.slice(1))
    : path.resolve(path.dirname(file), clean);
  if (!fs.existsSync(target)) {
    report(file, `référence locale introuvable : ${value}`, lineAt(source, index));
  }
}

// ── JS ────────────────────────────────────────────────────────
const jsFiles = walk(path.join(ROOT, 'js'), file => file.endsWith('.js'));
for (const file of jsFiles) {
  const source = read(file);
  try {
    new vm.Script(source, { filename: toRel(file) });
  } catch (error) {
    report(file, `syntaxe JS invalide : ${error.message}`);
  }

  const banned = [
    [/\bdebugger\b/, 'debugger interdit'],
    [/\beval\s*\(/, 'eval() interdit'],
    [/\bdocument\s*\.\s*write\s*\(/, 'document.write() interdit'],
    [/\b(?:TODO|FIXME|XXX)\b/, 'marqueur TODO/FIXME interdit']
  ];
  for (const [pattern, message] of banned) {
    if (pattern.test(source)) report(file, message);
  }
}

// ── JSON ─────────────────────────────────────────────────────
const jsonDirs = ['data', 'translations', 'settings'];
const jsonFiles = jsonDirs.flatMap(dir => walk(path.join(ROOT, dir), file => file.endsWith('.json')));
const jsonData = new Map();
for (const file of jsonFiles) {
  try {
    jsonData.set(file, JSON.parse(read(file)));
  } catch (error) {
    report(file, `JSON invalide : ${error.message}`);
  }
}

// ── config.json ──────────────────────────────────────────────
const configPath = path.join(ROOT, 'settings', 'config.json');
const config = jsonData.get(configPath);
if (!config || typeof config !== 'object' || Array.isArray(config)) {
  report(configPath, 'settings/config.json doit contenir un objet');
} else {
  const integer = (key, min, max) => {
    const value = config[key];
    if (!Number.isInteger(value) || value < min || value > max) {
      report(configPath, `${key} doit être un entier entre ${min} et ${max}`);
    }
  };
  integer('historyChartDays', 1, 3650);
  integer('oldDailyPageSize', 1, 500);
  for (const key of Object.keys(config)) {
    if (key !== 'historyChartDays' && key !== 'oldDailyPageSize') {
      report(configPath, `propriété inconnue : ${key}`);
    }
  }
}

// ── i18n ─────────────────────────────────────────────────────
function flatten(object, prefix = '') {
  const out = new Map();
  for (const [key, value] of Object.entries(object || {})) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [nestedKey, nestedValue] of flatten(value, full)) out.set(nestedKey, nestedValue);
    } else {
      out.set(full, value);
    }
  }
  return out;
}

const frPath = path.join(ROOT, 'translations', 'fr.json');
const enPath = path.join(ROOT, 'translations', 'en.json');
const frKeys = flatten(jsonData.get(frPath));
const enKeys = flatten(jsonData.get(enPath));
for (const key of frKeys.keys()) {
  if (!enKeys.has(key)) report(enPath, `clé absente en anglais : ${key}`);
}
for (const key of enKeys.keys()) {
  if (!frKeys.has(key)) report(frPath, `clé absente en français : ${key}`);
}

// ── HTML ─────────────────────────────────────────────────────
const htmlFiles = fs.readdirSync(ROOT)
  .filter(name => name.endsWith('.html'))
  .map(name => path.join(ROOT, name))
  .sort();

for (const file of htmlFiles) {
  const source = read(file);

  for (const [pattern, message] of [
    [/<html(?:\s|>)/i, 'balise <html> absente'],
    [/<\/html>/i, 'balise </html> absente'],
    [/<head(?:\s|>)/i, 'balise <head> absente'],
    [/<body(?:\s|>)/i, 'balise <body> absente'],
    [/<meta[^>]+charset=/i, 'méta charset absente'],
    [/name=["']viewport["']/i, 'méta viewport absente']
  ]) {
    if (!pattern.test(source)) report(file, message);
  }

  const refPattern = /\b(?:src|href)\s*=\s*"([^"]*)"/gi;
  let match;
  while ((match = refPattern.exec(source)) !== null) {
    checkLocalReference(file, match[1], source, match.index);
  }

  const idCounts = new Map();
  const idPattern = /\bid\s*=\s*"([^"]+)"/gi;
  while ((match = idPattern.exec(source)) !== null) {
    const id = match[1];
    idCounts.set(id, (idCounts.get(id) || 0) + 1);
  }
  for (const [id, count] of idCounts) {
    if (count > 1) report(file, `id HTML dupliqué : ${id} (${count} occurrences)`, lineAt(source, source.indexOf(`id="${id}"`)));
  }

  if (/language-switcher\.js/.test(source) && !/styles\/main\.css/.test(source)) {
    report(file, 'le bouton de langue flottant nécessite styles/main.css');
  }
  if (/(?:history|old_daily)\.html$/.test(file) && !/js\/data\/config\.js/.test(source)) {
    report(file, 'cette page utilise settings/config.json et doit charger js/data/config.js');
  }
  if (/customizables-button/.test(source) && !/styles\/cosmetics\.css/.test(source)) {
    report(file, 'les boutons personnalisables nécessitent styles/cosmetics.css');
  }

  const i18nPattern = /\bdata-i18n(?:-attr)?\s*=\s*"([^"]+)"/gi;
  while ((match = i18nPattern.exec(source)) !== null) {
    for (const part of match[1].split('|')) {
      const key = part.includes(':') ? part.slice(part.indexOf(':') + 1) : part;
      if (!frKeys.has(key)) {
        report(file, `clé i18n absente : ${key}`, lineAt(source, match.index));
      }
    }
  }
}

// ── CSS ──────────────────────────────────────────────────────
const cssFiles = walk(path.join(ROOT, 'styles'), file => file.endsWith('.css'));
for (const file of cssFiles) {
  const source = read(file);
  let depth = 0;
  let quote = null;
  let comment = false;
  let escaped = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (comment) {
      if (char === '*' && next === '/') { comment = false; i += 1; }
      continue;
    }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '*') { comment = true; i += 1; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth < 0) {
        report(file, 'accolade fermante sans ouvrante', lineAt(source, i));
        depth = 0;
      }
    }
  }
  if (depth !== 0) report(file, `accolades CSS non équilibrées (${depth})`);

  const urlPattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  let match;
  while ((match = urlPattern.exec(source)) !== null) {
    const value = match[2].trim();
    if (!isLocalPath(value) || value.startsWith('var(')) continue;
    checkLocalReference(file, value, source, match.index);
  }
}

// ── Résultat ─────────────────────────────────────────────────
if (errors.length > 0) {
  const byFile = new Map();
  for (const error of errors) {
    if (!byFile.has(error.file)) byFile.set(error.file, []);
    byFile.get(error.file).push(error);
  }
  for (const [file, fileErrors] of byFile) {
    console.error(`\n${file}`);
    for (const error of fileErrors) {
      console.error(`  ${error.line}: ${error.message}`);
    }
  }
  console.error(`\n✖ ${errors.length} erreur(s) de lint`);
  process.exit(1);
}

console.log(`✔ Lint OK — ${htmlFiles.length} HTML, ${jsFiles.length} JS, ${cssFiles.length} CSS, ${jsonFiles.length} JSON`);
