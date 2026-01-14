// Gestion de la logique métier du jeu
class GameManager {
  constructor() {
    this.families = [];
    this.currentEgg = null;
    this.currentClicks = 0;
    this.caughtPokemon = {}; // { pokemonIndex: { count: number, firstCaught: date } }
    this.autoclickInterval = null;
  }

  async initializeGame(dataJson) {
    try {
      const response = await fetch('./data.json');
      const data = await response.json();
      this.families = data.map(familyData => new Family(familyData));
      
      // Initialiser l'inventaire EN PREMIER
      await inventoryManager.initialize();
      
      // Charger les données de capture
      const savedData = await dataLoader.loadData();
      this.caughtPokemon = savedData.caughtPokemon || {};
      
      // Démarrer l'autoclick
      this.startAutoclick();
    } catch (error) {
      console.error('Error initializing game:', error);
    }
  }

  startAutoclick() {
    // Arrêter l'autoclick précédent s'il existe
    if (this.autoclickInterval) {
      clearInterval(this.autoclickInterval);
    }

    // Démarrer un nouvel autoclick toutes les 100ms
    this.autoclickInterval = setInterval(() => {
      // Vérifier qu'il y a un oeuf à cliquer - c'est LA priorité
      if (!this.currentEgg) {
        // Pas d'oeuf, on n'autoclick pas du tout
        return;
      }

      // Vérifier si on peut toujours cliquer (le bouton doit être visible)
      if (window.gameUI && window.gameUI.eggButton) {
        const isButtonVisible = window.gameUI.eggButton.style.display !== 'none';
        if (!isButtonVisible) {
          // Le bouton est caché, on n'autoclick pas
          return;
        }
      }

      const stats = inventoryManager ? inventoryManager.getStats() : null;
      if (!stats) {
        return;
      }

      const clicksPerInterval = (stats.autoclickValuePerSecond / 10); // 10 intervalles par seconde
      
      if (clicksPerInterval > 0) {
        // Effectuer le(s) click(s) automatique(s) via handleEggClick si possible
        for (let i = 0; i < Math.floor(clicksPerInterval); i++) {
          if (window.gameUI && window.gameUI.handleEggClick) {
            window.gameUI.handleEggClick();
          }
        }
        
        // Gérer les clics partiels (ex: 1.5 clics par intervalle)
        if (Math.random() < (clicksPerInterval % 1)) {
          if (window.gameUI && window.gameUI.handleEggClick) {
            window.gameUI.handleEggClick();
          }
        }
      }
    }, 100);
  }

  selectRandomEgg() {
    // Choisir une famille au hasard avec pondération par rareté
    // Les familles rares (rareté 1) sont plus communes, les familles légendaires (rareté 5) sont beaucoup plus rares
    // Pondération: chaque rareté a une valeur définie dans getFamilyWeight()
    // Utilisation de inverse de cette valeur comme poids pour la sélection (plus le poids est bas, moins la rareté est commune)
    const weightedFamilies = this.families.map(family => ({
      family: family,
      weight: 1 / this.getFamilyWeight(family.rarity) // Inverse du poids de rareté
    }));
    
    // Calculer le poids total
    const totalWeight = weightedFamilies.reduce((sum, entry) => sum + entry.weight, 0);
    
    // Sélectionner une famille basée sur la pondération
    let random = Math.random() * totalWeight;
    let selectedFamily = null;
    
    for (const entry of weightedFamilies) {
      random -= entry.weight;
      if (random <= 0) {
        selectedFamily = entry.family;
        break;
      }
    }
    
    // Fallback (ne devrait pas arriver ici)
    if (!selectedFamily) {
      selectedFamily = this.families[0];
    }
    
    // Déterminer le stage disponible
    let stage = 1;
    const familyEggCount = this.getFamilyEggCount(selectedFamily.name);
    
    if (familyEggCount >= 1 && Math.random() > 0.5) stage = 2;
    if (familyEggCount >= 5 && Math.random() > 0.5) stage = 3;
    if (familyEggCount >= 25 && Math.random() > 0.5) stage = 4;
    
    // Toujours possibilité de tomber sur stage 1
    if (Math.random() > 0.8) stage = 1;
    
    const pokemon = selectedFamily.getRandomMember(stage);
    const clicksNeeded = selectedFamily.getClicksNeeded(stage);
    
    this.currentEgg = {
      family: selectedFamily,
      pokemon: pokemon,
      clicksNeeded: clicksNeeded,
      currentClicks: 0
    };
    
    // Redémarrer l'autoclick dès qu'un œuf est sélectionné
    // Cela garantit que l'autoclick fonctionne même si un œuf est sélectionné après l'initialisation du jeu
    this.startAutoclick();
    
    return this.currentEgg;
  }

  getFamilyWeight(rarity) {
    // Retourne le poids (difficulté relative) d'une rareté
    // Plus la valeur est élevée, plus la rareté est difficile à obtenir
    // Rareté 1 (commune) : poids 1 → poids de sélection = 1/1 = 1 (très courant)
    // Rareté 2 : poids 2 → poids de sélection = 1/2 = 0.5
    // Rareté 3 : poids 4 → poids de sélection = 1/4 = 0.25
    // Rareté 4 : poids 8 → poids de sélection = 1/8 = 0.125
    // Rareté 5 : poids 16 → poids de sélection = 1/16 = 0.0625 (très rare)
    let result = 1;
    switch(rarity) {
      case 1:
        result = 1;
        break;
      case 2:
        result = 2;
        break;
      case 3:
        result = 4;
        break;
      case 4:
        result = 8;
        break;
      case 5:
        result = 16;
        break;
    }
    return result;
  }
  click() {
    if (!this.currentEgg) {
      // Pas d'oeuf, pas de gains
      return { progress: 0, isHatched: false };
    }
    
    // Appliquer le multiplicateur de clics
    const stats = inventoryManager ? inventoryManager.getStats() : { clickPower: 1 };
    const clickPower = stats.clickPower || 1;
    
    this.currentEgg.currentClicks += clickPower;
    
    // Gagner 1 Pokedollar à chaque click (additif avec le ClickPower)
    if (currencyManager) {
      currencyManager.addPokedollars(Math.round(clickPower));
    }
    
    return {
      progress: this.currentEgg.currentClicks / this.currentEgg.clicksNeeded,
      isHatched: this.currentEgg.currentClicks >= this.currentEgg.clicksNeeded
    };
  }

  hatchEgg() {
    if (this.currentEgg && this.currentEgg.currentClicks >= this.currentEgg.clicksNeeded) {
      const pokemon = this.currentEgg.pokemon;
      
      // Enregistrer le Pokémon capturé
      if (!this.caughtPokemon[pokemon.index]) {
        this.caughtPokemon[pokemon.index] = {
          pokemon: pokemon,
          count: 1,
          firstCaught: new Date().toISOString()
        };
      } else {
        this.caughtPokemon[pokemon.index].count++;
      }
      
      // Sauvegarder
      this.saveCaughtData();
      
      return pokemon;
    }
    return null;
  }

  getCrackOverlayPath(progress) {
    // progress: 0-1
    // 01.png: 20%, 02.png: 40%, 03.png: 60%, 04.png: 80%, 05.png: 90%
    if (progress >= 0.9) return './medias/overlay_egg_cracks/05.png';
    if (progress >= 0.8) return './medias/overlay_egg_cracks/04.png';
    if (progress >= 0.6) return './medias/overlay_egg_cracks/03.png';
    if (progress >= 0.4) return './medias/overlay_egg_cracks/02.png';
    if (progress >= 0.2) return './medias/overlay_egg_cracks/01.png';
    return null;
  }

  getRarityUnderlayPath(rarity) {
    return `./medias/underlay_rarity/${rarity}.png`;
  }

  getFamilyEggCount(familyName) {
    let count = 0;
    for (const index in this.caughtPokemon) {
      const pokeData = this.caughtPokemon[index];
      if (this.getPokemonFamily(pokeData.pokemon)?.name === familyName) {
        count += pokeData.count;
      }
    }
    return count;
  }

  getPokemonFamily(pokemon) {
    return this.families.find(family =>
      family.members.some(member => member.index === pokemon.index)
    );
  }

  async saveCaughtData() {
    const data = {
      caughtPokemon: this.caughtPokemon,
      lastSaved: new Date().toISOString()
    };
    await dataLoader.saveData(data);
  }

  getCaughtPokedex() {
    return Object.values(this.caughtPokemon);
  }

  getTotalPokedex() {
    return this.families.flatMap(family => family.members);
  }

  isCaught(pokemonIndex) {
    return pokemonIndex in this.caughtPokemon;
  }

  getCaughtInfo(pokemonIndex) {
    return this.caughtPokemon[pokemonIndex] || null;
  }
}

const gameManager = new GameManager();
