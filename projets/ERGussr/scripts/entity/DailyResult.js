/**
 * DailyResult entity — stored in IndexedDB for each completed daily.
 */
export class DailyResult {
  /**
   * @param {string} date - "jj-mm-yyyy"
   * @param {number} scoreTotal
   * @param {Array<{roundNumber:number, scoreRound:number, failsCount:number, status:string}>} rounds
   */
  constructor(date, scoreTotal, rounds) {
    this.date = date;
    this.scoreTotal = scoreTotal;
    this.rounds = rounds; // [{round_number, score_round, fails_count, status}]
  }

  /** Serialize to compact format for export. */
  toCompact() {
    return {
      dt: this.date,
      s: this.scoreTotal,
      r: this.rounds.map(r => ({
        n: r.round_number,
        sc: r.score_round,
        f: r.fails_count
      }))
    };
  }

  /** Deserialize from compact format. */
  static fromCompact(obj) {
    return new DailyResult(
      obj.dt,
      obj.s,
      obj.r.map(r => ({
        round_number: r.n,
        score_round: r.sc,
        fails_count: r.f,
        status: r.sc > 0 ? "win" : "fail"
      }))
    );
  }

  /**
   * Generates the shareable emoji summary string.
   * @returns {string}
   */
  toShareString() {
    const lines = this.rounds.map(r => {
      if (r.status === "fail") return "🟥🟥🟥";
      if (r.fails_count === 0) return "🟩🟩🟩";
      if (r.fails_count === 1) return "🟧🟩🟩";
      if (r.fails_count === 2) return "🟧🟧🟩";
      return "🟥🟥🟥";
    });
    return `Elden Description Daily — ${this.date} — score ${this.scoreTotal}\n${lines.join("\n")}`;
  }
}
