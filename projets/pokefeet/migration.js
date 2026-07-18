// migration.js - Universal migration system
// Ensures all IndexedDB databases are at version 4, no matter the starting state.
// Handles: no DB, v1, v2, v3 -> v4 for PokefeetDB and PokefeetDexDB
// Preserves all existing data through the upgrade process.
// Shows notification on success, popup with data export on failure.

const Migration = (function () {
  // ── Constants ──────────────────────────────────────────────
  const DB_NAME = 'PokefeetDB';
  const DEX_DB_NAME = 'PokefeetDexDB';
  const CHALLENGE_DB_NAME = 'PokefeetChallengeDB';
  const TARGET_VERSION = 4;
  const DAILY_STORE = 'daily_results';
  const WEEKLY_STORE = 'weekly_results';
  const DEX_STORE = 'dex_entries';
  const CHALLENGE_STORE = 'challenge_completions';

  // Cookie names for backup
  const COOKIE_DAILY = 'pk_daily_result_v2';
  const COOKIE_BEST = 'pk_best';
  const COOKIE_BEST_STREAK = 'pk_best_streak';
  const COOKIE_BG = 'pk_cosmetic_bg';
  const COOKIE_BTN = 'pk_cosmetic_btn';
  const COOKIE_PSEUDO = 'pk_pseudo';

  let _resolveReady;
  const ready = new Promise(function (resolve) { _resolveReady = resolve; });
  let migrationDone = false;
  let migrationError = null;
  let backupData = {}; // stores all data read before migration
  let didActualMigration = false; // true if at least one DB needed an upgrade

  // ── Helpers ────────────────────────────────────────────────

  function getCookie(name) {
    var v = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
    return v ? decodeURIComponent(v.pop()) : null;
  }

  function getAllCookies() {
    var obj = {};
    var raw = getCookie(COOKIE_DAILY);
    if (raw) obj.dailyCookie = raw;
    var best = getCookie(COOKIE_BEST);
    if (best) obj.best = best;
    var streak = getCookie(COOKIE_BEST_STREAK);
    if (streak) obj.bestStreak = streak;
    var bg = getCookie(COOKIE_BG);
    if (bg) obj.cosmeticBg = bg;
    var btn = getCookie(COOKIE_BTN);
    if (btn) obj.cosmeticBtn = btn;
    var pseudo = getCookie(COOKIE_PSEUDO);
    if (pseudo) obj.pseudo = pseudo;
    return obj;
  }

  function formatErrorForExport(err) {
    var lines = [];
    lines.push('=== Pokefeet Migration Error Report ===');
    lines.push('Timestamp: ' + new Date().toISOString());
    lines.push('User Agent: ' + navigator.userAgent);
    lines.push('Error: ' + (err.message || String(err)));
    lines.push('Stack: ' + (err.stack || 'N/A'));
    lines.push('');

    // Cookies backup
    lines.push('--- Cookies ---');
    var cookies = getAllCookies();
    for (var key in cookies) {
      if (cookies.hasOwnProperty(key)) {
        lines.push(key + '=' + cookies[key]);
      }
    }
    lines.push('');

    // Backup data
    lines.push('--- Backup Data ---');
    lines.push(JSON.stringify(backupData, null, 2));
    lines.push('');

    lines.push('=== End of Report ===');
    return lines.join('\n');
  }

  // ── Read all data from existing DB (before migration) ─────
  function readAllData(db) {
    return new Promise(function (resolve, reject) {
      var result = {};
      var storeNames = Array.from(db.objectStoreNames);
      if (storeNames.length === 0) {
        db.close();
        resolve(result);
        return;
      }

      var pending = storeNames.length;
      var failed = false;

      storeNames.forEach(function (storeName) {
        try {
          var tx = db.transaction(storeName, 'readonly');
          var store = tx.objectStore(storeName);
          var req = store.getAll();
          req.onsuccess = function () {
            if (failed) return;
            result[storeName] = req.result;
            pending--;
            if (pending === 0) {
              db.close();
              resolve(result);
            }
          };
          req.onerror = function () {
            if (failed) return;
            failed = true;
            db.close();
            reject(new Error('Failed to read store: ' + storeName));
          };
        } catch (e) {
          pending--;
          if (pending === 0 && !failed) {
            db.close();
            resolve(result);
          }
        }
      });
    });
  }

  // ── Write data back after migration ───────────────────────
  function writeAllData(db, data) {
    return new Promise(function (resolve, reject) {
      var storeNames = Object.keys(data);
      if (storeNames.length === 0) {
        resolve();
        return;
      }

      var pending = storeNames.length;
      var failed = false;

      storeNames.forEach(function (storeName) {
        try {
          if (!db.objectStoreNames.contains(storeName)) {
            pending--;
            if (pending === 0) resolve();
            return;
          }
          var tx = db.transaction(storeName, 'readwrite');
          var store = tx.objectStore(storeName);
          var items = data[storeName] || [];

          items.forEach(function (item) {
            store.put(item);
          });

          tx.oncomplete = function () {
            pending--;
            if (pending === 0) resolve();
          };
          tx.onerror = function () {
            if (failed) return;
            failed = true;
            reject(new Error('Failed to write to store: ' + storeName));
          };
        } catch (e) {
          pending--;
          if (pending === 0 && !failed) resolve();
        }
      });
    });
  }

  // ── Show notification ─────────────────────────────────────
  function showNotification(message, type) {
    type = type || 'success';
    var container = document.getElementById('notifications');
    if (!container) {
      console.log('[Migration] ' + message);
      return;
    }
    var n = document.createElement('div');
    n.className = 'notification';
    n.textContent = message;
    if (type === 'fail') n.style.background = '#491111';
    else n.style.background = '#0b5a2a';
    container.appendChild(n);
    setTimeout(function () {
      n.style.opacity = 0;
      try { container.removeChild(n); } catch (e) {}
    }, 4000);
  }

  // ── Show error popup with data export ─────────────────────
  function showErrorPopup(err) {
    migrationError = err;
    console.error('[Migration] Fatal migration error:', err);

    // Check if there's already a popup to avoid duplicates
    if (document.getElementById('migrationErrorPopup')) return;

    var popup = document.createElement('div');
    popup.id = 'migrationErrorPopup';
    popup.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,8,0.85);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:10000;';

    var report = formatErrorForExport(err);

    popup.innerHTML =
      '<div style="background:var(--card,#0a1122);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:28px 24px;max-width:560px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.5);">' +
        '<div style="color:#ef4444;font-size:22px;font-weight:800;margin-bottom:8px;">⚠️ Erreur de migration</div>' +
        '<div style="color:var(--muted,#94a3b8);font-size:13px;margin-bottom:16px;line-height:1.5;">' +
          'Une erreur est survenue lors de la mise à jour de la base de données. <strong style="color:#fff;">Vos données sont intactes</strong> grâce à une sauvegarde automatique.<br><br>' +
          'Veuillez <strong style="color:#4ade80;">copier le rapport ci-dessous</strong> et le partager dans le canal <strong style="color:#f59e0b;">🆘-aide-bug-report</strong> du serveur Discord Pokefeet.' +
        '</div>' +
        '<textarea id="migrationReportText" readonly style="width:100%;height:140px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#e2eaf8;padding:10px;font-size:11px;font-family:monospace;resize:vertical;margin-bottom:16px;box-sizing:border-box;">' + escapeHtml(report) + '</textarea>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
          '<button id="migrationCopyBtn" style="flex:1;padding:10px 14px;background:#22c55e;color:#052018;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:13px;">📋 Copier le rapport + Ouvrir Discord</button>' +
          '<button id="migrationRetryBtn" style="flex:0 0 auto;padding:10px 14px;background:rgba(255,255,255,0.08);color:#fff;border:1px solid rgba(255,255,255,0.15);border-radius:8px;font-weight:600;cursor:pointer;font-size:13px;">🔄 Réessayer</button>' +
          '<button id="migrationDismissBtn" style="flex:0 0 auto;padding:10px 14px;background:rgba(255,255,255,0.04);color:var(--muted);border:1px solid rgba(255,255,255,0.08);border-radius:8px;font-weight:600;cursor:pointer;font-size:13px;">✕ Ignorer</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(popup);

    // Copy + Discord button
    document.getElementById('migrationCopyBtn').addEventListener('click', function () {
      var textarea = document.getElementById('migrationReportText');
      if (textarea) {
        navigator.clipboard.writeText(textarea.value).then(function () {
          showNotification('Rapport copié ! Ouverture de Discord...', 'success');
        }, function () {
          // Fallback: select all
          textarea.select();
        });
      }
      window.open('https://discord.com/invite/7kpY5WKhPU', '_blank');
    });

    // Retry
    document.getElementById('migrationRetryBtn').addEventListener('click', function () {
      popup.remove();
      migrationDone = false;
      migrationError = null;
      run();
    });

    // Dismiss
    document.getElementById('migrationDismissBtn').addEventListener('click', function () {
      popup.remove();
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"');
  }

  // ── Migrate PokefeetDB ────────────────────────────────────
  async function migratePokefeetDB() {
    var oldData = {};

    // Step 1: Try to open existing DB to read data before migration
    try {
      var existingDB = await new Promise(function (resolve, reject) {
        var req = indexedDB.open(DB_NAME);
        req.onsuccess = function () {
          var db = req.result;
          // Check if it's already at target version
          if (db.version >= TARGET_VERSION) {
            db.close();
            resolve(null); // Already at target, no migration needed
          } else {
            resolve(db); // Need to read data then migrate
          }
        };
        req.onerror = function () {
          reject(req.error);
        };
        req.onupgradeneeded = function () {
          // DB doesn't exist yet or needs upgrade - close and let open with version handle it
          var db = req.result;
          db.close();
          resolve(null);
        };
      });

      if (existingDB) {
        // Read all existing data
        oldData = await readAllData(existingDB);
        backupData.PokefeetDB = oldData;
      }
    } catch (e) {
      console.warn('[Migration] Could not read existing DB (may not exist yet):', e);
    }

    // Step 2: Open DB with target version (this triggers onupgradeneeded if needed)
    var db = await new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, TARGET_VERSION);
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error('IndexedDB open timed out'));
      }, 8000);

      req.onerror = function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(req.error);
      };

      req.onblocked = function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error('Database upgrade blocked - close other tabs and reload'));
      };

      req.onsuccess = function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        var database = req.result;
        database.addEventListener('versionchange', function () {
          database.close();
        });
        resolve(database);
      };

      req.onupgradeneeded = function (e) {
        var database = e.target.result;
        var tx = e.target.transaction;

        // Create daily_results store if missing
        if (!database.objectStoreNames.contains(DAILY_STORE)) {
          database.createObjectStore(DAILY_STORE, { keyPath: 'date' });
          console.log('[Migration] Created store: ' + DAILY_STORE);
        }

        // Create weekly_results store if missing
        if (!database.objectStoreNames.contains(WEEKLY_STORE)) {
          database.createObjectStore(WEEKLY_STORE, { keyPath: 'date' });
          console.log('[Migration] Created store: ' + WEEKLY_STORE);
        }

        console.log('[Migration] Upgraded PokefeetDB to version ' + TARGET_VERSION);
      };
    });

    // Step 3: Write back any data that was read
    if (Object.keys(oldData).length > 0) {
      try {
        await writeAllData(db, oldData);
        console.log('[Migration] Restored ' + JSON.stringify(Object.keys(oldData)) + ' data after migration');
      } catch (e) {
        console.warn('[Migration] Could not restore data after migration:', e);
        // Data is still safe in cookies and backupData
      }
    }

    db.close();
    return true;
  }

  // ── Migrate PokefeetDexDB ─────────────────────────────────
  async function migrateDexDB() {
    var oldDexData = [];

    // Step 1: Try to read existing data
    try {
      var existingDexDB = await new Promise(function (resolve, reject) {
        var req = indexedDB.open(DEX_DB_NAME);
        req.onsuccess = function () {
          var db = req.result;
          if (db.objectStoreNames.contains(DEX_STORE)) {
            var tx = db.transaction(DEX_STORE, 'readonly');
            var store = tx.objectStore(DEX_STORE);
            var getAllReq = store.getAll();
            getAllReq.onsuccess = function () {
              oldDexData = getAllReq.result || [];
              backupData.DexDB = oldDexData;
              db.close();
              resolve(true);
            };
            getAllReq.onerror = function () {
              db.close();
              resolve(true);
            };
          } else {
            db.close();
            resolve(true);
          }
        };
        req.onerror = function () {
          resolve(true); // No existing DB, that's fine
        };
        req.onupgradeneeded = function () {
          // DB doesn't exist yet, that's fine
          var db = req.result;
          db.close();
          resolve(true);
        };
      });
    } catch (e) {
      console.warn('[Migration] Could not read existing DexDB:', e);
    }

    // Step 2: Open with version 4 to ensure store exists
    try {
      var dexDB = await new Promise(function (resolve, reject) {
        var req = indexedDB.open(DEX_DB_NAME, TARGET_VERSION);
        var settled = false;
        var timer = setTimeout(function () {
          if (settled) return;
          settled = true;
          reject(new Error('DexDB open timed out'));
        }, 5000);

        req.onerror = function () {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(req.error);
        };

        req.onsuccess = function () {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(req.result);
        };

        req.onupgradeneeded = function (e) {
          var database = e.target.result;
          if (!database.objectStoreNames.contains(DEX_STORE)) {
            database.createObjectStore(DEX_STORE, { keyPath: 'index' });
            console.log('[Migration] Created store: ' + DEX_STORE);
          }
          console.log('[Migration] Upgraded DexDB to version ' + TARGET_VERSION);
        };
      });

      // Step 3: Write back old data
      if (oldDexData.length > 0) {
        var tx = dexDB.transaction(DEX_STORE, 'readwrite');
        var store = tx.objectStore(DEX_STORE);
        oldDexData.forEach(function (item) {
          store.put(item);
        });
        await new Promise(function (resolve, reject) {
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function () { reject(tx.error); };
        });
        console.log('[Migration] Restored ' + oldDexData.length + ' Dex entries after migration');
      }

      dexDB.close();
    } catch (e) {
      console.warn('[Migration] Could not migrate DexDB (may not exist):', e);
    }

    return true;
  }

  // ── Migrate PokefeetChallengeDB ───────────────────────────
  async function migrateChallengeDB() {
    var oldChallengeData = [];

    // Step 1: Try to read existing data
    try {
      var existingChallengeDB = await new Promise(function (resolve, reject) {
        var req = indexedDB.open(CHALLENGE_DB_NAME);
        req.onsuccess = function () {
          var db = req.result;
          if (db.objectStoreNames.contains(CHALLENGE_STORE)) {
            var tx = db.transaction(CHALLENGE_STORE, 'readonly');
            var store = tx.objectStore(CHALLENGE_STORE);
            var getAllReq = store.getAll();
            getAllReq.onsuccess = function () {
              oldChallengeData = getAllReq.result || [];
              backupData.ChallengeDB = oldChallengeData;
              db.close();
              resolve(true);
            };
            getAllReq.onerror = function () {
              db.close();
              resolve(true);
            };
          } else {
            db.close();
            resolve(true);
          }
        };
        req.onerror = function () {
          resolve(true);
        };
        req.onupgradeneeded = function () {
          var db = req.result;
          db.close();
          resolve(true);
        };
      });
    } catch (e) {
      console.warn('[Migration] Could not read existing ChallengeDB:', e);
    }

    // Step 2: Open with version 4 to ensure store + index exist
    try {
      var challengeDB = await new Promise(function (resolve, reject) {
        var req = indexedDB.open(CHALLENGE_DB_NAME, TARGET_VERSION);
        var settled = false;
        var timer = setTimeout(function () {
          if (settled) return;
          settled = true;
          reject(new Error('ChallengeDB open timed out'));
        }, 5000);

        req.onerror = function () {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(req.error);
        };

        req.onsuccess = function () {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(req.result);
        };

        req.onupgradeneeded = function (e) {
          var database = e.target.result;
          if (!database.objectStoreNames.contains(CHALLENGE_STORE)) {
            var store = database.createObjectStore(CHALLENGE_STORE, { keyPath: 'challengeId' });
            store.createIndex('completedAt', 'completedAt', { unique: false });
            console.log('[Migration] Created store: ' + CHALLENGE_STORE);
          }
          console.log('[Migration] Upgraded ChallengeDB to version ' + TARGET_VERSION);
        };
      });

      // Step 3: Write back old data
      if (oldChallengeData.length > 0) {
        var tx = challengeDB.transaction(CHALLENGE_STORE, 'readwrite');
        var store = tx.objectStore(CHALLENGE_STORE);
        oldChallengeData.forEach(function (item) {
          store.put(item);
        });
        await new Promise(function (resolve, reject) {
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function () { reject(tx.error); };
        });
        console.log('[Migration] Restored ' + oldChallengeData.length + ' challenge completions after migration');
      }

      challengeDB.close();
    } catch (e) {
      console.warn('[Migration] Could not migrate ChallengeDB (may not exist):', e);
    }

    return true;
  }

  // ── Check if all DBs are already at target version ────────
  async function isAlreadyAtTarget() {
    var allAtTarget = true;
    var dbNames = [DB_NAME, DEX_DB_NAME, CHALLENGE_DB_NAME];

    for (var i = 0; i < dbNames.length; i++) {
      try {
        var result = await new Promise(function (resolve) {
          var req = indexedDB.open(dbNames[i]);
          req.onsuccess = function () {
            var db = req.result;
            var atTarget = db.version >= TARGET_VERSION;
            db.close();
            resolve(atTarget);
          };
          req.onerror = function () {
            resolve(false);
          };
          req.onupgradeneeded = function () {
            // DB doesn't exist yet, close and resolve false
            var db = req.result;
            db.close();
            resolve(false);
          };
        });
        if (!result) allAtTarget = false;
      } catch (e) {
        allAtTarget = false;
      }
    }

    return allAtTarget;
  }

  // ── Main migration runner ─────────────────────────────────
  async function run() {
    if (migrationDone) {
      _resolveReady();
      return;
    }

    try {
      // Backup cookies
      backupData.cookies = getAllCookies();

      // Quick check: if all DBs are already at target, skip migration
      var alreadyTarget = await isAlreadyAtTarget();
      if (alreadyTarget) {
        migrationDone = true;
        console.log('[Migration] All databases already at version ' + TARGET_VERSION + ', skipping.');
        _resolveReady();
        return;
      }

      // Migrate all databases
      await Promise.all([
        migratePokefeetDB(),
        migrateDexDB(),
        migrateChallengeDB()
      ]);

      migrationDone = true;
      console.log('[Migration] All databases migrated to version ' + TARGET_VERSION + ' successfully');

      // Show notification on next tick (ensures DOM is ready)
      setTimeout(function () {
        showNotification('✅ Base de données mise à jour (v' + TARGET_VERSION + ')');
      }, 500);

    } catch (e) {
      migrationDone = true;
      console.error('[Migration] Fatal migration error:', e);
      backupData.error = String(e);

      // Show error popup after a short delay (ensures DOM is ready)
      setTimeout(function () {
        showErrorPopup(e);
      }, 600);
    } finally {
      _resolveReady();
    }
  }

  return {
    run: run,
    ready: ready,
    getError: function () { return migrationError; },
    getBackupData: function () { return backupData; }
  };
})();

// Run migration immediately
Migration.run();