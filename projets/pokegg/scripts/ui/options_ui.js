// Interface utilisateur des options
class OptionsUI {
  constructor() {
    this.langEN = document.getElementById('langEN');
    this.langFR = document.getElementById('langFR');
    this.darkModeSwitch = document.getElementById('darkModeSwitch');
    this.darkModeStatus = document.getElementById('darkModeStatus');
    this.idleModeSwitch = document.getElementById('idleModeSwitch');
    this.idleModeStatus = document.getElementById('idleModeStatus');
    this.idleInfoIcon = document.getElementById('idleInfoIcon');
    this.idleTooltip = document.getElementById('idleTooltip');
    this.exportButton = document.getElementById('exportButton');
    this.importButton = document.getElementById('importButton');
    this.importFile = document.getElementById('importFile');
    this.deleteButton = document.getElementById('deleteButton');
    
    // Modal de confirmation de suppression
    this.deleteModal = document.getElementById('deleteModal');
    this.deleteCancel = document.getElementById('deleteCancel');
    this.deleteConfirm = document.getElementById('deleteConfirm');
    
    this.setupEventListeners();
  }

  setupEventListeners() {
    if (this.langEN) this.langEN.addEventListener('click', () => this.changeLanguage('en'));
    if (this.langFR) this.langFR.addEventListener('click', () => this.changeLanguage('fr'));
    if (this.darkModeSwitch) this.darkModeSwitch.addEventListener('change', () => this.toggleDarkMode());
    if (this.idleModeSwitch) this.idleModeSwitch.addEventListener('change', () => this.toggleIdleMode());
    if (this.idleInfoIcon) {
      this.idleInfoIcon.addEventListener('mouseenter', () => this.showIdleTooltip());
      this.idleInfoIcon.addEventListener('mouseleave', () => this.hideIdleTooltip());
    }
    if (this.exportButton) this.exportButton.addEventListener('click', () => this.handleExport());
    if (this.importButton) this.importButton.addEventListener('click', () => this.importFile.click());
    if (this.importFile) this.importFile.addEventListener('change', (e) => this.handleImport(e));
    if (this.deleteButton) this.deleteButton.addEventListener('click', () => this.showDeleteConfirmation());
    if (this.deleteCancel) this.deleteCancel.addEventListener('click', () => this.closeDeleteModal());
    if (this.deleteConfirm) this.deleteConfirm.addEventListener('click', () => this.handleDelete());
    
    // Fermer modal en cliquant en dehors
    if (this.deleteModal) this.deleteModal.addEventListener('click', (e) => {
      if (e.target === this.deleteModal) this.closeDeleteModal();
    });
  }

  async initialize() {
    try {
      // 1. Charger le langage dans l'instance GLOBALE optionsManager
      if (typeof optionsManager !== 'undefined') {
        const language = optionsManager.getLanguage();
        await optionsManager.loadLanguage(language);
        
        // 2. Initialiser le dark mode
        optionsManager.initializeDarkMode();
      }
      
      // 3. Initialiser les managers
      if (typeof inventoryManager !== 'undefined') {
        await inventoryManager.initialize();
      }
      if (typeof gameManager !== 'undefined') {
        await gameManager.initializeGame();
      }
      
      // 4. Mettre à jour TOUS les textes maintenant que les traductions sont chargées
      this.updateLanguageButtons();
      this.updateDarkModeSwitch();
      this.updateIdleModeSwitch();
      this.updateTranslations();
    } catch (error) {
      console.error('Error initializing options UI:', error);
    }
  }

  updateTranslations() {
    document.getElementById('languageTitle').textContent = optionsManager.translate('language');
    document.getElementById('darkModeTitle').textContent = optionsManager.translate('dark_mode');
    document.getElementById('idleModeTitle').textContent = optionsManager.translate('idle_mode');
    document.getElementById('spriteVersionTitle').textContent = optionsManager.translate('sprite_version');
    document.getElementById('saveTitle').textContent = optionsManager.translate('save');
    this.exportButton.textContent = optionsManager.translate('export_save');
    this.importButton.textContent = optionsManager.translate('import_save');
    this.deleteButton.textContent = optionsManager.translate('delete_save');
    
    document.getElementById('deleteConfirmTitle').textContent = optionsManager.translate('delete_confirm');
    document.getElementById('deleteConfirmMessage').textContent = optionsManager.translate('delete_confirm');
    document.getElementById('deleteCancel').textContent = optionsManager.translate('cancel');
    document.getElementById('deleteConfirm').textContent = optionsManager.translate('confirm');
    
    // Mettre à jour aussi le sprite selector
    if (spriteSelectorUI) {
      spriteSelectorUI.updateTranslations();
    }
    
    this.updateDarkModeStatus();
    this.updateIdleModeStatus();
  }

  changeLanguage(lang) {
    optionsManager.loadLanguage(lang).then(() => {
      this.updateLanguageButtons();
      this.updateDarkModeStatus();
      this.updateIdleModeStatus();
      this.updateTranslations();
      // NE PAS recharger la page - garder les traductions à jour sans reload
    });
  }

  updateLanguageButtons() {
    const currentLang = optionsManager.getLanguage();
    
    this.langEN.classList.remove('active');
    this.langFR.classList.remove('active');
    
    if (currentLang === 'en') {
      this.langEN.classList.add('active');
    } else {
      this.langFR.classList.add('active');
    }
  }

  updateDarkModeSwitch() {
    this.darkModeSwitch.checked = optionsManager.isDarkMode();
    this.updateDarkModeStatus();
  }

  updateDarkModeStatus() {
    const isDark = optionsManager.isDarkMode();
    this.darkModeStatus.textContent = isDark ? optionsManager.translate('on') : optionsManager.translate('off');
  }

  toggleDarkMode() {
    const enabled = this.darkModeSwitch.checked;
    optionsManager.setDarkMode(enabled);
    this.updateDarkModeStatus();
  }

  updateIdleModeSwitch() {
    this.idleModeSwitch.checked = optionsManager.isIdleMode();
    this.updateIdleModeStatus();
  }

  updateIdleModeStatus() {
    const isIdle = optionsManager.isIdleMode();
    this.idleModeStatus.textContent = isIdle ? optionsManager.translate('on') : optionsManager.translate('off');
  }

  toggleIdleMode() {
    const enabled = this.idleModeSwitch.checked;
    optionsManager.setIdleMode(enabled);
    this.updateIdleModeStatus();
  }

  showIdleTooltip() {
    const description = optionsManager.translate('idle_description');
    this.idleTooltip.textContent = description;
    this.idleTooltip.style.display = 'block';
  }

  hideIdleTooltip() {
    this.idleTooltip.style.display = 'none';
  }

  async handleExport() {
    try {
      // Avant d'exporter, sauvegarder l'inventaire et la balance dans la base de données
      const gameData = {
        inventory: inventoryManager.items,
        balance: currencyManager.getBalance(),
        language: optionsManager.currentLanguage
      };
      await dataLoader.saveGameData(gameData);
      
      // Exporter toutes les données
      const success = await DataExporter.exportGame();
      if (success) {
        alert('Save exported successfully!');
      }
    } catch (error) {
      console.error('Error exporting save:', error);
      alert('Error exporting save: ' + error.message);
    }
  }

  async handleImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    try {
      await DataImporter.importFromFile(file);
      alert('Save imported successfully! Reloading...');
      setTimeout(() => location.reload(), 1000);
    } catch (error) {
      console.error('Error importing save:', error);
      alert('Error importing save: ' + error.message);
    }
    
    // Réinitialiser l'input
    this.importFile.value = '';
  }

  showDeleteConfirmation() {
    this.deleteModal.style.display = 'flex';
  }

  closeDeleteModal() {
    this.deleteModal.style.display = 'none';
  }

  async handleDelete() {
    try {
      await DataDeleter.delete();
      gameManager.caughtPokemon = {};
      alert('All data deleted successfully!');
      location.reload();
    } catch (error) {
      console.error('Error deleting data:', error);
      alert('Error deleting data');
    }
  }
}

// Initialiser l'interface au chargement
const optionsUI = new OptionsUI();
document.addEventListener('DOMContentLoaded', () => optionsUI.initialize());
