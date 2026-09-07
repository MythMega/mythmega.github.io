/**
 * Charge la liste de jeux补充aires depuis data/cats/cats.json.
 * Une seule requête réseau : le résultat est mis en cache mémoire.
 */
let cache = null;

export async function loadCats() {
  if (cache) return cache;

  const response = await fetch('data/cats/cats.json');
  if (!response.ok) {
    // Fichier introuvable ou illisible : on renvoie une liste vide
    // plutôt que de bloquer le mode Top.
    cache = [];
    return cache;
  }

  const data = await response.json();
  // On normalise et on filtre les entrées vides au cas où.
  cache = Array.isArray(data)
    ? data.map((s) => String(s).trim()).filter(Boolean)
    : [];
  return cache;
}