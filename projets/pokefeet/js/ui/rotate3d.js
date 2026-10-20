// rotate3d.js — inclinaison 3D du sprite quand on glisse sur l'image.
// Souris / stylet : glissement libre, l'image suit les deux axes.
// Tactile : glissement horizontal uniquement, pour laisser le défilement
// vertical de la page au navigateur (touch-action: pan-y dans rotate3d.css).
// L'angle maximum vient de settings/config.json (max3DRotate, 15 par défaut)
// et l'effet se coupe dans les paramètres (PokefeetPrefs 'rotate3d').
const PokefeetRotate3D = (function () {
  const HOLDER_SELECTOR = '.pokemon-image, .image-container';
  const DEFAULT_MAX_ANGLE = 15;
  const PERSPECTIVE = 700;
  // Léger agrandissement : évite de découvrir les bords du conteneur en penchant.
  const SCALE = 1.02;
  // Un glissement d'une demi-largeur (ou demi-hauteur) atteint l'angle maximum.
  const HALF_SIZE_FACTOR = 2;
  const MOVE_THRESHOLD = 2;
  const attached = new WeakSet();

  function prefEnabled() {
    return (typeof PokefeetPrefs !== 'undefined') ? PokefeetPrefs.get('rotate3d') : true;
  }

  function maxAngle() {
    if (typeof AppConfig !== 'undefined' && typeof AppConfig.get === 'function') {
      const value = AppConfig.get().max3DRotate;
      if (Number.isInteger(value) && value > 0) return value;
    }
    return DEFAULT_MAX_ANGLE;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function transformFor(angleX, angleY) {
    return 'perspective(' + PERSPECTIVE + 'px)' +
      ' rotateX(' + angleX.toFixed(2) + 'deg)' +
      ' rotateY(' + angleY.toFixed(2) + 'deg)' +
      ' scale(' + SCALE + ')';
  }

  function isInteractive(target) {
    return !!(target && target.closest && target.closest('button, a, input, select, textarea'));
  }

  function attach(holder) {
    if (!holder || attached.has(holder)) return;
    attached.add(holder);

    let drag = null;
    let releaseTimer = null;

    function stop() {
      drag = null;
      holder.classList.remove('is-rotating');
      const img = holder.querySelector('img');
      if (!img || !img.style.transform) return;
      // Sans transition pendant le glisser, le retour doit être animé explicitement.
      // Le switch Animations coupe aussi ce retour (html.no-animations).
      if (document.documentElement.classList.contains('no-animations')) {
        img.style.transition = '';
        img.style.transform = '';
        return;
      }
      img.style.transition = 'transform 240ms ease';
      requestAnimationFrame(function () {
        img.style.transform = '';
        releaseTimer = setTimeout(function () {
          img.style.transition = '';
          releaseTimer = null;
        }, 260);
      });
    }

    function onPointerDown(event) {
      if (!prefEnabled()) return;
      if (event.button > 0) return;
      if (isInteractive(event.target)) return;
      const img = holder.querySelector('img');
      if (!img || !img.getAttribute('src')) return;
      const rect = holder.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 40) return;

      // Reprise en main pendant le retour à plat : on annule l'animation inline.
      if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = null; }
      img.style.transition = '';

      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        width: rect.width,
        height: rect.height,
        horizontalOnly: event.pointerType === 'touch',
        moved: false
      };
      // Bloque la sélection de texte et le glisser-déposer natif de l'image.
      if (event.pointerType !== 'touch') event.preventDefault();
      try {
        holder.setPointerCapture(event.pointerId);
      } catch (error) {
        // Capture indisponible : les événements restent sur le conteneur.
      }
    }

    function onPointerMove(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (drag.horizontalOnly && Math.abs(dx) < MOVE_THRESHOLD) return;
      if (!drag.moved && Math.abs(dx) < MOVE_THRESHOLD && Math.abs(dy) < MOVE_THRESHOLD) return;

      const img = holder.querySelector('img');
      if (!img) return;
      drag.moved = true;
      holder.classList.add('is-rotating');

      const max = maxAngle();
      const angleY = clamp((dx / (drag.width / HALF_SIZE_FACTOR)) * max, -max, max);
      const angleX = drag.horizontalOnly
        ? 0
        : clamp((-dy / (drag.height / HALF_SIZE_FACTOR)) * max, -max, max);
      img.style.transform = transformFor(angleX, angleY);
    }

    function onPointerEnd(event) {
      if (!drag || (event && event.pointerId !== drag.pointerId)) return;
      stop();
    }

    holder.addEventListener('pointerdown', onPointerDown);
    holder.addEventListener('pointermove', onPointerMove);
    holder.addEventListener('pointerup', onPointerEnd);
    holder.addEventListener('pointercancel', onPointerEnd);
    holder.addEventListener('lostpointercapture', onPointerEnd);
  }

  function init() {
    document.querySelectorAll(HOLDER_SELECTOR).forEach(attach);
    // L'angle maximum est lu à chaque geste : un chargement tardif suffit.
    if (typeof AppConfig !== 'undefined' && typeof AppConfig.load === 'function') {
      AppConfig.load();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  return {
    init: init,
    maxAngle: maxAngle,
    enabled: prefEnabled
  };
})();
