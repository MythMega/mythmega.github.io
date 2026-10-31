// wallet.js — Porte-monnaie Pokédollars (P) et achats de la Poké-Boutique.
// 1 XP totale = 1 P. Le solde est recalculé à chaque lecture :
//   XP totale + bonus de niveau (data/rewards/, Reward.Type "Currency") - prix des cosmétiques achetés.
// Les prix sont relus dans le catalogue : si un prix change, le solde des joueurs
// qui ont déjà acheté est mis à jour d'autant.
const PokefeetWallet = (function () {
  const PURCHASES_COOKIE = 'pk_shop_purchases';
  const SHOP_CAT = 'Shop';

  let catalog = null;
  let rewards = null;

  function getCookie(name) {
    const m = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
    return m ? decodeURIComponent(m.pop()) : null;
  }

  function setCookie(name, value) {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 10);
    document.cookie = name + '=' + encodeURIComponent(value) +
      ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax';
  }

  // ── Achats ─────────────────────────────────────────────────
  function getPurchasedIds() {
    const raw = getCookie(PURCHASES_COOKIE);
    if (!raw) return [];
    return raw.split(',').map(Number).filter(id => !isNaN(id));
  }

  function setPurchasedIds(ids) {
    setCookie(PURCHASES_COOKIE, ids.map(Number).filter(id => !isNaN(id)).join(','));
  }

  function isPurchased(id) {
    return getPurchasedIds().indexOf(Number(id)) !== -1;
  }

  function addPurchase(id) {
    const ids = getPurchasedIds();
    if (ids.indexOf(Number(id)) !== -1) return;
    ids.push(Number(id));
    setPurchasedIds(ids);
  }

  // ── Catalogue ──────────────────────────────────────────────
  async function loadCatalog() {
    if (!catalog) {
      catalog = await DataFiles.load('cosmetics').catch(e => {
        console.error('[Wallet] catalogue de cosmétiques illisible :', e);
        return [];
      });
    }
    return catalog;
  }

  // Un cosmétique est en vente s'il est en catégorie "Shop" avec un prix défini
  function isPurchasable(item) {
    return !!item && item.Cat === SHOP_CAT && item.Price !== null && item.Price !== undefined;
  }

  function priceOf(item) {
    return isPurchasable(item) ? Number(item.Price) : 0;
  }

  // ── Solde ──────────────────────────────────────────────────
  async function getLevelBonus(level) {
    if (!rewards) {
      rewards = await DataFiles.load('rewards').catch(e => {
        console.error('[Wallet] récompenses illisibles :', e);
        return [];
      });
    }
    let bonus = 0;
    rewards.forEach(entry => {
      if (Number(entry.Level) > level) return;
      (entry.Reward || []).forEach(item => {
        if (item.Type === 'Currency') bonus += Number(item.Data) || 0;
      });
    });
    return bonus;
  }

  async function getState() {
    const items = await loadCatalog();
    const totalXP = await PokefeetXP.computeTotalXP();
    const level = PokefeetXP.getLevel(totalXP);
    const bonus = await getLevelBonus(level);
    const purchased = getPurchasedIds();
    let spent = 0;
    purchased.forEach(id => { spent += priceOf(items.find(c => Number(c.ID) === id)); });

    return {
      totalXP: totalXP,
      level: level,
      bonus: bonus,
      purchased: purchased,
      spent: spent,
      balance: Math.max(0, totalXP + bonus - spent)
    };
  }

  // Achat : { ok, error, item, price, state }
  async function buy(id) {
    const items = await loadCatalog();
    const item = items.find(c => Number(c.ID) === Number(id));
    if (!item) return { ok: false, error: 'notFound' };
    if (!isPurchasable(item)) return { ok: false, error: 'notForSale', item: item };
    if (isPurchased(item.ID)) return { ok: false, error: 'owned', item: item };

    const state = await getState();
    const price = priceOf(item);
    if (state.balance < price) {
      return { ok: false, error: 'insufficient', item: item, price: price, state: state };
    }

    addPurchase(item.ID);
    return { ok: true, item: item, price: price, state: await getState() };
  }

  // ── Affichage ──────────────────────────────────────────────
  function format(amount) {
    const n = Math.round(Number(amount) || 0);
    const digits = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F');
    return (n < 0 ? '-' : '') + digits;
  }

  function formatP(amount) {
    return format(amount) + '\u00A0P';
  }

  return {
    getPurchasedIds: getPurchasedIds,
    setPurchasedIds: setPurchasedIds,
    isPurchased: isPurchased,
    loadCatalog: loadCatalog,
    isPurchasable: isPurchasable,
    priceOf: priceOf,
    getState: getState,
    buy: buy,
    format: format,
    formatP: formatP
  };
})();
