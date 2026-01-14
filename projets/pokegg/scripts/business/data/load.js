// Gestion du chargement et sauvegarde centralisée des données
class DataLoader {
  constructor() {
    this.dbName = 'PokeggDB';
    this.version = 3; // Incrémenté pour forcer la migration
    this.db = null; // Cache la connexion
  }

  async initDB() {
    // Si la base de données est déjà connectée, la retourner
    if (this.db) {
      console.log('Database already initialized, returning cached connection');
      return this.db;
    }

    console.log('Attempting to initialize database...');

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => {
        console.error('Database open error:', request.error);
        reject(request.error);
      };
      
      request.onsuccess = () => {
        this.db = request.result;
        console.log('✓ Database opened successfully, version:', this.db.version);
        console.log('Available stores:', Array.from(this.db.objectStoreNames));
        resolve(this.db);
      };

      request.onblocked = () => {
        console.warn('Database open blocked - may need to close other tabs');
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        console.log('Database upgrade needed, version:', event.oldVersion, '->', event.newVersion);
        
        // Créer tous les stores nécessaires
        // Store pour l'inventaire (utilisé par InventoryManager)
        if (!db.objectStoreNames.contains('inventory')) {
          db.createObjectStore('inventory', { keyPath: 'key' });
          console.log('✓ Created inventory store');
        }
        
        // Store pour les données de Pokédex (Pokémon attrapés)
        if (!db.objectStoreNames.contains('pokemonCaught')) {
          db.createObjectStore('pokemonCaught');
          console.log('✓ Created pokemonCaught store');
        }
        
        // Store pour les données globales (inventaire global, devises, langue, etc.)
        if (!db.objectStoreNames.contains('gameData')) {
          db.createObjectStore('gameData');
          console.log('✓ Created gameData store');
        }
      };
    });
  }

  // Charger TOUTES les données du jeu
  async loadAllGameData() {
    try {
      const db = await this.initDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(['pokemonCaught', 'gameData'], 'readonly');
        
        const pokemonStore = transaction.objectStore('pokemonCaught');
        const gameStore = transaction.objectStore('gameData');
        
        const pokemonRequest = pokemonStore.get('pokedexData');
        const gameDataRequest = gameStore.get('allData');
        
        let pokemonData = null;
        let gameData = null;
        let completed = 0;
        
        pokemonRequest.onsuccess = () => {
          pokemonData = pokemonRequest.result || { caughtPokemon: {} };
          completed++;
          if (completed === 2) finalize();
        };
        
        gameDataRequest.onsuccess = () => {
          gameData = gameDataRequest.result || {};
          completed++;
          if (completed === 2) finalize();
        };
        
        const finalize = () => {
          resolve({
            caughtPokemon: pokemonData.caughtPokemon || {},
            lastSaved: pokemonData.lastSaved || new Date().toISOString(),
            inventory: gameData.inventory || {},
            balance: gameData.balance || 0,
            language: gameData.language || 'en'
          });
        };
        
        pokemonRequest.onerror = () => reject(pokemonRequest.error);
        gameDataRequest.onerror = () => reject(gameDataRequest.error);
      });
    } catch (error) {
      console.error('Error loading all game data:', error);
      return {
        caughtPokemon: {},
        lastSaved: new Date().toISOString(),
        inventory: {},
        balance: 0,
        language: 'en'
      };
    }
  }

  // Charger juste les données de Pokédex (pour compatibilité)
  async loadData() {
    try {
      const db = await this.initDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(['pokemonCaught'], 'readonly');
        const store = transaction.objectStore('pokemonCaught');
        const request = store.get('pokedexData');

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          resolve(request.result || { caughtPokemon: {} });
        };
      });
    } catch (error) {
      console.error('Error loading data:', error);
      return { caughtPokemon: {} };
    }
  }

  // Sauvegarder les données de Pokédex
  async saveData(data) {
    try {
      const db = await this.initDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(['pokemonCaught'], 'readwrite');
        const store = transaction.objectStore('pokemonCaught');
        const request = store.put(data, 'pokedexData');

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    } catch (error) {
      console.error('Error saving data:', error);
    }
  }

  // Sauvegarder les données du jeu (inventaire, balance, langue)
  async saveGameData(gameData) {
    try {
      const db = await this.initDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(['gameData'], 'readwrite');
        const store = transaction.objectStore('gameData');
        const request = store.put(gameData, 'allData');

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    } catch (error) {
      console.error('Error saving game data:', error);
    }
  }

  // Exporter TOUTES les données dans un objet sérialisable
  async exportAllData() {
    const allData = await this.loadAllGameData();
    return {
      version: '1.0',
      exportDate: new Date().toISOString(),
      ...allData
    };
  }

  // Importer et restaurer toutes les données
  async importAllData(importedData) {
    try {
      // Valider les données importées
      if (!importedData || typeof importedData !== 'object') {
        throw new Error('Invalid data format');
      }

      const db = await this.initDB();
      
      // Sauvegarder les données de Pokédex
      await this.saveData({
        caughtPokemon: importedData.caughtPokemon || {},
        lastSaved: importedData.lastSaved || new Date().toISOString()
      });

      // Sauvegarder les données du jeu
      if (importedData.inventory || importedData.balance !== undefined || importedData.language) {
        await this.saveGameData({
          inventory: importedData.inventory || {},
          balance: importedData.balance || 0,
          language: importedData.language || 'en'
        });
      }

      return true;
    } catch (error) {
      console.error('Error importing data:', error);
      throw error;
    }
  }
}

const dataLoader = new DataLoader();
