// Interface utilisateur du jeu
class GameUI {
  constructor() {
    this.eggButton = document.getElementById('eggButton');
    this.nextEggButton = document.getElementById('nextEggButton');
    this.eggImage = document.getElementById('eggImage');
    this.eggUnderlay = document.getElementById('eggUnderlay');
    this.eggOverlay = document.getElementById('eggOverlay');
    this.clicksCount = document.getElementById('clicksCount');
    this.clicksNeeded = document.getElementById('clicksNeeded');
    this.progressFill = document.getElementById('progressFill');
    this.hatchedPokemon = document.getElementById('hatchedPokemon');
    this.hatchedSprite = document.getElementById('hatchedSprite');
    this.hatchedName = document.getElementById('hatchedName');
    this.gameInfo = document.getElementById('gameInfo');
    this.pokedollarsDisplay = document.getElementById('pokedollarsDisplay');
    this.autoclickDisplay = document.getElementById('autoclickDisplay');
    this.clickPowerDisplay = document.getElementById('clickPowerDisplay');
    this.inventoryButton = document.getElementById('inventoryButton');
    this.shopButton = document.getElementById('shopButton');
    
    // Modals
    this.inventoryModal = document.getElementById('inventoryModal');
    this.shopModal = document.getElementById('shopModal');
    this.modalInventoryItems = document.getElementById('modalInventoryItems');
    this.modalItemsGrid = document.getElementById('modalItemsGrid');
    this.modalAutoclickDisplay = document.getElementById('modalAutoclickDisplay');
    this.modalClickPowerDisplay = document.getElementById('modalClickPowerDisplay');
    this.modalBalanceDisplay = document.getElementById('modalBalanceDisplay');
    
    // Confirmations
    this.eggConfirmationModal = document.getElementById('eggConfirmationModal');
    this.confirmUseButton = document.getElementById('confirmUseButton');
    this.cancelUseButton = document.getElementById('cancelUseButton');
    
    this.pendingEggToUse = null;
    
    this.setupEventListeners();
  }

  setupEventListeners() {
    this.eggButton.addEventListener('click', () => this.handleEggClick());
    this.nextEggButton.addEventListener('click', () => this.handleNextEgg());
    this.inventoryButton.addEventListener('click', () => this.openInventoryModal());
    this.shopButton.addEventListener('click', () => this.openShopModal());
    
    // Confirmation modals
    this.confirmUseButton.addEventListener('click', () => this.confirmUseEgg());
    this.cancelUseButton.addEventListener('click', () => this.closeEggConfirmation());
    
    // S'abonner aux changements de Pokedollars
    currencyManager.subscribe((amount) => {
      this.updatePokedollarsDisplay();
      this.updateModalBalance();
    });
  }

  async initialize() {
    try {
      // Diagnostic au démarrage
      console.log('Starting game initialization...');
      await Diagnostics.checkDatabase();
      
      await this.loadTranslations();
      await shopManager.initialize(); // IMPORTANT: Initialize shop items from items.json
      await gameManager.initializeGame();
      await this.loadGameData();
      
      // Attendre un peu que tout soit prêt
      await new Promise(resolve => setTimeout(resolve, 100));
      
      this.updatePokedollarsDisplay();
      this.updateStats();
      this.displayNewEgg();
      
      // Mettre à jour les stats toutes les 500ms
      setInterval(() => this.updateStats(), 500);
      
      // Mettre à jour la barre de progression ET les clics en temps réel
      // Cela permettra de voir les clics automatiques se faire en temps réel
      setInterval(() => this.updateClicksDisplay(), 100);
      setInterval(() => this.updateProgressBar(), 100);
    } catch (error) {
      console.error('Error initializing game UI:', error);
      
      // Si erreur de base de données, proposer une réinitialisation
      if (error.message && error.message.includes('inventory')) {
        console.warn('Database error detected. You can run Diagnostics.resetAllData() to reset.');
      }
    }
  }

  async loadTranslations() {
    const language = optionsManager.getLanguage();
    await optionsManager.loadLanguage(language);
    this.updateTranslations();
  }

  updateTranslations() {
    this.eggButton.textContent = optionsManager.translate('hatch_egg');
    this.nextEggButton.textContent = optionsManager.translate('open_another');
  }

  async loadGameData() {
    const data = await dataLoader.loadData();
    if (data.caughtPokemon) {
      gameManager.caughtPokemon = data.caughtPokemon;
    }
  }

  displayNewEgg() {
    if (!gameManager.families || gameManager.families.length === 0) {
      console.warn('Game not fully initialized');
      return;
    }

    const egg = gameManager.selectRandomEgg();
    if (!egg) {
      console.error('Failed to select an egg');
      return;
    }
    
    // Afficher l'oeuf sélectionné
    this.displayCurrentEgg();
  }

  // Affiche l'oeuf actuellement dans gameManager.currentEgg SANS en sélectionner un nouveau
  displayCurrentEgg() {
    if (!gameManager.currentEgg) {
      console.warn('No current egg to display');
      return;
    }
    
    // Masquer le Pokémon éclos
    this.hatchedPokemon.style.display = 'none';
    this.nextEggButton.style.display = 'none';
    this.eggButton.style.display = 'block';
    
    // Réinitialiser les clics
    gameManager.currentEgg.currentClicks = 0;
    this.updateClicksDisplay();
    this.updateProgressBar();
    
    // Afficher l'œuf
    this.eggImage.src = gameManager.currentEgg.family.eggImage;
    this.eggUnderlay.src = gameManager.getRarityUnderlayPath(gameManager.currentEgg.family.rarity);
    this.eggOverlay.classList.remove('show');
    this.eggOverlay.style.display = 'none';
  }

  handleEggClick() {
    if (!gameManager.currentEgg) {
      console.warn('No egg selected');
      return;
    }
    
    const result = gameManager.click();
    this.updateClicksDisplay();
    this.updateProgressBar(result.progress);
    
    // Mettre à jour l'overlay des fissures
    this.updateEggCracks(result.progress);
    
    if (result.isHatched) {
      this.displayHatchedPokemon();
    }
  }

  updateEggCracks(progress) {
    const crackPath = gameManager.getCrackOverlayPath(progress);
    
    if (crackPath) {
      this.eggOverlay.src = crackPath;
      this.eggOverlay.classList.add('show');
      this.eggOverlay.style.display = 'block';
    } else {
      this.eggOverlay.classList.remove('show');
      this.eggOverlay.style.display = 'none';
    }
  }

  updateClicksDisplay() {
    if (gameManager.currentEgg) {
      // Limiter l'affichage des clics à ne pas dépasser le nombre nécessaire
      const displayedClicks = Math.min(gameManager.currentEgg.currentClicks, gameManager.currentEgg.clicksNeeded);
      this.clicksCount.textContent = Math.floor(displayedClicks);
      this.clicksNeeded.textContent = gameManager.currentEgg.clicksNeeded;
    }
  }

  updateProgressBar(progress = 0) {
    const percentage = (progress || (gameManager.currentEgg.currentClicks / gameManager.currentEgg.clicksNeeded)) * 100;
    // Limiter à 100% maximum
    const finalPercentage = Math.min(percentage, 100);
    this.progressFill.style.width = finalPercentage + '%';
  }

  displayHatchedPokemon() {
    const pokemon = gameManager.hatchEgg();
    
    if (pokemon) {
      // Masquer le bouton de clic
      this.eggButton.style.display = 'none';
      
      // Afficher le Pokémon éclos
      this.hatchedSprite.src = pokemon.sprite;
      this.hatchedName.textContent = pokemon.getName(optionsManager.currentLanguage);
      this.hatchedPokemon.style.display = 'block';
      
      // Afficher le bouton pour ouvrir un autre œuf
      this.nextEggButton.style.display = 'block';
    }
  }

  handleNextEgg() {
    this.displayNewEgg();
  }

  updatePokedollarsDisplay() {
    this.pokedollarsDisplay.textContent = currencyManager.getBalance();
  }

  updateStats() {
    const stats = inventoryManager.getStats();
    this.autoclickDisplay.textContent = stats.autoclickValuePerSecond.toFixed(1);
    this.clickPowerDisplay.textContent = stats.clickPower.toFixed(1);
    
    // Mettre à jour les modals aussi
    this.updateModalStats();
  }

  updateModalStats() {
    const stats = inventoryManager.getStats();
    this.modalAutoclickDisplay.textContent = stats.autoclickValuePerSecond.toFixed(1);
    this.modalClickPowerDisplay.textContent = stats.clickPower.toFixed(1);
  }

  updateModalBalance() {
    this.modalBalanceDisplay.textContent = currencyManager.getBalance();
  }

  // ========== MODAL INVENTORY ==========

  async openInventoryModal() {
    this.inventoryModal.style.display = 'block';
    await this.displayInventoryModal();
  }

  closeInventoryModal() {
    this.inventoryModal.style.display = 'none';
  }

  async displayInventoryModal() {
    const items = inventoryManager.getAllItems();
    this.modalInventoryItems.innerHTML = '';

    if (Object.keys(items).length === 0) {
      this.modalInventoryItems.innerHTML = '<p class="empty-inventory">Your inventory is empty</p>';
      return;
    }

    for (const itemName in items) {
      const itemData = shopManager.getItemData(itemName);
      if (itemData) {
        const itemElement = this.createModalInventoryItem(itemData, items[itemName]);
        this.modalInventoryItems.appendChild(itemElement);
      }
    }

    this.updateModalStats();
  }

  createModalInventoryItem(itemData, inventoryItem) {
    const div = document.createElement('div');
    div.className = 'inventory-item';

    const isConsumable = itemData.Consummable;
    const itemName = itemData.Name;

    let contentHTML = `
      <img src="${itemData.Sprite}" alt="${itemName}" class="item-sprite">
      <div class="item-info">
        <h4>${itemName}</h4>
    `;

    if (isConsumable) {
      contentHTML += `<p class="item-quantity">Quantity: ${inventoryItem.quantity}</p>`;
      contentHTML += `
        <button class="use-button" onclick="gameUI.useConsumableFromModal('${itemName}')">
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

  useConsumableFromModal(itemName) {
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
    if (!itemData) return;
    
    const rarityValue = itemData.InitialValue;

    // Retirer l'œuf de l'inventaire ET sauvegarder
    inventoryManager.removeItem(this.pendingEggToUse, 1);
    inventoryManager.saveInventory();

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

      // Mettre à jour l'affichage du jeu EN AFFICHANT L'OEUF COURANT (pas en générant un nouveau)
      this.displayCurrentEgg();
      alert(`Egg used! You now have a new ${selectedFamily.name} egg of rarity ${rarityValue}.`);
      this.closeEggConfirmation();
      this.displayInventoryModal();
    }
  }

  closeEggConfirmation() {
    this.eggConfirmationModal.style.display = 'none';
    this.pendingEggToUse = null;
  }

  // ========== MODAL SHOP ==========

  async openShopModal() {
    this.shopModal.style.display = 'block';
    await this.displayShopModal();
  }

  closeShopModal() {
    this.shopModal.style.display = 'none';
  }

  async displayShopModal() {
    const items = shopManager.getAvailableItems();
    this.modalItemsGrid.innerHTML = '';

    items.forEach(itemData => {
      const itemElement = this.createModalShopItem(itemData);
      this.modalItemsGrid.appendChild(itemElement);
    });

    this.updateModalBalance();
  }

  createModalShopItem(itemData) {
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
              onclick="gameUI.buyItemFromModal('${itemName}')"
              ${!hasEnoughMoney || (isUpgrade && !canUpgrade) ? 'disabled' : ''}>
        ${isUpgrade && !canUpgrade ? 'Max Level' : (isUpgrade && currentLevel > 0 ? 'Upgrade' : 'Buy')}
      </button>
    `;

    return div;
  }

  async buyItemFromModal(itemName) {
    const result = await shopManager.buyItem(itemName);

    if (result.success) {
      alert(`Successfully purchased ${itemName}!`);
      this.displayShopModal();
    } else {
      alert(`Purchase failed: ${result.message}`);
    }
  }
}

// Initialiser l'interface au chargement
const gameUI = new GameUI();
document.addEventListener('DOMContentLoaded', () => gameUI.initialize());
