# Contrôles & Système d'Inputs — Kokoro Game : Kintsugi

---

## 1. Mapping Clavier Complet

### Touches de Mouvement

| Touche | Action | Contexte |
|--------|--------|---------|
| `←` (ArrowLeft) | Déplacer à gauche / freinage si va à droite | Au sol, en l'air |
| `→` (ArrowRight) | Déplacer à droite / freinage si va à gauche | Au sol, en l'air |
| `↑` (ArrowUp) | Pousser fort (accélérer) / Pump sur rampe | Au sol / sur rampe |
| `↓` (ArrowDown) | Freiner / S'accroupir avant ollie | Au sol |

### Touches d'Action

| Touche | Action | Contexte |
|--------|--------|---------|
| `SPACE` | Ollie / Sauter / Valider | Au sol, au lip de rampe |
| `Z` | Modificateur A — flip front foot | Buffer trick |
| `X` | Modificateur B — flip back foot | Buffer trick |
| `C` | Modificateur C — rotation body (shove-it) | Buffer trick |
| `G` | Initiation grind / slide | En l'air proche obstacle |
| `M` | Initiation manual | Au sol |

### Touches Système

| Touche | Action |
|--------|--------|
| `ESCAPE` | Pause / Retour au menu |
| `F1` | Debug mode (désactivé en production) |
| `R` | Reset position (retour au spawn, sans effet sur progression) |

---

## 2. Séquences d'Inputs par Trick

Les séquences utilisent une notation `[modificateurs] + [action]`. Les modificateurs sont lus depuis le **buffer (400ms)** avant l'action principale.

### Flatground Tricks

```
Ollie               :  SPACE
Nollie              :  ↑  +  SPACE
Pop Shove-it        :  ↓  +  SPACE
Front Shove-it      :  ↑  +  C  +  SPACE
Kickflip            :  Z  +  SPACE
Heelflip            :  X  +  SPACE
Varial Kickflip     :  Z  +  C  +  SPACE
Varial Heelflip     :  X  +  C  +  SPACE
360 Flip            :  Z  +  ↓  +  SPACE
Hardflip            :  Z  +  ↑  +  SPACE
Inward Heelflip     :  X  +  ↑  +  SPACE
Impossible          :  X  +  Z  +  SPACE
Nollie Kickflip     :  ↑  +  Z  +  SPACE
Nollie Heelflip     :  ↑  +  X  +  SPACE
Fakie Kickflip      :  Z  +  SPACE  (pendant roulement fakie)
Fakie Heelflip      :  X  +  SPACE  (pendant roulement fakie)
```

### Grinds & Slides (approche d'un rail/ledge + G)

```
50-50 Grind (rail)  :  SPACE  +  G  (approche neutre)
50-50 Grind (ledge) :  SPACE  +  G  (approche neutre)
Nosegrind (rail)    :  ←  +  SPACE  +  G
5-0 Grind           :  →  +  SPACE  +  G
Crooked Grind       :  Z  +  SPACE  +  G
Smith Grind         :  X  +  →  +  SPACE  +  G
Feeble Grind        :  X  +  ←  +  SPACE  +  G
Noseslide (ledge)   :  ←  +  SPACE  +  G
Tailslide (ledge)   :  →  +  SPACE  +  G
Boardslide (ledge)  :  ↓  +  SPACE  +  G
Bluntslide          :  ↑  +  SPACE  +  G
Nosegrind (ledge)   :  Z  +  ←  +  SPACE  +  G
Darkslide           :  X  +  Z  +  ↓  +  SPACE  +  G
Primoslide          :  X  +  ↑  +  SPACE  +  G
```

### Lip Tricks (au bord d'une rampe)

```
Kickturn            :  ←  ou  →  (en haut de rampe, avant de redescendre)
Rock to Fakie       :  ↑  +  SPACE  (au lip)
Rock n' Roll        :  ↑  +  C  +  SPACE  (au lip)
Axle Stall          :  SPACE  (au lip)
Nose Stall          :  ←  +  SPACE  (au lip)
Tail Stall          :  →  +  SPACE  (au lip)
5-0 Stall           :  →  +  G  +  SPACE  (au lip)
Nosepick            :  Z  +  ←  +  SPACE  (au lip)
Blunt Stall         :  X  +  ↑  +  SPACE  (au lip)
```

### Manuals

```
Manual              :  ↓  (maintenu pendant roulement > 50px/s)
Nose Manual         :  ↑  (maintenu pendant roulement > 50px/s)
Manual + Trick      :  ↓  maintenu  puis  SPACE  +  [modificateurs]
Nose Manual + Trick :  ↑  maintenu  puis  SPACE  +  [modificateurs]
```

---

## 3. Logique de Résolution des Inputs

### Priorité des Tricks

Quand plusieurs tricks correspondent au même input, résolution par :

1. **Nombre de touches** : plus de touches = plus prioritaire (ex : `Z+C+SPACE` > `Z+SPACE`)
2. **Contexte** : grind/slide > flatground si proche d'un obstacle grindable
3. **Ordre dans tricks.json** si égalité

### Tolérance au Timing

| Touche | Fenêtre de buffer |
|--------|-------------------|
| Modificateurs (Z, X, C, directions) | 400ms avant SPACE |
| SPACE | Déclencheur immédiat |
| G (grind) | 300ms fenêtre depuis la détection de l'obstacle |
| M (manual) | Maintenu = actif, relâché = arrêt |

### Coyote Time

Si le joueur appuie sur SPACE jusqu'à 120ms **après** avoir quitté un sol, l'ollie est quand même validé. Cela pardonne les inputs légèrement tardifs sur les bords de plateformes.

```javascript
// src/config.js
PLAYER: {
  COYOTE_TIME: 120, // ms
}
```

### Jump Buffering (Pre-Jump)

Si le joueur appuie sur SPACE jusqu'à 100ms **avant** de toucher le sol (en descente), l'ollie est déclenché dès le contact avec le sol.

---

## 4. InputSystem — Architecture Interne

```javascript
// src/systems/InputSystem.js

class InputSystem {
  constructor(scene) {
    this.scene = scene;
    this.keys = scene.input.keyboard.addKeys({
      left:    Phaser.Input.Keyboard.KeyCodes.LEFT,
      right:   Phaser.Input.Keyboard.KeyCodes.RIGHT,
      up:      Phaser.Input.Keyboard.KeyCodes.UP,
      down:    Phaser.Input.Keyboard.KeyCodes.DOWN,
      space:   Phaser.Input.Keyboard.KeyCodes.SPACE,
      modA:    Phaser.Input.Keyboard.KeyCodes.Z,      // flip front
      modB:    Phaser.Input.Keyboard.KeyCodes.X,      // flip back
      modC:    Phaser.Input.Keyboard.KeyCodes.C,      // body rotation
      grind:   Phaser.Input.Keyboard.KeyCodes.G,
      manual:  Phaser.Input.Keyboard.KeyCodes.M,
      escape:  Phaser.Input.Keyboard.KeyCodes.ESC,
      reset:   Phaser.Input.Keyboard.KeyCodes.R
    });
    
    this.buffer = [];              // { key, time, consumed }
    this.BUFFER_WINDOW = 400;     // ms
  }
  
  update() {
    const now = this.scene.time.now;
    
    // Ajouter les nouveaux inputs au buffer
    for (const [keyName, key] of Object.entries(this.keys)) {
      if (Phaser.Input.Keyboard.JustDown(key)) {
        this.buffer.push({ key: keyName, time: now, consumed: false });
      }
    }
    
    // Nettoyer les inputs trop anciens
    this.buffer = this.buffer.filter(
      entry => (now - entry.time) < this.BUFFER_WINDOW && !entry.consumed
    );
  }
  
  isDown(keyName) {
    return this.keys[keyName]?.isDown ?? false;
  }
  
  wasJustPressed(keyName) {
    return Phaser.Input.Keyboard.JustDown(this.keys[keyName]);
  }
  
  getBuffer(windowMs = this.BUFFER_WINDOW) {
    const cutoff = this.scene.time.now - windowMs;
    return this.buffer.filter(e => e.time >= cutoff && !e.consumed);
  }
  
  matchTrickInput(trickInputDef) {
    // trickInputDef = { type: 'combo', keys: ['modA', 'space'] }
    const buffer = this.getBuffer();
    const required = trickInputDef.keys;
    
    // Vérifier que toutes les touches requises sont dans le buffer
    const matched = required.every(reqKey =>
      buffer.some(entry => entry.key === reqKey)
    );
    
    if (matched) {
      // Marquer comme consommés
      required.forEach(reqKey => {
        const entry = buffer.find(e => e.key === reqKey);
        if (entry) entry.consumed = true;
      });
      return true;
    }
    return false;
  }
  
  clearBuffer() {
    this.buffer = [];
  }
}
```

---

## 5. Contexte Sensible

Certains inputs ont des comportements différents selon le contexte :

| Input | Au sol | En l'air | Sur rampe | En grind |
|-------|--------|---------|-----------|---------|
| `SPACE` | Ollie | (ignoré) | Kickout du lip | Kickout du grind |
| `↑` | Pousser | (cosmétique) | Pump (accélère) | (ignoré) |
| `↓` | Freiner | (cosmétique) | Pump (accélère en descente) | (ignoré) |
| `←/→` | Déplacer | Orientation faible | Diriger la courbe | (ignoré pendant grind) |
| `G` | (ignoré) | Initier grind si proche | (ignoré) | Maintenir grind |
| `M` | Initier manual | (ignoré) | (ignoré) | (ignoré) |

---

## 6. Visualisation des Inputs (Debug)

En mode debug (`CONFIG.DEBUG = true`), afficher dans un coin de l'écran :

```
INPUTS:   ← [A] Z [X]
BUFFER:   modA(120ms) space(0ms)
STATE:    jumping
TRICK:    kickflip (detected)
```

---

## 7. Options d'Accessibilité (v1 basique)

- **Remapping de touches** : non implémenté en v1 (hors scope)
- **Indicateurs visuels des inputs** : optionnel, petites icônes de touches affichées près du skater
- **Mode débutant** : window de buffer étendue à 600ms (option dans les paramètres)
