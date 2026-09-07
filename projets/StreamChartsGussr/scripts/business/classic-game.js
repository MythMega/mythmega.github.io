/**
 * Mode Classique : un jeu secret, on devine ses heures de stream.
 * Chaque guess renvoie « plus » ou « moins » jusqu'à tomber juste.
 *
 * La cible est arrondie à l'heure entière pour rester jouable ; la valeur
 * exacte (décimale) est révélée en fin de manche.
 */
import { shuffle } from './pool.js';

export default class ClassicGame {
  constructor(entries) {
    this.entries = [...entries];
    this.pool = [];
    this.round = 0;
    this.history = [];
    this.solution = null;
  }

  start() {
    this.round = 0;
    this.newRound();
  }

  newRound() {
    this.round += 1;
    this.history = [];

    if (this.pool.length === 0) {
      // On épulse le pool mélangé puis on le régénère : pas de répétition
      // dans un même cycle.
      this.pool = shuffle(this.entries);
    }
    this.solution = this.pool.pop();
    return this.solution;
  }

  get attempts() {
    return this.history.length;
  }

  get target() {
    return this.solution ? this.solution.hoursRounded : null;
  }

  /** Enregistre un guess ; renvoie null si la valeur est invalide. */
  guess(rawValue) {
    const value = Math.floor(Number(rawValue));
    if (!Number.isFinite(value) || value < 0) return null;

    const hint = value === this.target ? 'win' : value < this.target ? 'higher' : 'lower';
    this.history.push({ value, hint });

    if (hint === 'win') {
      return { hint, value, solution: this.solution, attempts: this.attempts };
    }
    return { hint, value };
  }
}