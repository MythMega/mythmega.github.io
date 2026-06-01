# Guidelines de Code — Kokoro Game : Kintsugi

> Ce document est destiné aux agents IA qui codent des parties du jeu.
> Lire et respecter ces conventions garantit la cohérence du code entre les contributeurs.

---

## 1. Conventions Générales

### Style de Code

- **ES6+ modules natifs** : `import`/`export`, pas de CommonJS
- **Classes** pour les entités et systèmes
- **Fonctions pures** pour les utilitaires (MathUtils)
- **PascalCase** pour les classes : `TrickSystem`, `Skater`
- **camelCase** pour les variables et méthodes : `getBuffer()`, `crackState`
- **UPPER_CASE** pour les constantes globales : `CONFIG.PLAYER.SPEED`
- **kebab-case** pour les IDs de tricks/cracks dans les JSON : `kickflip_street`
- Pas de `var`, toujours `const` ou `let`
- Chaque fichier = 1 classe principale (ou 1 module d'utilitaires)
- Longueur de ligne max : 100 caractères
- Indentation : 2 espaces

### Structure d'un Module

```javascript
// Imports groupés : Phaser > systèmes internes > utils
import EventBus from '../utils/EventBus.js';
import { CONFIG } from '../config.js';

// Constantes locales au fichier
const STATE = { IDLE: 'idle', ... };

// Classe principale
export default class MonModule extends Phaser.Something {
  constructor(arg1, arg2) {
    super(...);
    // Initialisation des propriétés DANS le constructeur
    this.state = STATE.IDLE;
  }
  
  // Méthodes publiques en premier
  // Méthodes privées (préfixées _ ) en dernier
}
```

---

## 2. Conventions Phaser 3

### Création des Scènes

```javascript
export default class MyScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MyScene' });
  }
  
  // Ordre obligatoire des méthodes :
  init(data) {}       // reçoit les données de la scène précédente
  preload() {}        // NE PAS utiliser (tout est dans PreloadScene)
  create() {}         // initialisation des objets
  update(time, delta) {} // boucle de jeu
  shutdown() {}       // nettoyage des listeners EventBus
}
```

### Transitions Entre Scènes

Toujours utiliser un fondu au noir :

```javascript
// Pour lancer une nouvelle scène
this.cameras.main.fadeOut(300, 0, 0, 0);
this.cameras.main.once('camerafadeoutcomplete', () => {
  this.scene.start('TargetScene', { data: value });
});

// Dans la scène cible, fade-in au démarrage
this.cameras.main.fadeIn(300, 0, 0, 0);
```

### Gestion des Assets

Tous les assets sont préchargés dans `PreloadScene`. **Ne jamais appeler `this.load` dans une autre scène.**

Pour référencer un asset dans une scène, utiliser la clé définie dans `manifests/images.json` :
```javascript
this.add.image(x, y, 'logo');         // clé 'logo' du manifeste
this.add.sprite(x, y, 'skater');      // clé 'skater' du manifeste
```

### Physics Bodies

```javascript
// Corps physiques : toujours configurer explicitement
this.physics.add.existing(sprite);
sprite.body.setCollideWorldBounds(true);
sprite.body.setGravityY(0);  // Si gravité custom (hérite de la scène)

// Obstacles statiques (ne bougent pas) :
const platforms = this.physics.add.staticGroup();
platforms.create(x, y, 'tileset_key');
```

---

## 3. Conventions des Systèmes

### TrickSystem — Comment l'Étendre

Pour ajouter un nouveau trick :
1. Ajouter l'entrée dans `src/data/tricks.json`
2. Ajouter la crack correspondante dans `src/data/progression.json`
3. Vérifier que l'animation existe dans le spritesheet (voir `assets-specification.md`)
4. **Aucun changement de code** requis si le trick utilise uniquement des inputs existants

### EventBus — Événements Standards

Toujours utiliser les constantes d'événements définies dans `config.js` :

```javascript
// src/config.js
export const EVENTS = {
  TRICK_ATTEMPT: 'trick:attempt',
  TRICK_SUCCESS: 'trick:success',
  TRICK_FAIL:    'trick:fail',
  CRACK_GREY:    'crack:grey',
  CRACK_GOLD:    'crack:gold',
  ENV_UNLOCK:    'env:unlock',
  BOARD_COMPLETE:'board:complete'
};

// Usage :
EventBus.emit(EVENTS.TRICK_SUCCESS, { trickId: 'kickflip', envId: 'street' });
EventBus.on(EVENTS.CRACK_GOLD, ({ crackId }) => { ... });
```

### Nettoyage des Listeners

**Obligatoire** dans `shutdown()` de chaque scène/système :

```javascript
shutdown() {
  // Supprimer tous les listeners EventBus de cette scène
  EventBus.off(EVENTS.TRICK_SUCCESS, this.handleSuccess, this);
  EventBus.off(EVENTS.CRACK_GOLD, this.handleCrackGold, this);
}
```

---

## 4. Gestion de la Sauvegarde

**Ne jamais accéder directement à `localStorage`.** Toujours passer par `SaveManager` :

```javascript
import SaveManager from '../utils/SaveManager.js';

// Sauvegarder
SaveManager.save({
  version: '1.0',
  cracks: kintsugiSystem.serialize(),
  unlockedEnvs: progressionSystem.getUnlockedEnvs(),
  lastEnv: currentEnvId
});

// Charger
const save = SaveManager.load();
if (save) {
  kintsugiSystem.deserialize(save.cracks);
}
```

---

## 5. Structure de `GameScene` (Classe de Base)

Toutes les scènes d'environnement héritent de `GameScene`. Ne jamais dupliquer la logique commune.

```javascript
// src/scenes/environments/GameScene.js
export default class GameScene extends Phaser.Scene {
  constructor(key, envConfig) {
    super({ key });
    this.envConfig = envConfig; // données de environments.json
  }
  
  create() {
    this._createWorld();
    this._createSkater();
    this._createSystems();
    this._createHUD();
    this._setupCollisions();
    this._setupEventListeners();
    this.cameras.main.fadeIn(300, 0, 0, 0);
  }
  
  // Méthodes protégées (peuvent être override dans les sous-classes)
  _createWorld() { /* tilemap, backgrounds */ }
  _createSkater() { /* instancier Skater */ }
  _createSystems() { /* InputSystem, TrickSystem, etc. */ }
  _createHUD() { /* HUD */ }
  _setupCollisions() { /* arcade physics overlaps/colliders */ }
  _setupEventListeners() { /* EventBus */ }
  
  update(time, delta) {
    this.inputSystem.update();
    this.skater.update(delta);
    this.trickSystem.update(this.skater);
    this.hud.update();
  }
  
  shutdown() {
    // Nettoyage EventBus
    this._cleanupListeners();
  }
}
```

**Dans une sous-classe (ex: StreetScene) :**

```javascript
// src/scenes/environments/StreetScene.js
import GameScene from './GameScene.js';
import ENV_DATA from '../../data/environments.json' assert { type: 'json' };

export default class StreetScene extends GameScene {
  constructor() {
    super('StreetScene', ENV_DATA.environments.find(e => e.id === 'street'));
  }
  
  // Override uniquement ce qui est spécifique à Street
  _createWorld() {
    super._createWorld(); // appel obligatoire
    // Ajouts spécifiques à Street
  }
}
```

---

## 6. Machine à États du Skater

Ne jamais changer `this.skater.state` directement depuis l'extérieur. Toujours utiliser `skater.setState(newState)` qui gère les transitions valides et joue les animations :

```javascript
// ✓ Correct
skater.setState(SKATER_STATE.JUMPING);

// ✗ Interdit
skater.state = 'jumping';
```

---

## 7. Optimisation (Règles Anti-Garbage Collection)

**Ne jamais créer de nouveaux objets dans `update()` :**

```javascript
// ✗ Interdit dans update()
const buffer = inputSystem.getBuffer(400); // Si getBuffer() crée un nouveau tableau

// ✓ Correct : réutiliser un objet pré-alloué
this._tempBuffer.length = 0; // vider sans créer
inputSystem.fillBuffer(this._tempBuffer, 400);
```

**Utiliser les Pools Phaser pour les particules :**

```javascript
// ✓ Dans create()
this.dustParticles = this.add.particles(0, 0, 'dust', {
  quantity: 0,    // Pas d'émission automatique
  maxParticles: 20,
  // ...
});

// ✓ Dans update() : émettre depuis le pool existant
this.dustParticles.emitParticleAt(x, y, 5);
```

---

## 8. JSON Data Files

### Modification de `tricks.json`

Chaque trick **doit** avoir :
- `id` unique (kebab-case, underscore pour séparation env)
- `crackId` = `id + "_" + environmentId`
- `animationKey` valide (défini dans le spritesheet)
- `input.keys` : tableau de keyNames correspondant aux touches dans `InputSystem`

### Keynames Valides pour `input.keys`

```
"left", "right", "up", "down",
"space", "modA", "modB", "modC",
"grind", "manual"
```

---

## 9. Chargement des Assets dans PreloadScene

`PreloadScene` lit les 3 manifestes et charge tout automatiquement. **Ne pas ajouter manuellement des appels `this.load.image` ailleurs.**

Le code de PreloadScene doit ressembler à :

```javascript
preload() {
  // Charger les manifestes en JSON (hardcodés)
  fetch('./manifests/images.json')
    .then(r => r.json())
    .then(manifest => {
      manifest.images.forEach(img => {
        this.load.image(img.key, img.path);
      });
      manifest.spritesheets.forEach(ss => {
        this.load.spritesheet(ss.key, ss.path, {
          frameWidth: ss.frameWidth,
          frameHeight: ss.frameHeight
        });
      });
    });
  // ... idem pour audio et fonts
}
```

> Attention : `fetch` est asynchrone. Utiliser `this.load.on('progress', cb)` de Phaser pour la barre de progression, pas le fetch.
> Alternative plus simple : définir les assets directement dans PreloadScene avec les chemins hard-codés, et garder les manifestes comme référence documentaire.

---

## 10. Tests Manuels Recommandés

Avant de soumettre une fonctionnalité :

| Test | Vérification |
|------|-------------|
| Trick standard | Ollie, Kickflip, Heelflip fonctionnent |
| Buffer d'inputs | Modificateur avant SPACE (300ms) → trick détecté |
| Grind | Approche rail → 50-50 activé |
| Crash | Atterrissage de côté → animation crash, reset position |
| Crack grise | Première tentative → crack grise sur board |
| Crack dorée | Trick réussi → crack passe grise→or |
| Débloquage env | 5 cracks gold → Skatepark apparaît dans EnvSelectScene |
| Sauvegarde | Recharger la page → état des cracks conservé |
| Caméra | Scroll horizontal sans glitch aux bords du monde |

---

## 11. Checklist pour un Nouveau Module

Avant de créer un nouveau fichier `.js` :

- [ ] Y a-t-il déjà un module similaire ? (vérifier l'architecture)
- [ ] Le module a-t-il un rôle unique et clair ?
- [ ] Les imports sont-ils dans le bon ordre ?
- [ ] Le module exporte-t-il une seule classe ou objet ?
- [ ] Si le module écoute EventBus : a-t-il un `shutdown()` avec `EventBus.off` ?
- [ ] Les méthodes appelées dans `update()` évitent-elles les allocations ?
