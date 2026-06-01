# Système de Progression Kintsugi — Kokoro Game : Kintsugi

---

## 1. Concept

Le kintsugi (金継ぎ) est l'art japonais de réparer la poterie brisée avec de la laque mélangée à de la poudre d'or. Les fractures ne sont pas cachées — elles sont mises en valeur. L'objet réparé est plus beau qu'avant sa brisure.

Dans le jeu :
- Le **skateboard** est l'objet brisé
- Les **fractures grises** sont les tentatives (l'échec visible)
- Les **fractures dorées** sont les maîtrises (l'échec transformé en or)

**Le board ne peut que devenir plus beau. Il n'y a aucun recul possible.**

---

## 2. Structure du Board Kintsugi

### Dimensions

- Sprite du board : **96 × 32 px** (nose à tail)
- Affiché en grand dans la BoardScene : **288 × 96 px** (×3)
- Affiché en miniature HUD in-game : **64 × 22 px** (×0.67)

### Zones du Board

Le board est divisé en **5 zones**, une par environnement, chacune avec **12 positions de cracks** :

```
 NOSE                                                    TAIL
 ┌──────────────────────────────────────────────────────────┐
 │  [ZONE STREET] [ZONE SKATE] [ZONE ROOF] [ZONE TUNNEL] [ZEN] │
 │  12 cracks     12 cracks    12 cracks   12 cracks     12  │
 └──────────────────────────────────────────────────────────┘
  0              24             48            72            96
```

Chaque zone occupe un espace visuel distinct sur la silhouette du board.

### Positions des 60 Cracks

Les cracks sont numérotées de 0 à 59. Leur position visuelle sur le board est fixe.

| Crack # | Zone | crackId | État Initial |
|---------|------|---------|-------------|
| 0–11 | Street (nose side) | `ollie_street` … `nose_manual_street` | `absent` |
| 12–23 | Skatepark | `rock_to_fakie_skatepark` … `bluntslide_skatepark` | `absent` |
| 24–35 | Rooftop | `360_flip_rooftop` … `impossible_rooftop` | `absent` |
| 36–47 | Underground | `nosepick_tunnel` … `crooked_grind_tunnel` | `absent` |
| 48–59 | Jardin Zen | `impossible_garden` … `varial_kickflip_garden` | `absent` |

---

## 3. Mapping Complet Crack ↔ Trick

### Zone Street (cracks 0–11)

| # | crackId | Trick | Difficulté |
|---|---------|-------|-----------|
| 0 | `ollie_street` | Ollie | ★☆☆☆☆ |
| 1 | `kickflip_street` | Kickflip | ★★☆☆☆ |
| 2 | `heelflip_street` | Heelflip | ★★☆☆☆ |
| 3 | `pop_shove_it_street` | Pop Shove-it | ★★☆☆☆ |
| 4 | `varial_kickflip_street` | Varial Kickflip | ★★★☆☆ |
| 5 | `varial_heelflip_street` | Varial Heelflip | ★★★☆☆ |
| 6 | `50_50_ledge_street` | 50-50 Ledge | ★★☆☆☆ |
| 7 | `noseslide_street` | Noseslide | ★★★☆☆ |
| 8 | `boardslide_street` | Boardslide | ★★★☆☆ |
| 9 | `50_50_rail_street` | 50-50 Rail | ★★☆☆☆ |
| 10 | `manual_street` | Manual | ★★☆☆☆ |
| 11 | `nose_manual_street` | Nose Manual | ★★☆☆☆ |

### Zone Skatepark (cracks 12–23)

| # | crackId | Trick | Difficulté |
|---|---------|-------|-----------|
| 12 | `rock_to_fakie_skatepark` | Rock to Fakie | ★★☆☆☆ |
| 13 | `rock_n_roll_skatepark` | Rock n' Roll | ★★★☆☆ |
| 14 | `axle_stall_skatepark` | Axle Stall | ★★☆☆☆ |
| 15 | `nose_stall_skatepark` | Nose Stall | ★★★☆☆ |
| 16 | `5_0_rail_skatepark` | 5-0 Grind | ★★★☆☆ |
| 17 | `nosegrind_rail_skatepark` | Nosegrind | ★★★☆☆ |
| 18 | `tailslide_skatepark` | Tailslide | ★★★☆☆ |
| 19 | `boardslide_box_skatepark` | Boardslide (box) | ★★★☆☆ |
| 20 | `smith_grind_skatepark` | Smith Grind | ★★★★☆ |
| 21 | `crooked_grind_skatepark` | Crooked Grind | ★★★☆☆ |
| 22 | `feeble_grind_skatepark` | Feeble Grind | ★★★★☆ |
| 23 | `bluntslide_skatepark` | Bluntslide | ★★★★☆ |

### Zone Rooftop (cracks 24–35)

| # | crackId | Trick | Difficulté |
|---|---------|-------|-----------|
| 24 | `360_flip_rooftop` | 360 Flip | ★★★★☆ |
| 25 | `hardflip_rooftop` | Hardflip | ★★★★☆ |
| 26 | `inward_heelflip_rooftop` | Inward Heelflip | ★★★★☆ |
| 27 | `varial_heelflip_rooftop` | Varial Heelflip | ★★★☆☆ |
| 28 | `nollie_rooftop` | Nollie | ★★★☆☆ |
| 29 | `kickflip_gap_rooftop` | Kickflip (gap) | ★★★☆☆ |
| 30 | `nosegrind_rail_rooftop` | Nosegrind on Rail | ★★★★☆ |
| 31 | `5_0_rail_rooftop` | 5-0 on Rail | ★★★★☆ |
| 32 | `crooked_grind_rooftop` | Crooked Grind | ★★★★☆ |
| 33 | `smith_grind_rooftop` | Smith Grind | ★★★★☆ |
| 34 | `feeble_grind_rooftop` | Feeble Grind | ★★★★☆ |
| 35 | `impossible_rooftop` | Impossible | ★★★★★ |

### Zone Underground (cracks 36–47)

| # | crackId | Trick | Difficulté |
|---|---------|-------|-----------|
| 36 | `nosepick_tunnel` | Nosepick | ★★★★☆ |
| 37 | `blunt_stall_tunnel` | Blunt Stall | ★★★★☆ |
| 38 | `kickturn_tunnel` | Kickturn | ★☆☆☆☆ |
| 39 | `tail_stall_tunnel` | Tail Stall | ★★★☆☆ |
| 40 | `nose_stall_tunnel` | Nose Stall (half pipe) | ★★★☆☆ |
| 41 | `rock_n_roll_tunnel` | Rock n' Roll | ★★★☆☆ |
| 42 | `manual_tunnel` | Long Manual | ★★★☆☆ |
| 43 | `nose_manual_tunnel` | Long Nose Manual | ★★★☆☆ |
| 44 | `5_0_stall_tunnel` | 5-0 Stall | ★★★☆☆ |
| 45 | `bluntslide_tunnel` | Bluntslide | ★★★★☆ |
| 46 | `tailslide_tunnel` | Tailslide | ★★★★☆ |
| 47 | `crooked_grind_tunnel` | Crooked Grind | ★★★★☆ |

### Zone Jardin Zen (cracks 48–59)

| # | crackId | Trick | Difficulté |
|---|---------|-------|-----------|
| 48 | `impossible_garden` | Impossible | ★★★★★ |
| 49 | `nollie_kickflip_garden` | Nollie Kickflip | ★★★☆☆ |
| 50 | `nollie_heelflip_garden` | Nollie Heelflip | ★★★☆☆ |
| 51 | `fakie_kickflip_garden` | Fakie Kickflip | ★★★☆☆ |
| 52 | `fakie_heelflip_garden` | Fakie Heelflip | ★★★☆☆ |
| 53 | `360_flip_garden` | 360 Flip | ★★★★☆ |
| 54 | `inward_heelflip_garden` | Inward Heelflip | ★★★★☆ |
| 55 | `manual_combo_garden` | Manual + Trick combo | ★★★★☆ |
| 56 | `nose_manual_combo_garden` | Nose Manual + Trick | ★★★★☆ |
| 57 | `darkslide_garden` | Darkslide | ★★★★★ |
| 58 | `primoslide_garden` | Primoslide | ★★★★★ |
| 59 | `varial_kickflip_garden` | Varial Kickflip | ★★★☆☆ |

---

## 4. Seuils de Débloquage

| Cracks dorées | Événement |
|---------------|-----------|
| 0 | Street disponible (défaut) |
| 5 | **Skatepark débloqué** |
| 17 | **Rooftop débloqué** |
| 29 | **Underground débloqué** |
| 42 | **Jardin Zen débloqué** |
| 60 | **Fin de jeu** — Board entièrement doré |

---

## 5. États d'une Crack

```
ABSENT ──[première tentative]──→ GREY ──[trick réussi]──→ GOLD
```

- **ABSENT** : Le trick n'a jamais été tenté. Pas de crack visible.
- **GREY** (gris argent `#8a8a9a`) : Le trick a été tenté au moins une fois. Crack visible, mate.
- **GOLD** (or kintsugi `#d4a017`) : Le trick a été réussi. Crack brillante, avec glow subtil.

> Il n'y a **aucun retour en arrière** possible. Une crack grise ne peut pas redevenir absente. Une crack dorée ne peut pas redevenir grise.

---

## 6. Animations de Crack

### Transition ABSENT → GREY

Déclenchée lors de la **première tentative** d'un trick :

1. Flash blanc sur le board (50ms)
2. La crack apparaît progressivement (fade-in en gris, 300ms)
3. Son : `sfx_crack_appear` (sourd, mat)
4. La crack "vibre" légèrement (tween scale 1.0→1.2→1.0, 200ms)

### Transition GREY → GOLD

Déclenchée lors de la **réussite** du trick :

1. Particules or émanent de la crack (burst de 8-12 particules)
2. La crack passe progressivement du gris à l'or (color tween, 600ms)
3. Glow doré autour de la crack (bloom effect ou glow shader)
4. Son : `sfx_crack_gold` (cristallin, résonant, harmonique)
5. Si un seuil de débloquage est atteint → animation spéciale (voir §7)

### Animation d'ensemble

Dans la **BoardScene**, quand le joueur regarde son board :
- Les cracks dorées ont un **shimmer** animé en boucle (highlight qui glisse)
- Les cracks grises sont statiques

---

## 7. Séquence de Débloquage d'Environnement

Quand un seuil est atteint (en fin de session ou en temps réel) :

1. **Fade to black** progressif (500ms)
2. Transition vers la **BoardScene**
3. Affichage du board avec la nouvelle crack dorée
4. **Flash doré** sur le board entier (200ms)
5. Texte d'annonce (pixel art) : `「新しい場所が解放された」` + traduction
6. Miniature de l'environnement débloqué qui apparaît
7. Son : `sfx_unlock` + musique brève
8. Bouton `[Continuer]` ou automatique après 3s
9. Retour à `EnvSelectScene` avec le nouvel environnement disponible

---

## 8. État de Sauvegarde

Stocké dans `localStorage` avec la clé `kokoro_kintsugi_save` :

```json
{
  "version": "1.0",
  "cracks": {
    "ollie_street": "gold",
    "kickflip_street": "grey",
    "heelflip_street": "absent",
    "...": "..."
  },
  "unlockedEnvs": ["street", "skatepark"],
  "lastEnv": "street",
  "stats": {
    "totalAttempts": 142,
    "totalLandings": 38,
    "goldCount": 7,
    "greyCount": 12
  }
}
```

### Chargement

Au démarrage (`BootScene`) :
1. Lire le localStorage
2. Si `null` → créer état initial (toutes cracks `absent`, seul `street` unlocked)
3. Si existant → `KintsugiSystem.deserialize(data.cracks)`
4. Vérifier `version` — si version < actuelle, appliquer migration

### Sauvegarde

Automatique à chaque changement d'état d'une crack, via `SaveManager.save()`.

---

## 9. Fin de Jeu

Quand les 60 cracks sont dorées :

1. Séquence spéciale : le board entier brille d'or
2. Animation : les cracks forment un réseau lumineux qui pulse
3. Texte : `「完成」` (Kansei — Complétude)
4. Musique spéciale de fin
5. Le board reste visible, entièrement doré, comme trophée permanent
6. Le joueur peut continuer à skater librement dans tous les environnements

---

## 10. KintsugiBoard UI Component

`src/ui/KintsugiBoard.js` est responsable du rendu du board.

### Méthodes

```javascript
class KintsugiBoard {
  constructor(scene, x, y, scale = 1)
  render(crackStates)           // dessine le board + toutes les cracks
  animateCrackGrey(crackId)     // joue l'animation absent→grey
  animateCrackGold(crackId)     // joue l'animation grey→gold
  updateShimmer(time)           // appelé dans update(), anime les cracks gold
  getProgress()                 // { gold: N, grey: N, absent: N, total: 60 }
}
```

### Assets nécessaires

- `board_base.png` — silhouette noire du skateboard (96×32px)
- `cracks/crack_00.png` à `cracks/crack_59.png` — chaque crack individuelle en grey
- `cracks/crack_gold_00.png` à `cracks/crack_gold_59.png` — idem en gold
- OU utiliser une tint/shader dynamique pour éviter les 120 fichiers

**Alternative optimisée :** Un seul sprite par crack (en blanc pur), coloré dynamiquement par Phaser :
```javascript
crack.setTint(0x8a8a9a); // grey
crack.setTint(0xd4a017); // gold
```
Cette approche réduit les assets à **61 images** (board + 60 cracks en niveaux de gris).
