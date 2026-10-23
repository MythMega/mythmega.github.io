# Profil, XP et stockage local

## 1. IndexedDB

Trois bases distinctes, toutes locales au navigateur :

| Base | Version | Store | Clé | Contenu |
|------|---------|-------|-----|---------|
| `gamefinder-cache` | 1 | `db-files` | nom du fichier | `{ data: ArrayBuffer, cachedAt: number }` |
| `gamefinder-settings` | 1 | `settings` | `key` (keyPath) | `{ key, value }` |
| `gamefinder-profile` | 1 | `profile` | `key` (keyPath) | `{ key, value }` |

### Clés du profil

| Clé | Type | Défaut | Rôle |
|-----|------|--------|------|
| `username` | string | `Joueur` | pseudo affiché |
| `xp` | number | 0 | XP cumulée |
| `todoList` | number[] | `[]` | IDs de jeux « à faire » |
| `hiddenList` | number[] | `[]` | IDs de jeux masqués |
| `savedFilters` | `{ name, state }[]` | `[]` | filtres nommés |
| `lastAddDate` | string | — | date du dernier bonus d'ajout (`Date.toDateString()`) |

### Clés des réglages

| Clé | Type | Défaut | Rôle |
|-----|------|--------|------|
| `allowAdultContent` | boolean | `false` | débloque le thème Erotic |

Aucune donnée ne quitte l'appareil. Il n'y a ni compte, ni synchronisation, ni
chiffrement : les valeurs sont modifiables depuis les DevTools (l'XP n'est pas une
monnaie). « Vider les données du site » réinitialise tout, cache de base inclus.

## 2. Niveaux et XP

Formule : pour passer du niveau `n` au niveau `n+1`, il faut

```text
RequiredXP(n) = 100 × (n − 1) + 25
```

| Passage | XP requis |
|---------|-----------|
| 1 → 2 | 25 |
| 2 → 3 | 125 |
| 3 → 4 | 225 |
| 4 → 5 | 325 |
| … | +100 par niveau |

`UserProfile.calcLevel(totalXP)` parcourt les paliers et renvoie
`{ level, xpInCurrentLevel, xpRequiredForNext }`. Le profil affiche le total, la
fraction courante et la barre de progression.

## 3. Sources d'XP

| Action | XP | Limite |
|--------|----|--------|
| Lancer la roulette | +5 | à chaque lancement |
| Ouvrir une fiche détail depuis la roulette | +3 | une fois par session de roulette (`settingsEncoded`) |
| Ouvrir n'importe quelle fiche jeu | +3 | une fois par onglet (`GameDetailUI._xpGranted`) |
| Cliquer sur le lien IGDB (fiche ou roulette) | +3 | à chaque clic |
| Atteindre le dernier jeu de la roulette | +3 × nombre de jeux | une fois par session |
| Premier ajout du jour dans « À faire » ou « Masqué » | +1 | une fois par jour (tous ajouts confondus) |

Les notifications `+N XP` apparaissent en haut à gauche (`showXPNotif`).

## 4. Listes « À faire » et « Masqués »

- Ajout/retrait depuis la fiche jeu ou la roulette ; l'état des boutons est
  rechargé depuis IndexedDB.
- Ajouter un jeu déjà présent ne fait rien (pas de doublon).
- Profil : deux boutons avec compteur, liste inline paginée par **10**.
- Recherche insensible à la casse sur le nom ; les jeux des listes sont chargés en
  une requête (`GameBusiness.getSummaries`) et mis en cache pour la session d'affichage.
- Retrait avec animation (380 ms) puis re-rendu de la page courante.
- **Les listes ne filtrent pas la roulette** : « Masquer » est une liste de suivi,
  pas une exclusion de sélection. Les jeux masqués peuvent donc réapparaître.
- `todoList` et `hiddenList` peuvent contenir des IDs absents de la base (jeu retiré
  d'IGDB) ; l'interface affiche alors « Jeu #id ».

## 5. Filtres sauvegardés

- `saveFilter(name, state)` : écrase l'entrée portant le même nom, sinon ajoute.
- Le nom est limité à 60 caractères dans le formulaire.
- `deleteFilter(name)` supprime par nom.
- Au chargement, le filtre est ré-encodé en base64url puis passé à `FiltersUI.render`,
  ce qui réutilise exactement le même chemin que les réglages d'URL.
- Un filtre enregistré avec l'ancien format v1 est migré à la volée.
- La popup de chargement affiche le résumé (`N inclusions · M exclusions · F facettes`).

## 6. Réinitialisation

| Action | Effet |
|--------|-------|
| Paramètres → « Vider le cache » | supprime uniquement les octets compressés de la base |
| Paramètres → « Retélécharger la base » | vide le cache puis `location.reload()` |
| `Ctrl + F5` | idem, via un écouteur global |
| DevTools → Application → Clear site data | supprime base, réglages, profil, listes, filtres |

Après suppression du cache, le prochain chargement retélécharge les 86 Mo.
