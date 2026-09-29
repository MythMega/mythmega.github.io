export class ConfigLoader {
    static async load(path = './app/settings.json') {
        console.log(`[ConfigLoader] Chargement de la configuration depuis : ${path}`);
        try {
            const response = await fetch(path);
            if (!response.ok) {
                throw new Error(`HTTP Error! Status: ${response.status}`);
            }
            const config = await response.json();
            console.log('[ConfigLoader] Configuration chargée avec succès :', config);
            return config;
        } catch (error) {
            console.error('[ConfigLoader] Erreur lors du chargement de la configuration :', error);
            throw error;
        }
    }
}