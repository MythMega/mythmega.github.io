# Context & Goal
Tu es un développeur Web Frontend Senior. Tu dois développer une application Web "Full Client" (Vanilla JS/ES6+, HTML5, CSS3) d'ouverture de boosters de cartes à collectionner, optimisée pour Mobile et Desktop. Aucune dépendance de framework lourd (pas de React, Vue, etc.), tout repose sur des modules JS natifs et IndexedDB. Seule dépendance tolérée : Three.js (+ GLTFLoader) pour le rendu 3D.

---

## 1. Architecture & Structure du Code
Séparation stricte des responsabilités (arborescence complète : voir `archi.txt`) :
- `js/models/` : interaction directe avec IndexedDB (`StorageRepository.js`).
- `js/classes/` : structures de données (`Card.js`, `SaveFile.js`).
- `js/business/` : logique métier (compte, gacha, date/quota, collection, redeem, distributions).
- `js/UI/` : vues et composants d'interface.
- `js/utils/` : utilitaires isolés (compression, bus d'événements, i18n, thème).

---

## 2. Modèle de données (source de vérité unique)
Base IndexedDB `CardBoosterDB` (version 1), 5 ObjectStores :

| Store | Clé | Contenu |
|---|---|---|
| `collection` | `key` = `${id}_${style}` | `{ key, cardId, style, set, quantity, firstObtainedAt, lastObtainedAt }` |
| `user_state` | clé texte (voir ci-dessous) | états applicatifs |
| `redeemed_codes` | `code` | `{ code, redeemedAt }` |
| `gifts_received` | `line` (n° de ligne du sheet) | `{ line, uuid, type, key, quantity, receivedAt }` |

Clés de `user_state` :
- `"account"` : `{ uuid, createdAt }` — **son existence = "un compte existe"**.
- `"settings"` : `{ lang: "fr"|"en", theme: "dark"|"light"|"classic" }`.
- `"quota"` : `{ lastResetDay: "YYYY-MM-DD", dailyRemaining, bonusBoosters: { [setId]: number } }` (ex. `{ "set1": 2 }`).
- `"timeAnchor"` : `{ apiUtcMs, perfNow, lastKnownUtcMs }`.
- `"stats"` : `{ boostersOpened, drawsByRarity: {1..5}, drawsByCard: { [key]: count } }`.
- `"giftSync"` : `{ lastCheckedLine, lastCheckAt }`.

Note : pas de cookies. Tout est en IndexedDB. Seul un miroir `localStorage` de `lang` et `theme` est autorisé, pour appliquer le thème avant le premier rendu (évite le flash).

---

## 3. Spécifications Techniques & Fonctionnalités

### A. Compte local & Onboarding (première visite)
- Pas de serveur : "créer un compte" = initialiser localement la base et générer un **UUID** (`crypto.randomUUID()`), stocké dans `user_state["account"]`.
- **Au démarrage :** si `account` existe → l'app démarre normalement. Sinon → **écran d'accueil** avec 2 choix :
  1. **Créer une nouvelle sauvegarde** : génère l'UUID, initialise `settings`, `quota`, `stats`, `giftSync`.
  2. **Importer une sauvegarde `.save`** : restaure tout, dont l'UUID d'origine.
- L'UUID est **immuable** : il est contenu dans la sauvegarde et restauré tel quel à l'import.
- L'UUID est visible et copiable dans Paramètres (il sert à recevoir des cadeaux).
- Au premier lancement, appeler `navigator.storage.persist()` pour limiter le risque d'effacement par le navigateur.
- "Réinitialisation complète" = suppression de toutes les données **y compris l'UUID**, puis retour à l'écran d'accueil.

### B. Horodatage Anti-Triche (Reset Journalier à 00:00:00 UTC)
- **3 boosters par jour** (`dailyRemaining`), remise à 3 chaque jour à 00:00:00 UTC.
- Date du jour via `https://worldtimeapi.org/api/timezone/Etc/UTC` (prévoir un second fournisseur de secours).
- **Les boosters bonus** (redeem, cadeaux) sont **propres à une extension** : ils sont stockés par identifiant de set dans `bonusBoosters` (ex. `{ "set1": 2 }`) et **ne sont jamais écrasés** par le reset. Les 3 boosters quotidiens, eux, sont utilisables sur n'importe quelle extension. À l'ouverture d'un booster du set S, on consomme d'abord `dailyRemaining`, puis `bonusBoosters[S]`.
- **Hors-ligne :**
  - Dans la même session de page : temps UTC estimé = `apiUtcMs + (performance.now() − perfNow)`. `Date.now()` n'est jamais utilisé.
  - Après rechargement hors-ligne : `performance.now()` repart de zéro, l'ancrage n'est donc plus exploitable. Le temps est alors **figé** à `lastKnownUtcMs` (dernier UTC fiable). Aucun reset n'est possible hors-ligne après un rechargement.
  - Le temps estimé ne peut jamais reculer (`max` avec `lastKnownUtcMs`).

### C. Moteur Gacha
- Un booster contient **5 cartes**.
- Probabilités par emplacement lues depuis `settings/rarity.json` (tirage pondéré).
- Une fois la rareté R choisie : carte au hasard parmi les cartes de rareté R du JSON de l'extension.
- Doublons autorisés dans un même booster.
- Les cartes sont **enregistrées en base dès le tirage** (avant la révélation).

### D. Structure des Cartes & JSON
- Propriétés : `id`, `name`, `rarity` (1–5), `style` (`"normal"|"fullart"`), `illustration` (nom unique dans tous les fichiers), `set`.
- Clé unique : `${id}_${style}`. Les `id` doivent donc être uniques entre extensions.
- Chemins d'illustration : `/fr/` ⇄ `/en/` selon la langue active.

### E. Rendu 3D & Animation d'Ouverture
- Three.js + `GLTFLoader`, modèle `.glb`, texture définie dans le JSON de l'extension.
- Workflow : interaction avec le booster 3D → 5 cartes face cachée → clic pour retourner une à une → glow CSS pour les raretés 4 et 5.

### F. Langues & Thèmes
- **Langues** : Français, Anglais (extensible : ajouter `settings/i18n/<code>.json` + l'entrée dans `settings/config.json`). Change les libellés et les chemins d'images, à chaud (sans rechargement).
- **Thèmes** : **Sombre** (défaut), **Clair**, **Classic**. Chacun est un bloc de variables CSS `body[data-theme="…"]` dans `css/themes.css`. Extensible.
- Les deux préférences sont sauvegardées dans `user_state["settings"]` et incluses dans le `.save`.

### G. Vues & Navigation (SPA)
0. **Accueil (onboarding)** : créer / importer, affiché seulement si aucun compte.
1. **Ouverture** : choix du booster + scène d'ouverture.
2. **Collection** : grille, silhouettes grisées pour les manquantes, filtres extension/style/rareté/statut.
3. **Statistiques** : boosters ouverts, complétion par extension, répartition par rareté, carte la plus piochée.
4. **Paramètres** : langue, thème, compte (UUID), sauvegarde (export / import / reset), **bouton "Vérifier les distributions"**, lien vers l'historique des cadeaux.
5. **Cadeaux** : historique des distributions reçues.
6. **Redeem** : codes promos de `settings/redeem.json`.

Sauvegarde `.save` : toutes les données → JSON → `CompressionStream('deflate')` → Base64. Import : Base64 → `DecompressionStream('deflate')` → JSON validé.

### H. Distributions (cadeaux via Google Sheet)
- Source : le CSV du Google Sheet, dont l'URL est configurée dans `settings/config.json`.
- Une ligne = un cadeau : `uuid`, `type` (`booster`|`card`), `key`, `quantity`. La colonne `key` identifie le cadeau : l'identifiant du set pour un `booster` (ex. `set1`), la clé unique de la carte pour une `card` (ex. `042_fullart`). Voir Étape 8.
- Dans Paramètres, "Vérifier les distributions" télécharge le CSV et ne traite que les lignes **postérieures à `lastCheckedLine`** dont l'UUID correspond à celui du compte.
- Chaque cadeau traité est enregistré dans `gifts_received` avec son **numéro de ligne comme clé** : impossible de le récupérer deux fois.
- `lastCheckedLine` est mis à jour à la fin du traitement, dans la même transaction que les récompenses.
- Une interface indique ce qui a été reçu, ou "Aucun cadeau".

---

## 4. Plan de Développement Étape par Étape
1. **Étape 1 :** HTML SPA, CSS global + thèmes, `StorageRepository`, i18n, compte local & onboarding.
2. **Étape 2 :** `DateSyncManager` + quota (quotidien + bonus).
3. **Étape 3 :** `GachaEngine`, `BoosterManager`, JSON.
4. **Étape 4 :** Ouverture 3D + retournement des cartes.
5. **Étape 5 :** Collection & Statistiques.
6. **Étape 6 :** Import/export `.save` + vue Paramètres (langue, thèmes, compte).
7. **Étape 7 :** Redeem + finitions mobile.
8. **Étape 8 :** Distributions (Google Sheet) + historique des cadeaux.

Commence directement par l'Étape 1.
