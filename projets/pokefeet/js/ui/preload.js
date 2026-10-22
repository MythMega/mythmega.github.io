// preload.js — préchargement des sprites avant le démarrage d'une partie.
// Sur le réseau, les transitions (sortie puis entrée d'image) se jouaient avant
// que le sprite soit arrivé : l'image apparaissait vide pendant l'animation puis
// « sautait » en place. On charge donc à l'avance les deux images de chaque
// Pokémon — le pied (Image) et le sprite complet (FullImage), ce dernier servant
// aux révélations, à la popup d'échec et au récapitulatif de fin.
// Les appels sont idempotents : une URL déjà chargée (ou en cours) n'est pas
// redemandée, et un échec ne bloque jamais la partie (délais maximaux ci-dessous).
const PokefeetPreload = (function () {
  const CONCURRENCY = 6;           // téléchargements simultanés
  const IMAGE_TIMEOUT_MS = 8000;   // une image trop lente est abandonnée
  const BATCH_TIMEOUT_MS = 12000;  // délai maximal avant de démarrer la partie
  const LOADING_CLASS = 'is-loading-sprites';
  const LABEL_CLASS = 'sprite-loading-label';

  const loads = new Map();       // url -> promesse de chargement
  const keepAlive = new Set();   // garde une référence : évite l'annulation par le GC

  function spriteUrls(pokemon) {
    if (!pokemon) return [];
    const urls = [];
    if (pokemon.Image) urls.push(pokemon.Image);
    if (pokemon.FullImage && pokemon.FullImage !== pokemon.Image) urls.push(pokemon.FullImage);
    return urls;
  }

  function load(url) {
    if (!url) return Promise.resolve();
    const known = loads.get(url);
    if (known) return known;

    const promise = new Promise(function (resolve) {
      const img = new Image();
      let settled = false;
      function finish() {
        if (settled) return;
        settled = true;
        keepAlive.delete(img);
        resolve();
      }
      img.onload = function () {
        // decode() garantit que le bitmap est prêt avant l'affichage.
        if (typeof img.decode === 'function') img.decode().then(finish, finish);
        else finish();
      };
      img.onerror = finish;
      keepAlive.add(img);
      img.src = url;
      setTimeout(finish, IMAGE_TIMEOUT_MS);
    });

    loads.set(url, promise);
    return promise;
  }

  // Charge les images de tous les Pokémon fournis, avec une concurrence limitée.
  async function preloadPokemons(pokemons) {
    const urls = [];
    (pokemons || []).forEach(function (pokemon) {
      spriteUrls(pokemon).forEach(function (url) {
        if (urls.indexOf(url) === -1) urls.push(url);
      });
    });
    if (!urls.length) return;

    let cursor = 0;
    const worker = async function () {
      while (cursor < urls.length) {
        const url = urls[cursor];
        cursor += 1;
        await load(url);
      }
    };
    const workers = [];
    const count = Math.min(CONCURRENCY, urls.length);
    for (let i = 0; i < count; i++) workers.push(worker());

    let timer = null;
    const deadline = new Promise(function (resolve) {
      timer = setTimeout(resolve, BATCH_TIMEOUT_MS);
    });
    await Promise.race([Promise.all(workers), deadline]);
    clearTimeout(timer);
  }

  function loadingLabelText() {
    if (typeof Translator !== 'undefined' && typeof Translator.get === 'function') {
      return Translator.get('common.loadingSprites', 'Chargement des sprites...');
    }
    return 'Chargement des sprites...';
  }

  // Voile de chargement sur la zone d'image + champs de saisie désactivés,
  // pour que le joueur ne lance pas un essai avant l'affichage du premier sprite.
  async function prepareGame(pokemons) {
    const boxes = Array.prototype.slice.call(document.querySelectorAll('.pokemon-image, .image-container'));
    const disabled = [];
    Array.prototype.forEach.call(document.querySelectorAll('.guess-area input, .guess-area button'), function (el) {
      if (!el.disabled) {
        el.disabled = true;
        disabled.push(el);
      }
    });

    boxes.forEach(function (box) {
      box.classList.add(LOADING_CLASS);
      if (box.querySelector('.' + LABEL_CLASS)) return;
      const label = document.createElement('span');
      label.className = LABEL_CLASS;
      label.textContent = loadingLabelText();
      box.appendChild(label);
    });

    try {
      await preloadPokemons(pokemons);
    } finally {
      disabled.forEach(function (el) { el.disabled = false; });
      boxes.forEach(function (box) {
        box.classList.remove(LOADING_CLASS);
        const label = box.querySelector('.' + LABEL_CLASS);
        if (label) label.remove();
      });
    }
  }

  return {
    preloadPokemons: preloadPokemons,
    prepareGame: prepareGame
  };
})();
