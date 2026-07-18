// business/challenge-storage.js - Stockage IndexedDB pour les challenges
const ChallengeStorage = (function () {
    const DB_NAME = 'PokefeetChallengeDB';
    const DB_VERSION = 4;
    const STORE_NAME = 'challenge_completions';
    let dbInstance = null;

    function getDB() {
        return new Promise((resolve, reject) => {
            if (dbInstance) {
                resolve(dbInstance);
                return;
            }
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onerror = () => reject(req.error);
            req.onsuccess = () => {
                dbInstance = req.result;
                resolve(dbInstance);
            };
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'challengeId' });
                    store.createIndex('completedAt', 'completedAt', { unique: false });
                }
            };
        });
    }

    async function markChallengeCompleted(challengeId, fails = 0) {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const entry = {
                challengeId: challengeId,
                completedAt: new Date().toISOString(),
                fails: fails
            };
            const req = store.put(entry);
            req.onsuccess = () => resolve(entry);
            req.onerror = () => reject(req.error);
        });
    }

    async function isChallengeCompleted(challengeId) {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.get(challengeId);
            req.onsuccess = () => resolve(req.result !== undefined);
            req.onerror = () => reject(req.error);
        });
    }

    async function getChallengeCompletion(challengeId) {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.get(challengeId);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    }

    async function getAllCompletions() {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.getAll();
            req.onsuccess = () => {
                const result = {};
                req.result.forEach(entry => {
                    result[entry.challengeId] = entry;
                });
                resolve(result);
            };
            req.onerror = () => reject(req.error);
        });
    }

    return {
        markChallengeCompleted,
        isChallengeCompleted,
        getChallengeCompletion,
        getAllCompletions
    };
})();