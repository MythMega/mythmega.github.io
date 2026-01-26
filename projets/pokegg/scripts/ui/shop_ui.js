// Interface utilisateur de la boutique
class ShopUI {
  constructor() {
    this.itemsGrid = document.getElementById('itemsGrid');
    this.balanceDisplay = document.getElementById('balanceDisplay');
    this.backButton = document.getElementById('backButton');
  }

  async initialize() {
    try {
      const language = new OptionsManager().getLanguage();
      const optionsManagerInstance = new OptionsManager();
      await optionsManagerInstance.loadLanguage(language);
      window.optionsManager = optionsManagerInstance;

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
    console.log('🔍 displayItems called');
    console.log('Items from shopManager:', items);
    console.log('Number of items:', items ? items.length : 0);
    
    this.itemsGrid.innerHTML = '';

    if (!items || items.length === 0) {
      console.warn('❌ No items found!');
      this.itemsGrid.innerHTML = '<p>No items available</p>';
      return;
    }

    items.forEach((itemData, index) => {
      console.log(`Creating item ${index}: ${itemData.Name}`);
      const itemElement = this.createItemElement(itemData);
      this.itemsGrid.appendChild(itemElement);
    });
    
    console.log('✓ All items added to DOM');
  }

  createItemElement(itemData) {
    const div = document.createElement('div');
    div.className = 'shop-item';

    const itemName = itemData.Name;
    const isUpgrade = !itemData.Consummable;
    const currentLevel = inventoryManager.getItemLevel(itemName);
    const canUpgrade = shopManager.canUpgrade(itemName);
    
    // Récupérer la description en fonction de la langue actuelle
    const currentLanguage = (window.optionsManager?.currentLanguage) || 'en';
    
    // Chercher la description avec fallback
    let description = '';
    if (currentLanguage === 'fr') {
      description = itemData.Description_FR || itemData.Description_EN || 'Pas de description';
    } else {
      description = itemData.Description_EN || itemData.Description_FR || 'No description available';
    }

    console.log(`✓ Shop Item: ${itemName} | Lang: ${currentLanguage} | Desc: "${description}"`);

    let price = 0;
    let priceDisplay = '';
    if (isUpgrade) {
      // Ne calculer le prix que si on peut encore upgrader
      if (canUpgrade) {
        price = shopManager.getUpgradePrice(itemName);
        priceDisplay = `<p class="item-price">${price} Pokédollars</p>`;
      }
    } else {
      price = shopManager.getConsumablePrice(itemName);
      priceDisplay = `<p class="item-price">${price} Pokédollars</p>`;
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
      <p class="item-description">${description}</p>
      ${levelDisplay}
      ${priceDisplay}
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
