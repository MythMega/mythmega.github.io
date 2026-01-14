// Gestion du chargement des données
class DataLoader {
  constructor() {
    this.dbName = 'pokeggDB';
    this.storeName = 'pokemonCaught';
    this.version = 1;
  }

  async initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
    });
  }

  async loadData() {
    try {
      const db = await this.initDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.get('pokedexData');

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          resolve(request.result || {});
        };
      });
    } catch (error) {
      console.error('Error loading data:', error);
      return {};
    }
  }

  async saveData(data) {
    try {
      const db = await this.initDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.put(data, 'pokedexData');

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    } catch (error) {
      console.error('Error saving data:', error);
    }
  }
}

const dataLoader = new DataLoader();
