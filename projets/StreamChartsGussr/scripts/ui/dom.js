/**
 * Petits utilitaires DOM partagés par les vues.
 */
import { formatNumber } from './i18n.js';

export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function $$(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

export function clear(node) {
  node.replaceChildren();
}

/** Crée un élément depuis un descripteur simple. */
export function el(tag, { className = '', attrs = {}, text = '', children = [] } = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  Object.entries(attrs).forEach(([name, value]) => {
    if (value != null) node.setAttribute(name, value);
  });
  if (text) node.textContent = text;
  children.forEach((child) => node.append(child));
  return node;
}

const FALLBACK_ART = (() => {
  const svg =
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 285 380'>" +
    "<rect width='285' height='380' fill='#221344'/>" +
    "<g fill='none' stroke='#9146ff' stroke-width='8' stroke-linecap='round'>" +
    "<path d='M70 150l40-30 55 22 55-22 40 30v70l-32 24h-34l-16 28h-26l-16-28H102l-32-24z'/>" +
    "<path d='M95 205h22M93 224h10'/>" +
    "<circle cx='176' cy='212' r='7'/><circle cx='200' cy='212' r='7'/>" +
    "</g></svg>";
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
})();

/**
 * Pose l'image d'un jeu avec un repli : si la miniature Twitch est introuvable
 * (jeu retiré, URL expirée), on affiche une silhouette générique.
 */
export function applyGameImage(img, url) {
  img.onerror = () => {
    img.onerror = null;
    img.src = FALLBACK_ART;
  };
  img.src = url || FALLBACK_ART;
}

export function applyAvatar(img, url) {
  img.onerror = () => {
    img.onerror = null;
    img.hidden = true;
  };
  img.src = url || '';
  img.hidden = !url;
}

/** Formate un temps de stream en heures (localisé). */
export function formatHours(hours) {
  return formatNumber(hours, 1);
}