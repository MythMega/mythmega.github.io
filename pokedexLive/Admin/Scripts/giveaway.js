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

  // Charger les balls uniquement quand le port est connu
  addEventListener('adm:config-loaded', loadBalls);

  // Populate creature select
  addEventListener('adm:creatures-loaded', populateGiveawayCreatures);
  if (ADM.creatures.length) populateGiveawayCreatures();

  // Buttons
  document.getElementById('btn-giveaway-ball')?.addEventListener('click', () => {
    withBtn(document.getElementById('btn-giveaway-ball'), launchBall);
  });
  document.getElementById('btn-giveaway-poke')?.addEventListener('click', () => {
    withBtn(document.getElementById('btn-giveaway-poke'), giveCreature);
  });
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

async function loadBalls() {
  try {
    const text  = await apiPost('Interface/GetAll/Balls', {});
    const balls = JSON.parse(text);
    ADM.ss['giveaway-ball-name']?.setOptions(
      balls.map(b => ({ value: b.Name, label: b.Name }))
    );
  } catch { /* silencieux */ }
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

  if (!userRaw || !pokeName) {
    showResp(respEl, '❌ Sélectionnez un utilisateur et une créature.', 'error'); return;
  }

  let user;
  try { user = JSON.parse(userRaw); } catch { showResp(respEl, '❌ Utilisateur invalide.', 'error'); return; }

  const body = {
    UserName:    user.Pseudo,
    Platform:    user.Platform,
    UserCode:    user.Code_user ?? '',
    TriggerName: shiny ? `${pokeName}_shiny` : pokeName,
  };
  try {
    const resp = await apiPost('Interface/GiveAway', body);
    showResp(respEl, resp, 'ok');
  } catch (e) {
    showResp(respEl, `❌ ${e.message}`, 'error');
  }
}

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initGiveaway);


'use strict';

function initGiveaway() {
  // Populate user selects when data arrives
  addEventListener('adm:users-loaded', populateGiveawayUsers);
  if (ADM.users.length) populateGiveawayUsers();

  // Charger les balls uniquement quand le port est connu
  addEventListener('adm:config-loaded', loadBalls);

  // Populate creature select
  addEventListener('adm:creatures-loaded', populateGiveawayCreatures);
  if (ADM.creatures.length) populateGiveawayCreatures();

  // Buttons
  document.getElementById('btn-giveaway-ball')?.addEventListener('click', () => {
    withBtn(document.getElementById('btn-giveaway-ball'), launchBall);
  });
  document.getElementById('btn-giveaway-poke')?.addEventListener('click', () => {
    withBtn(document.getElementById('btn-giveaway-poke'), giveCreature);
  });
}

// ── Populate helpers ─────────────────────────────────────────

function populateGiveawayUsers() {
  ['giveaway-user-ball', 'giveaway-user-poke'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">— Choisir un utilisateur —</option>';
    ADM.users.forEach(u => {
      const opt = document.createElement('option');
      opt.value = JSON.stringify({ Pseudo: u.Pseudo, Platform: u.Platform, Code_user: u.Code_user ?? '' });
      opt.textContent = `[${u.Platform}] ${u.Pseudo}`;
      sel.appendChild(opt);
    });
    if (prev) sel.value = prev;
  });
}

async function loadBalls() {
  try {
    const text = await apiPost('Interface/GetAll/Balls', {});
    const balls = JSON.parse(text);
    const sel = document.getElementById('giveaway-ball-name');
    if (!sel) return;
    sel.innerHTML = '';
    balls.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.Name;
      opt.textContent = b.Name;
      sel.appendChild(opt);
    });
  } catch { /* silencieux */ }
}

function populateGiveawayCreatures() {
  const sel = document.getElementById('giveaway-poke-name');
  if (!sel) return;
  sel.innerHTML = '';
  ADM.creatures.filter(c => c.enabled !== false).forEach(c => {
    const name = c.AltName ?? c.Name_FR ?? c.Name_EN;
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = `${c.Name_FR ?? c.Name_EN}`;
    sel.appendChild(opt);
  });
}

// ── Launch ball ──────────────────────────────────────────────

async function launchBall() {
  const respEl   = document.getElementById('resp-giveaway-ball');
  const userRaw  = document.getElementById('giveaway-user-ball')?.value;
  const ballName = document.getElementById('giveaway-ball-name')?.value;

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
  const respEl  = document.getElementById('resp-giveaway-poke');
  const userRaw = document.getElementById('giveaway-user-poke')?.value;
  const pokeName = document.getElementById('giveaway-poke-name')?.value;
  const shiny   = document.getElementById('giveaway-poke-shiny')?.checked ?? false;

  if (!userRaw || !pokeName) {
    showResp(respEl, '❌ Sélectionnez un utilisateur et une créature.', 'error'); return;
  }

  let user;
  try { user = JSON.parse(userRaw); } catch { showResp(respEl, '❌ Utilisateur invalide.', 'error'); return; }

  const body = {
    UserName:    user.Pseudo,
    Platform:    user.Platform,
    UserCode:    user.Code_user ?? '',
    TriggerName: shiny ? `${pokeName}_shiny` : pokeName,
  };
  try {
    const resp = await apiPost('Interface/GiveAway', body);
    showResp(respEl, resp, 'ok');
  } catch (e) {
    showResp(respEl, `❌ ${e.message}`, 'error');
  }
}

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initGiveaway);
