// pokemon-versions.js
// Gère la disponibilité des Pokémon selon les versions de données et leur date de déploiement.
// Charge data/version.json (format attendu : YYYY-MM-DD pour deploy_date).
//
// Exemple version.json :
// [
//   { "pokefeet_data_version": 1, "deploy_date": null, "Update_Name": "1G, 2G, 3G" },
//   { "pokefeet_data_version": 2, "deploy_date": "2026-05-28", "Update_Name": "4G" }
// ]
//
// Règle : deploy_date null => toujours disponible. Sinon disponible à partir de deploy_date (YYYY-MM-DD).

const PokemonVersions = (function () {
  let versionData = null;

  // Charge data/version.json (idempotent).
  async function load() {
    if (versionData) return versionData;
    try {
      const res = await fetch('data/version.json');
      versionData = await res.json();
    } catch (e) {
      console.warn('[PokemonVersions] Impossible de charger version.json, fallback version 1.', e);
      versionData = [{ pokefeet_data_version: 1, deploy_date: null, Update_Name: 'Base' }];
    }
    return versionData;
  }

  // Retourne le Set des numéros de version disponibles pour une date donnée (YYYY-MM-DD).
  function getAvailableVersions(dateStr) {
    if (!versionData) return new Set([1]);
    const available = new Set();
    versionData.forEach(v => {
      if (v.deploy_date === null || v.deploy_date <= dateStr) {
        available.add(v.pokefeet_data_version);
      }
    });
    return available;
  }

  // Filtre un tableau de Pokémon pour ne garder que ceux disponibles à la date donnée.
  function getAvailablePokemons(allPokemons, dateStr) {
    const available = getAvailableVersions(dateStr);
    return allPokemons.filter(p => available.has(p.pokefeet_data_version));
  }

  // Retourne les mises à jour (entrées version.json) déployées strictement entre dateA (exclu) et dateB (inclus).
  // Utile pour afficher des séparateurs entre deux entrées d'historique.
  function getUpdatesBetweenDates(dateA, dateB) {
    if (!versionData) return [];
    return versionData.filter(v =>
      v.deploy_date !== null &&
      v.deploy_date > dateA &&
      v.deploy_date <= dateB
    );
  }

  function getData() { return versionData; }

  return { load, getAvailablePokemons, getAvailableVersions, getUpdatesBetweenDates, getData };
})();
