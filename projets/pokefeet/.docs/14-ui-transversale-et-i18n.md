# 14 — UI transversale et i18n

## 1. Scripts partagés

| Fichier | Rôle | Chargé par |
|---|---|---|
| `js/ui/loader.js` | overlay de chargement, skeletons d'images, préchargement des cosmétiques | toutes les pages sauf `profile`, `prediction`, `integration` |
| `js/ui/footer.js` | footer commun | toutes les pages de jeu |
| `js/i18n/translate.js` | moteur de traduction + cookie | toutes les pages traduites |
| `js/i18n/setup.js` | application des `data-i18n` | idem |
| `js/i18n/language-switcher.js` | bouton FR/EN flottant | idem |
| `js/features/marathon/ui.js` | rendu du Marathon | `pokefeet.html` uniquement |
| `js/features/settings/cosmetics.js` | application des cosmétiques | toutes les pages de jeu |

---

## 2. Loader (`js/ui/loader.js`)

1. Injecte `#page-loader` dans `<html>` immédiatement :
   ```html
   <div class="loader-inner">
     <div class="loader-spinner"></div>
     <div class="loader-logo">PokéFeet</div>
   </div>
   ```
2. `finish()` est appelée sur `window.load` **ou** après 2 500 ms.
3. Avant de masquer : `await Cosmetics.load()` si disponible.
4. `hideLoader()` ajoute `.fade-out`, retire l'élément après 500 ms.
5. `setupImageSkeleton(img)` ajoute `.img-loading` au wrapper `.pokemon-image` jusqu'au `load`/`error`.
6. Un `MutationObserver` surveille les images ajoutées dynamiquement et les changements de `src`.

**Risque** : le timeout de 2,5 s peut masquer le loader avant la fin des fetchs ; les pages doivent gérer leurs propres états vides.

---

## 3. Footer (`js/ui/footer.js`)

Injecte un `<footer>` en bas de `document.body` avec :

- Accueil (`index.html`)
- Données (`data.html`)
- Changelog (`changelog.html`)
- Crédits (`credits.html`)

Les liens utilisent `data-i18n` (`footer.*`). Le style est inline, avec `color: var(--muted)`, opacité 0,5.

---

## 4. Notifications

Chaque module possède sa propre fonction `showNotification`, avec des variantes :

| Contexte | Conteneur | Durée | Couleurs |
|---|---|---|---|
| `js/features/marathon/ui.js` (Marathon) | `#notifications` | 1,8 s | `fail` #491111, `hint` #334155 |
| `js/features/daily/daily.js` | `#notifications` | 1,6 s | idem |
| `js/features/weekly/weekly.js` | `#notifications` | 1,6 s | idem |
| `js/data/data-manager.js` | `#notifications` | 2,2 s | idem |
| `challenge-game-ui.js` | `#notifications` | variable | succès/échec |
| `custom-*` | `#notifications` | 2 s | idem |

Il n'y a **aucun composant partagé** : chaque module recrée un `div.notification`, l'ajoute, puis le retire avec un timeout.

---

## 5. Autocomplete des noms

Deux implémentations :

- `js/features/marathon/game.js` : `#practiceNamesDropdown` + `datalist #namesList` (remplie par `UI.populateNamesList`) ;
- `js/features/daily/daily.js` / `js/features/weekly/weekly.js` : dropdown custom `#namesDropdown` / `#weeklyNamesDropdown`.

Comportement commun :

- filtre par sous-chaîne normalisée (FR ou EN) ;
- limite 40 résultats ;
- navigation `ArrowUp`/`ArrowDown`, `Enter`, `Escape` ;
- `mousedown` sélectionne et soumet ;
- `blur` ferme après 150 ms.

Le `datalist` du Marathon est un héritage : le dropdown custom le double.

---

## 6. Jauges de points

Marathon, Daily et Weekly affichent une jauge verticale :

```html
<div id="practiceAttemptGauge" class="gauge">
  <div class="gauge-fill"></div>
  <div class="gauge-label">+10</div>
</div>
```

- hauteur = `points / 10 * 100 %` ;
- label = `+10`, `+8`, `+6`, `+4`, `+2`, `+0`.

`daily.showAttemptGauge()` et `weekly.showAttemptGauge()` sont définies mais **jamais appelées** (code mort).

---

## 7. Images et retry

- Daily/Weekly : `loadImageWithRetry` (10 tentatives, 1 s).
- Popup d'échec : `loadPopupImage` (compteur indépendant par image).
- Marathon : pas de retry.
- Challenges/custom : pas de retry.
- Loader : skeleton `.img-loading`.

---

## 8. Design system

### 8.1 Feuilles CSS

| Fichier | Lignes | Rôle |
|---|---:|---|
| `styles/main.css` | 813 | design system global, layout, cartes, boutons, formulaires, responsive |
| `styles/cosmetics.css` | 1094 | classes de fonds/boutons, grille de cosmétiques, badges, récompenses |
| `styles/challenges.css` | 598 | pages challenges bonus |
| `styles/text-shadow.css` | 76 | ombres de texte |
| `styles/custom-challenges.css` | 423 | pages custom |

### 8.2 Variables principales

```css
:root {
  --bg: #060c18;
  --card: rgba(10,17,34,0.85);
  --card-solid: #0a1122;
  --accent: #16a34a;
  --accent-bright: #22c55e;
  --accent-glow: rgba(34,197,94,0.38);
  --muted: #d9e1eb;
  --muted-light: #dadcdf;
  --glass: rgba(255,255,255,0.04);
  --glass-border: rgba(255,255,255,0.09);
  --text: #e2eaf8;
  --shadow: 0 8px 32px rgba(0,0,0,0.6);
}
```

- Fond sombre, accents verts.
- Orbes aurora animées en `html::before/after`.
- `body` en flex column, `main#app` centré.
- `bootstrap.min.css` est chargé via CDN sur `stats.html` et `history.html` (grille `row`/`col`), alors que le reste est artisanal : dépendance externe non versionnée localement.

### 8.3 Composants

- `.big-btn`, `.small-btn`, `.secondary`, `.golden`, `.blue`, `.danger` ;
- `.home-card`, `.center-card`, `.game-area` ;
- `.decorations` (orbes) ;
- `.type-badge.t-<type>` ;
- `.dex-grid`, `.dex-entry` ;
- `.reward-card`, `.reward-popup` ;
- `.challenge-card`, `.challenge-tabs` ;
- `.cosmetic-btn`, `.cosmetics-grid` ;
- `.loader-spinner`, `.notification`.

### 8.4 Responsive

- Media queries dans `styles/main.css`, `styles/challenges.css`, `custom-challenges.css`.
- `body` padding 5 px, `main` max-width variable.
- `stats.html` et `history.html` utilisent Bootstrap pour les grilles.

### 8.5 Accessibilité

- `aria-live="polite"` sur `#notifications` (certaines pages).
- `aria-label` sur certains inputs via `data-i18n-attr`.
- Boutons avec `title` pour les icônes.
- Contrastes globalement élevés, mais :
  - pas de focus visible systématique ;
  - `div` cliquables dans l'autocomplete et les cosmétiques (pas de rôle/clavier) ;
  - popups sans `role="dialog"` ni piège de focus ;
  - textes codés en dur non traduits.

---

## 9. i18n

### 9.1 Fichiers

- `translations/fr.json`
- `translations/en.json`

453 feuilles par langue, 25 sections racines. Les deux fichiers ont la même structure.

### 9.2 `Translator` (`js/i18n/translate.js`)

| Fonction | Comportement |
|---|---|
| `init()` | lit le cookie `pokefeet_language`, fetch les deux JSON, stocke dans `translations` |
| `get(keyPath, defaultText)` | parcourt les clés séparées par `.`, retourne `defaultText` si absent |
| `setLanguage(lang)` | `fr`/`en`, écrit le cookie 365 j |
| `getLanguage()` | langue courante |
| `getAvailableLanguages()` | `['fr','en']` |

Fallback : si les fichiers ne chargent pas, `translations` reste vide et tous les `get` retournent le texte par défaut.

### 9.3 Application (`js/i18n/setup.js`)

Sur `DOMContentLoaded` :

1. `await Translator.init()`.
2. `applyTranslations()` :
   - `[data-i18n]` → `textContent = Translator.get(key, textContent)` ;
   - `[data-i18n-attr]` → format `attr:key` ou `attr1:key1|attr2:key2` ;
   - `document.documentElement.lang = langue`.
3. `LanguageSwitcher.init()`.

**Limite** : les éléments ajoutés après ce passage ne sont pas traduits, sauf si le module appelle `applyTranslations()` à nouveau (fait par `js/features/stats/stats.js` et `renderDetailedStats`).

### 9.4 Sélecteur (`js/i18n/language-switcher.js`)

- Crée `#language-switcher-container`, bouton `#language-toggle-btn`, menu `#language-menu`.
- Drapeaux 🇫🇷 / 🇬🇧.
- `changeLanguage(lang)` : `Translator.setLanguage`, mise à jour visuelle, puis **`window.location.reload()`**.
- Fermeture au clic extérieur.
- Styles injectés dynamiquement (`slideUp`).

### 9.5 Textes dynamiques

Les modules utilisent :

```js
const T = (k, f) => typeof Translator !== 'undefined' ? Translator.get(k, f) : f;
```

Certains attendent explicitement que les traductions soient chargées (`weekly.translatorReady`), d'autres non.

### 9.6 Clés et conventions

Namespaces principaux : `common`, `home`, `practice`, `daily`, `weekly`, `challenge`, `challenges`, `custom`, `customCreate`, `customPlay`, `dex`, `stats`, `history`, `data`, `dataManagement`, `dataViewer`, `profile`, `cosmetics`, `reward`, `footer`, `oldDaily`, `migration`, `types`.

Problèmes :

- Textes français codés en dur dans `data_management.html`, `js/features/stats/stats.js` (`Niveau`), `data.html`.
- Pas de pluralisation ni d'interpolation native : les modules font `.replace('{n}', ...)`.
- Les clés manquantes retombent silencieusement sur le français.
- `applyTranslations` écrase le `textContent` : impossible d'avoir du HTML enrichi dans un `data-i18n`.
- Le changement de langue recharge la page et perd l'état non sauvegardé (Daily/Weekly en cours).

---

## 10. Problèmes connus

| Problème | Détail |
|---|---|
| Duplication des notifications | 6 implémentations |
| Duplication de l'autocomplete | 2 implémentations |
| `populateNamesList` no-op | Daily/Weekly |
| `datalist` + dropdown custom | Marathon |
| Bootstrap CDN | dépendance externe, non versionnée |
| `showAttemptGauge` mort | Daily/Weekly |
| Rechargement à chaque changement de langue | perte d'état |
| Textes non traduits | paramètres, niveau, data viewer |
| Accessibilité | popups, div cliquables, focus |

---

## 11. Checklist de test manuel

1. Loader : apparaît, disparaît au load, fallback 2,5 s.
2. Skeletons sur images lentes.
3. Footer sur toutes les pages de jeu.
4. Notifications : succès, échec, indice, durée.
5. Autocomplete Marathon/Daily/Weekly : flèches, Entrée, Échap, souris.
6. Jauges : 10 → 0.
7. Retry d'image Daily/Weekly.
8. FR/EN : bascule, reload, cookie, tous les textes statiques.
9. Textes dynamiques : indices, notifications, partages dans la bonne langue.
10. Attributs traduits (`placeholder`, `aria-label`).
11. Responsive mobile : carte, grille, boutons.
12. Accessibilité clavier de base.
13. `stats.html`/`history.html` : Bootstrap chargé, grilles correctes.
14. Préférences (`js/core/preferences.js`) : les 5 switches Animations / Rotation 3D / Son / Alertes nouveau Pokémon / Notifications sont persistés en cookie (`pk_animations`, `pk_rotate3d`, `pk_sound`, `pk_new_pokemon_alerts`, `pk_notifications`) et s'appliquent immédiatement, y compris après rechargement.
15. Animations d'image (`js/ui/transitions.js`) : fondu sortie → changement de sprite → fondu entrée sur Daily, Weekly, Marathon, Challenge et challenges custom ; plus aucune transition quand les animations sont coupées.
15 bis. Rotation 3D (`js/ui/rotate3d.js`) : glisser sur l'image l'incline jusqu'à `max3DRotate` degrés (`settings/config.json`, 15 par défaut) ; au tactile, seul l'axe horizontal tourne pour laisser le défilement vertical à la page. Coupée par le switch Rotation 3D (`pk_rotate3d`).
16. Sons : `sounds/new-pokemon.mp3`, `positive.mp3`, `negative.mp3` (voir `.docs/sound.txt`) ; un fichier absent ne doit produire aucune erreur bloquante.
