// Gestion de l'import des données
class DataImporter {
  static async importFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = async (event) => {
        try {
          const encoded = event.target.result;
          const decoded = decodeURIComponent(escape(atob(encoded)));
          const importedData = JSON.parse(decoded);
          
          // Valider que c'est un export Pokegg
          if (!importedData.exportDate || !importedData.caughtPokemon) {
            throw new Error('Invalid Pokegg save file');
          }
          
          // Importer les données via DataLoader
          await dataLoader.importAllData(importedData);
          
          // Recharger l'inventaire
          if (inventoryManager) {
            await inventoryManager.loadInventory();
            inventoryManager.calculateStats();
          }
          
          // Recharger la langue
          if (window.optionsManager && importedData.language) {
            await window.optionsManager.loadLanguage(importedData.language);
          }
          
          // Recharger la balance
          if (currencyManager && importedData.balance !== undefined) {
            currencyManager.setBalance(importedData.balance);
          }
          
          resolve(true);
        } catch (error) {
          reject(new Error('Invalid save file format: ' + error.message));
        }
      };
      
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }
}
