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

    // Infos formatées du raid
    infoBox:        document.getElementById('raid-info-box'),
    bossSprite:     document.getElementById('raid-boss-sprite'),
    bossName:       document.getElementById('raid-boss-name-display'),
    bossAltName:    document.getElementById('raid-boss-altname'),
    bossRarity:     document.getElementById('raid-boss-rarity'),
    bossTypes:      document.getElementById('raid-boss-types'),
    bossShinyTag:   document.getElementById('raid-boss-shiny-tag'),
    bossPvMax:      document.getElementById('raid-boss-pvmax'),
    bossPvCurrent:  document.getElementById('raid-boss-pvcurrent'),
    startTime:      document.getElementById('raid-start-time'),
    elapsed:        document.getElementById('raid-elapsed'),
    historyLog:     document.getElementById('raid-history-log'),
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
  document.getElementById('btn-raid-random-boss')?.addEventListener('click', randomBoss);
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

// ── Helpers temps ────────────────────────────────────────────
function toTwo(n) { return String(n).padStart(2, '0'); }

function formatHMS(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${toTwo(h)}:${toTwo(m)}:${toTwo(s)}`;
}

function formatHM(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return `${toTwo(h)}:${toTwo(m)}`;
}

function parseTime(t) {
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d;
}

function formatTimeHM(d) {
  return d ? `${toTwo(d.getHours())}:${toTwo(d.getMinutes())}` : '—';
}

function formatTimeHMS(d) {
  return d ? `${toTwo(d.getHours())}:${toTwo(d.getMinutes())}:${toTwo(d.getSeconds())}` : '—';
}

const TYPE_ICONS = {
  fire:    '🔥', water:  '💧', grass:  '🌿', electric: '⚡',
  ice:     '❄️', fighting:'🥊', poison: '☠️', ground:   '⛰️',
  flying:  '🌀', psychic: '🔮', bug:    '🐛', rock:     '🪨',
  ghost:   '👻', dragon: '🐉', dark:   '🌑', steel:    '🔩',
  fairy:   '🧚', normal: '⭐',
};

function typeName(t) {
  const names = {
    fire: 'Feu', water: 'Eau', grass: 'Plante', electric: 'Électrik',
    ice: 'Glace', fighting: 'Combat', poison: 'Poison', ground: 'Sol',
    flying: 'Vol', psychic: 'Psy', bug: 'Insecte', rock: 'Roche',
    ghost: 'Spectre', dragon: 'Dragon', dark: 'Ténèbres', steel: 'Acier',
    fairy: 'Fée', normal: 'Normal',
  };
  return names[t] ?? t;
}

// ── Status ───────────────────────────────────────────────────
async function refreshRaidStatus() {
  try {
    const text = await apiGet('GetRaidStatus');
    let summary = '(aucun raid actif)';
    let type = 'info';
    if (text) {
      try {
        const info = JSON.parse(text);
        const boss = info.Boss || {};
        const name = boss.AltName || info.BossName || 'boss';
        const pv = info.PV ?? 0;
        summary = pv > 0
          ? `⚔️ Raid actif sur ${name}`
          : `💀 Raid sur ${name} terminé (vaincu)`;
        type = 'ok';
      } catch {
        summary = '✅ Statut du raid récupéré';
        type = 'ok';
      }
    }
    showResp(raidEls.respStatus, summary, type);
    await refreshRaidInfos(text);
  } catch (e) {
    showResp(raidEls.respStatus, `❌ ${e.message}`, 'error');
  }
}

// ── Formatage des infos complètes du raid ────────────────────
async function refreshRaidInfos(rawText = null) {
  // Utilise le texte déjà récupéré par GetRaidStatus si dispo,
  // sinon récupère GetRaidInfos pour la barre de PV (compat).
  let info = null;
  if (rawText) {
    try { info = JSON.parse(rawText); } catch { /* non-JSON */ }
  }

  if (!info) {
    try {
      const text = await apiGet('GetRaidInfos');
      if (!text || text === '{}') {
        setHpBar(0, 0);
        setRaidBadge(false);
        hideRaidInfos();
        return;
      }
      info = JSON.parse(text);
      setHpBar(info.Bar_CurrentValue ?? 0, info.Bar_Max ?? 0);
      setRaidBadge(true, info.Bar_CurrentValue, info.Bar_Max);
      return;
    } catch { /* silencieux */ }
  }

  // ── Barre de PV + badge ──
  const pv    = info.PV ?? info.Bar_CurrentValue ?? 0;
  const pvMax = info.PVMax ?? info.Bar_Max ?? 0;
  setHpBar(pv, pvMax);
  setRaidBadge(true, pv, pvMax);

  // ── Affichage des infos formatées ──
  if (!info.Boss) { hideRaidInfos(); return; }
  showRaidInfos(info, pv, pvMax);
}

function showRaidInfos(info, pv, pvMax) {
  const boss = info.Boss || {};
  const e = raidEls;

  // Sprite (shiny ou normal selon DisplayShiny)
  const spriteUrl = info.DisplayShiny
    ? (boss.Sprite_Shiny || boss.Sprite_Normal)
    : (boss.Sprite_Normal || boss.Sprite_Shiny);
  if (e.bossSprite) {
    e.bossSprite.src = spriteUrl || '';
    e.bossSprite.style.display = spriteUrl ? '' : 'none';
  }

  // Nom + AltName
  const name = info.BossName || boss.Name || '—';
  if (e.bossName) e.bossName.textContent = name;
  if (e.bossAltName) {
    e.bossAltName.textContent = boss.AltName && boss.AltName !== name ? boss.AltName : '';
  }

  // Tags rareté / types / shiny
  if (e.bossRarity) {
    e.bossRarity.textContent = boss.Rarity || '—';
    e.bossRarity.className = 'adm-tag' + (boss.Rarity === 'LEGENDARY' ? ' adm-tag--shiny' : '');
  }
  if (e.bossTypes) {
    const t1 = boss.Type1, t2 = boss.Type2;
    e.bossTypes.textContent = [t1, t2].filter(Boolean).map(t => `${TYPE_ICONS[t] || ''} ${typeName(t)}`).join(' / ') || '—';
  }
  if (e.bossShinyTag) {
    e.bossShinyTag.textContent = info.DisplayShiny ? '✨ Shiny' : 'Normal';
    e.bossShinyTag.className = 'adm-tag ' + (info.DisplayShiny ? 'adm-tag--shiny' : 'adm-tag--normal');
  }

  // PV
  if (e.bossPvMax)    e.bossPvMax.textContent    = (pvMax || 0).toLocaleString('fr-FR');
  if (e.bossPvCurrent) e.bossPvCurrent.textContent = (pv ?? 0).toLocaleString('fr-FR');

  // Temps
  const start = parseTime(info.StartedTime);
  if (e.startTime) e.startTime.textContent = start ? formatTimeHMS(start) : '—';

  // Durée actuelle (minuterie)
  if (e.elapsed) {
    e.elapsed.textContent = start ? formatHMS(Date.now() - start.getTime()) : '—';
  }

  // Journal du raid
  if (e.historyLog) renderRaidHistory(info.RaidDamagesHistory || []);

  // Affiche le bloc
  if (e.infoBox) e.infoBox.style.display = '';

  // Met à jour la durée toutes les secondes
  if (e.elapsed && start) {
    clearInterval(window.__raidElapsedTimer);
    window.__raidElapsedTimer = setInterval(() => {
      if (e.elapsed) e.elapsed.textContent = formatHMS(Date.now() - start.getTime());
    }, 1000);
  }
}

function hideRaidInfos() {
  if (raidEls.infoBox) raidEls.infoBox.style.display = 'none';
  if (raidEls.historyLog) raidEls.historyLog.innerHTML = '';
  clearInterval(window.__raidElapsedTimer);
}

function renderRaidHistory(history) {
  if (!history.length) {
    raidEls.historyLog.innerHTML = '<div class="adm-raid-log__empty">Aucune action dans le journal.</div>';
    return;
  }

  // Date basale pour formater les heures
  const base = new Date();

  const items = history.map(h => {
    const user = h.User || {};
    const pseudo = user.Pseudo || '—';
    const dmg    = h.Damages || 0;
    const heal   = !!h.Heal;
    const crit   = !!h.Critical;
    const at     = parseTime(h.At) || base;
    const hm     = `${toTwo(at.getHours())}:${toTwo(at.getMinutes())}:${toTwo(at.getSeconds())}`;
    const pvAfter = h.PvAfter != null ? `<span class="adm-raid-log__pv">PV ${Number(h.PvAfter).toLocaleString('fr-FR')}</span>` : '';

    let action = '';
    let cls = '';
    if (heal) {
      action = '💊 soigne le groupe';
      cls = 'heal';
    } else if (dmg > 0) {
      action = `inflige <strong>${Number(dmg).toLocaleString('fr-FR')}</strong> dégâts ${crit ? '💥 critique' : ''}`;
      cls = crit ? 'crit' : 'dmg';
    } else {
      action = 'admire le paysage';
      cls = 'none';
    }

    const statutMsg = h.StatusEffect
      ? `<div class="adm-raid-log__statut">⚠️ ${escapeHtml(h.StatusEffect)}</div>`
      : '';

    return `<div class="adm-raid-log__item ${cls}">
      <span class="adm-raid-log__time">${hm}</span>
      <span class="adm-raid-log__pseudo">${escapeHtml(pseudo)}</span>
      <span class="adm-raid-log__action">${action}</span>
      ${pvAfter}
      ${statutMsg}
    </div>`;
  });

  raidEls.historyLog.innerHTML = items.join('');
  // Scroll vers le bas (dernière action)
  raidEls.historyLog.scrollTop = raidEls.historyLog.scrollHeight;
}

function escapeHtml(s) {
  const AMP = String.fromCharCode(38), LT = String.fromCharCode(60), GT = String.fromCharCode(62);
  return String(s)
    .replace(new RegExp(AMP, 'g'), AMP + 'amp;')
    .replace(new RegExp(LT, 'g'), AMP + 'lt;')
    .replace(new RegExp(GT, 'g'), AMP + 'gt;')
    .replace(/"/g, AMP + 'quot;')
    .replace(/'/g, AMP + '#039;');
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

// ── Random boss ───────────────────────────────────────────────
function randomBoss() {
  const options = ADM.ss['raid-boss-name']?._items || [];
  if (!options.length) {
    showResp(raidEls.respFull, '❌ pas de pokémon dans la liste', 'error');
    return;
  }
  const pick = options[Math.floor(Math.random() * options.length)];
  ADM.ss['raid-boss-name'].setValue(pick.value);
}

// ── Start full (Interface/Raid/Start) ─────────────────────────
async function startFullRaid() {
  const bossName = ADM.ss['raid-boss-name']?.getValue();
  const pvMax    = parseInt(document.getElementById('raid-boss-pv')?.value)  || null;
  const shiny    = !!document.getElementById('raid-boss-shiny-switch')?.checked;

  if (!bossName) { showResp(raidEls.respFull, '❌ Sélectionnez un boss.', 'error'); return; }

  const body = {
    BossName:     bossName,
    PVMax:        pvMax,
    DisplayShiny: shiny,
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
    hideRaidInfos();
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