# AutoBingo - Spécifications Techniques

## Structure du projet

```
/
├── index.html              # Page d'accueil
├── create_bingo.html       # Page de création de bingo
├── bingo.html              # Page de jeu de bingo (à venir)
├── datasets.json           # Catalogue des datasets disponibles
├── data/                   # Répertoire des datasets JSON
│   ├── eldenring/
│   └── pokemon/
├── styles/
│   ├── main.css            # Styles globaux
│   ├── nav.css             # Styles de la barre de navigation
│   └── theme.css           # Variables CSS pour les thèmes clair/sombre
├── js/
│   ├── entity/             # Classes métier (1 fichier par classe)
│   │   ├── DatasetDefinition.js
│   │   ├── DatasetItem.js
│   │   └── BingoGame.js
│   ├── business/           # Logique fonctionnelle et data
│   │   ├── datasetManager.js
│   │   ├── translationManager.js
│   │   ├── themeManager.js
│   │   ├── cookieManager.js
│   │   └── navigationManager.js
│   ├── visual/             # Éléments d'interface
│   │   ├── navRenderer.js
│   │   ├── themeToggle.js
│   │   ├── languageToggle.js
│   │   └── categorySelector.js
├── translations/
│   ├── en.json             # Traductions anglaises
│   └── fr.json             # Traductions françaises
```

## Architecture

### Entity Layer (js/entity/)
Classes représentant les données du domaine :
- **DatasetDefinition** : Représente un dataset (Name, Category, Subcategory, Location, Items[])
- **DatasetItem** : Représente un élément du dataset (Name_EN, Name_FR, PictureMain, PictureAlt, Index)
- **BingoGame** : Représente une partie de bingo (id, dataset, grid, validatedCells, ...)

### Business Layer (js/business/)
Logique métier et gestion des données :
- **datasetManager.js** : Charge datasets.json, filtre par catégorie/sous-catégorie/nom
- **translationManager.js** : Charge et fournit les traductions, avec fallback
- **themeManager.js** : Gère le thème clair/sombre via cookie + classe CSS
- **cookieManager.js** : Lecture/écriture de cookies
- **navigationManager.js** : Gère la navigation entre pages

### Visual Layer (js/visual/)
Composants d'interface utilisateur :
- **navRenderer.js** : Génère la barre de navigation commune
- **themeToggle.js** : Bouton flottant pour basculer thème
- **languageToggle.js** : Bouton flottant pour basculer langue
- **categorySelector.js** : Sélecteur en cascade catégorie > sous-catégorie > dataset

## Fonctionnalités

### Internationalisation
- Langues : Français (fr) et Anglais (en)
- Cookie : `bingo_lang` (défaut: 'en')
- Bouton flottant en bas à droite

### Thème
- Thèmes : Clair et Sombre (défaut: sombre)
- Cookie : `bingo_theme` (défaut: 'dark')
- Bouton flottant en bas à droite

### Création de Bingo
1. Sélection par cascade : Catégorie → Sous-catégorie → Dataset
2. Affichage du nombre d'items
3. Mise à jour de l'URL avec ?Dataset=<nom>
4. Redirection vers bingo.html?id=<nom_du_bingo>

## Dépendances
- Aucune librairie externe (Vanilla JS uniquement)