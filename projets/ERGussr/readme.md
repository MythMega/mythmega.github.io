### README

Ce dépôt contient des scripts et des fichiers JSON générés à partir de deux sources d'entrée : **fr.json** (français) et **en.json** (anglais). Le script nettoie les maps sources (suppression des `null`, déduplication par valeur) et produit des jeux de données par catégorie.

---

### Fichiers d'entrée
- **fr.json** — fichier source français (structure contenant des clés se terminant par `*.fmg`).
- **en.json** — fichier source anglais (même structure que `fr.json`).

---

### Fichiers de sortie principaux
Les fichiers `Dataset-*.json` contiennent des listes d'objets JSON, un objet par item. Tous les champs listés sont de type **string** (chaînes). Les champs peuvent être vides si la valeur est absente dans la langue correspondante.

#### Dataset-goods.json
| **Propriété** | **Type** |
|---|---|
| **ID** | string (format `Goods-<id>`) |
| **NameFR** | string |
| **Desc1FR** | string |
| **Desc2FR** | string |
| **Desc3FR** | string |
| **NameEN** | string |
| **Desc1EN** | string |
| **Desc2EN** | string |
| **Desc3EN** | string |
| **PictureURL** | string (ex: `./Assets/Goods/<sanitized_name>.png`) |

#### Dataset-weapon.json
| **Propriété** | **Type** |
|---|---|
| **ID** | string (format `Weapons-<id>`) |
| **NameFR** | string |
| **Desc1FR** | string |
| **Desc2FR** | string |
| **NameEN** | string |
| **Desc1EN** | string |
| **Desc2EN** | string |
| **PictureURL** | string (ex: `./Assets/Weapons/<sanitized_name>.png`) |

#### Dataset-armor.json
| **Propriété** | **Type** |
|---|---|
| **ID** | string (format `Armor-<id>`) |
| **NameFR** | string |
| **Desc1FR** | string |
| **Desc2FR** | string |
| **NameEN** | string |
| **Desc1EN** | string |
| **Desc2EN** | string |
| **PictureURL** | string (ex: `./Assets/Armors/<sanitized_name>.png`) |

#### Dataset-magic.json
| **Propriété** | **Type** |
|---|---|
| **ID** | string (format `Mafic-<id>`) |
| **NameFR** | string |
| **Desc1FR** | string |
| **Desc2FR** | string |
| **NameEN** | string |
| **Desc1EN** | string |
| **Desc2EN** | string |
| **PictureURL** | string (ex: `./Assets/Magic/<sanitized_name>.png`) |

#### Dataset-accessories.json
| **Propriété** | **Type** |
|---|---|
| **ID** | string (format `Accessories-<id>`) |
| **NameFR** | string |
| **Desc1FR** | string |
| **Desc2FR** | string |
| **NameEN** | string |
| **Desc1EN** | string |
| **Desc2EN** | string |
| **PictureURL** | string (ex: `./Assets/Accessories/<sanitized_name>.png`) |

---

### Fichiers intermédiaires générés
- **cleaned_<Key>_FR.json** et **cleaned_<Key>_EN.json**  
  Pour chaque clé source attendue (ex. `GoodsName.fmg`, `WeaponInfo.fmg`, `MagicCaption.fmg`, etc.), le script écrit un fichier `cleaned_<ShortKey>_FR.json` et `cleaned_<ShortKey>_EN.json`.  
  **Contenu** : mapping `"<id>": "<texte>"` après suppression des `null` et déduplication par valeur.  
  Exemple de nom : `cleaned_NameFR_FR.json`, `cleaned_Desc1EN_EN.json`.

---

### Logs
- **build_datasets.log** — fichier de log créé par le script. Contient :
  - avertissements si une propriété attendue n’a pas été trouvée dans `fr.json` ou `en.json`,
  - notifications si une map nettoyée est vide,
  - résumé du nombre d’items générés par catégorie.

---

### Règles de génération des noms de fichiers d’images
- Le **PictureURL** est construit à partir de **NameFR** si présent, sinon **NameEN**.
- Le nom est **sanitisé** : suppression des caractères invalides, espaces remplacés par `_`, tronqué si trop long.
- En cas de collision de noms, le script ajoute `_ID` pour garantir l’unicité.

---

### Remarques rapides
- Tous les champs de description et de nom sont des **strings** et peuvent être vides si absents.
- Les jeux de données incluent l’union des IDs trouvés dans les maps `NameFR` et `NameEN` nettoyées (pour ne pas perdre d’items présents uniquement dans une langue).
- Si vous souhaitez un comportement différent (par ex. n’inclure que les IDs présents en FR), indiquez‑le et le script peut être adapté.

---