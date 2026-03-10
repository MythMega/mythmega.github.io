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
    this.Image = data.Image ?? data.image ?? ""; // lien optionnel vers l'image partielle
    this.FullImage = data.FullImage ?? data.FullImage ?? ""; // lien optionnel vers l'image complète
    this.EggGroups = data.EggGroups ?? data.Eggroups ?? null; // array ou null
    this.Category = data.Category ?? null; // string ou null
  }

  matchesName(name) {
    if (!name) return false;
    const n = name.trim().toLowerCase();
    return n === (this.NameFR || '').toLowerCase() || n === (this.NameEN || '').toLowerCase();
  }

  getDisplayType2() {
    return this.Type2 ? this.Type2 : "N/A";
  }

  getEggGroupsDisplay() {
    if (!this.EggGroups) return "N/A";
    if (Array.isArray(this.EggGroups)) return this.EggGroups.join(" / ");
    return String(this.EggGroups);
  }

  getCategoryDisplay() {
    return this.Category ?? "N/A";
  }
}
