# 📊 Analyse Détaillée de codes.json

## Structure JSON Complète

```json
[
  {
    "Code": "GIMMEM0NEY",
    "IsUnique": false,
    "Pokes": [],
    "Money": 1000,
    "Items": [],
    "Expiration": null
  },
  {
    "Code": "E4STER3GG",
    "IsUnique": true,
    "Pokes": [],
    "Money": 0,
    "Items": [
      {
        "Name": "Uncommon Egg",
        "Count": 5
      },
      {
        "Name": "Rare Egg",
        "Count": 4
      },
      {
        "Name": "Epic Egg",
        "Count": 3
      },
      {
        "Name": "Legendary Egg",
        "Count": 2
      },
      {
        "Name": "Mythical Egg",
        "Count": 1
      }
    ],
    "Expiration": "2026-04-12"
  },
  {
    "Code": "THANKS2B3T4T3ST3R",
    "IsUnique": true,
    "Pokes": [
      {
        "Index": "370",
        "Count": 3
      }
    ],
    "Money": 12345,
    "Items": [],
    "Expiration": "2026-01-31"
  }
]
```

---

## Détails de Chaque Champ

### Code (string)
La chaîne que l'utilisateur doit entrer.

**Exemple:**
```json
"Code": "GIMMEM0NEY"
```

**Caractéristiques:**
- Sensible à la casse dans le fichier JSON
- Insensible à la casse lors de la validation (converti en majuscules)
- Peut contenir lettres, chiffres, caractères spéciaux
- Longueur recommandée: 8-20 caractères

---

### IsUnique (boolean)
Si `true`, le code peut être utilisé une seule fois par utilisateur.
Si `false`, le code peut être utilisé autant de fois qu'on le souhaite.

**Exemples:**
```json
"IsUnique": false  // Réutilisable
"IsUnique": true   // Une seule fois
```

**Sauvegarde:**
- Codes uniques utilisés → localStorage['usedCodes']
- Vérification: `code.hasBeenUsed()` avant redemption

---

### Pokes (array)
Liste des Pokémon à recevoir. Tableau pouvant être vide.

**Champs:**
- `Index` (string): Index du Pokémon dans le Pokédex
- `Count` (number): Nombre de fois que ce Pokémon est reçu

**Exemple:**
```json
"Pokes": [
  {
    "Index": "370",
    "Count": 3
  }
]
```

**Pokémon dans les codes actuels:**
- Index 370 = Luvdisc (Pokémon de Gen III)

**Application:**
- Marque le Pokémon comme attrapé (gameManager.caughtPokemon[index])
- Augmente le count du Pokémon
- Enregistre la date de première capture

---

### Money (number)
Montant en Pokédollars à recevoir.

**Exemple:**
```json
"Money": 1000
```

**Caractéristiques:**
- Nombre entier
- Peut être 0 (pas d'argent)
- Ajouté directement au solde

**Application:**
- `inventoryManager.addBalance(amount)`

---

### Items (array)
Liste des objets à recevoir. Tableau pouvant être vide.

**Champs:**
- `Name` (string): Nom de l'objet
- `Count` (number): Quantité de l'objet

**Exemple:**
```json
"Items": [
  {
    "Name": "Uncommon Egg",
    "Count": 5
  }
]
```

**Objets dans les codes actuels:**
- Uncommon Egg
- Rare Egg
- Epic Egg
- Legendary Egg
- Mythical Egg

**Application:**
- `inventoryManager.addItem(name, count)`
- Ajouté à l'inventaire

---

### Expiration (string ou null)
Date d'expiration du code au format ISO (YYYY-MM-DD).

**Exemples:**
```json
"Expiration": null              // Pas d'expiration
"Expiration": "2026-04-12"      // Expire le 12 avril 2026
"Expiration": "2026-01-31"      // Expire le 31 janvier 2026
```

**Vérification:**
- `code.isExpired()` → compare avec `new Date()`
- Si aujourd'hui > date, le code est expiré

---

## Codes Actuels Détaillés

### Code 1: GIMMEM0NEY

```
┌─────────────────────────────────────────┐
│ Code: GIMMEM0NEY                        │
├─────────────────────────────────────────┤
│ IsUnique: false                         │
│ Expiration: null (jamais)               │
├─────────────────────────────────────────┤
│ RÉCOMPENSES:                            │
│                                         │
│ Pokémon: (aucun)                        │
│                                         │
│ Pokédollars: 1000                       │
│                                         │
│ Objets: (aucun)                         │
└─────────────────────────────────────────┘
```

**Cas d'usage:** Récompense simple pour attirer les nouveaux joueurs.

**Statut:** ✅ Réutilisable à l'infini

---

### Code 2: E4STER3GG

```
┌─────────────────────────────────────────┐
│ Code: E4STER3GG                         │
├─────────────────────────────────────────┤
│ IsUnique: true                          │
│ Expiration: 2026-04-12                  │
├─────────────────────────────────────────┤
│ RÉCOMPENSES:                            │
│                                         │
│ Pokémon: (aucun)                        │
│                                         │
│ Pokédollars: 0                          │
│                                         │
│ Objets:                                 │
│  • Uncommon Egg ×5                      │
│  • Rare Egg ×4                          │
│  • Epic Egg ×3                          │
│  • Legendary Egg ×2                     │
│  • Mythical Egg ×1                      │
│  └─ TOTAL: 15 œufs (5+4+3+2+1)         │
└─────────────────────────────────────────┘
```

**Cas d'usage:** Événement de Pâques (Easter Eggs).

**Statut:** ✅ À utiliser une fois avant le 12 avril 2026

---

### Code 3: THANKS2B3T4T3ST3R

```
┌─────────────────────────────────────────┐
│ Code: THANKS2B3T4T3ST3R                 │
├─────────────────────────────────────────┤
│ IsUnique: true                          │
│ Expiration: 2026-01-31                  │
├─────────────────────────────────────────┤
│ RÉCOMPENSES:                            │
│                                         │
│ Pokémon:                                │
│  • Luvdisc (Index 370) ×3               │
│                                         │
│ Pokédollars: 12345                      │
│                                         │
│ Objets: (aucun)                         │
└─────────────────────────────────────────┘
```

**Cas d'usage:** Remerciement aux bêta-testeurs.

**Statut:** ✅ À utiliser une fois avant le 31 janvier 2026

---

## Statistiques des Récompenses

### Par Type

| Type | Code 1 | Code 2 | Code 3 | Total |
|------|--------|--------|--------|-------|
| Pokémon | 0 | 0 | 3 | 3 |
| Pokédollars | 1000 | 0 | 12345 | 13345 |
| Objets | 0 | 15 | 0 | 15 |

### Répartition des Objets

| Objet | Quantité |
|-------|----------|
| Uncommon Egg | 5 |
| Rare Egg | 4 |
| Epic Egg | 3 |
| Legendary Egg | 2 |
| Mythical Egg | 1 |
| **Total** | **15** |

---

## Ajouter de Nouveaux Codes

### Modèle pour Ajouter un Code

```json
{
  "Code": "NOUVEAU123",
  "IsUnique": true,
  "Pokes": [
    {
      "Index": "POKEMON_INDEX",
      "Count": QUANTITE
    }
  ],
  "Money": MONTANT,
  "Items": [
    {
      "Name": "NOM_OBJET",
      "Count": QUANTITE
    }
  ],
  "Expiration": "YYYY-MM-DD" ou null
}
```

### Exemples

#### Code pour Noël
```json
{
  "Code": "HOLLY2026",
  "IsUnique": false,
  "Pokes": [],
  "Money": 500,
  "Items": [
    {"Name": "Gift Box", "Count": 3}
  ],
  "Expiration": "2026-12-25"
}
```

#### Code pour Évolution
```json
{
  "Code": "EVOLV4ALL",
  "IsUnique": true,
  "Pokes": [
    {"Index": "6", "Count": 1},    // Charizard
    {"Index": "25", "Count": 1},   // Pikachu
    {"Index": "149", "Count": 1}   // Dragonite
  ],
  "Money": 5000,
  "Items": [],
  "Expiration": "2026-06-30"
}
```

---

## Format et Validation

### Règles d'Encodage

- **Encodage:** UTF-8
- **Format:** JSON valide
- **Indentation:** 4 espaces (recommandé)

### Vérifications Importantes

✅ Le JSON doit être valide (utiliser jsonlint.com)
✅ Les guillemets doivent être des guillemets doubles (")
✅ Les Index Pokémon doivent être des strings ("370")
✅ Les dates doivent au format ISO (YYYY-MM-DD)
✅ Pas de virgule trailing après le dernier élément

### Exemple de JSON Invalide ❌

```json
{
  "Code": "TEST123",
  "Money": 1000,  // ← Virgule inutile ici
}
```

### Exemple de JSON Valide ✅

```json
{
  "Code": "TEST123",
  "Money": 1000
}
```

---

## Dates d'Expiration

### Codes Existants

| Code | Expiration | Jours restants |
|------|-----------|---------------|
| GIMMEM0NEY | Jamais | ∞ |
| E4STER3GG | 12/04/2026 | +80 jours |
| THANKS2B3T4T3ST3R | 31/01/2026 | +8 jours |

### Format de Date

- **Format:** YYYY-MM-DD
- **Exemple:** 2026-01-31
- **Zones horaires:** UTC (minuit UTC)
- **Validation:** Comparaison `new Date(code.expiration) > new Date()`

---

## Notes Techniques

### Parsing JSON

```javascript
// Charger et parser codes.json
const response = await fetch('./codes.json');
const codesArray = await response.json();

// Chaque élément devient une instance de Code
const code = new Code(codesArray[0]);
```

### Accès aux Propriétés

```javascript
// Après instanciation en classe Code
code.code           // "GIMMEM0NEY"
code.isUnique       // false
code.money          // 1000
code.pokes          // []
code.items          // []
code.expiration     // null
```

### Vérifications

```javascript
// Vérifier si expiré
code.isExpired()    // true ou false

// Vérifier si utilisé (unique)
code.hasBeenUsed()  // true ou false

// Obtenir les récompenses
code.getRewards()   // {pokes: [], money: 1000, items: []}
```

---

## Sauvegarde

Les codes uniques utilisés sont sauvegardés dans:

```javascript
localStorage['usedCodes'] = '["E4STER3GG","THANKS2B3T4T3ST3R"]'
```

Structure en localStorage:

```json
{
  "usedCodes": [
    "E4STER3GG",
    "THANKS2B3T4T3ST3R"
  ]
}
```

---

## Conclusion

Le fichier codes.json est la source de données des codes promotionnels. Il est facile à modifier et extensible pour ajouter de nouveaux codes ou modifier les récompenses existantes.

**À retenir:**
- ✅ JSON valide
- ✅ Codes uniques ou non
- ✅ Récompenses multiples
- ✅ Dates d'expiration optionnelles
- ✅ Facile à mettre à jour
