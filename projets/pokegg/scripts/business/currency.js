// Gestion de la monnaie (Pokedollars) et des cookies
class CurrencyManager {
  constructor() {
    this.pokedollars = this.loadPokedollars();
    this.autoClickManager = null;
  }

  // Charger les Pokedollars depuis les cookies
  loadPokedollars() {
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
      cookie = cookie.trim();
      if (cookie.startsWith('pokedollars=')) {
        return parseInt(cookie.substring('pokedollars='.length), 10) || 0;
      }
    }
    return 0;
  }

  // Sauvegarder les Pokedollars dans les cookies
  savePokedollars() {
    const expirationDate = new Date();
    expirationDate.setFullYear(expirationDate.getFullYear() + 1);
    document.cookie = `pokedollars=${this.pokedollars}; expires=${expirationDate.toUTCString()}; path=/`;
  }

  // Ajouter de l'argent
  addPokedollars(amount) {
    this.pokedollars += amount;
    this.savePokedollars();
    this.notifyObservers();
  }

  // Retirer de l'argent (retourne true si possible, false sinon)
  removePokedollars(amount) {
    if (this.pokedollars >= amount) {
      this.pokedollars -= amount;
      this.savePokedollars();
      this.notifyObservers();
      return true;
    }
    return false;
  }

  // Obtenir le solde actuel
  getBalance() {
    return this.pokedollars;
  }

  // Définir directement le solde (utile pour l'import)
  setBalance(amount) {
    this.pokedollars = Math.max(0, amount);
    this.savePokedollars();
    this.notifyObservers();
  }

  // Observer pattern pour notifier les changements
  observers = [];

  subscribe(callback) {
    this.observers.push(callback);
  }

  notifyObservers() {
    this.observers.forEach(callback => callback(this.pokedollars));
  }

  // Réinitialiser (pour les tests)
  reset() {
    this.pokedollars = 0;
    this.savePokedollars();
    this.notifyObservers();
  }
}

const currencyManager = new CurrencyManager();
