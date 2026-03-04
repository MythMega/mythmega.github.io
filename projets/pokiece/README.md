# 🎮 Pokéice - Qui est-ce Pokémon ?

Une application web interactive basée sur le célèbre jeu "Qui est-ce ?" adapté à l'univers des Pokémons !

## 📋 Structure du Projet

```
pokiece/
├── index.html              # Page d'accueil
├── game.html               # Page du jeu
├── credits.html            # Page des crédits
├── data/
│   └── mons.json           # Base de données des Pokémons
├── styles/
│   └── style.css           # Feuille de style principal
└── js/
    ├── global.js           # Fonctions globales (dark mode, cookies)
    ├── translation.js      # Système de traduction (FR/EN)
    ├── code.js            # Encodage/décodage des codes
    └── game.js            # Logique principale du jeu
```

## ✨ Fonctionnalités

### 1. Traduction Multilingue (FR/EN)
- Toutes les pages sont traduisibles en français et anglais
- La langue est sauvegardée dans un cookie
- Changement de langue via le bouton flottant 🌐

### 2. Dark Mode
- Bouton flottant pour activer/désactiver le mode sombre
- Préférence sauvegardée dans un cookie
- Mode clair par défaut avec fond neutre

### 3. Design Moderne
- Couleurs néon bleu-violet (cyan #00d4ff, violet #b000ff, magenta #ff00ff)
- Animations fluides
- Design responsive (desktop, tablette, mobile)
- Effets de lueur (glow) sur les boutons

### 4. Système de Code
- Génération automatique d'un code pour chaque partie
- Encodage en hexadécimal (Base16) des indices de Pokémons
- Partage de parties via URL avec paramètre ?Code=XXXX
- Validation du code avec gestion des erreurs

### 5. Grille de Jeu
- Affichage de 30 Pokémons (6 colonnes × 5 lignes)
- Chaque Pokémon dispose de:
  - Sprite normal ou shiny (bouton ✨)
  - Nom traduit
  - Icônes de type (1 ou 2)
  - Poids (kg)
  - Taille (m)
  - Index Pokédex
  - Région (Serie)
  - Bouton de désactivation (🚫) qui grise la carte

### 6. Contrôles du Jeu
- **🏠 Accueil**: Retour à la page d'accueil
- **🔄 Relancer**: Nouvelle partie avec Pokémons aléatoires
- **📋 Copier code**: Copie l'URL complète pour partager

### 7. Logging Complet
- Logs détaillés dans la console (console.log)
- Coleurs et styles pour une meilleure lisibilité
- Tracking de chaque action utilisateur
- Messages de débogage à chaque étape

## 🚀 Utilisation

### Démarrer une nouvelle partie
1. Accédez à `index.html`
2. Cliquez sur "Commencer" (ou "Start")
3. 30 Pokémons aléatoires sont sélectionnés
4. Un code est généré automatiquement
5. La grille de jeu s'affiche

### Rejoindre une partie
1. Accédez à `index.html`
2. Collez le code dans le champ "Coller code"
3. Cliquez sur "Rejoindre"
4. Les mêmes Pokémons s'affichent

### Contrôles du Jeu
- **✨ Shiny Toggle**: Affiche le sprite shiny du Pokémon
- **🚫 Disable**: Grise la carte pour indiquer que ce n'est pas le Pokémon cherché

## 🛠️ Configuration Technique

### Langues Supportées
- 🇫🇷 Français (FR)
- 🇬🇧 Anglais (EN)

### Encodage des Codes
- Format: Hexadécimal (Base16)
- Structure: 4 caractères par indice (ex: 0001, 0002, etc.)
- Maximum: 30 Pokémons encodés en 120 caractères

### Cookies
- `language`: Code de langue (FR/EN)
- `darkMode`: Mode (light/dark)
- Durée: 365 jours

### Sources de Données
- **Données Pokémons**: Base de données locale (mons.json)
- **Sprites**: PokemonDB (pokemondb.net)
- **Icônes de type**: Archives Bulbapedia

## 📖 Structure du Code

### translation.js
- `getCurrentLanguage()`: Récupère la langue actuelle
- `setLanguage(lang)`: Définit la langue
- `toggleLanguage()`: Bascule FR/EN
- `getTranslation(key)`: Récupère une traduction
- `applyTranslation()`: Applique les traductions au DOM

### global.js
- `getCookie(name)`: Récupère un cookie
- `setCookie(name, value, days)`: Définit un cookie
- `initDarkMode()`: Initialise le mode sombre
- `toggleDarkMode()`: Bascule le dark mode
- `showToast(message)`: Affiche une notification
- `copyToClipboard(text)`: Copie du texte

### code.js
- `encodeCode(indices)`: Encode les indices en chaîne hex
- `decodeCode(code)`: Décode une chaîne hex en indices
- `getCodeFromURL()`: Récupère le code du paramètre URL
- `buildGameURL(code)`: Construit l'URL du jeu
- `isValidCode(code)`: Valide un code
- `handleGameCode(pokemonsList)`: Gère le flux du code

### game.js
- `loadPokemonsList()`: Charge mons.json
- `getPokemonByIndex(index)`: Récupère un Pokémon par index
- `selectGamePokemons(indices)`: Sélectionne les Pokémons du jeu
- `createPokemonCard(pokemon)`: Crée une carte HTML
- `toggleShiny(card, pokemon)`: Bascule le shiny
- `toggleDisable(card, pokemon)`: Bascule la désactivation
- `renderGameGrid()`: Affiche la grille
- `initGameControls()`: Initialise les boutons
- `initGame()`: Initialisation complète

## 🎨 Personnalisation

### Modifier les couleurs
Éditer les variables CSS dans `style.css`:
```css
:root {
    --color-primary: #00d4ff;      /* Cyan */
    --color-secondary: #b000ff;    /* Violet */
    --color-accent: #ff00ff;       /* Magenta */
}
```

### Ajouter une traduction
Ajouter une clé dans l'objet `translations` de `translation.js`:
```javascript
'myKey': {
    FR: 'Mon texte en français',
    EN: 'My text in English'
}
```

### Modifier la grille
Changer le nombre de colonnes dans `style.css`:
```css
.game-grid {
    grid-template-columns: repeat(6, 1fr); /* 6 colonnes */
}
```

## 🐛 Débogage

### Console Console
Tous les événements sont loggés dans la console du navigateur:
- Appuyez sur **F12** pour ouvrir les développeur
- Allez à l'onglet **Console**
- Vous verrez les logs détaillés de chaque action

### Couleurs des Logs
- 🔵 Bleu cyan: Messages principaux
- 🔴 Violet: Initialisation
- 🟢 Vert: Actions complétées
- 🟡 Orange: Avertissements
- ❌ Erreurs en rouge

## 📱 Responsive Design

- **Desktop** (> 1024px): Grille 6×5
- **Tablet** (768px - 1024px): Grille 5×6
- **Mobile** (480px - 768px): Grille 4×7-8
- **Petit mobile** (< 480px): Grille 3×10

## 🎯 Flux de l'Application

```
index.html
├── Nouvelle partie → game.html (sans code)
│   └── Génération code automatique
│       └── Rechargement avec ?Code=XXXX
└── Rejoindre partie → game.html?Code=XXXX
    └── Validation du code
        └── Chargement des Pokémons

game.html
├── Affichage grille 6×5
├── Interactions (shiny, disable)
├── Partage (copier code)
└── Retour accueil

credits.html
└── Informations du projet
```

## 🔐 Sécurité

- Pas de données sensibles
- Aucune authentification requise
- Codes générés localement
- Validation des codes côté client

## 📊 Performance

- Grille virtuelle pour rapide rendu
- Images lazy-loading
- CSS optimisé (un seul fichier)
- JavaScript vanilla (pas de dépendances)
- Chargement asynchrone des données

## 🤝 Améliorations Possibles

- Animations lors du changement de shiny/disable
- Historique des parties jouées
- Statistiques de jeu
- Catégories de Pokémons
- Difficultés variables
- Mode multijoueur

## 📝 Notes

- Le fichier `mons.json` doit être présent dans le dossier `data/`
- Les sprites doivent être accessibles via HTTP(S)
- Les icônes de type sont chargées depuis les archives Bulbapedia
- JavaScript doit être activé pour que l'application fonctionne

## 🎉 Bon jeu !

Profitez de Pokéice et amusez-vous à deviner les Pokémons !
