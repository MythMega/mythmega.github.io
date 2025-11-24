// data.js
// Gestion export / import des cookies pk_daily_result_v2 et pk_best
const DataManager = (function () {
  const COOKIE_DAILY = 'pk_daily_result_v2';
  const COOKIE_BEST = 'pk_best';
  const EXPORT_VERSION = 'v1';

  // --- cookie helpers (compatible avec le reste du projet) ---
  function setCookie(name, value, days = 3650) {
    const d = new Date();
    d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = `${name}=${encodeURIComponent(value)};expires=${d.toUTCString()};path=/`;
  }
  function getCookie(name) {
    const v = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
    return v ? decodeURIComponent(v.pop()) : null;
  }

  // --- simple FNV-1a 32-bit hash, returns hex string ---
  function fnv1a32Hex(str) {
    let h = 0x811c9dc5; // FNV offset basis
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
      h >>>= 0;
    }
    return ('0000000' + (h >>> 0).toString(16)).slice(-8);
  }

  // --- build export payload (JSON canonical) ---
  function buildPayloadObj() {
    const dailyRaw = getCookie(COOKIE_DAILY);
    let daily = {};
    try {
      if (dailyRaw) {
        const parsed = JSON.parse(dailyRaw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) daily = parsed;
      }
    } catch (e) {
      // ignore parse errors, keep empty
      daily = {};
    }

    const bestRaw = getCookie(COOKIE_BEST);
    let best = null;
    if (bestRaw !== null && bestRaw !== undefined && bestRaw !== '') {
      const n = parseInt(bestRaw, 10);
      if (!Number.isNaN(n)) best = n;
    }

    return { daily, best };
  }

  // --- create export file content ---
  function createExportText() {
    const payload = buildPayloadObj();
    const payloadJson = JSON.stringify(payload);
    const hash = fnv1a32Hex(payloadJson);
    const now = new Date();
    const iso = now.toISOString();
    const header = `POKEFEET_SAVE ${EXPORT_VERSION}\nExported: ${iso}\n---DATA---\n`;
    const footer = `\n---HASH---\n${hash}\n`;
    return header + payloadJson + footer;
  }

  // --- trigger download ---
  function downloadText(filename, text) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // --- parse imported file content ---
  function parseImportText(text) {
    // Expect format: header, ---DATA---, JSON, ---HASH---, hash
    const parts = text.split('---DATA---');
    if (parts.length < 2) return { error: 'Format invalide' };
    const afterData = parts[1];
    const sub = afterData.split('---HASH---');
    if (sub.length < 2) return { error: 'Format invalide (hash manquant)' };
    const jsonStr = sub[0].trim();
    const hashStr = sub[1].trim().split(/\s+/)[0];
    try {
      const payload = JSON.parse(jsonStr);
      return { payload, jsonStr, hashStr };
    } catch (e) {
      return { error: 'JSON invalide dans le fichier' };
    }
  }

  // --- notifications (réutilise .notification style) ---
  function notify(msg, type = 'info') {
    const container = document.getElementById('notifications');
    if (!container) return;
    const n = document.createElement('div');
    n.className = 'notification';
    n.textContent = msg;
    if (type === 'fail') n.style.background = '#491111';
    if (type === 'hint') n.style.background = '#334155';
    container.appendChild(n);
    setTimeout(() => {
      n.style.opacity = 0;
      try { container.removeChild(n); } catch (e) {}
    }, 2200);
  }

  // --- merge logic ---
  async function mergePayloadIntoCookies(payload) {
    // payload: { daily: {...}, best: number|null }
    const existingDailyRaw = getCookie(COOKIE_DAILY);
    let existingDaily = {};
    try {
      if (existingDailyRaw) {
        const parsed = JSON.parse(existingDailyRaw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) existingDaily = parsed;
      }
    } catch (e) {
      existingDaily = {};
    }

    const fileDaily = payload.daily || {};
    const conflicts = []; // array of {date, fileEntry, cookieEntry}

    // detect conflicts and additions
    Object.keys(fileDaily).forEach(date => {
      const fileEntry = fileDaily[date];
      const cookieEntry = existingDaily[date];
      if (cookieEntry === undefined) {
        // add directly
        existingDaily[date] = fileEntry;
      } else {
        // conflict: both exist
        // compare score and results; if identical, ignore; else push conflict
        const same = JSON.stringify(cookieEntry) === JSON.stringify(fileEntry);
        if (!same) {
          conflicts.push({ date, fileEntry, cookieEntry });
        }
      }
    });

    // resolve conflicts with confirm dialogs (one by one)
    for (let i = 0; i < conflicts.length; i++) {
      const c = conflicts[i];
      // build message
      const msg = `Conflit pour la date ${c.date}:\nFichier -> score: ${c.fileEntry.score}\nCookie -> score: ${c.cookieEntry.score}\n\nCliquer OK pour garder la valeur du FICHIER (écraser), Annuler pour garder la valeur du COOKIE.`;
      const keepFile = confirm(msg);
      if (keepFile) {
        existingDaily[c.date] = c.fileEntry;
      } else {
        // keep cookie: do nothing
      }
    }

    // write back cookie
    try {
      setCookie(COOKIE_DAILY, JSON.stringify(existingDaily), 3650);
    } catch (e) {
      notify('Impossible d\'écrire le cookie daily', 'fail');
      return false;
    }

    // handle best
    const fileBest = (typeof payload.best === 'number') ? payload.best : null;
    const existingBestRaw = getCookie(COOKIE_BEST);
    let existingBest = null;
    if (existingBestRaw !== null && existingBestRaw !== undefined && existingBestRaw !== '') {
      const n = parseInt(existingBestRaw, 10);
      if (!Number.isNaN(n)) existingBest = n;
    }

    if (fileBest !== null && existingBest === null) {
      // set cookie from file
      setCookie(COOKIE_BEST, String(fileBest), 3650);
    } else if (fileBest !== null && existingBest !== null) {
      if (fileBest !== existingBest) {
        const keepFileBest = confirm(`Conflit pour "best" :\nFichier = ${fileBest}\nCookie = ${existingBest}\n\nOK = garder la valeur du FICHIER (écraser), Annuler = garder la valeur du COOKIE.`);
        if (keepFileBest) {
          setCookie(COOKIE_BEST, String(fileBest), 3650);
        } else {
          // keep cookie
        }
      }
    }

    return true;
  }

  // --- public handlers ---
  function onExportClick() {
    const text = createExportText();
    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0,19);
    const filename = `pokefeet_save_${stamp}.txt`;
    downloadText(filename, text);
    notify('Export terminé', 'success');
  }

  function onFileSelected(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function (e) {
      const txt = String(e.target.result || '');
      const parsed = parseImportText(txt);
      if (parsed.error) {
        notify('Fichier invalide: ' + parsed.error, 'fail');
        return;
      }
      // verify hash
      const computed = fnv1a32Hex(parsed.jsonStr);
      if (computed !== parsed.hashStr) {
        notify('Erreur: le fichier a été modifié, c\'est vilain de tricher', 'fail');
        return;
      }
      // merge
      const ok = await mergePayloadIntoCookies(parsed.payload);
      if (ok) {
        notify('Import terminé et fusionné', 'success');
        // update preview area
        renderCurrentCookiesPreview();
      } else {
        notify('Import échoué', 'fail');
      }
    };
    reader.onerror = function () {
      notify('Impossible de lire le fichier', 'fail');
    };
    reader.readAsText(file, 'utf-8');
  }

  // --- preview current cookies (for debug / user) ---
  function renderCurrentCookiesPreview() {
    const preview = document.getElementById('dataPreview');
    const payload = buildPayloadObj();
    const pretty = JSON.stringify(payload, null, 2);
    if (preview) preview.textContent = pretty;
  }

  // --- init bindings ---
  function init() {
    const exportBtn = document.getElementById('exportBtn');
    const importFile = document.getElementById('importFile');
    const previewBtn = document.getElementById('previewBtn');

    if (exportBtn) exportBtn.addEventListener('click', onExportClick);
    if (importFile) {
      importFile.addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (f) onFileSelected(f);
        // reset input so same file can be reselected later
        importFile.value = '';
      });
    }

    if (previewBtn) previewBtn.addEventListener('click', renderCurrentCookiesPreview);

    // initial preview
    renderCurrentCookiesPreview();
  }

  return {
    init
  };
})();
