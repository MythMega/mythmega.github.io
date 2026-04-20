# ERGussr — Spécification fonctionnelle et technique

## Vue d'ensemble
ERGussr est un jeu de devinettes web basé sur les items d'Elden Ring. Le joueur doit deviner le nom d'un item à partir de ses descriptions, en français ou en anglais.

---

## Pages

### index.html
Menu d'accueil. Liens vers toutes les autres pages. Pas de logique de jeu.

### practice.html
Mode entraînement en boucle infinie.
- **3 vies** au départ.
- Chaque mauvais essai (≥3 pour un item) fait perdre une vie.
- Cliquer "Révéler" fait aussi perdre une vie.
- Scoring par round : 0 fail → +10 pts, 1 fail → +5 pts, 2 fails → +2 pts, ≥3 fails → +0 pts.
- Le **highscore** est mis à jour automatiquement et stocké en cookie.
- À la fin (0 vies) : affiche score final, meilleur score, indication "nouveau record" si applicable. Boutons : rejouer / retour menu.

### daily.html
Mode daily (une partie différente par jour).
- Paramètre URL : `?date=jj-mm-yyyy` (ex: `daily.html?date=25-12-2025`).
- Si aucun paramètre : redirige avec la date du jour automatiquement.
- Si la date est dans le futur : message d'erreur, pas de jeu.
- Si le daily a déjà été joué (IndexedDB) : affiche le résultat précédent directement.
- **5 rounds** avec items sélectionnés aléatoirement via une seed = string brute de la date `"jj-mm-yyyy"` (PRNG déterministe Mulberry32).
- Règles d'affichage par round :
  - 0 fail : Desc1 uniquement (avec masquage sensible).
  - 1 fail : Desc1 + ID + Desc2 + Desc3 (si disponible), tous en masquage sensible.
  - 2 fails : idem mais sans masquage sensible.
  - ≥3 fails : révèle l'item (0 pts).
- **Masquage sensible** : tous les mots du nom de l'item (FR et EN) sont remplacés par `###` dans les descriptions (insensible à la casse et aux accents). Géré dynamiquement.
- Image de l'item affichée en **noir total** (`filter: brightness(0)`) jusqu'à la révélation.
- Autocomplete sur l'input : liste de tous les items (selon la langue), insensible à la casse et aux accents. Si la valeur n'est pas dans la liste → secousse + rouge + toast "Élément non trouvé" (ne compte pas comme erreur).
- Validation du guess : compare sans accents ni casse.
- Résumé final : liste des 5 items (image + nom), tableau d'emojis, score total.
- Bouton **Copier le résultat** : copie le texte partageable dans le presse-papiers.
- Sauvegarde dans IndexedDB **uniquement à la fin du dernier round**.

### replay.html
Grille de boutons de dates, de la date la plus ancienne d'un daily joué jusqu'à aujourd'hui.
- Bouton coloré avec `color-primary` si joué, `color-secondary` sinon.
- Clic → redirige vers `daily.html?date=<jj-mm-yyyy>`.

### settings.html
- Sélecteur de **langue** (FR / EN) → stocké en cookie, rechargement dynamique des textes.
- **Export** : génère `ERGussr-<date>.save` (JSON compacté + Base64).
- **Import** : lit un fichier `.save`, importe les dailies non encore présents, met à jour le highscore si supérieur. Affiche un résumé popup.
- **Suppression** des données IndexedDB (confirmation requise).

### credits.html
Crédits simples avec lien GitHub : `https://github.com/MythMega/ERGussr`.

---

## Format de sauvegarde (.save)
JSON compacté encodé en Base64 :
```json
{
  "l": "fr",
  "h": 42,
  "d": [
    {
      "dt": "25-12-2025",
      "s": 27,
      "r": [
        { "n": 1, "sc": 10, "f": 0 },
        { "n": 2, "sc": 5,  "f": 1 },
        ...
      ]
    }
  ]
}
```
- `l` : langue (cookie)
- `h` : highscore practice (cookie)
- `d` : liste des dailies terminés (IndexedDB)

---

## Stockage
| Donnée | Support |
|---|---|
| Langue | Cookie `erg_lang` (365 jours) |
| Highscore practice | Cookie `erg_highscore` (365 jours) |
| Résultats daily | IndexedDB `ERGussr` / store `daily_results` (clé : date) |

---

## Résumé partageable (Daily)
```
ERGussr Daily — 25-12-2025 — score 27
🟩🟩🟩
🟧🟧🟩
🟩🟩🟩
🟧🟩🟩
🟥🟥🟥
```
- 🟩🟩🟩 = trouvé, 0 fail
- 🟧🟩🟩 = trouvé, 1 fail
- 🟧🟧🟩 = trouvé, 2 fails
- 🟥🟥🟥 = non trouvé (3 fails ou révélé)

---

## Traductions
Tous les textes statiques sont chargés depuis `./translation/<lang>.json` (fr ou en).  
Les éléments HTML portent l'attribut `data-i18n="<clé>"`, appliqué dynamiquement au chargement.

---

## Techniques notables
- **PRNG déterministe** (Mulberry32) : garantit que tous les joueurs ont les mêmes 5 items pour une même date.
- **Autocomplete** : filtrage insensible à la casse et aux accents, navigable au clavier.
- **Masquage sensible** : regex sur texte normalisé (sans diacritiques), replace dans le texte original.
- **ES Modules** natifs : pas de bundler requis, fichiers JS importés avec `type="module"`.
- **Responsive** : nav hamburger sur mobile, grilles CSS flexibles.
