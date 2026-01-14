// Interface utilisateur de la boutique
class ShopUI {
  constructor() {
    this.itemsGrid = document.getElementById('itemsGrid');
    this.balanceDisplay = document.getElementById('balanceDisplay');
    this.backButton = document.getElementById('backButton');
  }

  async initialize() {
    try {
      await shopManager.initialize();
      await inventoryManager.initialize();
      
      this.updateBalance();
      this.displayItems();
      
      this.backButton.addEventListener('click', () => {
        window.location.href = './index.html';
      });
      
      // S'abonner aux changements de Pokedollars
      currencyManager.subscribe(() => {
        this.updateBalance();
      });
    } catch (error) {
      console.error('Error initializing shop:', error);
    }
  }

  updateBalance() {
    this.balanceDisplay.textContent = currencyManager.getBalance();
  }

  displayItems() {
    const items = shopManager.getAvailableItems();
    this.itemsGrid.innerHTML = '';

    items.forEach(itemData => {
      const itemElement = this.createItemElement(itemData);
      this.itemsGrid.appendChild(itemElement);
    });
  }

  createItemElement(itemData) {
    const div = document.createElement('div');
    div.className = 'shop-item';

    const itemName = itemData.Name;
    const isUpgrade = !itemData.Consummable;
    const currentLevel = inventoryManager.getItemLevel(itemName);
    const canUpgrade = shopManager.canUpgrade(itemName);

    let price = 0;
    if (isUpgrade) {
      price = shopManager.getUpgradePrice(itemName);
    } else {
      price = shopManager.getConsumablePrice(itemName);
    }

    const hasEnoughMoney = currencyManager.getBalance() >= price;

    let levelDisplay = '';
    if (isUpgrade) {
      levelDisplay = `<p class="item-level">Level: ${currentLevel}/${itemData.MaxLevel}</p>`;
    } else {
      const quantity = inventoryManager.getItemQuantity(itemName);
      levelDisplay = `<p class="item-quantity">Owned: ${quantity}</p>`;
    }

    div.innerHTML = `
      <img src="${itemData.Sprite}" alt="${itemName}" class="item-sprite">
      <h3>${itemName}</h3>
      ${levelDisplay}
      <p class="item-price">${price} Pokédollars</p>
      <button class="buy-button" 
              onclick="shopUI.buyItem('${itemName}')"
              ${!hasEnoughMoney || (isUpgrade && !canUpgrade) ? 'disabled' : ''}>
        ${isUpgrade && !canUpgrade ? 'Max Level' : (isUpgrade && currentLevel > 0 ? 'Upgrade' : 'Buy')}
      </button>
    `;

    return div;
  }

  async buyItem(itemName) {
    const result = await shopManager.buyItem(itemName);

    if (result.success) {
      // Afficher un message de succès
      alert(`Successfully purchased ${itemName}!`);
      this.displayItems();
    } else {
      alert(`Purchase failed: ${result.message}`);
    }
  }
}

const shopUI = new ShopUI();
document.addEventListener('DOMContentLoaded', () => shopUI.initialize());
