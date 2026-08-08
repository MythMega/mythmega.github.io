// ============================================================
// PKServ Admin — system.js
// Module Système : FullExport, GenerateAvailableDex
// ============================================================

'use strict';

function initSystem() {
  document.getElementById('btn-sys-export')?.addEventListener('click', () => {
    withBtn(document.getElementById('btn-sys-export'), doFullExport);
  });
  document.getElementById('btn-sys-export-force')?.addEventListener('click', () => {
    withBtn(document.getElementById('btn-sys-export-force'), doFullExportForce);
  });
  document.getElementById('btn-sys-availdex')?.addEventListener('click', () => {
    withBtn(document.getElementById('btn-sys-availdex'), doAvailableDex);
  });
  document.getElementById('btn-sys-reload')?.addEventListener('click', () => {
    withBtn(document.getElementById('btn-sys-reload'), doReloadData);
  });
  document.getElementById('btn-sys-change-port')?.addEventListener('click', () => {
    doChangePort();
  });
}

async function doFullExport() {
  const respEl = document.getElementById('resp-sys-export');
  try {
    const body = { TriggerName: 'API_FWE', UserName: 'admin', Platform: 'admin', UserCode: 'admin' };
    const resp = await apiPost('Interface/FullExport', body);
    showResp(respEl, resp, 'ok');
  } catch (e) {
    showResp(respEl, `❌ ${e.message}`, 'error');
  }
}

async function doFullExportForce() {
  const respEl = document.getElementById('resp-sys-export');
  try {
    const body = { TriggerName: 'API_FWE_Force', UserName: 'admin', Platform: 'admin', UserCode: 'admin' };
    const resp = await apiPost('Interface/FullExport', body);
    showResp(respEl, resp, 'ok');
  } catch (e) {
    showResp(respEl, `❌ ${e.message}`, 'error');
  }
}

async function doAvailableDex() {
  const respEl = document.getElementById('resp-sys-availdex');
  try {
    const body = { TriggerName: 'admin', UserName: 'admin', Platform: 'admin', UserCode: 'admin' };
    const resp = await apiPost('Interface/GenerateAvailableDex', body);
    showResp(respEl, resp, 'ok');
  } catch (e) {
    showResp(respEl, `❌ ${e.message}`, 'error');
  }
}

async function doReloadData() {
  const respEl = document.getElementById('resp-sys-reload');
  try {
    const resp = await apiPost('System/ReloadData', {});
    showResp(respEl, resp, 'ok');
  } catch (e) {
    showResp(respEl, `❌ ${e.message}`, 'error');
  }
}

function doChangePort() {
  const respEl = document.getElementById('resp-sys-change-port');
  const input = document.getElementById('sys-change-port');

  if (!input) {
    showResp(respEl, '⚠️ Champ introuvable', 'error');
    return;
  }

  const newPort = Number(input.value);

  if (!newPort || newPort < 1 || newPort > 65535) {
    showResp(respEl, '⚠️ Port invalide (1-65535)', 'error');
    return;
  }

  if (changePort(newPort)) {
    showResp(respEl, `✅ Port changé vers ${newPort}. Rechargement des données…`, 'ok');
    input.value = '';

    // Recharger les données avec le nouveau port
    setTimeout(() => {
      const respUsers = document.getElementById('resp-users');
      const respCreatures = document.getElementById('resp-creatures');
      loadUsers(respUsers);
      loadCreatures(respCreatures);
    }, 500);
  } else {
    showResp(respEl, '❌ Impossible de changer le port', 'error');
  }
}

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initSystem);
