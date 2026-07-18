# Système de Cosmétiques

## Vue d'ensemble

Le système de cosmétiques permet aux utilisateurs de personnaliser l'apparence du site via des fonds d'écran et des styles de boutons. Les cosmétiques peuvent être débloqués en complétant des challenges bonus.

## Architecture

### Fichiers

| Fichier | Rôle |
|---------|------|
| `cosmetics.js` | Logique métier : chargement, application, sélection |
| `cosmetics.css` | Styles CSS des cosmétiques (classes appliquées) |
| `data/cosmetics.json` | Catalogue des cosmétiques disponibles |
| `img/cosmetics/` | Icônes des cosmétiques (images 36x36px recommandé) |

### Structure JSON (`data/cosmetics.json`)

```json
[
    {
        "ID": 1,
        "Type": "Background",
        "Name": "Pride",
        "Value": "cosmetics-pride-bg",
        "File": "background-pride.png",
        "RequiresUnlock": true
    }
]
```

| Champ | Description |
|-------|-------------|
| `ID` | Identifiant unique du cosmétique |
| `Type` | `Background` (fond) ou `Background-Buttons` (boutons) |
| `Name` | Nom affiché du cosmétique |
| `Value` | Classe CSS à appliquer (définie dans `cosmetics.css`) |
| `File` | Nom du fichier image dans `img/cosmetics/` |
| `RequiresUnlock` | `true` = doit être débloqué via un challenge |

## API JavaScript (`Cosmetics`)

### Méthodes principales

```javascript
// Charger les cosmétiques et les appliquer
await Cosmetics.load();

// Réappliquer les cosmétiques (après changement de sélection)
Cosmetics.apply();

// Sélectionner un cosmétique (type: 'Background' | 'Background-Buttons')
Cosmetics.select(type, value);
// value = 'default' pour réinitialiser, ou la classe CSS (ex: 'cosmetics-pride-bg')

// Obtenir les cosmétiques par type
Cosmetics.getByType('Background');
Cosmetics.getByType('Background-Buttons');

// Vérifier si un cosmétique est débloqué
Cosmetics.isUnlocked(cosmeticObject);

// Obtenir la sélection actuelle
Cosmetics.getSelectedBg();  // null ou classe CSS
Cosmetics.getSelectedBtn(); // null ou classe CSS
```

### Cookies

| Cookie | Type | Description |
|--------|------|-------------|
| `pk_cosmetic_bg` | `Background` | Classe CSS du fond sélectionné |
| `pk_cosmetic_btn` | `Background-Buttons` | Classe CSS des boutons sélectionnés |

## Déblocage via Challenges

Les cosmétiques sont débloqués automatiquement lorsqu'un challenge bonus est complété. Dans `data/bonus_challenges.json`, ajoutez une récompense de type `Cosmetic` :

```json
"Rewards": [
    { "TypeReward": "Experience", "Value": 250 },
    { "TypeReward": "Cosmetic", "Value": 1 }
]
```

La `Value` correspond à l'`ID` du cosmétique dans `data/cosmetics.json`.

## Intégration dans les pages

### 1. Ajouter le CSS
```html
<link rel="stylesheet" href="cosmetics.css" />
```

### 2. Ajouter les scripts
```html
<script src="business/challenge-storage.js"></script>
<script src="cosmetics.js"></script>
<script>
    document.addEventListener('DOMContentLoaded', function() {
        if (typeof Cosmetics !== 'undefined') Cosmetics.load();
    });
</script>
```

### 3. Marquer les boutons personnalisables
```html
<a class="big-btn" data-tag="customizables-button" href="...">Bouton</a>
```

Les boutons avec `data-tag="customizables-button"` recevront automatiquement la classe du cosmétique `Background-Buttons` sélectionné.

## Ajouter un nouveau cosmétique

1. **CSS** : Ajouter la classe dans `cosmetics.css`
2. **JSON** : Ajouter l'entrée dans `data/cosmetics.json`
3. **Icône** : Ajouter l'image dans `img/cosmetics/`
4. **Challenge** (optionnel) : Ajouter une récompense `Cosmetic` dans un challenge

### Exemple : Ajouter un fond "Nuit"

```css
/* cosmetics.css */
.cosmetics-night-bg {
    background: linear-gradient(135deg, #0f0c29, #302b63, #24243e);
}
```

```json
// data/cosmetics.json
{
    "ID": 5,
    "Type": "Background",
    "Name": "Nuit Étoilée",
    "Value": "cosmetics-night-bg",
    "File": "night.png",
    "RequiresUnlock": false
}
```

## Interface Utilisateur

Les cosmétiques sont configurables dans **Paramètres → onglet Paramètres** (`data_management.html`).

- **Fond d'écran** : Sélection par grille d'icônes
- **Style des boutons** : Sélection par grille d'icônes
- **Option "Défaut"** : Réinitialise le cosmétique (aucune classe appliquée)
- **Cosmétiques verrouillés** : Affichés avec 🔒 et non cliquables
- **Tooltip** : Au survol, affiche le nom du cosmétique