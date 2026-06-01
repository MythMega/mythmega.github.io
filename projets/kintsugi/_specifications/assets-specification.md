# Spécification des Assets — Kokoro Game : Kintsugi

> Ce document liste tous les assets nécessaires pour le jeu.
> **Les assets sont à créer manuellement par le développeur.** Ce document est le guide de référence pour la création.
> Les fichiers SVG de référence (hitbox) ont déjà été générés dans `medias/images/backgrounds/<env>/hitbox_reference.svg`.

---

## 1. Structure des Dossiers Médias

```
medias/
├── images/
│   ├── sprites/
│   │   ├── skater/
│   │   │   ├── skater_spritesheet.png     ← TOUTES les animations du skater
│   │   │   └── skateboard_spritesheet.png ← Rotations du skateboard seul
│   │   ├── obstacles/
│   │   │   ├── rail.png
│   │   │   ├── ledge.png
│   │   │   ├── ramp_quarter.png
│   │   │   ├── ramp_half.png
│   │   │   ├── stair_3.png
│   │   │   ├── stair_5.png
│   │   │   └── manual_pad.png
│   │   └── particles/
│   │       ├── dust.png
│   │       ├── spark_grind.png
│   │       └── star_landing.png
│   ├── backgrounds/
│   │   ├── street/
│   │   │   ├── hitbox_reference.svg       ← Généré automatiquement
│   │   │   ├── bg_street_far.png
│   │   │   ├── bg_street_mid.png
│   │   │   └── bg_street_near.png
│   │   ├── skatepark/
│   │   │   ├── hitbox_reference.svg
│   │   │   ├── bg_skatepark_far.png
│   │   │   ├── bg_skatepark_mid.png
│   │   │   └── bg_skatepark_near.png
│   │   ├── rooftop/
│   │   │   ├── hitbox_reference.svg
│   │   │   ├── bg_rooftop_far.png
│   │   │   ├── bg_rooftop_mid.png
│   │   │   └── bg_rooftop_near.png
│   │   ├── tunnel/
│   │   │   ├── hitbox_reference.svg
│   │   │   ├── bg_tunnel_far.png
│   │   │   ├── bg_tunnel_mid.png
│   │   │   └── bg_tunnel_near.png
│   │   └── garden/
│   │       ├── hitbox_reference.svg
│   │       ├── bg_garden_far.png
│   │       ├── bg_garden_mid.png
│   │       └── bg_garden_near.png
│   ├── ui/
│   │   ├── board/
│   │   │   ├── board_base.png             ← Silhouette noire 96×32px
│   │   │   └── cracks/
│   │   │       ├── crack_00.png           ← crack #0 (blanc pur pour tint)
│   │   │       ├── crack_01.png
│   │   │       ├── ...
│   │   │       └── crack_59.png
│   │   ├── menu/
│   │   │   ├── logo.png                   ← Logo "Kokoro Game : Kintsugi"
│   │   │   ├── menu_bg.png
│   │   │   ├── btn_play.png
│   │   │   ├── btn_board.png
│   │   │   └── lock_icon.png
│   │   └── hud/
│   │       ├── board_mini.png             ← Mini board 64×22px pour HUD
│   │       ├── trick_feed_bg.png
│   │       └── env_thumbnail_frame.png
│   └── tilesets/
│       ├── street_tileset.png
│       ├── skatepark_tileset.png
│       ├── rooftop_tileset.png
│       ├── tunnel_tileset.png
│       └── garden_tileset.png
├── audio/
│   ├── sfx/
│   │   ├── tricks/
│   │   │   ├── sfx_ollie.wav
│   │   │   ├── sfx_flip.wav
│   │   │   ├── sfx_land_soft.wav
│   │   │   ├── sfx_land_hard.wav
│   │   │   ├── sfx_grind_start.wav
│   │   │   ├── sfx_grind_loop.wav
│   │   │   ├── sfx_grind_end.wav
│   │   │   ├── sfx_manual_start.wav
│   │   │   ├── sfx_manual_loop.wav
│   │   │   └── sfx_crash.wav
│   │   ├── kintsugi/
│   │   │   ├── sfx_crack_appear.wav       ← Crack grise apparaît
│   │   │   ├── sfx_crack_gold.wav         ← Crack devient or
│   │   │   └── sfx_env_unlock.wav         ← Nouvel environnement
│   │   ├── ambient/
│   │   │   ├── amb_street_loop.wav
│   │   │   ├── amb_skatepark_loop.wav
│   │   │   ├── amb_rooftop_loop.wav
│   │   │   ├── amb_tunnel_loop.wav
│   │   │   └── amb_garden_loop.wav
│   │   └── ui/
│   │       ├── sfx_menu_select.wav
│   │       ├── sfx_menu_confirm.wav
│   │       └── sfx_menu_back.wav
│   └── music/
│       ├── menu/
│       │   └── music_menu.mp3
│       └── environments/
│           ├── music_street.mp3
│           ├── music_skatepark.mp3
│           ├── music_rooftop.mp3
│           ├── music_tunnel.mp3
│           └── music_garden.mp3
└── fonts/
    ├── pixel_font.ttf                     ← Police pixel art principale
    └── pixel_font_jp.ttf                  ← Police pixel art avec kanji
```

---

## 2. Sprites — Spécifications Détaillées

### 2.1 Skater Spritesheet (`skater_spritesheet.png`)

- **Taille par frame :** 32 × 48 px
- **Disposition :** grille horizontale (1 rangée par animation)
- **Format :** PNG avec transparence

| Animation | Frames | FPS | Rangée |
|-----------|--------|-----|--------|
| `idle` | 4 | 6 | 0 |
| `push` | 6 | 10 | 1 |
| `rolling` | 4 | 8 | 2 |
| `crouch` | 2 | 8 | 3 |
| `jump_up` | 3 | 10 | 4 |
| `jump_peak` | 1 | — | 5 |
| `landing` | 2 | 10 | 6 |
| `crash_fall` | 5 | 8 | 7 |
| `trick_ollie` | 4 | 10 | 8 |
| `trick_kickflip` | 6 | 12 | 9 |
| `trick_heelflip` | 6 | 12 | 10 |
| `trick_shoveit` | 6 | 12 | 11 |
| `trick_360flip` | 8 | 12 | 12 |
| `trick_hardflip` | 8 | 12 | 13 |
| `trick_inward_heel` | 8 | 12 | 14 |
| `trick_impossible` | 8 | 12 | 15 |
| `grind_50_50` | 4 | 8 | 16 |
| `grind_nosegrind` | 4 | 8 | 17 |
| `grind_5_0` | 4 | 8 | 18 |
| `grind_crooked` | 4 | 8 | 19 |
| `grind_smith` | 4 | 8 | 20 |
| `grind_feeble` | 4 | 8 | 21 |
| `slide_boardslide` | 4 | 8 | 22 |
| `slide_noseslide` | 4 | 8 | 23 |
| `slide_tailslide` | 4 | 8 | 24 |
| `manual` | 3 | 6 | 25 |
| `nose_manual` | 3 | 6 | 26 |
| `lip_stall` | 2 | 4 | 27 |
| `lip_rock` | 3 | 8 | 28 |

**Taille totale spritesheet :** 8 frames max × 32px = 256px wide, 29 rangées × 48px = 1392px tall

> Conseil de création : utiliser Aseprite ou Libresprite. Exporter en PNG spritesheet avec le JSON d'animation (compatible Phaser FrameConfig).

### 2.2 Skateboard Spritesheet (`skateboard_spritesheet.png`)

Le skateboard seul, utilisé pour les animations de flip tricks (séparé du skater).

- **Taille par frame :** 32 × 10 px
- **8 rotations** de flip (kickflip axis : vertical flip)
- **8 rotations** de flip (heelflip axis : vertical flip inverse)
- **8 rotations** de shove-it (rotation horizontale)

---

## 3. Obstacles — Spécifications

### 3.1 Rail (`rail.png`)
- Tile 16 × 8 px
- 3 variants : `rail_left.png` (cap gauche), `rail_mid.png` (répété), `rail_right.png` (cap droit)
- Couleur : métal brossé gris clair, reflet linéaire

### 3.2 Ledge (`ledge.png`)
- Tile 32 × 32 px pour section du dessus (grindable)
- 3 variants : `ledge_left.png`, `ledge_mid.png`, `ledge_right.png`
- Matériau : béton, bord arrondi

### 3.3 Quarter Pipe (`ramp_quarter.png`)
- Sprite 128 × 128 px
- Courbe concave
- Variante miroir (flip horizontal) pour quarter pipe droite→gauche

### 3.4 Half Pipe (`ramp_half.png`)
- Sprite 256 × 128 px
- = 2 quarter pipes avec flat entre les deux

### 3.5 Stair Set 3 (`stair_3.png`)
- Sprite 120 × 36 px
- 3 marches de 40 × 12 px chacune

### 3.6 Stair Set 5 (`stair_5.png`)
- Sprite 200 × 60 px
- 5 marches de 40 × 12 px chacune

### 3.7 Manual Pad (`manual_pad.png`)
- Sprite 100 × 20 px
- Surface plate surélevée, coins arrondis

---

## 4. Backgrounds — Spécifications

### Couches Parallax (par environnement)

Chaque environnement a 3 couches de background :

| Couche | Largeur | Hauteur | Détails |
|--------|---------|---------|---------|
| `far` (lointain) | 640 px (tile-repeat) | 360 px | Ciel + éléments très lointains |
| `mid` (milieu) | 1280 px | 360 px | Bâtiments / structures moyennes |
| `near` (proche) | 1920 px | 360 px | Décor de premier plan (murs, objets) |

> Les couches `far` et `mid` peuvent être répétées horizontalement (`setScrollFactor`).

### Palette par Environnement

| Env | Tons dominants |
|-----|----------------|
| Street | Noir, anthracite, orange (lampadaires), rouge/bleu (néons) |
| Skatepark | Gris béton, blanc, accents de couleur (néons colorés) |
| Rooftop | Bleu nuit, noir, lumières de ville (jaune/orange lointain) |
| Tunnel | Gris foncé, marron rouille, jaune (ampoules) |
| Garden | Vert tendre, rose (cerisiers), marron (bois), bleu aube |

---

## 5. UI Board — Spécifications Cracks

### Board Base (`board_base.png`)
- 96 × 32 px
- Silhouette de skateboard (nose + body + tail + trucks + roues)
- Tout noir opaque, fond transparent
- Style : pixel art, détails minimalistes

### Cracks Individuelles (`cracks/crack_XX.png`)

- **60 fichiers** (crack_00.png à crack_59.png)
- Chaque fichier : **96 × 32 px** (même taille que board_base)
- La crack est tracée en **blanc pur** (#FFFFFF) sur fond transparent
- Les autres pixels sont transparents
- En jeu, Phaser applique une tint : grey (`0x8a8a9a`) ou gold (`0xd4a017`)
- Chaque crack est unique et positionnée dans la zone correspondant à son environnement

**Zones sur le board (96px wide) :**
```
Street  : x 0–19  (20px)   ← côté nose
Skatepark: x 20–39 (20px)
Rooftop  : x 40–59 (20px)  ← centre
Tunnel   : x 60–79 (20px)
Garden   : x 80–95 (16px)  ← côté tail
```

---

## 6. Tilesets — Spécifications

### Format
- 128 × 128 px minimum (8×8 tiles de 16×16)
- PNG avec transparence
- Utilisé avec Tiled Map Editor

### Tiles Nécessaires par Environnement

**street_tileset.png :**
- Sol (asphalte) — variations (craquelures, lignes blanches)
- Mur de fond
- Bordure de trottoir
- Grille d'égout

**skatepark_tileset.png :**
- Sol béton poli
- Mur de fond (mur industriel)
- Lignes de course

**rooftop_tileset.png :**
- Revêtement de toit (membrane)
- Garde-corps (bas de la tuile)

**tunnel_tileset.png :**
- Paroi tunnel (béton)
- Sol tunnel
- Rails de tram (décor)

**garden_tileset.png :**
- Herbe / gravier japonais
- Dalles de pierre
- Bord de bassin

---

## 7. Particules — Spécifications

### `dust.png` — Poussière (landing)
- 4 × 4 px
- Blanc / gris clair
- 6 frames d'animation (spritesheet 24×4)

### `spark_grind.png` — Étincelles (grind)
- 4 × 4 px
- Jaune / orange
- 4 frames

### `star_landing.png` — Étoiles (réussite trick)
- 8 × 8 px
- Or (#d4a017)
- 5 frames

---

## 8. Logo UI (`logo.png`)

- **Dimensions :** 320 × 64 px
- **Contenu :** "KOKORO GAME" en pixel art (ligne 1) + "KINTSUGI" en plus grand / doré (ligne 2)
- **Style :** Blanc sur transparent, avec accents dorés sur "KINTSUGI"

---

## 9. Police (`fonts/`)

### `pixel_font.ttf`
- Police bitmap style 8-bit
- Tailles recommandées : 8px, 16px, 24px (multiples de 8)
- Doit contenir : A-Z, a-z, 0-9, ponctuation courante
- Alternative libre : **Press Start 2P** (Google Fonts)

### `pixel_font_jp.ttf`
- Police supportant les hiragana, katakana et kanji de base
- Utilisée pour les noms japonais des environnements, texte de fin
- Alternative : **DotGothic16** (Google Fonts — disponible en license OFL)

---

## 10. Audio — Spécifications Techniques

| Type | Format | Bitrate / Sample Rate |
|------|--------|-----------------------|
| Musique | MP3 (+ OGG fallback) | 128kbps / 44100Hz |
| SFX courts | WAV / OGG | 16-bit / 44100Hz |
| Ambiances (loop) | OGG | 128kbps / 44100Hz, bouclage propre |

### Durées Indicatives

| Fichier | Durée | Boucle |
|---------|-------|--------|
| `music_menu.mp3` | 2–4 min | Oui |
| `music_street.mp3` | 3–5 min | Oui |
| `sfx_ollie.wav` | 0.2s | Non |
| `sfx_flip.wav` | 0.3s | Non |
| `sfx_grind_loop.wav` | 0.5s | Oui |
| `sfx_land_soft.wav` | 0.3s | Non |
| `sfx_crash.wav` | 0.5s | Non |
| `sfx_crack_gold.wav` | 1.2s | Non |
| `amb_street_loop.wav` | 10–30s | Oui |
