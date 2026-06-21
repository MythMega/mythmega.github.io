# Custom Bingo — Documentation Technique

## Overview

**Custom Bingo** (`custom_bingo.html`) est une page autonome permettant de jouer au bingo avec un dataset personnalisé uploadé par l'utilisateur, sans passer par les datasets pré-enregistrés.

## Architecture

- **Page** : `custom_bingo.html`
- **Logique** : `js/visual/customBingoApp.js`
- **Styles** : Réutilise `styles/bingo.css` + `styles/main.css` + `styles/nav.css`

## Deux États

### 1. État "Création" (`state === 'create'`)

Interface simple avec :
- **Upload JSON** : input file acceptant `.json`
- **Sélection de taille de grille** : 3x3 à 7x7
- **Bouton "Start Game"** : désactivé tant qu'aucun fichier n'est chargé

#### Format JSON attendu

```json
{
  "Name": "Mon Dataset",
  "Category": "Games",
  "Subcategory": "RPG",
  "Quantizable": true,
  "DefaultQuantities": { "Min": 1, "Max": 100 },
  "Items": [
    {
      "Index": "item-1",
      "Name_FR": "Épée",
      "Name_EN": "Sword",
      "PictureMain": "https://...",
      "Quantity": { "Min": 1, "Max": 1 }
    }
  ]
}
```

### 2. État "Jeu" (`state === 'play'`)

Utilise exactement le même moteur que `bingo.html` :
- `BingoGameManager` pour la logique du jeu
- `BingoGridRenderer` pour l'affichage
- Mêmes contrôles : timer, recherche, randomize, lock, hide, blur, quantités
- Mêmes interactions : clic pour valider, cell-switch pour remplacer

#### Isolation de l'URL

Contrairement à `bingo.html`, Custom Bingo **ne modifie pas l'URL** :
- `updateUrl()` est surchargé pour ne rien faire
- `_updateControlsUrl()` et `_updateQuantitiesUrl()` sont vides
- Cela évite d'encoder un dataset complet dans l'URL

## Flux de données

```
Upload JSON
    ↓
FileReader → JSON.parse()
    ↓
_buildDatasetDef(raw)
    ↓
DatasetDefinition + DatasetItem[]
    ↓
[Start Game]
    ↓
BingoGameManager (moteur de jeu)
    ↓
BingoGridRenderer (affichage)
```

## Points clés d'implémentation

### `_buildDatasetDef(raw)`
Convertit le JSON brut en objets métier :
- `DatasetDefinition` : nom, catégorie, quantifiable, min/max par défaut
- `DatasetItem[]` : index, noms FR/EN, images, quantités

### `_renderPlayState()`
- Crée un `BingoGameManager` isolé
- Randomise les items et remplit la grille
- Supprime les appels URL pour garder la page autonome

### Isolation complète
Custom Bingo ne partage **aucun état** avec `bingo.html` :
- Son propre `gameManager`
- Son propre `gridRenderer`
- Aucune écriture dans `NavigationManager`
- Aucun paramètre URL

## Navigation

La page est accessible via le menu principal :
- **EN** : "Custom Bingo"
- **FR** : "Bingo Personnalisé"

Lien direct : `custom_bingo.html`