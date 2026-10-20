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
 *  - la parité des clés entre translations/fr.json et translations/en.json ;
 *  - le manifeste PWA, ses icônes, ses captures et son scope de déploiement ;
 *  - la syntaxe du Service Worker et la cohérence de son précache ;
 *  - les balises PWA et l'enregistrement du Service Worker dans chaque page.
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

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngDimensions(file) {
  try {
    const buffer = fs.readFileSync(file);
    if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  } catch {
    return null;
  }
}

function isInsideRoot(file) {
  const relative = path.relative(ROOT, file);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
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
  integer('dexPageSize', 1, 500);
  integer('max3DRotate', 1, 90);
  for (const key of Object.keys(config)) {
    if (key !== 'historyChartDays' && key !== 'oldDailyPageSize' && key !== 'dexPageSize' && key !== 'max3DRotate') {
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
    [/<\/head>/i, 'balise </head> absente'],
    [/<body(?:\s|>)/i, 'balise <body> absente'],
    [/<\/body>/i, 'balise </body> absente'],
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

// ── PWA ──────────────────────────────────────────────────────
const DEPLOY_URL = 'https://web.jmdev.fr/projets/pokefeet/';
const manifestUrl = new URL(`${DEPLOY_URL}manifest.webmanifest`);
const manifestPath = path.join(ROOT, 'manifest.webmanifest');
let manifest = null;

try {
  manifest = JSON.parse(read(manifestPath));
} catch (error) {
  report(manifestPath, `manifeste PWA illisible : ${error.message}`);
}

function checkManifestPath(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    report(manifestPath, `${label} doit être une chaîne non vide`);
    return null;
  }
  try {
    const resolved = new URL(value, manifestUrl);
    if (!resolved.href.startsWith(DEPLOY_URL)) {
      report(manifestPath, `${label} sort du scope de déploiement : ${resolved.href}`);
    }
    return resolved;
  } catch {
    report(manifestPath, `${label} n’est pas une URL valide : ${value}`);
    return null;
  }
}

function checkManifestImage(entry, label) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    report(manifestPath, `${label} doit être un objet`);
    return null;
  }
  if (typeof entry.src !== 'string' || entry.src.trim() === '') {
    report(manifestPath, `${label}.src doit être une chaîne non vide`);
    return null;
  }

  const file = path.resolve(ROOT, entry.src);
  if (!isInsideRoot(file)) {
    report(manifestPath, `${label}.src sort du projet : ${entry.src}`);
    return null;
  }
  if (!fs.existsSync(file)) {
    report(manifestPath, `${label}.src introuvable : ${entry.src}`);
    return null;
  }
  if (entry.type !== 'image/png') {
    report(manifestPath, `${label}.type doit être image/png`);
  }

  const dimensions = pngDimensions(file);
  if (!dimensions) {
    report(manifestPath, `${label}.src n’est pas un PNG valide : ${entry.src}`);
    return null;
  }
  if (typeof entry.sizes !== 'string' || !/^\d+x\d+$/.test(entry.sizes)) {
    report(manifestPath, `${label}.sizes doit être au format LARGEURxHAUTEUR`);
  } else if (`${dimensions.width}x${dimensions.height}` !== entry.sizes) {
    report(
      manifestPath,
      `${label}.sizes (${entry.sizes}) ne correspond pas au fichier ${entry.src} (${dimensions.width}x${dimensions.height})`
    );
  }
  return { file, dimensions };
}

if (manifest && typeof manifest === 'object' && !Array.isArray(manifest)) {
  const textField = (key, min, max) => {
    const value = manifest[key];
    if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
      report(manifestPath, `${key} doit être une chaîne de ${min} à ${max} caractères`);
    }
  };

  textField('name', 1, 80);
  textField('short_name', 1, 30);
  textField('description', 10, 300);
  textField('lang', 2, 10);
  textField('dir', 3, 3);

  if (manifest.display !== 'standalone') report(manifestPath, 'display doit être « standalone »');
  if (!Array.isArray(manifest.display_override) || !manifest.display_override.includes('standalone')) {
    report(manifestPath, 'display_override doit inclure « standalone »');
  }
  if (manifest.orientation !== 'portrait') report(manifestPath, 'orientation doit être « portrait »');
  for (const key of ['theme_color', 'background_color']) {
    if (typeof manifest[key] !== 'string' || !/^#[0-9a-f]{6}$/i.test(manifest[key])) {
      report(manifestPath, `${key} doit être une couleur hexadécimale #RRGGBB`);
    }
  }
  if (!Array.isArray(manifest.categories) || manifest.categories.length === 0) {
    report(manifestPath, 'categories doit être un tableau non vide');
  } else if (manifest.categories.some(item => typeof item !== 'string' || item.trim() === '')) {
    report(manifestPath, 'categories ne doit contenir que des chaînes non vides');
  }
  if (manifest.prefer_related_applications !== false) {
    report(manifestPath, 'prefer_related_applications doit être false');
  }

  const scopeUrl = checkManifestPath(manifest.scope, 'scope');
  const startUrl = checkManifestPath(manifest.start_url, 'start_url');
  if (scopeUrl && scopeUrl.href !== DEPLOY_URL) {
    report(manifestPath, `scope doit résoudre vers ${DEPLOY_URL} (actuel : ${scopeUrl.href})`);
  }
  if (scopeUrl && startUrl && !startUrl.href.startsWith(scopeUrl.href)) {
    report(manifestPath, 'start_url doit rester dans le scope');
  }
  if (manifest.id !== undefined && scopeUrl) {
    const idUrl = checkManifestPath(manifest.id, 'id');
    if (idUrl && idUrl.href !== scopeUrl.href) {
      report(manifestPath, 'id doit correspondre au scope de l’application');
    }
  }

  const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
  if (icons.length === 0) report(manifestPath, 'icons doit contenir au moins une icône');
  for (const icon of icons) {
    checkManifestImage(icon, 'icons[]');
    if (icon && typeof icon.purpose === 'string') {
      for (const purpose of icon.purpose.split(/\s+/)) {
        if (!['any', 'maskable', 'monochrome'].includes(purpose)) {
          report(manifestPath, `purpose inconnu : ${purpose}`);
        }
      }
    }
  }
  const hasIcon = (size, purpose) =>
    icons.some(
      icon =>
        icon &&
        icon.sizes === size &&
        String(icon.purpose || 'any')
          .split(/\s+/)
          .includes(purpose)
    );
  for (const [size, purpose] of [
    ['192x192', 'any'],
    ['512x512', 'any'],
    ['192x192', 'maskable'],
    ['512x512', 'maskable']
  ]) {
    if (!hasIcon(size, purpose)) report(manifestPath, `icône ${purpose} ${size} manquante`);
  }

  const screenshots = Array.isArray(manifest.screenshots) ? manifest.screenshots : [];
  for (const screenshot of screenshots) {
    const checked = checkManifestImage(screenshot, 'screenshots[]');
    if (!screenshot || !['wide', 'narrow'].includes(screenshot.form_factor)) {
      report(manifestPath, 'screenshots[].form_factor doit être « wide » ou « narrow »');
      continue;
    }
    if (typeof screenshot.label !== 'string' || screenshot.label.trim() === '') {
      report(manifestPath, 'screenshots[].label est requis');
    }
    if (checked) {
      if (screenshot.form_factor === 'wide' && checked.dimensions.width <= checked.dimensions.height) {
        report(manifestPath, 'une capture « wide » doit être plus large que haute');
      }
      if (screenshot.form_factor === 'narrow' && checked.dimensions.width >= checked.dimensions.height) {
        report(manifestPath, 'une capture « narrow » doit être plus haute que large');
      }
    }
  }
  for (const factor of ['wide', 'narrow']) {
    if (!screenshots.some(screenshot => screenshot && screenshot.form_factor === factor)) {
      report(manifestPath, `capture ${factor} manquante`);
    }
  }

  const shortcuts = Array.isArray(manifest.shortcuts) ? manifest.shortcuts : [];
  for (const shortcut of shortcuts) {
    if (!shortcut || typeof shortcut.name !== 'string' || shortcut.name.trim() === '') {
      report(manifestPath, 'shortcuts[].name est requis');
      continue;
    }
    const target = checkManifestPath(shortcut.url, 'shortcuts[].url');
    if (target) {
      const relative = decodeURIComponent(target.pathname.slice(new URL(DEPLOY_URL).pathname.length));
      const targetFile = path.resolve(ROOT, relative || 'index.html');
      if (!isInsideRoot(targetFile) || !fs.existsSync(targetFile)) {
        report(manifestPath, `shortcut introuvable : ${shortcut.url}`);
      }
    }
    if (shortcut.icons !== undefined) {
      if (!Array.isArray(shortcut.icons)) report(manifestPath, 'shortcuts[].icons doit être un tableau');
      else for (const icon of shortcut.icons) checkManifestImage(icon, 'shortcuts[].icons[]');
    }
  }
}

// ── Service Worker ───────────────────────────────────────────
const swPath = path.join(ROOT, 'sw.js');
let swSource = '';
try {
  swSource = read(swPath);
} catch (error) {
  report(swPath, `Service Worker introuvable : ${error.message}`);
}

if (swSource) {
  try {
    new vm.Script(swSource, { filename: toRel(swPath) });
  } catch (error) {
    report(swPath, `syntaxe JS invalide : ${error.message}`);
  }

  for (const [pattern, message] of [
    [/self\.addEventListener\(\s*['"]install['"]/, 'écouteur install manquant'],
    [/self\.addEventListener\(\s*['"]activate['"]/, 'écouteur activate manquant'],
    [/self\.addEventListener\(\s*['"]fetch['"]/, 'écouteur fetch manquant'],
    [/CACHE_VERSION\s*=\s*['"]pokefeet-v\d+['"]/, 'CACHE_VERSION invalide']
  ]) {
    if (!pattern.test(swSource)) report(swPath, message);
  }

  const context = {
    URL,
    console,
    self: {
      location: new URL(`${DEPLOY_URL}sw.js`),
      addEventListener() {}
    }
  };
  vm.createContext(context);
  try {
    new vm.Script(`${swSource}\n;globalThis.__precache = PRECACHE_URLS;`).runInContext(context);
    const precache = context.__precache;
    if (!Array.isArray(precache)) {
      report(swPath, 'PRECACHE_URLS doit être un tableau');
    } else {
      const seen = new Set();
      for (const entry of precache) {
        if (typeof entry !== 'string' || !entry.startsWith('./')) {
          report(swPath, `entrée de précache invalide : ${String(entry)}`);
          continue;
        }
        if (seen.has(entry)) report(swPath, `entrée de précache dupliquée : ${entry}`);
        seen.add(entry);

        const target = entry === './' ? path.join(ROOT, 'index.html') : path.resolve(ROOT, entry);
        if (!isInsideRoot(target) || !fs.existsSync(target)) {
          report(swPath, `fichier précaché introuvable : ${entry}`);
        }
      }

      const relativeEntries = new Set(precache.map(entry => entry.replace(/^\.\//, '')));
      for (const required of ['./', './index.html', './offline.html', './manifest.webmanifest']) {
        if (!precache.includes(required)) report(swPath, `précache obligatoire manquant : ${required}`);
      }
      for (const file of htmlFiles) {
        const relative = toRel(file);
        if (!relativeEntries.has(relative)) report(swPath, `page absente du précache : ${relative}`);
      }
      for (const file of [...jsFiles, ...cssFiles]) {
        const relative = toRel(file);
        if (!relativeEntries.has(relative)) report(swPath, `asset absent du précache : ${relative}`);
      }
      for (const relative of [
        'settings/config.json',
        'translations/fr.json',
        'translations/en.json',
        'data/pokemons.json'
      ]) {
        if (!relativeEntries.has(relative)) report(swPath, `fichier critique absent du précache : ${relative}`);
      }
    }
  } catch (error) {
    report(swPath, `évaluation du Service Worker impossible : ${error.message}`);
  }
}

const pwaPath = path.join(ROOT, 'js', 'pwa.js');
try {
  const pwaSource = read(pwaPath);
  if (!/register\(\s*['"]sw\.js['"]/.test(pwaSource)) {
    report(pwaPath, 'le Service Worker doit être enregistré depuis sw.js');
  }
  if (!/scope\s*:\s*['"]\.\/['"]/.test(pwaSource)) {
    report(pwaPath, 'le scope d’enregistrement doit être « ./ »');
  }
} catch (error) {
  report(pwaPath, `script d’enregistrement introuvable : ${error.message}`);
}

for (const file of htmlFiles) {
  const source = read(file);
  const isOfflinePage = path.basename(file) === 'offline.html';
  const manifestLinks = source.match(/rel=["']manifest["']/gi) || [];

  if (manifestLinks.length !== 1) {
    report(file, `la page doit contenir exactement un lien manifest (${manifestLinks.length} trouvé(s))`);
  }
  if (!/rel=["']manifest["'][^>]*href=["']manifest\.webmanifest["']/i.test(source)) {
    report(file, 'lien vers manifest.webmanifest absent ou incorrect');
  }
  const themeColor = source.match(/name=["']theme-color["'][^>]*content=["']([^"']+)["']/i);
  if (!themeColor) {
    report(file, 'méta theme-color absente');
  } else if (manifest && typeof manifest.theme_color === 'string' && themeColor[1].toLowerCase() !== manifest.theme_color.toLowerCase()) {
    report(file, `theme-color (${themeColor[1]}) différent du manifeste (${manifest.theme_color})`);
  }
  if (!/name=["']apple-mobile-web-app-capable["'][^>]*content=["']yes["']/i.test(source)) {
    report(file, 'méta apple-mobile-web-app-capable absente');
  }
  if (!/rel=["']apple-touch-icon["']/i.test(source)) {
    report(file, 'lien apple-touch-icon absent');
  }
  if (!isOfflinePage && !/js\/pwa\.js/.test(source)) {
    report(file, 'script js/pwa.js absent');
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
