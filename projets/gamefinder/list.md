# Fonctionnement des listes — Gamefinder 2.0

## URL

```
app.html?list=<type>&page=<n>
```

- `type` : le type de données à lister (voir tableau ci-dessous)
- `page` : numéro de page, 1-based (défaut : 1)

## Types disponibles

| Paramètre `list` | Label affiché | Source DB principale |
|------------------|---------------|----------------------|
| `game`           | Jeux          | `games`              |
| `developer`      | Développeurs  | `game_developers`    |
| `franchise`      | Franchises    | `franchises`         |
| `genre`          | Genres        | `genres`             |
| `platform`       | Plateformes   | `platforms`          |
| `theme`          | Thèmes        | `themes`             |

## Pagination

- **30 éléments par page**, triés par ordre alphabétique (ou par `id ASC` pour les jeux).
- Si un index est manquant en base (IDs non contigus), il est simplement ignoré — afficher 27 éléments sur une page de 30 est un comportement attendu.
- La présence d'une page suivante est détectée en récupérant **31 lignes** : si 31 sont retournées, `hasNext = true`.

## Composants impliqués

| Fichier | Rôle |
|---------|------|
| `Scripts/business/ListBusiness.js` | Requêtes paginées, délégation aux businesses spécialisés |
| `Scripts/ui/ListUI.js`             | Rendu HTML de la grille + pagination + animations reveal |

## Comportement de navigation

- Clic sur un item → navigue vers la page de détail correspondante (`app.html?<type>=<id>`).
- Bouton "Précédent" désactivé sur la page 1.
- Bouton "Suivant" désactivé si `hasNext = false`.
- La navigation se fait via le `Router` (pas de rechargement de page) afin de **conserver la base de données SQLite en mémoire**.

## Accès

Le menu **Données** dans l'en-tête affiche la liste des types disponibles.  
Cliquer sur un type navigue vers `app.html?list=<type>&page=1`.
