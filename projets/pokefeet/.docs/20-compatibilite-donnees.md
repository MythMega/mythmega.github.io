# 20 — Compatibilité des données et non-perte

> **Règle absolue** : une réorganisation de fichiers ne doit jamais changer un identifiant de stockage. Les données vivent dans l'origine du navigateur (schéma + hôte + port), pas dans le chemin des scripts.

## 1. Contrat de stockage (inchangé)

### IndexedDB

| Base | Version | Store | Clé | Champs lus |
|---|---:|---|---|---|
| `PokefeetDB` | 4 | `daily_results` | `date` | `score`, `results`, `importedInDex` |
| `PokefeetDB` | 4 | `weekly_results` | `date` | `score`, `results`, `wrongGuesses`, `importedInDex` |
| `PokefeetDexDB` | 4 | `dex_entries` | `index` | `found`, `count`, `firstFoundDate` |
| `PokefeetChallengeDB` | 4 | `challenge_completions` | `challengeId` | `completedAt`, `fails` |

### Cookies

| Cookie | Usage | Format |
|---|---|---|
| `pk_best` | meilleur score Marathon | entier |
| `pk_best_streak` | meilleure série Marathon | entier |
| `pk_cosmetic_bg` | fond équipé | identifiant |
| `pk_cosmetic_btn` | bouton équipé | identifiant |
| `pk_pseudo` | pseudo affiché | texte encodé |
| `pokefeet_language` | langue | `fr` / `en` |
| `pk_daily_result_v2` | **legacy** : ancien historique Daily | JSON — plus lu par le code actuel |

### Web Storage

| Clé | Stockage | Usage |
|---|---|---|
| `pk_practice_session` | `localStorage` | reprise d'une session Marathon |
| `challenge_manager_state` | `sessionStorage` | état de reprise des challenges |

### Fichier de sauvegarde

Format `POKEFEET_SAVE v2` :

```text
POKEFEET_SAVE v2
Exported: <ISO-8601>
---DATA---
{"daily":{...},"weekly":{...},"best":42,"marathon":{"bestScore":42,"bestStreak":7},"challenges":{...}}
---HASH---
<fnv1a32>
```

Le champ racine `best` est conservé pour les anciens fichiers. Le hash est FNV-1a 32 bits (non cryptographique) et sert à détecter une corruption accidentelle, pas à authentifier.

---

## 2. Ce qui a été vérifié lors de la réorganisation

| Vérification | Résultat |
|---|---|
| Les 35 fichiers JS sont identiques octet pour octet (hors CRLF) à leurs originaux | ✅ |
| La concaténation des 19 feuilles issues de `style.css` est identique (hors CRLF) | ✅ |
| Aucun `DB_NAME`, store, clé, cookie ou clé `localStorage` modifié | ✅ |
| Ordre des `<script>` de chaque page identique à l'original | ✅ |
| 21 pages chargées sans erreur d'asset locale | ✅ |
| Daily de test écrit dans `daily_results`, relu par `history.html` et `stats.html` | ✅ |
| Weekly de test écrit dans `weekly_results`, relu par l'onglet Weekly | ✅ |
| Entrée Dex de test écrite dans `dex_entries`, comptée par `pied-dex.html` | ✅ |
| Export/import : format et champs inchangés dans `js/data/data-manager.js` | ✅ (analyse statique) |

Les tests de données ont été exécutés dans un navigateur local, puis les enregistrements de test ont été supprimés.

---

## 3. Règles pour toute modification future

1. **Ne jamais renommer** une base, un store, une clé primaire, un cookie ou une clé Web Storage sans migration explicite.
2. **Ne jamais incrémenter** `DB_VERSION` sans un `onupgradeneeded` additif et un test sur une base v4 réelle.
3. **Ne jamais supprimer** un champ avant d'avoir vérifié qu'aucun export utilisateur ne contient encore l'ancien format.
4. **Toujours lire avant d'écrire** : une migration doit charger les données existantes, puis les réécrire ; elle ne doit pas recréer un store vide.
5. **Conserver les anciens noms en lecture** : un cookie legacy peut être migré, jamais supprimé avant confirmation.
6. **Tester avec deux profils** : base vide et base v4 déjà remplie.
7. **Tester le multi-onglets** : une montée de version bloquée par un autre onglet doit afficher une erreur, pas vider la base.

---

## 4. Procédure de vérification manuelle

1. Servir le dépôt avec un serveur statique local.
2. Ouvrir `data_management.html`, exporter une sauvegarde.
3. Jouer un Daily, un Weekly, un Marathon et un challenge bonus.
4. Recharger chaque page et vérifier :
   - `history.html` : Daily et Weekly présents ;
   - `stats.html` : jours, XP et trophées cohérents ;
   - `pied-dex.html` : progression du Dex ;
   - `data_management.html` : export contenant les mêmes données.
5. Importer la sauvegarde exportée dans un profil vierge et vérifier les mêmes écrans.
6. Vérifier dans les DevTools → Application → IndexedDB que les noms de bases et de stores sont exactement ceux du tableau §1.

---

## 5. En cas d'incident

- Ne pas supprimer la base ni les cookies.
- Exporter immédiatement via `data_management.html`.
- Conserver le rapport de migration affiché par `js/data/migration.js` (il contient les cookies et un instantané des données lues).
- Revenir au commit précédent : les chemins de fichiers peuvent être restaurés sans toucher aux données, car l'origine et le schéma n'ont pas changé.
