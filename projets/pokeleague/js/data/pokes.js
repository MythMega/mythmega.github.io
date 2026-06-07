/**
 * Module de chargement et recherche des Pokémon
 * Utilise le fichier pokes.json pour les sprites et les types
 */

const Pokes = (() => {
    let pokesCache = null;

    /**
     * Charge la base de données des Pokémon
     * @returns {Promise<Array<Object>>}
     */
    async function loadPokes() {
        if (pokesCache) return pokesCache;
        const response = await fetch('assets/data/pokes.json');
        pokesCache = await response.json();
        return pokesCache;
    }

    /**
     * Normalise un texte (sans accents, sans casse, sans caractères spéciaux)
     * @param {string} text 
     * @returns {string}
     */
    function normalize(text) {
        return text
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '') // Supprime les accents
            .replace(/[^a-zA-Z0-9]/g, '')    // Supprime les caractères non alphanumériques
            .toLowerCase();
    }

    /**
     * Recherche un Pokémon par son nom (français ou anglais, insensible à la casse et aux accents)
     * @param {string} name - Nom du Pokémon à chercher
     * @returns {Promise<Object|null>} - Le Pokémon trouvé ou null
     */
    async function findPoke(name) {
        const pokes = await loadPokes();
        const normalizedSearch = normalize(name);

        return pokes.find(p => 
            normalize(p.Name_FR) === normalizedSearch || 
            normalize(p.Name_EN) === normalizedSearch
        ) || null;
    }

    /**
     * Recherche floue : trouve un Pokémon même si le nom n'est pas exact
     * (utile si orthographe légèrement différente dans le spreadsheet)
     * @param {string} name 
     * @returns {Promise<Object|null>}
     */
    async function findPokeFuzzy(name) {
        const pokes = await loadPokes();
        const normalizedSearch = normalize(name);

        // D'abord recherche exacte
        let found = pokes.find(p => 
            normalize(p.Name_FR) === normalizedSearch || 
            normalize(p.Name_EN) === normalizedSearch
        );
        if (found) return found;

        // Recherche floue : le nom cherché est contenu dans un nom de Pokémon
        found = pokes.find(p => 
            normalize(p.Name_FR).includes(normalizedSearch) || 
            normalize(p.Name_EN).includes(normalizedSearch) ||
            normalizedSearch.includes(normalize(p.Name_FR)) ||
            normalizedSearch.includes(normalize(p.Name_EN))
        );
        return found || null;
    }

    return {
        loadPokes,
        findPoke,
        findPokeFuzzy
    };
})();