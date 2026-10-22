// pokemon-files.js — source unique des données Pokémon.
// Les données sont éclatées dans data/mons/*.json et data/monsfiles.json liste
// les fichiers à charger (même structure et mêmes propriétés que l'ancien
// data/pokemons.json). Repli automatique sur data/pokemons.json si le manifeste
// est absent, et un fichier cassé n'empêche pas de charger les autres.
const PokemonFiles = (function () {
  const MANIFEST_URL = 'data/monsfiles.json';
  const FALLBACK_URL = 'data/pokemons.json';
  const DIR = 'data/mons/';
  let pending = null;

  function urlFor(name) {
    const clean = String(name || '').trim();
    if (!clean) return '';
    if (/^(https?:)?\/\//i.test(clean) || clean.charAt(0) === '/') return clean;
    return DIR + clean;
  }

  async function readList(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status + ' pour ' + url);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('tableau attendu dans ' + url);
    return data;
  }

  // Entrées brutes de tous les fichiers, concaténées et mises en cache.
  async function loadRaw() {
    if (pending) return pending;
    pending = (async function () {
      const ignored = [];
      try {
        const files = await readList(MANIFEST_URL);
        const results = await Promise.allSettled(files.map(function (name) {
          return readList(urlFor(name));
        }));
        const merged = [];
        results.forEach(function (result, i) {
          if (result.status === 'fulfilled') {
            result.value.forEach(function (entry) { merged.push(entry); });
          } else {
            ignored.push(files[i]);
          }
        });
        if (merged.length) {
          if (ignored.length) console.warn('[PokemonFiles] fichiers ignorés :', ignored.join(', '));
          return merged;
        }
        console.warn('[PokemonFiles] aucun fichier de ' + DIR + ' exploitable, repli sur ' + FALLBACK_URL);
      } catch (error) {
        console.warn('[PokemonFiles] manifeste ' + MANIFEST_URL + ' indisponible, repli sur ' + FALLBACK_URL, error);
      }
      return readList(FALLBACK_URL);
    })();
    return pending;
  }

  // Instances Pokemon de tous les fichiers (nécessite js/core/pokemon.js).
  async function load() {
    const raw = await loadRaw();
    return raw.map(function (data) { return new Pokemon(data); });
  }

  return {
    loadRaw: loadRaw,
    load: load,
    urlFor: urlFor,
    MANIFEST_URL: MANIFEST_URL,
    FALLBACK_URL: FALLBACK_URL
  };
})();
