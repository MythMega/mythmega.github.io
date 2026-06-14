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

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initSystem);
