# Architecture Technique — Kokoro Game : Kintsugi

---

## 1. Stack Technique

| Composant | Choix | Raison |
|-----------|-------|--------|
| Framework jeu | **Phaser 3.70+** | Mature, 2D, arcade physics, spritesheets, tilemaps, audio — parfait pour pixel art 2D |
| Langage | **JavaScript ES6+** (modules natifs) | Pas de transpilation, import/export natif, compatible CDN |
| Physique | **Phaser Arcade Physics** | Simple, performant, adapté à la platformer 2D |
| Rendu | **Canvas 2D** via Phaser | PixelArt mode intégré |
| Sauvegarde | **localStorage** | Client-side, sans serveur |
| Dépendances | Phaser 3 via CDN | Zéro build step requis si besoin |
| **Intégration iframe** | Guard JS + CSP `frame-ancestors` | Whitelist d'origines autorisées, configurable dans `src/embed-config.js` |

### Option d'intégration Phaser

**Option A — CDN (développement rapide, zéro config):**
```html
<script src="https://cdn.jsdelivr.net/npm/phaser@3.70.0/dist/phaser.min.js"></script>
```

**Option B — npm (recommandé pour bundle):**
```json
{
  "dependencies": {
    "phaser": "^3.70.0"
  },
  "devDependencies": {
    "vite": "^5.0.0"
  }
}
```
Avec Vite, commande : `vite build` → produit un fichier bundle standalone.

---

## 2. Intégration iframe

Le jeu est conçu pour être intégrable en `<iframe>` sur des sites partenaires, avec une restriction stricte sur les origines autorisées.

### Origines autorisées

| Domaine | Usage |
|---------|-------|
| `localhost` | Développement local |
| `jmdev.fr` | Site principal |
| `web.jmdev.fr` | Sous-domaine web |

### Fichiers concernés

| Fichier | Rôle |
|---------|------|
| `src/embed-config.js` | **Source de vérité** — liste `allowedHosts` / `allowedOrigins` + fonction `checkEmbedAllowed()` |
| `index.html` | Guard inline synchrone (s'exécute avant Phaser, bloque le rendu si origine non autorisée) |
| `_headers` | Headers HTTP `Content-Security-Policy: frame-ancestors` (Netlify / Cloudflare Pages) |

### Mécanisme de sécurité

```
Navigateur charge index.html
       ↓
[Script inline synchrone]
  ├─ window === window.top ?  → OK (pas d'iframe)
  ├─ window.top.location accessible ?  → vérifier hostname (même origine)
  └─ Cross-origin (erreur CORS) → vérifier document.referrer
           ↓ Si origine non autorisée
  Remplacer le DOM par message d'erreur, stopper le chargement
```

> **⚠ Note GitHub Pages** : GitHub Pages ne supporte pas les headers HTTP personnalisés.
> Sur ce déploiement, seul le guard JavaScript est actif. Le fichier `_headers` s'applique
> uniquement sur Netlify / Cloudflare Pages.

### Modifier la whitelist

Pour ajouter un domaine autorisé, éditer **uniquement** `src/embed-config.js` :

```javascript
allowedHosts: [
  'localhost',
  'jmdev.fr',
  'web.jmdev.fr',
  'nouveau-domaine.com',  // ← ajouter ici
],
allowedOrigins: [
  'http://localhost',
  'https://localhost',
  'https://jmdev.fr',
  'https://web.jmdev.fr',
  'https://nouveau-domaine.com',  // ← et ici
],
```

Puis mettre à jour manuellement la ligne `frame-ancestors` dans `_headers`.

---

## 3. Configuration Phaser

```javascript
// src/main.js
const GAME_WIDTH  = 640;
const GAME_HEIGHT = 360;
const ZOOM        = 2;   // Affiché en 1280×720

const config = {
  type: Phaser.AUTO,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  zoom: ZOOM,
  pixelArt: true,
  backgroundColor: '#0a0a0a',
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 900 },
      debug: false          // true en développement
    }
  },
  scene: [
    BootScene,
    PreloadScene,
    MenuScene,
    BoardScene,
    EnvSelectScene,
    StreetScene,
    SkateparkScene,
    RooftopScene,
    TunnelScene,
    GardenScene
  ],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  }
};

const game = new Phaser.Game(config);
```

---

## 3. Structure des Scènes Phaser

### Flux de navigation

```
BootScene
   ↓ (lecture localStorage, init SaveManager)
PreloadScene
   ↓ (chargement de tous les assets)
MenuScene
   ↓ [Appuyer sur ↵ / clic]
BoardScene  ←──── retour ici après chaque session
   ↓ [Bouton "Jouer"]
EnvSelectScene
   ↓ [Environnement sélectionné]
[StreetScene | SkateparkScene | RooftopScene | TunnelScene | GardenScene]
   ↓ [ÉCHAP ou pause]
BoardScene
```

### Descriptions des scènes

| Scène | Fichier | Rôle |
|-------|---------|------|
| `BootScene` | `src/scenes/BootScene.js` | Init SaveManager, vérification localStorage, no loading |
| `PreloadScene` | `src/scenes/PreloadScene.js` | Charge tous les assets depuis les manifestes |
| `MenuScene` | `src/scenes/MenuScene.js` | Logo animé, fond kintsugi, démarrage |
| `BoardScene` | `src/scenes/BoardScene.js` | Affichage du skateboard + cracks, stats, bouton jouer |
| `EnvSelectScene` | `src/scenes/EnvSelectScene.js` | Grille des environnements (verrou/débloqué) |
| `GameScene` | `src/scenes/environments/GameScene.js` | **Classe abstraite** — logique commune |
| `StreetScene` | `src/scenes/environments/StreetScene.js` | Hérite de GameScene, config spécifique rue |
| `SkateparkScene` | `...SkateparkScene.js` | Hérite de GameScene |
| `RooftopScene` | `...RooftopScene.js` | Hérite de GameScene |
| `TunnelScene` | `...TunnelScene.js` | Hérite de GameScene |
| `GardenScene` | `...GardenScene.js` | Hérite de GameScene |

---

## 4. Architecture des Systèmes

### Pattern recommandé : Systems + EventBus

Les systèmes communiquent via un EventBus global. Chaque système est instancié dans `GameScene` et injecté aux entités.

```javascript
// src/utils/EventBus.js
const EventBus = new Phaser.Events.EventEmitter();
export default EventBus;

// Événements émis dans le jeu :
// 'trick:attempt'  → { trickId, envId }
// 'trick:success'  → { trickId, envId }
// 'trick:fail'     → { trickId, envId }
// 'crack:grey'     → { crackId }
// 'crack:gold'     → { crackId }
// 'env:unlock'     → { envId }
// 'board:complete' → {}
```

### Diagramme des systèmes

```
InputSystem
   ↓ (détecte séquences)
TrickSystem
   ├─ [tentative] → EventBus.emit('trick:attempt')
   └─ [succès]   → EventBus.emit('trick:success')
                         ↓
                   KintsugiSystem
                   ├─ met à jour l'état des cracks
                   └─ EventBus.emit('crack:grey' | 'crack:gold')
                                     ↓
                             ProgressionSystem
                             ├─ vérifie seuils de débloquage
                             ├─ EventBus.emit('env:unlock') si seuil atteint
                             └─ SaveManager.save()
```

---

## 5. Modules Détaillés

### 5.1 `src/main.js`
Point d'entrée. Importe toutes les scènes, crée `new Phaser.Game(config)`.

### 5.2 `src/config.js`
```javascript
export const CONFIG = {
  GAME_WIDTH: 640,
  GAME_HEIGHT: 360,
  ZOOM: 2,
  GRAVITY: 900,
  PLAYER: {
    SPEED: 200,
    JUMP_VELOCITY: -620,
    PUSH_FORCE: 40,
    MAX_SPEED: 280,
    FRICTION: 0.88,
    AIR_FRICTION: 0.995,
    COYOTE_TIME: 120,       // ms
    INPUT_BUFFER_WINDOW: 400 // ms
  },
  GRIND: {
    SPEED: 160,
    SNAP_RANGE: 24,         // px
    ENTRY_WINDOW: 300       // ms
  },
  MANUAL: {
    BALANCE_DECAY: 0.02,
    CORRECTION_SPEED: 0.06
  },
  PHYSICS: {
    LANDING_SQUASH_SCALE: { x: 1.3, y: 0.7 },
    LANDING_RECOVERY_TIME: 150 // ms
  }
};
```

### 5.3 `src/entities/Skater.js`

Hérite de `Phaser.Physics.Arcade.Sprite`.

**États internes (machine à états) :**
```javascript
const SKATER_STATE = {
  IDLE:       'idle',
  PUSHING:    'pushing',
  ROLLING:    'rolling',
  CROUCHING:  'crouching',
  JUMPING:    'jumping',     // ollie avant trick input
  TRICK_AIR:  'trick_air',  // trick en cours dans les airs
  GRINDING:   'grinding',
  SLIDING:    'sliding',
  MANUAL:     'manual',
  NOSE_MANUAL:'nose_manual',
  LANDING:    'landing',
  CRASHED:    'crashed'
};
```

**Méthodes clés :**
```javascript
class Skater extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y)
  update(delta)                  // appelé par GameScene chaque frame
  setState(newState)             // transition d'état
  onGround()                     // boolean
  canTrick()                     // boolean (en l'air, pas en crash)
  canGrind(obstacle)             // boolean
  initGrind(obstacle, grindType) // démarre un grind
  exitGrind(kickout)             // sort du grind
  initManual(type)               // démarre un manual
  crash()                        // état crashed
  playTrickAnimation(trickId)    // joue l'anim du trick
}
```

### 5.4 `src/systems/InputSystem.js`

Gère le clavier et maintient un buffer d'inputs horodaté.

```javascript
class InputSystem {
  constructor(scene)
  update()                        // appelé chaque frame
  isDown(key)                     // boolean, état actuel
  wasJustPressed(key)             // boolean, ce frame uniquement
  getBuffer(windowMs)             // retourne les inputs récents
  clearBuffer()
  matchSequence(pattern, windowMs)// vérifie si pattern dans buffer
}
```

### 5.5 `src/systems/TrickSystem.js`

Charge `tricks.json` et valide les inputs contre les définitions de tricks.

```javascript
class TrickSystem {
  constructor(scene, inputSystem)
  update(skater)                  // vérifie les conditions de trick
  checkTrickInputs(skater)        // parcourt les tricks disponibles
  validateTrick(trickDef, skater) // vérifie état + input + obstacle
  executeTrick(trickDef, skater)  // lance l'animation, émet l'événement
  onLanding(skater, success)      // appelé quand le skater atterrit
}
```

### 5.6 `src/systems/KintsugiSystem.js`

Gère l'état des cracks sur le board.

```javascript
class KintsugiSystem {
  constructor()
  getCrackState(crackId)          // 'absent' | 'grey' | 'gold'
  markAttempted(crackId)          // absent → grey
  markMastered(crackId)           // grey → gold
  getGoldCount()                   // nombre de cracks dorées
  getGreyCount()                   // nombre de cracks grises
  serialize()                      // → objet pour localStorage
  deserialize(data)                // depuis localStorage
}
```

### 5.7 `src/systems/ProgressionSystem.js`

```javascript
class ProgressionSystem {
  constructor(kintsugiSystem)
  checkUnlocks()                   // vérifie seuils → émet 'env:unlock'
  isEnvUnlocked(envId)             // boolean
  getUnlockedEnvs()                // liste des envs débloqués
}
```

### 5.8 `src/utils/SaveManager.js`

```javascript
const SAVE_KEY = 'kokoro_kintsugi_save';

const SaveManager = {
  save(data)      // JSON.stringify + localStorage.setItem
  load()          // localStorage.getItem + JSON.parse (null si vide)
  clear()         // localStorage.removeItem
  exists()        // boolean
};
```

---

## 6. Structure des Données JSON

### 6.1 `src/data/tricks.json`

```json
{
  "categories": [...],
  "tricks": [
    {
      "id": "ollie",
      "name": "Ollie",
      "category": "flatground",
      "difficulty": 1,
      "input": { "type": "single", "keys": ["JUMP"] },
      "requiredState": ["jumping"],
      "requiredObstacle": null,
      "airTimeMin": 0,
      "animationKey": "trick_ollie",
      "crackId": "ollie_street",
      "environmentId": "street"
    }
  ]
}
```

### 6.2 `src/data/environments.json`

```json
{
  "environments": [
    {
      "id": "street",
      "name": "Street",
      "nameJp": "ストリート",
      "unlockRequirement": 0,
      "worldWidth": 1920,
      "obstacles": [...],
      "availableTrickIds": [...],
      "backgroundLayers": [...]
    }
  ]
}
```

### 6.3 État de sauvegarde (localStorage)

```json
{
  "version": "1.0",
  "cracks": {
    "ollie_street": "gold",
    "kickflip_street": "grey",
    "heelflip_street": "absent"
  },
  "unlockedEnvs": ["street"],
  "lastEnv": "street"
}
```

---

## 7. GameScene — Classe de Base

`GameScene` est la scène parente dont héritent toutes les scènes de jeu. Elle contient :

```javascript
class GameScene extends Phaser.Scene {
  constructor(key, envConfig)
  preload()               // rien (déjà fait dans PreloadScene)
  create() {
    // 1. Créer tilemap depuis envConfig
    // 2. Instancier Skater
    // 3. Instancier obstacles
    // 4. Instancier InputSystem, TrickSystem, KintsugiSystem, ProgressionSystem
    // 5. Configurer collisions arcade
    // 6. Créer HUD
    // 7. Écouter EventBus
  }
  update(time, delta) {
    // 1. InputSystem.update()
    // 2. Skater.update(delta)
    // 3. TrickSystem.update(skater)
    // 4. HUD.update()
    // 5. Caméra follow
  }
  shutdown()              // cleanup EventBus listeners
}
```

---

## 8. Tilemaps

Chaque environnement utilise une tilemap **Tiled** (format JSON) :

- Taille des tiles : **16 × 16 px**
- Calques :
  - `background` (pas de collision)
  - `midground` (pas de collision, décor)
  - `ground` (collision — sol et plateformes)
  - `obstacles` (layer d'objets avec propriétés custom)
  - `spawn_points` (layer d'objets pour position initiale)
- Les obstacles (rail, ledge, ramp) sont définis dans le calque `obstacles` avec propriétés :
  - `type`: `rail | ledge | ramp | stair | manual_pad`
  - `grindable`: `true | false`
  - `width`, `height`

---

## 9. Système de Caméra

```javascript
// Dans GameScene.create()
this.cameras.main.startFollow(this.skater, true, 0.1, 0.1);
this.cameras.main.setDeadzone(100, 80);
this.cameras.main.setBounds(0, 0, worldWidth, GAME_HEIGHT);
```

- Suivi horizontal du skater
- Dead zone pour éviter les micro-mouvements
- Bordures contraintes au monde

---

## 10. Performance

- Tous les assets sont préchargés dans `PreloadScene` avant le jeu
- Les tilemaps utilisent des layers statiques (`this.physics.add.staticGroup()`)
- Les particules utilisent le Particle Manager de Phaser (pool réutilisable)
- `update()` de GameScene : profiler régulièrement, cibler < 2ms par frame
- Pas de garbage collection dans `update()` (pas de `new` dans la boucle)
