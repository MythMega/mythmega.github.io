/**
 * Module métier pour la gestion des champions
 */

const Champions = (() => {
    /**
     * Récupère tous les champions avec leurs données complètes
     * @returns {Promise<Array<Object>>}
     */
    async function getAllChampions() {
        const champions = await Spreadsheet.loadChampions();
        return champions.map(c => ({
            ...c,
            // S'assurer que les champs poke_1 à poke_6 sont traités
            team: getTeam(c)
        }));
    }

    /**
     * Récupère les Pokémon d'un champion
     * @param {Object} champion 
     * @returns {Array<string>} - Liste des noms de Pokémon non vides
     */
    function getTeam(champion) {
        const team = [];
        for (let i = 1; i <= 6; i++) {
            const poke = champion[`poke_${i}`];
            if (poke && poke.trim()) {
                team.push(poke.trim());
            }
        }
        return team;
    }

    /**
     * Trouve un champion par son nom
     * @param {string} name 
     * @returns {Promise<Object|null>}
     */
    async function findChampion(name) {
        const champions = await getAllChampions();
        const normalized = Utils.normalize(name);
        return champions.find(c => Utils.normalize(c.champion) === normalized) || null;
    }

    return {
        getAllChampions,
        getTeam,
        findChampion
    };
})();