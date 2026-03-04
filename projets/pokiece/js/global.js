/**
 * ===================================
 * Global.js - Fonctions globales
 * Gère le dark mode, les cookies, les boutons flottants
 * ===================================
 */

/**
 * Récupère la valeur d'un cookie
 * @param {string} name - Nom du cookie
 * @returns {string|null} Valeur du cookie ou null
 */
function getCookie(name) {
    console.log(`🔍 Recherche du cookie: ${name}`);
    const nameEQ = name + "=";
    const cookies = document.cookie.split(';');
    
    for (let cookie of cookies) {
        cookie = cookie.trim();
        if (cookie.indexOf(nameEQ) === 0) {
            const value = cookie.substring(nameEQ.length);
            console.log(`✅ Cookie trouvé [${name}]: ${value}`);
            return value;
        }
    }
    
    console.log(`❌ Cookie non trouvé: ${name}`);
    return null;
}

/**
 * Définit un cookie avec une date d'expiration
 * @param {string} name - Nom du cookie
 * @param {string} value - Valeur du cookie
 * @param {number} days - Nombre de jours avant expiration (défaut: 365)
 */
function setCookie(name, value, days = 365) {
    console.log(`🔧 Définition du cookie: ${name} = ${value} (${days} jours)`);
    const date = new Date();
    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
    const expires = "expires=" + date.toUTCString();
    document.cookie = `${name}=${value};${expires};path=/`;
    console.log(`✅ Cookie sauvegardé: ${name}`);
}

/**
 * Récupère le mode actuel (light ou dark)
 * Par défaut: 'light'
 * @returns {string} Mode actuel ('light' ou 'dark')
 */
function getCurrentDarkMode() {
    console.log('🔍 Récupération du mode actuel');
    const mode = getCookie('darkMode') || 'light';
    console.log(`📝 Mode actuel: ${mode}`);
    return mode;
}

/**
 * Active le dark mode
 * Ajoute la classe 'dark-mode' au body
 */
function enableDarkMode() {
    console.log('🌙 Activation du dark mode');
    document.body.classList.add('dark-mode');
    setCookie('darkMode', 'dark', 365);
    updateDarkModeButton();
    console.log('✅ Dark mode activé');
}

/**
 * Désactive le dark mode
 * Retire la classe 'dark-mode' du body
 */
function disableDarkMode() {
    console.log('☀️ Désactivation du dark mode');
    document.body.classList.remove('dark-mode');
    setCookie('darkMode', 'light', 365);
    updateDarkModeButton();
    console.log('✅ Dark mode désactivé');
}

/**
 * Bascule le dark mode ON/OFF
 */
function toggleDarkMode() {
    const currentMode = getCurrentDarkMode();
    console.log(`🔄 Basculement du dark mode depuis: ${currentMode}`);
    
    if (currentMode === 'light') {
        enableDarkMode();
    } else {
        disableDarkMode();
    }
}

/**
 * Met à jour l'icône du bouton dark mode
 */
function updateDarkModeButton() {
    const darkModeBtn = document.getElementById('darkModeBtn');
    if (darkModeBtn) {
        const mode = getCurrentDarkMode();
        darkModeBtn.textContent = mode === 'dark' ? '☀️' : '🌙';
        console.log(`✅ Icône bouton dark mode mise à jour: ${darkModeBtn.textContent}`);
    }
}

/**
 * Initializer le dark mode au chargement de la page
 */
function initDarkMode() {
    console.log('%c⚙️ Initialisation du dark mode', 'color: #00d4ff; font-weight: bold');
    const mode = getCurrentDarkMode();
    
    if (mode === 'dark') {
        console.log('🌙 Application du dark mode');
        document.body.classList.add('dark-mode');
    } else {
        console.log('☀️ Mode clair appliqué');
        document.body.classList.remove('dark-mode');
    }
    
    updateDarkModeButton();
    
    // Initialiser le bouton dark mode
    const darkModeBtn = document.getElementById('darkModeBtn');
    if (darkModeBtn) {
        darkModeBtn.addEventListener('click', function() {
            console.log('🎯 Bouton dark mode cliqué');
            toggleDarkMode();
        });
        console.log('✅ Écouteur d\'événement dark mode configuré');
    }
}

/**
 * Affiche une notification toast
 * @param {string} message - Message à afficher
 * @param {number} duration - Durée en millisecondes (défaut: 3000)
 */
function showToast(message, duration = 3000) {
    console.log(`📢 Affichage du toast: ${message}`);
    const toast = document.getElementById('toast');
    
    if (toast) {
        toast.textContent = message;
        toast.classList.add('show');
        console.log('✅ Toast affiché');
        
        // Masquer après la durée spécifiée
        setTimeout(() => {
            toast.classList.remove('show');
            console.log('✅ Toast masqué');
        }, duration);
    } else {
        console.warn('⚠️ Élément toast non trouvé');
    }
}

/**
 * Copie du contenu dans le presse-papiers
 * @param {string} text - Texte à copier
 */
function copyToClipboard(text) {
    console.log(`📋 Copie du texte: ${text}`);
    
    navigator.clipboard.writeText(text).then(() => {
        console.log('✅ Texte copié dans le presse-papiers');
        showToast(getTranslation('codeCopied'));
    }).catch(err => {
        console.error('❌ Erreur lors de la copie:', err);
        // Fallback pour les navigateurs plus anciens
        const textArea = document.createElement("textarea");
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
        console.log('✅ Texte copié (fallback)');
        showToast(getTranslation('codeCopied'));
    });
}

/**
 * Initialisation globale
 * Appelée au chargement de la page
 */
function initGlobal() {
    console.log('%c🌍 Initialisation globale', 'color: #00ffff; font-weight: bold; font-size: 14px');
    console.log('📋 Informations de la page:');
    console.log(`   - URL: ${window.location.href}`);
    console.log(`   - User Agent: ${navigator.userAgent}`);
    console.log(`   - Heure: ${new Date().toLocaleString()}`);
    
    // Initialiser le dark mode
    initDarkMode();
    
    // Le bouton de langue est initialisé dans translation.js
    
    console.log('✅ Initialisation globale terminée');
}

// Initialiser au chargement du DOM
document.addEventListener('DOMContentLoaded', function() {
    console.log('%c📄 DOM chargé - Initialisation globale', 'color: #b000ff; font-weight: bold');
    initGlobal();
});

// Affichage du message initial
console.log('%c🚀 Pokéice - Application Web', 'color: #00d4ff; font-weight: bold; font-size: 16px');
console.log('%c✨ Bienvenue!', 'color: #ff00ff; font-weight: bold; font-size: 14px');
