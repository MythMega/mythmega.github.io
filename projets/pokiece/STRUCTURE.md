# 📦 Structure Complète du Projet Pokéice

## 📁 Arborescence

```
pokiece/
│
├── 📄 Fichiers de Documentation
│   ├── README.md              # Documentation complète
│   ├── CHECKLIST.md           # Vérification des spécifications
│   ├── QUICK_START.md         # Guide de démarrage rapide
│   ├── TESTING.md             # Plan de test
│   ├── config.json            # Configuration du projet
│   └── STRUCTURE.md           # Ce fichier
│
├── 📄 Pages HTML (3 fichiers)
│   ├── index.html             # Page d'accueil
│   ├── game.html              # Page du jeu
│   └── credits.html           # Page des crédits
│
├── 📁 styles/
│   └── style.css              # Feuille de style principale
│
├── 📁 js/ (4 fichiers)
│   ├── global.js              # Fonctions globales
│   ├── translation.js         # Système de traduction
│   ├── code.js                # Système de code/encodage
│   └── game.js                # Logique du jeu
│
└── 📁 data/
    └── mons.json              # Base de données Pokémons
```

## 📑 Détail des Fichiers

### 📄 Pages HTML

#### index.html
- **Contenu**: Page d'accueil
- **Sections**: 
  - Nouvelle partie (Commencer)
  - Rejoindre partie (Entrer code)
  - Lien vers crédits
- **Boutons**: Langue (🌐) et Dark Mode (🌙)
- **Taille**: ~5 KB

#### game.html
- **Contenu**: Jeu principal
- **Grille**: 6 colonnes × 5 lignes (30 Pokémons)
- **Boutons**: Accueil, Relancer, Copier Code
- **Scripts**: Chargement asynchrone mons.json
- **Taille**: ~4 KB

#### credits.html
- **Contenu**: Crédits et informations
- **Sections**: À propos, Sources, Technologie
- **Liens**: Références externes
- **Taille**: ~3 KB

### 🎨 Styles

#### styles/style.css
- **Variables CSS**: Couleurs, ombres, polices
- **Dark Mode**: Variables sombre activation
- **Responsive**: RequestsMedia queries pour mobile/tablet
- **Composants**:
  - Conteneur et layout
  - Boutons et inputs
  - Grille de cartes
  - Animations
- **Taille**: ~20 KB

### 💻 Scripts JavaScript

#### js/global.js
**Fonctions principales:**
- `getCookie(name)` - Lecture cookie
- `setCookie(name, value, days)` - Écriture cookie
- `getCurrentDarkMode()` - Mode actuel
- `enableDarkMode()` - Active dark mode
- `disableDarkMode()` - Désactive dark mode
- `toggleDarkMode()` - Bascule
- `initDarkMode()` - Initialisation
- `showToast(message)` - Notification toast
- `copyToClipboard(text)` - Copie presse-papiers
- `initGlobal()` - Initialisation globale

**Logs**: Informatifs avec couleurs
**Taille**: ~7 KB

#### js/translation.js
**Variables:**
- `translations` - Dictionnaire complet FR/EN

**Fonctions principales:**
- `getCurrentLanguage()` - Langue actuelle
- `setLanguage(lang)` - Change langue
- `toggleLanguage()` - Bascule FR/EN
- `getTranslation(key)` - Récupère traduction
- `applyTranslation()` - Applique au DOM
- `initLanguageButton()` - Initialise bouton

**Clés supportées:**
- Page Index: title, subtitle, newGame, etc.
- Page Game: gameTitle, home, reshuffle, copyCode
- Page Credits: creditsTitle, creditsAbout, etc.

**Taille**: ~8 KB

#### js/code.js
**Fonctions principales:**
- `encodeCode(indices)` - Encode indices → hex
- `decodeCode(code)` - Décode hex → indices
- `getCodeFromURL()` - Récupère code paramètre
- `buildGameURL(code)` - Construit URL complète
- `reshuffleGame()` - Relance sans code
- `isValidCode(code)` - Valide un code
- `handleGameCode(pokemonsList)` - Gère flux complet

**Format Code:**
- Base16 (Hexadécimal)
- 4 caractères par indice
- 30 indices = 120 caractères
- Exemple: `0001000A001F...`

**Taille**: ~10 KB

#### js/game.js
**Variables globales:**
- `allPokemons` - Tous les Pokémons
- `gamePokemons` - Sélection actuelle
- `selectedIndices` - Indices sélectionnés

**Fonctions principales:**
- `loadPokemonsList()` - Charge mons.json
- `getPokemonByIndex(index)` - Récupère Pokémon
- `selectGamePokemons(indices)` - Sélectionne 30
- `createPokemonCard(pokemon)` - Crée carte HTML
- `toggleShiny(card, pokemon)` - Change sprite
- `toggleDisable(card, pokemon)` - Grise carte
- `renderGameGrid()` - Affiche grille
- `initGameControls()` - Initialise boutons
- `initGame()` - Initialisation complète

**Processus:**
1. Charge mons.json
2. Traite code URL
3. Sélectionne 30 Pokémons
4. Crée cartes HTML
5. Initialise événements
6. Applique traductions

**Taille**: ~15 KB

### 📊 Base de Données

#### data/mons.json
**Structure per Pokémon:**
```json
{
  "Name_EN": "Bulbasaur",
  "Name_FR": "Bulbizarre",
  "Types": ["grass", "poison"],
  "Serie": "Kanto",
  "Sprite": "https://...",
  "Sprite_Shiny": "https://...",
  "Index": 1,
  "Height": 0.7,
  "Weight": 6.9
}
```

**Propriétés:**
- `Name_EN` - Nom anglais (required)
- `Name_FR` - Nom français (required)
- `Types` - Tableau de types 1-2 (required)
- `Serie` - Région/Région (required)
- `Sprite` - URL sprite normal (required)
- `Sprite_Shiny` - URL sprite shiny (required)
- `Index` - Index Pokédex (required, must be unique)
- `Height` - Taille en mètres (required)
- `Weight` - Poids en kg (required)

**Nombre:** 1000+ Pokémons

### 📚 Fichiers de Documentation

#### README.md
- Vue d'ensemble complète
- Features
- Utilisation
- Structure du code
- Personnalisation
- Débogage

#### CHECKLIST.md
- Toutes les spécifications
- Statut de chaque élément
- ✅ pour terminé

#### QUICK_START.md
- Installation rapide
- Scenarios de test
- Vérifications techniques
- Dépannage
- Checklist déploiement

#### TESTING.md
- Plan de test complet
- Cas de test
- Scenarios d'utilisateurs
- Matrice de test

#### config.json
- Metadata du projet
- Configuration technique
- Versions
- Features

## 🎯 Flux de l'Application

### Nouveau Jeu
```
index.html
    ↓
Clic "Commencer"
    ↓
game.html (sans paramètre)
    ↓
code.js: handleGameCode()
    ↓
Génère 30 indices aléatoires
    ↓
Encode en code hex
    ↓
Recharge game.html?Code=XXXX
    ↓
game.js: Charge et affiche grille
    ↓
Jeu prêt!
```

### Joindre Jeu
```
index.html
    ↓
Entre code + Clic "Rejoindre"
    ↓
game.html?Code=XXXX
    ↓
code.js: Valide et décode code
    ↓
game.js: Charge Pokémons
    ↓
Grille affichée
    ↓
Jeu prêt!
```

## 🔄 Interactions Utilisateur

### Événements Globaux
- Clic bouton langue (🌐) → `toggleLanguage()`
- Clic bouton dark (🌙) → `toggleDarkMode()`
- Rechargement → Restaure langue et dark mode depuis cookies

### Événements Index
- Clic "Commencer" → `window.location.href = './game.html'`
- Clic "Rejoindre" → Validation et redirection avec code
- Touche Entrée dans input code → Simule clic "Rejoindre"

### Événements Game
- Clic ✨ shiny → `toggleShiny(card, pokemon)`
- Clic 🚫 disable → `toggleDisable(card, pokemon)`
- Clic 🏠 accueil → Retour index.html
- Clic 🔄 relancer → `reshuffleGame()`
- Clic 📋 copier → `copyToClipboard(url)`

### Événements Credits
- Clic lien source → Ouvre URL externe
- Clic retour → Vers index.html

## 💾 Stockage

### Cookies
- `language` - FR ou EN (365j)
- `darkMode` - light ou dark (365j)

### Pas de LocalStorage/SessionStorage
- Données suffisent avec cookies
- URLs contiennent le code de partie

## 🌐 Ressources Externes

### Sprites Pokémons
- **Source**: https://img.pokemondb.net/
- **Format**: GIF animé
- **Falls back**: Placeholder ❌

### Icônes Types
- **Source**: https://archives.bulbagarden.net/
- **Format**: PNG transparente
- **Format URL**: `<Type>_icon_HOME3.png`

## 📈 Statistiques du Projet

| Métrique | Valeur |
|----------|--------|
| Fichiers HTML | 3 |
| Fichiers CSS | 1 |
| Fichiers JS | 4 |
| Fichiers de Doc | 5 |
| Lignes HTML | ~300 |
| Lignes CSS | ~800 |
| Lignes JS | ~1200 |
| Lignes Documentation | ~2000 |
| Total | ~4300 |

## 🎓 Apprentissages Clés

Ce projet couvre:
- ✅ HTML5 sémantique
- ✅ CSS3 avancé (CSS Variables, Grid, Flexbox)
- ✅ JavaScript vanilla ES6+
- ✅ Fetch API asynchrone
- ✅ Gestion des cookies
- ✅ DOM manipulation
- ✅ Événements et listeners
- ✅ Patterns de design
- ✅ Responsive design
- ✅ Logging et debugging

## 🚀 Déploiement

**Prérequis:**
- Serveur web HTTP(S)
- Pas de dépendances build
- Pas de compilation

**Fichiers à uploader:**
- Tous les fichiers HTML
- Le dossier styles/
- Le dossier js/
- Le dossier data/

**Configuration serveur:**
- MIME type pour .json: application/json
- CORS: Pas strictement nécessaire
- Cache: Optionnel

## 📞 Support

Pour questions/problèmes:
1. Consultez le **README.md**
2. Vérifiez **QUICK_START.md**
3. Lisez les **logs console** (F12)
4. Vérifiez **TESTING.md**

---

**Projet: Pokéice v1.0.0**  
**Statut: ✅ Production Ready**  
**Date: 2026-03-04**
