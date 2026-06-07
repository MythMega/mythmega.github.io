/**
 * Module d'affichage pour les champions
 */

const ChampionsDisplay = (() => {
    /**
     * Affiche la liste de tous les champions sur champions.html
     */
    async function renderList() {
        const container = document.getElementById('champions-list');
        if (!container) return;

        container.innerHTML = '<div class="loading">Chargement des champions...</div>';

        try {
            const champions = await Champions.getAllChampions();
            
            if (champions.length === 0) {
                container.innerHTML = '<div class="empty-state">Aucun champion trouvé</div>';
                return;
            }

            container.innerHTML = '';
            champions.forEach(champion => {
                const card = createChampionCard(champion);
                container.appendChild(card);
            });
        } catch (error) {
            container.innerHTML = `<div class="error-state">Erreur : ${error.message}</div>`;
        }
    }

    /**
     * Crée une carte champion pour la liste
     * @param {Object} champion 
     * @returns {HTMLElement}
     */
    function createChampionCard(champion) {
        const card = document.createElement('a');
        card.className = 'champion-card';
        card.href = `champion.html?id=${encodeURIComponent(champion.champion)}`;

        const typeFr = Utils.translateType(champion.type);
        const typeClass = Utils.getTypeClass(champion.type);

        card.innerHTML = `
            <div class="champion-card-avatar">
                <img src="${champion.avatar || 'https://via.placeholder.com/70'}" 
                     alt="${champion.champion}"
                     loading="lazy"
                     onerror="this.src='https://via.placeholder.com/70'">
            </div>
            <div class="champion-card-info">
                <h3 class="champion-card-name">${champion.champion}</h3>
                <div class="champion-card-badge">
                    <span class="type-badge ${typeClass}">${typeFr}</span>
                </div>
                <div class="champion-card-date">
                    Champion depuis le ${Utils.formatDate(champion.date_champion)}
                </div>
                <div class="champion-card-dispo">
                    ${champion.dispo || 'Disponibilité non spécifiée'}
                </div>
            </div>
            <div class="champion-card-arrow">→</div>
        `;

        return card;
    }

    /**
     * Affiche les détails d'un champion sur champion.html
     */
    async function renderDetail() {
        const container = document.getElementById('champion-detail');
        if (!container) return;

        const params = new URLSearchParams(window.location.search);
        const champName = params.get('id');

        if (!champName) {
            container.innerHTML = '<div class="error-state">Aucun champion spécifié</div>';
            return;
        }

        container.innerHTML = '<div class="loading">Chargement...</div>';

        try {
            const champion = await Champions.findChampion(champName);
            
            if (!champion) {
                container.innerHTML = '<div class="error-state">Champion non trouvé</div>';
                return;
            }

            // Vider le contenu (loading) avant d'ajouter le contenu réel
            container.innerHTML = '';

            const typeFr = Utils.translateType(champion.type);
            const typeColor = Utils.getTypeColor(champion.type);

            // En-tête du champion
            const header = document.createElement('div');
            header.className = 'champion-header';
            header.innerHTML = `
                <div class="champion-header-avatar">
                    <img src="${champion.avatar || 'https://via.placeholder.com/150'}" 
                         alt="${champion.champion}"
                         onerror="this.src='https://via.placeholder.com/150'">
                </div>
                <div class="champion-header-info">
                    <h1>${champion.champion}</h1>
                    <div class="champion-header-meta">
                        <span class="type-badge" style="background: ${typeColor}">${typeFr}</span>
                        <span class="champion-date">📅 Champion depuis le ${Utils.formatDate(champion.date_champion)}</span>
                    </div>
                    ${champion.dispo ? `<div class="champion-dispo">🕐 ${champion.dispo}</div>` : ''}
                    ${champion.badge_icon ? `
                        <div class="champion-badge-section">
                            <img src="${champion.badge_icon}" alt="Badge ${champion.champion}" class="champion-badge-icon" onerror="this.style.display='none'">
                            <span>Badge à obtenir</span>
                        </div>
                    ` : ''}
                </div>
            `;
            container.appendChild(header);

            // Section Team
            const teamSection = document.createElement('div');
            teamSection.className = 'team-section';
            teamSection.innerHTML = '<h2>Équipe Pokémon</h2>';
            
            const teamGrid = document.createElement('div');
            teamGrid.className = 'team-grid';

            const team = Champions.getTeam(champion);
            
            if (team.length === 0) {
                teamGrid.innerHTML = '<div class="empty-state">Aucun Pokémon enregistré</div>';
            } else {
                for (const pokeName of team) {
                    const pokeCard = await createPokeCard(pokeName);
                    teamGrid.appendChild(pokeCard);
                }
            }

            teamSection.appendChild(teamGrid);
            container.appendChild(teamSection);

        } catch (error) {
            container.innerHTML = `<div class="error-state">Erreur : ${error.message}</div>`;
        }
    }

    /**
     * Crée une carte Pokémon avec sprite et types
     * @param {string} pokeName - Nom du Pokémon
     * @returns {Promise<HTMLElement>}
     */
    async function createPokeCard(pokeName) {
        const card = document.createElement('div');
        card.className = 'poke-card';

        // Chercher le Pokémon dans la base
        const pokeData = await Pokes.findPokeFuzzy(pokeName);

        let nameDisplay = pokeName;
        let spriteUrl = 'https://via.placeholder.com/96?text=?';
        let typesDisplay = '';

        if (pokeData) {
            nameDisplay = pokeData.Name_FR || pokeData.Name_EN;
            spriteUrl = pokeData.Sprite;

            if (pokeData.Types && pokeData.Types.length > 0) {
                typesDisplay = pokeData.Types.map(t => {
                    const typeFr = Utils.translateType(t);
                    const typeColor = Utils.getTypeColor(t);
                    return `<span class="type-badge" style="background: ${typeColor}">${typeFr}</span>`;
                }).join(' ');
            }
        }

        card.innerHTML = `
            <div class="poke-card-sprite">
                <img src="${spriteUrl}" 
                     alt="${nameDisplay}"
                     loading="lazy"
                     onerror="this.src='https://via.placeholder.com/96?text=?'">
            </div>
            <div class="poke-card-name">${nameDisplay}</div>
            <div class="poke-card-types">${typesDisplay}</div>
        `;

        return card;
    }

    return {
        renderList,
        renderDetail
    };
})();