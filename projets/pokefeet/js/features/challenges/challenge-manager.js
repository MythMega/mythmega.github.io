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
            const data = await DataFiles.load('challenges');
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
            allPokemons = await PokemonFiles.load();
            console.log('[ChallengeManager] Loaded', allPokemons.length, 'Pokemon');
        } catch (e) {
            console.error('[ChallengeManager] Error loading Pokemon:', e);
            allPokemons = [];
        }
    }

    // XP totale du joueur (calcul partagé, voir js/core/xp.js)
    function computeTotalXP() {
        return PokefeetXP.computeTotalXP();
    }

    // Obtenir le niveau du joueur
    async function getPlayerLevel() {
        // S'assurer que les challenges sont chargés
        if (allChallenges.length === 0) {
            await loadChallenges();
        }
        const totalXP = await computeTotalXP();
        // Même courbe que le profil : PokefeetXP.getLevel() est la seule
        // source de vérité, sinon un défi reste verrouillé alors que le profil
        // annonce le niveau atteint.
        return PokefeetXP.getLevel(totalXP);
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
        let hasNewPokemon = false;
        for (const index of currentChallenge.FeetList) {
            try {
                const entry = await Dex.getDexEntry(index);
                if (!entry || !entry.found) hasNewPokemon = true;
            } catch (e) {
                // Entrée illisible : on continue le marquage sans bloquer le challenge.
            }
            await Dex.markFound(index);
        }
        if (hasNewPokemon && typeof PokefeetFX !== 'undefined') {
            PokefeetFX.playSound('newPokemon');
        }

        // Donner les rewards XP (+ Pokédollars : 1 XP = 1 P)
        let xpGained = 0;
        let currencyGained = 0;
        for (const reward of currentChallenge.Rewards) {
            if (reward.TypeReward === 'Experience') {
                xpGained += reward.Value;
            } else if (reward.TypeReward === 'Currency') {
                currencyGained += reward.Value;
            }
        }

        return {
            challenge: currentChallenge,
            completion: completion,
            xpGained: xpGained,
            pokedollarsGained: xpGained + currencyGained,
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
        computeTotalXP: computeTotalXP,
        get currentIndex() { return currentIndex; },
        get currentFails() { return currentFails; },
        get allPokemons() { return allPokemons; }
    };
})();