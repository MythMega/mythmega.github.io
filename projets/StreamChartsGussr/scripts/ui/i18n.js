/**
 * Internationalisation : chargement des dictionnaires JSON, traduction des
 * éléments annotés `data-i18n` et formatage des nombres dépendant de la langue.
 */
import { saveSettings } from '../data/settings-store.js';

const dictionaries = new Map();
let currentLang = 'fr';
let currentDict = {};

export async function initI18n(lang) {
  currentLang = lang || currentLang;
  currentDict = await loadDictionary(currentLang);
}

function loadDictionary(lang) {
  if (dictionaries.has(lang)) return Promise.resolve(dictionaries.get(lang));

  return fetch(`translations/${lang}.json`)
    .then((response) => {
      if (!response.ok) throw new Error(`Traduction "${lang}" introuvable`);
      return response.json();
    })
    .then((dict) => {
      dictionaries.set(lang, dict);
      return dict;
    });
}

/** Renvoie la traduction d'une clé, avec interpolation {var}. */
export function t(key, vars = {}) {
  const value = key
    .split('.')
    .reduce((obj, part) => (obj == null ? undefined : obj[part]), currentDict);

  const template = typeof value === 'string' ? value : key;
  return template.replace(/\{(\w+)\}/g, (_, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : `{${name}}`
  );
}

/** Applique les traductions aux éléments annotés dans un sous-arbre. */
export function translateDOM(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  });
  root.querySelectorAll('[data-i18n-title]').forEach((node) => {
    node.title = t(node.dataset.i18nTitle);
  });
  root.querySelectorAll('[data-i18n-aria-label]').forEach((node) => {
    node.setAttribute('aria-label', t(node.dataset.i18nAriaLabel));
  });
}

/** Change la langue au vol et retraduit toute la page. */
export async function setLang(lang) {
  if (!dictionaries.has(lang)) await loadDictionary(lang);
  currentLang = lang;
  currentDict = dictionaries.get(lang);
  saveSettings({ lang });
  translateDOM(document);
  window.dispatchEvent(new CustomEvent('app:langchange', { detail: { lang } }));
}

export function currentLanguage() {
  return currentLang;
}

export function formatNumber(value, digits = 1) {
  return new Intl.NumberFormat(currentLang, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value);
}

/** Formate des octets en unité lisible (Ko, Mo...). */
export function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Ko';
  const units = ['o', 'Ko', 'Mo', 'Go'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${formatNumber(value, index === 0 ? 0 : 1)} ${units[index]}`;
}

/**
 * Récupère la langue à utiliser au premier lancement : réglage sauvegardé,
 * sinon langue du navigateur si elle est supportée, sinon français.
 */
export function detectDefaultLang(browserLang = (navigator.language || 'fr')) {
  const supported = ['fr', 'en'];
  const candidate = browserLang.split('-')[0];
  return supported.includes(candidate) ? candidate : 'fr';
}