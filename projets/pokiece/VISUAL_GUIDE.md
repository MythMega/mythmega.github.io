# 🎮 Pokéice - Aperçu Visuel et Guide de Référence

## 🏗️ Architecture Globale

```
┌─────────────────────────────────────────────────────────────┐
│                     POKÉICE APPLICATION                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  INTERFACE UTILISATEUR                              │  │
│  │  ├─ index.html (Accueil)                            │  │
│  │  ├─ game.html (Jeu Principal - Grille 6×5)         │  │
│  │  └─ credits.html (Crédits)                         │  │
│  └──────────────────────────────────────────────────────┘  │
│           │                          │                      │
│           ▼                          ▼                      │
│  ┌──────────────────────┐   ┌──────────────────────┐      │
│  │   STYLES CSS         │   │   JAVASCRIPT         │      │
│  │  ├─ Variables        │   │  ├─ global.js        │      │
│  │  ├─ Dark Mode        │   │  ├─ code.js          │      │
│  │  ├─ Responsive       │   │  ├─ game.js          │      │
│  │  └─ Animations       │   │  └─ translation.js   │      │
│  └──────────────────────┘   └──────────────────────┘      │
│           │                          │                      │
│           ▼                          ▼                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              DONNÉES & STOCKAGE                      │  │
│  │  ├─ data/mons.json (Pokémons)                       │  │
│  │  └─ Cookies (Langue, Dark Mode)                     │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## 🌅 Page Index (Accueil)

```
┌──────────────────────────────────────────────────────────────┐
│  🌐                                            🌙  🏠     │ <- Boutons flottants
├──────────────────────────────────────────────────────────────┤
│                                                              │
│                        POKÉICE                              │
│                  Qui est-ce Pokémon ?                       │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────┐  │
│  │          NOUVELLE PARTIE / NEW GAME                  │  │
│  │  Jouez avec 30 Pokémons aléatoires                 │  │
│  │                                                      │  │
│  │             [ Commencer / Start ]                   │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │      REJOINDRE UNE PARTIE / JOIN GAME                │  │
│  │  Entrez le code d'une partie existante              │  │
│  │                                                      │  │
│  │  [ Coller code / Paste code        ]  [ Rejoindre ] │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│                    Crédits / Credits                        │
└──────────────────────────────────────────────────────────────┘
```

## 🎮 Page Game (Jeu Principal)

```
┌──────────────────────────────────────────────────────────────┐
│  🌐                                            🌙  🏠     │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│                        POKÉICE                              │
│                  Devinez le Pokémon                        │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  [ 🏠 Accueil ] [ 🔄 Relancer ] [ 📋 Copier code ]        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────┬─────────┬──────────┬──────────┬────────┬──┐ │
│  │         │         │          │          │        │  │ │
│  │ Pokémon │ Pokémon │ Pokémon  │ Pokémon  │ Pokémon│..│ │
│  │   1     │   2     │    3     │    4     │   5    │  │ │
│  │  ✨🚫   │  ✨🚫   │  ✨🚫    │  ✨🚫    │  ✨🚫  │  │ │
│  │  #001   │  #004   │  #007    │  #010    │  #013  │..│ │
│  │ Grass   │ Fire    │ Water    │ Flying   │ Bug    │  │ │
│  │ 6.9 kg  │ 8.5 kg  │ 9.0 kg   │ 2.0 kg   │ 2.9 kg │  │ │
│  │ 0.7 m   │ 0.6 m   │ 0.5 m    │ 0.5 m    │ 0.3 m  │  │ │
│  │ Kanto   │ Kanto   │ Kanto    │ Kanto    │ Kanto  │  │ │
│  │         │         │          │          │        │  │ │
│  └─────────┴─────────┴──────────┴──────────┴────────┴──┘ │
│  (Grille 6 colonnes × 5 lignes = 30 cartes)             │
│                                                              │
│                   [ Toast: Code copié ]                     │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Détail d'une Carte Pokémon

```
┌──────────────────┐
│  [ ✨ ] [ 🚫 ]  │  <- Boutons de contrôle
│                  │
│    🎨 Image     │  <- Sprite du Pokémon
│  (Normal/Shiny) │
│                  │
│   Bulbizarre    │  <- Nom (FR/EN)
│   [🌿] [☠️]     │  <- Icônes de type
│                  │
│     #001        │  <- Index Pokédex
│  6.9 kg • 0.7 m │  <- Poids et taille
│     Kanto       │  <- Région
│                  │
└──────────────────┘

✨ = Toggle Shiny (sprite normal ↔ shiny)
🚫 = Disable (grise la carte + grayscale)
```

## 🎨 Système de Couleurs

```
┌─────────────────────────────────────────────────────────┐
│              MODE CLAIR (PAR DÉFAUT)                    │
├─────────────────────────────────────────────────────────┤
│  Fond:        #f5f5f5  [      Gris très clair     ]    │
│  Texte:       #1a1a1a  [      Noir foncé         ]    │
│  Primaire:    #00d4ff  [████  Cyan lumineux     ]    │
│  Secondaire:  #b000ff  [████  Violet lumineux   ]    │
│  Accent:      #ff00ff  [████  Magenta lumineux  ]    │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│              MODE SOMBRE                                 │
├─────────────────────────────────────────────────────────┤
│  Fond:        #1a1a1a  [█████ Gris très foncé  ]    │
│  Texte:       #ffffff  [████  Blanc pur        ]    │
│  Primaire:    #00d4ff  [████  Cyan lumineux    ]    │
│  Secondaire:  #b000ff  [████  Violet lumineux  ]    │
│  Accent:      #ff00ff  [████  Magenta lumineux ]    │
└─────────────────────────────────────────────────────────┘
```

## 🔄 Flux de l'Utilisateur

### Nouvelle Partie:
```
┌─────────────┐
│ index.html  │
└──────┬──────┘
       │
       ▼
┌─────────────────────┐
│ Clic "Commencer"    │
└──────┬──────────────┘
       │
       ▼
┌──────────────────────────┐
│ game.html (no Code)      │
│  ↓ code.js               │
│  ・ Génère 30 indices     │
│  ・ Encodes en hex        │
│  └─ Recharge avec Code   │
└──────┬───────────────────┘
       │
       ▼
┌──────────────────────────┐
│ game.html?Code=XXXX      │
│  ↓ game.js               │
│  ・ Décode indices        │
│  ・ Charge Pokémons      │
│  └─ Affiche grille       │
└──────┬───────────────────┘
       │
       ▼
   🎮 JEU!
```

### Rejoindre Partie:
```
┌─────────────┐
│ index.html  │
└──────┬──────┘
       │
       ▼
┌──────────────────────┐
│ Entre code + Clic    │
│ "Rejoindre"          │
└──────┬───────────────┘
       │
       ▼
┌───────────────────────────┐
│ game.html?Code=XXXX       │
│  ↓ code.js                │
│  ・ Valide code            │
│  ・ Décode indices         │
│  └─ Affiche grille OK     │
└──────┬────────────────────┘
       │
       ▼
   🎮 JEU!
```

## 📦 Structure des Fichiers

```
POKÉICE/
│
├── 📄 PAGES HTML
│   ├── index.html          ← Accueil
│   ├── game.html           ← Jeu (grille 6×5)
│   └── credits.html        ← Crédits
│
├── 🎨 STYLES
│   └── styles/style.css    ← CSS principal
│
├── 💻 JAVASCRIPT
│   └── js/
│       ├── global.js       ← Dark mode + cookies
│       ├── translation.js  ← Traduction FR/EN
│       ├── code.js         ← Encode/decode codes
│       └── game.js         ← Logique jeu
│
├── 📊 DONNÉES
│   └── data/mons.json      ← Base Pokémons
│
└── 📚 DOCUMENTATION
    ├── README.md           ← Guide complet
    ├── QUICK_START.md      ← Démarrage rapide
    ├── STRUCTURE.md        ← Structure détail
    ├── TESTING.md          ← Plan de test
    ├── CHECKLIST.md        ← Vérification specs
    ├── FILES_CREATED.md    ← Liste fichiers
    ├── config.json         ← Configuration
    └── THIS FILE           ← Aperçu visuel
```

## ⌨️ Raccourcis Clavier (Implicites)

```
F12           → Ouvrir console (pour logs)
F11           → Plein écran
Entrée        → Dans input code = "Rejoindre"
Ctrl+Tab      → Changer onglet (pour tester share)
```

## 📊 Système de Code

```
FORMAT HEXADÉCIMAL BASE16
═════════════════════════════════════

Indice Pokémon (1-1025)
            ↓
      parseInt(hex)
            ↓
Chaîne hex (0001-0400)
            ↓
    30 indices: 120 caractères

EXEMPLE:
┌────────────────────────────────┐
│ 000A 00FF 0018 ...  (30 fois)  │
└────────────────────────────────┘

Validation:
  ✓ Chaîne non-vide
  ✓ Longueur = 120 caractères
  ✓ Contient que 0-9,A-F
  ✓ Décode à 30 indices valides
```

## 🌐 Langues Supportées

```
╔══════════════════╦══════════════════╗
║   FRANÇAIS (FR)  ║   ENGLISH (EN)   ║
╠══════════════════╬══════════════════╣
║ Pokéice          ║ Pokédex Game     ║
║ Commencer        ║ Start            ║
║ Rejoindre        ║ Join             ║
║ Coller code      ║ Paste code       ║
║ Nouvelle partie  ║ New Game         ║
║ Accueil          ║ Home             ║
║ Relancer         ║ Reshuffle        ║
║ Copier code      ║ Copy code        ║
║ Crédits          ║ Credits          ║
║ Code copié       ║ Code copied      ║
║ Code invalide    ║ Invalid code     ║
╚══════════════════╩══════════════════╝

Stockage: Cookie "language" (365 jours)
```

## 🍪 Cookies

```
┌─────────────────────────────────────┐
│          COOKIES UTILISÉS           │
├─────────────────────────────────────┤
│                                     │
│ ✓ language=FR|EN                    │
│   └─ Défaut: FR                     │
│   └─ Durée: 365 jours              │
│                                     │
│ ✓ darkMode=light|dark               │
│   └─ Défaut: light                  │
│   └─ Durée: 365 jours              │
│                                     │
│ Note: Pas de données sensibles      │
│                                     │
└─────────────────────────────────────┘
```

## 📱 Responsivité

```
DESKTOP      TABLETTE     MOBILE        MINI-MOBILE
(>1024px)    (768-1024)   (480-768)     (<480px)
┌──────┐     ┌──────┐     ┌────┐        ┌──┐
│ GRID │     │GRID5×│     │GRID│        │ │
│ 6×5  │     │  6   │     │4×?  │       │3│
└──────┘     └──────┘     └────┘        │ │
                                        │G│
                                        │R│
                                        │I│
                                        │D│
                                        └──┘
```

## 🎬 Animations

```
PAGE LOAD:
─────────
  En-tête:     fadeInDown  (0.6s)
  Contenu:     fadeInUp    (0.6s)
  Grille:      fadeInUp    (0.6s)

INTERACTIONS:
─────────────
  Hover btn:   translateY(-2px)  + glow
  Hover card:  translateY(-8px)  + glow
  Toast:       slideUp           (0.3s)
  Transition:  smooth            (0.3s)

TRANSITIONS:
─────────────
  Dark mod:    color   0.3s ease
  Langue:      instant (re-render)
  Sprites:     instant
```

## 🎯 Guide de Démarrage en 3 Étapes

```
ÉTAPE 1: INSTALLATION
═══════════════════════════════════════
  1. Vérifier tous les fichiers
  2. Lancer un serveur web local
  3. Ouvrir http://localhost:8000/pokiece

ÉTAPE 2: PREMIER TEST
═══════════════════════════════════════
  1. Clic "Commencer"
  2. Vérifier grille 6×5 s'affiche
  3. Vérifier Pokémons chargent

ÉTAPE 3: VÉRIFICATION
═══════════════════════════════════════
  1. F12 → Console
  2. Vérifier logs colorés
  3. Vérifier pas d'erreurs
```

---

**Pokéice v1.0.0 - Prêt à l'emploi! 🚀**
