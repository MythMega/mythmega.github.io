# Kokoro Game : Kintsugi — Organisation & Documentation

> **Répertoire central pour tous les agents IA** qui participent au développement du jeu.
> Lire ce fichier en premier, puis consulter les documents spécifiques selon la tâche.

---

## Concept en une phrase

Un jeu de skateboard 2D pixel art sans score ni minuteur, où la pratique des tricks trace l'histoire d'un skateboard brisé qui se recompose en or — selon l'art japonais du **kintsugi** (金継ぎ, "réparation en or").

---

## Index des Documents

| Fichier | Contenu |
|---------|---------|
| [game-design-document.md](game-design-document.md) | GDD complet : vision, boucle de jeu, mécaniques |
| [technical-architecture.md](technical-architecture.md) | Stack technique, structure de code, modules, **intégration iframe** |
| [tricks-system.md](tricks-system.md) | Tous les tricks, inputs, validation, états du skater |
| [environments.md](environments.md) | 5 environnements : layout, obstacles, débloquage |
| [progression-kintsugi.md](progression-kintsugi.md) | Système de cracks gris→or, seuils de débloquage |
| [controls-input.md](controls-input.md) | Mapping clavier, buffer d'inputs, combos |
| [assets-specification.md](assets-specification.md) | Tous les assets (sprites, audio, fonts) avec dimensions |
| [ui-screens.md](ui-screens.md) | Écrans UI, flux de navigation, palette de couleurs |
| [coding-guidelines.md](coding-guidelines.md) | Conventions de code, patterns Phaser 3, naming |

---

## Structure du Projet

```
kintsugi/
├── _specifications/             ← Documentation (vous êtes ici)
│   ├── README.md
│   ├── game-design-document.md
│   ├── technical-architecture.md
│   ├── tricks-system.md
│   ├── environments.md
│   ├── progression-kintsugi.md
│   ├── controls-input.md
│   ├── assets-specification.md
│   ├── ui-screens.md
│   └── coding-guidelines.md
│
├── src/                        ← Code source JavaScript (ES6 modules)
│   ├── main.js                 ← Point d'entrée, config Phaser
│   ├── config.js               ← Constantes globales
│   ├── embed-config.js         ← Whitelist iframe (origines autorisées)
│   ├── scenes/
│   │   ├── BootScene.js        ← Chargement initial, détection localStorage
│   │   ├── PreloadScene.js     ← Chargement de tous les assets
│   │   ├── MenuScene.js        ← Menu principal
│   │   ├── BoardScene.js       ← Vue du skateboard kintsugi (progression)
│   │   ├── EnvSelectScene.js   ← Sélection de l'environnement
│   │   └── environments/
│   │       ├── GameScene.js    ← Classe de base (toutes les scènes de jeu héritent)
│   │       ├── StreetScene.js
│   │       ├── SkateparkScene.js
│   │       ├── RooftopScene.js
│   │       ├── TunnelScene.js
│   │       └── GardenScene.js
│   ├── entities/
│   │   ├── Skater.js           ← Entité principale du joueur
│   │   └── obstacles/
│   │       ├── Obstacle.js     ← Classe de base
│   │       ├── Rail.js
│   │       ├── Ledge.js
│   │       ├── Ramp.js
│   │       ├── Stair.js
│   │       └── ManualPad.js
│   ├── systems/
│   │   ├── TrickSystem.js      ← Détection, validation, catalogue de tricks
│   │   ├── InputSystem.js      ← Buffer d'inputs, mapping clavier
│   │   ├── KintsugiSystem.js   ← Gestion des cracks et états du board
│   │   ├── ProgressionSystem.js← Débloquage d'environnements, sauvegarde
│   │   └── AudioSystem.js      ← Sons et musique
│   ├── ui/
│   │   ├── KintsugiBoard.js    ← Rendu du skateboard kintsugi
│   │   ├── TrickFeed.js        ← Affichage des tricks réussis (style feed)
│   │   ├── HUD.js              ← Affichage in-game (tricks disponibles, etc.)
│   │   └── MenuComponents.js   ← Boutons, transitions, overlays
│   ├── data/
│   │   ├── tricks.json         ← Définition complète des tricks
│   │   ├── environments.json   ← Config des environnements
│   │   └── progression.json    ← Template de progression (état initial)
│   └── utils/
│       ├── SaveManager.js      ← localStorage wrapper
│       ├── EventBus.js         ← Système d'événements global
│       └── MathUtils.js        ← Helpers mathématiques
│
├── medias/
│   ├── images/
│   │   ├── sprites/
│   │   │   ├── skater/         ← Spritesheet du personnage
│   │   │   ├── obstacles/      ← Sprites des obstacles
│   │   │   └── particles/      ← Particules (dust, sparks)
│   │   ├── backgrounds/
│   │   │   ├── street/         ← (+ hitbox_reference.svg)
│   │   │   ├── skatepark/
│   │   │   ├── rooftop/
│   │   │   ├── tunnel/
│   │   │   └── garden/
│   │   ├── ui/
│   │   │   ├── board/          ← Skateboard kintsugi base + cracks
│   │   │   ├── menu/           ← Logo, boutons, fonds de menu
│   │   │   └── hud/            ← Éléments HUD in-game
│   │   └── tilesets/
│   │       ├── street/
│   │       ├── skatepark/
│   │       ├── rooftop/
│   │       ├── tunnel/
│   │       └── garden/
│   ├── audio/
│   │   ├── sfx/
│   │   │   ├── tricks/         ← Sons des tricks (flip, grind, land...)
│   │   │   ├── ambient/        ← Sons ambiants par environnement
│   │   │   └── ui/             ← Sons d'interface
│   │   └── music/
│   │       ├── menu/
│   │       └── environments/
│   └── fonts/
│
├── manifests/
│   ├── images.json             ← Manifeste complet des images
│   ├── audio.json              ← Manifeste complet des sons
│   └── fonts.json              ← Manifeste des polices
│
├── _headers                    ← CSP frame-ancestors (Netlify/Cloudflare)
├── current-progress.json       ← Suivi des steps de développement
├── index.html                  ← Point d'entrée HTML (+ guard iframe inline)
├── package.json
└── start_server.cmd            ← Serveur local de développement
```

---

## Résumé Technique

| Paramètre | Valeur |
|-----------|--------|
| Framework | **Phaser 3.70+** |
| Langage | JavaScript ES6+ (modules natifs) |
| Rendu | Canvas 2D — mode `pixelArt: true` |
| Résolution interne | **640 × 360** px |
| Scaling | ×2 → **1280 × 720** px affiché |
| Physique | Phaser Arcade Physics |
| Sauvegarde | `localStorage` |
| Dépendances | Phaser 3 (CDN ou npm) uniquement |

---

## Environnements — Vue Rapide

| # | ID | Nom | Débloquage |
|---|----|----|-----------|
| 1 | `street` | Street | Défaut (toujours disponible) |
| 2 | `skatepark` | Skatepark | 5 fractures dorées |
| 3 | `rooftop` | Rooftop | 17 fractures dorées |
| 4 | `tunnel` | Underground | 29 fractures dorées |
| 5 | `garden` | Jardin Zen | 42 fractures dorées |

---

## Boucle de Jeu Centrale

```
Joueur sélectionne un environnement
         ↓
Joueur roule et tente des tricks
         ↓
         ┌──────────────┬──────────────┐
         ↓              ↓              ↓
    [PREMIÈRE     [TRICK RATÉ]   [TRICK RÉUSSI]
     TENTATIVE]        ↓              ↓
         ↓        Crack grise    Crack grise
    Crack grise   reste grise   → devient DORÉE
    apparaît sur  (déjà là)          ↓
    le board           ↓        Nouvel env.
                   Réessayer    débloqué ?
```

---

## Pour les Agents IA

1. **Avant de coder une scène** → lire `environments.md` + `technical-architecture.md`
2. **Avant de coder les tricks** → lire `tricks-system.md` + `controls-input.md`
3. **Avant de coder la progression** → lire `progression-kintsugi.md`
4. **Pour les assets** → consulter `assets-specification.md` + les `manifests/*.json`
5. **Pour l'UI** → lire `ui-screens.md`
6. **Conventions de code** → lire `coding-guidelines.md`
