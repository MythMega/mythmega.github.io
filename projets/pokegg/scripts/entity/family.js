// Classe représentant une famille de Pokémon
class Family {
  constructor(data) {
    this.name = data.Family;
    this.eggImage = data.Egg;
    this.rarity = data.Rarity;
    this.members = data.Members.map(memberData => new Pokemon(memberData));
    this.membersByStage = {};
    
    // Organiser les membres par stage
    this.members.forEach(member => {
      if (!this.membersByStage[member.stage]) {
        this.membersByStage[member.stage] = [];
      }
      this.membersByStage[member.stage].push(member);
    });
  }

  getMembersByStage(stage) {
    return this.membersByStage[stage] || [];
  }

  getRandomMember(stage) {
    const members = this.getMembersByStage(stage);
    if (members.length === 0) {
      return this.members[0]; // Fallback au premier membre
    }
    return members[Math.floor(Math.random() * members.length)];
  }

  getClicksNeeded(stage) {
    // ((family rarity²)*2 ^ stage) * 5)
    // Utilise le carré de la rareté pour rendre les œufs rares plus difficiles à ouvrir
    return (this.rarity * this.rarity * Math.pow(2, stage)) * 5;
  }

  getUnlockThreshold(stage) {
    // Stage 1 : 0 (toujours disponible)
    // Stage 2 : 5
    // Stage 3 : 25
    // Stage 4 : 125
    const thresholds = {
      1: 0,
      2: 5,
      3: 25,
      4: 125
    };
    return thresholds[stage] || 0;
  }
}
