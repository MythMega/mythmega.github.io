/**
 * Platform.js
 * Classe modèle représentant une plateforme.
 * Source : table `platforms` + `game_platforms`.
 */

class Platform {
  constructor(row) {
    this.id   = row.id;
    this.name = row.name;
  }
  static fromRow(row) { return new Platform(row); }
}

window.Platform = Platform;
