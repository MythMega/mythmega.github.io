/**
 * ===================================
 * Mons.js - Classe Pokémon
 * Modèle de données pour les Pokémons
 * ===================================
 */

/**
 * Classe représentant un Pokémon
 * Valide et structure les données
 */
class Pokemon {
    /**
     * Constructeur
     * @param {Object} data - Données brutes du JSON
     */
    constructor(data) {
        this.Name_EN = data.Name_EN || '';
        this.Name_FR = data.Name_FR || '';
        this.Types = Array.isArray(data.Types) ? data.Types : [];
        this.Serie = data.Serie || '';
        this.Sprite = data.Sprite || '';
        this.Sprite_Shiny = data.Sprite_Shiny || '';
        
        // Index peut être un nombre ou une chaîne
        if (typeof data.Index === 'number') {
            this.Index = data.Index;
        } else if (typeof data.Index === 'string' && data.Index.trim() !== '') {
            this.Index = parseInt(data.Index, 10);
        } else {
            this.Index = null;
        }
        
        this.Height = typeof data.Height === 'number' ? data.Height : 0;
        this.Weight = typeof data.Weight === 'number' ? data.Weight : 0;
    }

    /**
     * Vérifie si le Pokémon est valide
     * @returns {boolean} True si valide
     */
    isValid() {
        const valid = 
            this.Name_EN?.length > 0 &&
            this.Name_FR?.length > 0 &&
            this.Types?.length > 0 &&
            this.Index !== null &&
            this.Index !== undefined &&
            this.Sprite?.length > 0 &&
            this.Sprite_Shiny?.length > 0;
        
        return valid;
    }

    /**
     * Retourne le nom selon la langue
     * @param {string} lang - Code de langue (FR ou EN)
     * @returns {string} Nom traduit
     */
    getName(lang = 'FR') {
        return lang === 'EN' ? this.Name_EN : this.Name_FR;
    }

    /**
     * Retourne le sprite selon l'état shiny
     * @param {boolean} isShiny - Est shiny?
     * @returns {string} URL du sprite
     */
    getSprite(isShiny = false) {
        return isShiny ? this.Sprite_Shiny : this.Sprite;
    }

    /**
     * Retourne une représentation texte
     * @returns {string}
     */
    toString() {
        return `${this.Name_FR} (${this.Name_EN}) #${this.Index} - ${this.Serie}`;
    }

    /**
     * Exporte les données
     * @returns {Object}
     */
    toJSON() {
        return {
            Name_EN: this.Name_EN,
            Name_FR: this.Name_FR,
            Types: this.Types,
            Serie: this.Serie,
            Sprite: this.Sprite,
            Sprite_Shiny: this.Sprite_Shiny,
            Index: this.Index,
            Height: this.Height,
            Weight: this.Weight
        };
    }
}

console.log('%c📦 Classe Pokemon chargée', 'color: #00d4ff; font-weight: bold');
