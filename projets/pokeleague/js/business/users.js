/**
 * Module métier pour la gestion des utilisateurs/challengers
 */

const Users = (() => {
    /**
     * Récupère la liste de tous les utilisateurs
     * @returns {Promise<Array<Object>>}
     */
    async function getAllUsers() {
        return await Spreadsheet.loadUsers();
    }

    /**
     * Récupère les matchs d'un utilisateur
     * @param {string} userName - Nom de l'utilisateur
     * @returns {Promise<{user: Object|null, matches: Array<Object>}>}
     */
    async function getUserMatches(userName) {
        const users = await getAllUsers();
        const normalized = Utils.normalize(userName);
        const user = users.find(u => Utils.normalize(u.page) === normalized) || null;
        
        if (!user) {
            return { user: null, matches: [] };
        }

        const matches = await Spreadsheet.loadUserMatches(user.url);
        return { user, matches };
    }

    /**
     * Recherche des utilisateurs par nom (insensible à la casse et aux accents)
     * @param {string} query - Terme de recherche
     * @returns {Promise<Array<Object>>}
     */
    async function searchUsers(query) {
        const users = await getAllUsers();
        if (!query || !query.trim()) return users;
        
        const normalized = Utils.normalize(query);
        return users.filter(u => Utils.normalize(u.page).includes(normalized));
    }

    return {
        getAllUsers,
        getUserMatches,
        searchUsers
    };
})();