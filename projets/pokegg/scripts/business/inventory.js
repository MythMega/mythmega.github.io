// Gestion de l'inventaire des items et des statistiques de jeu
class InventoryManager {
  constructor() {
    this.items = {}; // { itemName: { quantity: number, level: number (pour upgrades) } }
    this.stats = {
      autoclickValuePerSecond: 0,
      clickPower: 1
    };
    this.itemsData = []; // Cache de items.json
    this.db = null;
  }

  async initialize() {
    try {
      const response = await fetch('./items.json');
      this.itemsData = await response.json();
      
      // Initialiser la base de données
      await this.initializeDB();
      
      // Charger l'inventaire depuis IndexedDB
      await this.loadInventory();
    } catch (error) {
      console.error('Error initializing inventory:', error);
    }
  }

  // Initialiser IndexedDB
  async initializeDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('PokeggDB', 2); // Augmenter la version pour forcer l'upgrade
      
      request.onerror = () => {
        console.error('Database failed to open');
        reject(request.error);
      };
      
      request.onsuccess = (e) => {
        this.db = e.target.result;
        
        // Vérifier si le store existe, sinon le créer
        if (!this.db.objectStoreNames.contains('inventory')) {
          try {
            // Fermer la connexion actuelle et réouvrir avec une version supérieure
            this.db.close();
            const upgradeRequest = indexedDB.open('PokeggDB', 3);
            
            upgradeRequest.onupgradeneeded = (upgradeEvent) => {
              const db = upgradeEvent.target.result;
              if (!db.objectStoreNames.contains('inventory')) {
                db.createObjectStore('inventory', { keyPath: 'key' });
              }
            };
            
            upgradeRequest.onsuccess = (e) => {
              this.db = e.target.result;
              resolve();
            };
            
            upgradeRequest.onerror = () => {
              reject(upgradeRequest.error);
            };
          } catch (error) {
            console.error('Error upgrading database:', error);
            resolve(); // Continuer quand même
          }
        } else {
          resolve();
        }
      };
      
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('inventory')) {
          db.createObjectStore('inventory', { keyPath: 'key' });
        }
      };
    });
  }

  // Charger l'inventaire depuis IndexedDB
  async loadInventory() {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        console.warn('Database not initialized');
        resolve();
        return;
      }

      try {
        // Vérifier que le store existe
        if (!this.db.objectStoreNames.contains('inventory')) {
          console.warn('Inventory store does not exist, skipping load');
          resolve();
          return;
        }

        const transaction = this.db.transaction('inventory', 'readonly');
        const store = transaction.objectStore('inventory');
        const getRequest = store.get('items');
        
        getRequest.onsuccess = () => {
          if (getRequest.result) {
            this.items = getRequest.result.value;
            this.calculateStats();
            console.log('Inventory loaded successfully:', this.items);
          }
          resolve();
        };
        
        getRequest.onerror = () => {
          console.warn('Error reading from inventory store:', getRequest.error);
          resolve();
        };
      } catch (error) {
        console.warn('Error loading inventory:', error);
        resolve();
      }
    });
  }

  // Sauvegarder l'inventaire dans IndexedDB
  async saveInventory() {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        console.warn('Database not initialized');
        resolve();
        return;
      }

      try {
        // Vérifier que le store existe
        if (!this.db.objectStoreNames.contains('inventory')) {
          console.warn('Inventory store does not exist, cannot save');
          resolve();
          return;
        }

        const transaction = this.db.transaction('inventory', 'readwrite');
        const store = transaction.objectStore('inventory');
        
        store.put({ key: 'items', value: this.items });
        
        transaction.oncomplete = () => {
          console.log('Inventory saved successfully');
          resolve();
        };
        
        transaction.onerror = () => {
          console.error('Error saving inventory:', transaction.error);
          resolve(); // Ne pas rejeter pour éviter les erreurs silencieuses
        };
      } catch (error) {
        console.error('Error saving inventory:', error);
        resolve(); // Ne pas rejeter pour éviter les erreurs silencieuses
      }
    });
  }

  // Ajouter un item à l'inventaire
  addItem(itemName, quantity = 1, level = 1) {
    if (!this.items[itemName]) {
      this.items[itemName] = {
        quantity: 0,
        level: level
      };
    }
    this.items[itemName].quantity += quantity;
    this.saveInventory();
  }

  // Retirer un item de l'inventaire
  removeItem(itemName, quantity = 1) {
    if (this.items[itemName]) {
      this.items[itemName].quantity -= quantity;
      if (this.items[itemName].quantity <= 0) {
        delete this.items[itemName];
      }
      this.saveInventory();
    }
  }

  // Upgrader un item permanent
  upgradeItem(itemName) {
    if (this.items[itemName]) {
      this.items[itemName].level++;
      this.calculateStats();
      this.saveInventory();
    }
  }

  // Obtenir les informations d'un item
  getItem(itemName) {
    return this.items[itemName] || null;
  }

  // Vérifier si on possède un item
  hasItem(itemName) {
    return itemName in this.items && this.items[itemName].quantity > 0;
  }

  // Obtenir la quantité d'un item consommable
  getItemQuantity(itemName) {
    if (this.items[itemName]) {
      return this.items[itemName].quantity;
    }
    return 0;
  }

  // Obtenir le niveau d'un upgrade
  getItemLevel(itemName) {
    if (this.items[itemName]) {
      return this.items[itemName].level;
    }
    return 0;
  }

  // Récalculer les statistiques
  calculateStats() {
    this.stats.autoclickValuePerSecond = 0;
    this.stats.clickPower = 1;

    for (const itemName in this.items) {
      const itemData = this.itemsData.find(item => item.Name === itemName);
      const itemInventory = this.items[itemName];

      if (itemData) {
        if (itemData.Effect === 'AutoClick') {
          const baseValue = itemData.InitialValue;
          const upgradeValue = itemData.AdditionalUpgradeValue;
          const level = itemInventory.level;
          this.stats.autoclickValuePerSecond += baseValue + (upgradeValue * (level - 1));
        } else if (itemData.Effect === 'ClickUpgrade') {
          const baseValue = itemData.InitialValue;
          const upgradeValue = itemData.AdditionalUpgradeValue;
          const level = itemInventory.level;
          this.stats.clickPower += baseValue + (upgradeValue * (level - 1));
        }
      }
    }
  }

  // Obtenir les stats actuelles
  getStats() {
    return this.stats;
  }

  // Réinitialiser la base de données (utile pour le débogage)
  async resetDatabase() {
    return new Promise((resolve, reject) => {
      const deleteRequest = indexedDB.deleteDatabase('PokeggDB');
      
      deleteRequest.onsuccess = () => {
        console.log('Database deleted successfully');
        this.db = null;
        this.items = {};
        this.calculateStats();
        resolve();
      };
      
      deleteRequest.onerror = () => {
        console.error('Error deleting database:', deleteRequest.error);
        reject(deleteRequest.error);
      };
    });
  }

  // Obtenir tous les items possédés
  getAllItems() {
    return this.items;
  }

  // Obtenir les données d'un item depuis items.json
  getItemData(itemName) {
    return this.itemsData.find(item => item.Name === itemName) || null;
  }

  // Obtenir tous les items disponibles
  getAllItemsData() {
    return this.itemsData;
  }
}

const inventoryManager = new InventoryManager();
