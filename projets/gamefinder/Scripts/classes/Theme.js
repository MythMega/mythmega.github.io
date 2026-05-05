/**
 * Theme.js
 * Classe modèle représentant un thème.
 * Source : table `themes` + `game_themes`.
 */

class Theme {
  constructor(row) {
    this.id   = row.id;
    this.name = row.name;
  }
  static fromRow(row) { return new Theme(row); }
}

window.Theme = Theme;
