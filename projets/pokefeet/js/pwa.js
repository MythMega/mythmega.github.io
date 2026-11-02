// pwa.js — Service Worker Pokefeet + invitation à installer l'application
//
// Références : `manifest.webmanifest` (ce qui rend la page installable) et les
// balises `apple-mobile-web-app-*` des pages HTML.
//
// Aucun navigateur n'installe une page tout seul : une fois le manifeste, les
// icônes et le Service Worker qualifiés, Chrome déclenche `beforeinstallprompt`
// et laisse la page libre de demander quand elle veut. Sans écouteur, il ne se
// passe rien : c'est pour ça qu'aucun utilisateur ne voyait d'invitation.
//
// L'événement est donc retenu au vol et la question est posée dans le style du
// jeu, en bannière au-dessus du bas de l'écran : elle ne couvre aucun jeu et
// peut être reportée. La réponse est gardée dans `localStorage` (une
// installation appartient au navigateur, pas à la sauvegarde du joueur) :
// « Plus tard » la met de côté pour RETRY_AFTER_DAYS, une installation la
// supprime définitivement.
//
// L'écouteur est posé immédiatement : l'événement du navigateur peut arriver
// n'importe quand et il est perdu si on le rate.
(function () {
  'use strict';

  /* ───────────────────────── Service Worker ───────────────────────── */

  if ('serviceWorker' in navigator) {
    const isLocalhost =
      location.hostname === 'localhost' ||
      location.hostname === '127.0.0.1' ||
      location.hostname === '[::1]';

    if (location.protocol === 'https:' || isLocalhost) {
      window.addEventListener('load', function () {
        navigator.serviceWorker
          .register('sw.js', { scope: './' })
          .then(function (registration) {
            registration.addEventListener('updatefound', function () {
              const worker = registration.installing;
              if (!worker) return;

              worker.addEventListener('statechange', function () {
                if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                  window.dispatchEvent(new CustomEvent('pokefeet:pwa-update'));
                }
              });
            });
          })
          .catch(function (error) {
            console.warn('[PWA] Service Worker non enregistré :', error);
          });
      });
    }
  }

  /* ─────────────────────── Invitation à installer ─────────────────────── */

  /** Clé `localStorage` de la réponse donnée sur cet appareil. */
  const INSTALL_STORAGE_KEY = 'pokefeet_install_prompt';

  /** Attente entre le chargement de la page et la bannière. */
  const SHOW_DELAY_MS = 6000;

  /** Durée pendant laquelle « Plus tard » écarte la bannière, en jours. */
  const RETRY_AFTER_DAYS = 30;

  /** Modes d'affichage qui signifient que la page tourne déjà en application. */
  const INSTALLED_DISPLAY_MODES = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'];

  /** Textes de secours, utilisés avant/à défaut du chargement des traductions. */
  const FALLBACK_TEXT = {
    fr: {
      title: 'Installer Pokefeet',
      message: "Ajoutez le jeu à votre écran d'accueil : un seul tap pour jouer, même hors ligne.",
      action: 'Installer',
      actionLabel: "Installer Pokefeet sur l'écran d'accueil",
      later: 'Plus tard'
    },
    en: {
      title: 'Install Pokefeet',
      message: 'Add the game to your home screen: one tap to play, even offline.',
      action: 'Install',
      actionLabel: 'Install Pokefeet on the home screen',
      later: 'Later'
    }
  };

  /** Événement `beforeinstallprompt` retenu, utilisable une seule fois. */
  let deferredEvent = null;

  /** Bannière créée au premier affichage. */
  let banner = null;

  /** Minuteur d'affichage en attente. */
  let showTimer = null;

  /**
   * Langue courante du site (fr par défaut).
   * @returns {string} 'fr' ou 'en'.
   */
  function currentLanguage() {
    if (typeof Translator !== 'undefined' && typeof Translator.getLanguage === 'function') {
      const lang = Translator.getLanguage();
      if (lang === 'fr' || lang === 'en') return lang;
    }
    return 'fr';
  }

  /**
   * Texte traduit de la bannière.
   * @param {string} key - Clé courte : title, message, action, actionLabel, later.
   * @returns {string} Le texte à afficher.
   */
  function text(key) {
    const fallback = FALLBACK_TEXT[currentLanguage()][key] || '';
    if (typeof Translator === 'undefined' || typeof Translator.get !== 'function') return fallback;
    return Translator.get(`pwa.${key}`, fallback);
  }

  /**
   * Indique si la page tourne déjà comme application installée.
   * @returns {boolean} Vrai en mode standalone/fullscreen/minimal-ui.
   */
  function isInstalled() {
    if (window.navigator.standalone === true) return true;
    if (typeof window.matchMedia !== 'function') return false;
    return INSTALLED_DISPLAY_MODES.some(mode => window.matchMedia(`(display-mode: ${mode})`).matches);
  }

  /**
   * Indique si l'appareil est un téléphone ou une tablette.
   *
   * L'événement n'existe que dans les navigateurs Chromium, y compris sur
   * ordinateur, où Chrome affiche déjà sa propre icône dans la barre d'adresse :
   * la bannière est réservée au mobile.
   * @returns {boolean} Vrai sur mobile.
   */
  function isMobileDevice() {
    const data = window.navigator.userAgentData;
    if (data && typeof data.mobile === 'boolean') return data.mobile;
    return /Android|iPhone|iPad|iPod|Mobile/i.test(window.navigator.userAgent);
  }

  /**
   * Lit la réponse enregistrée sur cet appareil.
   * Une entrée abîmée est traitée comme « jamais répondu », jamais comme un
   * blocage définitif.
   * @returns {{dismissedAt: number, installed: boolean}} La réponse.
   */
  function readAnswer() {
    const empty = { dismissedAt: 0, installed: false };
    try {
      const raw = window.localStorage.getItem(INSTALL_STORAGE_KEY);
      if (!raw) return empty;
      const parsed = JSON.parse(raw);
      return {
        dismissedAt: Number.isFinite(parsed && parsed.dismissedAt) ? parsed.dismissedAt : 0,
        installed: Boolean(parsed && parsed.installed === true)
      };
    } catch (error) {
      console.warn('[PWA] Réponse d\'installation illisible :', error);
      return empty;
    }
  }

  /**
   * Enregistre la réponse de cet appareil.
   * @param {{dismissedAt?: number, installed?: boolean}} answer - Valeurs à retenir.
   * @returns {void}
   */
  function writeAnswer(answer) {
    const merged = Object.assign(readAnswer(), answer);
    try {
      window.localStorage.setItem(INSTALL_STORAGE_KEY, JSON.stringify(merged));
    } catch (error) {
      console.warn('[PWA] Réponse d\'installation non enregistrée :', error);
    }
  }

  /**
   * Indique si la bannière peut encore être proposée.
   * @returns {boolean} Vrai si l'offre est utile sur cet appareil.
   */
  function canOffer() {
    if (!deferredEvent) return false;
    if (!isMobileDevice() || isInstalled()) return false;
    const answer = readAnswer();
    if (answer.installed) return false;
    if (answer.dismissedAt <= 0) return true;
    return (Date.now() - answer.dismissedAt) / 86400000 >= RETRY_AFTER_DAYS;
  }

  /**
   * Indique si la bannière est à l'écran.
   * @returns {boolean} Vrai si elle est visible.
   */
  function isVisible() {
    return banner !== null && !banner.hidden;
  }

  /**
   * Crée la bannière une seule fois et l'ajoute au `<body>`.
   * Construite en DOM : chaque texte est traduit au moment de l'affichage,
   * donc un changement de langue ne demande qu'un `render()`.
   * @returns {void}
   */
  function ensureMarkup() {
    if (banner) return;

    const root = document.createElement('aside');
    root.className = 'pwa-install';
    root.hidden = true;
    root.setAttribute('role', 'complementary');

    const icon = document.createElement('img');
    icon.className = 'pwa-install__icon';
    icon.src = 'icons/icon-192.png';
    icon.alt = '';
    icon.width = 48;
    icon.height = 48;
    icon.decoding = 'async';

    const body = document.createElement('div');
    body.className = 'pwa-install__text';

    const title = document.createElement('p');
    title.className = 'pwa-install__title';
    title.dataset.installTitle = '';

    const message = document.createElement('p');
    message.className = 'pwa-install__message';
    message.dataset.installMessage = '';

    const actions = document.createElement('div');
    actions.className = 'pwa-install__actions';

    const laterButton = document.createElement('button');
    laterButton.type = 'button';
    laterButton.className = 'pwa-install__btn';
    laterButton.dataset.installLater = '';
    laterButton.addEventListener('click', dismiss);

    const installButton = document.createElement('button');
    installButton.type = 'button';
    installButton.className = 'pwa-install__btn pwa-install__btn--primary';
    installButton.dataset.installConfirm = '';
    installButton.addEventListener('click', install);

    body.append(title, message);
    actions.append(laterButton, installButton);
    root.append(icon, body, actions);
    document.body.appendChild(root);

    banner = root;
  }

  /**
   * Écrit les traductions courantes dans la bannière.
   * @returns {void}
   */
  function render() {
    if (!banner) return;
    const title = text('title');
    banner.setAttribute('aria-label', title);
    banner.querySelector('[data-install-title]').textContent = title;
    banner.querySelector('[data-install-message]').textContent = text('message');

    const installButton = banner.querySelector('[data-install-confirm]');
    installButton.textContent = text('action');
    installButton.setAttribute('aria-label', text('actionLabel'));

    banner.querySelector('[data-install-later]').textContent = text('later');
  }

  /**
   * Cache la bannière sans rien enregistrer.
   * @returns {void}
   */
  function hide() {
    if (showTimer !== null) {
      window.clearTimeout(showTimer);
      showTimer = null;
    }
    document.removeEventListener('keydown', handleKeyDown);
    if (banner) banner.hidden = true;
  }

  /**
   * Reporte l'offre de RETRY_AFTER_DAYS jours.
   * @returns {void}
   */
  function dismiss() {
    writeAnswer({ dismissedAt: Date.now() });
    hide();
  }

  /**
   * Ouvre la boîte d'installation du navigateur.
   * L'événement retenu ne sert qu'une fois : il est oublié avant l'appel pour
   * qu'un second clic ne lève pas d'erreur. Un refus du dialogue natif compte
   * comme « Plus tard ».
   * @returns {Promise<void>} Résolue quand le choix du joueur est connu.
   */
  async function install() {
    const event = deferredEvent;
    deferredEvent = null;
    hide();

    if (!event || typeof event.prompt !== 'function') {
      console.warn('[PWA] L\'événement d\'installation n\'est plus disponible.');
      return;
    }

    try {
      await event.prompt();
      const choice = await event.userChoice;
      if (!choice || choice.outcome !== 'accepted') writeAnswer({ dismissedAt: Date.now() });
    } catch (error) {
      console.warn('[PWA] Installation impossible à démarrer :', error);
    }

    syncInstallState();
  }

  /**
   * Fermeture au clavier, seulement quand la bannière a le focus visuel.
   * @param {KeyboardEvent} event - L'événement clavier.
   * @returns {void}
   */
  function handleKeyDown(event) {
    if (event.key !== 'Escape' || !isVisible()) return;
    event.preventDefault();
    dismiss();
  }

  /**
   * Affiche la bannière si l'offre tient toujours.
   * @returns {void}
   */
  function show() {
    if (!canOffer() || isVisible()) return;

    ensureMarkup();
    render();
    banner.hidden = false;
    document.addEventListener('keydown', handleKeyDown);
  }

  /**
   * Programme l'affichage de la bannière.
   * @returns {void}
   */
  function schedule() {
    if (showTimer !== null) {
      window.clearTimeout(showTimer);
      showTimer = null;
    }
    if (!canOffer()) return;
    showTimer = window.setTimeout(function () {
      showTimer = null;
      show();
    }, SHOW_DELAY_MS);
  }

  /**
   * Retient l'événement du navigateur au lieu de le laisser afficher sa propre
   * infobar, puis programme la question.
   * @param {Event} event - L'événement `beforeinstallprompt`.
   * @returns {void}
   */
  function capture(event) {
    event.preventDefault();
    deferredEvent = event;
    syncInstallState();
  }

  /**
   * Nettoie tout ce que le navigateur a établi une fois l'app installée.
   * @returns {void}
   */
  function handleAppInstalled() {
    deferredEvent = null;
    writeAnswer({ installed: true });
    hide();
    syncInstallState();
  }

  /* --------------- Entrée « Installer » des Paramètres --------------- */

  /**
   * Rafraîchit la section Paramètres quand la page en propose une.
   * Nul tant que `mountSettingsEntry()` n’a pas trouvé la section.
   * @type {(() => void)|null}
   */
  let refreshSettingsEntry = null;

  /**
   * Remet la bannière et la section Paramètres en accord avec l’état réel.
   * @returns {void}
   */
  function syncInstallState() {
    if (refreshSettingsEntry) refreshSettingsEntry();
    schedule();
  }

  /**
   * Branche la section « Installer l’application » des Paramètres.
   *
   * Le bouton n’est montré que si l’installation aboutira vraiment : un
   * `beforeinstallprompt` retenu et une page qui ne tourne pas déjà comme une
   * application. Firefox, Safari sur ordinateur et les navigateurs sans
   * installation possible ne déclenchent jamais l’événement : la section
   * reste donc masquée, plutôt que de promettre un bouton inerte.
   * @returns {void}
   */
  function mountSettingsEntry() {
    const section = document.querySelector('[data-pwa-install]');
    if (!section) return;

    const button = section.querySelector('[data-pwa-install-action]');
    if (button) button.addEventListener('click', install);

    refreshSettingsEntry = function () {
      section.hidden = !deferredEvent || isInstalled();
    };
    refreshSettingsEntry();
  }

  window.addEventListener('beforeinstallprompt', capture);
  window.addEventListener('appinstalled', handleAppInstalled);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountSettingsEntry);
  } else {
    mountSettingsEntry();
  }
})();
