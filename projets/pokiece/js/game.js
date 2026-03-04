/**
 * ===================================
 * Game.js - Logique principale du jeu
 * Gère l'affichage de la grille et les interactions avec les Pokémons
 * ===================================
 */

// === Variables globales ===
let allPokemons = []; // Liste complète des Pokémons
let gamePokemons = []; // Pokémons sélectionnés pour cette partie
let selectedIndices = []; // Indices des Pokémons sélectionnés
let selectedPokemon = null; // Pokémon actuellement sélectionné

/**
 * Récupère la liste des Pokémons depuis la base de données pré-chargée
 * @returns {Promise<Array>} Promesse résolue avec la liste des Pokémons
 */
async function getPokemonsDatabase() {
    console.log('📥 Récupération de la base de données Pokémons');
    
    // Attendre que les traductions soient chargées
    await waitForPokemons(10000);
    
    if (!window.POKEMONS_DB || window.POKEMONS_DB.length === 0) {
        console.error('❌ La base de données Pokémons est vide!');
        throw new Error('Pokemon database is empty');
    }
    
    console.log(`✅ ${window.POKEMONS_DB.length} Pokémons récupérés depuis la base de données`);
    return window.POKEMONS_DB;
}

/**
 * Obtient un Pokémon par son index
 * @param {number} index - Index du Pokémon
 * @returns {Object|null} Pokémon trouvé ou null
 */
function getPokemonByIndex(index) {
    const pokemon = allPokemons.find(p => p.Index === index);
    
    if (!pokemon) {
        console.warn(`⚠️ Pokémon non trouvé avec l'index: ${index}`);
        return null;
    }
    
    return pokemon;
}

/**
 * Sélectionne les Pokémons pour cette partie
 * @param {number[]} indices - Tableau des indices
 */
function selectGamePokemons(indices) {
    console.log(`🎯 Sélection de ${indices.length} Pokémons`);
    
    gamePokemons = [];
    
    indices.forEach((index, i) => {
        const pokemon = getPokemonByIndex(index);
        if (pokemon) {
            gamePokemons.push(pokemon);
            console.log(`   ${i + 1}. ${pokemon.Name_FR} (Index ${pokemon.Index})`);
        } else {
            console.warn(`⚠️ Pokémon non trouvé pour l'index: ${index}`);
        }
    });
    
    console.log(`✅ ${gamePokemons.length} Pokémons sélectionnés`);
}

/**
 * Crée une carte HTML pour un Pokémon
 * @param {Object} pokemon - Données du Pokémon
 * @param {number} position - Position dans la grille
 * @returns {HTMLElement} Élément de carte
 */
function createPokemonCard(pokemon, position) {
    // Récupérer la langue actuelle
    const lang = getCurrentLanguage();
    const pokemonName = pokemon.getName(lang);
    
    // Créer le conteneur de la carte
    const card = document.createElement('div');
    card.className = 'pokemon-card';
    card.id = `pokemon-${position}`;
    card.dataset.index = pokemon.Index;
    
    // État du Pokémon (shiny, disabled)
    card.dataset.isShiny = 'false';
    card.dataset.isDisabled = 'false';
    
    console.log(`🎨 Création de la carte: ${pokemonName}`);
    
    // --- Bouton Select AU-DESSUS ---
    const selectBtn = document.createElement('button');
    selectBtn.className = 'pokemon-control-btn';
    selectBtn.textContent = '👉 Sélectionner';
    selectBtn.style.width = '100%';
    selectBtn.style.marginBottom = '8px';
    selectBtn.title = 'Select this Pokémon';
    selectBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        console.log(`👉 Sélection: ${pokemonName}`);
        selectPokemon(pokemon);
    });
    card.appendChild(selectBtn);
    
    // --- Sprite du Pokémon (cliquable pour toggle shiny) ---
    const sprite = document.createElement('img');
    sprite.className = 'pokemon-sprite';
    sprite.src = pokemon.Sprite;
    sprite.alt = pokemonName;
    sprite.style.cursor = 'pointer';
    sprite.title = 'Cliquez pour basculer Shiny';
    sprite.onerror = function() {
        console.warn(`⚠️ Erreur de chargement du sprite: ${pokemon.Name_FR}`);
        this.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="50" y="50" dominant-baseline="middle" text-anchor="middle">❌</text></svg>';
    };
    // Clic sur sprite toggle shiny
    sprite.addEventListener('click', function(e) {
        e.stopPropagation();
        console.log(`✨ Toggle shiny (sprite): ${pokemonName}`);
        toggleShiny(card, pokemon);
    });
    card.appendChild(sprite);
    
    // --- Boutons de contrôle (Shiny + Disable) ---
    const controls = document.createElement('div');
    controls.className = 'pokemon-controls';
    
    // Bouton Shiny ON/OFF
    const shinyBtn = document.createElement('button');
    shinyBtn.className = 'pokemon-control-btn';
    shinyBtn.textContent = '✨';
    shinyBtn.title = 'Toggle Shiny';
    shinyBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        console.log(`✨ Toggle shiny (bouton): ${pokemonName}`);
        toggleShiny(card, pokemon);
    });
    controls.appendChild(shinyBtn);
    
    // Bouton Disable
    const disableBtn = document.createElement('button');
    disableBtn.className = 'pokemon-control-btn';
    disableBtn.textContent = '🚫';
    disableBtn.title = 'Toggle Disable';
    disableBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        console.log(`🚫 Toggle disable pour: ${pokemonName}`);
        toggleDisable(card, pokemon);
    });
    controls.appendChild(disableBtn);
    
    card.appendChild(controls);
    
    // --- Informations du Pokémon ---
    const info = document.createElement('div');
    info.className = 'pokemon-info';
    
    // Nom
    const name = document.createElement('div');
    name.className = 'pokemon-name';
    name.textContent = pokemonName;
    info.appendChild(name);
    
    // Types
    const typesContainer = document.createElement('div');
    typesContainer.className = 'pokemon-types';
    
    pokemon.Types.forEach(type => {
        const typeIcon = document.createElement('img');
        typeIcon.className = 'pokemon-type-icon';
        
        // Capitaliser la première lettre du type
        const typeCapitalized = type.charAt(0).toUpperCase() + type.slice(1);
        typeIcon.src = `https://raw.githubusercontent.com/MythMega/PkServData/refs/heads/master/img/sprite/type/icon/teragem/TeraGem_${typeCapitalized}.png`;
        typeIcon.alt = type;
        typeIcon.title = type;
        typeIcon.onerror = function() {
            console.warn(`⚠️ Erreur de chargement de l'icône de type: ${type}`);
        };
        
        typesContainer.appendChild(typeIcon);
        console.log(`   - Type: ${type} → Icon URL chargée`);
    });
    info.appendChild(typesContainer);
    
    // Statistiques
    const stats = document.createElement('div');
    stats.className = 'pokemon-stats';
    
    // Index
    const indexDiv = document.createElement('div');
    indexDiv.className = 'pokemon-index';
    indexDiv.textContent = `#${pokemon.Index}`;
    stats.appendChild(indexDiv);
    
    // Poids et Taille
    const metricsDiv = document.createElement('div');
    metricsDiv.textContent = `${pokemon.Weight} kg • ${pokemon.Height} m`;
    stats.appendChild(metricsDiv);
    
    // Région
    const regionDiv = document.createElement('div');
    regionDiv.className = 'pokemon-region';
    regionDiv.textContent = pokemon.Serie;
    stats.appendChild(regionDiv);
    
    info.appendChild(stats);
    card.appendChild(info);
    
    // --- Clic sur la carte pour toggle disable ---
    card.addEventListener('click', function(e) {
        // Ne pas déclencher si c'est un clic sur un bouton ou le sprite
        if (e.target.tagName === 'BUTTON' || e.target.classList.contains('pokemon-sprite')) {
            return;
        }
        // Clic sur le reste de la carte = toggle disable
        console.log(`🚫 Toggle disable (carte): ${pokemonName}`);
        toggleDisable(card, pokemon);
    });
    
    console.log(`✅ Carte créée pour: ${pokemonName}`);
    
    return card;
}

/**
 * Sélectionne un Pokémon
 * @param {Object} pokemon - Pokémon à sélectionner
 */
function selectPokemon(pokemon) {
    const lang = getCurrentLanguage();
    selectedPokemon = pokemon;
    console.log(`✅ Pokémon sélectionné: ${pokemon.getName(lang)}`);
    
    // Mettre à jour l'affichage
    updateSelectedPokemonDisplay();
}

/**
 * Met à jour l'affichage du Pokémon sélectionné
 */
function updateSelectedPokemonDisplay() {
    if (!selectedPokemon) {
        const display = document.getElementById('selectedPokemonDisplay');
        if (display) {
            display.innerHTML = '<div class="selected-pokemon-empty" data-i18n="selectPokemon">Sélectionner un Pokémon</div>';
            applyTranslation(); // Appliquer traduction sur la nouvelle div
        }
        return;
    }
    
    const lang = getCurrentLanguage();
    const name = selectedPokemon.getName(lang);
    const sprite = selectedPokemon.Sprite;
    
    const display = document.getElementById('selectedPokemonDisplay');
    if (display) {
        display.innerHTML = `
            <img src="${sprite}" alt="${name}" class="selected-pokemon-sprite" />
            <div class="selected-pokemon-name">${name}</div>
        `;
    }
    
    // Mettre à jour le compteur de restants
    const enabledCards = document.querySelectorAll('.pokemon-card:not(.disabled)');
    const remaining = document.getElementById('remainingCount');
    if (remaining) {
        remaining.textContent = enabledCards.length;
    }
}

/**
 * Vérifie s'il ne reste qu'un Pokémon et affiche la popup finale
 */
function checkFinalGuess() {
    const enabledCards = document.querySelectorAll('.pokemon-card:not(.disabled)');
    
    if (enabledCards.length === 1) {
        // Récupérer l'index du dernier Pokémon
        const lastCard = enabledCards[0];
        const index = parseInt(lastCard.dataset.index);
        const pokemon = getPokemonByIndex(index);
        
        if (pokemon) {
            showFinalGuessModal(pokemon);
        }
    }
}

/**
 * Affiche la popup du devinez final
 * @param {Object} pokemon - Pokémon final
 */
function showFinalGuessModal(pokemon) {
    const lang = getCurrentLanguage();
    const name = pokemon.getName(lang);
    const sprite = pokemon.Sprite;
    
    console.log(`🎉 Affichage modal final guess: ${name}`);
    
    // Mettre à jour le contenu de la modal
    const modalName = document.getElementById('modalPokemonName');
    const modalSprite = document.getElementById('modalPokemonSprite');
    
    if (modalName) modalName.textContent = name;
    if (modalSprite) {
        modalSprite.src = sprite;
        modalSprite.alt = name;
    }
    
    // Afficher la modal
    const modal = document.getElementById('finalGuessModal');
    if (modal) {
        modal.classList.remove('hidden');
        console.log(`✅ Modal affichée`);
    }
}

/**
 * Ferme la popup du devinez final
 */
function closeFinalGuessModal() {
    const modal = document.getElementById('finalGuessModal');
    if (modal) {
        modal.classList.add('hidden');
        console.log(`✅ Modal fermée`);
    }
}

/**
 * Bascule l'état shiny d'une carte
 * @param {HTMLElement} card - Élément de la carte
 * @param {Object} pokemon - Données du Pokémon
 */
function toggleShiny(card, pokemon) {
    const isShiny = card.dataset.isShiny === 'true';
    const sprite = card.querySelector('.pokemon-sprite');
    
    if (isShiny) {
        console.log(`   → Passer au sprite normal`);
        card.dataset.isShiny = 'false';
        sprite.src = pokemon.Sprite;
    } else {
        console.log(`   → Passer au sprite shiny`);
        card.dataset.isShiny = 'true';
        sprite.src = pokemon.Sprite_Shiny;
    }
}

/**
 * Met tous les Pokémons en shiny
 */
function toggleAllShiny() {
    console.log('✨ Passage de tous les Pokémons en shiny');
    gamePokemons.forEach((pokemon, i) => {
        const card = document.getElementById(`pokemon-${i}`);
        if (card && card.dataset.isShiny === 'false') {
            toggleShiny(card, pokemon);
        }
    });
    console.log('✅ Tous les Pokémons sont en shiny');
}

/**
 * Met tous les Pokémons en normal
 */
function toggleAllNormal() {
    console.log('Passage de tous les Pokémons en normal');
    gamePokemons.forEach((pokemon, i) => {
        const card = document.getElementById(`pokemon-${i}`);
        if (card && card.dataset.isShiny === 'true') {
            toggleShiny(card, pokemon);
        }
    });
    console.log('✅ Tous les Pokémons sont en normal');
}

/**
 * Active tous les Pokémons
 */
function activateAll() {
    console.log('✓ Activation de tous les Pokémons');
    gamePokemons.forEach((pokemon, i) => {
        const card = document.getElementById(`pokemon-${i}`);
        if (card && card.dataset.isDisabled === 'true') {
            card.dataset.isDisabled = 'false';
            card.classList.remove('disabled');
        }
    });
    // Mettre à jour l'affichage
    updateSelectedPokemonDisplay();
    console.log('✅ Tous les Pokémons sont activés');
}

/**
 * Bascule l'état disabled d'une carte
 * @param {HTMLElement} card - Élément de la carte
 * @param {Object} pokemon - Données du Pokémon
 */
function toggleDisable(card, pokemon) {
    const isDisabled = card.dataset.isDisabled === 'true';
    
    if (isDisabled) {
        console.log(`   → Activer la carte`);
        card.dataset.isDisabled = 'false';
        card.classList.remove('disabled');
    } else {
        console.log(`   → Désactiver la carte`);
        card.dataset.isDisabled = 'true';
        card.classList.add('disabled');
        
        // Vérifier si c'est le dernier Pokémon
        checkFinalGuess();
    }
    
    // Mettre à jour le compteur de restants
    updateSelectedPokemonDisplay();
}

/**
 * Rend la grille de jeu
 */
function renderGameGrid() {
    console.log('%c🎮 Rendu de la grille de jeu', 'color: #00ffff; font-weight: bold; font-size: 12px');
    
    const gameGrid = document.getElementById('gameGrid');
    
    if (!gameGrid) {
        console.error('❌ Élément gameGrid non trouvé');
        return;
    }
    
    // Vider la grille
    gameGrid.innerHTML = '';
    console.log('🧹 Grille vidée');
    
    // Créer une carte pour chaque Pokémon
    gamePokemons.forEach((pokemon, i) => {
        const card = createPokemonCard(pokemon, i);
        gameGrid.appendChild(card);
    });
    
    console.log(`✅ Grille rendue avec ${gamePokemons.length} cartes`);
}

/**
 * Relance le jeu avec de nouveaux Pokémons
 */
function reshuffleGame() {
    console.log('🔄 Relance du jeu');
    
    // Réinitialiser les variables
    selectedPokemon = null;
    selectedIndices = [];
    
    // Générer de nouveaux indices
    const newIndices = [];
    while (newIndices.length < 30) {
        const randomIndex = Math.floor(Math.random() * gamePokemons.length);
        const index = gamePokemons[randomIndex].Index;
        if (!newIndices.includes(index)) {
            newIndices.push(index);
        }
    }
    
    // Réencoder et relancer
    const code = encodeCode(newIndices);
    const gameURL = buildGameURL(code);
    window.location.href = gameURL;
}

/**
 * Met à jour tous les noms des Pokémons après changement de langue
 */
function updateAllPokemonNames() {
    console.log('🌐 Mise à jour des noms des Pokémons');
    
    const lang = getCurrentLanguage();
    
    // Mettre à jour le Pokémon sélectionné affiché
    updateSelectedPokemonDisplay();
    
    // Mettre à jour les noms dans les cartes
    gamePokemons.forEach((pokemon, i) => {
        const card = document.getElementById(`pokemon-${i}`);
        if (card) {
            const nameDiv = card.querySelector('.pokemon-name');
            if (nameDiv) {
                nameDiv.textContent = pokemon.getName(lang);
                console.log(`   ✅ ${pokemon.Index}: ${pokemon.getName(lang)}`);
            }
        }
    });
    
    console.log(`✅ Noms mis à jour (${lang})`);
}
function initGameControls() {
    console.log('⚙️ Initialisation des boutons de contrôle');
    
    // Bouton Home
    const homeBtn = document.getElementById('homeBtn');
    if (homeBtn) {
        homeBtn.addEventListener('click', function() {
            console.log('🏠 Bouton Home cliqué');
            window.location.href = './index.html';
        });
        console.log('✅ Bouton Home configuré');
    }
    
    // Bouton Reshuffle
    const reshuffleBtn = document.getElementById('reshuffleBtn');
    if (reshuffleBtn) {
        reshuffleBtn.addEventListener('click', function() {
            console.log('🔄 Bouton Reshuffle cliqué');
            reshuffleGame();
        });
        console.log('✅ Bouton Reshuffle configuré');
    }
    
    // Bouton Copy Code
    const copyCodeBtn = document.getElementById('copyCodeBtn');
    if (copyCodeBtn) {
        copyCodeBtn.addEventListener('click', function() {
            console.log('📋 Bouton Copy Code cliqué');
            const code = getCodeFromURL();
            
            if (code) {
                const gameURL = buildGameURL(code);
                copyToClipboard(gameURL);
            } else {
                console.warn('⚠️ Aucun code disponible');
            }
        });
        console.log('✅ Bouton Copy Code configuré');
    }
    
    // Bouton Done (Modal Final Guess)
    const doneBtn = document.getElementById('doneBtn');
    if (doneBtn) {
        doneBtn.addEventListener('click', function() {
            console.log('✅ Bouton Done cliqué');
            closeFinalGuessModal();
        });
        console.log('✅ Bouton Done configuré');
    }
    
    // Bouton All Shiny
    const allShinyBtn = document.getElementById('allShinyBtn');
    if (allShinyBtn) {
        allShinyBtn.addEventListener('click', function() {
            console.log('✨ Tous shiny cliqué');
            toggleAllShiny();
        });
        console.log('✅ Bouton All Shiny configuré');
    }
    
    // Bouton All Normal
    const allNormalBtn = document.getElementById('allNormalBtn');
    if (allNormalBtn) {
        allNormalBtn.addEventListener('click', function() {
            console.log('Tous normal cliqué');
            toggleAllNormal();
        });
        console.log('✅ Bouton All Normal configuré');
    }
    
    // Bouton Activate All
    const activateAllBtn = document.getElementById('activateAllBtn');
    if (activateAllBtn) {
        activateAllBtn.addEventListener('click', function() {
            console.log('✓ Activer tous cliqué');
            activateAll();
        });
        console.log('✅ Bouton Activate All configuré');
    }
}

/**
 * Initialise la page du jeu
 */
async function initGame() {
    console.log('%c🎮 Initialisation du jeu', 'color: #00ffff; font-weight: bold; font-size: 14px');
    console.log('📋 Étapes:');
    console.log('   1. Vérifier que les Pokémons sont chargés');
    console.log('   2. Traiter le code d\'URL');
    console.log('   3. Afficher la grille');
    console.log('   4. Initialiser les contrôles');
    
    try {
        // 1. Récupérer la liste des Pokémons (pré-chargée)
        console.log('🌥️  Étape 1: Récupération des Pokémons');
        allPokemons = await getPokemonsDatabase();
        
        if (!allPokemons || allPokemons.length === 0) {
            throw new Error('Aucun Pokémon disponible!');
        }
        
        console.log(`✅ ${allPokemons.length} Pokémons disponibles`);
        
        // 2. Traiter le code d'URL
        console.log('🌥️  Étape 2: Traitement du code');
        const indices = handleGameCode(allPokemons);
        
        if (!indices) {
            console.warn('⚠️ Pas d\'indices - Attente de redirection');
            return;
        }
        
        // 3. Sélectionner les Pokémons pour le jeu
        console.log('🌥️  Étape 3: Sélection des Pokémons');
        selectGamePokemons(indices);
        
        // 4. Afficher la grille
        console.log('🌥️  Étape 4: Rendu de la grille');
        renderGameGrid();
        
        // 5. Initialiser les contrôles
        console.log('🌥️  Étape 5: Initialisation des contrôles');
        initGameControls();
        
        // 6. Appliquer les traductions
        console.log('🌥️  Étape 6: Application des traductions');
        applyTranslation();
        
        console.log('%c✅ Jeu prêt!', 'color: #00ff00; font-weight: bold; font-size: 14px');
        
    } catch (error) {
        console.error('%c❌ Erreur lors de l\'initialisation du jeu', 'color: #ff0000; font-weight: bold', error);
        alert(`Erreur: ${error.message}`);
    }
}

/**
 * Initialiser lors du chargement du DOM
 */
document.addEventListener('DOMContentLoaded', function() {
    console.log('%c📄 DOM chargé - Préparation du jeu', 'color: #b000ff; font-weight: bold');
    
    // Attendre que tout soit prêt
    const checkAndInit = async () => {
        // Attendre que les Pokémons soient chargés
        try {
            if (!window.POKEMONS_LOADED) {
                console.log('⏳ Attente du chargement des Pokémons...');
                await waitForPokemons(15000);
            }
            
            console.log('✅ Tous les ressources pré-requises sont chargées');
            initGame();
            
        } catch (error) {
            console.error('❌ Erreur lors de l\'attente des ressources:', error);
            alert('Erreur: Impossible de charger les Pokémons');
        }
    };
    
    checkAndInit();
});
