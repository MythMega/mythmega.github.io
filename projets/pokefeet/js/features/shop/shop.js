// shop.js — Poké-Boutique : achat des cosmétiques avec les Pokédollars (P).
// Cliquer une carte met le cosmétique en aperçu, le bouton Acheter demande une
// confirmation (second clic) avant de débiter.
(function () {
  const $ = function (id) { return document.getElementById(id); };
  const T = function (key, fallback) {
    return (typeof Translator !== 'undefined') ? Translator.get(key, fallback) : fallback;
  };

  let catalog = [];
  let state = null;        // { totalXP, level, bonus, purchased, spent, balance }
  let filter = 'Background';
  let preview = null;      // cosmétique actuellement en aperçu
  let pending = null;      // { id, timer } — achat en attente de confirmation

  function money(amount) { return PokefeetWallet.formatP(amount); }

  // ── Icônes ─────────────────────────────────────────────────
  // Même convention que la page Personnalisations et settings.html :
  // l'icône du cosmétique vient de son champ File, et si le fichier manque
  // (thème pas encore illustré) on retombe sur l'image par défaut.
  const DEFAULT_ICON = 'default.png';
  const FALLBACK_ICON = './icon.png';

  function iconSrc(item) {
    return 'img/cosmetics/' + (item.File || DEFAULT_ICON);
  }

  function notify(message, fail) {
    if (typeof PokefeetFX !== 'undefined' && !PokefeetFX.notificationsEnabled()) return;

    const n = document.createElement('div');
    n.className = 'notification';
    n.textContent = message;
    if (fail) n.style.background = '#491111';
    $('notifications').appendChild(n);

    setTimeout(function () {
      n.style.opacity = 0;
      setTimeout(function () { n.remove(); }, 400);
    }, 2200);
    if (typeof PokefeetFX !== 'undefined') PokefeetFX.notificationSound(fail ? 'fail' : 'success');
  }

  // ── Solde ──────────────────────────────────────────────────
  async function refreshWallet() {
    state = await PokefeetWallet.getState();
    $('shopBalance').textContent = money(state.balance);
    $('shopTotalXP').textContent = PokefeetWallet.format(state.totalXP);
    $('shopBonus').textContent = PokefeetWallet.format(state.bonus);
    $('shopSpent').textContent = PokefeetWallet.format(state.spent);
  }

  function owned(id) { return state.purchased.indexOf(Number(id)) !== -1; }

  // ── Aperçu ─────────────────────────────────────────────────
  // On repasse d'abord par le thème équipé par le joueur, puis on pose celui
  // de l'article : fond sur la page, thème de bouton sur les boutons d'exemple.
  function applyPreview() {
    Cosmetics.apply();
    $('shopPreviewName').textContent = preview ? preview.Name : '\u2014';
    $('shopPreviewStop').classList.toggle('hidden', !preview);

    if (!preview) {
      $('shopPreviewMsg').textContent = T('shop.previewHint', 'Cliquez sur un cosmétique pour le prévisualiser.');
    } else if (preview.Type === 'Background') {
      const values = catalog.filter(c => c.Type === 'Background').map(c => c.Value);
      values.forEach(v => document.body.classList.remove(v));
      document.body.classList.add(preview.Value);
      $('shopPreviewMsg').textContent = T('shop.previewBg', "Fond d'écran appliqué à toute la page.");
    } else {
      const values = catalog.filter(c => c.Type === 'Background-Buttons').map(c => c.Value);
      document.querySelectorAll('.shop-demo').forEach(function (btn) {
        values.forEach(v => btn.classList.remove(v));
        btn.classList.remove('has-button-theme');
        btn.classList.add(preview.Value, 'has-button-theme');
      });
      $('shopPreviewMsg').textContent = T('shop.previewBtn', "Style de bouton appliqué aux boutons d'exemple.");
    }

    document.querySelectorAll('.shop-item').forEach(function (card) {
      card.classList.toggle('previewing', !!preview && Number(card.dataset.id) === preview.ID);
    });
  }

  function togglePreview(item) {
    preview = (preview && preview.ID === item.ID) ? null : item;
    applyPreview();
  }

  // ── Achat ──────────────────────────────────────────────────
  function clearPending() {
    if (pending) clearTimeout(pending.timer);
    pending = null;
  }

  async function buy(item, btn) {
    if (!pending || pending.id !== item.ID) {
      clearPending();
      pending = { id: item.ID, timer: setTimeout(function () { clearPending(); render(); }, 8000) };
      btn.classList.add('confirm');
      btn.textContent = T('shop.confirm', 'Confirmer ?');
      return;
    }

    clearPending();
    const result = await PokefeetWallet.buy(item.ID);
    if (!result.ok) {
      if (result.error === 'insufficient') {
        const missing = Number(item.Price) - result.state.balance;
        notify(T('shop.insufficient', 'Solde insuffisant : il manque {missing} P')
          .replace('{missing}', PokefeetWallet.format(missing)), true);
      } else {
        notify(T('shop.buyFailed', 'Achat impossible.'), true);
      }
      render();
      return;
    }

    notify(T('shop.bought', '{name} débloqué pour {price} !')
      .replace('{name}', item.Name)
      .replace('{price}', money(result.price)));
    await refreshWallet();

    preview = item;
    applyPreview();
    render();

    // Achat terminé : on propose d'équiper le cosmétique tout de suite.
    if (typeof PokefeetEquipPrompt !== 'undefined') {
      PokefeetEquipPrompt.open(item, function (equipped) {
        if (!equipped) return; // « Plus tard » : l'aperçu reste affiché
        preview = null;
        applyPreview();
      });
    }
  }

  // ── Rendu ──────────────────────────────────────────────────
  function priceLabel(item) {
    return money(Number(item.Price));
  }

  function buildCard(item) {
    const isOwned = owned(item.ID);
    const affordable = state.balance >= Number(item.Price);

    const card = document.createElement('div');
    card.className = 'shop-item';
    card.dataset.id = item.ID;
    if (isOwned) card.classList.add('owned');
    if (!isOwned && !affordable) card.classList.add('poor');

    const thumb = document.createElement('div');
    thumb.className = 'shop-thumb';
    const img = document.createElement('img');
    img.src = iconSrc(item);
    img.alt = item.Name;
    img.loading = 'lazy';
    // onerror=null : si l'image par défaut manque aussi, on n'entre pas en boucle
    img.onerror = function () { this.onerror = null; this.src = FALLBACK_ICON; };
    thumb.appendChild(img);
    if (isOwned) {
      const tag = document.createElement('span');
      tag.className = 'shop-thumb-tag';
      tag.textContent = '\u2713 ' + T('shop.ownedShort', 'Obtenu');
      thumb.appendChild(tag);
    }
    card.appendChild(thumb);

    const name = document.createElement('div');
    name.className = 'shop-item-name';
    name.textContent = item.Name;
    card.appendChild(name);

    const type = document.createElement('div');
    type.className = 'shop-item-type';
    type.textContent = item.Type === 'Background'
      ? T('shop.typeBackground', "Fond d'écran")
      : T('shop.typeButtons', 'Boutons');
    card.appendChild(type);

    const foot = document.createElement('div');
    foot.className = 'shop-item-foot';

    const price = document.createElement('span');
    price.className = 'shop-item-price';
    price.textContent = priceLabel(item);
    foot.appendChild(price);

    if (isOwned) {
      const label = document.createElement('span');
      label.className = 'shop-item-state';
      label.textContent = T('shop.owned', 'Obtenu');
      foot.appendChild(label);
    } else {
      const buyBtn = document.createElement('button');
      buyBtn.type = 'button';
      buyBtn.className = 'shop-buy-btn';
      buyBtn.textContent = T('shop.buy', 'Acheter');
      buyBtn.disabled = !affordable;
      buyBtn.title = affordable
        ? T('shop.buyTitle', 'Acheter ce cosmétique')
        : T('shop.tooExpensive', 'Solde insuffisant');
      buyBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        buy(item, buyBtn);
      });
      foot.appendChild(buyBtn);
    }
    card.appendChild(foot);

    if (!isOwned && !affordable) {
      const missing = document.createElement('div');
      missing.className = 'shop-item-state poor';
      missing.textContent = T('shop.missing', 'Il manque {amount}')
        .replace('{amount}', money(Number(item.Price) - state.balance));
      card.appendChild(missing);
    }

    card.addEventListener('click', function () { togglePreview(item); });
    return card;
  }

  function render() {
    const grid = $('shopGrid');
    const items = catalog.filter(function (item) {
      return item.Type === filter && PokefeetWallet.isPurchasable(item);
    });

    grid.innerHTML = '';
    items.forEach(item => grid.appendChild(buildCard(item)));
    $('shopEmpty').classList.toggle('hidden', items.length > 0);
  }

  // ── Init ───────────────────────────────────────────────────
  async function init() {
    catalog = await PokefeetWallet.loadCatalog();
    // Reprend les cosmétiques que le joueur a équipés dans les préférences
    await Cosmetics.load();

    await refreshWallet();
    render();
    applyPreview();

    $('shopFilters').addEventListener('click', function (e) {
      const btn = e.target.closest('button[data-filter]');
      if (!btn) return;
      filter = btn.dataset.filter;
      this.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
      render();
    });

    $('shopPreviewStop').addEventListener('click', function () {
      preview = null;
      applyPreview();
    });

    // Les boutons d'exemple ne servent qu'à l'aperçu
    $('shopPreviewStage').addEventListener('click', function (e) { e.stopPropagation(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
