// rewardButton.js — Classe représentant le bouton associé à une récompense
class RewardButton {
  /**
   * @param {Object} data - Données brutes du bouton depuis le JSON
   */
  constructor(data) {
    this.txtButtonFR = data.TxtButton_FR || '';
    this.txtButtonEN = data.TxtButton_EN || '';
    this.urlButton = data.UrlButton || '';
  }

  /**
   * Retourne le texte traduit du bouton selon la langue courante
   */
  getText() {
    const lang = typeof Translator !== 'undefined' ? Translator.getLanguage() : 'fr';
    return lang === 'fr' ? this.txtButtonFR : this.txtButtonEN;
  }

  /**
   * Ouvre l'URL dans un nouvel onglet
   */
  openUrl() {
    if (this.urlButton) {
      window.open(this.urlButton, '_blank');
    }
  }
}