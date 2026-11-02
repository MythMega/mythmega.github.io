// equip-prompt.js — Après un achat, propose d'équiper tout de suite le cosmétique.
// Partagé par la Poké-Boutique (shop.html) et par la popup d'achat des
// Personnalisations (settings.html) : même rendu, même comportement.
(function () {
  const T = function (key, fallback) {
    return (typeof Translator !== 'undefined') ? Translator.get(key, fallback) : fallback;
  };

  const DEFAULT_ICON = 'default.png';
  const FALLBACK_ICON = './icon.png';

  let popup = null;
  let current = null;   // cosmétique acheté, en attente de réponse
  let onDone = null;    // callback(booléen : équipé ou non)
  let lastFocus = null;

  function iconSrc(item) {
    return 'img/cosmetics/' + (item.File || DEFAULT_ICON);
  }

  // ── Construction (une seule fois par page) ─────────────────
  function build() {
    const root = document.createElement('div');
    root.className = 'equip-prompt hidden';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'equipPromptTitle');

    const content = document.createElement('div');
    content.className = 'equip-prompt-content';

    const img = document.createElement('img');
    img.className = 'equip-prompt-img';
    img.id = 'equipPromptImg';
    img.alt = '';
    // onerror=null : si l'image par défaut manque aussi, on n'entre pas en boucle
    img.onerror = function () { this.onerror = null; this.src = FALLBACK_ICON; };
    content.appendChild(img);

    const title = document.createElement('h2');
    title.className = 'equip-prompt-title';
    title.id = 'equipPromptTitle';
    content.appendChild(title);

    const text = document.createElement('p');
    text.className = 'equip-prompt-text';
    text.id = 'equipPromptText';
    content.appendChild(text);

    const actions = document.createElement('div');
    actions.className = 'equip-prompt-actions';

    const equipBtn = document.createElement('button');
    equipBtn.type = 'button';
    equipBtn.className = 'big-btn';
    equipBtn.id = 'equipPromptEquip';
    equipBtn.setAttribute('data-tag', 'customizables-button');
    equipBtn.addEventListener('click', function () {
      const item = current;
      if (item && typeof Cosmetics !== 'undefined') {
        Cosmetics.select(item.Type, item.Value);
      }
      finish(true);
    });
    actions.appendChild(equipBtn);

    const laterBtn = document.createElement('button');
    laterBtn.type = 'button';
    laterBtn.className = 'secondary';
    laterBtn.id = 'equipPromptLater';
    laterBtn.addEventListener('click', function () { finish(false); });
    actions.appendChild(laterBtn);

    content.appendChild(actions);
    root.appendChild(content);

    root.addEventListener('click', function (e) {
      if (e.target === root) finish(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !root.classList.contains('hidden')) finish(false);
    });

    document.body.appendChild(root);
    return root;
  }

  // ── Ouverture / fermeture ──────────────────────────────────
  function open(cosmetic, callback) {
    if (!cosmetic) return;
    if (!popup) popup = build();

    current = cosmetic;
    onDone = (typeof callback === 'function') ? callback : null;

    const img = document.getElementById('equipPromptImg');
    if (img) {
      img.src = iconSrc(cosmetic);
      img.alt = cosmetic.Name;
    }
    document.getElementById('equipPromptTitle').textContent =
      T('shop.equipTitle', 'Utiliser {name} maintenant ?').replace('{name}', cosmetic.Name);
    document.getElementById('equipPromptText').textContent =
      T('shop.equipText', "Le cosmétique est à vous. Vous pouvez l'équiper tout de suite, ou continuer à regarder la boutique.");
    document.getElementById('equipPromptEquip').textContent =
      T('shop.equipNow', 'Utiliser maintenant');
    document.getElementById('equipPromptLater').textContent =
      T('shop.equipLater', 'Plus tard');

    lastFocus = document.activeElement;
    popup.classList.remove('hidden');
    document.getElementById('equipPromptEquip').focus();
  }

  function close() {
    if (!popup || popup.classList.contains('hidden')) return null;
    popup.classList.add('hidden');
    const done = onDone;
    current = null;
    onDone = null;
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
    lastFocus = null;
    return done;
  }

  function finish(equipped) {
    const done = close();
    if (typeof done === 'function') done(equipped);
  }

  function isOpen() {
    return !!popup && !popup.classList.contains('hidden');
  }

  window.PokefeetEquipPrompt = {
    open: open,
    close: function () { finish(false); },
    isOpen: isOpen
  };
})();
