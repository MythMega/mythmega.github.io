// pokemon.js
// Classe représentant un Pokémon
class Pokemon {
  constructor(data) {
    this.Index = data.Index; // string ou number
    this.NameEN = data.NameEN;
    this.NameFR = data.NameFR;
    this.Generation = data.Generation;
    this.Type1 = data.Type1;
    this.Type2 = data.Type2 ?? null;
    this.Image = data.Image ?? data.image ?? ""; // lien optionnel vers l'image
  }

  matchesName(name) {
    if (!name) return false;
    const n = name.trim().toLowerCase();
    return n === (this.NameFR || '').toLowerCase() || n === (this.NameEN || '').toLowerCase();
  }

  getDisplayType2() {
    return this.Type2 ? this.Type2 : "N/A";
  }
}
