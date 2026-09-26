let vaultData = null;
let currentIndex = 0;
let segments = [];

// Distance de Levenshtein pour autoriser jusqu'à 2 fautes
function levenshteinDistance(s1, s2) {
    const m = s1.length;
    const n = s2.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (s1[i - 1] === s2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                dp[i][j] = Math.min(
                    dp[i - 1][j] + 1,     // suppression
                    dp[i][j - 1] + 1,     // insertion
                    dp[i - 1][j - 1] + 1 // substitution
                );
            }
        }
    }
    return dp[m][n];
}

// Division équitable de la clé en autant de morceaux que d'indices
function splitKey(key, count) {
    const parts = [];
    const len = key.length;
    let start = 0;
    for (let i = 0; i < count; i++) {
        const remainingChars = len - start;
        const remainingParts = count - i;
        const partLen = Math.round(remainingChars / remainingParts);
        parts.push(key.substring(start, start + partLen));
        start += partLen;
    }
    return parts;
}

// Affichage de la clé
function renderKey() {
    const container = document.getElementById('keyDisplay');
    container.innerHTML = '';
    segments.forEach((seg, idx) => {
        const span = document.createElement('span');
        span.classList.add('key-segment');
        if (idx < currentIndex) {
            span.classList.add('revealed');
            span.textContent = seg;
        } else {
            span.classList.add('locked');
            span.textContent = '•'.repeat(seg.length);
        }
        container.appendChild(span);
    });
}

// Afficher un message (indice en jaune, sentence en blanc, victoire en vert)
function showMessage(text, type = 'clue') {
    const el = document.getElementById('messageText');
    el.style.opacity = '0';
    el.style.transform = 'scale(0.95)';
    
    setTimeout(() => {
        el.textContent = text;
        el.className = 'message-text ' + type;
        el.style.opacity = '1';
        el.style.transform = 'scale(1)';
    }, 150);
}
// Animation du mot trouvé en gros à l'écran
function triggerWordFlash(word) {
    const overlay = document.getElementById('wordOverlay');
    if (!overlay) return;
    overlay.textContent = word;
    overlay.classList.remove('show');
    // Force reflow pour relancer l'animation
    void overlay.offsetWidth;
    overlay.classList.add('show');
}



function displayNextClueOrSentence() {
    if (currentIndex >= vaultData.Indices.length) {
        return;
    }

    const currentClueObj = vaultData.Indices[currentIndex];
    const clueRate = typeof currentClueObj.ClueRate === 'number' ? currentClueObj.ClueRate : 0.5;
    
    const giveClue = Math.random() < clueRate;
    const validSentences = (vaultData.Sentences || []).filter(s => s && s.trim().length > 0);

    if (giveClue && currentClueObj.Clues && currentClueObj.Clues.length > 0) {
        const randomClue = currentClueObj.Clues[Math.floor(Math.random() * currentClueObj.Clues.length)];
        showMessage(randomClue, 'clue');
    } else if (validSentences.length > 0) {
        const randomSentence = validSentences[Math.floor(Math.random() * validSentences.length)];
        showMessage(randomSentence, 'sentence');
    } else if (currentClueObj.Clues && currentClueObj.Clues.length > 0) {
        const randomClue = currentClueObj.Clues[Math.floor(Math.random() * currentClueObj.Clues.length)];
        showMessage(randomClue, 'clue');
    }
}

function initVault(data) {
    vaultData = data;
    segments = splitKey(vaultData.Key, vaultData.Indices.length);
    renderKey();

    const input = document.getElementById('vaultInput');
    
    // Garder le focus actif sur l'input au clic n'importe où (sauf si l'utilisateur sélectionne la clé)
    document.addEventListener('click', () => {
        const sel = window.getSelection();
        if (sel && sel.toString().length > 0) return;
        input.focus();
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            handleSubmit();
        }
    });

    // Premier message affiché
    displayNextClueOrSentence();
}

function handleSubmit() {
    const input = document.getElementById('vaultInput');
    const val = input.value.trim();
    if (!val) return;

    if (currentIndex >= vaultData.Indices.length) return;

    const targetWord = vaultData.Indices[currentIndex].Word.trim().toLowerCase();
    const userWord = val.toLowerCase();

    // Tolérance : jusqu'à 2 erreurs (Levenshtein <= 2)
    const dist = levenshteinDistance(userWord, targetWord);

    if (dist <= 2) {
        // Succès
        const solvedWord = vaultData.Indices[currentIndex].Word;
        currentIndex++;
        renderKey();
        input.value = '';

        // Afficher le mot deviné en gros au centre avant disparition progressive
        triggerWordFlash(solvedWord);

        if (currentIndex >= vaultData.Indices.length) {
            showMessage("LE COFFRE EST OUVERT", 'success');
            input.disabled = true;
            input.placeholder = "DÉVERROUILLÉ";
            document.body.classList.add('flash-win');
        } else {
            document.body.classList.add('flash-win');
            setTimeout(() => document.body.classList.remove('flash-win'), 800);
            displayNextClueOrSentence();
        }
    } else {
        // Erreur
        input.classList.add('shake');
        setTimeout(() => input.classList.remove('shake'), 450);
        input.value = '';
        displayNextClueOrSentence();
    }
}

// Chargement data.json
fetch('data.json')
    .then(res => res.json())
    .then(data => initVault(data))
    .catch(err => {
        console.error("Erreur de chargement de data.json :", err);
    });
