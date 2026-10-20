// entity/challenge.js - Classe Challenge
class Challenge {
    constructor(data) {
        this.ID = data.ID;
        this.Difficulty = data.Difficulty;
        this.Requirements = data.Requirements || [];
        this.Name_En = data.Name_En;
        this.Name_Fr = data.Name_Fr;
        this.Desc_En = data.Desc_En;
        this.Desc_Fr = data.Desc_Fr;
        this.Additional_Info_Fr = data.Additional_Info_Fr || null;
        this.Additional_Info_En = data.Additional_Info_En || null;
        this.FeetList = data.FeetList || [];
        this.Rewards = data.Rewards || [];
        this.Availabilities = data.Availabilities || null;
        this.MustHideIfUnavailable = data.MustHideIfUnavailable || false;
        this.Tab = data.Tab || null;
    }

    getName(lang = 'fr') {
        return lang === 'fr' ? (this.Name_Fr || this.Name_En) : (this.Name_En || this.Name_Fr);
    }

    getDescription(lang = 'fr') {
        return lang === 'fr' ? (this.Desc_Fr || this.Desc_En) : (this.Desc_En || this.Desc_Fr);
    }

    isAvailableToday() {
        if (!this.Availabilities || !Array.isArray(this.Availabilities) || this.Availabilities.length === 0) {
            return true; // Pas de restriction de date
        }

        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

        return this.Availabilities.some(avail => {
            return todayStr >= avail.Start && todayStr <= avail.End;
        });
    }

    getDifficultyColor() {
        const colors = {
            'Easy': '#4ade80',      // Vert
            'Medium': '#fb923c',    // Orange
            'Hard': '#ef4444',      // Rouge
            'Impossible': '#a855f7' // Violet
        };
        return colors[this.Difficulty] || '#fff';
    }

    getDifficultyTranslation() {
        const T = (k, f) => (typeof Translator !== 'undefined' ? Translator.get(k, f) : f);
        const key = 'challenge.difficulty.' + this.Difficulty.toLowerCase();
        return T(key, this.Difficulty);
    }

    // Vérifie un requirement individuel
    async checkRequirement(req) {
        const T = (k, f) => (typeof Translator !== 'undefined' ? Translator.get(k, f) : f);
        
        switch (req.TypeRequirement) {
            case 'level': {
                const playerLevel = await ChallengeManager.getPlayerLevel();
                return {
                    met: playerLevel >= req.Value,
                    text: T('challenge.requirements.levelRequired', 'Niveau requis') + ` : ${playerLevel} / ${req.Value}`,
                    current: playerLevel
                };
            }
            case 'dexcount': {
                // Vérifier que Dex est disponible
                if (typeof Dex === 'undefined') {
                    return {
                        met: false,
                        text: T('challenge.requirements.dexCountRequired', 'Dex') + ` : ? / ${req.Value}`,
                        current: 0
                    };
                }
                const progress = await Dex.getProgress();
                return {
                    met: progress.found >= req.Value,
                    text: T('challenge.requirements.dexCountRequired', 'Dex') + ` : ${progress.found} / ${req.Value}`,
                    current: progress.found
                };
            }
            case 'trophy': {
                // Pour les trophées, on vérifie dans l'historique des trophées
                const trophyId = req.Value;
                const earned = await checkTrophyEarned(trophyId);
                
                // Charger le nom du trophée
                let trophyName = '#' + trophyId;
                try {
                    const res = await fetch('data/trophies.json');
                    const trophies = await res.json();
                    const trophy = trophies.find(t => t.Id === trophyId);
                    if (trophy) {
                        const lang = (typeof Translator !== 'undefined') ? Translator.getLanguage() : 'fr';
                        trophyName = lang === 'fr' ? trophy.Name_fr : trophy.Name_en;
                    }
                } catch (e) {}
                
                return {
                    met: earned,
                    text: T('challenge.requirements.trophyRequired', 'Trophée') + ` : ${trophyName}`,
                    current: earned ? 1 : 0
                };
            }
            default:
                return {
                    met: false,
                    text: 'Unknown requirement: ' + req.TypeRequirement,
                    current: 0
                };
        }
    }
}

// Helper pour vérifier si un trophée est obtenu
async function checkTrophyEarned(trophyId) {
    // Cette fonction devrait être partagée avec stats.js
    // Pour l'instant, on fait une vérification basique
    try {
        // Charger les données des trophées
        const res = await fetch('data/trophies.json');
        const trophies = await res.json();
        const trophy = trophies.find(t => t.Id === trophyId);
        
        if (!trophy) return false;
        
        // Vérifier selon le mode d'obtention
        const method = trophy.Obtention_Method;
        switch (method.Mode) {
            case 'Dex_Count': {
                const progress = await Dex.getProgress();
                return progress.found >= method.Value;
            }
            case 'Daily_Count': {
                // Compter les dailies complétés
                const history = await loadDailyHistory();
                const completed = Object.values(history).filter(h => (h.results || []).length === 5).length;
                return completed >= method.Value;
            }
            case 'Weekly_Count': {
                // Compter les weeklys complétés
                const history = await loadWeeklyHistory();
                const completed = Object.values(history).filter(h => (h.results || []).length === 10).length;
                return completed >= method.Value;
            }
            case 'Marathon_Streak': {
                const bestStreak = parseInt(getCookie('pk_best_streak') || '0', 10);
                return bestStreak >= method.Value;
            }
            default:
                return false;
        }
    } catch (e) {
        console.error('Error checking trophy:', e);
        return false;
    }
}

// Helper pour charger l'historique (dupliqué depuis history.js)
async function loadDailyHistory() {
    try {
        const db = await new Promise((resolve, reject) => {
            const req = indexedDB.open('PokefeetDB', 4);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        
        const tx = db.transaction('daily_results', 'readonly');
        const store = tx.objectStore('daily_results');
        const all = await new Promise((resolve, reject) => {
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        
        const history = {};
        all.forEach(item => {
            history[item.date] = { score: item.score, results: item.results };
        });
        return history;
    } catch (e) {
        return {};
    }
}

async function loadWeeklyHistory() {
    try {
        const db = await new Promise((resolve, reject) => {
            const req = indexedDB.open('PokefeetDB', 4);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        
        const tx = db.transaction('weekly_results', 'readonly');
        const store = tx.objectStore('weekly_results');
        const all = await new Promise((resolve, reject) => {
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        
        const history = {};
        all.forEach(item => {
            history[item.date] = { score: item.score, results: item.results };
        });
        return history;
    } catch (e) {
        return {};
    }
}
