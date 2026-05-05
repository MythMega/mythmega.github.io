/**
 * Genre.js
 * Classe modèle représentant un genre.
 * Source : table `genres` + `game_genres`.
 */

class Genre {
  constructor(row) {
    this.id   = row.id;
    this.name = row.name;
  }
  static fromRow(row) { return new Genre(row); }
}

window.Genre = Genre;
