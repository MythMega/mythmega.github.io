// Gestion de la suppression des données
class DataDeleter {
  static async deleteAllData() {
    try {
      const db = await dataLoader.initDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(['pokemonCaught', 'gameData'], 'readwrite');
        
        const pokemonStore = transaction.objectStore('pokemonCaught');
        const gameStore = transaction.objectStore('gameData');
        
        const pokemonRequest = pokemonStore.clear();
        const gameRequest = gameStore.clear();

        let completed = 0;
        const checkComplete = () => {
          completed++;
          if (completed === 2) resolve();
        };

        pokemonRequest.onerror = () => reject(pokemonRequest.error);
        pokemonRequest.onsuccess = () => checkComplete();
        
        gameRequest.onerror = () => reject(gameRequest.error);
        gameRequest.onsuccess = () => checkComplete();
      });
    } catch (error) {
      console.error('Error deleting data:', error);
      throw error;
    }
  }
}
