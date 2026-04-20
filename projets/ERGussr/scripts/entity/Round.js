/**
 * Round entity — represents a single round in a daily or practice game.
 */
export class Round {
  /**
   * @param {number} roundNumber - 1-based index
   * @param {import('./Item.js').Item} item
   */
  constructor(roundNumber, item) {
    this.roundNumber = roundNumber;
    this.item = item;
    this.fails = 0;       // 0, 1, or 2
    this.revealed = false; // true when the item name is shown (found or forced reveal)
    this.found = false;    // true if player guessed correctly
    this.score = 0;        // points earned this round
  }

  /**
   * Computes the score for this round based on fails count.
   * 0 fails → 10, 1 fail → 5, 2 fails → 2, 3 fails (reveal) → 0
   */
  computeScore() {
    if (!this.found) return 0;
    if (this.fails === 0) return 10;
    if (this.fails === 1) return 5;
    if (this.fails === 2) return 2;
    return 0;
  }

  /** Returns emoji representation for the result summary. */
  toEmoji() {
    if (!this.found) return "🟥🟥🟥";
    if (this.fails === 0) return "🟩🟩🟩";
    if (this.fails === 1) return "🟧🟩🟩";
    if (this.fails === 2) return "🟧🟧🟩";
    return "🟥🟥🟥";
  }
}
