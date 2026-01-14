// Gestion de la suppression des données
class DataDeleter {
  static async delete() {
    try {
      const db = await dataLoader.initDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([dataLoader.storeName], 'readwrite');
        const store = transaction.objectStore(dataLoader.storeName);
        const request = store.clear();

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    } catch (error) {
      console.error('Error deleting data:', error);
      throw error;
    }
  }
}
