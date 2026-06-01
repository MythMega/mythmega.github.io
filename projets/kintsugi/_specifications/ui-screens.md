# Écrans UI & Flux de Navigation — Kokoro Game : Kintsugi

---

## 1. Palette de Couleurs UI

| Rôle | Couleur | Hex |
|------|---------|-----|
| Fond principal | Noir profond | `#0a0a0a` |
| Fond secondaire | Noir-bleu | `#0f0f1a` |
| Texte principal | Blanc cassé | `#e8e8d8` |
| Texte secondaire | Gris clair | `#a0a0a0` |
| Accent chaud (or) | Or kintsugi | `#d4a017` |
| Accent brillant | Or lumineux | `#f5c842` |
| Crack grise | Argent | `#8a8a9a` |
| Danger / vide | Rouge torii | `#c0392b` |
| Verrouillé | Gris foncé | `#3a3a4a` |
| Débloqué (vert) | Vert jade | `#2ecc71` |

---

## 2. Typographie

| Usage | Police | Taille |
|-------|--------|--------|
| Titre principal | pixel_font | 24px |
| Sous-titres | pixel_font | 16px |
| Corps de texte | pixel_font | 8px |
| Labels japonais | pixel_font_jp | 12px |
| HUD in-game | pixel_font | 8px |
| Notifications tricks | pixel_font | 12px |

---

## 3. Flux de Navigation

```
┌─────────────────────────────────────────────────────────┐
│                     BootScene                           │
│              (lecture localStorage)                      │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                   PreloadScene                          │
│           [Barre de chargement pixel art]                │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                    MenuScene                            │
│                  [Logo animé]                           │
│               [Appuyer sur ENTRÉE]                      │
│          [Options]   [Réinitialiser]                     │
└─────────────────────────────────────────────────────────┘
                          ↓ ENTRÉE
┌─────────────────────────────────────────────────────────┐
│                    BoardScene                           │
│         [Skateboard kintsugi en grand]                  │
│   [Compteur gold/grey/total]  [Bouton JOUER →]          │
└─────────────────────────────────────────────────────────┘
                          ↓ JOUER
┌─────────────────────────────────────────────────────────┐
│                  EnvSelectScene                         │
│   [Street ✓] [Skatepark 🔒] [Rooftop 🔒] ...            │
└─────────────────────────────────────────────────────────┘
                          ↓ Sélection
┌─────────────────────────────────────────────────────────┐
│              [StreetScene / SkateparkScene / ...]        │
│                 Session de skate libre                   │
│                     ↓ ÉCHAP                             │
└─────────────────────────────────────────────────────────┘
                          ↓
                     BoardScene (retour)
```

---

## 4. BootScene

**Durée :** < 100ms (invisible)

**Actions :**
1. Lire `localStorage['kokoro_kintsugi_save']`
2. Si null → créer l'état initial
3. Transitionner vers `PreloadScene`

**Pas d'affichage.** (fond noir uni)

---

## 5. PreloadScene

**Fond :** noir (`#0a0a0a`)

**Éléments :**
- Logo placeholder en haut (ou simple texte "KOKORO GAME")
- **Barre de progression** au centre : rectangle de 200×8px
  - Fond : gris foncé (`#2a2a3a`)
  - Remplissage : or (`#d4a017`) progressant de gauche à droite
- Texte sous la barre : `"CHARGEMENT... XX%"` (pixel art 8px)

**Assets chargés :**
- Toutes les images (via `manifests/images.json`)
- Tous les sons (via `manifests/audio.json`)
- Polices (via `manifests/fonts.json`)

**Transition :** fondu au noir vers MenuScene (300ms)

---

## 6. MenuScene

**Fond :** `menu_bg.png` (ou fond noir avec léger dégradé radial)

**Layout :**
```
┌────────────────────────────────────────┐
│                                        │
│                                        │
│      ╔══════════════════════╗          │
│      ║  KOKORO GAME         ║          │
│      ║   ✦ KINTSUGI ✦       ║  ← logo │
│      ╚══════════════════════╝          │
│                                        │
│         [ APPUYER SUR ↵ ]             │
│                                        │
│                         [ OPTIONS ]   │
└────────────────────────────────────────┘
```

**Animations :**
- Le logo a un shimmer doré qui traverse lentement (toutes les 3s)
- Le texte "APPUYER SUR ↵" clignote lentement (alpha 1↔0.4, période 1.5s)
- Fond : légères particules flottantes (or très subtil, basse opacité)

**Interactions :**
- `ENTER` / `SPACE` → BoardScene (transition fondu noir 400ms)
- `O` → OptionsOverlay

**OptionsOverlay :**
- Overlay semi-transparent (`rgba(0,0,0,0.8)`)
- Toggles : `[♪] Musique ON/OFF` | `[♦] SFX ON/OFF`
- `ESCAPE` → ferme l'overlay

---

## 7. BoardScene

**Fond :** noir, légère texture de bois (subtile)

**Layout :**
```
┌────────────────────────────────────────┐
│                                        │
│    ┌──────────────────────────────┐   │
│    │                              │   │
│    │   [SKATEBOARD KINTSUGI]      │   │ ← board 288×96px centré
│    │   (avec cracks grey/gold)    │   │
│    │                              │   │
│    └──────────────────────────────┘   │
│                                        │
│    ●●●●●●●●●●●●  12/60 ✦              │ ← progress indicator
│    FRACTURES DORÉES : 7               │
│    FRACTURES GRISES : 5               │
│                                        │
│              [ JOUER → ]              │ ← bouton doré
│                                        │
└────────────────────────────────────────┘
```

**Détails du board :**
- Le `KintsugiBoard` component affiche le board à x3 scale
- Cracks dorées : shimmer animé en boucle
- Au survol d'une crack (mouseenter si mouse disponible) : tooltip avec le nom du trick

**Barre de progression :**
- 60 petits carrés pixelisés (6px × 6px chacun, 2px espacement)
- Gris foncé = absent, Argent = grey, Or = gold
- Organisés en 5 groupes de 12 (un par environnement)

**Interactions :**
- `J` ou clic sur `[JOUER]` → EnvSelectScene
- `ESCAPE` → MenuScene

---

## 8. EnvSelectScene

**Fond :** noir avec grid de points subtile

**Layout :**
```
┌────────────────────────────────────────┐
│     CHOISIR UN ENVIRONNEMENT          │
│                                        │
│  ┌──────┐ ┌──────┐ ┌──────┐          │
│  │[STREET│ │SKATE │ │ROOF  │          │ ← cartes 120×80px
│  │  ✓   │ │ 🔒5✦ │ │🔒17✦ │          │
│  └──────┘ └──────┘ └──────┘          │
│                                        │
│  ┌──────┐ ┌──────┐                    │
│  │TUNNEL│ │ZEN   │                    │
│  │🔒29✦ │ │🔒42✦ │                    │
│  └──────┘ └──────┘                    │
│                                        │
│                    [ ← RETOUR ]       │
└────────────────────────────────────────┘
```

**Cartes d'environnement :**
- **Débloquée :** image thumbnail de l'env (160×90px, affiché en 120×68), nom en dessous
- **Verrouillée :** thumbnail assombri + icône cadenas + `XX ✦ requises`
- Au survol d'une carte verrouillée : affiche le nombre de cracks manquantes

**Interactions :**
- Clic / `ENTER` sur carte débloquée → scène d'environnement correspondante
- Clic sur carte verrouillée : petit shake + son `sfx_menu_select` (feedback)
- `ESCAPE` → BoardScene

---

## 9. HUD In-Game

**Éléments permanents :**

```
┌────────────────────────────────────────────────────────┐
│ [TRICK FEED]                         [MINI BOARD]      │
│ Kickflip ★★                          ████████           │
│ Nosegrind ★★★                        (64×22px)          │
│                                                         │
│                  [JEUX]                                 │
│                                                         │
│                                                         │
│                                                         │
│                                                         │
│ [ENV NAME]                                [ESC=MENU]   │
└────────────────────────────────────────────────────────┘
```

**Trick Feed (haut gauche) :**
- Affiche les 3 derniers tricks tentés/réussis
- Format : `[NOM DU TRICK] [★ difficulté]`
- Couleur or si réussi, gris si raté
- Disparaît après 3 secondes (fade out)
- Nouveau trick = nouvelles lignes s'ajoutent en haut, les anciennes descendent

**Mini Board (haut droit) :**
- Board miniature 64×22px
- Cracks mises à jour en temps réel (flash si nouvelle crack)

**Nom de l'environnement (bas gauche) :**
- En pixel art, 8px, gris discret
- Format : `STREET` ou `ストリート` (alterné)

**Hint clavier (bas droit) :**
- `ESC` : menu — affiché en très discret (opacité 40%)

---

## 10. Écran de Débloquage (Overlay)

S'affiche quand un environnement est débloqué (par-dessus la scène de jeu) :

```
┌────────────────────────────────────────┐
│                                        │
│           ✦ ✦ ✦ ✦ ✦                  │
│                                        │
│      NOUVEL ENVIRONNEMENT              │
│         DÉBLOQUÉ                       │
│                                        │
│      ┌─────────────────┐              │
│      │  [THUMBNAIL]    │              │
│      │                 │              │
│      └─────────────────┘              │
│                                        │
│         JARDIN ZEN                    │
│         禅庭                           │
│                                        │
│           [ CONTINUER ]               │
│                                        │
└────────────────────────────────────────┘
```

**Animation :**
1. Fondu au noir (500ms)
2. Board kintsugi flash (200ms)
3. Étoiles/particules or (600ms)
4. Texte + thumbnail apparaissent (fade in 400ms)
5. `[CONTINUER]` ou auto après 3s

---

## 11. Écran de Fin (Board Complet)

Déclenché quand les 60 cracks sont dorées :

```
┌────────────────────────────────────────┐
│                                        │
│        ╔══════════════════╗           │
│        ║  完 成           ║           │ ← Kansei
│        ║  KOKORO GAME     ║           │
│        ╚══════════════════╝           │
│                                        │
│    [SKATEBOARD ENTIÈREMENT DORÉ]       │
│    (animation de respiration lumineuse)│
│                                        │
│  Chaque fracture est une histoire.    │
│  Chaque or est une victoire.          │
│                                        │
│     [ CONTINUER À SKATER ]           │
│                                        │
└────────────────────────────────────────┘
```

---

## 12. Pause Overlay

Déclenché par `ESCAPE` pendant une session :

```
┌──────────────────────────────────┐
│          PAUSE                   │
│                                  │
│   [ ► REPRENDRE ]                │
│   [   MENU      ]                │
│                                  │
│   ♪ Musique ON    ♦ SFX ON      │
└──────────────────────────────────┘
```

- Fond semi-transparent (`rgba(0,0,0,0.7)`)
- La scène de jeu reste visible en arrière-plan (gelée)
