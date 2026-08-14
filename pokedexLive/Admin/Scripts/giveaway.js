// ============================================================
// PKServ Admin — giveaway.js
// Module Giveaway : lancer une ball / donner une créature
// ============================================================

'use strict';

function initGiveaway() {
  // Instancier les SearchableSelect
  ADM.ss['giveaway-user-ball']  = new SearchableSelect('ss-giveaway-user-ball',  'giveaway-user-ball',  '[Plateforme] Pseudo…');
  ADM.ss['giveaway-ball-name']  = new SearchableSelect('ss-giveaway-ball-name',  'giveaway-ball-name',  'Nom de la ball…');
  ADM.ss['giveaway-user-poke']  = new SearchableSelect('ss-giveaway-user-poke',  'giveaway-user-poke',  '[Plateforme] Pseudo…');
  ADM.ss['giveaway-poke-name']  = new SearchableSelect('ss-giveaway-poke-name',  'giveaway-poke-name',  'Nom de la créature…');

  // Populate user selects when data arrives
  addEventListener('adm:users-loaded', populateGiveawayUsers);
  if (ADM.users.length) populateGiveawayUsers();

  // Populate ball select when data arrives (utilise loadBalls global)
  addEventListener('adm:balls-loaded', populateGiveawayBalls);
  if (ADM.balls.length) populateGiveawayBalls();

  // Populate creature select when data arrives
  addEventListener('adm:creatures-loaded', populateGiveawayCreatures);
  if (ADM.creatures.length) populateGiveawayCreatures();

  // Buttons
  document.getElementById('btn-giveaway-ball')?.addEventListener('click', () => {
    withBtn(document.getElementById('btn-giveaway-ball'), launchBall);
  });
  document.getElementById('btn-giveaway-poke')?.addEventListener('click', () => {
    withBtn(document.getElementById('btn-giveaway-poke'), giveCreature);
  });

  // Switch "donner à tous" : verrouille/déverrouille le select utilisateur
  const allSwitch = document.getElementById('giveaway-poke-all');
  allSwitch?.addEventListener('change', () => {
    ADM.ss['giveaway-user-poke']?.setDisabled(allSwitch.checked);
    if (allSwitch.checked) ADM.ss['giveaway-user-poke']?.clear();
  });

  // Bouton "utilisateurs actifs" : ouvre la popup
  document.getElementById('btn-giveaway-active-users')?.addEventListener('click', showActiveUsers);

  // Fermer la popup : bouton OK
  document.getElementById('btn-active-users-close')?.addEventListener('click', closeActiveUsersModal);

  // Fermer la popup : clic en dehors
  document.getElementById('active-users-modal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeActiveUsersModal();
  });
}

// ── Modal utilisateurs actifs ─────────────────────────────────

async function showActiveUsers() {
  const modal = document.getElementById('active-users-modal');
  const listEl = document.getElementById('active-users-list');
  const countEl = document.getElementById('active-users-count');
  if (!modal || !listEl || !countEl) return;

  // Affiche la popup avec un état de chargement
  modal.style.display = 'flex';
  listEl.innerHTML = '<div class="adm-modal__empty">Chargement…</div>';
  countEl.textContent = '…';

  try {
    const text = await apiPost('Interface/GetActiveUser', {});
    let users = [];
    try {
      users = JSON.parse(text);
      // La réponse peut être doublement encodée : re-parser si c'est une string
      if (typeof users === 'string') users = JSON.parse(users);
    } catch (e) {
      console.log('[GetActiveUser] Erreur JSON.parse :', e);
    }
    if (!Array.isArray(users)) users = [];

    countEl.textContent = String(users.length);

    if (!users.length) {
      listEl.innerHTML = '<div class="adm-modal__empty">Aucun utilisateur actif.</div>';
      return;
    }

    listEl.innerHTML = users.map(u => `
      <div class="adm-modal__user">
        <span class="adm-modal__user-id">${escapeHtml(String(u.ID ?? ''))}</span>
        <span class="adm-modal__user-platform">${escapeHtml(String(u.Platform ?? ''))}</span>
        <span class="adm-modal__user-name">${escapeHtml(String(u.UserName ?? ''))}</span>
      </div>`).join('');
  } catch (e) {
    listEl.innerHTML = `<div class="adm-modal__empty">❌ ${escapeHtml(e.message)}</div>`;
    countEl.textContent = '0';
  }
}

function closeActiveUsersModal() {
  const modal = document.getElementById('active-users-modal');
  if (modal) modal.style.display = 'none';
}

// ── Populate helpers ─────────────────────────────────────────

function populateGiveawayUsers() {
  const items = ADM.users.map(u => ({
    value: JSON.stringify({ Pseudo: u.Pseudo, Platform: u.Platform, Code_user: u.Code_user ?? '' }),
    label: `[${u.Platform}] ${u.Pseudo}`,
  }));
  ADM.ss['giveaway-user-ball']?.setOptions(items);
  ADM.ss['giveaway-user-poke']?.setOptions(items);
}

function populateGiveawayBalls() {
  const items = ADM.balls.map(b => ({
    value: b.Name ?? b.name,
    label: b.Name ?? b.name,
  }));
  ADM.ss['giveaway-ball-name']?.setOptions(items);
}

function populateGiveawayCreatures() {
  const items = ADM.creatures
    .filter(c => c.enabled !== false)
    .map(c => ({
      value: c.AltName ?? c.Name_FR ?? c.Name_EN,
      label: c.Name_FR ?? c.Name_EN,
    }));
  ADM.ss['giveaway-poke-name']?.setOptions(items);
}

// ── Launch ball ──────────────────────────────────────────────

async function launchBall() {
  const respEl   = document.getElementById('resp-giveaway-ball');
  const userRaw  = ADM.ss['giveaway-user-ball']?.getValue();
  const ballName = ADM.ss['giveaway-ball-name']?.getValue();

  if (!userRaw || !ballName) {
    showResp(respEl, '❌ Sélectionnez un utilisateur et une ball.', 'error'); return;
  }

  let user;
  try { user = JSON.parse(userRaw); } catch { showResp(respEl, '❌ Utilisateur invalide.', 'error'); return; }

  const body = {
    UserName:    user.Pseudo,
    Platform:    user.Platform,
    UserCode:    user.Code_user ?? '',
    TriggerName: ballName,
  };
  try {
    const resp = await apiPost('Interface/LaunchBall', body);
    showResp(respEl, resp, 'ok');
  } catch (e) {
    showResp(respEl, `❌ ${e.message}`, 'error');
  }
}

// ── Give creature ─────────────────────────────────────────────

async function giveCreature() {
  const respEl   = document.getElementById('resp-giveaway-poke');
  const userRaw  = ADM.ss['giveaway-user-poke']?.getValue();
  const pokeName = ADM.ss['giveaway-poke-name']?.getValue();
  const shiny    = document.getElementById('giveaway-poke-shiny')?.checked ?? false;
  const allUsers = document.getElementById('giveaway-poke-all')?.checked ?? false;

  if (!pokeName) {
    showResp(respEl, '❌ Sélectionnez une créature.', 'error'); return;
  }

  let body;
  if (allUsers) {
    // Donner à tous les utilisateurs présents
    body = {
      UserName:    '+Here',
      Platform:    '',
      TriggerName: shiny ? `${pokeName}+True` : `${pokeName}+False`,
    };
  } else {
    if (!userRaw) {
      showResp(respEl, '❌ Sélectionnez un utilisateur et une créature.', 'error'); return;
    }
    let user;
    try { user = JSON.parse(userRaw); } catch { showResp(respEl, '❌ Utilisateur invalide.', 'error'); return; }
    body = {
      UserName:    user.Pseudo,
      Platform:    user.Platform,
      UserCode:    user.Code_user ?? '',
      TriggerName: shiny ? `${pokeName}+True` : `${pokeName}+False`,
    };
  }

  try {
    const resp = await apiPost('Interface/GiveAway', body);
    showResp(respEl, resp, 'ok');
  } catch (e) {
    showResp(respEl, `❌ ${e.message}`, 'error');
  }
}

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initGiveaway);