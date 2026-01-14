// Outils de diagnostic pour le jeu
class Diagnostics {
  static async checkDatabase() {
    console.log('=== DATABASE DIAGNOSTIC ===');
    
    try {
      // Utiliser DataLoader pour s'assurer que tous les stores sont créés
      const db = await dataLoader.initDB();
      console.log('✓ Database opened successfully');
      console.log('Database version:', db.version);
      console.log('Object stores:', Array.from(db.objectStoreNames));
      
      // Vérifier les stores
      const requiredStores = ['inventory', 'pokemonCaught', 'gameData'];
      for (const store of requiredStores) {
        if (db.objectStoreNames.contains(store)) {
          console.log(`✓ ${store} store exists`);
        } else {
          console.warn(`✗ ${store} store DOES NOT exist`);
        }
      }
    } catch (error) {
      console.error('✗ Database diagnostic failed:', error);
    }
  }

  static async cleanOldDatabases() {
    console.log('=== CLEANING OLD DATABASES ===');
    
    // Supprimer les anciennes bases de données
    const oldDbNames = ['pokeggDB']; // minuscule
    
    for (const oldName of oldDbNames) {
      try {
        await new Promise((resolve) => {
          const deleteRequest = indexedDB.deleteDatabase(oldName);
          deleteRequest.onsuccess = () => {
            console.log(`✓ Deleted old database: ${oldName}`);
            resolve();
          };
          deleteRequest.onerror = () => {
            console.log(`No old database found: ${oldName}`);
            resolve();
          };
          deleteRequest.onblocked = () => {
            console.warn(`Database deletion blocked for ${oldName}`);
            resolve();
          };
        });
      } catch (error) {
        console.warn(`Error deleting old database ${oldName}:`, error);
      }
    }
  }

  static async resetAllData() {
    console.log('=== RESETTING ALL DATA ===');
    
    // Fermer la base de données si elle est ouverte
    if (dataLoader && dataLoader.db) {
      dataLoader.db.close();
      dataLoader.db = null;
      console.log('✓ Database connection closed');
    }
    
    // Supprimer la base de données
    return new Promise((resolve) => {
      const deleteRequest = indexedDB.deleteDatabase('PokeggDB');
      
      deleteRequest.onsuccess = () => {
        console.log('✓ Database deleted successfully');
        
        // Supprimer les cookies
        document.cookie.split(';').forEach((c) => {
          const eqPos = c.indexOf('=');
          const name = eqPos > -1 ? c.substr(0, eqPos).trim() : c.trim();
          document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
        });
        console.log('✓ Cookies cleared');
        
        // Vider le localStorage
        localStorage.clear();
        console.log('✓ Local storage cleared');
        
        console.log('✓ All data reset complete. Please refresh the page.');
        resolve();
      };
      
      deleteRequest.onerror = () => {
        console.error('✗ Error deleting database');
        resolve();
      };
    });
  }
}

// Rendre disponible globalement
window.Diagnostics = Diagnostics;
