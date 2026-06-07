/**
 * Charge la configuration de manière synchrone depuis config.json
 * Utilise XMLHttpRequest synchrone pour garantir que CONFIG est défini
 * avant l'exécution des autres scripts
 */
(function() {
    var DEFAULT_URL = 'https://docs.google.com/spreadsheets/d/1XEe2904-GRZqDF-wkg5rEQ-My_XMHfzToUsnExpapw0/edit?usp=sharing';
    
    try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', 'config.json', false); // false = synchrone
        xhr.send();
        
        if (xhr.status === 200) {
            var configData = JSON.parse(xhr.responseText);
            window.CONFIG = {
                spreadsheetUrl: configData.spreadsheetUrl || DEFAULT_URL
            };
            console.log('[Config] ✅ Configuration chargée depuis config.json');
            console.log('[Config] URL du spreadsheet:', window.CONFIG.spreadsheetUrl);
        } else {
            throw new Error('HTTP ' + xhr.status);
        }
    } catch (err) {
        console.warn('[Config] ⚠️ Impossible de charger config.json (' + err.message + '), utilisation URL par défaut');
        window.CONFIG = {
            spreadsheetUrl: DEFAULT_URL
        };
        console.log('[Config] URL par défaut:', window.CONFIG.spreadsheetUrl);
    }
})();