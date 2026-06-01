# Game Design Document — Kokoro Game : Kintsugi

**Version :** 1.0  
**Date :** Juin 2026  
**Statut :** Document de référence

---

## 1. Vision

**Kokoro Game : Kintsugi** est un jeu de skateboard 2D pixel art à destination du navigateur web. Il ne cherche pas à compétitionner, ni à classer : il invite à la pratique libre et à la patience.

Le nom « Kokoro » (心) signifie « cœur / esprit / âme » en japonais. Le kintsugi (金継ぎ) est l'art de réparer les objets brisés avec de la poudre d'or — transformer la cassure en beauté. Le jeu fait de l'échec une étape nécessaire vers la maîtrise.

**Piliers de design :**
- Pas de score. Pas de minuteur. Pas de pression.
- L'échec est visible, concret, et beau.
- La progression est permanente et personnelle.
- L'esthétique pixel art évoque nostalgie et calme.

---

## 2. Concept Principal

### Le Skateboard comme Miroir de la Progression

Au centre du jeu se trouve un **skateboard noir, brisé** — visible depuis l'écran de progression. Chaque crack sur ce board correspond à un trick du jeu.

| Événement | Effet sur le board |
|-----------|--------------------|
| Première tentative d'un trick | Une **fracture grise** apparaît |
| Réussite du trick (landing) | La fracture **devient dorée** |
| Toutes les fractures dorées | Board entièrement restauré en or |

Le board ne peut que s'améliorer. Aucun recul possible. Chaque tentative, même ratée, contribue à sa transformation.

### Les Environnements comme Chapitres

Chaque environnement est un monde à explorer. On les débloques en transformant des fractures grises en or — preuve de maîtrise dans les environnements précédents.

Les environnements vont du plus urbain/brut (Street) au plus apaisé/zen (Jardin japonais), symbolisant l'évolution intérieure du joueur.

---

## 3. Boucle de Jeu

```
┌─────────────────────────────────────────────────────┐
│                  ÉCRAN D'ACCUEIL                    │
│     [Logo Kokoro Game : Kintsugi]  [Appuyer ↵]      │
└─────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────┐
│               VUE DU SKATEBOARD                     │
│     Board avec cracks gris/or | Bouton Jouer        │
└─────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────┐
│           SÉLECTION D'ENVIRONNEMENT                 │
│     [Street] [Skatepark 🔒] [Rooftop 🔒] ...        │
└─────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────┐
│                 SCÈNE DE JEU                        │
│  Le joueur skate librement, tente des tricks        │
│                                                     │
│  ← → : Déplacement   SPACE : Ollie                  │
│  Z/X : Modif tricks  G : Grind  M : Manual          │
│                                                     │
│  [TRICK RÉUSSI] → flash doré → crack → or           │
│  [PREMIÈRE TENTATIVE] → flash gris → crack → grise  │
│  [ÉCHAP] → retour menu                              │
└─────────────────────────────────────────────────────┘
                          ↓
               Nouveau déblocage ?
          ↓ Oui            ↓ Non
   Cinématique      Retour au menu
   kintsugi         environnement
```

---

## 4. Mécaniques de Jeu

### 4.1 Mouvement du Skater

Le skater se déplace de gauche à droite (et inversement) sur un environnement scrollable. La physique est arcade 2D :

- **Accélération** : pousser sur le sol (`→` ou `←`)
- **Décélération** : friction naturelle, ou frein (`↓`)
- **Vitesse maximale** : plafonnée pour contrôle
- **Gravité** : constante (Phaser Arcade Physics)
- **Momentum** : conservé en l'air

### 4.2 Tricks

Les tricks sont réalisés dans des **contextes spécifiques** :

| Contexte | Tricks disponibles |
|----------|--------------------|
| Sol plat + saut | Flatground tricks (ollie, kickflip...) |
| Approche d'un rail | Grind tricks (50-50, nosegrind...) |
| Approche d'un ledge | Slide tricks (boardslide, noseslide...) |
| Rampe (quarter/half) | Lip tricks (rock to fakie, stall...) |
| Roulement | Manual tricks (manual, nose manual) |

Chaque trick a un **input spécifique** (voir `controls-input.md` et `tricks-system.md`).

Un trick est **réussi** quand :
1. La bonne séquence d'inputs est détectée
2. Le skater atterrit sur ses roues
3. Aucune collision avec un obstacle pendant le trick

Un trick est **raté** quand :
1. Le skater atterrit de travers (crash)
2. Le joueur ne lance pas le trick avant de toucher le sol
3. Le skater tombe d'un obstacle

### 4.3 Système de Grinds

Pour initier un grind :
1. Approcher le rail/ledge avec de la vitesse
2. Appuyer sur `SPACE` + `G` au bon moment (timing window ~300ms)
3. La direction maintenue détermine le type de grind
4. Maintenir `G` pour continuer le grind
5. Appuyer sur `SPACE` en fin de grind pour kickout (sortie propre)

### 4.4 Système de Manuals

Pour initier un manual :
1. Rouler à vitesse normale
2. Appuyer sur `M` (ou `↓` hold)
3. Une barre d'équilibre apparaît — l'incliner avec `←/→`
4. Plus le manual est long, plus le trick score potentiel est élevé
5. Combiner manual + trick = combo

### 4.5 Crashes

Quand le joueur crashe :
- Animation de chute du skater
- Courte période d'invincibilité (1s)
- Reset de position au dernier point stable
- **Pas de pénalité sur le board** — l'échec est déjà représenté par la fracture grise

---

## 5. Progression — Le Kintsugi Board

Voir `progression-kintsugi.md` pour le détail complet.

**Résumé :**
- Le board a **60 positions de cracks** (12 par environnement × 5 environnements)
- État initial : aucune crack (board noir intact)
- Première tentative d'un trick → crack **grise** à la position correspondante
- Réussite du trick → crack **dorée**
- Seuils de débloquage basés sur le nombre total de cracks dorées

**Seuils :**
| Cracks dorées | Environnement débloqué |
|---------------|------------------------|
| 0 | Street (défaut) |
| 5 | Skatepark |
| 17 | Rooftop |
| 29 | Underground |
| 42 | Jardin Zen |
| 60 | Fin de jeu (board complet) |

---

## 6. Environnements

Voir `environments.md` pour les spécifications complètes.

| ID | Nom | Thème | Obstacles principaux |
|----|-----|-------|----------------------|
| `street` | Street | Rue urbaine nocturne | Escaliers, ledge, rail de rue |
| `skatepark` | Skatepark | Skatepark couvert | Quarter pipe, box, rails |
| `rooftop` | Rooftop | Toit d'immeuble | Gaps, rails de toit, AC units |
| `tunnel` | Underground | Tunnel/métro abandonné | Half pipe, rails, piliers |
| `garden` | Jardin Zen | Jardin japonais | Stones, wooden rails, bridges |

---

## 7. Style Visuel

### Palette de Couleurs

| Usage | Couleur | Hex |
|-------|---------|-----|
| Fond principal | Noir profond | `#0a0a0a` |
| Board brisé | Noir érable | `#1a1a2e` |
| Fractures nouvelles | Gris argent | `#8a8a9a` |
| Fractures maîtrisées | Or kintsugi | `#d4a017` |
| Or brillant (highlight) | Or lumineux | `#f5c842` |
| UI text | Blanc cassé | `#e8e8d8` |
| Accent | Rouge torii | `#c0392b` |

### Résolution

- **Interne :** 640 × 360 px (16:9)
- **Affichage :** 1280 × 720 px (×2 scaling)
- **Pixel art :** `pixelArt: true` dans Phaser (pas d'antialiasing)
- **Taille de tile :** 16 × 16 px

### Pixel Art Style

- **Sprites :** Style « lo-fi » avec peu de couleurs (4-8 teintes par sprite)
- **Animations :** 6-12 FPS pour les animations de tricks
- **Effets :** Particules pixel art (sparks de grind, dust de landing)
- **Arrière-plans :** Détaillés mais lisibles (parallax 2-3 couches)

---

## 8. Style Audio

| Élément | Description |
|---------|-------------|
| Musique menu | Lo-fi hip hop, instrumental, calme |
| Street | Beats urbains, samples de rue |
| Skatepark | Punk/indie energique mais retenu |
| Rooftop | Synthwave nocturne, mélancolique |
| Underground | Ambient électronique, réverbérant |
| Jardin Zen | Koto + électronique minimaliste |
| SFX tricks | Sons réalistes pixelisés (flip, grind, land) |
| SFX crack grise | Son sourd, mat |
| SFX crack or | Son cristallin, résonant |

---

## 9. Interface Utilisateur

Voir `ui-screens.md` pour les maquettes.

**Principes UI :**
- Minimaliste — le moins d'éléments possible à l'écran pendant le jeu
- Pendant le jeu : seul le feed de tricks (en haut à gauche) et un mini-board (en bas à droite)
- Police pixel art pour tout le texte
- Transitions fluides (fondu au noir entre les scènes)

---

## 10. Accessibilité

- Support clavier complet
- Aucune contrainte de temps → rythme choisi par le joueur
- Options : activer/désactiver la musique, les effets sonores
- Sauvegarde automatique continue (localStorage)
- Aucune connexion réseau requise

---

## 11. Hors Scope (v1.0)

Les éléments suivants ne font pas partie de la version initiale :

- Multijoueur
- Personnalisation du personnage
- Tricks switch/nollie (réservés pour une v2)
- Éditeur de niveaux
- Leaderboard / partage social
- Version mobile (touch controls)
