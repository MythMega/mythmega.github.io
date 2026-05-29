# Système de Traduction Multilingue - PokéFeet

## 🇫🇷 / 🇬🇧 Documentation

Ce document explique comment utiliser et étendre le système de traduction multilingue pour PokéFeet.

## Structure des fichiers

```
beta/
├── index.html
├── daily.html
├── pokefeet.html
├── history.html
├── pied-dex.html
├── data_management.html
├── old_daily.html
├── translate.js              ← Moteur de traduction
├── language-switcher.js      ← Bouton flottant
├── i18n-setup.js            ← Initialisation
└── translations/
    ├── fr.json              ← Traductions français
    └── en.json              ← Traductions anglais
```

## Comment ça marche

### 1. Initialisation
À chaque chargement de page:
1. `translate.js` est chargé en premier
2. `language-switcher.js` ajoute son interface
3. `i18n-setup.js` appelle `Translator.init()`
4. Les traductions JSON sont chargées depuis `translations/`
5. La langue est restaurée depuis le cookie `pokefeet_language`
6. Les éléments avec `data-i18n` sont traduits
7. Le bouton flottant est initialisé

### 2. Traduire un élément HTML

Utilisez l'attribut `data-i18n` avec la clé de traduction:

```html
<!-- Texte simple -->
<h1 data-i18n="home.title">PokéPied</h1>

<!-- Attributs (placeholder, title, etc) -->
<input data-i18n-attr="placeholder:daily.placeholder" placeholder="Tapez le nom FR ou EN" />

<!-- Label + checkbox -->
<label>
    <input type="checkbox" />
    <span data-i18n="dex.showFound">Afficher que obtenu</span>
</label>
```

### 3. Traduire du texte généré en JavaScript

Utilisez `Translator.get()`:

```javascript
// Dans game.js, ui.js, daily.js, etc.
const message = Translator.get('daily.invalidName', 'Nom invalide');
UI.showNotification(message, 'fail');

// Avec valeurs dynamiques
const pts = 10;
const msg = Translator.get('practice.correctAnswer', 'Réponse correcte = +') + pts + ' ' + 
            Translator.get('practice.pointsReward', 'points');
```

### 4. Ajouter une nouvelle traduction

1. Ouvrez `translations/fr.json`:
```json
"mySection": {
  "myKey": "Texte français"
}
```

2. Ouvrez `translations/en.json`:
```json
"mySection": {
  "myKey": "English text"
}
```

3. Utilisez la clé dans le HTML ou JavaScript:
```html
<button data-i18n="mySection.myKey">Texte français</button>
```

## Clés de traduction disponibles

### Section `common`
- `backHome` - Bouton retour à l'accueil
- `hints` - Titre des indices
- `score` - Score
- `loading` - Chargement

### Section `home`
- `title` - Titre principal
- `chooseMode` - Choisissez un mode
- `dailyChallenge` - Daily challenge
- `records` - Records
- `oldDaily` - Old Daily
- `saveLoad` - Save/Load
- `practice` - Practice ∞
- `pokedex` - Pokedex
- `modeDesc` - Description mode

### Section `daily` / `practice`
- `title` - Titre de la page
- `includes` - Description des générations
- `score` - Score
- `progress` - Progression
- `generation`, `index`, `type1`, `type2` - Labels
- `placeholder` - Placeholder input
- `submit`, `skip`, `next` - Boutons
- `invalidName` - Nom invalide
- `alreadyTried` - Déjà essayé
- `correctAnswer`, `pointsReward` - Messages points
- ... et d'autres

### Section `dex`
- `title` - Titre du Dex
- `progress` - Progression
- `search` - Placeholder recherche
- `showFound`, `showNotFound` - Labels filtres
- ... et d'autres

### Section `dataManagement`
- `title` - Titre
- `exportBtn`, `importFile` - Boutons
- `deleteBest`, `deleteDaily` - Actions suppression
- ... et d'autres

## Cookie de langue

La langue sélectionnée est stockée dans un cookie:
- **Nom du cookie:** `pokefeet_language`
- **Valeur:** `'fr'` ou `'en'`
- **Expiration:** 365 jours
- **Portée:** Path=/

## Bouton flottant

Le bouton flottant de changement de langue:
- ✅ Positionné en bas à droite (fixed)
- 🇫🇷 Affiche emoji drapeau (FR ou GB)
- 📱 Responsive sur mobile
- 🎨 Utilise les couleurs CSS var(--accent, --card, etc)
- ⌨️ Menu déroulant avec animation

## Améliorations futures

- [ ] Traduire les messages dans `data.js` (export/import)
- [ ] Traduire les labels dynamiques dans `Dex-ui.js`
- [ ] Ajouter support pour plus de langues (ES, IT, DE, etc)
- [ ] Pluralisation intelligente pour les compteurs
- [ ] Traduction des titres des pages <title>
- [ ] Export des traductions manquantes via console
- [ ] Cache amélioré pour le chargement des JSON

## Dépannage

**Les traductions n'apparaissent pas:**
1. Vérifiez que `translate.js` est chargé en premier
2. Vérifiez que les fichiers JSON sont accessibles (`/beta/translations/fr.json`)
3. Vérifiez la console pour les erreurs
4. Vérifiez que l'attribut `data-i18n` est correct (chemin/clé)

**Le bouton flottant n'apparaît pas:**
1. Vérifiez que `language-switcher.js` est chargé
2. Vérifiez que le DOM est chargé avant `LanguageSwitcher.init()`
3. Vérifiez la console pour les erreurs JavaScript

**Langue ne persiste pas:**
1. Vérifiez que les cookies sont activés
2. Vérifiez que le cookie `pokefeet_language` est créé
3. Vérifiez l'expiration du cookie (365 jours)

## API Translator

```javascript
// Initialiser (appelé automatiquement par i18n-setup.js)
await Translator.init()

// Obtenir une traduction
Translator.get('section.key', 'Texte par défaut')

// Changer la langue
Translator.setLanguage('en')  // 'fr' ou 'en'

// Obtenir la langue courante
Translator.getLanguage()

// Obtenir les langues disponibles
Translator.getAvailableLanguages()  // ['fr', 'en']
```

## Notes techniques

- Les traductions sont chargées via `fetch()` (asynchrone)
- Le système utilise `textContent` pour éviter les problèmes XSS
- Les attributs HTML utilisent `setAttribute()`
- Les cookies utilisent `SameSite=Lax` pour la sécurité
- Le système est compatible avec tous les navigateurs modernes
- Pas de dépendances externes (vanilla JavaScript)
