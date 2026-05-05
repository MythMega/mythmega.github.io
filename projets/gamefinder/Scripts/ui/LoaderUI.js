/**
 * LoaderUI.js
 * Gestion de l'overlay de chargement et de la barre de progression.
 */

class LoaderUI {
  constructor() {
    this.wrapper = document.getElementById('loader-bar-wrapper');
    this.bar     = document.getElementById('loader-bar');
    this.overlay = document.getElementById('loader-overlay');
    this.status  = document.getElementById('loader-status');
  }

  /**
   * Met à jour la barre de progression.
   * @param {number} percent   - 0 à 100
   * @param {string} statusText
   */
  setProgress(percent, statusText) {
    if (this.bar)    this.bar.style.width = `${percent}%`;
    if (this.status) this.status.textContent = statusText;
    console.log(`[LoaderUI] ${percent}% — ${statusText}`);
  }

  /** Cache l'overlay avec une animation de fondu. */
  hide() {
    console.log('[LoaderUI] Masquage de l\'overlay de chargement');
    if (this.overlay) {
      this.overlay.classList.add('hidden');
      // Supprimer du DOM après la transition pour éviter les interférences
      this.overlay.addEventListener('transitionend', () => {
        this.overlay.style.display = 'none';
      }, { once: true });
    }
    if (this.wrapper) this.wrapper.style.opacity = '0';
  }

  /** Affiche l'overlay (en cas de rechargement). */
  show() {
    if (this.overlay) {
      this.overlay.style.display = 'flex';
      this.overlay.classList.remove('hidden');
    }
    if (this.wrapper) this.wrapper.style.opacity = '1';
    this.setProgress(0, 'Initialisation…');
  }
}

window.LoaderUI = LoaderUI;
