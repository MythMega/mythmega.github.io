/**
 * Game.js
 * Classe modèle représentant un jeu vidéo.
 * Correspond à la table `games` + tables relationnelles.
 */

class Game {
  /**
   * @param {Object} row - Ligne brute retournée par la DB
   */
  constructor(row) {
    this.id                = row.id;
    this.name              = row.name;
    this.aggregated_rating = row.aggregated_rating;
    this.rating            = row.rating;
    this.first_release_date = row.first_release_date;
    this.storyline         = row.storyline;
    this.summary           = row.summary;
    this.cover_url         = row.cover_url;
    this.updated_at        = row.updated_at;
    this.url               = row.url;

    // Relations chargées à la demande (enrichissables)
    /** @type {string[]} */
    this.genres       = [];
    /** @type {string[]} */
    this.platforms    = [];
    /** @type {string[]} */
    this.modes        = [];
    /** @type {string[]} */
    this.themes       = [];
    /** @type {string[]} */
    this.perspectives = [];
    /** @type {{company_id:number,company_name:string}[]} */
    this.developers   = [];
    /** @type {{url:string}[]} */
    this.screenshots  = [];
    /** @type {{youtube_id:string}[]} */
    this.videos       = [];
    /** @type {string|null} */
    this.franchise    = null;
  }

  /**
   * Année de sortie lisible.
   * @returns {string}
   */
  get releaseYear() {
    if (!this.first_release_date) return 'Inconnue';
    return new Date(this.first_release_date * 1000).getFullYear().toString();
  }

  /**
   * Note formatée sur 100.
   * @returns {string}
   */
  get ratingDisplay() {
    const v = this.aggregated_rating || this.rating;
    return v ? Math.round(v).toString() : 'N/A';
  }

  /**
   * Construit une instance Game depuis une ligne DB.
   * @param {Object} row
   * @returns {Game}
   */
  static fromRow(row) {
    return new Game(row);
  }
}

window.Game = Game;
