# Environnements — Kokoro Game : Kintsugi

Chaque environnement est un monde distinct, débloqué progressivement. Tous partagent la même mécanique de base mais diffèrent par leurs obstacles, leur ambiance et leurs tricks disponibles.

---

## Paramètres Communs

| Paramètre | Valeur |
|-----------|--------|
| Résolution interne | 640 × 360 px |
| Largeur du monde | 1920 px (3 écrans) |
| Taille des tiles | 16 × 16 px |
| Sol (ground y) | y = 288 (hauteur 288px depuis le haut) |
| Hauteur joueur debout | 32 px (base sprite) |
| Scrolling | Horizontal, bounds [0, worldWidth] |
| Spawn joueur | x = 64, y = sol |

---

## Environnement 1 — Street

### Informations Générales

| Champ | Valeur |
|-------|--------|
| ID | `street` |
| Nom | Street |
| Nom JP | ストリート |
| Débloquage | Défaut (0 cracks dorées) |
| Largeur monde | 1920 px |
| Ambiance | Nuit urbaine, lampadaires, néons |
| Musique | `street_lofi` |

### Description

Une rue de ville la nuit. Le bitume est lisse, éclairé par des lampadaires orangés et des enseignes au néon. Parfait pour apprendre les bases. Présence de graffitis sur les murs de fond.

### Layout des Obstacles (coordonnées en pixels, origine top-left)

```
 0                   480                  960                  1440                 1920
 ├────────────────────┼────────────────────┼────────────────────┼────────────────────┤
 │  [LEDGE_1]                [3-STAIR]       [RAIL_1]             [5-STAIR]  [MANUAL]│
 │  x:80-200,y:255     x:380-500            x:620-780            x:980-1120  x:1300  │
 │                                                                             -1400  │
 ├────────────────────────────────────────────────────────────────────────────────────┤ y=288
 │                              GROUND                                                │
 └────────────────────────────────────────────────────────────────────────────────────┘
```

### Détail des Obstacles

| ID | Type | x | y | Largeur | Hauteur | Grindable |
|----|------|---|---|---------|---------|-----------|
| `street_ledge_1` | Ledge | 80 | 255 | 120 | 33 | Oui (top) |
| `street_stair_3` | Stair | 380 | — | 120 | 3 marches | Non |
| `street_rail_1` | Rail | 620 | 238 | 160 | 6 | Oui |
| `street_stair_5` | Stair | 980 | — | 200 | 5 marches | Non |
| `street_manual_pad` | ManualPad | 1300 | 268 | 100 | 20 | Non |

**Stair 3 détail :**
- Marche 1 : x=380-420, y=276
- Marche 2 : x=420-460, y=282
- Marche 3 : x=460-500, y=288 (sol)

**Stair 5 détail :**
- Marche 1 : x=980-1020, y=264
- Marche 2 : x=1020-1060, y=270
- Marche 3 : x=1060-1100, y=276
- Marche 4 : x=1100-1140, y=282
- Marche 5 : x=1140-1180, y=288 (sol)

### Couches de Parallax

| Couche | Fichier | Vitesse scroll (ratio) | Z |
|--------|---------|----------------------|---|
| Ciel / buildings lointains | `bg_street_far.png` | 0.1 | 0 |
| Bâtiments milieu | `bg_street_mid.png` | 0.4 | 1 |
| Décor proche (murs, poubelles) | `bg_street_near.png` | 0.7 | 2 |
| Sol + obstacles | Tilemap | 1.0 | 3 |

### Tricks Disponibles (12 — cracks street)

1. `ollie` — Ollie
2. `kickflip` — Kickflip
3. `heelflip` — Heelflip
4. `pop_shove_it` — Pop Shove-it
5. `varial_kickflip` — Varial Kickflip
6. `varial_heelflip` — Varial Heelflip
7. `50_50_ledge` — 50-50 on Ledge
8. `noseslide` — Noseslide
9. `boardslide` — Boardslide
10. `50_50_rail` — 50-50 on Rail
11. `manual` — Manual
12. `nose_manual` — Nose Manual

---

## Environnement 2 — Skatepark

### Informations Générales

| Champ | Valeur |
|-------|--------|
| ID | `skatepark` |
| Nom | Skatepark |
| Nom JP | スケートパーク |
| Débloquage | 5 cracks dorées |
| Largeur monde | 1920 px |
| Ambiance | Hall industriel, lumières néon au plafond |
| Musique | `skatepark_indie` |

### Description

Un skatepark couvert dans un ancien entrepôt. Béton poli, ramps colorées, boîtes et rails. La lumière vient de tubes néon accrochés aux poutres. Ambiance concentrée, propice à la technique.

### Layout des Obstacles

```
 0                   480                  960                  1440                 1920
 ├────────────────────┼────────────────────┼────────────────────┼────────────────────┤
 │[QUARTER_L]  [BOX_1]    [MANUAL_PAD]   [BOX_2+RAIL]        [QUARTER_R]           │
 │x:0-120      x:250-400  x:500-620      x:700-900           x:1680-1800            │
 │                                                                                   │
 ├────────────────────────────────────────────────────────────────────────────────────┤ y=288
 │                              GROUND                                                │
 └────────────────────────────────────────────────────────────────────────────────────┘
```

### Détail des Obstacles

| ID | Type | x | y | Largeur | Hauteur | Spécial |
|----|------|---|---|---------|---------|---------|
| `skate_quarter_left` | Ramp (quarter pipe) | 0 | 160 | 120 | 128 | Grindable lip |
| `skate_box_1` | Ledge/Box | 250 | 248 | 150 | 40 | Grindable top + ledge sides |
| `skate_manual_pad` | ManualPad | 500 | 272 | 120 | 16 | Non |
| `skate_box_2` | Ledge/Box | 700 | 240 | 160 | 48 | Grindable top + rail sur dessus |
| `skate_rail_box` | Rail | 730 | 228 | 100 | 6 | Posé sur skate_box_2 |
| `skate_quarter_right` | Ramp (quarter pipe) | 1680 | 160 | 120 | 128 | Grindable lip, orienté droite→gauche |

### Tricks Disponibles (12 — cracks skatepark)

1. `rock_to_fakie` — Rock to Fakie
2. `rock_n_roll` — Rock n' Roll
3. `axle_stall` — Axle Stall
4. `nose_stall` — Nose Stall
5. `5_0_rail` — 5-0 Grind
6. `nosegrind_rail` — Nosegrind
7. `tailslide` — Tailslide
8. `boardslide` — Boardslide (sur box)
9. `smith_grind` — Smith Grind
10. `crooked_grind` — Crooked Grind
11. `feeble_grind` — Feeble Grind
12. `bluntslide` — Bluntslide

---

## Environnement 3 — Rooftop

### Informations Générales

| Champ | Valeur |
|-------|--------|
| ID | `rooftop` |
| Nom | Rooftop |
| Nom JP | 屋上 |
| Débloquage | 17 cracks dorées |
| Largeur monde | 1920 px |
| Ambiance | Toit d'immeuble la nuit, horizon urbain |
| Musique | `rooftop_synthwave` |

### Description

Sommet d'un immeuble de la ville. On voit les lumières de la ville à l'horizon. Des unités de climatisation, des gaines d'aération, des garde-corps en métal. Espace plus dangereux — les bords donnent le vide. Les tricks techniques prennent tout leur sens ici.

### Obstacles Spéciaux

- **Gaps** : zones sans sol entre les sections de toit — chuter = crash mais pas de dommage permanent
- **AC Units** : boîtes métalliques, certaines grindables
- **Ledges de toit** : garde-corps bas

### Layout des Obstacles

```
 0         320         640         960        1280        1600        1920
 ├──────────┼───────────┼───────────┼───────────┼───────────┼───────────┤
 │[ROOF_A]  [GAP_1]    [ROOF_B]   [GAP_2]    [ROOF_C]   [GAP_3]   [ROOF_D]│
 │x:0-280   x:280-360  x:360-640  x:640-720  x:720-1000 x:1000-1080 x:1080+│
 │          (GAP 80px)            (GAP 80px)             (GAP 80px)         │
 │[LEDGE_1]           [RAIL_1]             [AC_1]              [LEDGE_2]   │
 ├──────────────────────────────────────────────────────────────────────────┤ y=288
 └──────────────────────────────────────────────────────────────────────────┘
```

> **Note :** Les gaps sont des zones sans tile ground — le joueur doit les sauter.

### Tricks Disponibles (12 — cracks rooftop)

1. `360_flip` — 360 Flip
2. `hardflip` — Hardflip
3. `inward_heelflip` — Inward Heelflip
4. `varial_heelflip` — Varial Heelflip (répétition, nouveau contexte)
5. `nollie` — Nollie (gap jump)
6. `kickflip` — Kickflip (gap variant — même trick, nouveau crackId)
7. `nosegrind_rail` — Nosegrind on Rail
8. `5_0_rail` — 5-0 on Rail
9. `crooked_grind` — Crooked Grind on Rail
10. `smith_grind` — Smith Grind on Rail
11. `feeble_grind` — Feeble Grind on Rail
12. `impossible` — Impossible (gap landing)

> **Note :** Pour les cracks rooftop, même si le trick ID est identique à street, le `crackId` est différent : `kickflip_rooftop` vs `kickflip_street`.

---

## Environnement 4 — Underground

### Informations Générales

| Champ | Valeur |
|-------|--------|
| ID | `tunnel` |
| Nom | Underground |
| Nom JP | 地下 |
| Débloquage | 29 cracks dorées |
| Largeur monde | 2240 px (plus large) |
| Ambiance | Tunnel béton, lumières industrielles, graffitis |
| Musique | `tunnel_ambient` |

### Description

Un tunnel de métro abandonné, reconverti en spot de skate secret. Le plafond bas force des tricks créatifs. Des câbles électriques pendent, des lumières clignotent. Un half pipe en fond. Les grinds sont longs et techniques sur les rails de tram.

### Obstacles Spéciaux

- **Half Pipe** : section avec half pipe pour lip tricks avancés
- **Rails longs** : rails de guidage de tram, parfaits pour les longs grinds
- **Piliers** : à esquiver (obstacles non grindables qui font crash)

### Tricks Disponibles (12 — cracks tunnel)

1. `nosepick` — Nosepick
2. `blunt_stall` — Blunt Stall
3. `kickturn` — Kickturn (half pipe)
4. `tail_stall` — Tail Stall
5. `nose_stall` — Nose Stall (half pipe)
6. `rock_n_roll` — Rock n' Roll (half pipe)
7. `manual` — Long Manual (même trick, crackId tunnel)
8. `nose_manual` — Long Nose Manual
9. `5_0_stall` — 5-0 Stall
10. `bluntslide` — Bluntslide (sur rails longs)
11. `tailslide` — Tailslide (sur rails longs)
12. `crooked_grind` — Crooked Grind (sur rails longs)

---

## Environnement 5 — Jardin Zen

### Informations Générales

| Champ | Valeur |
|-------|--------|
| ID | `garden` |
| Nom | Jardin Zen |
| Nom JP | 禅庭 |
| Débloquage | 42 cracks dorées |
| Largeur monde | 1920 px |
| Ambiance | Jardin japonais, cerisiers, aurore |
| Musique | `garden_zen` |

### Description

Un jardin japonais traditionnel. Des cerisiers en fleurs, des lanternes en pierre, un pont de bois au-dessus d'un bassin. Les obstacles sont intégrés naturellement : murets de pierre basse grindables, rails en bambou, ponts en bois. L'esthétique contraste avec les autres environnements — ici tout est douceur et maîtrise.

### Obstacles Spéciaux

- **Rails en bambou** : plus fins, moins tolérants (snap range réduit : 16px au lieu de 24px)
- **Pont en bois** : long ledge traversable, grindable
- **Murets de pierre** : ledges bas, angle légèrement incliné

### Tricks Disponibles (12 — cracks garden)

1. `impossible` — Impossible
2. `nollie_kickflip` — Nollie Kickflip
3. `nollie_heelflip` — Nollie Heelflip
4. `fakie_kickflip` — Fakie Kickflip
5. `fakie_heelflip` — Fakie Heelflip
6. `360_flip` — 360 Flip (jardin variant)
7. `inward_heelflip` — Inward Heelflip (jardin variant)
8. `manual_combo_trick` — Manual + Trick combo
9. `nose_manual_combo` — Nose Manual + Trick combo
10. `darkslide` — Darkslide
11. `primoslide` — Primoslide
12. `varial_kickflip` — Varial Kickflip (jardin variant)

---

## Notes d'Implémentation

### Tilemap Format

Chaque environnement a un fichier JSON Tiled : `src/assets/tilemaps/<envId>.json`

Calques obligatoires :
- `background` — décor non-collidable
- `ground` — sol et plateformes (collision statique)
- `objects` — layer d'objets Tiled avec propriétés custom

Propriétés custom des objets dans le calque `objects` :

```json
{
  "name": "street_ledge_1",
  "type": "ledge",
  "properties": [
    { "name": "grindable", "type": "bool", "value": true },
    { "name": "slideType", "type": "string", "value": "ledge" }
  ]
}
```

### Spawn Points

Dans le calque `objects`, un objet de type `spawn` :
```json
{
  "name": "player_spawn",
  "type": "spawn",
  "x": 64,
  "y": 256
}
```

### Environnements et Boucle

Les environnements **ne boucle pas** automatiquement. Le joueur peut aller jusqu'au bord du monde (bounds caméra) et demi-tour. Un indicateur subtil à l'écran montre les bords.
