// data-files.js — source unique des données de jeu éclatées.
// Chaque jeu de données vit dans data/<dossier>/ et son manifeste
// data/<nom>files.json liste les fichiers à charger, exactement comme
// data/monsfiles.json le fait pour data/mons/. Les entrées sont fusionnées dans
// l'ordre du manifeste, et un fichier cassé n'empêche pas de charger les autres.
const DataFiles = (function () {
  const SETS = {
    trophies:   { manifest: 'data/trophiesfiles.json',         dir: 'data/trophies/',        shape: 'list' },
    rewards:    { manifest: 'data/rewardsfiles.json',          dir: 'data/rewards/',         shape: 'list' },
    challenges: { manifest: 'data/bonus_challengesfiles.json', dir: 'data/bonus_challenges/', shape: 'list' },
    cosmetics:  { manifest: 'data/cosmeticsfiles.json',        dir: 'data/cosmetics/',       shape: 'list' },
    credits:    { manifest: 'data/creditsfiles.json',          dir: 'data/credits/',         shape: 'object' }
  };

  const pending = {};

  function config(name) {
    const spec = SETS[name];
    if (!spec) throw new Error('jeu de données inconnu : ' + name);
    return spec;
  }

  function urlFor(name, file) {
    const clean = String(file || '').trim();
    if (!clean) return '';
    if (/^(https?:)?\/\//i.test(clean) || clean.charAt(0) === '/') return clean;
    return config(name).dir + clean;
  }

  async function readJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status + ' pour ' + url);
    return res.json();
  }

  // Entrées fusionnées d'un jeu de données : liste concaténée dans l'ordre du
  // manifeste, ou objet dont les clés sont réunies (crédits).
  async function load(name) {
    if (pending[name]) return pending[name];

    pending[name] = (async function () {
      const spec = config(name);
      const files = await readJson(spec.manifest);
      if (!Array.isArray(files)) throw new Error('tableau attendu dans ' + spec.manifest);

      const results = await Promise.allSettled(files.map(function (file) {
        return readJson(urlFor(name, file));
      }));

      const ignored = [];
      const merged = spec.shape === 'object' ? {} : [];
      results.forEach(function (result, i) {
        if (result.status !== 'fulfilled') {
          ignored.push(files[i]);
          return;
        }
        if (spec.shape === 'object') {
          Object.keys(result.value).forEach(function (key) { merged[key] = result.value[key]; });
        } else {
          result.value.forEach(function (entry) { merged.push(entry); });
        }
      });

      if (ignored.length) console.warn('[DataFiles] fichiers ignorés (' + name + ') :', ignored.join(', '));
      if (spec.shape === 'list' && files.length && !merged.length) {
        throw new Error('aucune donnée chargée pour ' + name);
      }
      return merged;
    })();

    // Un échec ne doit pas rester en cache : le prochain appel réessaie.
    pending[name].catch(function () { delete pending[name]; });

    return pending[name];
  }

  return {
    load: load,
    urlFor: urlFor,
    SETS: SETS
  };
})();
