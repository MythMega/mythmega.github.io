// Outils de diagnostic pour le jeu
class Diagnostics {
  static async checkDatabase() {
    console.log('=== DATABASE DIAGNOSTIC ===');
    
    return new Promise((resolve) => {
      const request = indexedDB.open('PokeggDB');
      
      request.onsuccess = (e) => {
        const db = e.target.result;
        console.log('✓ Database opened successfully');
        console.log('Database version:', db.version);
        console.log('Object stores:', Array.from(db.objectStoreNames));
        
        if (db.objectStoreNames.contains('inventory')) {
          console.log('✓ Inventory store exists');
        } else {
          console.warn('✗ Inventory store DOES NOT exist');
        }
        
        db.close();
        resolve();
      };
      
      request.onerror = () => {
        console.error('✗ Database failed to open');
        resolve();
      };
    });
  }

  static async resetAllData() {
    console.log('=== RESETTING ALL DATA ===');
    
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
