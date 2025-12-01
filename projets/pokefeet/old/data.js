// data.js
// Gestion stockage : IndexedDB pour pk_daily_result_v2, cookie pour pk_best
const DataManager = (function () {
  const COOKIE_DAILY = 'pk_daily_result_v2';
  const COOKIE_BEST = 'pk_best';
  const EXPORT_VERSION = 'v1';
  const DB_NAME = 'PokefeetDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'daily_results';
  const COUNT = 5;
  const basePoints = 10;
  const hintPenalty = 2;
  const maxAttempts = 5; // used for fail marker when importing (consistent with daily.js)

  // --- IndexedDB helpers ---
  let dbInstance = null;

  function getDB() {
    return new Promise((resolve, reject) => {
      if (dbInstance) {
        resolve(dbInstance);
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        dbInstance = req.result;
        resolve(dbInstance);
      };
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'date' });
        }
      };
    });
  }

  // Get all daily records from IndexedDB as object {date: {...}}
  async function getAllDailyFromDB() {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const arr = req.result;
        const obj = {};
        arr.forEach(item => {
          const date = item.date;
          const { score, results } = item;
          obj[date] = { score, results };
        });
        resolve(obj);
      };
      req.onerror = () => reject(req.error);
    });
  }

  // Save daily records to IndexedDB from object {date: {...}}
  async function saveDailyToDB(dailyObj) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      
      // Clear and rewrite all
      const clearReq = store.clear();
      clearReq.onsuccess = () => {
        for (const date in dailyObj) {
          if (dailyObj.hasOwnProperty(date)) {
            store.put({
              date: date,
              ...dailyObj[date]
            });
          }
        }
      };

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

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

  // --- build export payload (reads from IndexedDB + cookie) ---
  async function buildPayloadObj() {
    let daily = {};
    try {
      daily = await getAllDailyFromDB();
    } catch (e) {
      console.error('Error reading from IndexedDB:', e);
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

  // --- create export file content (async) ---
  async function createExportText() {
    const payload = await buildPayloadObj();
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

  // --- daily storage helpers (now using IndexedDB) ---
  async function saveDailyCookie(historyObj) {
    try {
      await saveDailyToDB(historyObj);
    } catch (e) {
      console.error('Impossible de sauvegarder l\'historique daily', e);
    }
  }
  async function loadDailyCookie() {
    try {
      const data = await getAllDailyFromDB();
      if (data && typeof data === 'object' && !Array.isArray(data)) return data;
      return null;
    } catch (e) {
      console.error('Error loading daily from IndexedDB:', e);
      return null;
    }
  }

  // --- merge logic for full-file import (writes to IndexedDB + cookie) ---
  async function mergePayloadIntoCookies(payload) {
    // payload: { daily: {...}, best: number|null }
    // Read existing data from IndexedDB
    let existingDaily = {};
    try {
      existingDaily = await getAllDailyFromDB();
    } catch (e) {
      console.error('Error reading from IndexedDB during merge:', e);
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
        const same = JSON.stringify(cookieEntry) === JSON.stringify(fileEntry);
        if (!same) {
          conflicts.push({ date, fileEntry, cookieEntry });
        }
      }
    });

    // resolve conflicts with confirm dialogs (one by one)
    for (let i = 0; i < conflicts.length; i++) {
      const c = conflicts[i];
      const msg = `Conflit pour la date ${c.date}:\nFichier -> score: ${c.fileEntry.score}\nCookie -> score: ${c.cookieEntry.score}\n\nCliquer OK pour garder la valeur du FICHIER (écraser), Annuler pour garder la valeur du COOKIE.`;
      const keepFile = confirm(msg);
      if (keepFile) {
        existingDaily[c.date] = c.fileEntry;
      } else {
        // keep cookie: do nothing
      }
    }

    // write back to IndexedDB
    try {
      await saveDailyToDB(existingDaily);
    } catch (e) {
      notify('Impossible d\'écrire dans IndexedDB', 'fail');
      return false;
    }

    // handle best (stays in cookie)
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

  // --- public handlers for full-file export/import ---
  async function onExportClick() {
    const text = await createExportText();
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
  async function renderCurrentCookiesPreview() {
    const preview = document.getElementById('dataPreview');
    const payload = await buildPayloadObj();
    const pretty = JSON.stringify(payload, null, 2);
    if (preview) {
      preview.style.display = 'block';
      preview.textContent = pretty;
    }
  }

  // --- parse a pasted Daily text (emoji or :code:) ---
  function normalizeLineToEmoji(line) {
    if (!line) return '';
    // replace colon codes by emoji
    let s = line.replace(/:green_square:/gi, '🟩')
                .replace(/:orange_square:/gi, '🟧')
                .replace(/:red_square:/gi, '🟥')
                .replace(/:green:/gi, '🟩')
                .replace(/:orange:/gi, '🟧')
                .replace(/:red:/gi, '🟥');
    // also accept textual words (green_square etc)
    s = s.replace(/green_square/gi, '🟩')
         .replace(/orange_square/gi, '🟧')
         .replace(/red_square/gi, '🟥');
    return s;
  }

  function parseDailyText(text) {
    if (!text || typeof text !== 'string') return { error: 'Texte vide' };
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 6) return { error: 'Format invalide : attendu header + 5 lignes d\'emoji' };

    // header: try to extract date and score
    // accept "PokéPied Daily — 2025-11-24 — score 38" with dash or em-dash
    const header = lines[0];
    const headerRegex = /Pok[eé]Pied Daily\s*[-—–]\s*(\d{4}-\d{2}-\d{2})\s*[-—–]\s*score\s*(\d+)/i;
    const m = header.match(headerRegex);
    if (!m) return { error: 'En-tête invalide. Format attendu : "PokéPied Daily — YYYY-MM-DD — score N"' };
    const dateStr = m[1];
    const declaredScore = parseInt(m[2], 10);

    // next 5 lines are the emoji rows (we accept more but take first 5)
    const rows = lines.slice(1, 1 + COUNT);
    if (rows.length < COUNT) return { error: 'Il faut 5 lignes d\'emoji après l\'en-tête' };

    const results = [];
    let computedScore = 0;

    for (let i = 0; i < COUNT; i++) {
      const raw = rows[i];
      const normalized = normalizeLineToEmoji(raw);
      // count occurrences
      const greens = (normalized.match(/🟩/g) || []).length;
      const oranges = (normalized.match(/🟧/g) || []).length;
      const reds = (normalized.match(/🟥/g) || []).length;

      // validation: each line should contain exactly 5 squares (sum)
      if (greens + oranges + reds !== 5) {
        return { error: `Ligne ${i+1} invalide : attendu 5 carrés (ligne: "${raw}")` };
      }

      if (reds === 5) {
        // fail
        results.push({ outcome: 'fail', attempts: maxAttempts });
        // no points
      } else {
        // win: number of oranges equals number of failed attempts before success
        const attempts = oranges; // 0..4
        results.push({ outcome: 'win', attempts });
        const pts = Math.max(basePoints - attempts * hintPenalty, 0);
        computedScore += pts;
      }
    }

    // optional: compare computedScore with declaredScore; if mismatch, warn but still allow
    const scoreMismatch = (computedScore !== declaredScore);

    return { date: dateStr, score: computedScore, declaredScore, scoreMismatch, results };
  }

  // --- import daily from textarea ---
  async function onImportDailyClick() {
    const area = document.getElementById('dailyImportArea');
    const out = document.getElementById('dailyImportResult');
    if (!area) return;
    const txt = area.value.trim();
    if (!txt) {
      out.textContent = 'Aucun texte collé.';
      return;
    }
    const parsed = parseDailyText(txt);
    if (parsed.error) {
      out.textContent = parsed.error;
      notify(parsed.error, 'fail');
      return;
    }

    const dateKey = parsed.date;
    // check existing IndexedDB
    const history = await loadDailyCookie() || {};
    if (history[dateKey]) {
      const msg = `Jour ${dateKey} déjà en sauvegarde. Import annulé.`;
      out.textContent = msg;
      notify(msg, 'fail');
      return;
    }

    // save new entry
    history[dateKey] = {
      score: parsed.score,
      results: parsed.results
    };
    try {
      await saveDailyCookie(history);
      const msg = `Jour ${dateKey} importé (score calculé: ${parsed.score}${parsed.scoreMismatch ? ' — attention : score déclaré différent' : ''}).`;
      out.textContent = msg;
      notify(msg, 'success');
      // clear textarea on success
      area.value = '';
      // update preview
      await renderCurrentCookiesPreview();
    } catch (e) {
      const err = 'Impossible de sauvegarder le daily importé';
      out.textContent = err;
      notify(err, 'fail');
    }
  }

  // --- clear daily textarea ---
  function onClearDailyArea() {
    const area = document.getElementById('dailyImportArea');
    const out = document.getElementById('dailyImportResult');
    if (area) area.value = '';
    if (out) out.textContent = '';
  }

  // --- delete best score (pk_best cookie) ---
  function onDeleteBestClick() {
    const confirmed = confirm('Warning: This action is irreversible. Are you sure?');
    if (!confirmed) return;

    const deleteResult = document.getElementById('deleteResult');
    try {
      deleteCookie(COOKIE_BEST);
      notify('Best score deleted', 'success');
      if (deleteResult) deleteResult.textContent = 'Best score deleted successfully.';
      // refresh preview
      renderCurrentCookiesPreview();
    } catch (e) {
      notify('Failed to delete best score', 'fail');
      if (deleteResult) deleteResult.textContent = 'Failed to delete best score.';
    }
  }

  // --- delete all daily data (IndexedDB) ---
  async function onDeleteDailyClick() {
    const confirmed = confirm('Warning: This action is irreversible. Are you sure?');
    if (!confirmed) return;

    const deleteResult = document.getElementById('deleteResult');
    try {
      const db = await getDB();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.clear();

      await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      notify('All daily data deleted', 'success');
      if (deleteResult) deleteResult.textContent = 'All daily data deleted successfully.';
      // refresh preview
      await renderCurrentCookiesPreview();
    } catch (e) {
      console.error('Error deleting daily data:', e);
      notify('Failed to delete daily data', 'fail');
      if (deleteResult) deleteResult.textContent = 'Failed to delete daily data.';
    }
  }

  // --- init bindings ---
  function init() {
    const exportBtn = document.getElementById('exportBtn');
    const importFile = document.getElementById('importFile');
    const previewBtn = document.getElementById('previewBtn');
    const importDailyBtn = document.getElementById('importDailyBtn');
    const clearDailyBtn = document.getElementById('clearDailyArea');
    const deleteBestBtn = document.getElementById('deleteBestBtn');
    const deleteDailyBtn = document.getElementById('deleteDailyBtn');

    if (exportBtn) exportBtn.addEventListener('click', onExportClick);
    if (importFile) {
      importFile.addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (f) onFileSelected(f);
        importFile.value = '';
      });
    }
    if (previewBtn) previewBtn.addEventListener('click', renderCurrentCookiesPreview);
    if (importDailyBtn) importDailyBtn.addEventListener('click', onImportDailyClick);
    if (clearDailyBtn) clearDailyBtn.addEventListener('click', onClearDailyArea);
    if (deleteBestBtn) deleteBestBtn.addEventListener('click', onDeleteBestClick);
    if (deleteDailyBtn) deleteDailyBtn.addEventListener('click', onDeleteDailyClick);

    // initial preview hidden until user asks
    const preview = document.getElementById('dataPreview');
    if (preview) preview.style.display = 'none';
  }

  return {
    init
  };
})();
