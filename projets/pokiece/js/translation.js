/**
 * ===================================
 * Translation.js - Système de traduction FR/EN
 * Gère les traductions à partir de fichiers JSON
 * Stocke la langue dans un cookie
 * ===================================
 */

// === Variables globales de traduction ===
window.TRANSLATIONS = {};
window.CURRENT_LANGUAGE = 'FR';

/**
 * Charge un fichier de traduction
 * @param {string} lang - Code de langue (FR ou EN)
 * @returns {Promise<Object>} Traductions chargées
 */
async function loadTranslationFile(lang) {
    console.log(`📥 Chargement des traductions ${lang}`);
    
    try {
        // Ajouter un timestamp pour éviter le cache du navigateur
        const timestamp = new Date().getTime();
        const filePath = `./translations/${lang.toLowerCase()}.json?t=${timestamp}`;
        const response = await fetch(filePath, { cache: 'no-store' });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const translations = await response.json();
        console.log(`✅ Traductions ${lang} chargées (${Object.keys(translations).length} clés)`);
        console.log(`   Clés: ${Object.keys(translations).join(', ')}`);
        
        return translations;
    } catch (error) {
        console.error(`❌ Erreur lors du chargement des traductions ${lang}:`, error);
        throw error;
    }
}

/**
 * Initialise le système de traduction
 * Charge les fichiers pour les deux langues
 * @returns {Promise<void>}
 */
async function initTranslations() {
    console.log('%c⚙️ Initialisation du système de traduction', 'color: #00d4ff; font-weight: bold');
    
    try {
        // Charger les traductions pour FR et EN
        console.log('🌥️  Chargement des fichiers de traduction...');
        window.TRANSLATIONS.FR = await loadTranslationFile('FR');
        console.log(`✅ Traductions FR chargées (${Object.keys(window.TRANSLATIONS.FR).length} clés)`);
        
        window.TRANSLATIONS.EN = await loadTranslationFile('EN');
        console.log(`✅ Traductions EN chargées (${Object.keys(window.TRANSLATIONS.EN).length} clés)`);
        
        console.log('✅ Tous les fichiers de traduction chargés');
        console.log('Clés disponibles (FR):', Object.keys(window.TRANSLATIONS.FR).slice(0, 5));
        
        // Dispatche un événement
        window.dispatchEvent(new CustomEvent('translationsLoaded'));
        
    } catch (error) {
        console.error('%c❌ Erreur lors de l\'initialisation des traductions', 'color: #ff0000; font-weight: bold', error);
        throw error;
    }
}

/**
 * Récupère la langue actuelle depuis le cookie
 * Par défaut: 'FR'
 * @returns {string} Code de langue ('FR' ou 'EN')
 */
function getCurrentLanguage() {
    console.log('🔍 Récupération de la langue actuelle');
    const cookie = document.cookie
        .split('; ')
        .find(row => row.startsWith('language='));
    
    const language = cookie ? cookie.split('=')[1] : 'FR';
    window.CURRENT_LANGUAGE = language;
    console.log(`📝 Langue actuelle: ${language}`);
    return language;
}

/**
 * Définit la langue dans un cookie
 * Cookie persistant (365 jours)
 * @param {string} lang - Code de langue ('FR' ou 'EN')
 */
function setLanguage(lang) {
    console.log(`🔧 Modification de la langue en: ${lang}`);
    
    // Valider la langue
    if (!['FR', 'EN'].includes(lang)) {
        console.error(`❌ Langue invalide: ${lang}`);
        return;
    }
    
    const date = new Date();
    date.setTime(date.getTime() + (365 * 24 * 60 * 60 * 1000)); // 365 jours
    const expires = "expires=" + date.toUTCString();
    document.cookie = `language=${lang};${expires};path=/`;
    window.CURRENT_LANGUAGE = lang;
    
    console.log(`✅ Cookie de langue sauvegardé: ${lang}`);
    console.log(`   Expires: ${date.toUTCString()}`);
    
    // Vérification du cookie
    const verify = document.cookie.split('; ').find(row => row.startsWith('language='));
    console.log(`✅ Vérification: Cookie existe = ${verify ? 'OUI' : 'NON'}`);
}

/**
 * Bascule entre les langues FR et EN
 */
function toggleLanguage() {
    const currentLang = getCurrentLanguage();
    const newLang = currentLang === 'FR' ? 'EN' : 'FR';
    console.log(`%c🌐 Basculement de ${currentLang} vers ${newLang}`, 'color: #b000ff; font-weight: bold; font-size: 12px');
    
    setLanguage(newLang);
    applyTranslation(); // Appliquer les traductions immédiatement
    
    // Mettre à jour les noms des Pokémons si on est sur game.html
    if (typeof updateAllPokemonNames === 'function') {
        updateAllPokemonNames();
    }
    
    console.log(`✅ Langue changée en: ${newLang}`);
}

/**
 * Récupère une traduction pour une clé donnée (supporte les clés imbriquées avec des points)
 * Exemples: 'title', 'typesNames.Dark', 'nested.path.to.key'
 * @param {string} key - Clé de traduction (peut contenir des points pour les objets imbriqués)
 * @returns {string} Texte traduit
 */
function getTranslation(key) {
    const lang = getCurrentLanguage();
    
    // Vérifier si les traductions sont chargées
    if (!window.TRANSLATIONS.FR || !window.TRANSLATIONS.EN) {
        console.warn(`⚠️ Traductions non chargées pour la clé: ${key}`);
        return key;
    }
    
    // Vérifier si la clé existe
    const translationObj = window.TRANSLATIONS[lang];
    
    if (!translationObj) {
        console.warn(`⚠️ Langue ${lang} non trouvée`);
        return key;
    }
    
    // Supporter les clés imbriquées avec des points (ex: 'typesNames.Dark')
    const keys = key.split('.');
    let value = translationObj;
    
    for (const k of keys) {
        if (value && typeof value === 'object' && k in value) {
            value = value[k];
        } else {
            console.warn(`⚠️ Clé de traduction non trouvée: ${key} (${lang})`);
            return key;
        }
    }
    
    return value;
}

/**
 * Applique les traductions à tous les éléments avec l'attribut data-i18n
 */
function applyTranslation() {
    console.log('%c🔄 Application des traductions', 'color: #00d4ff; font-weight: bold');
    const lang = getCurrentLanguage();
    
    console.log(`📋 Langue sélectionnée: ${lang}`);
    console.log(`📋 window.TRANSLATIONS:`, window.TRANSLATIONS);
    console.log(`📋 window.TRANSLATIONS[${lang}]:`, window.TRANSLATIONS[lang]);
    
    if (!window.TRANSLATIONS[lang]) {
        console.error(`❌ Traductions non disponibles pour ${lang}`);
        console.error(`Clés disponibles:`, Object.keys(window.TRANSLATIONS));
        return;
    }
    
    let translated = 0;
    
    // Traiter les éléments avec data-i18n pour le contenu texte
    const elements = document.querySelectorAll('[data-i18n]');
    console.log(`📋 Éléments trouvés avec data-i18n: ${elements.length}`);
    
    elements.forEach(element => {
        const key = element.getAttribute('data-i18n');
        const text = window.TRANSLATIONS[lang][key];
        
        if (text) {
            element.textContent = text;
            translated++;
            console.log(`   ✅ [${key}] = "${text}"`);
        } else {
            console.warn(`   ⚠️ Clé non trouvée: ${key} (disponibles: ${Object.keys(window.TRANSLATIONS[lang]).join(', ').slice(0, 100)}...)`);
        }
    });
    
    // Traiter les éléments avec data-i18n-placeholder pour le placeholder
    document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
        const key = element.getAttribute('data-i18n-placeholder');
        const text = window.TRANSLATIONS[lang][key];
        
        if (text) {
            element.placeholder = text;
            translated++;
            console.log(`   ✅ [${key}] (placeholder) = "${text}"`);
        } else {
            console.warn(`   ⚠️ Clé placeholder non trouvée: ${key}`);
        }
    });
    
    console.log(`✅ ${translated} éléments traduits (${lang})`);
}

/**
 * Initialiser le bouton de changement de langue
 */
function initLanguageButton() {
    console.log('⚙️ Initialisation du bouton de langue');
    const languageBtn = document.getElementById('languageBtn');
    
    if (languageBtn) {
        // Ajouter un écouteur d'événement
        languageBtn.addEventListener('click', function(e) {
            console.log('🎯 Bouton langue cliqué');
            e.preventDefault();
            toggleLanguage();
        });
        console.log('✅ Écouteur d\'événement configuré pour bouton langue');
    } else {
        console.warn('⚠️ Bouton de langue (ID: languageBtn) non trouvé');
    }
}

/**
 * Initialiser le système de traduction au chargement
 */
document.addEventListener('DOMContentLoaded', async function() {
    console.log('%c📄 DOM chargé - Initialisation du système de traduction', 'color: #b000ff; font-weight: bold');
    
    try {
        // Attendre le chargement des Pokémons si nécessaire
        if (window.POKEMONS_DB) {
            console.log('✅ Base de données Pokémons déjà chargée');
        }
        
        // Initialiser les traductions
        await initTranslations();
        
        // Appliquer les traductions
        applyTranslation();
        
        // Initialiser le bouton de langue
        initLanguageButton();
        
        console.log('%c✅ Système de traduction prêt!', 'color: #00ff00; font-weight: bold');
        
    } catch (error) {
        console.error('%c❌ Erreur lors de l\'initialisation du système de traduction', 'color: #ff0000; font-weight: bold', error);
    }
});

