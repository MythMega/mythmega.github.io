// Gestion de l'import des données
class DataImporter {
  static async import(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (event) => {
        try {
          const encoded = event.target.result;
          const decoded = atob(encoded);
          const data = JSON.parse(decoded);
          resolve(data);
        } catch (error) {
          reject(new Error('Invalid save file format'));
        }
      };
      
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }
}
