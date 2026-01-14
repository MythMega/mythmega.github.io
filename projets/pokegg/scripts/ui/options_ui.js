// Interface utilisateur des options
class OptionsUI {
  constructor() {
    this.langEN = document.getElementById('langEN');
    this.langFR = document.getElementById('langFR');
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
    this.langEN.addEventListener('click', () => this.changeLanguage('en'));
    this.langFR.addEventListener('click', () => this.changeLanguage('fr'));
    this.exportButton.addEventListener('click', () => this.handleExport());
    this.importButton.addEventListener('click', () => this.importFile.click());
    this.importFile.addEventListener('change', (e) => this.handleImport(e));
    this.deleteButton.addEventListener('click', () => this.showDeleteConfirmation());
    this.deleteCancel.addEventListener('click', () => this.closeDeleteModal());
    this.deleteConfirm.addEventListener('click', () => this.handleDelete());
    
    // Fermer modal en cliquant en dehors
    this.deleteModal.addEventListener('click', (e) => {
      if (e.target === this.deleteModal) this.closeDeleteModal();
    });
  }

  async initialize() {
    await this.loadTranslations();
    this.updateLanguageButtons();
    await gameManager.initializeGame();
  }

  async loadTranslations() {
    const language = optionsManager.getLanguage();
    await optionsManager.loadLanguage(language);
    this.updateTranslations();
  }

  updateTranslations() {
    document.getElementById('languageTitle').textContent = optionsManager.translate('language');
    document.getElementById('saveTitle').textContent = optionsManager.translate('save');
    this.exportButton.textContent = optionsManager.translate('export_save');
    this.importButton.textContent = optionsManager.translate('import_save');
    this.deleteButton.textContent = optionsManager.translate('delete_save');
    
    document.getElementById('deleteConfirmTitle').textContent = optionsManager.translate('delete_confirm');
    document.getElementById('deleteConfirmMessage').textContent = optionsManager.translate('delete_confirm');
    document.getElementById('deleteCancel').textContent = optionsManager.translate('cancel');
    document.getElementById('deleteConfirm').textContent = optionsManager.translate('confirm');
  }

  changeLanguage(lang) {
    optionsManager.loadLanguage(lang).then(() => {
      this.updateLanguageButtons();
      this.updateTranslations();
      // Recharger la page pour appliquer la langue partout
      location.reload();
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

  async handleExport() {
    try {
      const data = {
        caughtPokemon: gameManager.caughtPokemon,
        lastExported: new Date().toISOString()
      };
      
      await DataExporter.export(data);
      alert('Save exported successfully!');
    } catch (error) {
      console.error('Error exporting save:', error);
      alert('Error exporting save');
    }
  }

  async handleImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    try {
      const data = await DataImporter.import(file);
      
      if (data.caughtPokemon) {
        gameManager.caughtPokemon = data.caughtPokemon;
        await dataLoader.saveData(data);
        alert('Save imported successfully!');
        location.reload();
      } else {
        throw new Error('Invalid save file format');
      }
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
