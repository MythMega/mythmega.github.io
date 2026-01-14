// Gestion de l'export des données
class DataExporter {
  static async exportGame() {
    try {
      // Récupérer toutes les données
      const exportData = await dataLoader.exportAllData();
      const jsonString = JSON.stringify(exportData, null, 2);
      const encoded = btoa(jsonString);
      
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const seconds = String(now.getSeconds()).padStart(2, '0');
      
      const timestamp = `${year}${month}${day}_${hours}${minutes}${seconds}`;
      const filename = `Pokegg-save-${timestamp}.txt`;
      
      const element = document.createElement('a');
      element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(encoded));
      element.setAttribute('download', filename);
      element.style.display = 'none';
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
      
      return true;
    } catch (error) {
      console.error('Error exporting game data:', error);
      alert('Erreur lors de l\'export : ' + error.message);
      return false;
    }
  }
}
