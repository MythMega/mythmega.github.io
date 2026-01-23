# Système de Redeem de Codes - Documentation

## 📋 Vue d'ensemble

Un système complet de redeem de codes promotionnels a été implémenté pour le jeu Pokegg. Les codes permettent aux joueurs d'obtenir des récompenses (Pokémon, Pokédollars, objets) avec gestion de validité et d'unicité.

## 📁 Fichiers créés/modifiés

### 1. **redeem.html** - Page de redeem
- Navigation intégrée au design du jeu
- Champ de saisie pour entrer les codes
- Affichage du message de résultat avec couleurs différentes
- Modal de récompenses (catégorisée)
- Responsive et compatible mode sombre

### 2. **scripts/entity/code.js** - Classe Code
```javascript
class Code {
  - code: string (le code à entrer)
  - isUnique: boolean (peut être réutilisé ou non)
  - pokes: array (Pokémon à recevoir)
  - money: number (Pokédollars à recevoir)
  - items: array (Objets à recevoir)
  - expiration: Date (date d'expiration ou null)
  
  Methods:
  - isExpired(): boolean
  - getRewards(): object
  - hasBeenUsed(): boolean
  - markAsUsed(): void
}
```

### 3. **scripts/business/code.js** - Manager de codes
`class CodeManager`
- **loadCodes()** : Charge les codes depuis codes.json
- **findCode(codeString)** : Trouve un code
- **redeemCode(codeString)** : Valide et applique les récompenses
- **applyRewards(code)** : Ajoute les récompenses au jeu
- **getStatusMessage(status)** : Retourne le message localisé

Validations implémentées :
- ✅ Code invalide
- ✅ Code expiré
- ✅ Code déjà utilisé
- ✅ Codes uniques sauvegardés en localStorage

### 4. **scripts/ui/code_ui.js** - Interface utilisateur
`class CodeUI`
- **handleRedeem()** : Gère la saisie du code
- **showRewardsModal(rewards)** : Affiche la popup de récompenses
- **buildRewardSection()** : Construit la section Pokémon
- **buildMoneySection()** : Construit la section Pokédollars
- **buildItemsSection()** : Construit la section Objets
- Support pour sprites adaptés aux options du jeu
- Traductions en temps réel

### 5. **langs/en.json & langs/fr.json** - Traductions
Clés ajoutées :
- `redeem` : "Redeem Code" / "Utiliser un Code"
- `enter_code` : "Enter a code" / "Entrez un code"
- `redeem_button` : "Redeem" / "Utiliser"
- `code_success` : "Code redeemed successfully!" / "Code utilisé avec succès !"
- `code_invalid` : "Invalid code" / "Code invalide"
- `code_expired` : "Code expired" / "Code expiré"
- `code_already_used` : "Code already used" / "Code déjà utilisé"
- `rewards` : "Rewards" / "Récompenses"
- `pokemon` : "Pokémon" / "Pokémon"
- `money` : "Money" / "Pokédollars"
- `items` : "Items" / "Objets"

### 6. **style/styles.css** - Styles
Sections CSS ajoutées :
- `.redeem-container` : Conteneur principal
- `.code-section` : Section de saisie
- `.code-input-wrapper` : Wrapper pour l'input
- `.input-group` : Groupe input + bouton
- `.code-input` : Champ de saisie
- `.redeem-button` : Bouton de redemption
- `.code-status` : Message de statut (succès/erreur)
- `.rewards-modal` : Modal de récompenses
- `.reward-section` : Section de récompense
- `.reward-item` : Élément de récompense
- Mode sombre supporté pour tous les éléments

## 🎮 Fonctionnalités

### Gestion des codes (codes.json)
Structure JSON :
```json
{
  "Code": "EXAMPLE123",
  "IsUnique": true,
  "Pokes": [{"Index": "370", "Count": 3}],
  "Money": 1000,
  "Items": [{"Name": "Uncommon Egg", "Count": 5}],
  "Expiration": "2026-04-12" // null = pas d'expiration
}
```

### Flux de redemption
1. Joueur entre un code
2. Validation :
   - Vérifie l'existence
   - Vérifie l'expiration
   - Vérifie l'unicité (si applicable)
3. Si valide : Application des récompenses
4. Sauvegarde automatique
5. Affichage de la popup de récompenses

### Récompenses affichées
La popup affiche 3 sections (si applicable) :
- **Pokémon** : Sprite + Nom (langue) + Quantité
- **Pokédollars** : Quantité formatée
- **Objets** : Image + Nom + Quantité

Chaque élément s'affiche en liste avec séparation visuelle.

## 🔄 Intégration système

### Sauvegarde
- Codes uniques utilisés sauvegardés en localStorage (`usedCodes`)
- Récompenses sauvegardées via le système existant :
  - `inventoryManager.addBalance()` pour l'argent
  - `inventoryManager.addItem()` pour les objets
  - `gameManager.caughtPokemon` pour les Pokémon
  - `dataLoader.saveAllGameData()` pour persister

### Traductions
- Utilise le système `window.i18n()` si disponible
- Fallback sur `window.currentLanguage`
- Support EN/FR

### Sprites Pokémon
- Respecte le paramètre `optionsManager.getSpriteVersion()`
- Supporte Home (3D), 5G Static (BW), 5G Anim (BW2)
- Fallback sur PokeAPI si nécessaire

## 🌙 Mode sombre
Tous les éléments supportent le mode sombre via la classe `html.dark-mode`

## 📱 Responsive
- Adapté aux téléphones, tablettes et écrans de bureau
- Modal scrollable sur petits écrans
- Flexbox pour l'alignement

## ✨ Exemple de codes testables

```json
{
  "Code": "GIMMEM0NEY",
  "IsUnique": false,
  "Money": 1000,
  "Pokes": [],
  "Items": [],
  "Expiration": null
}
```

```json
{
  "Code": "E4STER3GG",
  "IsUnique": true,
  "Pokes": [],
  "Money": 0,
  "Items": [
    {"Name": "Uncommon Egg", "Count": 5}
  ],
  "Expiration": "2026-04-12"
}
```

## 🚀 Utilisation

1. Accéder à `redeem.html`
2. Entrer un code valide
3. Voir le résultat (succès/erreur)
4. Si succès, vue modale avec récompenses
5. Fermer la modale pour continuer

## 🔒 Sécurité

- Codes lus depuis codes.json (côté serveur)
- Validation d'expiration côté client (peut être falsifiée, à valider côté serveur)
- Codes uniques sauvegardés localement
- Pas de validation forte côté client (utiliser une API côté serveur en production)
