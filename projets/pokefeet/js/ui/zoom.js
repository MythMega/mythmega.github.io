// zoom.js — visionneuse plein écran des sprites Pokémon
// Ajoute un bouton loupe dans chaque .pokemon-image / .image-container et
// affiche l'image courante en grand, sans interpolation (voir game-image.css).
// Le clic joue le son d'UI via PokefeetFX (chargé avant ce fichier).
const PokefeetZoom = (function () {
  const BUTTON_CLASS = 'zoom-btn';
  const ICON = 'img/ui/magnifying.svg';
  let overlay = null;
  let keyHandler = null;

  function translate(key, fallback) {
    return (typeof Translator !== 'undefined') ? Translator.get(key, fallback) : fallback;
  }

  function buildOverlay() {
    const box = document.createElement('div');
    box.id = 'pokemonZoom';
    box.className = 'zoom-overlay';
    box.hidden = true;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    const img = document.createElement('img');
    img.className = 'zoom-image';
    img.alt = '';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'zoom-close';
    closeBtn.setAttribute('aria-label', translate('common.close', 'Fermer'));
    closeBtn.innerHTML = '&times;';

    box.appendChild(img);
    box.appendChild(closeBtn);
    box.addEventListener('click', function () { close(); });
    document.body.appendChild(box);
    return box;
  }

  function open(src, alt) {
    if (!src) return;
    overlay = overlay || document.getElementById('pokemonZoom') || buildOverlay();
    const img = overlay.querySelector('.zoom-image');
    if (!img) return;
    img.src = src;
    img.alt = alt || 'Pokémon';
    overlay.hidden = false;
    document.documentElement.classList.add('zoom-open');

    if (!keyHandler) {
      keyHandler = function (event) {
        if (event.key === 'Escape') close();
      };
      document.addEventListener('keydown', keyHandler);
    }
  }

  function close() {
    if (!overlay) return;
    overlay.hidden = true;
    document.documentElement.classList.remove('zoom-open');
    if (keyHandler) {
      document.removeEventListener('keydown', keyHandler);
      keyHandler = null;
    }
  }

  function attachButton(holder) {
    if (!holder || holder.querySelector('.' + BUTTON_CLASS)) return;
    const img = holder.querySelector('img');
    if (!img) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = BUTTON_CLASS;
    button.setAttribute('aria-label', translate('common.zoom', 'Agrandir l’image'));
    // URL absolue : une url() relative d'une feuille de style partirait de styles/.
    button.style.setProperty('--zoom-icon', 'url("' + new URL(ICON, document.baseURI).href + '")');
    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof PokefeetFX !== 'undefined') PokefeetFX.playSound('ui');
      const source = img.currentSrc || img.getAttribute('src');
      if (!source) return;
      open(source, img.alt);
    });
    holder.appendChild(button);
  }

  function init() {
    document.querySelectorAll('.pokemon-image, .image-container').forEach(attachButton);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  return {
    init: init,
    open: open,
    close: close
  };
})();
