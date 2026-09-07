/**
 * Préparation du pool de jeux jouables, commune aux deux modes.
 *
 * Le mode Classique filtre les jeux de moins de 2 heures (évite des
 * réponses de "0h"), tandis que le mode Comparaison conserve les jeux
 * d'1 heure minimum (plus de données disponibles pour des comparaisons
 * pertinentes).
 */
export const MIN_HOURS_CLASSIC = 2;
export const MIN_HOURS_COMPARE = 1;
export const MIN_GAMES_REQUIRED = 2;

export class PoolTooSmallError extends Error {
  constructor(min) {
    super(`Au moins ${min} jeux sont nécessaires`);
    this.name = 'PoolTooSmallError';
    this.min = min;
  }
}

export function buildGamePool(entries, { min = MIN_GAMES_REQUIRED, minHours = MIN_HOURS_COMPARE } = {}) {
  const pool = entries.filter((entry) => entry.hours >= minHours);
  if (pool.length < min) {
    throw new PoolTooSmallError(min);
  }
  return pool;
}

/** Mélange de Fisher-Yates, sans modifier le tableau source. */
export function shuffle(source) {
  const result = [...source];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}