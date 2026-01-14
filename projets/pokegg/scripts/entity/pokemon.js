// Classe représentant un Pokémon (membre d'une famille)
class Pokemon {
  constructor(data) {
    this.index = data.Index;
    this.name_en = data.Name_EN;
    this.name_fr = data.Name_FR;
    this.sprite = data.Sprite;
    this.type1 = data.Type1;
    this.type2 = data.Type2;
    this.stage = data.Stage;
  }

  getName(lang = 'en') {
    return lang === 'fr' ? this.name_fr : this.name_en;
  }

  getTypes() {
    const types = [this.type1];
    if (this.type2) {
      types.push(this.type2);
    }
    return types;
  }
}
