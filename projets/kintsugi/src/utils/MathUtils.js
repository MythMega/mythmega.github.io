// MathUtils.js — Helpers mathématiques
// Référence : _specifications/coding-guidelines.md §1
//
// Fonctions pures, sans état, sans dépendances.
// Usage :
//   import { clamp, lerp, randomBetween } from '../utils/MathUtils.js';

/**
 * Contraint une valeur entre un minimum et un maximum.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Interpolation linéaire entre a et b.
 * @param {number} a     Valeur de départ.
 * @param {number} b     Valeur d'arrivée.
 * @param {number} t     Facteur [0..1].
 * @returns {number}
 */
export function lerp(a, b, t) {
  return a + (b - a) * clamp(t, 0, 1);
}

/**
 * Retourne un entier aléatoire entre min (inclus) et max (inclus).
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Retourne un nombre flottant aléatoire entre min (inclus) et max (exclus).
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function randomFloat(min, max) {
  return Math.random() * (max - min) + min;
}

/**
 * Convertit des degrés en radians.
 * @param {number} degrees
 * @returns {number}
 */
export function toRad(degrees) {
  return degrees * (Math.PI / 180);
}

/**
 * Convertit des radians en degrés.
 * @param {number} radians
 * @returns {number}
 */
export function toDeg(radians) {
  return radians * (180 / Math.PI);
}

/**
 * Retourne le signe d'un nombre (-1, 0 ou 1).
 * @param {number} value
 * @returns {number}
 */
export function sign(value) {
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
}

/**
 * Vérifie si deux intervalles [aMin, aMax] et [bMin, bMax] se chevauchent.
 * Utile pour les vérifications de snap sur les rails.
 * @param {number} aMin
 * @param {number} aMax
 * @param {number} bMin
 * @param {number} bMax
 * @returns {boolean}
 */
export function overlaps(aMin, aMax, bMin, bMax) {
  return aMin <= bMax && aMax >= bMin;
}

/**
 * Calcule la distance entre deux points 2D.
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @returns {number}
 */
export function distance(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}
