/**
 * Mode Comparaison : deux jeux s'affrontent, on choisit le plus streamé.
 * En cas d'égalité parfaite, toute réponse est acceptée. Une bonne réponse
 * fait entrer le jeu B en position A et on pioche un nouveau B.
 */
import { shuffle } from './pool.js';

export default class CompareGame {
  constructor(entries) {
    this.entries = [...entries];
    this.pool = [];
    this.a = null;
    this.b = null;
    this.round = 0;
    this.streak = 0;
    this.over = false;
  }

  start() {
    this.a = null;
    this.b = null;
    this.pool = [];
    this.round = 0;
    this.streak = 0;
    this.over = false;
    return this.newRound();
  }

  get currentPair() {
    return { a: this.a, b: this.b };
  }

  newRound() {
    if (this.over) return null;

    if (this.a === null) {
      this.a = this.drawFromPool();
    }
    this.b = this.drawFromPool(this.a);

    if (!this.a || !this.b) {
      this.over = true;
      return null;
    }
    this.round += 1;
    return this.currentPair;
  }

  /** Pioche un jeu sans redonner deux fois le même dans un cycle. */
  drawFromPool(exclude = null) {
    if (this.pool.length === 0) {
      this.pool = shuffle(this.entries);
    }

    let candidate = this.pool.pop();
    while (candidate === exclude && this.pool.length > 0) {
      candidate = this.pool.pop();
    }
    if (candidate === exclude) {
      // Le pool ne contenait que le jeu exclu : on régénère et on pioche.
      this.pool = shuffle(this.entries);
      candidate = this.pool.pop();
    }
    return candidate || null;
  }

  /**
   * Répond pour A ou B. Renvoie un résumé exploitable par la vue, et fait
   * avancer l'état du jeu si la réponse est bonne.
   */
  answer(pick) {
    if (this.over || !this.a || !this.b) return null;

    const hoursA = this.a.hours;
    const hoursB = this.b.hours;
    const equal = hoursA === hoursB;
    const correct = equal || (pick === 'a') === hoursA > hoursB;
    const ratio = equal ? 1 : Math.max(hoursA, hoursB) / Math.min(hoursA, hoursB);

    const summary = {
      pick,
      correct,
      equal,
      ratio,
      a: this.a,
      b: this.b,
      streak: this.streak,
    };

    if (correct) {
      this.streak += 1;
      summary.streak = this.streak;
      this.a = this.b; // le jeu B devient le jeu A de la manche suivante
      this.b = null;
      summary.next = this.newRound();
    } else {
      this.over = true;
    }

    return summary;
  }
}