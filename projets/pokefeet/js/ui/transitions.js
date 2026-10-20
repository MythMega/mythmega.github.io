// transitions.js — transitions d'images des Pokémon (sortie puis entrée)
// La préférence d'affichage vit dans PokefeetPrefs ('animations').
const PokefeetTransitions = (function () {
  const swapTimers = new WeakMap();

  function animationsEnabled() {
    return (typeof PokefeetPrefs !== 'undefined') ? PokefeetPrefs.get('animations') : true;
  }

  // Fait disparaître l'image courante, applique la nouvelle source, puis la fait apparaître.
  function swapImage(img, applySrc) {
    if (!img) {
      if (typeof applySrc === 'function') applySrc();
      return;
    }

    const holder = img.closest('.pokemon-image, .image-container') || img.parentElement || img;
    const finish = function () {
      if (typeof applySrc === 'function') applySrc();
    };

    if (!animationsEnabled()) {
      finish();
      return;
    }

    const pending = swapTimers.get(holder);
    if (pending) clearTimeout(pending);

    holder.classList.remove('fx-img-enter');
    holder.classList.add('fx-img-exit');

    const timer = setTimeout(function () {
      swapTimers.delete(holder);
      try {
        finish();
      } finally {
        holder.classList.remove('fx-img-exit');
        holder.classList.add('fx-img-enter');
        setTimeout(function () { holder.classList.remove('fx-img-enter'); }, 420);
      }
    }, 130);
    swapTimers.set(holder, timer);
  }

  return {
    animationsEnabled: animationsEnabled,
    swapImage: swapImage
  };
})();
