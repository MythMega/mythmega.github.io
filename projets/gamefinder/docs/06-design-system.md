# Design system — vert & argent

## 1. Intention

La direction artistique précédente était néon cyan/magenta/violet. Elle est remplacée
par une palette **vert émeraude & argent métallique** : fonds vert-noir profonds,
accents émeraude lumineux, texte et éléments secondaires argentés, dégradés
métalliques sur les titres. L'ambiance reste technique/rétro-futuriste (grille,
Orbitron, monospace) mais gagne en cohérence et en lisibilité.

## 2. Tokens (`styles/variables.css`)

### Couleurs

| Token | Valeur | Rôle |
|-------|--------|------|
| `--accent` | `#2ee6a6` | vert émeraude principal (bordures, liens, CTA) |
| `--mint` | `#7dffc4` | vert clair (succès, inclusions, focus) |
| `--jade` | `#17b57c` | vert secondaire |
| `--silver` | `#c8d4d0` | argent (exclusions, variantes de boutons) |
| `--pearl` | `#e8f1ed` | argent clair (texte au survol, titres) |
| `--accent-dim` | `#1aa87a` | vert atténué |
| `--silver-dim` | `#8fa39b` | argent atténué |
| `--jade-dark` | `#075c40` | vert profond (scrollbar) |

### Fonds & texte

| Token | Valeur | Rôle |
|-------|--------|------|
| `--bg-dark` | `#040d0a` | fond global |
| `--bg-card` | `rgba(8,24,18,0.78)` | cartes, boîtes de filtres |
| `--bg-elevated` | `rgba(140,160,152,0.06)` | surfaces secondaires |
| `--bg-overlay` | `rgba(0,0,0,0.62)` | overlays |
| `--text-primary` | `#e4efe9` | texte principal |
| `--text-secondary` | `#9db3aa` | texte secondaire |
| `--text-muted` | `#7e948b` | notes, hints (contraste ≈ 6:1) |

### Bordures, lueurs, dégradés

| Token | Valeur |
|-------|--------|
| `--border-accent` | `1px solid rgba(46,230,166,.32)` |
| `--border-silver` | `1px solid rgba(200,212,208,.26)` |
| `--glow-accent` | double halo émeraude |
| `--glow-silver` | double halo argent |
| `--glow-jade` | double halo jade |
| `--grad-metal` | dégradé argent clair → gris-vert → argent |
| `--grad-accent` | dégradé jade → émeraude → argent |

### Typographie

| Token | Police | Usage |
|-------|--------|-------|
| `--font-main` | Orbitron | titres, boutons, badges |
| `--font-body` | Rajdhani | texte courant |
| `--font-mono` | Share Tech Mono | IDs, compteurs, légendes |

Les polices sont chargées dans `app.html` avec `preconnect` (Google Fonts) ; l'ancien
`@import` bloquant dans `base.css` a été supprimé.

### Divers

Rayons `4 / 8 / 16 px`, transitions `0.15 / 0.3 / 0.6 s`, z-index `header 100`,
`dropdown 200`, `modal 300`, `loader 999`.

## 3. Fond et profondeur

- Trois halos radiaux (émeraude en haut, argent à droite, jade en bas) fixés.
- Grille technique de 48 px : lignes horizontales émeraude, verticales argentées,
  atténuée par un masque radial pour ne pas gêner la lecture.
- Cartes en verre : fond translucide, `backdrop-filter: blur(10px)`, bordure émeraude.
- Titres en dégradé métallique (`background-clip: text`) avec une ombre verte légère.

## 4. Composants

### Boutons `.btn-neon`

Base : contour 1 px, fond transparent, texte capitales Orbitron, remplissage animé au
survol (`::before` en `scaleX`). Variantes :

| Classe | Couleur | Usage |
|--------|---------|-------|
| `.btn-neon` | émeraude | action principale, navigation |
| `.btn-neon.silver` | argent | secondaire, annuler, « Suivant » |
| `.btn-neon.jade` | jade | Données / IGDB |
| `.btn-neon.green` / `.mint` | menthe | validation, « À faire » |
| `.btn-neon-cta` | émeraude + pulsation | lancer la roulette |
| `.btn-neon.active` | fond teinté | état actif (listes) |

> Les anciennes classes `.magenta` et `.purple` ont été renommées `.silver` et `.jade`
> dans tout le code. Le nom `.btn-neon` est conservé comme nom de style.

### Pastilles tri-état `.toggle-btn`

| Classe | Apparence |
|--------|-----------|
| `.state-inc` | bordure et texte menthe, fond vert, point lumineux |
| `.state-exc` | fond rouge sombre, bordure et texte rouge, texte barré, hachures diagonales |
| `.state-neutral` | bordure argent très discrète, texte atténué, point creux |
| `[disabled]` | opacité réduite, curseur interdit (thème Erotic verrouillé) |

Le survol renforce la teinte de l'état courant. Le focus clavier est toujours visible
(`outline: 2px solid var(--mint)`).

### Autres

- **Tags** `.tag` : émeraude par défaut, `.platform` argent, `.mode` jade,
  `.theme` menthe.
- **Recherche** : champ en verre, focus avec halo émeraude, dropdown groupé.
- **Loader** : titre Orbitron avec flicker, double barre dégradé jade → émeraude → argent.
- **Sliders** : piste fine, remplissage dégradé, pouces ronds émeraude avec halo.
- **Switchs** : piste argent, actif vert menthe.
- **Popups** : carte vert-noir, bordure argent, lueur argent.
- **Lightbox** : fond noir 92 %, boutons circulaires émeraude.
- **Toasts** : bordure menthe, texte monospace.
- **XP** : notification bordée émeraude en haut à gauche.
- **Pagination** : boutons `.btn-neon` compacts, info monospace.

## 5. Mise en page

- `#app-main` : largeur max 1200 px, padding 40/32 px, centré.
- Grille de filtres : `auto-fill minmax(300px, 1fr)` ; les boîtes `.wide`
  (plateformes, genres, thèmes) occupent 2 colonnes au-dessus de 700 px.
- Grille de listes : `auto-fill minmax(220px, 1fr)`.
- Fiche jeu : `grid 220px 1fr`, une colonne sous 640 px.
- Header sticky, footer en bas via `#app-root { display:flex; flex-direction:column }`.
- Le compteur de facette et la ligne de presets passent à la ligne sous 520 px.

## 6. Mouvement

- `.reveal` : opacité + translation, déclenché par `IntersectionObserver`
  (seuil 0,05–0,1).
- CTA : pulsation de halo sur 3 s.
- Loader : flicker discret.
- `prefers-reduced-motion: reduce` neutralise animations et transitions, et rend les
  éléments `.reveal` immédiatement visibles.

## 7. Accessibilité

- Contraste vérifié sur le fond `#040d0a` : accent 12,2:1, menthe 15,9:1, argent
  12,9:1, texte principal 16,7:1, secondaire 8,9:1, atténué 6,1:1 (AA/AAA).
- Focus visible sur boutons, pastilles, champs, items de dropdown/recherche.
- Libellés `aria-label` sur les sliders et les pastilles (`« Shooter : inclus.
  Cliquer pour exclure. »`), `role="status"` + `aria-live` sur le statut de recherche.
- Le cycle des états est aussi décrit par l'attribut `title`.
- Raccourcis : Ctrl/Shift + clic force l'état ✓ voulu ; Ctrl/Shift + clic droit force
  l'état ✗ banni, avec menu contextuel bloqué sur la pastille.
- Les images distantes ont un `alt` ; les icônes décoratives sont dans des boutons
  libellés.
- Le thème verrouillé est `disabled` (non focusable), avec explication au survol.

## 8. Modifier la DA

1. Changer les tokens dans `styles/variables.css`.
2. Les composants consomment exclusivement ces tokens, sauf quelques `rgba()`
   d'opacité dans `components.css`, `layout.css` et `filters.css` (halos, fonds de
   verre). Pour un changement de teinte global, ajuster ces `rgba()` en cohérence.
3. Les dégradés de titres sont dans `layout.css` (`--grad-metal`, `--grad-accent`).
4. Vérifier les contrastes du nouveau texte atténué (cible ≥ 4,5:1).
