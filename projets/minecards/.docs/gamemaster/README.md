# 🎮 Guide Gamemaster — MineCards

> À l'attention de la personne qui gère le serveur de jeu (le **gamemaster**).
> Ce document explique comment ajouter un nouveau booster (pack) et comment créer une
> distribution / cadeau via Google Sheet.

---

## 1. Sommaire

- [Ajouter un booster](#1-ajouter-un-booster)
- [Où placer le fichier JSON](#2-où-placer-le-fichier-json)
- [Créer une distribution / un cadeau](#3-créer-une-distribution--un-cadeau)
- [Quelles données doivent être dans le Google Sheet](#4-quelles-données-doivent-être-dans-le-google-sheet)
- [Limitations importantes](#5-limitations-importantes)

---

## 2. Ajouter un booster

Un **booster** (ou *pack*, *extension*) = un lot de cartes tirées au sort. Chaque booster est
décrit par un fichier JSON.

### 2.1 Le fichier JSON d'une extension

Chaque booster correspond à un fichier dans `data/boosters/<identifiant>.json`.

Exemple de structure (basée sur l'extension existante `A1.json`) :

```json
{
  "ID": 1,
  "Serie": "A1",
  "ImportMode": "AlreadyExportedData",
  "BoosterTexture": "./assets/boosters/A1.png",
  "Cards": [
    {
      "Index": "SERIE-A1 / W001",
      "Name_FR": "Laine blanche",
      "Name_EN": "White Wool",
      "Desc_FR": "...",
      "Desc_EN": "...",
      "Rarity": 1,
      "Style": "Press Start 2P (Pixel)",
      "Background": "...",
      "Underlay": "...",
      "Layout": "classic",
      "Path": "./cards/A1/<lang>/SERIE-A1 _ W001_classic.png"
    }
  ]
}
```

**Champs obligatoires pour chaque carte :**
- `Index` : identifiant unique de la carte
- `Name_FR` / `Name_EN` : nom dans chaque langue
- `Desc_FR` / `Desc_EN` : description
- `Rarity` : rareté (1 = commun → 5 = légendaire)
- `Layout` : `classic` ou `fullart`
- `Path` : chemin de l'illustration (avec `<lang>` remplacé à l'exécution)

Le fichier complet de l'extension A1 est disponible ici :
[`./data/boosters/A1.json`](./data/boosters/A1.json)

---

## 3. Où placer le fichier JSON

**Règle :** les fichiers JSON des boosters vont dans le dossier `data/boosters/`.

### 3.1 Étapes pour ajouter un nouveau booster

1. **Créer le fichier JSON**  
   Enregistrer le fichier dans `data/boosters/<SET_ID>.json`, où `<SET_ID>` est l'identifiant
   unique de l'extension (ex. `A1`, `B2`, etc.)

2. **Déclarer l'extension dans `settings/config.json`**  
   Ajouter l'identifiant du set dans le tableau `boosters.sets` :

   ```json
   {
     "boosters": {
       "sets": ["A1", "NouveauBooster"]
     }
   }
   ```

3. **Ajouter les assets associés**  
   - Texture du booster : `assets/boosters/<identifiant>.png`
   - Cartes : dossiers `cards/<identifiant>/fr/` et `cards/<identifiant>/en/`

4. **Vérifier les IDs uniques**  
   Chaque carte doit avoir un `id` unique à travers **toutes** les extensions (la clé de
   collection est `${id}_${style}`). Vérifier qu'aucun doublon n'existe entre les extensions.

5. **Tester** : lancer l'application et vérifier que le nouveau booster apparaît bien dans
   la vue d'ouverture.

---

## 4. Créer une distribution / un cadeau

Les **distributions** permettent de distribuer des boosters ou des cartes à des joueurs
via un Google Sheet public.

### 4.1 Comment ça marche

- Le jeu lit un **Google Sheet public** partagé avec "n'importe qui disposant du lien"
- Chaque ligne du sheet = un cadeau destiné à un joueur identifié par son UUID
- Le jeu ne traite que les lignes **après** la dernière ligne déjà traitée (`lastCheckedLine`)
- Un cadeau ne peut être récupéré qu'une seule fois (basé sur le numéro de ligne)

### 4.2 Structure du Google Sheet

Le sheet doit avoir comme premières colonnes (ligne 1 = en-têtes) :

| Colonne | Description |
|---------|-------------|
| `uuid` | UUID du joueur destinataire (celui généré lors de la création du compte) |
| `type` | Type de cadeau : `booster` ou `card` |
| `key` | Identifiant du set (pour `booster`) ou clé unique de la carte (pour `card`) |
| `quantity` | Quantité à distribuer |

**Exemple de lignes :**

| uuid | type | key | quantity |
|------|------|-----|----------|
| 123e4567-e89b-12d3-a456-426614174000 | booster | A1 | 2 |
| 123e4567-e89b-12d3-a456-426614174000 | card | SERIE-A1 _ V004_fullart | 1 |

### 4.3 Règles pour le sheet

- **Toujours en mode append-only** : ne jamais trier, insérer ou supprimer de lignes,
  sinon les numéros de ligne changent et les cadeaux peuvent être distribués plusieurs fois
  ou jamais
- **État de partage** : le sheet doit être partagé avec "toute personne disposant du lien"
  (anyone with the link)
- **UUID** : l'UUID du joueur est visible dans les paramètres de l'appli (section "Compte")
- **Clé pour un booster** : l'identifiant de l'extension (ex. `A1`)
- **Clé pour une carte** : la clé unique `${id}_${style}` (ex. `SERIE-A1 _ V004_fullart`)

### 4.4 Configuration dans l'appli

Dans `settings/config.json`, déclarer le sheet :

```json
{
  "giftSheet": {
    "id": "ID_DU_SPREADSHEET",
    "gid": "0"
  }
}
```

Le jeu va essayer de fetch le CSV via :
1. `https://docs.google.com/spreadsheets/d/<ID>/gviz/tq?tqx=out:csv&gid=<GID>`
2. Si ça échoue : `https://docs.google.com/spreadsheets/d/<ID>/export?format=csv&gid=<GID>`

### 4.5 Vérifier les distributions

Dans l'appli, aller dans **Paramètres → "Vérifier les distributions"**.  
Le jeu télécharge le CSV, traite les nouvelles lignes pour le compte connecté, et affiche
ce qui a été reçu.

---

## 5. Limitations importantes

⚠️ **Sécurité** : L'UUID est dans un sheet public. N'importe qui connaissant le lien peut voir
les UUID et les cadeaux distribués. Le contrôle "une seule fois" est purement local (côté
client) et peut être contourné en effaçant les données locales.

✅ **Usage acceptable** : pour un jeu sans enjeu financier, c'est suffisant.  
❌ **À ne pas utiliser** pour des récompenses de valeur (objets rares, prix, etc.) sans une
vérification serveur digne de confiance.

---

*Document créé pour le projet MineCards — Développement étape 7 & 8.*
