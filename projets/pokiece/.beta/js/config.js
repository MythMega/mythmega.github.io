/**
 * ===================================
 * Config.js - Logique de configuration de partie
 * Gère la sélection des paramètres (nombre de pokémons, filtrage par séries)
 * ===================================
 */

// === Variables globales ===
let allPokemons = []; // Liste complète des Pokémons
let availableSeries = []; // Séries disponibles
let selectedSeries = new Set(); // Séries sélectionnées par l'utilisateur
let filteredPokemons = []; // Pokémons filtrés selon critères

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
 * Extrait toutes les séries disponibles uniques (dans l'ordre d'apparition)
 * @returns {Array<string>} Tableau des séries uniques dans l'ordre du JSON
 */
function extractAvailableSeries(pokemons) {
    console.log('🔍 Extraction des séries disponibles');
    
    const seriesArray = [];
    const seenSeries = new Set();
    
    // Parcourir dans l'ordre et garder uniquement les premières occurrences
    pokemons.forEach(pokemon => {
        if (pokemon.Serie && !seenSeries.has(pokemon.Serie)) {
            seriesArray.push(pokemon.Serie);
            seenSeries.add(pokemon.Serie);
        }
    });
    
    console.log(`✅ ${seriesArray.length} séries trouvées:`, seriesArray.join(', '));
    
    return seriesArray;
}

/**
 * Initialise l'interface de sélection des séries
 */
function initSeriesCheckboxes() {
    console.log('⚙️ Initialisation des cases à cocher pour les séries');
    
    const seriesContainer = document.getElementById('seriesContainer');
    if (!seriesContainer) {
        console.error('❌ Conteneur des séries non trouvé');
        return;
    }
    
    seriesContainer.innerHTML = '';
    
    availableSeries.forEach(serie => {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'series-checkbox';
        checkbox.value = serie;
        checkbox.id = `series-${serie}`;
        
        // Cocher par défaut
        checkbox.checked = true;
        
        // Ajouter événement de changement
        checkbox.addEventListener('change', function() {
            console.log(`✓ Checkbox changé: ${serie}`);
            updateSelectedSeries();
        });
        
        seriesContainer.appendChild(checkbox);
        
        // Créer et ajouter le label avec le texte
        const label = document.createElement('label');
        label.htmlFor = `series-${serie}`;
        label.textContent = serie;
        label.style.marginLeft = '8px';
        
        seriesContainer.appendChild(label);
    });
    
    // Initialiser les séries sélectionnées avec toutes cochées par défaut
    availableSeries.forEach(serie => {
        selectedSeries.add(serie);
    });
    
    console.log(`✅ ${availableSeries.length} séries affichées (toutes cochées par défaut)`);
}

/**
 * Met à jour la liste des séries sélectionnées et filtre les pokémons
 */
function updateSelectedSeries() {
    console.log('🔄 Mise à jour des séries sélectionnées');
    
    selectedSeries.clear();
    
    const checkboxes = document.querySelectorAll('.series-checkbox:checked');
    checkboxes.forEach(checkbox => {
        selectedSeries.add(checkbox.value);
    });
    
    console.log(`✅ ${selectedSeries.size} séries sélectionnées:`, Array.from(selectedSeries).join(', '));
    
    // Filtrer les pokémons
    applyFilters();
}

/**
 * Applique les filtres (séries) sur la liste des pokémons
 */
function applyFilters() {
    console.log('🔍 Application des filtres');
    
    // Si aucune série sélectionnée, utiliser tous les pokémons
    if (selectedSeries.size === 0) {
        console.log('ℹ️ Aucune série sélectionnée - utilisation de tous les pokémons');
        filteredPokemons = allPokemons.filter(p => p.Index > 0);
    } else {
        // Filtrer par séries sélectionnées
        filteredPokemons = allPokemons.filter(pokemon => {
            return selectedSeries.has(pokemon.Serie) && pokemon.Index > 0;
        });
    }
    
    console.log(`✅ ${filteredPokemons.length} pokémons après filtrage`);
    
    // Vérifier s'il y a assez de pokémons
    checkAvailablePokemonCount();
}

/**
 * Vérifie s'il y a assez de pokémons disponibles
 */
function checkAvailablePokemonCount() {
    console.log('🔍 Vérification du nombre de pokémons disponibles');
    
    const countSelect = document.getElementById('pokemonCountSelect');
    const requiredCount = parseInt(countSelect.value);
    
    const warningDiv = document.getElementById('seriesWarning');
    const errorText = document.getElementById('seriesErrorText');
    
    if (filteredPokemons.length < requiredCount) {
        console.warn(`⚠️ Pas assez de pokémons: ${filteredPokemons.length}/${requiredCount}`);
        warningDiv.style.display = 'block';
        errorText.textContent = getTranslation('notEnoughPokemons') || `Pas assez de Pokémons disponibles: ${filteredPokemons.length}/${requiredCount}`;
        errorText.className = 'error-text';
    } else {
        console.log(`✅ Assez de pokémons disponibles: ${filteredPokemons.length}/${requiredCount}`);
        warningDiv.style.display = 'none';
    }
}

/**
 * Initialise le sélecteur de nombre de pokémons
 */
function initPokemonCountSelect() {
    console.log('⚙️ Initialisation du sélecteur de nombre');
    
    const countSelect = document.getElementById('pokemonCountSelect');
    const countDisplay = document.getElementById('countDisplay');
    
    countSelect.addEventListener('change', function() {
        const newCount = this.value;
        console.log(`✓ Nombre de pokémons changé: ${newCount}`);
        countDisplay.textContent = newCount;
        checkAvailablePokemonCount();
    });
    
    // Initialiser l'affichage
    countDisplay.textContent = countSelect.value;
}

/**
 * Génère un code de partie basé sur les paramètres
 * @param {number|null} customCount - Nombre personnalisé de pokémons (ou null pour utiliser le sélecteur)
 * @returns {string|null} Code généré ou null si erreur
 */
function generateGameCode(customCount = null) {
    console.log('%c🎮 Génération du code de partie', 'color: #00ffff; font-weight: bold; font-size: 12px');
    
    const countSelect = document.getElementById('pokemonCountSelect');
    const requiredCount = customCount !== null ? customCount : parseInt(countSelect.value);
    
    console.log(`📝 Paramètres:`);
    console.log(`   - Nombre de pokémons: ${requiredCount}`);
    console.log(`   - Séries filtrées: ${selectedSeries.size > 0 ? Array.from(selectedSeries).join(', ') : 'Toutes'}`);
    console.log(`   - Pokémons disponibles: ${filteredPokemons.length}`);
    
    // Vérifier qu'il y a assez de pokémons
    if (filteredPokemons.length < requiredCount) {
        console.error(`❌ Pas assez de pokémons: ${filteredPokemons.length}/${requiredCount}`);
        return null;
    }
    
    // Sélectionner des pokémons aléatoires
    const selectedPokemons = [];
    const indices = new Set();
    
    console.log(`🎲 Sélection aléatoire de ${requiredCount} pokémons...`);
    
    while (selectedPokemons.length < requiredCount) {
        const randomIndex = Math.floor(Math.random() * filteredPokemons.length);
        const pokemon = filteredPokemons[randomIndex];
        
        // Éviter les doublons
        if (!indices.has(pokemon.Index)) {
            selectedPokemons.push(pokemon);
            indices.add(pokemon.Index);
            console.log(`   - Sélectionné: ${pokemon.Name_FR || pokemon.Name_EN} (Index ${pokemon.Index})`);
        }
    }
    
    // Ajouter le paramètre Count au code (format: COUNT:[nombre])
    // On va encoder le nombre au début du code en hexadécimal
    const countHex = requiredCount.toString(16).toUpperCase().padStart(4, '0');
    console.log(`   - Nombre encodé: ${requiredCount} → ${countHex}`);
    
    // Encoder les indices
    const indexArray = Array.from(indices);
    const indicesCode = encodeCode(indexArray);
    
    // Combiner: count + indices
    const fullCode = countHex + indicesCode;
    
    console.log(`🎯 Code complet généré: ${fullCode.substring(0, 20)}...`);
    
    return fullCode;
}

/**
 * Crée la partie et redirige vers game.html
 */
async function createGame() {
    console.log('%c🎮 Création de la partie', 'color: #00ffff; font-weight: bold; font-size: 14px');
    
    try {
        const code = generateGameCode();
        
        if (!code) {
            console.error('❌ Impossible de générer le code');
            showErrorModal('notEnoughPokemons');
            return;
        }
        
        // Construire l'URL de jeu
        const gameURL = buildGameURL(code);
        console.log(`🚀 Redirection vers: ${gameURL}`);
        
        window.location.href = gameURL;
        
    } catch (error) {
        console.error('❌ Erreur lors de la création de la partie:', error);
        showErrorModal('generalError', error.message);
    }
}

/**
 * Génère une partie automatiquement avec le max de pokémons disponibles
 */
async function createGameWithMax() {
    console.log('%c🎮 Création de la partie avec max pokémons', 'color: #00ffff; font-weight: bold; font-size: 14px');
    
    try {
        closeErrorModal();
        
        // Utiliser directement le nombre max de pokémons disponibles
        const maxAvailable = filteredPokemons.length;
        console.log(`📊 Max pokémons disponibles: ${maxAvailable}`);
        
        const code = generateGameCode(maxAvailable);
        
        if (!code) {
            console.error('❌ Impossible de générer le code');
            showErrorModal('generalError', 'Could not generate code with max pokemons');
            return;
        }
        
        // Construire l'URL de jeu
        const gameURL = buildGameURL(code);
        console.log(`🚀 Redirection vers: ${gameURL}`);
        
        window.location.href = gameURL;
        
    } catch (error) {
        console.error('❌ Erreur lors de la création automatique:', error);
        showErrorModal('generalError', error.message);
    }
}

/**
 * Affiche la modal d'erreur
 */
function showErrorModal(errorKey, details = '') {
    console.log(`⚠️ Affichage de la modal d'erreur: ${errorKey}`);
    
    const modal = document.getElementById('errorModal');
    const errorText = document.getElementById('errorText');
    
    let message = getTranslation(errorKey) || errorKey;
    if (details) {
        message += ` (${details})`;
    }
    
    errorText.textContent = message;
    modal.classList.remove('hidden');
}

/**
 * Ferme la modal d'erreur
 */
function closeErrorModal() {
    console.log('✅ Fermeture de la modal d\'erreur');
    const modal = document.getElementById('errorModal');
    modal.classList.add('hidden');
}

/**
 * Initialise les contrôles et événements
 */
function initControls() {
    console.log('⚙️ Initialisation des contrôles');
    
    // Bouton Retour
    const backBtn = document.getElementById('backBtn');
    if (backBtn) {
        backBtn.addEventListener('click', function() {
            console.log('🔙 Bouton Retour cliqué');
            window.location.href = './index.html';
        });
    }
    
    // Bouton Créer partie
    const createBtn = document.getElementById('createBtn');
    if (createBtn) {
        createBtn.addEventListener('click', function() {
            console.log('✅ Bouton Créer partie cliqué');
            createGame();
        });
    }
    
    // Boutons de la modal d'erreur
    const errorRetryBtn = document.getElementById('errorRetryBtn');
    if (errorRetryBtn) {
        errorRetryBtn.addEventListener('click', function() {
            console.log('🔄 Bouton Changer les paramètres cliqué');
            closeErrorModal();
        });
    }
    
    const errorAutoBtn = document.getElementById('errorAutoBtn');
    if (errorAutoBtn) {
        errorAutoBtn.addEventListener('click', function() {
            console.log('⚙️ Bouton Générer avec le max cliqué');
            createGameWithMax();
        });
    }
    
    const errorCloseBtn = document.getElementById('errorCloseBtn');
    if (errorCloseBtn) {
        errorCloseBtn.addEventListener('click', function() {
            console.log('✅ Bouton Annuler cliqué');
            closeErrorModal();
        });
    }
    
    console.log('✅ Contrôles initialisés');
}

/**
 * Initialise la page de configuration
 */
async function initConfig() {
    console.log('%c⚙️ Initialisation de la page de configuration', 'color: #b000ff; font-weight: bold; font-size: 14px');
    console.log('📋 Étapes:');
    console.log('   1. Récupérer les Pokémons');
    console.log('   2. Extraire les séries');
    console.log('   3. Initialiser l\'interface');
    console.log('   4. Initialiser les contrôles');
    console.log('   5. Appliquer les traductions');
    
    try {
        // 1. Récupérer les Pokémons
        console.log('🌥️  Étape 1: Récupération des Pokémons');
        allPokemons = await getPokemonsDatabase();
        
        if (!allPokemons || allPokemons.length === 0) {
            throw new Error(getTranslation('pokemonsLoadingError') || 'Impossible de charger les Pokémons');
        }
        
        // 2. Extraire les séries
        console.log('🌥️  Étape 2: Extraction des séries');
        availableSeries = extractAvailableSeries(allPokemons);
        filteredPokemons = allPokemons.filter(p => p.Index > 0);
        
        // 3. Initialiser l'interface
        console.log('🌥️  Étape 3: Initialisation de l\'interface');
        initPokemonCountSelect();
        initSeriesCheckboxes();
        applyFilters();
        
        // 4. Initialiser les contrôles
        console.log('🌥️  Étape 4: Initialisation des contrôles');
        initControls();
        
        // 5. Appliquer les traductions
        console.log('🌥️  Étape 5: Application des traductions');
        applyTranslation();
        
        console.log('%c✅ Configuration prête!', 'color: #00ff00; font-weight: bold; font-size: 14px');
        
    } catch (error) {
        console.error('%c❌ Erreur lors de l\'initialisation de la configuration', 'color: #ff0000; font-weight: bold', error);
        showErrorModal('generalError', error.message);
    }
}

/**
 * Initialiser lors du chargement du DOM
 */
document.addEventListener('DOMContentLoaded', function() {
    console.log('%c📄 DOM chargé - Préparation de la configuration', 'color: #b000ff; font-weight: bold');
    
    // Attendre que tout soit prêt
    const checkAndInit = async () => {
        try {
            if (!window.POKEMONS_LOADED) {
                console.log('⏳ Attente du chargement des Pokémons...');
                await waitForPokemons(15000);
            }
            
            console.log('✅ Tous les ressources pré-requises sont chargées');
            
            // Initialiser le dark mode
            initDarkMode();
            
            // Initialiser le bouton de langue
            initLanguageButton();
            
            // Initialiser la configuration
            initConfig();
            
        } catch (error) {
            console.error('❌ Erreur lors de l\'attente des ressources:', error);
            showErrorModal('generalError', error.message);
        }
    };
    
    checkAndInit();
});
