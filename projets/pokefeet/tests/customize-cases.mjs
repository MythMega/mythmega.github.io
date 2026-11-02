/**
 * Cas de test navigateur de l'onglet « Personnalisations » du profil.
 *
 * L'onglet a quitté les Paramètres pour le profil (v6.0) : les cas vérifient
 * qu'il fonctionne à sa nouvelle place et qu'il ne reste rien de l'ancien
 * onglet dans settings.html.
 *
 *  - profil : le panneau s'ouvre seul, la grille des fonds se remplit quand on
 *    choisit une catégorie, la barre Pokédollars affiche un solde et le
 *    sélecteur fonds/boutons bascule ;
 *  - paramètres : il ne reste que Paramètres, Profil et Données, sans panneau
 *    ni popup d'achat de cosmétiques.
 */

/** Panneau ouvert et les autres refermés. */
const ONLY_CUSTOMIZE_VISIBLE =
  "(() => { const p = document.getElementById('statsCustomizePanel'); const others = ['statsDailyPanel', 'statsWeeklyPanel', 'statsMarathonPanel', 'statsTrophiesPanel', 'statsRewardsPanel'].map(id => document.getElementById(id)).filter(Boolean); return { ok: !!p && getComputedStyle(p).display !== 'none' && others.every(o => getComputedStyle(o).display === 'none'), detail: p ? 'panneau ' + getComputedStyle(p).display : 'panneau absent' }; })()";

/** Catégories construites et panneau ouvert. */
const CATEGORIES_READY =
  "(() => { const p = document.getElementById('statsCustomizePanel'); const tabs = document.querySelectorAll('#cosmeticBgSubtabs .cosmetic-subtab-btn'); return !!p && getComputedStyle(p).display !== 'none' && tabs.length > 1; })()";

const PROFILE_CUSTOMIZE_TAB = {
  name: 'profil — onglet Personnalisations avec la grille de cosmétiques',
  page: '/profile.html',
  setup: 'document.getElementById("statsTabCustomizeBtn").click()',
  settle: CATEGORIES_READY,
  checks: [
    {
      name: 'le panneau Personnalisations est le seul visible',
      expression: ONLY_CUSTOMIZE_VISIBLE
    },
    {
      name: 'les catégories et le sélecteur de type sont construits',
      expression:
        "(() => { const cats = Array.from(document.querySelectorAll('#cosmeticBgSubtabs .cosmetic-subtab-btn')).map(b => b.textContent.trim()); const types = document.querySelectorAll('#cosmeticTypeToggle button').length; return { ok: cats.length > 1 && types === 2, detail: cats.join(' / ') + ' — ' + types + ' type(s)' }; })()"
    },
    {
      name: 'choisir une catégorie remplit la grille des fonds',
      expression:
        "(async () => { const btns = document.querySelectorAll('#cosmeticBgSubtabs .cosmetic-subtab-btn'); if (btns.length < 2) return { ok: false, detail: 'une seule catégorie' }; const name = btns[1].textContent.trim(); btns[1].click(); await new Promise(r => setTimeout(r, 400)); const grid = document.querySelectorAll('#cosmeticsBgGrid .cosmetic-btn').length; return { ok: grid > 1, detail: grid + ' cosmétique(s) dans « ' + name + ' »' }; })()"
    },
    {
      name: 'la barre Pokédollars affiche un solde',
      expression:
        "(() => { const el = document.getElementById('dmWalletBalance'); const text = el ? el.textContent.trim() : ''; return { ok: /\\d/.test(text) && /P$/.test(text) && !!document.getElementById('dmWalletSpent'), detail: text }; })()"
    },
    {
      name: 'le basculement fonds / boutons fonctionne',
      expression:
        "(async () => { const btn = document.querySelector('#cosmeticTypeToggle button[data-type=\"Background-Buttons\"]'); btn.click(); await new Promise(r => setTimeout(r, 300)); const content = document.querySelector('.cosmetic-type-content[data-type=\"Background-Buttons\"]'); const grid = document.querySelectorAll('#cosmeticsBtnGrid .cosmetic-btn').length; return { ok: !!content && content.classList.contains('active') && grid > 1, detail: grid + ' bouton(s)' }; })()"
    },
    {
      name: 'la popup d’achat accompagne l’onglet',
      expression: "!!document.getElementById('shopUnlockPopup') && !!document.getElementById('shopUnlockBuy')"
    },
    {
      name: 'l’ancien panneau des Paramètres n’existe plus',
      expression: "document.getElementById('dmPanelCustomize') === null"
    }
  ]
};

const SETTINGS_WITHOUT_CUSTOMIZE = {
  name: 'paramètres — l’onglet Personnalisations a été retiré',
  page: '/settings.html',
  settle: "document.readyState === 'complete'",
  checks: [
    {
      name: 'il ne reste que Paramètres, Profil et Données',
      expression:
        "(() => { const tabs = Array.from(document.querySelectorAll('.dm-tab-btn')).map(btn => btn.dataset.tab); return { ok: tabs.join(',') === 'params,profile,data', detail: tabs.join(',') }; })()"
    },
    {
      name: 'aucun panneau ni popup de cosmétiques ne subsiste',
      expression:
        "(() => { const left = ['dmPanelCustomize', 'shopUnlockPopup', 'cosmeticsBgGrid', 'cosmeticTypeToggle'].filter(id => document.getElementById(id)); return { ok: left.length === 0, detail: left.length ? 'présent : ' + left.join(', ') : 'nettoyé' }; })()"
    },
    {
      name: 'la page ne contient plus de grille de cosmétiques',
      expression: "document.querySelectorAll('.cosmetic-btn').length === 0"
    }
  ]
};

export const CUSTOMIZE_CASES = [PROFILE_CUSTOMIZE_TAB, SETTINGS_WITHOUT_CUSTOMIZE];
