// Interface utilisateur du jeu
class GameUI {
  constructor() {
    this.eggButton = document.getElementById('eggButton');
    this.nextEggButton = document.getElementById('nextEggButton');
    this.eggWrapper = document.getElementById('eggWrapper');
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
    
    // New Pokémon Modal
    this.newPokemonModal = document.getElementById('newPokemonModal');
    this.newPokemonTitle = document.getElementById('newPokemonTitle');
    this.newPokemonSprite = document.getElementById('newPokemonSprite');
    this.newPokemonEggSprite = document.getElementById('newPokemonEggSprite');
    this.newPokemonName = document.getElementById('newPokemonName');
    this.newPokemonTypes = document.getElementById('newPokemonTypes');
    this.newPokemonRarity = document.getElementById('newPokemonRarity');
    
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
    
    // Click on egg to hatch it
    this.eggWrapper.addEventListener('click', () => this.handleEggClick());
    
    // Space key to hatch egg
    document.addEventListener('keydown', (e) => {
      // Ignore if typing in an input or textarea
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }
      
      if (e.code === 'Space') {
        e.preventDefault();
        this.handleEggClick();
      }
      
      // I key to open inventory
      if (e.key.toLowerCase() === 'i') {
        e.preventDefault();
        this.openInventoryModal();
      }
      
      // S or B key to open shop
      if (e.key.toLowerCase() === 's' || e.key.toLowerCase() === 'b') {
        e.preventDefault();
        this.openShopModal();
      }
    });
    
    // Swipe right on hatched pokemon to open next egg
    this.setupSwipeListeners();
    
    // S'abonner aux changements de Pokedollars
    currencyManager.subscribe((amount) => {
      this.updatePokedollarsDisplay();
      this.updateModalBalance();
    });

    // Écouter les changements de sprite
    window.addEventListener('spriteVersionChanged', () => {
      this.updateSpriteDisplay();
    });
  }

  setupSwipeListeners() {
    let touchStartX = 0;
    let touchEndX = 0;
    
    this.hatchedPokemon.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].screenX;
    }, false);
    
    this.hatchedPokemon.addEventListener('touchend', (e) => {
      touchEndX = e.changedTouches[0].screenX;
      this.handleSwipe(touchStartX, touchEndX);
    }, false);
  }

  handleSwipe(startX, endX) {
    const swipeThreshold = 50; // Minimum distance to be considered a swipe
    const swipeDistance = endX - startX;
    
    // If swiped to the right by at least threshold distance
    if (swipeDistance > swipeThreshold) {
      this.handleNextEgg();
    }
  }

  updateSpriteDisplay() {
    // Mettre à jour le sprite affiché actuellement
    if (gameManager.currentEgg && gameManager.currentEgg.pokemon) {
      let pokemon = gameManager.currentEgg.pokemon;
      // S'assurer que c'est une instance de Pokemon
      if (pokemon && !pokemon.getName) {
        pokemon = new Pokemon(pokemon);
        gameManager.currentEgg.pokemon = pokemon;
      }
      if (this.hatchedPokemon.classList.contains('show')) {
        // Si un pokémon éclos est affiché
        this.hatchedSprite.src = pokemon.sprite;
      }
    }
    
    // Mettre à jour aussi la modal de nouveau pokémon si elle est ouverte
    if (this.newPokemonModal.style.display === 'block' && gameManager.currentEgg && gameManager.currentEgg.pokemon) {
      let pokemon = gameManager.currentEgg.pokemon;
      // S'assurer que c'est une instance de Pokemon
      if (pokemon && !pokemon.getName) {
        pokemon = new Pokemon(pokemon);
        gameManager.currentEgg.pokemon = pokemon;
      }
      this.newPokemonSprite.src = pokemon.sprite;
    }
  }

  async initialize() {
    try {
      // Diagnostic au démarrage
      console.log('Starting game initialization...');
      
      // Nettoyer les anciennes bases de données
      await Diagnostics.cleanOldDatabases();
      
      // Vérifier la base de données
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
      
      // Sauvegarder régulièrement l'inventaire et la balance (toutes les 5 secondes)
      setInterval(() => this.saveGameProgressData(), 5000);
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
    this.inventoryButton.textContent = optionsManager.translate('inventory');
    this.shopButton.textContent = optionsManager.translate('shop');
  }

  async loadGameData() {
    // Charger TOUTES les données du jeu
    const allData = await dataLoader.loadAllGameData();
    
    // Charger les Pokémon attrapés
    if (allData.caughtPokemon) {
      gameManager.caughtPokemon = allData.caughtPokemon;
    }
    
    // Charger l'inventaire
    if (allData.inventory && Object.keys(allData.inventory).length > 0) {
      inventoryManager.items = allData.inventory;
      inventoryManager.calculateStats();
    }
    
    // Charger la balance
    if (allData.balance !== undefined && allData.balance > 0) {
      currencyManager.setBalance(allData.balance);
    }
    
    // La langue est déjà chargée dans loadTranslations()
  }

  // Sauvegarder les données de progression du jeu
  async saveGameProgressData() {
    try {
      const gameData = {
        inventory: inventoryManager.items,
        balance: currencyManager.getBalance(),
        language: optionsManager.currentLanguage
      };
      await dataLoader.saveGameData(gameData);
    } catch (error) {
      console.warn('Error saving game progress data:', error);
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
    this.hatchedPokemon.classList.remove('show');
    this.eggWrapper.classList.remove('hatched');
    this.nextEggButton.style.display = 'none';
    this.nextEggButton.disabled = false; // S'assurer que le bouton n'est pas désactivé
    this.eggButton.style.display = 'block';
    this.eggButton.disabled = false;
    
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
    if (!gameManager.currentEgg) {
      return;
    }
    
    const percentage = (progress || (gameManager.currentEgg.currentClicks / gameManager.currentEgg.clicksNeeded)) * 100;
    // Limiter à 100% maximum
    const finalPercentage = Math.min(percentage, 100);
    this.progressFill.style.width = finalPercentage + '%';
    
    // Vérifier si l'oeuf doit éclore (utile pour l'autoclicker)
    if (gameManager.currentEgg.currentClicks >= gameManager.currentEgg.clicksNeeded) {
      this.displayHatchedPokemon();
    }
  }

  displayHatchedPokemon() {
    // Vérifier si c'est un nouveau pokémon AVANT d'appeler hatchEgg()
    // (car hatchEgg() va l'ajouter à caughtPokemon)
    const isNewPokemon = gameManager.currentEgg && gameManager.currentEgg.pokemon && 
                         !(gameManager.currentEgg.pokemon.index in gameManager.caughtPokemon);
    
    // Mettre à jour l'affichage des clicks AVANT de réinitialiser currentEgg
    // (car hatchEgg() va mettre currentEgg à null)
    if (gameManager.currentEgg) {
      this.clicksCount.textContent = Math.floor(gameManager.currentEgg.clicksNeeded);
      this.clicksNeeded.textContent = gameManager.currentEgg.clicksNeeded;
    }
    
    const pokemon = gameManager.hatchEgg();
    
    if (pokemon && typeof pokemon.getName === 'function') {
      // Masquer le bouton de clic
      this.eggButton.style.display = 'none';
      
      // Afficher le Pokémon éclos
      this.hatchedSprite.src = pokemon.sprite;
      this.hatchedName.textContent = pokemon.getName(optionsManager.currentLanguage);
      this.hatchedPokemon.classList.add('show');
      
      // Masquer l'oeuf et son overlay (crack), garder l'underlay (rareté)
      this.eggWrapper.classList.add('hatched');
      
      // Afficher le bouton pour ouvrir un autre œuf
      this.nextEggButton.style.display = 'block';
      this.nextEggButton.disabled = false; // Le bouton est maintenant cliquable
      
      // Afficher la modal si c'est un nouveau pokémon
      if (isNewPokemon) {
        this.displayNewPokemonModal(pokemon);
      } else if (optionsManager.isIdleMode()) {
        // Mode idle: si ce n'est pas un nouveau pokémon, passer au suivant après 1 seconde
        setTimeout(() => this.handleNextEgg(), 1000);
      }
    } else {
      console.warn('Failed to hatch pokemon or invalid pokemon object:', pokemon);
    }
  }

  handleNextEgg() {
    // Vérifier qu'aucun œuf n'est en cours d'éclosion AVANT de lancer un nouveau
    // Cette protection évite les problèmes en mode IDLE où un click utilisateur
    // pourrait relancer un œuf alors qu'un autoclick est en cours
    if (gameManager.currentEgg !== null && gameManager.currentEgg.currentClicks < gameManager.currentEgg.clicksNeeded) {
      // Un œuf est actuellement en cours d'éclosion, ignorer le click
      console.warn('An egg is already being hatched, ignoring next egg request');
      return;
    }
    
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

    // Récupérer la description en fonction de la langue actuelle
    const currentLanguage = (window.optionsManager?.currentLanguage) || 'en';
    let description = '';
    if (currentLanguage === 'fr') {
      description = itemData.Description_FR || itemData.Description_EN || 'Pas de description';
    } else {
      description = itemData.Description_EN || itemData.Description_FR || 'No description available';
    }

    let contentHTML = `
      <img src="${itemData.Sprite}" alt="${itemName}" class="item-sprite">
      <div class="item-info">
        <h4>${itemName}</h4>
        <p class="item-description">${description}</p>
    `;

    if (isConsumable) {
      const quantityLabel = optionsManager.translate('quantity');
      const useLabel = optionsManager.translate('use');
      contentHTML += `<p class="item-quantity">${quantityLabel}: ${inventoryItem.quantity}</p>`;
      contentHTML += `
        <button class="use-button" onclick="gameUI.useConsumableFromModal('${itemName}')">
          ${useLabel}
        </button>
      `;
    } else {
      const levelLabel = optionsManager.translate('level');
      contentHTML += `<p class="item-level">${levelLabel}: ${inventoryItem.level}</p>`;
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

      // Afficher la notification
      this.showNotification(itemData.Sprite, `-1x ${this.pendingEggToUse}`, 1000);
      
      // Fermer la confirmation ET l'inventaire
      this.closeEggConfirmation();
      this.closeInventoryModal();
      
      // Mettre à jour l'affichage du jeu
      this.displayCurrentEgg();
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

    // Récupérer la description en fonction de la langue actuelle
    const currentLanguage = (window.optionsManager?.currentLanguage) || 'en';
    let description = '';
    if (currentLanguage === 'fr') {
      description = itemData.Description_FR || itemData.Description_EN || 'Pas de description';
    } else {
      description = itemData.Description_EN || itemData.Description_FR || 'No description available';
    }

    let price = 0;
    if (isUpgrade) {
      price = shopManager.getUpgradePrice(itemName);
    } else {
      price = shopManager.getConsumablePrice(itemName);
    }

    const hasEnoughMoney = currencyManager.getBalance() >= price;

    const levelLabel = optionsManager.translate('level');
    const ownedLabel = 'Owned';
    const buyLabel = optionsManager.translate('buy');
    const upgradeLabel = 'Upgrade';
    const maxLevelLabel = 'Max Level';

    let levelDisplay = '';
    if (isUpgrade) {
      levelDisplay = `<p class="item-level">${levelLabel}: ${currentLevel}/${itemData.MaxLevel}</p>`;
    } else {
      const quantity = inventoryManager.getItemQuantity(itemName);
      levelDisplay = `<p class="item-quantity">${ownedLabel}: ${quantity}</p>`;
    }

    div.innerHTML = `
      <img src="${itemData.Sprite}" alt="${itemName}" class="item-sprite">
      <h3>${itemName}</h3>
      <p class="item-description">${description}</p>
      ${levelDisplay}
      <p class="item-price">${price} Pokédollars</p>
      <button class="buy-button" 
              onclick="gameUI.buyItemFromModal('${itemName}')"
              ${!hasEnoughMoney || (isUpgrade && !canUpgrade) ? 'disabled' : ''}>
        ${isUpgrade && !canUpgrade ? maxLevelLabel : (isUpgrade && currentLevel > 0 ? upgradeLabel : buyLabel)}
      </button>
    `;

    return div;
  }

  showNotification(icon, text, duration = 1000) {
    // Créer la notification
    const notification = document.createElement('div');
    notification.className = 'item-notification';
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 1rem 1.5rem;
      border-radius: 10px;
      display: flex;
      align-items: center;
      gap: 0.8rem;
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      animation: slideIn 0.3s ease;
    `;
    
    notification.innerHTML = `
      <img src="${icon}" style="width: 32px; height: 32px; object-fit: contain;">
      <span>${text}</span>
    `;
    
    document.body.appendChild(notification);
    
    // Disparition
    setTimeout(() => {
      notification.style.animation = 'fadeOut 0.5s ease forwards';
      setTimeout(() => notification.remove(), 500);
    }, duration);
  }

  async buyItemFromModal(itemName) {
    const result = await shopManager.buyItem(itemName);

    if (result.success) {
      const itemData = shopManager.getItemData(itemName);
      this.showNotification(itemData.Sprite, `+1x ${itemName}`, 1000);
      this.displayShopModal();
    } else {
      alert(`Purchase failed: ${result.message}`);
    }
  }

  // ========== NEW POKÉMON MODAL ==========

  displayNewPokemonModal(pokemon) {
    // S'assurer que pokemon est une instance de Pokemon
    if (pokemon && !pokemon.getName) {
      pokemon = new Pokemon(pokemon);
    }
    
    const family = gameManager.getPokemonFamily(pokemon);
    if (!family) {
      console.warn('Could not find family for pokemon:', pokemon);
      return;
    }

    const language = optionsManager.currentLanguage || 'en';
    
    // Mettre à jour le contenu de la modal
    this.newPokemonName.textContent = pokemon.getName(language);
    this.newPokemonSprite.src = pokemon.sprite;
    this.newPokemonEggSprite.src = family.eggImage;
    
    // Afficher les types
    this.newPokemonTypes.innerHTML = '';
    const types = pokemon.getTypes();
    types.forEach(type => {
      const typeBadge = document.createElement('span');
      typeBadge.className = `type-badge ${type.toLowerCase()}`;
      typeBadge.textContent = type;
      this.newPokemonTypes.appendChild(typeBadge);
    });
    
    // Afficher la rareté (stars)
    const rarityStars = '★'.repeat(family.rarity);
    this.newPokemonRarity.innerHTML = rarityStars;
    
    // Mettre à jour le titre en fonction de la langue
    if (language === 'fr') {
      this.newPokemonTitle.textContent = 'Nouveau Pokémon découvert!';
    } else {
      this.newPokemonTitle.textContent = 'New Pokémon Discovered!';
    }
    
    // Afficher la modal
    this.newPokemonModal.style.display = 'block';
    
    // Fermer la modal au clic en dehors
    const closeOnOutsideClick = (event) => {
      // Vérifier si le clic est en dehors du modal-content
      if (event.target === this.newPokemonModal) {
        this.closeNewPokemonModal();
        this.newPokemonModal.removeEventListener('click', closeOnOutsideClick);
      }
    };
    this.newPokemonModal.addEventListener('click', closeOnOutsideClick);
  }

  closeNewPokemonModal() {
    this.newPokemonModal.style.display = 'none';
  }
}

// Initialiser l'interface au chargement
const gameUI = new GameUI();
document.addEventListener('DOMContentLoaded', () => gameUI.initialize());
