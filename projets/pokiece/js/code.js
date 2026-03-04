/**
 * ===================================
 * Code.js - Système d'encodage/décodage des codes de jeu
 * Gère la sérialisation et l'encodage des indices de Pokémons
 * ===================================
 */

/**
 * Récupère les paramètres d'URL
 * @returns {URLSearchParams} Objet contenant les paramètres
 */
function getURLParams() {
    console.log('🔍 Récupération des paramètres d\'URL');
    const params = new URLSearchParams(window.location.search);
    console.log(`✅ Paramètres trouvés: ${params.toString()}`);
    return params;
}

/**
 * Encode une liste d'indices en chaîne courte (Base16/Hex)
 * Format: chaque indice est converti en hexadécimal de 4 caractères
 * @param {number[]} indices - Tableau des indices de Pokémons
 * @returns {string} Code encodé
 */
function encodeCode(indices) {
    console.log(`📝 Encodage des indices: ${indices.join(', ')}`);
    
    // Vérifier que tous les indices sont valides
    if (!Array.isArray(indices) || indices.length === 0) {
        console.error('❌ Tableau d\'indices invalide');
        throw new Error('Invalid indices array');
    }
    
    // Convertir chaque indice en hexadécimal (4 caractères)
    let encoded = indices
        .map(index => {
            const hex = index.toString(16).toUpperCase().padStart(4, '0');
            console.log(`   - Index ${index} → Hex ${hex}`);
            return hex;
        })
        .join('');
    
    console.log(`✅ Code encodé: ${encoded.substring(0, 20)}...`);
    return encoded;
}

/**
 * Décode une chaîne en liste d'indices
 * @param {string} code - Code encodé
 * @returns {number[]} Tableau des indices de Pokémons
 */
function decodeCode(code) {
    console.log(`🔓 Décodage du code: ${code}`);
    
    // Vérifier que le code est une chaîne valide
    if (typeof code !== 'string' || code.length === 0) {
        console.error('❌ Code invalide (non-chaîne ou vide)');
        throw new Error('Invalid code format');
    }
    
    // Le code doit avoir une longueur multiple de 4
    if (code.length % 4 !== 0) {
        console.error(`❌ Longueur du code invalide: ${code.length}`);
        throw new Error('Invalid code length');
    }
    
    // Diviser le code en groupes de 4 caractères
    const groups = code.match(/.{1,4}/g);
    
    if (!groups) {
        console.error('❌ Impossible de diviser le code');
        throw new Error('Cannot split code');
    }
    
    // Convertir chaque groupe de numérique hexadécimal en indice décimal
    let indices = groups.map((hex, i) => {
        const index = parseInt(hex, 16);
        console.log(`   - Hex ${hex} → Index ${index}`);
        
        // Vérifier que l'indice est valide (positif)
        if (isNaN(index) || index < 0) {
            console.error(`❌ Indice invalide: ${index}`);
            throw new Error(`Invalid index: ${index}`);
        }
        
        return index;
    });
    
    console.log(`✅ Code décodé: ${indices.join(', ')}`);
    return indices;
}

/**
 * Obtient le code depuis l'URL
 * @returns {string|null} Code si présent, null sinon
 */
function getCodeFromURL() {
    const params = getURLParams();
    const code = params.get('Code');
    
    if (code) {
        console.log(`🎯 Code trouvé dans l'URL: ${code}`);
        return code.toUpperCase();
    } else {
        console.log('ℹ️ Aucun code n\'a été trouvé dans l\'URL');
        return null;
    }
}

/**
 * Construit l'URL complète du jeu avec un code
 * @param {string} code - Code du jeu
 * @returns {string} URL complète
 */
function buildGameURL(code) {
    console.log(`🔗 Construction de l'URL du jeu avec code: ${code}`);
    // Utiliser l'URL courante sans le paramètre Code
    const baseURL = window.location.origin + window.location.pathname;
    const fullURL = `${baseURL}?Code=${code}`;
    console.log(`✅ URL construite: ${fullURL}`);
    return fullURL;
}

/**
 * Recharge la page du jeu sans paramètre (shuffle)
 */
function reshuffleGame() {
    console.log('🔄 Relancement du jeu (shuffle)');
    const gamePageURL = './game.html';
    console.log(`🚀 Redirection vers: ${gamePageURL}`);
    window.location.href = gamePageURL;
}

/**
 * Valide un code
 * @param {string} code - Code à valider
 * @returns {boolean} True si valide, false sinon
 */
function isValidCode(code) {
    console.log(`🔍 Validation du code: ${code}`);
    
    // Vérifications basiques
    if (typeof code !== 'string' || code.length === 0) {
        console.warn('⚠️ Code invalide (format)');
        return false;
    }
    
    // Doit être hexadécimal et longueur multiple de 4
    if (!code.match(/^[0-9A-F]+$/i) || code.length % 4 !== 0) {
        console.warn('⚠️ Code invalide (format hexadécimal)');
        return false;
    }
    
    // Vérifier que le décodage est possible
    try {
        const indices = decodeCode(code);
        if (indices.length !== 30) {
            console.warn(`⚠️ Nombre d'indices invalide: ${indices.length}`);
            return false;
        }
        console.log('✅ Code valide');
        return true;
    } catch (e) {
        console.error(`❌ Erreur lors du décodage: ${e.message}`);
        return false;
    }
}

/**
 * Gère le flux d'URL lors du chargement de game.html
 * - Sans code: crée un nouveau jeu et recharge avec un code
 * - Avec code: valide et utilise le code
 * @param {Array} pokemonsList - Liste complète des Pokémons
 * @returns {number[]|null} Tableau des indices si valide, null sinon
 */
function handleGameCode(pokemonsList) {
    console.log('%c🎮 Gestion du code de jeu', 'color: #00ffff; font-weight: bold; font-size: 12px');
    
    const code = getCodeFromURL();
    
    if (!code) {
        console.log('📝 Pas de code - Création d\'un nouveau jeu');
        
        // Vérifier que pokemonsList n'est pas vide et contient des Pokemons valides
        if (!pokemonsList || pokemonsList.length === 0) {
            console.error('❌ Liste des Pokémons vide!');
            alert('Erreur: La base de données Pokémons est vide!');
            return null;
        }
        
        console.log(`✅ ${pokemonsList.length} Pokémons disponibles`);
        
        // Filtrer les Pokémons avec un Index valide
        const validPokemons = pokemonsList.filter(p => {
            // Vérifier que c'est une instance Pokemon avec un Index valide
            return (p instanceof Pokemon || (p.Index !== null && p.Index !== undefined)) && 
                   p.Index > 0;
        });
        
        console.log(`✅ ${validPokemons.length} Pokémons valides trouvés`);
        
        if (validPokemons.length < 30) {
            console.error(`❌ Pas assez de Pokémons valides: ${validPokemons.length}/30`);
            alert(`Erreur: Pas assez de Pokémons valides (${validPokemons.length}/30)`);
            return null;
        }
        
        // Sélectionner 30 Pokémons aléatoires
        const selectedPokemons = [];
        const indices = new Set();
        
        console.log('🎲 Sélection aléatoire de 30 Pokémons...');
        
        while (selectedPokemons.length < 30) {
            const randomIndex = Math.floor(Math.random() * validPokemons.length);
            const pokemon = validPokemons[randomIndex];
            
            // Éviter les doublons
            if (!indices.has(pokemon.Index)) {
                selectedPokemons.push(pokemon);
                indices.add(pokemon.Index);
                console.log(`   - Sélectionné: ${pokemon.Name_FR || pokemon.Name_EN} (Index ${pokemon.Index})`);
            }
        }
        
        // Encoder les indices
        const indexArray = Array.from(indices);
        const newCode = encodeCode(indexArray);
        console.log(`🎯 Nouveau code généré: ${newCode}`);
        
        // Recharger la page avec le code
        const gameURL = buildGameURL(newCode);
        console.log(`🚀 Redirection vers: ${gameURL}`);
        window.location.href = gameURL;
        
        return null; // La page se recharge
    } else {
        console.log(`✅ Code trouvé: ${code}`);
        
        // Valider le code
        if (!isValidCode(code)) {
            console.error('❌ Code invalide');
            showToast(getTranslation('invalidCode'));
            alert(getTranslation('invalidCode'));
            
            // Rediriger vers l'accueil
            setTimeout(() => {
                console.log('🚀 Redirection vers l\'accueil');
                window.location.href = './index.html';
            }, 2000);
            
            return null;
        }
        
        // Décoder les indices
        try {
            const indices = decodeCode(code);
            console.log(`✅ Le code a été décodé avec succès: ${indices.join(', ')}`);
            return indices;
        } catch (e) {
            console.error(`❌ Erreur lors du décodage: ${e.message}`);
            alert(getTranslation('invalidCode'));
            
            setTimeout(() => {
                window.location.href = './index.html';
            }, 2000);
            
            return null;
        }
    }
}
