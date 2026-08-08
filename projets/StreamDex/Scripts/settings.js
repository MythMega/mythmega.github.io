// ============================================================
// PKServ Admin — settings.js
// Module Paramètres d'application
// ============================================================

'use strict';

let _currentSettings = null;

function initSettings() {
  document.getElementById('btn-settings-load')?.addEventListener('click', () => {
    withBtn(document.getElementById('btn-settings-load'), loadSettings);
  });
  document.getElementById('btn-settings-save')?.addEventListener('click', () => {
    withBtn(document.getElementById('btn-settings-save'), saveSettings);
  });
}

async function loadSettings() {
  const respEl = document.getElementById('resp-settings-load');
  const formEl = document.getElementById('settings-form');

  try {
    const text = await apiPost('Interface/GetAll/Settings', {});
    _currentSettings = JSON.parse(text);
    showResp(respEl, '✅ Paramètres chargés', 'ok');

    // Générer le formulaire
    if (formEl) {
      formEl.innerHTML = generateForm(_currentSettings);
      document.getElementById('settings-save-section').style.display = 'block';
    }
  } catch (e) {
    showResp(respEl, `❌ ${e.message}`, 'error');
  }
}

async function saveSettings() {
  const respEl = document.getElementById('resp-settings-save');

  try {
    // Collecter les valeurs du formulaire
    const updatedSettings = collectFormValues(_currentSettings);

    const resp = await apiPost('Interface/SetAll/Settings', updatedSettings);
    showResp(respEl, resp, resp.startsWith('✅') ? 'ok' : 'error');

    if (resp.startsWith('✅')) {
      _currentSettings = updatedSettings;
    }
  } catch (e) {
    showResp(respEl, `❌ ${e.message}`, 'error');
  }
}

function generateForm(settings, path = '') {
  let html = '';

  for (const [key, value] of Object.entries(settings)) {
    const fullPath = path ? `${path}.${key}` : key;
    const type = typeof value;

    if (value === null || value === undefined) {
      html += generateInput(key, fullPath, '', 'text');
    }
    else if (Array.isArray(value)) {
      html += generateArrayInput(key, fullPath, value);
    }
    else if (type === 'object') {
      html += `<div class="settings-group">`;
      html += `<h3 class="settings-group__title">${key}</h3>`;
      html += generateForm(value, fullPath);
      html += `</div>`;
    }
    else if (type === 'boolean') {
      html += generateCheckbox(key, fullPath, value);
    }
    else if (type === 'number') {
      html += generateInput(key, fullPath, value, 'number');
    }
    else {
      html += generateInput(key, fullPath, value, 'text');
    }
  }

  return html;
}

function generateInput(label, path, value, type) {
  return `
    <div class="adm-form-group">
      <label class="adm-label" for="setting-${path}">${label}</label>
      <input type="${type}" id="setting-${path}" class="adm-input" 
        value="${escapeHtml(value)}" data-path="${path}">
    </div>`;
}

function generateCheckbox(label, path, value) {
  return `
    <div class="adm-checkbox-row" style="margin:8px 0">
      <input type="checkbox" id="setting-${path}" data-path="${path}" ${value ? 'checked' : ''}>
      <label for="setting-${path}">${label}</label>
    </div>`;
}

function generateArrayInput(label, path, array) {
  let html = `
    <div class="settings-array" data-path="${path}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <label class="adm-label">${label} (${array.length} élément${array.length > 1 ? 's' : ''})</label>
        <button class="adm-btn adm-btn--sm adm-btn--success" onclick="addArrayItem('${path}')">➕ Ajouter</button>
      </div>
      <div class="settings-array__items" id="array-${path}">`;

  array.forEach((item, i) => {
    if (typeof item === 'object' && !Array.isArray(item)) {
      html += `
        <div class="settings-array__item">
          <button class="settings-array__remove" onclick="removeArrayItem('${path}', ${i})">🗑️</button>
          ${generateForm(item, `${path}[${i}]`)}
        </div>`;
    } else {
      html += `
        <div class="settings-array__item" style="display:flex;gap:8px;align-items:center">
          <input type="${typeof item === 'number' ? 'number' : 'text'}" 
            class="adm-input" value="${escapeHtml(item)}" 
            data-path="${path}[${i}]" style="flex:1">
          <button class="adm-btn adm-btn--sm adm-btn--danger" onclick="removeArrayItem('${path}', ${i})">🗑️</button>
        </div>`;
    }
  });

  html += `</div></div>`;
  return html;
}

function collectFormValues(settings) {
  const result = JSON.parse(JSON.stringify(settings)); // deep clone

  // Collecter tous les inputs
  document.querySelectorAll('[data-path]').forEach(el => {
    const path = el.dataset.path;
    let value;

    if (el.type === 'checkbox') {
      value = el.checked;
    } else if (el.type === 'number') {
      value = Number(el.value);
    } else {
      value = el.value;
    }

    setNestedValue(result, path, value);
  });

  return result;
}

function setNestedValue(obj, path, value) {
  const parts = path.split('.');
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const arrayMatch = part.match(/^(.+)\[(\d+)\]$/);

    if (arrayMatch) {
      const key = arrayMatch[1];
      const index = parseInt(arrayMatch[2]);
      if (!current[key]) current[key] = [];
      if (!current[key][index]) current[key][index] = {};
      current = current[key][index];
    } else {
      if (!current[part]) current[part] = {};
      current = current[part];
    }
  }

  const lastPart = parts[parts.length - 1];
  const arrayMatch = lastPart.match(/^(.+)\[(\d+)\]$/);

  if (arrayMatch) {
    const key = arrayMatch[1];
    const index = parseInt(arrayMatch[2]);
    if (!current[key]) current[key] = [];
    current[key][index] = value;
  } else {
    current[lastPart] = value;
  }
}

function addArrayItem(path) {
  const container = document.getElementById(`array-${path}`);
  if (!container) return;

  const itemCount = container.querySelectorAll('.settings-array__item').length;
  const newPath = `${path}[${itemCount}]`;

  const html = `
    <div class="settings-array__item" style="display:flex;gap:8px;align-items:center">
      <input type="text" class="adm-input" value="" data-path="${newPath}" style="flex:1">
      <button class="adm-btn adm-btn--sm adm-btn--danger" onclick="removeArrayItem('${path}', ${itemCount})">🗑️</button>
    </div>`;

  container.insertAdjacentHTML('beforeend', html);
}

function removeArrayItem(path, index) {
  const container = document.getElementById(`array-${path}`);
  if (!container) return;

  const items = container.querySelectorAll('.settings-array__item');
  if (items[index]) {
    items[index].remove();

    // Réindexer les items restants
    container.querySelectorAll('.settings-array__item').forEach((item, i) => {
      item.querySelectorAll('[data-path]').forEach(el => {
        el.dataset.path = el.dataset.path.replace(/\[\d+\]$/, `[${i}]`);
      });
    });
  }
}

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initSettings);
