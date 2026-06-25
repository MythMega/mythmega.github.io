// PKServ Admin — user.js
// Onglet Utilisateur : merge accounts, clear empty accounts
// ============================================================

'use strict';

let _userCache = [];

// ── Module init ──────────────────────────────────────────────

addEventListener('adm:config-loaded', () => {
    initTransferAccount();
    initClearEmptyAccounts();
});

addEventListener('adm:users-loaded', () => {
    _userCache = ADM.users || [];
    refreshAutocompleteSuggestions();
});

// ══════════════════════════════════════════════════════════════
// Transfer Account
// ══════════════════════════════════════════════════════════════

function initTransferAccount() {
    const platforms = ['twitch', 'youtube', 'tiktok', 'discord'];

    // Setup platform selectors
    const platFrom = document.getElementById('transfer-platform-from');
    const platTo = document.getElementById('transfer-platform-to');
    if (platFrom) {
        platFrom.innerHTML = platforms.map(p => `<option value="${p}">${p}</option>`).join('');
        platFrom.addEventListener('change', () => updateUserSuggestions('from'));
    }
    if (platTo) {
        platTo.innerHTML = platforms.map(p => `<option value="${p}">${p}</option>`).join('');
        platTo.addEventListener('change', () => updateUserSuggestions('to'));
    }

    // Setup pseudo inputs with autocomplete
    const pseudoFrom = document.getElementById('transfer-pseudo-from');
    const pseudoTo = document.getElementById('transfer-pseudo-to');

    if (pseudoFrom) {
        pseudoFrom.addEventListener('input', () => {
            updateUserSuggestions('from');
            validateTransferUser('from');
        });
        pseudoFrom.addEventListener('blur', () => validateTransferUser('from'));
    }
    if (pseudoTo) {
        pseudoTo.addEventListener('input', () => {
            updateUserSuggestions('to');
            validateTransferUser('to');
        });
        pseudoTo.addEventListener('blur', () => validateTransferUser('to'));
    }

    // Setup datalist click
    document.addEventListener('click', (e) => {
        if (e.target.matches('.user-suggestion')) {
            const side = e.target.dataset.side;
            const pseudo = e.target.dataset.pseudo;
            const input = document.getElementById(`transfer-pseudo-${side}`);
            if (input) {
                input.value = pseudo;
                validateTransferUser(side);
                hideSuggestions(side);
            }
        }
    });

    // Submit button
    const btn = document.getElementById('btn-transfer-account');
    if (btn) btn.addEventListener('click', handleTransferAccount);
}

function updateUserSuggestions(side) {
    const platform = document.getElementById(`transfer-platform-${side}`)?.value;
    const pseudoInput = document.getElementById(`transfer-pseudo-${side}`);
    if (!platform || !pseudoInput) return;

    const query = pseudoInput.value.trim().toLowerCase();
    if (query.length < 2) {
        hideSuggestions(side);
        return;
    }

    const matches = _userCache
        .filter(u => u.Platform === platform && u.Pseudo.toLowerCase().includes(query))
        .slice(0, 10);

    const container = document.getElementById(`transfer-suggestions-${side}`);
    if (!container) return;

    if (matches.length === 0) {
        hideSuggestions(side);
        return;
    }

    container.innerHTML = matches
        .map(u => `<div class="user-suggestion" data-side="${side}" data-pseudo="${u.Pseudo}">${u.Pseudo}</div>`)
        .join('');
    container.style.display = 'block';
}

function hideSuggestions(side) {
    const container = document.getElementById(`transfer-suggestions-${side}`);
    if (container) container.style.display = 'none';
}

function validateTransferUser(side) {
    const platform = document.getElementById(`transfer-platform-${side}`)?.value;
    const pseudo = document.getElementById(`transfer-pseudo-${side}`)?.value.trim();
    const infoEl = document.getElementById(`transfer-info-${side}`);

    if (!platform || !pseudo || pseudo.length < 2) {
        if (infoEl) infoEl.textContent = '';
        return null;
    }

    const user = _userCache.find(u => u.Platform === platform && u.Pseudo === pseudo);
    if (user) {
        if (infoEl) infoEl.textContent = `✓ ID: ${user.Code_user}`;
        return user;
    } else {
        if (infoEl) infoEl.textContent = '⚠️ Utilisateur introuvable';
        return null;
    }
}

function refreshAutocompleteSuggestions() {
    // Update suggestions if inputs have content
    ['from', 'to'].forEach(side => {
        const input = document.getElementById(`transfer-pseudo-${side}`);
        if (input && input.value.trim().length >= 2) {
            updateUserSuggestions(side);
        }
    });
}

async function handleTransferAccount() {
    const userFrom = validateTransferUser('from');
    const userTo = validateTransferUser('to');
    const respEl = document.getElementById('resp-transfer');

    if (!userFrom || !userTo) {
        showResp(respEl, '⚠️ Veuillez sélectionner deux utilisateurs valides.', 'error');
        return;
    }

    if (userFrom.Code_user === userTo.Code_user) {
        showResp(respEl, '⚠️ Impossible de transférer un compte vers lui-même.', 'error');
        return;
    }

    // Confirmation popup
    const confirmMsg =
        `⚠️ ATTENTION : Cette action est irréversible.\n\n` +
        `Toutes les données de :\n` +
        `  • ${userFrom.Pseudo} (${userFrom.Platform}) [${userFrom.Code_user}]\n\n` +
        `seront transférées vers :\n` +
        `  • ${userTo.Pseudo} (${userTo.Platform}) [${userTo.Code_user}]\n\n` +
        `Le compte source sera SUPPRIMÉ après le transfert.\n\n` +
        `Voulez-vous continuer ?`;

    if (!confirm(confirmMsg)) {
        showResp(respEl, 'Transfert annulé.', 'info');
        return;
    }

    showResp(respEl, '⏳ Transfert en cours…', 'info');

    try {
        const result = await apiPost('System/TransfertAccount', {
            AccountToDelete: {
                Pseudo: userFrom.Pseudo,
                Platform: userFrom.Platform,
                Code_user: userFrom.Code_user
            },
            AccountTarget: {
                Pseudo: userTo.Pseudo,
                Platform: userTo.Platform,
                Code_user: userTo.Code_user
            },
            ChangeUsercode: true
        });

        showResp(respEl, `✅ ${result}`, 'ok');

        // Recharger la liste des utilisateurs
        setTimeout(() => {
            const respUsers = document.getElementById('resp-users');
            loadUsers(respUsers);
        }, 1000);

        // Clear inputs
        ['from', 'to'].forEach(side => {
            const input = document.getElementById(`transfer-pseudo-${side}`);
            const info = document.getElementById(`transfer-info-${side}`);
            if (input) input.value = '';
            if (info) info.textContent = '';
            hideSuggestions(side);
        });
    } catch (e) {
        showResp(respEl, `❌ Erreur : ${e.message}`, 'error');
    }
}

// ══════════════════════════════════════════════════════════════
// Clear Empty Accounts
// ══════════════════════════════════════════════════════════════

function initClearEmptyAccounts() {
    const btn = document.getElementById('btn-clear-empty');
    if (btn) btn.addEventListener('click', handleClearEmptyAccounts);
}

async function handleClearEmptyAccounts() {
    const respEl = document.getElementById('resp-clear-empty');

    const confirmMsg =
        `⚠️ ATTENTION : Cette action est irréversible.\n\n` +
        `Tous les comptes vides (0 ball lancée) seront SUPPRIMÉS.\n\n` +
        `Voulez-vous continuer ?`;

    if (!confirm(confirmMsg)) {
        showResp(respEl, 'Nettoyage annulé.', 'info');
        return;
    }

    showResp(respEl, '⏳ Suppression en cours…', 'info');

    try {
        const result = await apiPost('System/ClearEmptyAccounts', {});
        showResp(respEl, `✅ ${result}`, 'ok');

        // Recharger la liste des utilisateurs
        setTimeout(() => {
            const respUsers = document.getElementById('resp-users');
            loadUsers(respUsers);
        }, 1000);
    } catch (e) {
        showResp(respEl, `❌ Erreur : ${e.message}`, 'error');
    }
}