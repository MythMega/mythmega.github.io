# Système de Tricks — Kokoro Game : Kintsugi

---

## 1. Philosophie du Système

Les tricks sont au cœur du gameplay. Le système doit être :
- **Lisible** : chaque trick a un input clair et mémorisable
- **Progressif** : les tricks simples s'apprennent vite, les complexes demandent de la pratique
- **Context-aware** : certains tricks ne sont disponibles que dans certains états/obstacles
- **Forgiving** : buffer d'inputs pour tolérer les inputs légèrement en avance ou en retard

---

## 2. Machine à États du Skater

```
                 ┌──────────────────────────────────┐
                 │              IDLE                │
                 └──────────────────────────────────┘
                    ↓ ← / →              ↑ ↓ ↓
               ROLLING  ────────────→  PUSHING
                  │  ↑
         ↓ hold   │   ↓ release
           ↓      │
        CROUCHING ─── SPACE ──→ JUMPING
                                    │
               ┌────────────────────┤
               ↓                    ↓
          TRICK_AIR              [terrain  
      (trick input détecté)     atteint?]
               │                    │
         atterrit?              LANDING ──→ ROLLING
               │                    
      ┌────────┴────────┐
      ↓                 ↓
   LANDING           CRASHED
   (propre)
      │                 │
   ROLLING          (délai 1s)
                        │
                     ROLLING
                         
ROLLING + SPACE + G (proche rail) ──→ GRINDING ──→ (fin rail) ──→ JUMPING ou LANDING
ROLLING + M hold ──→ MANUAL ──────→ (équilibre ok) ──→ ROLLING
```

---

## 3. Catégories de Tricks

| ID catégorie | Nom | État requis | Obstacle requis |
|---|---|---|---|
| `flatground` | Flatground Tricks | `jumping` ou `trick_air` | Aucun |
| `grind` | Grinds | `jumping` (proche rail) | Rail |
| `slide` | Slides | `jumping` (proche ledge) | Ledge |
| `lip` | Lip Tricks | `jumping` (proche ramp lip) | Ramp |
| `manual` | Manuals | `rolling` | Aucun |

---

## 4. Mapping des Touches

| Touche | Rôle |
|--------|------|
| `←` / `→` | Déplacement horizontal |
| `↑` | Pousser / accélérer |
| `↓` | Freiner / s'accroupir (modifier) |
| `SPACE` | Ollie / Jump (principal) |
| `Z` | Modificateur A — flip front foot (kickflip rotation) |
| `X` | Modificateur B — flip back foot (heelflip rotation) |
| `C` | Modificateur C — body rotation (shove-it) |
| `G` | Grind / Slide initiation |
| `M` | Manual initiation |
| `ESCAPE` | Pause / retour menu |

---

## 5. Système de Buffer d'Inputs

Le buffer enregistre les **400 dernières ms** d'inputs avec timestamps.

```
Exemple de trick : Kickflip = Z pressé AVANT ou PENDANT le saut

t=0ms  : joueur crouche (↓ maintenu)
t=150ms: joueur presse Z (modificateur)
t=200ms: joueur presse SPACE (ollie/jump)
         → buffer contient Z dans les 400ms → KICKFLIP détecté ✓
```

**Règles du buffer :**
- Un input est valide s'il est dans la fenêtre de `INPUT_BUFFER_WINDOW` (400ms)
- Les modificateurs (Z, X, C) doivent précéder ou être simultanés au SPACE
- Un input consommé est retiré du buffer
- Le buffer est vidé au landing (atterrissage)

---

## 6. Liste Complète des Tricks

### 6.1 Flatground Tricks

| ID | Nom | Difficulté | Input | Environments |
|----|-----|-----------|-------|-------------|
| `ollie` | Ollie | ★☆☆☆☆ | `SPACE` | Tous |
| `nollie` | Nollie | ★★☆☆☆ | `↑` + `SPACE` | street, rooftop, garden |
| `pop_shove_it` | Pop Shove-it | ★★☆☆☆ | `↓` + `SPACE` | Tous |
| `front_shove_it` | Front Shove-it | ★★☆☆☆ | `↑` + `C` + `SPACE` | street, skatepark |
| `kickflip` | Kickflip | ★★☆☆☆ | `Z` + `SPACE` | Tous |
| `heelflip` | Heelflip | ★★☆☆☆ | `X` + `SPACE` | Tous |
| `varial_kickflip` | Varial Kickflip | ★★★☆☆ | `Z` + `C` + `SPACE` | street, skatepark, rooftop |
| `varial_heelflip` | Varial Heelflip | ★★★☆☆ | `X` + `C` + `SPACE` | street, skatepark, rooftop |
| `360_flip` | 360 Flip | ★★★★☆ | `Z` + `↓` + `SPACE` | rooftop, garden |
| `hardflip` | Hardflip | ★★★★☆ | `Z` + `↑` + `SPACE` | rooftop, tunnel |
| `inward_heelflip` | Inward Heelflip | ★★★★☆ | `X` + `↑` + `SPACE` | rooftop, garden |
| `impossible` | Impossible | ★★★★★ | `X` + `Z` + `SPACE` | garden |
| `nollie_kickflip` | Nollie Kickflip | ★★★☆☆ | `↑` + `Z` + `SPACE` | garden |
| `nollie_heelflip` | Nollie Heelflip | ★★★☆☆ | `↑` + `X` + `SPACE` | garden |
| `fakie_kickflip` | Fakie Kickflip | ★★★☆☆ | `Z` + `SPACE` (en fakie) | garden |
| `fakie_heelflip` | Fakie Heelflip | ★★★☆☆ | `X` + `SPACE` (en fakie) | garden |

> **Note Fakie :** Le mode fakie est activé quand le skater roule en arrière (direction opposée à sa posture normale). Détecté automatiquement.

### 6.2 Grind Tricks (sur Rail)

| ID | Nom | Difficulté | Input | Environments |
|----|-----|-----------|-------|-------------|
| `50_50_rail` | 50-50 Grind | ★★☆☆☆ | `SPACE` + `G` (approche neutre) | street, skatepark, rooftop, tunnel |
| `nosegrind_rail` | Nosegrind | ★★★☆☆ | `←` + `SPACE` + `G` | street, rooftop |
| `5_0_rail` | 5-0 Grind | ★★★☆☆ | `→` + `SPACE` + `G` | street, skatepark |
| `crooked_grind` | Crooked Grind | ★★★☆☆ | `Z` + `SPACE` + `G` | skatepark, rooftop, tunnel |
| `smith_grind` | Smith Grind | ★★★★☆ | `X` + `→` + `SPACE` + `G` | skatepark, rooftop, tunnel |
| `feeble_grind` | Feeble Grind | ★★★★☆ | `X` + `←` + `SPACE` + `G` | skatepark, tunnel |

### 6.3 Slide Tricks (sur Ledge)

| ID | Nom | Difficulté | Input | Environments |
|----|-----|-----------|-------|-------------|
| `50_50_ledge` | 50-50 on Ledge | ★★☆☆☆ | `SPACE` + `G` (approach neutre) | street, skatepark |
| `noseslide` | Noseslide | ★★★☆☆ | `←` + `SPACE` + `G` | street, skatepark |
| `tailslide` | Tailslide | ★★★☆☆ | `→` + `SPACE` + `G` | skatepark, tunnel |
| `boardslide` | Boardslide | ★★★☆☆ | `↓` + `SPACE` + `G` | street, skatepark, rooftop |
| `bluntslide` | Bluntslide | ★★★★☆ | `↑` + `SPACE` + `G` | skatepark, tunnel |
| `nosegrind_ledge` | Nosegrind (ledge) | ★★★★☆ | `Z` + `←` + `SPACE` + `G` | rooftop |
| `darkslide` | Darkslide | ★★★★★ | `X` + `Z` + `↓` + `SPACE` + `G` | garden |
| `primoslide` | Primoslide | ★★★★★ | `X` + `↑` + `SPACE` + `G` | garden |

### 6.4 Lip Tricks (sur Ramp / Quarter Pipe)

| ID | Nom | Difficulté | Input | Environments |
|----|-----|-----------|-------|-------------|
| `kickturn` | Kickturn | ★☆☆☆☆ | `←` ou `→` (sur rampe) | skatepark, tunnel |
| `rock_to_fakie` | Rock to Fakie | ★★☆☆☆ | `↑` + `SPACE` (au lip) | skatepark |
| `rock_n_roll` | Rock n' Roll | ★★★☆☆ | `↑` + `C` + `SPACE` (au lip) | skatepark, tunnel |
| `axle_stall` | Axle Stall | ★★☆☆☆ | `SPACE` (au lip) | skatepark |
| `nose_stall` | Nose Stall | ★★★☆☆ | `←` + `SPACE` (au lip) | skatepark |
| `tail_stall` | Tail Stall | ★★★☆☆ | `→` + `SPACE` (au lip) | skatepark |
| `nosepick` | Nosepick | ★★★★☆ | `Z` + `←` + `SPACE` (au lip) | tunnel |
| `blunt_stall` | Blunt Stall | ★★★★☆ | `X` + `↑` + `SPACE` (au lip) | tunnel |
| `5_0_stall` | 5-0 Stall | ★★★☆☆ | `→` + `G` + `SPACE` (au lip) | skatepark, tunnel |

### 6.5 Manual Tricks

| ID | Nom | Difficulté | Input | Environments |
|----|-----|-----------|-------|-------------|
| `manual` | Manual | ★★☆☆☆ | `↓` (hold en roulant) | Tous |
| `nose_manual` | Nose Manual | ★★☆☆☆ | `↑` (hold en roulant) | Tous |
| `manual_combo_trick` | Manual + Trick | ★★★☆☆ | `↓` hold puis SPACE + modificateur | tunnel, garden |
| `nose_manual_combo` | Nose Manual + Trick | ★★★☆☆ | `↑` hold puis SPACE + modificateur | garden |

---

## 7. Règles de Validation d'un Trick

### Flatground
1. Skater dans l'état `jumping` ou `trick_air`
2. Input correct détecté dans le buffer (400ms)
3. Atterrissage sur les roues (`onGround()` devient true avec velocity.y stable)
4. Aucune collision de côté pendant l'air time

### Grind / Slide
1. Skater dans l'état `jumping` (en vol)
2. `SPACE` + `G` détectés simultanément (tolérance 100ms)
3. Skater dans le `SNAP_RANGE` (24px) du rail/ledge
4. Vitesse suffisante (> 80 px/s)
5. Direction d'approche perpendiculaire à l'angle du rail (± 45°)

### Lip Tricks
1. Skater en l'air au niveau du `lip` d'une rampe
2. Input correct au bon moment (lip entry window)
3. Le stall est maintenu au moins 200ms

### Manual
1. Skater en état `rolling` avec une vitesse > 50 px/s
2. Touche `↓` ou `↑` maintenue
3. Barre d'équilibre affichée — le joueur l'équilibre avec `←/→`
4. Si balance > seuil → crash du manual

---

## 8. Trick → Crack Mapping

Chaque trick correspond à une **position de crack unique** sur le board kintsugi. Voir `progression-kintsugi.md` pour le mapping complet.

```
crackId = trickId + "_" + envId
Exemple : "kickflip_street", "50_50_rail_skatepark"
```

---

## 9. Détails d'Implémentation TrickSystem

### Algorithme de détection (pseudocode)

```javascript
update(skater) {
  if (skater.state === 'jumping' || skater.state === 'trick_air') {
    const buffer = inputSystem.getBuffer(400);
    const availableTricks = this.getTricksForContext(skater);
    
    for (const trick of availableTricks) {
      if (this.matchesInput(trick.input, buffer)) {
        this.executeTrick(trick, skater);
        break; // Un seul trick à la fois
      }
    }
  }
  
  if (skater.state === 'grinding') {
    // Vérifier fin de rail
    // Vérifier kickout input (SPACE en fin de rail)
  }
  
  if (skater.state === 'manual' || skater.state === 'nose_manual') {
    this.updateManualBalance(skater);
  }
}
```

### Priorité des tricks

Si plusieurs tricks matchent le même input, la priorité est :
1. Tricks avec plus de touches (plus spécifiques d'abord)
2. Tricks de la catégorie active (grind > flatground si proche d'un rail)
3. En cas d'égalité : ordre défini dans `tricks.json`

---

## 10. Animations par Trick

| Catégorie | Frames | FPS |
|-----------|--------|-----|
| Ollie | 4 | 10 |
| Flip tricks (kickflip, heelflip...) | 6 | 12 |
| Shove-it / body rotation | 6 | 12 |
| 360 Flip | 8 | 12 |
| Grind | 4 (loop) | 8 |
| Manual | 3 (loop) | 6 |
| Lip stall | 2 (loop) | 4 |
| Landing | 2 | 10 |
| Crash | 5 | 8 |

Voir `assets-specification.md` pour les spécifications exactes de chaque spritesheet.
