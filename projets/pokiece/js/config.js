/**
 * ===================================
 * Config.js - Logique de configuration de partie
 * Gère la sélection des paramètres (nombre de pokémons, filtrage par séries)
 * ===================================
 */

// === Variables globales ===
let allPokemons = []; // Liste complète des Pokémons
let availableSeries = []; // Séries disponibles
let availableTypes = []; // Types disponibles
let selectedSeries = new Set(); // Séries sélectionnées par l'utilisateur
let selectedTypes = new Set(); // Types sélectionnés par l'utilisateur
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
 * "Mega" est toujours déplacé à la fin
 * @returns {Array<string>} Tableau des séries uniques dans l'ordre du JSON (Mega à la fin)
 */
function extractAvailableSeries(pokemons) {
    console.log('🔍 Extraction des séries disponibles');
    
    const seriesArray = [];
    const seenSeries = new Set();
    let megaSerie = null;
    
    // Parcourir dans l'ordre et garder uniquement les premières occurrences
    pokemons.forEach(pokemon => {
        if (pokemon.Serie && !seenSeries.has(pokemon.Serie)) {
            if (pokemon.Serie === 'Mega') {
                // Sauvegarder "Mega" pour l'ajouter à la fin
                megaSerie = pokemon.Serie;
            } else {
                seriesArray.push(pokemon.Serie);
            }
            seenSeries.add(pokemon.Serie);
        }
    });
    
    // Ajouter "Mega" à la fin si elle existe
    if (megaSerie) {
        seriesArray.push(megaSerie);
    }
    
    console.log(`✅ ${seriesArray.length} séries trouvées:`, seriesArray.join(', '));
    
    return seriesArray;
}

/**
 * Extrait tous les types disponibles uniques (dans l'ordre d'apparition)
 * @returns {Array<string>} Tableau des types uniques dans l'ordre du JSON
 */
function extractAvailableTypes(pokemons) {
    console.log('🔍 Extraction des types disponibles');
    
    const typesArray = [];
    const seenTypes = new Set();
    
    // Parcourir tous les pokémons et extraire les types uniques
    pokemons.forEach(pokemon => {
        if (pokemon.Types && Array.isArray(pokemon.Types)) {
            pokemon.Types.forEach(type => {
                if (type && !seenTypes.has(type)) {
                    typesArray.push(type);
                    seenTypes.add(type);
                }
            });
        }
    });
    
    console.log(`✅ ${typesArray.length} types trouvés:`, typesArray.join(', '));
    
    return typesArray;
}

/**
 * Ajoute les boutons de contrôle (Select All, Deselect All, Toggle) à un conteneur
 * @param {string} containerId - ID du conteneur
 * @param {string} updateFunctionName - Nom de la fonction à appeler après un changement
 */
function addToggleButtons(containerId, updateFunctionName) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    // Créer le conteneur des boutons (dans une div séparée)
    const buttonsDiv = document.createElement('div');
    buttonsDiv.className = 'toggle-buttons-container';
    buttonsDiv.style.display = 'flex';
    buttonsDiv.style.gap = '8px';
    buttonsDiv.style.flexWrap = 'wrap';
    buttonsDiv.style.marginTop = '16px';
    buttonsDiv.style.paddingTop = '12px';
    buttonsDiv.style.borderTop = '1px solid var(--border-color)';
    
    // Créer les trois boutons
    const selectAllBtn = document.createElement('button');
    selectAllBtn.type = 'button';
    selectAllBtn.textContent = getTranslation('selectAll') || 'Select All';
    selectAllBtn.className = 'btn btn-toggle';
    selectAllBtn.addEventListener('click', () => {
        // Chercher toutes les checkboxes dans la div des checkboxes
        const checkboxesDivId = containerId === 'seriesContainer' ? 'seriesCheckboxesDiv' : 'typesCheckboxesDiv';
        const checkboxesDiv = document.getElementById(checkboxesDivId);
        if (checkboxesDiv) {
            const checkboxes = checkboxesDiv.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(cb => cb.checked = true);
        }
        if (window[updateFunctionName]) window[updateFunctionName]();
    });
    
    const deselectAllBtn = document.createElement('button');
    deselectAllBtn.type = 'button';
    deselectAllBtn.textContent = getTranslation('deselectAll') || 'Deselect All';
    deselectAllBtn.className = 'btn btn-toggle';
    deselectAllBtn.addEventListener('click', () => {
        const checkboxesDivId = containerId === 'seriesContainer' ? 'seriesCheckboxesDiv' : 'typesCheckboxesDiv';
        const checkboxesDiv = document.getElementById(checkboxesDivId);
        if (checkboxesDiv) {
            const checkboxes = checkboxesDiv.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(cb => cb.checked = false);
        }
        if (window[updateFunctionName]) window[updateFunctionName]();
    });
    
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.textContent = getTranslation('toggleAll') || 'Toggle All';
    toggleBtn.className = 'btn btn-toggle';
    toggleBtn.addEventListener('click', () => {
        const checkboxesDivId = containerId === 'seriesContainer' ? 'seriesCheckboxesDiv' : 'typesCheckboxesDiv';
        const checkboxesDiv = document.getElementById(checkboxesDivId);
        if (checkboxesDiv) {
            const checkboxes = checkboxesDiv.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(cb => cb.checked = !cb.checked);
        }
        if (window[updateFunctionName]) window[updateFunctionName]();
    });
    
    // Ajouter les boutons au conteneur
    buttonsDiv.appendChild(selectAllBtn);
    buttonsDiv.appendChild(deselectAllBtn);
    buttonsDiv.appendChild(toggleBtn);
    
    container.appendChild(buttonsDiv);
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
    
    // Créer une div pour les checkboxes (layout flexible horizontal)
    const checkboxesDiv = document.createElement('div');
    checkboxesDiv.id = 'seriesCheckboxesDiv';
    checkboxesDiv.style.display = 'flex';
    checkboxesDiv.style.flexWrap = 'wrap';
    checkboxesDiv.style.gap = '16px';
    checkboxesDiv.style.marginBottom = '20px';
    
    availableSeries.forEach(serie => {
        // Créer une paire checkbox + label
        const pair = document.createElement('div');
        pair.style.display = 'flex';
        pair.style.alignItems = 'center';
        pair.style.gap = '8px';
        
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
        
        // Créer le label avec le texte
        const label = document.createElement('label');
        label.htmlFor = `series-${serie}`;
        label.textContent = serie;
        label.style.margin = '0';
        
        pair.appendChild(checkbox);
        pair.appendChild(label);
        checkboxesDiv.appendChild(pair);
    });
    
    seriesContainer.appendChild(checkboxesDiv);
    
    // Initialiser les séries sélectionnées avec toutes cochées par défaut
    availableSeries.forEach(serie => {
        selectedSeries.add(serie);
    });
    
    console.log(`✅ ${availableSeries.length} séries affichées (toutes cochées par défaut)`);
    
    // Ajouter les boutons de toggle
    addToggleButtons('seriesContainer', 'updateSelectedSeries');
}

/**
 * Initialise l'interface de sélection des types
 */
function initTypeCheckboxes() {
    console.log('⚙️ Initialisation des cases à cocher pour les types');
    
    const typesContainer = document.getElementById('typesContainer');
    if (!typesContainer) {
        console.error('❌ Conteneur des types non trouvé');
        return;
    }
    
    typesContainer.innerHTML = '';
    
    // Créer une div pour les checkboxes (layout flexible horizontal)
    const checkboxesDiv = document.createElement('div');
    checkboxesDiv.id = 'typesCheckboxesDiv';
    checkboxesDiv.style.display = 'flex';
    checkboxesDiv.style.flexWrap = 'wrap';
    checkboxesDiv.style.gap = '16px';
    checkboxesDiv.style.marginBottom = '20px';
    
    availableTypes.forEach(type => {
        // Créer une paire checkbox + label
        const pair = document.createElement('div');
        pair.style.display = 'flex';
        pair.style.alignItems = 'center';
        pair.style.gap = '8px';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'series-checkbox'; // Réutiliser le style des séries
        checkbox.value = type;
        checkbox.id = `type-${type}`;
        
        // Cocher par défaut
        checkbox.checked = true;
        
        // Ajouter événement de changement
        checkbox.addEventListener('change', function() {
            console.log(`✓ Checkbox type changé: ${type}`);
            updateSelectedTypes();
        });
        
        // Créer le label avec le texte traduit ou capitalisé
        const label = document.createElement('label');
        label.htmlFor = `type-${type}`;
        // Récupérer la traduction du nom du type avec la bonne casse (capitaliser la première lettre)
        const capitalizedType = type.charAt(0).toUpperCase() + type.slice(1);
        label.textContent = getTranslation(`typesNames.${capitalizedType}`) || capitalizedType;
        label.style.margin = '0';
        
        pair.appendChild(checkbox);
        pair.appendChild(label);
        checkboxesDiv.appendChild(pair);
    });
    
    typesContainer.appendChild(checkboxesDiv);
    
    // Initialiser les types sélectionnés avec tous cochés par défaut
    availableTypes.forEach(type => {
        selectedTypes.add(type);
    });
    
    console.log(`✅ ${availableTypes.length} types affichés (tous cochés par défaut)`);
    
    // Ajouter les boutons de toggle
    addToggleButtons('typesContainer', 'updateSelectedTypes');
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
 * Met à jour la liste des types sélectionnés et filtre les pokémons
 */
function updateSelectedTypes() {
    console.log('🔄 Mise à jour des types sélectionnés');
    
    selectedTypes.clear();
    
    const checkboxes = document.querySelectorAll('#typesContainer input.series-checkbox:checked');
    checkboxes.forEach(checkbox => {
        selectedTypes.add(checkbox.value);
    });
    
    console.log(`✅ ${selectedTypes.size} types sélectionnés:`, Array.from(selectedTypes).join(', '));
    
    // Filtrer les pokémons
    applyFilters();
}

/**
 * Applique les filtres (séries et types) sur la liste des pokémons
 */
function applyFilters() {
    console.log('🔍 Application des filtres');
    
    filteredPokemons = allPokemons.filter(pokemon => {
        if (pokemon.Index <= 0) {
            return false;
        }
        
        // Filtre séries : si aucune série sélectionnée, accepte tous les pokémons
        let serieOK = true;
        if (selectedSeries.size > 0) {
            serieOK = selectedSeries.has(pokemon.Serie);
        }
        
        // Filtre types : si aucun type sélectionné, accepte tous les pokémons
        // Sinon, accepte si le pokémon a au moins un des types sélectionnés
        let typeOK = true;
        if (selectedTypes.size > 0) {
            typeOK = pokemon.Types && pokemon.Types.some(type => selectedTypes.has(type));
        }
        
        return serieOK && typeOK;
    });
    
    console.log(`✅ ${filteredPokemons.length} pokémons après filtrage`);
    
    // Vérifier s'il y a assez de pokémons et les paramètres valides
    checkValidParameters();
}

/**
 * Vérifie la validité des paramètres (séries et types sélectionnés) et le nombre de pokémons
 */
function checkValidParameters() {
    console.log('🔍 Vérification des paramètres valides');
    
    const countSelect = document.getElementById('pokemonCountSelect');
    const requiredCount = parseInt(countSelect.value);
    const errorDiv = document.getElementById('parametersWarning');
    const errorText = document.getElementById('parametersErrorText');
    const createBtn = document.getElementById('createBtn');
    
    // ÉTAPE 1: Vérifier que au moins une série OU un type est sélectionné
    const missingCriteria = [];
    if (selectedSeries.size === 0) {
        missingCriteria.push(getTranslation('series') || 'Série');
    }
    if (selectedTypes.size === 0) {
        missingCriteria.push(getTranslation('types') || 'Type');
    }
    
    // Si aucune série ET aucun type sélectionnés
    if (missingCriteria.length > 0) {
        console.warn(`⚠️ Paramètres invalides: ${missingCriteria.join(', ')}`);
        errorDiv.style.display = 'block';
        errorText.textContent = (getTranslation('invalidParams') || 'Paramètres invalides') + ': ' + missingCriteria.join(', ');
        errorText.className = 'error-text';
        createBtn.disabled = true;
        createBtn.style.opacity = '0.5';
        createBtn.style.cursor = 'not-allowed';
        return;
    }
    
    // ÉTAPE 2: Si paramètres OK, vérifier le nombre de pokémons disponibles
    if (filteredPokemons.length < requiredCount) {
        console.warn(`⚠️ Pas assez de pokémons: ${filteredPokemons.length}/${requiredCount}`);
        errorDiv.style.display = 'block';
        errorText.textContent = getTranslation('notEnoughPokemons') || `Pas assez de Pokémons disponibles: ${filteredPokemons.length}/${requiredCount}`;
        errorText.className = 'error-text';
        createBtn.disabled = true;
        createBtn.style.opacity = '0.5';
        createBtn.style.cursor = 'not-allowed';
    } else {
        console.log(`✅ Paramètres valides: ${filteredPokemons.length}/${requiredCount}`);
        errorDiv.style.display = 'none';
        createBtn.disabled = false;
        createBtn.style.opacity = '1';
        createBtn.style.cursor = 'pointer';
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
        checkValidParameters();
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
        
        // 2b. Extraire les types
        console.log('🌥️  Étape 2b: Extraction des types');
        availableTypes = extractAvailableTypes(allPokemons);
        
        // 3. Initialiser l'interface
        console.log('🌥️  Étape 3: Initialisation de l\'interface');
        initPokemonCountSelect();
        initSeriesCheckboxes();
        initTypeCheckboxes();
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
 * Attend que les traductions soient chargées (avec timeout)
 * @param {number} timeout - Timeout en millisecondes
 * @returns {Promise<void>}
 */
async function waitForTranslations(timeout = 5000) {
    return new Promise((resolve, reject) => {
        if (window.TRANSLATIONS && window.TRANSLATIONS.FR && window.TRANSLATIONS.EN) {
            console.log('✅ Traductions déjà chargées');
            resolve();
            return;
        }
        
        const startTime = Date.now();
        const checkInterval = setInterval(() => {
            if (window.TRANSLATIONS && window.TRANSLATIONS.FR && window.TRANSLATIONS.EN) {
                clearInterval(checkInterval);
                console.log('✅ Traductions chargées (après attente)');
                resolve();
            } else if (Date.now() - startTime > timeout) {
                clearInterval(checkInterval);
                console.warn('⚠️ Timeout en attendant les traductions');
                reject(new Error('Timeout en attendant les traductions'));
            }
        }, 100);
    });
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
            
            // Attendre que les traductions soient chargées
            try {
                await waitForTranslations(5000);
            } catch (error) {
                console.warn('⚠️ Les traductions n\'ont pas pu être chargées à temps, continuant quand même...');
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
    
    // Attendre que les traductions soient chargées
    checkAndInit();
});
