// Gestion de la boutique et des achats
class ShopManager {
  constructor() {
    this.itemsData = [];
  }

  async initialize() {
    try {
      const response = await fetch('./items.json');
      this.itemsData = await response.json();
    } catch (error) {
      console.error('Error loading items data:', error);
    }
  }

  // Obtenir le prix actuel d'un upgrade
  getUpgradePrice(itemName) {
    const itemData = this.getItemData(itemName);
    if (!itemData) return 0;

    const currentLevel = inventoryManager.getItemLevel(itemName);
    const basePrice = itemData.Price;
    const multiplier = itemData.UpgradePriceMultiplier;

    // Prix = Price * (Multiplier ^ (niveau actuel))
    return Math.floor(basePrice * Math.pow(multiplier, currentLevel));
  }

  // Obtenir le prix de base d'un consommable
  getConsumablePrice(itemName) {
    const itemData = this.getItemData(itemName);
    if (!itemData) return 0;
    return itemData.Price;
  }

  // Essayer d'acheter un item
  async buyItem(itemName) {
    const itemData = this.getItemData(itemName);
    if (!itemData) {
      return { success: false, message: 'Item not found' };
    }

    let price = 0;
    if (itemData.Consummable) {
      // Consommable
      price = this.getConsumablePrice(itemName);
    } else {
      // Upgrade permanent
      price = this.getUpgradePrice(itemName);
    }

    // Vérifier si on a assez d'argent
    if (currencyManager.getBalance() < price) {
      return { success: false, message: 'Not enough money' };
    }

    // Retirer l'argent
    currencyManager.removePokedollars(price);

    // Ajouter l'item
    if (itemData.Consummable) {
      inventoryManager.addItem(itemName, 1, 0);
    } else {
      const currentLevel = inventoryManager.getItemLevel(itemName);
      if (currentLevel === 0) {
        inventoryManager.addItem(itemName, 0, 1);
      } else {
        inventoryManager.upgradeItem(itemName);
      }
    }

    // Sauvegarder l'inventaire
    await inventoryManager.saveInventory();

    return { success: true, message: 'Item purchased successfully' };
  }

  // Vérifier si un upgrade peut être upgrader davantage
  canUpgrade(itemName) {
    const itemData = this.getItemData(itemName);
    if (!itemData || itemData.Consummable) return false;

    const currentLevel = inventoryManager.getItemLevel(itemName);
    const maxLevel = itemData.MaxLevel;

    return currentLevel < maxLevel;
  }

  // Obtenir les données d'un item
  getItemData(itemName) {
    return this.itemsData.find(item => item.Name === itemName) || null;
  }

  // Obtenir tous les items disponibles
  getAllItems() {
    return this.itemsData;
  }

  // Obtenir les items achetables (Available = true)
  getAvailableItems() {
    return this.itemsData.filter(item => item.Available === true);
  }
}

const shopManager = new ShopManager();
