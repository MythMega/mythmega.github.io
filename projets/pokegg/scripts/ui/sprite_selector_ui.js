// Gestion de la sélection des sprites dans les options
class SpriteSelectorUI {
  constructor() {
    this.spriteVersionSelect = document.getElementById('spriteVersionSelect');
    this.spriteVersionTitle = document.getElementById('spriteVersionTitle');
    this.spriteVersionLabel = document.getElementById('spriteVersionLabel');
    
    if (this.spriteVersionSelect) {
      this.setupEventListeners();
      this.loadCurrentSelection();
    }
  }

  setupEventListeners() {
    this.spriteVersionSelect.addEventListener('change', (e) => {
      this.handleSpriteVersionChange(e.target.value);
    });
  }

  loadCurrentSelection() {
    const currentVersion = optionsManager.getSpriteVersion();
    this.spriteVersionSelect.value = currentVersion;
  }

  handleSpriteVersionChange(version) {
    optionsManager.setSpriteVersion(version);
    // Émettre un événement personnalisé pour que les autres parties de l'application se mettent à jour
    window.dispatchEvent(new CustomEvent('spriteVersionChanged', { detail: { version } }));
  }

  updateTranslations() {
    this.spriteVersionTitle.textContent = optionsManager.translate('sprite_version');
    if (this.spriteVersionLabel) {
      this.spriteVersionLabel.textContent = optionsManager.translate('sprite_version') + ':';
    }
  }
}

const spriteSelectorUI = new SpriteSelectorUI();
