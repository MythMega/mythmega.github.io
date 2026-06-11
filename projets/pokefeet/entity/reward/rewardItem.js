 // rewardItem.js — Classe représentant un élément de récompense (Badge, Title, StreamdexCMD)
class RewardItem {
  /**
   * @param {Object} data - Données brutes de l'item depuis le JSON
   */
  constructor(data) {
    this.type = data.Type || '';
    this.data = data.Data || '';
  }

  /**
   * Retourne le label traduit pour le type d'item
   */
  getTypeLabel() {
    const T = (k, f) => typeof Translator !== 'undefined' ? Translator.get(k, f) : f;
    switch (this.type) {
      case 'Badge':
        return T('reward.badgeUnlocked', 'Badge de profil débloqué');
      case 'Title':
        return T('reward.titleUnlocked', 'Nouveau titre débloqué');
      case 'StreamdexCMD':
        return T('reward.streamdexCmdUnlocked', 'Nouveau giveaway débloqué');
      default:
        return this.type;
    }
  }

  /**
   * Génère le HTML pour afficher cet item dans la popup
   */
  renderHTML() {
    const T = (k, f) => typeof Translator !== 'undefined' ? Translator.get(k, f) : f;
    const container = document.createElement('div');
    container.className = 'reward-item-display';

    const label = document.createElement('div');
    label.className = 'reward-item-label';
    label.textContent = this.getTypeLabel();
    container.appendChild(label);

    switch (this.type) {
      case 'Badge':
        const badgeImg = document.createElement('img');
        badgeImg.className = 'reward-badge-img';
        badgeImg.src = this.data;
        badgeImg.alt = 'Badge';
        badgeImg.onerror = function() { this.style.display = 'none'; };
        container.appendChild(badgeImg);
        break;

      case 'Title':
        const titleSpan = document.createElement('div');
        titleSpan.className = 'reward-title-text';
        titleSpan.textContent = this.data;
        container.appendChild(titleSpan);
        break;

      case 'StreamdexCMD':
        const cmdSpan = document.createElement('div');
        cmdSpan.className = 'reward-streamdex-cmd';
        cmdSpan.textContent = this.data;
        container.appendChild(cmdSpan);

        const copyBtn = document.createElement('button');
        copyBtn.className = 'reward-copy-btn';
        copyBtn.textContent = T('reward.copyCommand', 'Copier la commande du giveaway');
        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(this.data).then(() => {
            copyBtn.textContent = T('reward.copied', 'Copié !');
            setTimeout(() => {
              copyBtn.textContent = T('reward.copyCommand', 'Copier la commande du giveaway');
            }, 2000);
          }).catch(() => {
            // Fallback si clipboard API non disponible
            const ta = document.createElement('textarea');
            ta.value = this.data;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            copyBtn.textContent = T('reward.copied', 'Copié !');
            setTimeout(() => {
              copyBtn.textContent = T('reward.copyCommand', 'Copier la commande du giveaway');
            }, 2000);
          });
        });
        container.appendChild(copyBtn);
        break;
    }

    return container;
  }
}