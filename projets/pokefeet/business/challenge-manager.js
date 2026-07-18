// business/challenge-manager.js - Logique métier des challenges
const ChallengeManager = (function () {
    let allChallenges = [];
    let allPokemons = [];
    let currentChallenge = null;
    let currentIndex = 0;
    let currentFails = 0;
    let gameActive = false;

    // Charger l'état depuis sessionStorage au démarrage
    function loadState() {
        try {
            const saved = sessionStorage.getItem('challenge_manager_state');
            if (saved) {
                const state = JSON.parse(saved);
                console.log('[ChallengeManager] Loading state from sessionStorage:', state);
                
                // Restaurer le challenge si les challenges sont chargés
                if (state.challengeId && allChallenges.length > 0) {
                    const challenge = allChallenges.find(c => c.ID == state.challengeId);
                    if (challenge) {
                        currentChallenge = challenge;
                        currentIndex = state.currentIndex || 0;
                        currentFails = state.currentFails || 0;
                        gameActive = state.gameActive || false;
                        
                        // Restaurer la liste mélangée si le seed existe
                        if (state.seed && !currentChallenge.shuffledFeetList) {
                            currentChallenge.shuffledFeetList = seededShuffle([...challenge.FeetList], state.seed);
                        }
                        
                        console.log('[ChallengeManager] State restored:', {
                            challengeId: currentChallenge.ID,
                            currentIndex,
                            currentFails,
                            gameActive
                        });
                    }
                }
            }
        } catch (e) {
            console.error('[ChallengeManager] Error loading state:', e);
        }
    }

    // Cookie helper
    function getCookie(name) {
        const v = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
        return v ? decodeURIComponent(v.pop()) : null;
    }

    // Charger les challenges depuis le JSON
    async function loadChallenges() {
        try {
            const res = await fetch('data/bonus_challenges.json');
            const data = await res.json();
            allChallenges = data.map(c => new Challenge(c));
            console.log('[ChallengeManager] Loaded', allChallenges.length, 'challenges');
            
            // Restaurer l'état depuis sessionStorage
            loadState();
            
            return allChallenges;
        } catch (e) {
            console.error('[ChallengeManager] Error loading challenges:', e);
            return [];
        }
    }

    // Charger les Pokémon
    async function loadPokemons() {
        try {
            const res = await fetch('data/pokemons.json');
            const arr = await res.json();
            allPokemons = arr.map(p => new Pokemon(p));
            console.log('[ChallengeManager] Loaded', allPokemons.length, 'Pokemon');
        } catch (e) {
            console.error('[ChallengeManager] Error loading Pokemon:', e);
            allPokemons = [];
        }
    }

    // Calculer l'XP totale (identique à stats.js)
    async function computeTotalXP() {
        let xp = 0;
        
        console.log('[ChallengeManager] Computing total XP...');
        
        // XP des challenges complétés
        try {
            const completions = await ChallengeStorage.getAllCompletions();
            const completionCount = Object.keys(completions).length;
            console.log('[ChallengeManager] Challenge completions:', completionCount);
            
            for (const challengeId in completions) {
                const challenge = allChallenges.find(c => c.ID == challengeId);
                if (challenge) {
                    for (const reward of challenge.Rewards) {
                        if (reward.TypeReward === 'Experience') {
                            xp += reward.Value;
                        }
                    }
                }
            }
            console.log('[ChallengeManager] XP from challenges:', xp);
        } catch (e) {
            console.error('[ChallengeManager] Error loading challenge XP:', e);
        }
        
        // XP des trophées (depuis stats.js)
        try {
            const res = await fetch('data/trophies.json');
            const trophies = await res.json();
            console.log('[ChallengeManager] Trophies loaded:', trophies.length);
            
            // Charger l'historique daily et weekly
            const [dailyHistory, weeklyHistory] = await Promise.all([
                loadDailyHistoryForXP(),
                loadWeeklyHistoryForXP()
            ]);
            
            console.log('[ChallengeManager] Daily history entries:', Object.keys(dailyHistory).length);
            console.log('[ChallengeManager] Weekly history entries:', Object.keys(weeklyHistory).length);
            
            // Calculer les trophées débloqués
            let trophiesEarned = 0;
            for (const trophy of trophies) {
                if (!trophy.Enabled) continue;
                const method = trophy.Obtention_Method;
                const mode = method.Mode;
                const value = method.Value;
                let earned = false;
                
                switch (mode) {
                    case 'Dex_Count': {
                        const progress = await Dex.getProgress();
                        earned = progress.found >= value;
                        break;
                    }
                    case 'Daily_Count': {
                        const completed = Object.values(dailyHistory).filter(h => (h.results || []).length === 5).length;
                        earned = completed >= value;
                        break;
                    }
                    case 'Weekly_Count': {
                        const completed = Object.values(weeklyHistory).filter(h => (h.results || []).length === 10).length;
                        earned = completed >= value;
                        break;
                    }
                    case 'Marathon_Streak': {
                        const bestStreak = parseInt(getCookie('pk_best_streak') || '0', 10);
                        earned = bestStreak >= value;
                        break;
                    }
                }
                
                if (earned) {
                    trophiesEarned++;
                    xp += trophy.XP;
                }
            }
            console.log('[ChallengeManager] Trophies earned:', trophiesEarned, '- XP from trophies:', xp);
        } catch (e) {
            console.error('[ChallengeManager] Error loading trophy XP:', e);
        }
        
        // XP Daily
        try {
            const dailyHistory = await loadDailyHistoryForXP();
            const COUNT = 5;
            const MAX_SCORE = 50;
            let dailyXP = 0;
            for (const date in dailyHistory) {
                const entry = dailyHistory[date];
                const results = entry.results || [];
                const dayPerfect = entry.score === MAX_SCORE;
                const dayFinished = results.length === COUNT;
                if (dayFinished) dailyXP += 3;
                if (dayPerfect) dailyXP += 2;
                for (let i = 0; i < results.length; i++) {
                    const r = results[i];
                    if (r && r.outcome === 'win' && r.attempts === 0) dailyXP += 1;
                }
            }
            xp += dailyXP;
            console.log('[ChallengeManager] XP from daily:', dailyXP);
        } catch (e) {
            console.error('[ChallengeManager] Error loading daily XP:', e);
        }
        
        // XP Weekly
        try {
            const weeklyHistory = await loadWeeklyHistoryForXP();
            const WEEKLY_COUNT = 10;
            const WEEKLY_MAX = 100;
            let weeklyXP = 0;
            for (const date in weeklyHistory) {
                const entry = weeklyHistory[date];
                const results = entry.results || [];
                if (results.length === WEEKLY_COUNT) {
                    const allWins = results.every(r => r && r.outcome === 'win');
                    weeklyXP += 6;
                    if (allWins && entry.score === WEEKLY_MAX) weeklyXP += 4;
                }
                for (let i = 0; i < results.length; i++) {
                    const r = results[i];
                    if (r && r.outcome === 'win' && r.attempts === 0) weeklyXP += 2;
                }
            }
            xp += weeklyXP;
            console.log('[ChallengeManager] XP from weekly:', weeklyXP);
        } catch (e) {
            console.error('[ChallengeManager] Error loading weekly XP:', e);
        }
        
        // XP Marathon
        try {
            const bestScore = parseInt(getCookie('pk_best') || '0', 10);
            const bestStreak = parseInt(getCookie('pk_best_streak') || '0', 10);
            let marathonXP = 0;
            if (bestScore > 0 || bestStreak > 0) {
                marathonXP = Math.floor(bestScore / 5) + (bestStreak * 2);
            }
            xp += marathonXP;
            console.log('[ChallengeManager] XP from marathon:', marathonXP, '(bestScore:', bestScore, 'bestStreak:', bestStreak, ')');
        } catch (e) {
            console.error('[ChallengeManager] Error loading marathon XP:', e);
        }
        
        console.log('[ChallengeManager] Total XP calculated:', xp);
        return xp;
    }
    
    // Helper pour charger l'historique daily (pour XP)
    async function loadDailyHistoryForXP() {
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
    
    // Helper pour charger l'historique weekly (pour XP)
    async function loadWeeklyHistoryForXP() {
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

    // Obtenir le niveau du joueur
    async function getPlayerLevel() {
        // S'assurer que les challenges sont chargés
        if (allChallenges.length === 0) {
            await loadChallenges();
        }
        const totalXP = await computeTotalXP();
        const level = Math.floor(totalXP / 100) + 1;
        console.log('[ChallengeManager] Level calculation:', { totalXP, level });
        return level;
    }

    // Vérifier si un joueur peut jouer un challenge
    async function canPlayChallenge(challenge) {
        // Vérifier tous les requirements
        for (const req of challenge.Requirements) {
            const result = await challenge.checkRequirement(req);
            if (!result.met) {
                return false;
            }
        }
        return true;
    }

    // Démarrer un challenge
    function startChallenge(challenge) {
        currentChallenge = challenge;
        currentIndex = 0;
        currentFails = 0;
        gameActive = true;
        
        // Mélanger la liste des Pokémon avec un seed aléatoire
        const seed = Math.floor(Math.random() * 2147483647) + 1;
        currentChallenge.shuffledFeetList = seededShuffle([...challenge.FeetList], seed);
        
        // Sauvegarder dans sessionStorage pour persistance entre les pages
        try {
            sessionStorage.setItem('challenge_manager_state', JSON.stringify({
                challengeId: challenge.ID,
                currentIndex: 0,
                currentFails: 0,
                gameActive: true,
                seed: seed
            }));
        } catch (e) {
            console.error('[ChallengeManager] Error saving state:', e);
        }
        
        return currentChallenge;
    }

    // PRNG pour mélanger
    function mulberry32(a) {
        return function () {
            a |= 0; a = a + 0x6D2B79F5 | 0;
            var t = Math.imul(a ^ a >>> 15, 1 | a);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    function seededShuffle(arr, seed) {
        const rng = mulberry32(seed);
        const result = arr.slice();
        for (let i = result.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
    }

    // Obtenir le Pokémon courant
    function getCurrentPokemon() {
        if (!currentChallenge || currentIndex >= currentChallenge.shuffledFeetList.length) {
            return null;
        }
        const index = currentChallenge.shuffledFeetList[currentIndex];
        return allPokemons.find(p => p.Index == index) || null;
    }

    // Vérifier une réponse
    function checkAnswer(answer) {
        const current = getCurrentPokemon();
        if (!current) return { correct: false, finished: true };

        if (current.matchesName(answer)) {
            // Correct
            if (currentIndex >= currentChallenge.shuffledFeetList.length - 1) {
                // Challenge terminé
                gameActive = false;
                return { correct: true, finished: true, pokemon: current };
            } else {
                currentIndex++;
                return { correct: true, finished: false, pokemon: current };
            }
        } else {
            // Incorrect
            currentFails++;
            return { correct: false, finished: false, pokemon: current };
        }
    }

    // Terminer le challenge (succès)
    async function completeChallenge() {
        if (!currentChallenge) return null;

        const completion = await ChallengeStorage.markChallengeCompleted(currentChallenge.ID, currentFails);
        
        // Ajouter les Pokémon au Dex
        for (const index of currentChallenge.FeetList) {
            await Dex.markFound(index);
        }

        // Donner les rewards XP
        let xpGained = 0;
        for (const reward of currentChallenge.Rewards) {
            if (reward.TypeReward === 'Experience') {
                xpGained += reward.Value;
            }
        }

        return {
            challenge: currentChallenge,
            completion: completion,
            xpGained: xpGained,
            fails: currentFails
        };
    }

    // Réinitialiser l'état
    function reset() {
        currentChallenge = null;
        currentIndex = 0;
        currentFails = 0;
        gameActive = false;
    }

    return {
        loadChallenges,
        loadPokemons,
        canPlayChallenge,
        getPlayerLevel,
        startChallenge,
        getCurrentPokemon,
        checkAnswer,
        completeChallenge,
        reset,
        getAllChallenges: () => allChallenges,
        getCurrentChallenge: () => currentChallenge,
        isGameActive: () => gameActive,
        get currentIndex() { return currentIndex; },
        get currentFails() { return currentFails; },
        get allPokemons() { return allPokemons; }
    };
})();