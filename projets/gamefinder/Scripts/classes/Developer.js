/**
 * Developer.js
 * Classe modèle représentant un développeur (company).
 * Source : table `game_developers`.
 */

class Developer {
  /**
   * @param {Object} row
   */
  constructor(row) {
    this.id       = row.company_id;
    this.name     = row.company_name;
    this.url      = row.url      || null;
    this.logo_url = row.logo_url || null;
    /** @type {number[]} Ids de jeux associés (chargés à la demande) */
    this.gameIds = [];
  }

  static fromRow(row) {
    return new Developer(row);
  }
}

window.Developer = Developer;
