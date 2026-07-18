// ui/challenge-game-ui.js - Interface de jeu des challenges
const ChallengeGameUI = (function () {
    let currentChallenge = null;
    let currentPokemon = null;
    let attempts = 0;
    const maxAttempts = 5;
    let wrongGuesses = [];
    let busy = false;

    function init() {
        currentChallenge = ChallengeManager.getCurrentChallenge();
        if (!currentChallenge) {
            console.error('[ChallengeGameUI] No active challenge');
            return;
        }

        currentPokemon = ChallengeManager.getCurrentPokemon();
        if (!currentPokemon) {
            console.error('[ChallengeGameUI] No current pokemon');
            return;
        }

        attempts = 0;
        wrongGuesses = [];
        busy = false;
        renderGame();
        bindEvents();
    }

    function normalizeStr(s) {
        return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    }

    function isValidName(val) {
        if (!val) return false;
        const v = normalizeStr(val.trim());
        const pokemons = ChallengeManager.allPokemons || [];
        for (let i = 0; i < pokemons.length; i++) {
            const p = pokemons[i];
            if (normalizeStr(p.NameFR) === v || normalizeStr(p.NameEN) === v) {
                return true;
            }
        }
        return false;
    }

    function showNotification(message, type) {
        const notif = document.getElementById('notifications');
        if (!notif) return;
        const n = document.createElement('div');
        n.className = 'notification';
        n.textContent = message;
        if (type === 'fail') n.style.background = '#491111';
        if (type === 'hint') n.style.background = '#334155';
        if (type === 'success') n.style.background = '#166534';
        notif.appendChild(n);
        setTimeout(function () {
            n.style.opacity = 0;
            try { notif.removeChild(n); } catch (e) {}
        }, 1600);
    }

    function updateFailedDisplay() {
        const failedEl = document.getElementById('challengeFailedAttempts');
        if (!failedEl) return;
        if (!wrongGuesses || wrongGuesses.length === 0) {
            failedEl.classList.add('hidden');
            failedEl.textContent = '';
            return;
        }
        failedEl.classList.remove('hidden');
        failedEl.textContent = 'Échecs : ' + wrongGuesses.join(', ');
    }

    function renderGame() {
        if (!currentPokemon) {
            renderCompletion();
            return;
        }

        const img = document.getElementById('challengeImg');
        if (img) img.src = currentPokemon.Image || '';

        const progress = document.getElementById('challengeProgress');
        if (progress) {
            progress.textContent = (ChallengeManager.currentIndex + 1) + ' / ' + currentChallenge.FeetList.length;
        }

        const failsEl = document.getElementById('challengeFails');
        if (failsEl) {
            const label = (typeof Translator !== 'undefined' ? Translator.get('challenge.totalFails', 'Erreurs') : 'Erreurs');
            failsEl.textContent = label + ' : ' + ChallengeManager.currentFails;
        }

        updateFailedDisplay();
    }

    async function renderCompletion() {
        const T = function (k, f) { return (typeof Translator !== 'undefined' ? Translator.get(k, f) : f); };
        const lang = (typeof Translator !== 'undefined') ? Translator.getLanguage() : 'fr';

        let result = null;
        try {
            result = await ChallengeManager.completeChallenge();
        } catch (e) {
            console.error('[ChallengeGameUI] Error completing challenge:', e);
        }

        const fails = result ? result.fails : ChallengeManager.currentFails;
        const xpGained = result ? result.xpGained : 0;

        const gameEl = document.getElementById('challengeGame');
        if (gameEl) gameEl.classList.add('hidden');

        const popup = document.getElementById('challengeSuccessPopup');
        const details = document.getElementById('challengeSuccessDetails');

        if (popup && details) {
            let pokemonImages = '';
            for (const index of currentChallenge.FeetList) {
                const pokemon = ChallengeManager.allPokemons.find(function (p) { return p.Index == index; });
                if (pokemon) {
                    const name = lang === 'fr' ? (pokemon.NameFR || pokemon.NameEN) : (pokemon.NameEN || pokemon.NameFR);
                    const imgUrl = pokemon.FullImage || pokemon.Image || '';
                    pokemonImages += '<img src="' + imgUrl + '" alt="' + name + '" style="width:128px;height:128px;object-fit:contain;image-rendering:pixelated;margin:0 auto;display:block;" />';
                }
            }

            details.innerHTML =
                '<h2 style="text-align:center;margin:0 0 4px 0;color:#4ade80;font-size:22px;">\u2B50 ' + T('challenge.completed', 'Challenge complété !') + '</h2>' +
                '<p style="text-align:center;color:#fff;font-size:16px;margin:0 0 20px 0;">' + currentChallenge.getName(lang) + '</p>' +
                '<div style="max-height:260px;overflow-y:auto;margin-bottom:20px;padding:4px;border:1px solid rgba(255,255,255,0.06);border-radius:8px;">' +
                    '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:8px;justify-items:center;">' +
                        pokemonImages +
                    '</div>' +
                '</div>' +
                '<div style="display:flex;flex-direction:column;align-items:center;gap:4px;margin:16px 0;font-size:15px;color:#fff;">' +
                    '<div>' + T('challenge.totalFails', 'Erreurs totales') + ' : <strong style="color:#ef4444;font-size:18px;">' + fails + '</strong></div>' +
                    '<div>' + T('challenge.totalPokemon', 'Pokémon') + ' : <strong style="color:#4ade80;font-size:18px;">' + currentChallenge.FeetList.length + '</strong></div>' +
                    '<div style="color:#4ade80;font-weight:700;font-size:18px;">+' + xpGained + ' XP</div>' +
                '</div>' +
                '<div style="display:flex;gap:12px;margin-top:24px;">' +
                    '<button id="copyChallengeResult" style="flex:1;padding:12px;background:#22c55e;color:#052018;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:14px;">' + T('challenge.copyResult', 'Copier le résultat') + '</button>' +
                    '<button id="backToChallengeList" style="flex:1;padding:12px;background:rgba(255,255,255,0.08);color:#fff;border:1px solid rgba(255,255,255,0.1);border-radius:8px;font-weight:600;cursor:pointer;font-size:14px;">' + T('challenge.backToList', 'Retour à la liste') + '</button>' +
                '</div>';

            popup.classList.remove('hidden');
            popup.style.display = 'flex';

            document.getElementById('copyChallengeResult').addEventListener('click', function () {
                const challengeName = currentChallenge.getName(lang);
                const difficulty = currentChallenge.getDifficultyTranslation();
                const baseUrl = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '');
                const url = baseUrl + '/challenge.html?challengeid=' + currentChallenge.ID + '&statut=view';
                const totalPokemon = currentChallenge.FeetList.length;
                const text = 'Challenge ' + challengeName + ' ' + difficulty + ' réussi !\n' + url + '\nPokémon trouvés : ' + totalPokemon + '\nErreurs totale : ' + fails + '.';
                navigator.clipboard.writeText(text).then(function () {
                    showNotification(T('challenge.copied', 'Résultat copié !'), 'success');
                });
            });

            // Refresh cosmetics (new ones may have been unlocked)
            if (typeof Cosmetics !== 'undefined') {
                Cosmetics.load();
            }

            document.getElementById('backToChallengeList').addEventListener('click', function () {
                window.location.href = 'list_challenges.html';
            });
        }
    }

    function bindEvents() {
        const input = document.getElementById('challengeInput');
        const submit = document.getElementById('challengeSubmit');

        if (submit) {
            submit.addEventListener('click', submitAnswer);
        }

        if (input) {
            input.addEventListener('input', function () {
                const needle = normalizeStr(input.value.trim());
                const existingDropdown = document.getElementById('challengeDropdown');
                if (existingDropdown) existingDropdown.remove();

                if (!needle) return;

                const matches = [];
                var addedNames = {};
                const pokemons = ChallengeManager.allPokemons;
                for (const p of pokemons) {
                    if (matches.length >= 20) break;
                    const fr = p.NameFR || '';
                    const en = p.NameEN || '';
                    var frMatch = fr && normalizeStr(fr).includes(needle);
                    var enMatch = en && normalizeStr(en).includes(needle);
                    if (frMatch && !addedNames[fr]) {
                        addedNames[fr] = true;
                        matches.push({ name: fr, pokemon: p });
                    }
                    if (enMatch && !addedNames[en]) {
                        addedNames[en] = true;
                        matches.push({ name: en, pokemon: p });
                    }
                }

                if (matches.length === 0) return;

                const dropdown = document.createElement('div');
                dropdown.id = 'challengeDropdown';
                dropdown.className = 'names-dropdown';

                matches.forEach(function (match) {
                    const item = document.createElement('div');
                    item.className = 'autocomplete-item';
                    item.textContent = match.name;
                    item.addEventListener('mousedown', function (e) {
                        e.preventDefault();
                        input.value = match.name;
                        dropdown.remove();
                    });
                    dropdown.appendChild(item);
                });

                input.parentElement.style.position = 'relative';
                input.parentElement.appendChild(dropdown);
            });

            input.addEventListener('blur', function () {
                setTimeout(function () {
                    const dropdown = document.getElementById('challengeDropdown');
                    if (dropdown) dropdown.remove();
                }, 150);
            });

            input.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') {
                    const dropdown = document.getElementById('challengeDropdown');
                    if (dropdown) dropdown.remove();
                }
                if (e.key === 'Enter') {
                    const dropdown = document.getElementById('challengeDropdown');
                    if (dropdown) dropdown.remove();
                    submitAnswer();
                }
            });
        }
    }

    function showHintForAttempt(attempt) {
        const p = currentPokemon;
        const hintsList = document.getElementById('challengeHints');
        if (!hintsList || !p) return;

        const T = function (k, f) { return (typeof Translator !== 'undefined' ? Translator.get(k, f) : f); };

        let ul = hintsList.querySelector('ul');
        if (!ul) {
            ul = document.createElement('ul');
            hintsList.appendChild(ul);
        }

        const li = document.createElement('li');

        switch (attempt) {
            case 1: {
                const t1 = p.Type1 || '';
                const t2 = p.Type2 || '';
                const typesLabel = T('daily.types', 'Type(s)');
                const t1Badge = '<span class="type-badge t-' + t1.toLowerCase() + '">' + T('types.' + t1.toLowerCase(), t1) + '</span>';
                let typeHint = typesLabel + ' : ' + t1Badge;
                if (t2) {
                    const t2Badge = '<span class="type-badge t-' + t2.toLowerCase() + '">' + T('types.' + t2.toLowerCase(), t2) + '</span>';
                    typeHint += ' ' + t2Badge;
                }
                li.innerHTML = typeHint;
                break;
            }
            case 2: {
                const indexLabel = T('daily.index', 'Index');
                const genLabel = T('daily.generation', 'Génération');
                li.textContent = indexLabel + ' : ' + p.Index + ' (' + genLabel + ' ' + p.Generation + ')';
                break;
            }
            case 3: {
                const eggLabel = T('daily.eggGroups', 'Groupes d\'oeuf');
                li.textContent = eggLabel + ' : ' + p.getEggGroupsDisplay();
                break;
            }
            case 4: {
                const catLabel = T('daily.category', 'Catégorie');
                li.textContent = catLabel + ' : ' + p.getCategoryDisplay();
                break;
            }
            default:
                break;
        }

        ul.appendChild(li);
    }

    function triggerInvalidInput() {
        const el = document.getElementById('challengeInput');
        el.classList.remove('shake');
        void el.offsetWidth;
        el.classList.add('shake');
        showNotification('Nom invalide', 'fail');
        setTimeout(function () { el.classList.remove('shake'); }, 500);
    }

    async function submitAnswer() {
        const input = document.getElementById('challengeInput');
        if (!input) return;

        const val = input.value.trim();
        if (!val) return;

        if (!isValidName(val)) {
            triggerInvalidInput();
            return;
        }

        if (wrongGuesses.includes(val)) {
            showNotification('Déjà essayé', 'hint');
            return;
        }

        const result = ChallengeManager.checkAnswer(val);

        if (result.correct) {
            const lang = (typeof Translator !== 'undefined') ? Translator.getLanguage() : 'fr';
            const name = lang === 'fr' ? (currentPokemon.NameFR || currentPokemon.NameEN) : (currentPokemon.NameEN || currentPokemon.NameFR);
            showNotification('Pokémon trouvé : ' + name, 'success');
            input.value = '';

            if (result.finished) {
                renderCompletion();
            } else {
                currentPokemon = ChallengeManager.getCurrentPokemon();
                attempts = 0;
                wrongGuesses = [];

                const hintsList = document.getElementById('challengeHints');
                if (hintsList) hintsList.innerHTML = '';

                updateFailedDisplay();
                renderGame();
            }
        } else {
            wrongGuesses.push(val);
            updateFailedDisplay();
            attempts++;
            showNotification('Essaie encore', 'fail');
            input.value = '';

            if (attempts <= 4) {
                showHintForAttempt(attempts);
            }
        }
    }

    return { init };
})();