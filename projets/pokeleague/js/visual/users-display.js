/**
 * Module d'affichage pour les utilisateurs/challengers
 */

const UsersDisplay = (() => {
    let allUsers = [];

    /**
     * Initialise la page de recherche utilisateurs (users.html)
     */
    async function initSearch() {
        const searchInput = document.getElementById('user-search');
        const resultsList = document.getElementById('results-list');
        const searchBtn = document.getElementById('search-btn');

        if (!searchInput) return;

        try {
            const users = await Users.getAllUsers();
            allUsers = users;
        } catch (error) {
            if (resultsList) {
                resultsList.innerHTML = `<div class="error-state">Erreur de chargement : ${error.message}</div>`;
            }
            return;
        }

        async function performSearch() {
            const query = searchInput.value.trim();
            let results;
            
            if (!query) {
                results = allUsers;
            } else {
                results = await Users.searchUsers(query);
            }

            if (resultsList) {
                renderResults(results, resultsList);
            }
        }

        searchInput.addEventListener('input', performSearch);
        if (searchBtn) {
            searchBtn.addEventListener('click', performSearch);
        }

        performSearch();
    }

    /**
     * Affiche les résultats de recherche
     */
    function renderResults(users, container) {
        if (users.length === 0) {
            container.innerHTML = '<div class="empty-state">Aucun utilisateur trouvé</div>';
            return;
        }

        container.innerHTML = '';
        users.forEach(user => {
            const card = document.createElement('a');
            card.className = 'user-card';
            card.href = `user.html?id=${encodeURIComponent(user.page)}`;

            card.innerHTML = `
                <div class="user-card-avatar">
                    <img src="${user.avatar || 'https://via.placeholder.com/60'}" 
                         alt="${user.page}"
                         loading="lazy"
                         onerror="this.src='https://via.placeholder.com/60'">
                </div>
                <div class="user-card-info">
                    <div class="user-card-name">${user.page}</div>
                </div>
                <div class="user-card-arrow">→</div>
            `;

            container.appendChild(card);
        });
    }

    /**
     * Vérifie si un match a toutes les informations nécessaires pour être considéré
     * @param {Object} match 
     * @returns {boolean}
     */
    function isValidMatch(match) {
        return match.date && match.date.trim() !== '' &&
               match.adversaire && match.adversaire.trim() !== '' &&
               match.resultat && match.resultat.trim() !== '';
    }

    /**
     * Affiche les matchs d'un utilisateur (user.html) avec gestion des badges
     */
    async function renderMatches() {
        const container = document.getElementById('matches-container');
        if (!container) return;

        const params = new URLSearchParams(window.location.search);
        const userName = params.get('id');

        if (!userName) {
            container.innerHTML = '<div class="error-state">Aucun utilisateur spécifié</div>';
            return;
        }

        container.innerHTML = '<div class="loading">Chargement des matchs...</div>';

        try {
            const { user, matches } = await Users.getUserMatches(userName);
            // Filtrer les matchs invalides (sans adversaire ou sans résultat)
            const validMatches = matches.filter(m => isValidMatch(m));
            // Charger la liste des champions
            const champions = await Champions.getAllChampions();

            if (!user) {
                container.innerHTML = '<div class="error-state">Utilisateur non trouvé</div>';
                return;
            }

            // Vider le contenu (loading)
            container.innerHTML = '';

            // ---- En-tête avec badges ----
            const header = document.createElement('div');
            header.className = 'user-header';

            // Déterminer quels badges sont débloqués
            const badgesStatus = computeBadgesStatus(validMatches, champions);

            const badgesHTML = champions.filter(c => c.badge_icon).map(c => {
                const isUnlocked = badgesStatus.unlocked.has(c.champion);
                return `
                    <div class="badge-item">
                        <a href="champion.html?id=${encodeURIComponent(c.champion)}" style="text-decoration:none; color:inherit;">
                            <img src="${c.badge_icon}" 
                                 alt="Badge ${c.champion}" 
                                 class="badge-icon ${isUnlocked ? 'badge-unlocked' : 'badge-locked'}"
                                 title="${isUnlocked ? '✓ Badge obtenu' : 'Badge non obtenu'} : ${c.champion}"
                                 onerror="this.style.display='none'">
                            <span class="badge-item-label">${c.champion}</span>
                        </a>
                    </div>
                `;
            }).join('');

            header.innerHTML = `
                <div class="user-header-avatar">
                    <img src="${user.avatar || 'https://via.placeholder.com/100'}" 
                         alt="${user.page}"
                         onerror="this.src='https://via.placeholder.com/100'">
                </div>
                <div class="user-header-info">
                    <h1>${user.page}</h1>
                    <span class="user-match-count">${validMatches.length} match${validMatches.length > 1 ? 's' : ''}</span>
                    ${champions.filter(c => c.badge_icon).length > 0 ? `
                        <div class="badge-count">
                            🏅 ${badgesStatus.unlocked.size} / ${badgesStatus.total} badges obtenus
                        </div>
                        <div class="badges-container">
                            ${badgesHTML}
                        </div>
                    ` : ''}
                </div>
            `;
            container.appendChild(header);

            // ---- Liste des matchs ----
            if (validMatches.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'empty-state';
                empty.textContent = 'Aucun match enregistré';
                container.appendChild(empty);
                return;
            }

            const matchList = document.createElement('div');
            matchList.className = 'match-list';

            // Trier par date (du plus récent au plus ancien)
            // Construire un Set des noms de champions normalisés pour détection
            const championNamesSet = new Set(champions.map(c => Utils.normalize(c.champion)));

            const sortedMatches = [...validMatches].sort((a, b) => {
                const [da, ma, ya] = a.date.split('/');
                const [db, mb, yb] = b.date.split('/');
                return new Date(yb, mb - 1, db) - new Date(ya, ma - 1, da);
            });

            sortedMatches.forEach(match => {
                const matchCard = document.createElement('div');
                
                const isVictory = match.resultat?.toLowerCase() === 'victoire';
                const isChallenge = match.challenge?.toLowerCase() === 'true';
                const resultClass = isVictory ? 'result-victory' : 'result-defeat';
                const resultIcon = isVictory ? '✅' : '❌';

                // Construire le lien : si c'est un match challenge et que l'adversaire est un champion → champion, sinon → user
                const advNormalized = Utils.normalize(match.adversaire);
                const isChampion = championNamesSet.has(advNormalized);
                const opponentLink = (isChallenge && isChampion)
                    ? `champion.html?id=${encodeURIComponent(match.adversaire)}`
                    : `user.html?id=${encodeURIComponent(match.adversaire)}`;

                // Si c'est un match challenge, ajouter la classe visuelle
                if (isChallenge) {
                    matchCard.className = 'match-card challenge-match';
                } else {
                    matchCard.className = 'match-card';
                }

                matchCard.innerHTML = `
                    <div class="match-date">${Utils.formatDate(match.date)}</div>
                    <div class="match-opponent">
                        <span class="match-vs">VS</span>
                        <a href="${opponentLink}" class="match-opponent-name">${match.adversaire}</a>
                        ${isChallenge ? '<span class="challenge-tag">CHALLENGE</span>' : ''}
                    </div>
                    <div class="match-result ${resultClass}">
                        ${resultIcon} ${match.resultat}
                    </div>
                `;

                matchList.appendChild(matchCard);
            });

            container.appendChild(matchList);

        } catch (error) {
            container.innerHTML = `<div class="error-state">Erreur : ${error.message}</div>`;
        }
    }

    /**
     * Calcule le statut des badges : vérifie quels champions ont été battus en match challenge
     * @param {Array} matches - Liste des matchs du joueur
     * @param {Array} champions - Liste des champions
     * @returns {{ unlocked: Set<string>, total: number }}
     */
    function computeBadgesStatus(matches, champions) {
        const unlocked = new Set();
        
        // Indexer les champions par nom normalisé
        const championIndex = {};
        champions.forEach(c => {
            const normalized = Utils.normalize(c.champion);
            championIndex[normalized] = c;
        });

        // Parcourir les matchs challenge gagnés
        matches.forEach(match => {
            const isChallenge = match.challenge?.toLowerCase() === 'true';
            const isVictory = match.resultat?.toLowerCase() === 'victoire';
            
            if (isChallenge && isVictory && match.adversaire) {
                const advNormalized = Utils.normalize(match.adversaire);
                // Vérifier si l'adversaire est un champion
                if (championIndex[advNormalized]) {
                    unlocked.add(championIndex[advNormalized].champion);
                }
            }
        });

        // Compter le nombre total de champions qui ont un badge_icon
        const total = champions.filter(c => c.badge_icon).length;

        return { unlocked, total };
    }

    return {
        initSearch,
        renderMatches
    };
})();