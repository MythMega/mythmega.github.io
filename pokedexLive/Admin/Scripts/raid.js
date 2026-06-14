// ============================================================
// PKServ Admin — raid.js
// Module Raid : status, start simple, start complet, cancel, boost
// ============================================================

'use strict';

// ── Elements ─────────────────────────────────────────────────
let raidEls = {};

function initRaid() {
  raidEls = {
    statusBox:  document.getElementById('raid-status-box'),
    hpFill:     document.getElementById('raid-hp-fill'),
    hpLabel:    document.getElementById('raid-hp-label'),
    hpBadge:    document.getElementById('raid-status-badge'),
    respStatus: document.getElementById('resp-raid-status'),
    respSimple: document.getElementById('resp-raid-simple'),
    respFull:   document.getElementById('resp-raid-full'),
    respCancel: document.getElementById('resp-raid-cancel'),
    respBoost:  document.getElementById('resp-raid-boost'),
  };

  // SearchableSelect pour le boss du raid complet
  ADM.ss['raid-boss-name'] = new SearchableSelect('ss-raid-boss-name', 'raid-boss-name', 'Nom du boss…');

  // Buttons
  document.getElementById('btn-raid-refresh')?.addEventListener('click', refreshRaidStatus);
  document.getElementById('btn-raid-simple')?.addEventListener('click', () => {
    withBtn(document.getElementById('btn-raid-simple'), startSimpleRaid);
  });
  document.getElementById('btn-raid-full')?.addEventListener('click', () => {
    withBtn(document.getElementById('btn-raid-full'), startFullRaid);
  });
  document.getElementById('btn-raid-cancel')?.addEventListener('click', () => {
    withBtn(document.getElementById('btn-raid-cancel'), cancelRaid);
  });
  document.getElementById('btn-raid-boost')?.addEventListener('click', () => {
    withBtn(document.getElementById('btn-raid-boost'), sendBoost);
  });

  // Auto-refresh status on tab open
  document.querySelector('[data-tab="raid"]')?.addEventListener('click', refreshRaidStatus);

  // Populate creature select when data arrives
  addEventListener('adm:creatures-loaded', populateCreatureSelect);
  if (ADM.creatures.length) populateCreatureSelect();
}

// ── Populate select ──────────────────────────────────────────
function populateCreatureSelect() {
  ADM.ss['raid-boss-name']?.setOptions(
    ADM.creatures.map(c => ({
      value: c.Name_FR ?? c.Name_EN,
      label: `${c.Name_FR ?? c.Name_EN}${c.Rarity ? ' (' + c.Rarity + ')' : ''}`,
    }))
  );
}

// ── Status ───────────────────────────────────────────────────
async function refreshRaidStatus() {
  try {
    const text = await apiGet('GetRaidStatus');
    showResp(raidEls.respStatus, text || '(aucun raid actif)', text ? 'ok' : 'info');
    await refreshRaidInfos();
  } catch (e) {
    showResp(raidEls.respStatus, `❌ ${e.message}`, 'error');
  }
}

async function refreshRaidInfos() {
  try {
    const text = await apiGet('GetRaidInfos');
    if (!text || text === '{}') {
      setHpBar(0, 0);
      setRaidBadge(false);
      return;
    }
    const info = JSON.parse(text);
    setHpBar(info.Bar_CurrentValue ?? 0, info.Bar_Max ?? 0);
    setRaidBadge(true, info.Bar_CurrentValue, info.Bar_Max);
  } catch { /* silencieux */ }
}

function setHpBar(current, max) {
  if (!raidEls.hpFill) return;
  const pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
  raidEls.hpFill.style.width = `${pct}%`;
  raidEls.hpFill.className = 'adm-hp-fill' +
    (pct < 25 ? ' danger' : pct < 50 ? ' warn' : '');
  if (raidEls.hpLabel)
    raidEls.hpLabel.textContent = `${current.toLocaleString('fr-FR')} / ${max.toLocaleString('fr-FR')} PV`;
}

function setRaidBadge(active, current, max) {
  if (!raidEls.hpBadge) return;
  if (active && current > 0) {
    raidEls.hpBadge.className = 'adm-badge adm-badge--active';
    raidEls.hpBadge.textContent = '⚔️ Raid actif';
  } else if (active && current === 0) {
    raidEls.hpBadge.className = 'adm-badge adm-badge--warn';
    raidEls.hpBadge.textContent = '💀 Vaincu';
  } else {
    raidEls.hpBadge.className = 'adm-badge adm-badge--idle';
    raidEls.hpBadge.textContent = '😴 Aucun raid';
  }
}

// ── Start simple (ManualRandomRaid) ─────────────────────────
async function startSimpleRaid() {
  const overrideRaw = document.getElementById('raid-simple-override')?.value?.trim();
  let override = null;
  if (overrideRaw) {
    try { override = JSON.parse(overrideRaw); }
    catch { showResp(raidEls.respSimple, '❌ Override JSON invalide.', 'error'); return; }
  }

  const body = {
    UserTrigger: { Pseudo: 'admin', Platform: 'admin', Code_user: 'admin' },
    ManualRandomRaid: override ?? null,
  };
  try {
    const resp = await apiPost('Raid/StartManualRandomRaid', body);
    showResp(raidEls.respSimple, resp, 'ok');
    setTimeout(refreshRaidStatus, 400);
  } catch (e) {
    showResp(raidEls.respSimple, `❌ ${e.message}`, 'error');
  }
}

// ── Start full (Interface/Raid/Start) ─────────────────────────
async function startFullRaid() {
  const bossName = ADM.ss['raid-boss-name']?.getValue();
  const pvMax    = parseInt(document.getElementById('raid-boss-pv')?.value)     || null;
  const catchR   = parseInt(document.getElementById('raid-boss-catch')?.value)  || null;
  const shinyR   = parseInt(document.getElementById('raid-boss-shiny')?.value)  || null;

  if (!bossName) { showResp(raidEls.respFull, '❌ Sélectionnez un boss.', 'error'); return; }

  const body = {
    BossName:  bossName,
    PVMax:     pvMax,
    CatchRate: catchR,
    ShinyRate: shinyR,
  };
  try {
    const resp = await apiPost('Interface/Raid/Start', body);
    showResp(raidEls.respFull, resp, 'ok');
    setTimeout(refreshRaidStatus, 400);
  } catch (e) {
    showResp(raidEls.respFull, `❌ ${e.message}`, 'error');
  }
}

// ── Cancel ───────────────────────────────────────────────────
async function cancelRaid() {
  try {
    const resp = await apiPost('Interface/Raid/Cancel', {});
    showResp(raidEls.respCancel, resp, 'ok');
    setHpBar(0, 0);
    setRaidBadge(false);
  } catch (e) {
    showResp(raidEls.respCancel, `❌ ${e.message}`, 'error');
  }
}

// ── Boost ─────────────────────────────────────────────────────
async function sendBoost() {
  const mult    = parseInt(document.getElementById('boost-mult')?.value)  || 2;
  const minutes = parseInt(document.getElementById('boost-min')?.value);

  const body = { Multiplicator: mult, Minute: isNaN(minutes) ? null : minutes };
  try {
    const resp = await apiPost('Interface/Raid/Boost/Set', body);
    showResp(raidEls.respBoost, resp || `✅ Boost ×${mult} envoyé.`, 'ok');
  } catch (e) {
    showResp(raidEls.respBoost, `❌ ${e.message}`, 'error');
  }
}

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initRaid);
