/**
 * Module de récupération des données depuis Google Sheets
 * Utilise le format CSV export pour lire les données sans API
 */

const Spreadsheet = (() => {
    /**
     * Charge et parse un sheet Google au format CSV
     * @param {string} sheetUrl - URL de la feuille Google Sheets
     * @returns {Promise<Array<Object>>} - Tableau d'objets (clés = en-têtes)
     */
    async function loadSheet(sheetUrl) {
        if (!window.CONFIG) {
            console.error('[Spreadsheet] ❌ CONFIG non défini ! Vérifiez config.js et config.json');
            throw new Error('CONFIG non défini');
        }
        console.log('[Spreadsheet] Chargement sheet depuis:', sheetUrl);
        const csvUrl = convertToCsvUrl(sheetUrl);
        console.log('[Spreadsheet] URL CSV générée:', csvUrl);
        const csvText = await fetchCsv(csvUrl);
        const data = parseCsv(csvText);
        console.log('[Spreadsheet] ✅ Données chargées:', data.length, 'lignes');
        return data;
    }

    /**
     * Convertit une URL d'édition Google Sheets en URL d'export CSV
     * Supporte les formats avec ou sans gid
     * @param {string} url 
     * @returns {string}
     */
    function convertToCsvUrl(url) {
        if (!url) {
            console.error('[Spreadsheet] ❌ URL vide reçue');
            throw new Error('URL de spreadsheet vide');
        }
        console.log('[Spreadsheet] Conversion URL:', url);
        
        // Nettoyer l'URL (enlever les paramètres après le ? sauf gid)
        let baseUrl = url.split('?')[0];
        
        // Extraire le gid si présent
        let gid = '';
        const gidMatch = url.match(/[?&]gid=(\d+)/);
        if (gidMatch) {
            gid = gidMatch[1];
            console.log('[Spreadsheet] gid trouvé:', gid);
        }

        // Extraire l'ID du document
        const idMatch = baseUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (!idMatch) {
            console.error('[Spreadsheet] ❌ Impossible d\'extraire l\'ID du document depuis:', baseUrl);
            throw new Error('URL de spreadsheet invalide');
        }
        
        const docId = idMatch[1];
        console.log('[Spreadsheet] Document ID:', docId);
        
        if (gid) {
            return `https://docs.google.com/spreadsheets/d/${docId}/export?format=csv&gid=${gid}`;
        }
        // Premier onglet (gid=0)
        return `https://docs.google.com/spreadsheets/d/${docId}/export?format=csv&gid=0`;
    }

    /**
     * Récupère le contenu CSV depuis une URL
     * @param {string} url 
     * @returns {Promise<string>}
     */
    async function fetchCsv(url) {
        console.log('[Spreadsheet] Téléchargement CSV...');
        const tryFetch = async (fetchUrl) => {
            const response = await fetch(fetchUrl);
            if (!response.ok) {
                throw new Error(`Erreur HTTP ${response.status} ${response.statusText}`);
            }
            return await response.text();
        };

        try {
            const text = await tryFetch(url);
            console.log('[Spreadsheet] ✅ CSV téléchargé:', text.length, 'caractères');
            if (text.length < 10) {
                console.warn('[Spreadsheet] ⚠️ CSV très court, contenu:', text.substring(0, 100));
            }
            return text;
        } catch (err) {
            console.warn('[Spreadsheet] ⚠️ Échec direct, tentative proxy CORS...', err.message);
            const proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url);
            const text = await tryFetch(proxyUrl);
            console.log('[Spreadsheet] ✅ CSV téléchargé via proxy:', text.length, 'caractères');
            return text;
        }
    }

    /**
     * Parse un texte CSV en tableau d'objets
     * @param {string} csvText 
     * @returns {Array<Object>}
     */
    function parseCsv(csvText) {
        const lines = [];
        let currentLine = [];
        let currentField = '';
        let inQuotes = false;

        // Parsing manuel pour gérer les guillemets et virgules dans les champs
        for (let i = 0; i < csvText.length; i++) {
            const char = csvText[i];
            const nextChar = csvText[i + 1];

            if (inQuotes) {
                if (char === '"' && nextChar === '"') {
                    currentField += '"';
                    i++;
                } else if (char === '"') {
                    inQuotes = false;
                } else {
                    currentField += char;
                }
            } else {
                if (char === '"') {
                    inQuotes = true;
                } else if (char === ',') {
                    currentLine.push(currentField.trim());
                    currentField = '';
                } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
                    currentLine.push(currentField.trim());
                    if (currentLine.length > 0 && currentLine.some(f => f !== '')) {
                        lines.push(currentLine);
                    }
                    currentLine = [];
                    currentField = '';
                    if (char === '\r') i++;
                } else if (char === '\r') {
                    currentLine.push(currentField.trim());
                    if (currentLine.length > 0 && currentLine.some(f => f !== '')) {
                        lines.push(currentLine);
                    }
                    currentLine = [];
                    currentField = '';
                } else {
                    currentField += char;
                }
            }
        }

        // Dernière ligne
        currentLine.push(currentField.trim());
        if (currentLine.length > 0 && currentLine.some(f => f !== '')) {
            lines.push(currentLine);
        }

        if (lines.length < 2) return [];

        // La première ligne contient les en-têtes
        const headers = lines[0];
        const result = [];

        for (let i = 1; i < lines.length; i++) {
            const row = {};
            for (let j = 0; j < headers.length; j++) {
                row[headers[j].trim()] = (lines[i][j] || '').trim();
            }
            result.push(row);
        }

        return result;
    }

    /**
     * Charge la configuration depuis la page _config
     * @returns {Promise<{pages: Array<Object>}>}
     */
    async function loadConfig() {
        const url = window.CONFIG && window.CONFIG.spreadsheetUrl;
        if (!url) {
            console.error('[Spreadsheet] ❌ window.CONFIG.spreadsheetUrl non défini');
            console.error('[Spreadsheet] Valeur de window.CONFIG:', JSON.stringify(window.CONFIG));
            throw new Error('URL du spreadsheet non configurée');
        }
        console.log('[Spreadsheet] Chargement config depuis:', url);
        const config = await loadSheet(url);
        if (config.length > 0) {
            console.log('[Spreadsheet] Pages trouvées:', config.map(p => p.page).join(', '));
        } else {
            console.warn('[Spreadsheet] ⚠️ Aucune page trouvée dans la config');
        }
        return { pages: config };
    }

    /**
     * Charge les champions depuis la page _champions
     * @returns {Promise<Array<Object>>}
     */
    async function loadChampions() {
        const pages = (await loadConfig()).pages;
        const championsPage = pages.find(p => p.page === '_champions');
        if (!championsPage) throw new Error('Page _champions non trouvée dans la configuration');
        return await loadSheet(championsPage.url);
    }

    /**
     * Charge les matchs d'un utilisateur depuis sa page
     * @param {string} userPageUrl 
     * @returns {Promise<Array<Object>>}
     */
    async function loadUserMatches(userPageUrl) {
        return await loadSheet(userPageUrl);
    }

    /**
     * Récupère la liste de tous les utilisateurs (pages sans underscore)
     * @returns {Promise<Array<Object>>}
     */
    async function loadUsers() {
        const config = await loadConfig();
        return config.pages.filter(p => !p.page.startsWith('_'));
    }

    return {
        loadSheet,
        loadConfig,
        loadChampions,
        loadUserMatches,
        loadUsers,
        convertToCsvUrl
    };
})();