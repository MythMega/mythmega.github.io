/**
 * Cas de test navigateur pour l'installation de Pokefeet (PWA).
 *
 * Chrome n'émet `beforeinstallprompt` que sous conditions (manifeste complet,
 * Service Worker actif, HTTPS, aucune installation récente) : impossible à
 * réunir dans un profil headless neuf. Les cas rejouent donc l'événement à la
 * main, exactement comme le navigateur le ferait, puis vérifient la réaction de
 * `js/pwa.js` :
 *
 *  - la bannière n'apparaît qu'après le délai, et seulement sur mobile ;
 *  - « Installer » passe la main au dialogue du navigateur ;
 *  - « Plus tard » enregistre un report qui empêche de reproposer l'offre ;
 *  - la section « Installer » des Paramètres reste masquée quand l'installation
 *    ne peut pas aboutir (aucun événement, ou page déjà installée).
 *
 * `setup` est rejoué à chaque tentative du banc de test : chaque préparation
 * commence donc par se protéger d'un second passage, sinon l'événement simulé
 * relancerait le minuteur d'affichage à chaque sondage et la bannière
 * n'apparaîtrait jamais.
 */

/** Clé `localStorage` où `js/pwa.js` retient la réponse de l'appareil. */
const INSTALL_KEY = 'pokefeet_install_prompt';

/** Expression vraie quand la bannière est à l'écran. */
const BANNER_VISIBLE =
  "(() => { const b = document.querySelector('.pwa-install'); return !!b && !b.hidden; })()";

/** Expression vraie quand la section Paramètres est ouverte. */
const SETTINGS_VISIBLE =
  "(() => { const s = document.querySelector('[data-pwa-install]'); return !!s && !s.hidden; })()";

/** Attente d'un tour de boucle d'événements, en millisecondes. */
const TICK_MS = 200;

/**
 * Construit une préparation qui simule un navigateur installable.
 * @param {object} [options] - Profil simulé.
 * @param {boolean} [options.mobile] - Vrai pour un téléphone ou une tablette.
 * @param {boolean} [options.standalone] - Vrai pour une page déjà installée.
 * @param {string} [options.outcome] - Réponse du dialogue natif : accepted ou dismissed.
 * @returns {string} Expression à évaluer dans la page.
 */
function pwaSetup(options = {}) {
  const mobile = options.mobile !== false;
  const outcome = options.outcome || 'accepted';
  const standalone = options.standalone === true;

  // `matchMedia` est remplacé seulement pour `display-mode` : le reste de la
  // page (thème, préférences) continue de recevoir les vraies réponses.
  const standaloneSpoof = standalone
    ? `
    const realMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = function (query) {
      if (/display-mode/.test(query)) {
        return {
          matches: true,
          media: query,
          addEventListener: function () {},
          removeEventListener: function () {},
          addListener: function () {},
          removeListener: function () {}
        };
      }
      return realMatchMedia(query);
    };`
    : '';

  return `(() => {
    if (window.__pwaSetup) return;
    window.__pwaSetup = true;
    window.__pwaTest = { prompted: 0 };
    Object.defineProperty(navigator, 'userAgentData', {
      configurable: true,
      get: () => ({ mobile: ${mobile} })
    });${standaloneSpoof}
    const event = new Event('beforeinstallprompt');
    event.prompt = () => { window.__pwaTest.prompted += 1; return Promise.resolve(); };
    event.userChoice = Promise.resolve({ outcome: '${outcome}' });
    window.dispatchEvent(event);
  })()`;
}

/** Bannière mobile : contenu, placement et accessibilité. */
const BANNER_MOBILE = {
  name: 'PWA — bannière d’installation proposée sur mobile',
  page: '/index.html',
  setup: pwaSetup(),
  settle: BANNER_VISIBLE,
  checks: [
    {
      name: 'une seule bannière est créée',
      expression: "document.querySelectorAll('.pwa-install').length === 1"
    },
    {
      name: 'la bannière est ancrée au bas de l’écran, au-dessus du jeu',
      expression:
        "(() => { const b = document.querySelector('.pwa-install'); const cs = getComputedStyle(b); return { ok: cs.position === 'fixed' && Number(cs.zIndex) >= 200, detail: cs.position + ' / z-index ' + cs.zIndex }; })()"
    },
    {
      name: 'la bannière reste dans les limites de l’écran',
      expression:
        "(() => { const r = document.querySelector('.pwa-install').getBoundingClientRect(); return { ok: r.left >= -1 && r.right <= window.innerWidth + 1 && r.width > 0, detail: Math.round(r.left) + '→' + Math.round(r.right) + ' sur ' + window.innerWidth }; })()"
    },
    {
      name: 'le titre vient des traductions',
      expression:
        "(() => { const t = document.querySelector('.pwa-install__title').textContent.trim(); return { ok: /Installer Pokefeet|Install Pokefeet/i.test(t), detail: t }; })()"
    },
    {
      name: 'le message, l’action et le report sont remplis et traduits',
      expression:
        "(() => { const msg = document.querySelector('.pwa-install__message').textContent.trim(); const confirm = document.querySelector('[data-install-confirm]'); const later = document.querySelector('[data-install-later]'); const label = confirm.getAttribute('aria-label') || ''; const ok = msg.length > 10 && confirm.textContent.trim().length > 0 && later.textContent.trim().length > 0 && label.length > 0; return { ok, detail: confirm.textContent.trim() + ' / ' + later.textContent.trim() + ' — ' + msg.slice(0, 45) }; })()"
    },
    {
      name: 'l’action principale est le dernier bouton de la rangée',
      expression:
        "(() => { const buttons = Array.from(document.querySelectorAll('.pwa-install__btn')); return { ok: buttons.length === 2 && buttons[1].hasAttribute('data-install-confirm'), detail: buttons.map(b => b.textContent.trim()).join(' | ') }; })()"
    },
    {
      name: 'l’icône de la bannière est réellement chargée',
      expression:
        "(() => { const img = document.querySelector('.pwa-install__icon'); return { ok: !!img && img.complete && img.naturalWidth > 0, detail: img ? img.getAttribute('src') + ' (' + img.naturalWidth + 'px)' : 'icône absente' }; })()"
    },
    {
      name: 'aucune clé de traduction brute ni valeur cassée',
      expression:
        "(() => { const txt = document.querySelector('.pwa-install').innerText; return { ok: !/pwa\\.|undefined|NaN|\\{\\w+\\}/.test(txt), detail: txt.replace(/\\s+/g, ' ').slice(0, 80) }; })()"
    }
  ]
};

/** Clic sur « Installer » : le dialogue du navigateur prend la main. */
const INSTALL_ACCEPTED = {
  name: 'PWA — le bouton Installer ouvre le dialogue du navigateur',
  page: '/index.html',
  setup: pwaSetup({ outcome: 'accepted' }),
  settle: BANNER_VISIBLE,
  checks: [
    {
      name: 'le dialogue natif est demandé une seule fois',
      expression: `(async () => { document.querySelector('[data-install-confirm]').click(); await new Promise(r => setTimeout(r, ${TICK_MS})); return { ok: window.__pwaTest.prompted === 1, detail: 'prompt appelé ' + window.__pwaTest.prompted + ' fois' }; })()`
    },
    {
      name: 'la bannière se referme après la demande',
      expression:
        "(() => { const b = document.querySelector('.pwa-install'); return { ok: !!b && b.hidden, detail: b ? 'hidden=' + b.hidden : 'bannière absente' }; })()"
    },
    {
      name: 'une installation acceptée n’est pas enregistrée comme un report',
      expression: `(() => { const raw = localStorage.getItem('${INSTALL_KEY}'); if (!raw) return { ok: true, detail: 'aucune réponse enregistrée' }; const a = JSON.parse(raw); return { ok: !a.dismissedAt, detail: raw }; })()`
    }
  ]
};

/** Clic sur « Plus tard » : report de 30 jours, aucun rappel. */
const DISMISS_POSTPONED = {
  name: 'PWA — « Plus tard » reporte l’offre sans la reproposer',
  page: '/index.html',
  setup: pwaSetup({ outcome: 'dismissed' }),
  settle: BANNER_VISIBLE,
  checks: [
    {
      name: 'la bannière se referme',
      expression: `(async () => { document.querySelector('[data-install-later]').click(); await new Promise(r => setTimeout(r, ${TICK_MS})); const b = document.querySelector('.pwa-install'); return { ok: !!b && b.hidden, detail: b ? 'hidden=' + b.hidden : 'bannière absente' }; })()`
    },
    {
      name: 'le report est enregistré avec la date du jour',
      expression: `(() => { const raw = localStorage.getItem('${INSTALL_KEY}'); if (!raw) return { ok: false, detail: 'aucune entrée' }; const a = JSON.parse(raw); return { ok: Number.isFinite(a.dismissedAt) && Date.now() - a.dismissedAt < 60000 && a.installed === false, detail: raw }; })()`
    },
    {
      name: 'un nouvel événement du navigateur ne réaffiche pas la bannière',
      expression:
        "(async () => { const ev = new Event('beforeinstallprompt'); ev.prompt = () => Promise.resolve(); ev.userChoice = Promise.resolve({ outcome: 'dismissed' }); window.dispatchEvent(ev); await new Promise(r => setTimeout(r, 7000)); const b = document.querySelector('.pwa-install'); return { ok: !!b && b.hidden, detail: 'hidden=' + (b ? b.hidden : 'absente') }; })()"
    }
  ]
};

/** Ordinateur : Chrome a déjà sa propre icône, pas de bannière. */
const DESKTOP_QUIET = {
  name: 'PWA — aucune bannière sur ordinateur',
  page: '/index.html',
  setup: pwaSetup({ mobile: false }),
  settle: 'true',
  checks: [
    {
      name: 'aucune bannière n’apparaît, même après le délai',
      expression:
        "(async () => { await new Promise(r => setTimeout(r, 7000)); const b = document.querySelector('.pwa-install'); return { ok: !b, detail: b ? 'bannière présente' : 'aucune bannière' }; })()"
    }
  ]
};

/** Paramètres sans navigateur installable : rien à proposer. */
const SETTINGS_UNAVAILABLE = {
  name: 'PWA — Paramètres : aucun bouton quand la page n’est pas installable',
  page: '/settings.html',
  // Manifeste absent : Chrome ne considère plus la page installable et német
  // aucun `beforeinstallprompt` — le cas « navigateur sans installation »
  // (Firefox, Safari) est ainsi reproduit sans simuler l’événement.
  faults: ['manifest.webmanifest'],
  // Marge d’attente : un événement tardif doit avoir le temps de se manifester.
  settle: "(async () => { await new Promise(r => setTimeout(r, 2000)); return true; })()",
  checks: [
    {
      name: 'la section reste masquée',
      expression:
        "(() => { const s = document.querySelector('[data-pwa-install]'); return { ok: s.hidden === true, detail: 'hidden=' + s.hidden }; })()"
    },
    {
      name: 'la section n’occupe aucune place dans la page',
      expression:
        "(() => { const d = getComputedStyle(document.querySelector('[data-pwa-install]')).display; return { ok: d === 'none', detail: 'display=' + d }; })()"
    },
    {
      name: 'aucune bannière ne s’affiche non plus',
      expression:
        "(() => { const b = document.querySelector('.pwa-install'); return { ok: !b, detail: b ? 'bannière présente' : 'aucune bannière' }; })()"
    }
  ]
};

/** Paramètres avec navigateur installable : bouton visible et fonctionnel. */
const SETTINGS_INSTALLABLE = {
  name: 'PWA — Paramètres : bouton proposé quand l’installation aboutira',
  page: '/settings.html',
  setup: pwaSetup(),
  settle: SETTINGS_VISIBLE,
  checks: [
    {
      name: 'la section devient visible et reprend sa mise en page',
      expression:
        "(() => { const d = getComputedStyle(document.querySelector('[data-pwa-install]')).display; return { ok: d === 'flex', detail: 'display=' + d }; })()"
    },
    {
      name: 'le libellé et l’explication sont traduits',
      expression:
        "(() => { const b = document.querySelector('[data-pwa-install-action]'); const help = document.querySelector('[data-pwa-install] .dm-help'); const label = b.textContent.trim(); const text = help ? help.textContent.trim() : ''; return { ok: label.length > 0 && text.length > 10 && !/pwa\\./.test(label + text), detail: label + ' — ' + text.slice(0, 45) }; })()"
    },
    {
      name: 'le bouton ouvre le dialogue puis referme la section',
      expression: `(async () => { document.querySelector('[data-pwa-install-action]').click(); await new Promise(r => setTimeout(r, ${TICK_MS})); const s = document.querySelector('[data-pwa-install]'); return { ok: window.__pwaTest.prompted === 1 && s.hidden === true, detail: 'prompt ' + window.__pwaTest.prompted + ' / hidden ' + s.hidden }; })()`
    }
  ]
};

/** Paramètres alors que la page tourne déjà comme application. */
const SETTINGS_ALREADY_INSTALLED = {
  name: 'PWA — Paramètres : rien à proposer quand l’application est installée',
  page: '/settings.html',
  setup: pwaSetup({ standalone: true }),
  settle: 'true',
  checks: [
    {
      name: 'la section reste masquée en mode application',
      expression:
        "(() => { const s = document.querySelector('[data-pwa-install]'); const d = getComputedStyle(s).display; return { ok: s.hidden === true && d === 'none', detail: 'hidden=' + s.hidden + ' / display=' + d }; })()"
    },
    {
      name: 'aucune bannière ne s’affiche',
      expression:
        "(async () => { await new Promise(r => setTimeout(r, 6500)); const b = document.querySelector('.pwa-install'); return { ok: !b, detail: b ? 'bannière présente' : 'aucune bannière' }; })()"
    }
  ]
};

export const PWA_CASES = [
  BANNER_MOBILE,
  INSTALL_ACCEPTED,
  DISMISS_POSTPONED,
  DESKTOP_QUIET,
  SETTINGS_UNAVAILABLE,
  SETTINGS_INSTALLABLE,
  SETTINGS_ALREADY_INSTALLED
];
