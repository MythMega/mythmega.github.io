// Interface utilisateur de l'inventaire
class InventoryUI {
  constructor() {
    this.inventoryItems = document.getElementById('inventoryItems');
    this.backButton = document.getElementById('backButton');
    this.autoclickDisplay = document.getElementById('autoclickDisplay');
    this.clickPowerDisplay = document.getElementById('clickPowerDisplay');
    this.eggConfirmationModal = document.getElementById('eggConfirmationModal');
    this.confirmUseButton = document.getElementById('confirmUseButton');
    this.cancelUseButton = document.getElementById('cancelUseButton');
    
    this.pendingEggToUse = null;
  }

  async initialize() {
    try {
      const language = new OptionsManager().getLanguage();
      const optionsManagerInstance = new OptionsManager();
      await optionsManagerInstance.loadLanguage(language);
      window.optionsManager = optionsManagerInstance;

      await inventoryManager.initialize();
      await shopManager.initialize();
      await gameManager.initializeGame();

      this.setupEventListeners();
      this.displayInventory();
      this.updateStats();
    } catch (error) {
      console.error('Error initializing inventory:', error);
    }
  }

  setupEventListeners() {
    this.backButton.addEventListener('click', () => {
      window.location.href = './index.html';
    });

    this.confirmUseButton.addEventListener('click', () => this.confirmUseEgg());
    this.cancelUseButton.addEventListener('click', () => this.closeConfirmation());
  }

  displayInventory() {
    const items = inventoryManager.getAllItems();
    console.log('🔍 displayInventory called');
    console.log('Items from inventoryManager:', items);
    console.log('Number of items:', Object.keys(items).length);
    
    this.inventoryItems.innerHTML = '';

    if (Object.keys(items).length === 0) {
      console.warn('❌ Inventory is empty!');
      this.inventoryItems.innerHTML = '<p class="empty-inventory">Your inventory is empty</p>';
      return;
    }

    for (const itemName in items) {
      const itemData = shopManager.getItemData(itemName);
      console.log(`Creating inventory item: ${itemName}`, itemData);
      
      if (itemData) {
        const itemElement = this.createItemElement(itemData, items[itemName]);
        this.inventoryItems.appendChild(itemElement);
      } else {
        console.warn(`❌ No item data found for: ${itemName}`);
      }
    }
    
    console.log('✓ All inventory items added to DOM');
  }

  createItemElement(itemData, inventoryItem) {
    const div = document.createElement('div');
    div.className = 'inventory-item';

    const isConsumable = itemData.Consummable;
    const itemName = itemData.Name;
    
    // Récupérer la description en fonction de la langue actuelle
    const currentLanguage = (window.optionsManager?.currentLanguage) || 'en';
    
    // Chercher la description avec fallback
    let description = '';
    if (currentLanguage === 'fr') {
      description = itemData.Description_FR || itemData.Description_EN || 'Pas de description';
    } else {
      description = itemData.Description_EN || itemData.Description_FR || 'No description available';
    }

    console.log(`✓ Inventory Item: ${itemName} | Lang: ${currentLanguage} | Desc: "${description}"`);

    let contentHTML = `
      <img src="${itemData.Sprite}" alt="${itemName}" class="item-sprite">
      <div class="item-info">
        <h4>${itemName}</h4>
        <p class="item-description">${description}</p>
    `;

    if (isConsumable) {
      contentHTML += `<p class="item-quantity">Quantity: ${inventoryItem.quantity}</p>`;
      contentHTML += `
        <button class="use-button" onclick="inventoryUI.useConsumable('${itemName}')">
          Use
        </button>
      `;
    } else {
      contentHTML += `<p class="item-level">Level: ${inventoryItem.level}</p>`;
    }

    contentHTML += '</div>';
    div.innerHTML = contentHTML;

    return div;
  }

  useConsumable(itemName) {
    const itemData = shopManager.getItemData(itemName);
    if (!itemData) return;

    if (itemData.Effect === 'Egg') {
      // Afficher la confirmation pour utiliser un œuf
      this.pendingEggToUse = itemName;
      const rarityValue = itemData.InitialValue;
      document.getElementById('eggConfirmationText').textContent = 
        `Are you sure you want to use this egg? It will replace your current egg with a new ${itemData.Name} of rarity ${rarityValue}.`;
      this.eggConfirmationModal.style.display = 'block';
    }
  }

  confirmUseEgg() {
    if (!this.pendingEggToUse) return;

    const itemData = shopManager.getItemData(this.pendingEggToUse);
    const rarityValue = itemData.InitialValue;

    // Retirer l'œuf de l'inventaire
    inventoryManager.removeItem(this.pendingEggToUse, 1);

    // Générer un nouvel œuf de la rareté appropriée
    const familiesWithRarity = gameManager.families.filter(
      family => family.rarity === rarityValue
    );

    if (familiesWithRarity.length > 0) {
      const selectedFamily = familiesWithRarity[
        Math.floor(Math.random() * familiesWithRarity.length)
      ];

      // Déterminer le stage
      let stage = 1;
      const familyEggCount = gameManager.getFamilyEggCount(selectedFamily.name);

      if (familyEggCount >= 5 && Math.random() > 0.5) stage = 2;
      if (familyEggCount >= 25 && Math.random() > 0.5) stage = 3;
      if (familyEggCount >= 125 && Math.random() > 0.5) stage = 4;
      if (Math.random() > 0.8) stage = 1;

      const pokemon = selectedFamily.getRandomMember(stage);
      const clicksNeeded = selectedFamily.getClicksNeeded(stage);

      gameManager.currentEgg = {
        family: selectedFamily,
        pokemon: pokemon,
        clicksNeeded: clicksNeeded,
        currentClicks: 0
      };

      alert('Egg used! You now have a new egg of that rarity.');
    }

    this.closeConfirmation();
    this.displayInventory();
  }

  closeConfirmation() {
    this.eggConfirmationModal.style.display = 'none';
    this.pendingEggToUse = null;
  }

  updateStats() {
    const stats = inventoryManager.getStats();
    this.autoclickDisplay.textContent = stats.autoclickValuePerSecond.toFixed(1);
    this.clickPowerDisplay.textContent = stats.clickPower.toFixed(1);
  }
}

const inventoryUI = new InventoryUI();
document.addEventListener('DOMContentLoaded', () => inventoryUI.initialize());
