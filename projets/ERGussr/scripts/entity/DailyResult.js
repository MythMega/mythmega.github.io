/**
 * DailyResult entity — stored in IndexedDB for each completed daily.
 */
export class DailyResult {
  /**
   * @param {string} date - "jj-mm-yyyy"
   * @param {number} scoreTotal
   * @param {Array<{roundNumber:number, scoreRound:number, failsCount:number, status:string}>} rounds
   * @param {Array<string[]>} [wrongGuesses] - per-round array of wrong guess strings
   */
  constructor(date, scoreTotal, rounds, wrongGuesses = null) {
    this.date = date;
    this.scoreTotal = scoreTotal;
    this.rounds = rounds; // [{round_number, score_round, fails_count, status}]
    this.wrongGuesses = wrongGuesses || rounds.map(() => []);
  }

  /** Serialize to compact format for export. */
  toCompact() {
    return {
      dt: this.date,
      s: this.scoreTotal,
      r: this.rounds.map((r, i) => ({
        n: r.round_number,
        sc: r.score_round,
        f: r.fails_count,
        wg: this.wrongGuesses[i] || []
      }))
    };
  }

  /** Deserialize from compact format. */
  static fromCompact(obj) {
    const rounds = obj.r.map(r => ({
      round_number: r.n,
      score_round: r.sc,
      fails_count: r.f,
      status: r.sc > 0 ? "win" : "fail"
    }));
    const wrongGuesses = obj.r.map(r => r.wg || []);
    return new DailyResult(obj.dt, obj.s, rounds, wrongGuesses);
  }

  /**
   * Generates the visual-only string (header + emoji lines, no spoiler attempts).
   * @returns {string}
   */
  toVisualString() {
    const lines = this.rounds.map(r => {
      if (r.status === "fail") return "🟥🟥🟥";
      if (r.fails_count === 0) return "🟩🟩🟩";
      if (r.fails_count === 1) return "🟧🟩🟩";
      if (r.fails_count === 2) return "🟧🟧🟩";
      return "🟥🟥🟥";
    });
    return `Elden Description Daily — ${this.date} — score ${this.scoreTotal}\n${lines.join("\n")}`;
  }

  /**
   * Generates the shareable emoji summary string (with spoilered attempts).
   * @returns {string}
   */
  toShareString() {
    let text = this.toVisualString();

    // Append spoilered wrong attempts for rounds that had failures
    const attemptLines = [];
    for (let i = 0; i < this.rounds.length; i++) {
      const guesses = this.wrongGuesses[i] || [];
      if (guesses.length > 0) {
        const formatted = guesses
          .map(g => g === "> *reveal*" ? "> *reveal*" : `|| ${g} ||`)
          .join(" - ");
        attemptLines.push(`R${i + 1} : ${formatted}`);
      }
    }
    if (attemptLines.length > 0) {
      text += "\n" + attemptLines.join("\n");
    }

    return text;
  }
}
