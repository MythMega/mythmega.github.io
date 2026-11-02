/**
 * Cas de test navigateur : achat en Poké-Boutique et proposition d'équiper.
 *
 * Le portefeuille est simulé (`PokefeetWallet.getState` / `buy`) : la boutique
 * affiche des articles sans jouer 500 000 XP. En revanche tout le reste est le
 * vrai flux de l'application — clic sur « Acheter », confirmation, débit,
 * aperçu, puis la proposition d'équiper.
 *
 * La grille garde le solde lu au chargement (0 P), donc ses boutons d'achat
 * restent désactivés : le cas réactive le bouton avant de cliquer. C'est le
 * seul écart, et il ne saute que le contrôle d'abordabilité, déjà couvert par
 * l'affichage des cartes.
 *
 * Trois cas couvrent la réponse donnée au popup :
 *  - il s'ouvre après l'achat, nommé, illustré et traduit ;
 *  - « Utiliser maintenant » équipe le cosmétique (cookie + classe CSS) ;
 *  - « Plus tard » referme le popup sans rien changer à l'équipement.
 */

/** Portefeuille simulé : solde très large, achat toujours accepté. */
const WALLET_STUB = `(() => {
  if (window.__shopTest) return;
  if (typeof PokefeetWallet === 'undefined') return;
  window.__shopTest = { bought: 0, attempted: false };
  PokefeetWallet.getState = async () => ({
    totalXP: 500000, level: 60, bonus: 0, purchased: [], spent: 0, balance: 500000
  });
  PokefeetWallet.buy = async () => {
    window.__shopTest.bought += 1;
    return { ok: true, item: null, price: 500, state: await PokefeetWallet.getState() };
  };
})()`;

/** Achat complet : « Acheter » puis confirmation, jusqu'à voir le popup. */
const PURCHASE = `(async () => {
  const test = window.__shopTest;
  if (!test) return false;
  const visible = () => {
    const p = document.querySelector('.equip-prompt');
    return !!p && !p.classList.contains('hidden');
  };
  if (test.attempted) return visible();

  const btn = document.querySelector('#shopGrid .shop-buy-btn');
  if (!btn) return false;

  test.attempted = true;
  btn.disabled = false;                         // solde simulé, pas celui de la grille
  btn.click();                                  // demande de confirmation
  await new Promise(r => setTimeout(r, 250));
  btn.click();                                  // achat
  await new Promise(r => setTimeout(r, 500));
  return visible();
})()`;

/** Popup ouvert, nom, visuelle, actions et traduction. */
const PROMPT_SHOWN = {
  name: 'Boutique — un achat propose d’équiper le cosmétique',
  page: '/shop.html',
  setup: WALLET_STUB,
  settle: PURCHASE,
  checks: [
    {
      name: 'le popup s’ouvre après l’achat',
      expression:
        "(() => { const p = document.querySelector('.equip-prompt'); const open = !!p && !p.classList.contains('hidden'); return { ok: open && window.__shopTest.bought === 1, detail: (p ? 'popup ' + (open ? 'ouvert' : 'fermé') : 'aucun popup') + ' / achats ' + window.__shopTest.bought }; })()"
    },
    {
      name: 'il nomme le cosmétique acheté et montre sa visuelle',
      expression:
        "(() => { const title = document.querySelector('#equipPromptTitle').textContent.trim(); const img = document.querySelector('#equipPromptImg'); const item = Cosmetics.getAll().find(c => title.indexOf(c.Name) !== -1); return { ok: !!item && /maintenant/i.test(title) && !!img && img.complete && img.naturalWidth > 0, detail: title + ' — ' + (img ? img.getAttribute('src') + ' (' + img.naturalWidth + 'px)' : 'sans image') }; })()"
    },
    {
      name: 'les deux réponses sont proposées, traduites et ordonnées',
      expression:
        "(() => { const actions = document.querySelectorAll('.equip-prompt-actions button'); const equip = document.querySelector('#equipPromptEquip'); const later = document.querySelector('#equipPromptLater'); const ok = actions.length === 2 && actions[0] === equip && equip.textContent.trim().length > 0 && later.textContent.trim().length > 0 && !/shop\./.test(equip.textContent + later.textContent); return { ok, detail: actions.length + ' bouton(s) : ' + equip.textContent.trim() + ' | ' + later.textContent.trim() }; })()"
    },
    {
      name: 'le popup bloque la page, comme une modale',
      expression:
        "(() => { const p = document.querySelector('.equip-prompt'); const cs = getComputedStyle(p); return { ok: cs.position === 'fixed' && Number(cs.zIndex) >= 100 && document.activeElement && document.activeElement.id === 'equipPromptEquip', detail: cs.position + ' / z-index ' + cs.zIndex + ' / focus ' + (document.activeElement || {}).id }; })()"
    }
  ]
};

/** « Utiliser maintenant » : équipé pour de vrai (cookie + classe). */
const EQUIP_NOW = {
  name: 'Boutique — « Utiliser maintenant » équipe le cosmétique',
  page: '/shop.html',
  setup: WALLET_STUB,
  settle: PURCHASE,
  checks: [
    {
      name: 'le cosmétique devient celui du joueur et sa classe rejoint la page',
      expression:
        "(async () => { const title = document.querySelector('#equipPromptTitle').textContent; const item = Cosmetics.getAll().find(c => title.indexOf(c.Name) !== -1); if (!item) return { ok: false, detail: 'cosmétique introuvable : ' + title }; document.querySelector('#equipPromptEquip').click(); await new Promise(r => setTimeout(r, 300)); const prompt = document.querySelector('.equip-prompt'); const selected = item.Type === 'Background' ? Cosmetics.getSelectedBg() : Cosmetics.getSelectedBtn(); const applied = item.Type === 'Background' ? document.body.classList.contains(item.Value) : !!document.querySelector('.shop-demo.' + item.Value); return { ok: selected === item.Value && applied && prompt.classList.contains('hidden'), detail: 'équipé ' + selected + ' / classe ' + applied + ' / fermé ' + prompt.classList.contains('hidden') }; })()"
    },
    {
      name: 'le choix survit à une réapplication des cosmétiques',
      expression:
        "(async () => { const before = Cosmetics.getSelectedBg() || Cosmetics.getSelectedBtn(); Cosmetics.apply(); await new Promise(r => setTimeout(r, 100)); const after = Cosmetics.getSelectedBg() || Cosmetics.getSelectedBtn(); return { ok: !!after && after === before, detail: 'avant ' + before + ' / après ' + after }; })()"
    }
  ]
};

/** « Plus tard » : fermé, rien d'équipé, aperçu conservé. */
const EQUIP_LATER = {
  name: 'Boutique — « Plus tard » referme sans rien équiper',
  page: '/shop.html',
  setup: WALLET_STUB,
  settle: PURCHASE,
  checks: [
    {
      name: 'le popup se referme et le thème reste celui d’avant',
      expression:
        "(async () => { const before = Cosmetics.getSelectedBg(); document.querySelector('#equipPromptLater').click(); await new Promise(r => setTimeout(r, 250)); const prompt = document.querySelector('.equip-prompt'); const after = Cosmetics.getSelectedBg(); return { ok: prompt.classList.contains('hidden') && after === before, detail: 'avant ' + before + ' / après ' + after }; })()"
    },
    {
      name: 'l’aperçu du cosmétique reste affiché sur la page',
      expression:
        "(() => { const name = document.getElementById('shopPreviewName').textContent.trim(); return { ok: name !== '\u2014' && name.length > 0, detail: 'aperçu : ' + name }; })()"
    }
  ]
};

export const SHOP_CASES = [PROMPT_SHOWN, EQUIP_NOW, EQUIP_LATER];
