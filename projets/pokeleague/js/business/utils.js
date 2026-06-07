/**
 * Utilitaires divers pour l'application
 */

const Utils = (() => {
    /**
     * Normalise un texte (sans accents, sans casse)
     * @param {string} text 
     * @returns {string}
     */
    function normalize(text) {
        if (!text) return '';
        return text
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();
    }

    /**
     * Formate une date pour l'affichage
     * @param {string} dateStr - Date au format JJ/MM/AAAA
     * @returns {string}
     */
    function formatDate(dateStr) {
        if (!dateStr) return '';
        const [day, month, year] = dateStr.split('/');
        const date = new Date(year, month - 1, day);
        return date.toLocaleDateString('fr-FR', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });
    }

    /**
     * Traduit les types Pokémon en français
     */
    const typeTranslations = {
        'normal': 'Normal',
        'fire': 'Feu',
        'water': 'Eau',
        'electric': 'Électrik',
        'grass': 'Plante',
        'ice': 'Glace',
        'fighting': 'Combat',
        'poison': 'Poison',
        'ground': 'Sol',
        'flying': 'Vol',
        'psychic': 'Psy',
        'bug': 'Insecte',
        'rock': 'Roche',
        'ghost': 'Spectre',
        'dragon': 'Dragon',
        'dark': 'Ténèbres',
        'steel': 'Acier',
        'fairy': 'Fée',
        'stellar': 'Stellaire',
        'feu': 'Feu',
        'eau': 'Eau',
        'plante': 'Plante',
        'psy': 'Psy',
        'sol': 'Sol',
        'roche': 'Roche',
        'glace': 'Glace',
        'combat': 'Combat',
        'vol': 'Vol',
        'spectre': 'Spectre',
        'dragon': 'Dragon',
        'tenebres': 'Ténèbres',
        'acier': 'Acier',
        'fee': 'Fée'
    };

    /**
     * Traduit un type en français
     * @param {string} type 
     * @returns {string}
     */
    function translateType(type) {
        const lower = type?.toLowerCase().trim() || '';
        return typeTranslations[lower] || type || '';
    }

    /**
     * Retourne la classe CSS pour un type Pokémon
     * @param {string} type 
     * @returns {string}
     */
    function getTypeClass(type) {
        const lower = type?.toLowerCase().trim() || '';
        const mapping = {
            'normal': 'type-normal',
            'fire': 'type-fire',
            'feu': 'type-fire',
            'water': 'type-water',
            'eau': 'type-water',
            'electric': 'type-electric',
            'electrik': 'type-electric',
            'grass': 'type-grass',
            'plante': 'type-grass',
            'ice': 'type-ice',
            'glace': 'type-ice',
            'fighting': 'type-fighting',
            'combat': 'type-fighting',
            'poison': 'type-poison',
            'ground': 'type-ground',
            'sol': 'type-ground',
            'flying': 'type-flying',
            'vol': 'type-flying',
            'psychic': 'type-psychic',
            'psy': 'type-psychic',
            'bug': 'type-bug',
            'insecte': 'type-bug',
            'rock': 'type-rock',
            'roche': 'type-rock',
            'ghost': 'type-ghost',
            'spectre': 'type-ghost',
            'dragon': 'type-dragon',
            'dark': 'type-dark',
            'tenebres': 'type-dark',
            'steel': 'type-steel',
            'acier': 'type-steel',
            'fairy': 'type-fairy',
            'fee': 'type-fairy',
            'stellar': 'type-stellar',
            'stellaire': 'type-stellar'
        };
        return mapping[lower] || 'type-normal';
    }

    /**
     * Couleurs associées à chaque type pour les badges
     */
    const typeColors = {
        'normal': '#A8A878',
        'fire': '#F08030',
        'feu': '#F08030',
        'water': '#6890F0',
        'eau': '#6890F0',
        'electric': '#F8D030',
        'electrik': '#F8D030',
        'grass': '#78C850',
        'plante': '#78C850',
        'ice': '#98D8D8',
        'glace': '#98D8D8',
        'fighting': '#C03028',
        'combat': '#C03028',
        'poison': '#A040A0',
        'ground': '#E0C068',
        'sol': '#E0C068',
        'flying': '#A890F0',
        'vol': '#A890F0',
        'psychic': '#F85888',
        'psy': '#F85888',
        'bug': '#A8B820',
        'insecte': '#A8B820',
        'rock': '#B8A038',
        'roche': '#B8A038',
        'ghost': '#705898',
        'spectre': '#705898',
        'dragon': '#7038F8',
        'dark': '#705848',
        'tenebres': '#705848',
        'steel': '#B8B8D0',
        'acier': '#B8B8D0',
        'fairy': '#EE99AC',
        'fee': '#EE99AC',
        'stellar': '#40B5A5',
        'stellaire': '#40B5A5'
    };

    /**
     * Retourne la couleur hex d'un type
     * @param {string} type 
     * @returns {string}
     */
    function getTypeColor(type) {
        const lower = type?.toLowerCase().trim() || '';
        return typeColors[lower] || '#A8A878';
    }

    return {
        normalize,
        formatDate,
        translateType,
        getTypeClass,
        getTypeColor
    };
})();