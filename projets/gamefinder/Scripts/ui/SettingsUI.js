/**
 * SettingsUI.js
 * Page Paramètres de l'application.
 * Permet à l'utilisateur de configurer ses préférences, sauvegardées en IndexedDB.
 */

class SettingsUI {
  /**
   * @param {AppSettings} appSettings
   */
  constructor(appSettings) {
    this.appSettings = appSettings;
  }

  /**
   * Rend la page Paramètres dans le container donné.
   * @param {HTMLElement} container - #app-main
   */
  async render(container) {
    const allowAdult = await this.appSettings.get('allowAdultContent', false);
    const cacheInfo  = await Database.getCacheInfo('database.db.br');

    const cacheHTML = cacheInfo
      ? `<p class="filter-note" style="margin-bottom:12px">
           ✅ Base en cache — <strong>${(cacheInfo.sizeBytes / 1024 / 1024).toFixed(1)}&nbsp;Mo</strong>
           mis en cache le <strong>${cacheInfo.cachedAt.toLocaleDateString('fr-FR')}</strong>
           à <strong>${cacheInfo.cachedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</strong>.
         </p>`
      : `<p class="filter-note" style="margin-bottom:12px;color:var(--neon-yellow)">
           ⏳ Aucun cache local — la base sera téléchargée au prochain lancement.
         </p>`;

    container.innerHTML = `
      <div id="page-view" class="settings-page">
        <div class="page-title reveal">⚙ PARAMÈTRES</div>
        <p class="page-subtitle">Personnalise ton expérience Gamefinder</p>
        <hr class="neon-divider" />

        <div class="settings-sections">

          <div class="filter-box reveal settings-box">
            <div class="filter-box-title">🔞 Contenu adulte</div>
            <div class="filter-switch-row">
              <label class="switch-row-item">
                <span>Autoriser les jeux à contenu adulte</span>
                <span class="switch-toggle">
                  <input type="checkbox" id="cb-adult-content" ${allowAdult ? 'checked' : ''} />
                  <span class="switch-slider"></span>
                </span>
              </label>
            </div>
            <p class="filter-note" style="margin-top:10px">
              Active l'affichage de jeux à thème érotique dans la Roulette.
              Désactivé par défaut.
            </p>
          </div>

          <div class="filter-box reveal settings-box">
            <div class="filter-box-title">🗄 Base de données</div>
            ${cacheHTML}
            <div style="display:flex;gap:10px;flex-wrap:wrap">
              <button class="btn-neon magenta" id="btn-clear-cache" ${!cacheInfo ? 'disabled style="opacity:0.45"' : ''}>
                🗑 Vider le cache
              </button>
              <button class="btn-neon" id="btn-reload-db">
                ↻ Retelecharger la base
              </button>
            </div>
            <p class="filter-note" style="margin-top:10px">
              Tu peux aussi utiliser <kbd style="font-family:var(--font-mono);border:1px solid rgba(0,245,255,0.4);padding:1px 5px;border-radius:3px">Ctrl + F5</kbd>
              pour vider le cache et recharger la base.
            </p>
          </div>

        </div>
      </div>
    `;

    this._bindEvents(cacheInfo);
    this._activateReveal();
  }

  // ─────────────────────────────────────────────────────────────────
  // EVENTS
  // ─────────────────────────────────────────────────────────────────

  _bindEvents(cacheInfo) {
    const cb = document.getElementById('cb-adult-content');
    if (!cb) return;

    cb.addEventListener('change', async e => {
      const newValue = e.target.checked;

      if (newValue) {
        // Demande confirmation avant d'activer
        const confirmed = await this._showAdultConfirmPopup();
        if (!confirmed) {
          cb.checked = false;
          return;
        }
      }

      await this.appSettings.set('allowAdultContent', newValue);
      console.log(`[SettingsUI] allowAdultContent → ${newValue}`);
    });

    // ── Vider le cache ────────────────────────────────────────────
    document.getElementById('btn-clear-cache')?.addEventListener('click', async () => {
      await Database.clearCache('database.db.br');
      const btn = document.getElementById('btn-clear-cache');
      if (btn) { btn.disabled = true; btn.style.opacity = '0.45'; }
      // Met à jour le texte du statut dans la box
      const box = btn?.closest('.filter-box');
      const statusP = box?.querySelector('p.filter-note');
      if (statusP) {
        statusP.innerHTML = `⏳ Cache vidé — la base sera retéléchargée au prochain lancement.`;
        statusP.style.color = 'var(--neon-yellow)';
      }
      console.log('[SettingsUI] Cache vidé manuellement');
    });

    // ── Retélécharger la base (vide cache + recharge la page) ────
    document.getElementById('btn-reload-db')?.addEventListener('click', async () => {
      await Database.clearCache('database.db.br');
      window.location.reload();
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // POPUP CONFIRMATION CONTENU ADULTE
  // ─────────────────────────────────────────────────────────────────

  _showAdultConfirmPopup() {
    return new Promise(resolve => {
      const popup = document.createElement('div');
      popup.className = 'popup-overlay';
      popup.innerHTML = `
        <div class="popup-card">
          <div class="popup-title">⚠ Contenu adulte</div>
          <div class="popup-text">
            Les jeux à caractère adulte (contenu érotique) pourront désormais
            apparaître dans la Roulette.
          </div>
          <div class="popup-actions">
            <button class="btn-neon" id="popup-cancel-adult">Annuler</button>
            <button class="btn-neon magenta" id="popup-confirm-adult">Valider</button>
          </div>
        </div>
      `;
      document.body.appendChild(popup);

      popup.querySelector('#popup-cancel-adult')?.addEventListener('click', () => {
        popup.remove();
        resolve(false);
      });
      popup.querySelector('#popup-confirm-adult')?.addEventListener('click', () => {
        popup.remove();
        resolve(true);
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────

  _activateReveal() {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('visible'); observer.unobserve(e.target); }
      });
    }, { threshold: 0.05 });
    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
  }
}

window.SettingsUI = SettingsUI;
