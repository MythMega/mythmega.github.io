/**
 * Cas de test navigateur « page entière » pour scripts/test-save-load.mjs.
 *
 * Chaque cas charge une vraie page de l'application, éventuellement avec des
 * fichiers de data/ en panne, puis évalue des assertions dans la page.
 *
 * Propriétés reconnues :
 *  - `page`    : chemin de la page à charger (depuis la racine du projet) ;
 *  - `faults`  : fichiers servis en 404 (fichier de données absent) ;
 *  - `corrupt` : fichiers servis en 200 avec un contenu invalide (manifeste cassé) ;
 *  - `cookies` : cookies posés avant la navigation (données de jeu simulées) ;
 *  - `setup`   : expression exécutée une fois la page chargée (ex. ouvrir un onglet) ;
 *  - `settle`  : expression interrogée jusqu'à devenir vraie, ou jusqu'au délai ;
 *  - `checks`  : assertions { name, expression, match? | expect? }. L'expression est
 *                évaluée dans la page ; elle peut renvoyer un booléen ou
 *                { ok, detail }. `match` compare une sous-chaîne, `expect` une
 *                égalité stricte ; sinon la valeur doit être vraie.
 *
 * Chaque cas vérifie en plus automatiquement qu'aucune exception n'est remontée
 * jusqu'au navigateur : les erreurs attrapées par le code restent de simples
 * messages console, elles ne font pas échouer le test.
 *
 * Note sur data-files.js : un fichier de data/ manquant est toléré tant qu'un
 * autre fichier du même manifeste se charge (les entrées manquantes sont
 * simplement absentes), mais un manifeste absent ou invalide fait échouer le
 * chargement complet du jeu de données. Les cas ci-dessous couvrent les deux.
 */

import { PWA_CASES } from './pwa-cases.mjs';
import { LEVEL_CASES } from './challenge-level-cases.mjs';
import { SHOP_CASES } from './shop-cases.mjs';
import { WHATS_NEW_CASES } from './whats-new-cases.mjs';
import { CUSTOMIZE_CASES } from './customize-cases.mjs';

const XP_SCALE_PAGE = {
  name: 'profil — barème d’XP cohérent avec la courbe',
  page: '/profile.html',
  settle: '/Niveau \\d+/.test((document.getElementById("statsLevel") || {}).textContent || "")',
  checks: [
    {
      name: 'le coût du niveau 99 → 100 affiché vient de la courbe',
      expression: '(() => { const shown = document.getElementById("xpLevelCost100").textContent; return { ok: shown === String(PokefeetXP.levelCost(99)), detail: shown + " / attendu " + PokefeetXP.levelCost(99) }; })()'
    },
    {
      name: 'le total cumulé affiché vient de la courbe',
      expression: '(() => { const shown = document.getElementById("xpLevelTotal").textContent; return { ok: shown === String(PokefeetXP.xpToReach(100)), detail: shown + " / attendu " + PokefeetXP.xpToReach(100) }; })()'
    },
    {
      name: 'chaque ligne du barème annonce son vrai palier',
      expression: '(() => { const rows = Array.from(document.querySelectorAll("#xpScaleModal [data-level]")); const bad = rows.filter(r => { const level = Number(r.dataset.level); return r.textContent.indexOf(String(level)) === -1 || r.textContent.indexOf(String(level + 1)) === -1; }); return { ok: rows.length > 0 && bad.length === 0, detail: rows.length + " ligne(s), " + bad.length + " incorrecte(s)" }; })()'
    },
    {
      name: 'le texte d’introduction n’affiche plus de jeton brut',
      expression: '(() => { const el = document.getElementById("xpLevelsDesc"); const text = el ? el.textContent : ""; return { ok: !!el && text.indexOf("{step}") === -1 && text.indexOf("{total}") === -1, detail: text.trim().slice(0, 90) }; })()'
    },
    {
      name: 'le niveau affiché est celui que la courbe déduit de l’XP totale',
      expression: '(async () => { const el = document.getElementById("statsLevel"); const shown = Number((el.textContent.match(/Niveau (\\d+)/) || [])[1]); const expected = PokefeetXP.getLevel(await PokefeetXP.computeTotalXP()); return { ok: shown === expected, detail: "affiché " + shown + " / calculé " + expected }; })()'
    }
  ]
};

const TROPHIES_MANIFEST_FAULT = {
  name: 'profil — manifeste des trophées indisponible',
  page: '/profile.html',
  faults: ['data/trophiesfiles.json'],
  setup: 'document.getElementById("statsTabTrophiesBtn").click()',
  settle: '!!document.querySelector(".trophies-empty")',
  checks: [
    {
      name: 'l’onglet Trophées annonce l’absence de données',
      expression: '(() => { const el = document.querySelector(".trophies-empty"); return { ok: !!el && /Aucun trophée/.test(el.textContent), detail: el ? el.textContent.trim() : "aucun message" }; })()'
    },
    {
      name: 'aucune carte de trophée n’est affichée',
      expression: 'document.querySelectorAll(".trophy-entry").length === 0'
    },
    {
      name: 'la grille ne contient que le message d’état vide',
      expression: '(() => { const grid = document.getElementById("trophiesGrid"); if (!grid) return { ok: false, detail: "grille absente" }; const kids = Array.from(grid.children); return { ok: kids.length === 1 && kids[0].classList.contains("trophies-empty"), detail: kids.length + " enfant(s)" }; })()'
    },
    {
      name: 'le niveau reste affiché sans valeur cassée',
      expression: '(async () => { const level = (document.getElementById("statsLevel") || {}).textContent || ""; const expected = PokefeetXP.getLevel(await PokefeetXP.computeTotalXP()); return { ok: new RegExp("Niveau " + expected + "\\\\b").test(level) && !/NaN|undefined/.test(document.body.innerText), detail: level.trim() }; })()'
    }
  ]
};

const REWARDS_MANIFEST_FAULT = {
  name: 'profil — manifeste des récompenses absent',
  page: '/profile.html',
  faults: ['data/rewardsfiles.json'],
  setup: 'document.getElementById("statsTabRewardsBtn").click()',
  settle: '(() => { const el = document.getElementById("rewardComingSoon"); return !!el && getComputedStyle(el).display !== "none"; })()',
  checks: [
    {
      name: 'l’onglet Récompenses bascule sur son message d’attente',
      expression: '(() => { const el = document.getElementById("rewardComingSoon"); return { ok: !!el && el.textContent.trim().length > 0, detail: el ? el.textContent.trim() : "élément absent" }; })()'
    },
    {
      name: 'la grille de récompenses est masquée',
      expression: '(() => { const el = document.getElementById("rewardsGrid"); if (!el) return { ok: false, detail: "élément absent" }; const cs = getComputedStyle(el); return { ok: cs.display === "none", detail: "inline=" + (el.style.display || "(vide)") + " / calculé=" + cs.display }; })()'
    },
    {
      name: 'aucune carte de récompense n’est construite',
      expression: 'document.querySelectorAll("#rewardsGrid > *").length === 0'
    },
    {
      name: 'les badges du profil restent rendus sans récompenses',
      expression: '(() => { const el = document.getElementById("profileBadges"); return !!el && document.querySelectorAll(".profile-badge-icon").length === 0; })()'
    }
  ]
};

const CHALLENGES_MANIFEST_FAULT = {
  name: 'défis — manifeste des challenges indisponible',
  page: '/list_challenges.html',
  faults: ['data/bonus_challengesfiles.json'],
  settle: '!!document.querySelector(".challenges-empty")',
  checks: [
    {
      name: 'la liste des défis annonce l’absence de données',
      expression: '(() => { const el = document.querySelector(".challenges-empty"); return { ok: !!el && /Aucun défi/.test(el.textContent), detail: el ? el.textContent.trim() : "aucun message" }; })()'
    },
    {
      name: 'aucune carte de défi n’est affichée',
      expression: 'document.querySelectorAll("#challengesList .challenge-card").length === 0'
    },
    {
      name: 'aucun onglet de défi n’est construit',
      expression: 'document.querySelectorAll(".challenge-tab-btn").length === 0'
    }
  ]
};

// Un fichier de data/cosmetics/ absent n'efface pas le catalogue : seuls les
// cosmétiques de ce fichier disparaissent. La boutique doit le supporter.
const SHOP_BACKGROUND_PART_FAULT = {
  name: 'boutique — fichier de cosmétiques absent (dégradation partielle)',
  page: '/shop.html',
  faults: ['data/cosmetics/bg_shop.json'],
  settle: '(() => { const el = document.getElementById("shopEmpty"); return !!el && getComputedStyle(el).display !== "none"; })()',
  checks: [
    {
      name: 'l’onglet Fonds d’écran annonce qu’il n’y a rien à acheter',
      expression: '(() => { const el = document.getElementById("shopEmpty"); const grid = document.getElementById("shopGrid"); return { ok: !!el && el.textContent.trim().length > 0 && grid.children.length === 0, detail: (el ? el.textContent.trim() : "message absent") + " / " + grid.children.length + " carte(s)" }; })()'
    },
    {
      name: 'les cosmétiques des autres fichiers restent en vente',
      expression: '(async () => { const tab = document.querySelector(".shop-filter[data-filter=\\"Background-Buttons\\"]"); tab.click(); await new Promise(r => setTimeout(r, 500)); const items = document.querySelectorAll("#shopGrid .shop-item"); const vignettes = document.querySelectorAll("#shopGrid .shop-thumb img"); return { ok: items.length > 0 && vignettes.length === items.length, detail: items.length + " article(s), " + vignettes.length + " vignette(s)" }; })()'
    },
    {
      name: 'le catalogue ne contient plus les identifiants du fichier manquant',
      expression: '(async () => { const catalog = await PokefeetWallet.loadCatalog(); const gone = catalog.filter(i => i.ID >= 2000 && i.ID <= 2024).length; const kept = catalog.filter(i => i.ID >= 2100 && i.ID <= 2124).length; return { ok: gone === 0 && kept > 0, detail: gone + " identifiant(s) 2000-2024, " + kept + " identifiant(s) 2100-2124 conservés" }; })()'
    },
    {
      name: 'l’achat d’un cosmétique disparu échoue proprement',
      expression: '(async () => { const result = await PokefeetWallet.buy(2000); return { ok: result && result.ok === false && result.error === "notFound", detail: JSON.stringify(result) }; })()'
    },
    {
      name: 'le solde reste calculé',
      expression: '(async () => { const state = await PokefeetWallet.getState(); return { ok: Number.isFinite(state.balance) && state.balance >= 0, detail: state.balance + " P" }; })()'
    }
  ]
};

// Manifeste invalide : le catalogue entier est illisible, la boutique doit
// afficher son état vide plutôt que de rester blanche.
const SHOP_CATALOG_MANIFEST_CORRUPT = {
  name: 'boutique — manifeste des cosmétiques corrompu',
  page: '/shop.html',
  corrupt: { 'data/cosmeticsfiles.json': '{ "invalide": true }' },
  settle: '(() => { const el = document.getElementById("shopEmpty"); return !!el && getComputedStyle(el).display !== "none"; })()',
  checks: [
    {
      name: 'la boutique annonce qu’aucun cosmétique n’est en vente',
      expression: '(() => { const el = document.getElementById("shopEmpty"); return { ok: !!el && el.textContent.trim().length > 0, detail: el ? el.textContent.trim() : "élément absent" }; })()'
    },
    {
      name: 'aucune carte n’est construite dans la grille',
      expression: 'document.querySelectorAll("#shopGrid .shop-item").length === 0'
    },
    {
      name: 'le catalogue est vide au lieu de faire échouer la page',
      expression: '(async () => { const catalog = await PokefeetWallet.loadCatalog(); return { ok: Array.isArray(catalog) && catalog.length === 0, detail: Array.isArray(catalog) ? catalog.length + " entrée(s)" : "non-tableau" }; })()'
    },
    {
      name: 'le solde reste calculé',
      expression: '(async () => { const state = await PokefeetWallet.getState(); return { ok: Number.isFinite(state.balance) && state.balance >= 0, detail: state.balance + " P" }; })()'
    }
  ]
};

// Les crédits sont un manifeste « objet » : les traductions se chargent encore,
// mais la liste des membres est absente. Le rendu doit se replier sur son
// message d'état vide au lieu de lever une erreur.
const CREDITS_PART_FAULT = {
  name: 'crédits — fichier de membres absent',
  page: '/credits.html',
  faults: ['data/credits/members.json'],
  settle: '/Aucun crédit/.test((document.getElementById("creditsContent") || {}).textContent || "")',
  checks: [
    {
      name: 'les crédits affichent leur message d’état vide',
      expression: '(() => { const el = document.getElementById("creditsContent"); return { ok: !!el && /Aucun crédit/.test(el.textContent), detail: el ? el.textContent.trim() : "conteneur absent" }; })()'
    },
    {
      name: 'aucune carte de crédit n’est affichée',
      expression: 'document.querySelectorAll(".credit-card").length === 0'
    }
  ]
};

const CREDITS_MANIFEST_CORRUPT = {
  name: 'crédits — manifeste corrompu',
  page: '/credits.html',
  corrupt: { 'data/creditsfiles.json': '{ "invalide": true }' },
  settle: '/Impossible/.test((document.getElementById("creditsContent") || {}).textContent || "")',
  checks: [
    {
      name: 'les crédits annoncent l’échec de chargement',
      expression: '(() => { const el = document.getElementById("creditsContent"); return { ok: !!el && /Impossible/.test(el.textContent), detail: el ? el.textContent.trim() : "conteneur absent" }; })()'
    },
    {
      name: 'aucune carte ni onglet de crédit n’est affiché',
      expression: 'document.querySelectorAll(".credit-card").length === 0 && document.querySelectorAll(".credits-tab-btn").length === 0'
    }
  ]
};

const CHANGELOG_FILE_FAULT = {
  name: 'changelog — fichier absent',
  page: '/changelog.html',
  faults: ['data/changelog.json'],
  settle: '/Impossible/.test((document.getElementById("changelog-loading") || {}).textContent || "")',
  checks: [
    {
      name: 'la page change de message plutôt que de rester bloquée',
      expression: '(() => { const el = document.getElementById("changelog-loading"); const list = document.getElementById("changelog-list"); return { ok: !!el && getComputedStyle(el).display !== "none" && !!list && getComputedStyle(list).display === "none", detail: el ? el.textContent.trim() : "élément absent" }; })()'
    },
    {
      name: 'aucune version n’est affichée',
      expression: 'document.querySelectorAll(".changelog-version-group").length === 0'
    }
  ]
};

export const BROWSER_CASES = [
  XP_SCALE_PAGE,
  TROPHIES_MANIFEST_FAULT,
  REWARDS_MANIFEST_FAULT,
  CHALLENGES_MANIFEST_FAULT,
  SHOP_BACKGROUND_PART_FAULT,
  SHOP_CATALOG_MANIFEST_CORRUPT,
  CREDITS_PART_FAULT,
  CREDITS_MANIFEST_CORRUPT,
  CHANGELOG_FILE_FAULT,
  ...PWA_CASES,
  ...LEVEL_CASES,
  ...SHOP_CASES,
  ...WHATS_NEW_CASES,
  ...CUSTOMIZE_CASES
];
