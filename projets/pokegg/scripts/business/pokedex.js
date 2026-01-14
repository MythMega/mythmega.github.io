// Gestion de la logique métier du Pokédex
class PokedexManager {
  constructor() {
    this.allPokemon = [];
    this.filteredPokemon = [];
  }

  initialize(families) {
    this.allPokemon = families.flatMap(family => 
      family.members.map(member => ({
        pokemon: member,
        family: family
      }))
    );
    this.filteredPokemon = [...this.allPokemon];
  }

  applyFilters(searchQuery, showOnlyCaught, showOnlyUncaught) {
    this.filteredPokemon = this.allPokemon.filter(entry => {
      const { pokemon } = entry;
      const isCaught = gameManager.isCaught(pokemon.index);
      
      // Appliquer le filtre de capture
      if (showOnlyCaught && !isCaught) return false;
      if (showOnlyUncaught && isCaught) return false;
      
      // Appliquer la recherche
      if (searchQuery.trim() !== '') {
        const query = searchQuery.toLowerCase();
        const matchesName = 
          pokemon.name_fr.toLowerCase().includes(query) ||
          pokemon.name_en.toLowerCase().includes(query);
        const matchesIndex = pokemon.index.toString().includes(query);
        
        if (!matchesName && !matchesIndex) return false;
      }
      
      return true;
    });
  }

  getProgress() {
    const caughtCount = this.allPokemon.filter(entry => 
      gameManager.isCaught(entry.pokemon.index)
    ).length;
    const totalCount = this.allPokemon.length;
    const percentage = totalCount > 0 ? Math.round((caughtCount / totalCount) * 100) : 0;
    
    return {
      caught: caughtCount,
      total: totalCount,
      percentage: percentage
    };
  }
}

const pokedexManager = new PokedexManager();
