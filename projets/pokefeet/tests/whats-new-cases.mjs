/**
 * Cas de test navigateur du popup « nouveautés » (js/ui/whats-new.js).
 *
 * La page lit `data/changelog.json`, prend l'entrée la plus récente et la montre
 * si sa version diffère du cookie `pk_changelog_seen` — et seulement si
 * l'appareil contient déjà des données de jeu. Les cas ci-dessous couvrent ces
 * deux conditions :
 *
 *  - version inconnue + données : popup avec le titre, la date et les lignes de
 *    la version, et cookie de version écrit ;
 *  - version inconnue sans données : rien du tout, et aucun cookie écrit ;
 *  - version déjà vue : rien, même avec des données ;
 *  - version plus ancienne en cookie : la popup revient avec la nouvelle.
 *
 * Les attentes (version, titre, date, lignes) sont dérivées de
 * `data/changelog.json` : publier une nouvelle entrée en tête du fichier met
 * ces cas à jour au lieu de les casser.
 *
 * `cookies` est posé avant la navigation par le banc de test : la page les lit
 * dès son chargement, comme un joueur qui revient avec ses données.
 */

import fs from 'node:fs';

/** Cookie que retient js/ui/whats-new.js. */
const SEEN_COOKIE = 'pk_changelog_seen';

/** Entrée la plus récente du changelog, lue à la source. */
const LATEST_ENTRY = JSON.parse(
  fs.readFileSync(new URL('../data/changelog.json', import.meta.url), 'utf8')
)[0];

/** Version de cette entrée, au format du cookie. */
const LATEST_VERSION = [
  LATEST_ENTRY.Version.Major,
  LATEST_ENTRY.Version.Minor,
  LATEST_ENTRY.Version.Patch
].join('.');

/** Lignes de cette entrée, en français et en anglais. */
const LATEST_LINES = LATEST_ENTRY.Changelog.map((line) => [line.Translation_FR, line.Translation_EN]);

/** Expression vraie quand la popup est à l'écran. */
const POPUP_VISIBLE =
  "(() => { const el = document.querySelector('.whats-new'); return !!el && !el.hidden; })()";

/** Expression vraie quand la popup n'a jamais été construite. */
const POPUP_ABSENT = "document.querySelectorAll('.whats-new').length === 0";

/** Lit le cookie de version vue depuis la page. */
const seenCookieValue =
  "(() => { const parts = document.cookie.split(';'); for (let i = 0; i < parts.length; i++) { const pair = parts[i].trim(); const eq = pair.indexOf('='); if (eq === -1) continue; if (pair.slice(0, eq) === '" + SEEN_COOKIE + "') return decodeURIComponent(pair.slice(eq + 1)); } return null; })()";

/** Attente d'un tour de boucle d'événements, en millisecondes. */
const TICK_MS = 200;

/** Version déjà vue : la popup doit rester silencieuse. */
const NEW_VERSION_VISIBLE = {
  name: 'nouveautés — popup affichée pour une nouvelle version',
  page: '/index.html',
  cookies: { pk_best: '42' },
  settle: POPUP_VISIBLE,
  checks: [
    {
      name: 'la dernière version du changelog est reprise telle quelle',
      expression:
        `(() => { const badge = document.querySelector('.whats-new__badge').textContent.trim(); const title = document.querySelector('.whats-new__title').textContent.trim(); return { ok: badge === 'v${LATEST_VERSION}' && title === ${JSON.stringify(LATEST_ENTRY.Title)}, detail: badge + ' — ' + title }; })()`
    },
    {
      name: 'la date et les lignes de la version sont affichées',
      expression:
        `(async () => { const data = await (await fetch('data/changelog.json')).json(); const entry = data[0]; const date = document.querySelector('.whats-new__date').textContent.trim(); const items = document.querySelectorAll('.whats-new__item'); const texts = Array.from(items).map(li => li.textContent.trim()); const ok = date === entry.Date && date === ${JSON.stringify(LATEST_ENTRY.Date)} && items.length === entry.Changelog.length && items.length === ${LATEST_LINES.length} && items.length > 0 && texts.every(t => t.length > 10); return { ok, detail: date + ' (attendu ' + entry.Date + ') — ' + items.length + '/' + entry.Changelog.length + ' ligne(s)' }; })()`
    },
    {
      name: 'chaque ligne affichée vient du changelog',
      expression:
        `(() => { const text = Array.from(document.querySelectorAll('.whats-new__item')).map(li => li.textContent).join(' | '); const pairs = ${JSON.stringify(LATEST_LINES)}; const missing = pairs.filter(p => text.indexOf(p[0]) === -1 && text.indexOf(p[1]) === -1).map(p => p[0]); return { ok: missing.length === 0, detail: missing.length ? 'manque : ' + missing.join(' | ') : text.slice(0, 90) }; })()`
    },
    {
      name: 'la fenêtre est une modale accessible',
      expression:
        "(() => { const card = document.querySelector('.whats-new__card'); const label = card.getAttribute('aria-labelledby'); const title = label ? document.getElementById(label) : null; const ok = card.getAttribute('role') === 'dialog' && card.getAttribute('aria-modal') === 'true' && !!title; return { ok, detail: card.getAttribute('role') + ' / ' + card.getAttribute('aria-modal') + ' / ' + (title ? title.textContent : 'sans titre') }; })()"
    },
    {
      name: 'le focus part sur le bouton de fermeture',
      expression:
        "(() => { const active = document.activeElement; return { ok: !!active && active.classList.contains('whats-new__btn'), detail: active ? active.className : 'aucun focus' }; })()"
    },
    {
      name: 'les libellés sont traduits, sans clé brute',
      expression:
        "(() => { const txt = document.querySelector('.whats-new__card').innerText; const btn = document.querySelector('.whats-new__btn').textContent.trim(); const link = document.querySelector('.whats-new__link').textContent.trim(); return { ok: !/whatsNew\\.|undefined|NaN|\\{\\w+\\}/.test(txt) && btn.length > 0 && link.length > 0, detail: btn + ' / ' + link }; })()"
    },
    {
      name: 'la version affichée est enregistrée en cookie',
      expression:
        `(() => { const value = ${seenCookieValue}; return { ok: value === '${LATEST_VERSION}', detail: 'cookie = ' + value }; })()`
    }
  ]
};

/** Visiteur sans données de jeu : aucune fenêtre. */
const NEWCOMER_QUIET = {
  name: 'nouveautés — rien pour un visiteur sans données',
  page: '/index.html',
  // Laisse le temps au chargement du changelog de conclure, s'il devait montrer
  // quelque chose.
  settle: `(async () => { await new Promise(r => setTimeout(r, 1500)); return true; })()`,
  checks: [
    {
      name: 'aucune popup n’est construite',
      expression: POPUP_ABSENT
    },
    {
      name: 'aucun cookie de version n’est écrit',
      expression:
        `(() => { const value = ${seenCookieValue}; return { ok: value === null, detail: 'cookie = ' + value }; })()`
    }
  ]
};

/** Version déjà vue : la popup ne revient pas. */
const ALREADY_SEEN = {
  name: 'nouveautés — rien quand la version a déjà été vue',
  page: '/index.html',
  cookies: { pk_best: '42', [SEEN_COOKIE]: LATEST_VERSION },
  settle: `(async () => { await new Promise(r => setTimeout(r, 1500)); return true; })()`,
  checks: [
    {
      name: 'aucune popup n’est affichée',
      expression: POPUP_ABSENT
    }
  ]
};

/** Cookie d'une version plus ancienne : la popup revient. */
const OLD_VERSION_SEEN = {
  name: 'nouveautés — popup pour une version plus récente que le cookie',
  page: '/index.html',
  cookies: { pk_best: '42', [SEEN_COOKIE]: '5.1.1' },
  settle: POPUP_VISIBLE,
  checks: [
    {
      name: 'la nouvelle version est présentée',
      expression:
        `(() => { const badge = document.querySelector('.whats-new__badge').textContent.trim(); return { ok: badge === 'v${LATEST_VERSION}', detail: badge }; })()`
    },
    {
      name: 'le cookie est mis à jour avec la version affichée',
      expression:
        `(() => { const value = ${seenCookieValue}; return { ok: value === '${LATEST_VERSION}', detail: 'cookie = ' + value }; })()`
    }
  ]
};

/** Fermeture : bouton principal et touche Échap. */
const DISMISS_AND_ESCAPE = {
  name: 'nouveautés — fermeture au bouton et au clavier',
  page: '/index.html',
  cookies: { pk_best: '42' },
  settle: POPUP_VISIBLE,
  checks: [
    {
      name: 'le bouton ferme la popup sans effacer le cookie',
      expression:
        `(async () => { document.querySelector('.whats-new__btn').click(); await new Promise(r => setTimeout(r, ${TICK_MS})); const el = document.querySelector('.whats-new'); const value = ${seenCookieValue}; return { ok: !!el && el.hidden === true && value === '${LATEST_VERSION}', detail: 'hidden=' + (el ? el.hidden : 'absente') + ' / cookie=' + value }; })()`
    }
  ]
};

export const WHATS_NEW_CASES = [
  NEW_VERSION_VISIBLE,
  NEWCOMER_QUIET,
  ALREADY_SEEN,
  OLD_VERSION_SEEN,
  DISMISS_AND_ESCAPE
];
