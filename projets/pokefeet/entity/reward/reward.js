// reward.js — Classe représentant une récompense déblocable par niveau
class Reward {
  /**
   * @param {Object} data - Données brutes du JSON pour une récompense
   */
  constructor(data) {
    this.level = data.Level || 0;
    this.imageUrl = data.ImageUrl || '';
    this.titleFR = data.Title_FR || '';
    this.titleEN = data.Title_EN || '';
    this.descriptionFR = data.Description_FR || '';
    this.descriptionEN = data.Description_EN || '';

    // Créer les items de récompense
    this.items = [];
    if (data.Reward && Array.isArray(data.Reward)) {
      for (const itemData of data.Reward) {
        this.items.push(new RewardItem(itemData));
      }
    }

    // Créer le bouton (peut être null)
    this.button = data.Button ? new RewardButton(data.Button) : null;
  }

  /**
   * Titre traduit selon la langue courante
   */
  getTitle() {
    const lang = typeof Translator !== 'undefined' ? Translator.getLanguage() : 'fr';
    return lang === 'fr' ? this.titleFR : this.titleEN;
  }

  /**
   * Description traduite selon la langue courante
   */
  getDescription() {
    const lang = typeof Translator !== 'undefined' ? Translator.getLanguage() : 'fr';
    return lang === 'fr' ? this.descriptionFR : this.descriptionEN;
  }

  /**
   * Vérifie si la récompense est débloquée
   * @param {number} currentLevel - Niveau actuel du joueur
   * @returns {boolean}
   */
  isUnlocked(currentLevel) {
    return currentLevel >= this.level;
  }

  /**
   * Calcule le pourcentage de progression vers le déblocage
   * @param {number} currentLevel - Niveau actuel du joueur
   * @returns {number} Pourcentage (0-100), plafonné à 100
   */
  getProgress(currentLevel) {
    if (this.level <= 0) return 100;
    return Math.min(100, Math.round((currentLevel / this.level) * 100));
  }

  /**
   * Génère la carte HTML pour la grille des récompenses
   * @param {number} currentLevel - Niveau actuel du joueur
   * @param {function} onClick - Callback quand on clique sur "Voir"
   * @returns {HTMLElement}
   */
  renderCard(currentLevel, onClick) {
    const T = (k, f) => typeof Translator !== 'undefined' ? Translator.get(k, f) : f;
    const unlocked = this.isUnlocked(currentLevel);
    const progress = this.getProgress(currentLevel);

    const card = document.createElement('div');
    card.className = 'reward-card' + (unlocked ? ' unlocked' : ' locked');

    // Image
    const img = document.createElement('img');
    img.className = 'reward-card-img';
    img.src = this.imageUrl || './icon.png';
    img.alt = this.getTitle();
    img.onerror = function() { this.src = './icon.png'; };
    card.appendChild(img);

    // Titre
    const title = document.createElement('div');
    title.className = 'reward-card-title';
    title.textContent = this.getTitle();
    card.appendChild(title);

    // Barre de progression + texte
    const progressContainer = document.createElement('div');
    progressContainer.className = 'reward-progress-container';

    const progressText = document.createElement('div');
    progressText.className = 'reward-progress-text';
    progressText.textContent = T('reward.level', 'Niveau') + ' ' + this.level + ' — ' + progress + '%';
    progressContainer.appendChild(progressText);

    const barOuter = document.createElement('div');
    barOuter.className = 'reward-progress-bar';
    const barInner = document.createElement('div');
    barInner.className = 'reward-progress-fill';
    barInner.style.width = progress + '%';
    barOuter.appendChild(barInner);
    progressContainer.appendChild(barOuter);

    card.appendChild(progressContainer);

    // Bouton "Voir" si débloqué
    if (unlocked) {
      const viewBtn = document.createElement('button');
      viewBtn.className = 'reward-view-btn';
      viewBtn.textContent = T('reward.view', 'Voir');
      viewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (onClick) onClick(this);
      });
      card.appendChild(viewBtn);
    }

    return card;
  }

  /**
   * Génère le contenu HTML complet pour la popup de détails
   * @returns {HTMLElement}
   */
  renderPopupContent() {
    const T = (k, f) => typeof Translator !== 'undefined' ? Translator.get(k, f) : f;
    const container = document.createElement('div');
    container.className = 'reward-popup-content';

    // Image
    const img = document.createElement('img');
    img.className = 'reward-popup-img';
    img.src = this.imageUrl || './icon.png';
    img.alt = this.getTitle();
    img.onerror = function() { this.src = './icon.png'; };
    container.appendChild(img);

    // Titre
    const title = document.createElement('h2');
    title.className = 'reward-popup-title';
    title.textContent = this.getTitle();
    container.appendChild(title);

    // Description
    const desc = document.createElement('p');
    desc.className = 'reward-popup-desc';
    desc.textContent = this.getDescription();
    container.appendChild(desc);

    // Liste des items
    if (this.items.length > 0) {
      const itemsList = document.createElement('div');
      itemsList.className = 'reward-popup-items';
      for (const item of this.items) {
        itemsList.appendChild(item.renderHTML());
      }
      container.appendChild(itemsList);
    }

    // Bouton d'action si présent
    if (this.button) {
      const actionBtn = document.createElement('button');
      actionBtn.className = 'reward-action-btn';
      actionBtn.textContent = this.button.getText();
      actionBtn.addEventListener('click', () => {
        this.button.openUrl();
      });
      container.appendChild(actionBtn);
    }

    return container;
  }
}