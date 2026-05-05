/**
 * Franchise.js
 * Classe modèle représentant une franchise.
 * Source : table `franchises`.
 */

class Franchise {
  /**
   * @param {Object} row
   */
  constructor(row) {
    this.id   = row.id;
    this.name = row.name;
    /** @type {number[]} Ids de jeux associés (chargés à la demande) */
    this.gameIds = [];
  }

  static fromRow(row) {
    return new Franchise(row);
  }
}

window.Franchise = Franchise;
