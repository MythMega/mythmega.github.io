/**
 * UserProfile.js
 * Gestion du profil utilisateur via IndexedDB.
 * Stocke : pseudo, liste "à faire", liste "masquée", XP.
 *
 * Formule de niveau : RequiredXP(n) = 100*(n-1)+25
 *   → XP nécessaire au niveau n pour passer au niveau n+1
 *   Niveau 1 → niveau 2 : 25 XP
 *   Niveau 2 → niveau 3 : 125 XP
 *   Niveau 3 → niveau 4 : 225 XP …
 */

class UserProfile {
  static DB_NAME    = 'gamefinder-profile';
  static DB_VERSION = 1;
  static STORE_NAME = 'profile';

  constructor() {
    this._db = null;
  }

  /** Ouvre (ou crée) la base IndexedDB. Idempotent. */
  init() {
    if (this._db) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(UserProfile.DB_NAME, UserProfile.DB_VERSION);

      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(UserProfile.STORE_NAME)) {
          db.createObjectStore(UserProfile.STORE_NAME, { keyPath: 'key' });
        }
      };

      req.onsuccess = e => { this._db = e.target.result; resolve(); };
      req.onerror   = e => reject(e.target.error);
    });
  }

  async _get(key, defaultValue = null) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx  = this._db.transaction(UserProfile.STORE_NAME, 'readonly');
      const req = tx.objectStore(UserProfile.STORE_NAME).get(key);
      req.onsuccess = e =>
        resolve(e.target.result !== undefined ? e.target.result.value : defaultValue);
      req.onerror = e => reject(e.target.error);
    });
  }

  async _set(key, value) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx  = this._db.transaction(UserProfile.STORE_NAME, 'readwrite');
      const req = tx.objectStore(UserProfile.STORE_NAME).put({ key, value });
      req.onsuccess = () => resolve();
      req.onerror   = e => reject(e.target.error);
    });
  }

  // ── Pseudo ───────────────────────────────────────────────────────

  async getUsername() { return this._get('username', 'Joueur'); }

  async setUsername(name) {
    const trimmed = String(name).trim();
    await this._set('username', trimmed || 'Joueur');
  }

  // ── XP ───────────────────────────────────────────────────────────

  async getXP() { return this._get('xp', 0); }

  /** Ajoute de l'XP et retourne le nouveau total. */
  async addXP(amount) {
    const current  = await this.getXP();
    const newTotal = current + Math.max(0, amount);
    await this._set('xp', newTotal);
    return newTotal;
  }

  // ── Liste "à faire" ──────────────────────────────────────────────

  async getTodoList() { return this._get('todoList', []); }

  /** Retourne true si ajouté, false si déjà présent. */
  async addToTodo(gameId) {
    const list = await this.getTodoList();
    if (list.includes(gameId)) return false;
    list.push(gameId);
    await this._set('todoList', list);
    return true;
  }

  async removeFromTodo(gameId) {
    const list = await this.getTodoList();
    const idx  = list.indexOf(gameId);
    if (idx === -1) return false;
    list.splice(idx, 1);
    await this._set('todoList', list);
    return true;
  }

  async isInTodo(gameId) {
    const list = await this.getTodoList();
    return list.includes(gameId);
  }

  // ── Liste "masqués" ──────────────────────────────────────────────

  async getHiddenList() { return this._get('hiddenList', []); }

  /** Retourne true si ajouté, false si déjà présent. */
  async addToHidden(gameId) {
    const list = await this.getHiddenList();
    if (list.includes(gameId)) return false;
    list.push(gameId);
    await this._set('hiddenList', list);
    return true;
  }

  async removeFromHidden(gameId) {
    const list = await this.getHiddenList();
    const idx  = list.indexOf(gameId);
    if (idx === -1) return false;
    list.splice(idx, 1);
    await this._set('hiddenList', list);
    return true;
  }

  async isInHidden(gameId) {
    const list = await this.getHiddenList();
    return list.includes(gameId);
  }

  // ── Filtres sauvegardés ──────────────────────────────────────────

  /** Retourne le tableau des filtres sauvegardés : [{ name, state }, …] */
  async getSavedFilters() {
    const list = await this._get('savedFilters', []);
    console.log(`[UserProfile] getSavedFilters → ${list.length} filtre(s) :`, list.map(f => f.name));
    return list;
  }

  /**
   * Sauvegarde un filtre sous un nom.
   * Écrase l'entrée existante si le nom est déjà pris.
   * @param {string} name
   * @param {Object} state - état des filtres (objet sérialisable)
   */
  async saveFilter(name, state) {
    const trimmed = String(name).trim();
    if (!trimmed) throw new Error('Le nom du filtre ne peut pas être vide.');
    const list = await this.getSavedFilters();
    const idx  = list.findIndex(f => f.name === trimmed);
    console.log(`[UserProfile] saveFilter « ${trimmed} » — ${idx !== -1 ? 'mise à jour' : 'nouvel entrée'} | state :`, JSON.stringify(state));
    if (idx !== -1) {
      list[idx] = { name: trimmed, state };
    } else {
      list.push({ name: trimmed, state });
    }
    await this._set('savedFilters', list);
    console.log(`[UserProfile] savedFilters après save (${list.length} total) :`, list.map(f => f.name));
  }

  /**
   * Supprime un filtre par son nom.
   * @param {string} name
   */
  async deleteFilter(name) {
    const list    = await this.getSavedFilters();
    const filtered = list.filter(f => f.name !== name);
    await this._set('savedFilters', filtered);
  }

  // ── Bonus journalier (+1 XP au premier ajout du jour) ────────────

  /**
   * Vérifie si c'est le premier ajout à une liste aujourd'hui.
   * Si oui, enregistre la date et retourne true.
   */
  async checkDailyAddBonus() {
    const today = new Date().toDateString();
    const last  = await this._get('lastAddDate', null);
    if (last === today) return false;
    await this._set('lastAddDate', today);
    return true;
  }

  // ── Calcul de niveau ─────────────────────────────────────────────

  /**
   * Calcule le niveau à partir de l'XP totale.
   * @param {number} totalXP
   * @returns {{ level: number, xpInCurrentLevel: number, xpRequiredForNext: number }}
   */
  static calcLevel(totalXP) {
    let level      = 1;
    let xpConsumed = 0;

    while (true) {
      const needed = 100 * (level - 1) + 25;
      if (xpConsumed + needed > totalXP) break;
      xpConsumed += needed;
      level++;
    }

    return {
      level,
      xpInCurrentLevel:  totalXP - xpConsumed,
      xpRequiredForNext: 100 * (level - 1) + 25,
    };
  }
}

// ── Notification XP globale ──────────────────────────────────────────

/**
 * Affiche une notification XP légère en haut à gauche de l'écran.
 * @param {number} amount - Quantité d'XP gagnée
 */
function showXPNotif(amount) {
  let container = document.getElementById('xp-notif-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'xp-notif-container';
    document.body.appendChild(container);
  }

  const el = document.createElement('div');
  el.className = 'xp-notif';
  el.textContent = `+${amount} XP`;
  container.appendChild(el);

  requestAnimationFrame(() =>
    requestAnimationFrame(() => el.classList.add('xp-notif-visible'))
  );

  setTimeout(() => {
    el.classList.remove('xp-notif-visible');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
  }, 1800);
}

window.UserProfile = UserProfile;
window.showXPNotif = showXPNotif;
