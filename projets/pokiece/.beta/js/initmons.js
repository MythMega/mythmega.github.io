/**
 * ===================================
 * InitMons.js - Initialisation des Pokémons
 * Charge mons.json au démarrage de la page
 * Doit être le premier script à charger
 * ===================================
 */

// === Stockage global des Pokémons ===
window.POKEMONS_DB = [];
window.POKEMONS_LOADED = false;
window.POKEMONS_ERROR = null;

/**
 * Charge la liste complète des Pokémons depuis mons.json
 * @returns {Promise<Array>} Promesse résolue avec la liste des Pokémons
 */
async function loadPokemonsDatabase() {
    console.log('%c📥 Chargement de la base de données Pokémons', 'color: #00ffff; font-weight: bold; font-size: 14px');
    
    try {
        // Fetch le fichier JSON
        const filePath = './data/mons.json';
        const fullPath = new URL(filePath, window.location.href).href;
        console.log('🌥️  Fetch: ' + filePath);
        console.log('   URL complète: ' + fullPath);
        const response = await fetch(filePath);
        
        console.log(`   Status HTTP: ${response.status} ${response.statusText}`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText} pour ${filePath}`);
        }
        
        // Parse le JSON
        console.log('📄 Parsing JSON...');
        const rawData = await response.json();
        
        console.log(`   Type: ${typeof rawData}`);
        console.log(`   Is Array: ${Array.isArray(rawData)}`);
        
        if (!Array.isArray(rawData)) {
            throw new Error('mons.json must contain an array');
        }
        
        console.log(`✅ ${rawData.length} Pokémons bruts chargés`);
        console.log(`   Premiers 3 éléments bruts:`);
        rawData.slice(0, 3).forEach((item, i) => {
            console.log(`      [${i}] Index: ${item.Index}, Name_FR: ${item.Name_FR}, Name_EN: ${item.Name_EN}, Types: ${item.Types?.length || 0}, Sprite: ${item.Sprite?.substring(0, 30) || 'N/A'}`);
        });
        
        // Créer les instances Pokemon et valider
        console.log('🔍 Validation des Pokémons...');
        let validCount = 0;
        let createdCount = 0;
        let errorCount = 0;
        
        window.POKEMONS_DB = rawData
            .map((data, idx) => {
                try {
                    const pokemon = new Pokemon(data);
                    createdCount++;
                    return pokemon;
                } catch (e) {
                    errorCount++;
                    if (errorCount <= 3) {
                        console.warn(`⚠️ Erreur création Pokémon [${idx}]:`, e.message);
                    }
                    return null;
                }
            })
            .filter(pokemon => {
                if (!pokemon) return false;
                const isValid = pokemon.isValid();
                if (isValid) {
                    validCount++;
                } else {
                    if (validCount + errorCount <= 3) {
                        console.warn(`⚠️ Pokémon invalide [${pokemon.Name_FR || '???'}]:`, {
                            Name_EN: pokemon.Name_EN,
                            Name_FR: pokemon.Name_FR,
                            Types: pokemon.Types,
                            Index: pokemon.Index,
                            Sprite: pokemon.Sprite?.substring(0, 40) + '...',
                            Sprite_Shiny: pokemon.Sprite_Shiny?.substring(0, 40) + '...',
                            isValid: {
                                Name_EN_ok: pokemon.Name_EN?.length > 0,
                                Name_FR_ok: pokemon.Name_FR?.length > 0,
                                Types_ok: pokemon.Types?.length > 0,
                                Index_ok: pokemon.Index !== null && pokemon.Index !== undefined,
                                Sprite_ok: pokemon.Sprite?.length > 0,
                                Sprite_Shiny_ok: pokemon.Sprite_Shiny?.length > 0
                            }
                        });
                    }
                }
                return isValid;
            });
        
        console.log(`📊 Statistiques:`);
        console.log(`   - Créés: ${createdCount}/${rawData.length}`);
        console.log(`   - Erreurs création: ${errorCount}`);
        console.log(`   - Valides: ${validCount}/${createdCount}`);
        console.log(`✅ ${validCount} Pokémons valides`);
        console.log(`   - Index min: ${Math.min(...window.POKEMONS_DB.map(p => p.Index))}`);
        console.log(`   - Index max: ${Math.max(...window.POKEMONS_DB.map(p => p.Index))}`);
        console.log(`   - Premiers: ${window.POKEMONS_DB.slice(0, 3).map(p => p.Name_FR).join(', ')}`);
        
        // Marquer comme chargé
        window.POKEMONS_LOADED = true;
        window.POKEMONS_ERROR = null;
        
        console.log(`%c✅ Base de données Pokémons prête!`, 'color: #00ff00; font-weight: bold; font-size: 14px');
        
        // Dispatche un événement
        window.dispatchEvent(new CustomEvent('pokemonsLoaded', {
            detail: { count: window.POKEMONS_DB.length }
        }));
        
        return window.POKEMONS_DB;
        
    } catch (error) {
        console.error('%c❌ Erreur lors du chargement des Pokémons', 'color: #ff0000; font-weight: bold', error);
        console.error(`   Type: ${error.name}`);
        console.error(`   Message: ${error.message}`);
        console.error(`   Stack: ${error.stack?.substring(0, 200)}`);
        console.error(`   Chemin essayé: ./data/mons.json`);
        console.error(`   Racine serveur: ${window.location.origin}`);
        console.error(`   Cwd: ${window.location.pathname}`);
        window.POKEMONS_ERROR = error.message;
        window.POKEMONS_LOADED = false;
        
        // Dispatche un événement d'erreur
        window.dispatchEvent(new CustomEvent('pokemonsLoadError', {
            detail: { error: error.message }
        }));
        
        return [];
    }
}

/**
 * Retourne la base de données des Pokémons
 * @returns {Array} Liste des Pokémons
 */
function getPokemonsDatabase() {
    if (!window.POKEMONS_LOADED) {
        console.warn('⚠️ La base de données Pokémons n\'est pas encore chargée!');
        return [];
    }
    return window.POKEMONS_DB;
}

/**
 * Vérifie si les Pokémons sont chargés
 * @returns {boolean}
 */
function arePokemonsLoaded() {
    return window.POKEMONS_LOADED === true;
}

/**
 * Attend que les Pokémons soient chargés
 * @param {number} timeout - Timeout en ms (0 = pas de timeout)
 * @returns {Promise}
 */
function waitForPokemons(timeout = 10000) {
    return new Promise((resolve, reject) => {
        if (window.POKEMONS_LOADED) {
            resolve(window.POKEMONS_DB);
            return;
        }
        
        const handler = () => {
            window.removeEventListener('pokemonsLoaded', handler);
            resolve(window.POKEMONS_DB);
        };
        
        const errorHandler = (e) => {
            window.removeEventListener('pokemonsLoadError', errorHandler);
            reject(e.detail.error);
        };
        
        window.addEventListener('pokemonsLoaded', handler);
        window.addEventListener('pokemonsLoadError', errorHandler);
        
        // Timeout
        if (timeout > 0) {
            setTimeout(() => {
                window.removeEventListener('pokemonsLoaded', handler);
                window.removeEventListener('pokemonsLoadError', errorHandler);
                reject(new Error('Timeout waiting for Pokemons'));
            }, timeout);
        }
    });
}

// === Auto-initialisation ===
console.log('%c🚀 InitMons.js chargé - Démarrage du chargement des Pokémons', 'color: #b000ff; font-weight: bold');

// Vérifier que la classe Pokemon existe
if (typeof Pokemon === 'undefined') {
    console.error('❌ ERREUR CRITIQUE: Classe Pokemon non définie! Vérifier que mons.js est chargé AVANT initmons.js');
} else {
    console.log('✅ Classe Pokemon disponible');
}

if (document.readyState === 'loading') {
    // Si le DOM n'est pas encore chargé, attendre
    document.addEventListener('DOMContentLoaded', () => {
        console.log('📄 DOM chargé - Chargement des Pokémons');
        loadPokemonsDatabase();
    });
} else {
    // Si le DOM est déjà chargé, charger immédiatement
    console.log('📄 DOM déjà chargé - Chargement immédiat des Pokémons');
    loadPokemonsDatabase();
}
