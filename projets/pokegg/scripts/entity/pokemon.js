// Classe représentant un Pokémon (membre d'une famille)
class Pokemon {
  constructor(data) {
    // Gérer deux formats: le format du data.json (majuscules) et le format désérialisé (minuscules)
    this.index = data.Index || data.index;
    this.name_en = data.Name_EN || data.name_en;
    this.name_fr = data.Name_FR || data.name_fr;
    
    // Pour les sprites, gérer les deux formats
    const sprite = data.Sprite || data.spriteHome;
    this.spriteHome = sprite;
    this.spriteBW = data.Sprite_BW || data.spriteBW || sprite;
    this.spriteBW2 = data.Sprite_BW2 || data.spriteBW2 || sprite;
    
    this.type1 = data.Type1 || data.type1;
    this.type2 = data.Type2 || data.type2;
    this.stage = data.Stage || data.stage;
  }

  get sprite() {
    // Vérifier si optionsManager existe et a la méthode getSpriteVersion
    let version = 'home';
    if (typeof optionsManager !== 'undefined' && optionsManager.getSpriteVersion) {
      version = optionsManager.getSpriteVersion();
    }
    
    switch (version) {
      case 'bw':
        return this.spriteBW;
      case 'bw2':
        return this.spriteBW2;
      case 'home':
      default:
        return this.spriteHome;
    }
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
