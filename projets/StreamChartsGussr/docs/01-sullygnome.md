# 📘 Guide : Récupérer les données complètes d’un streamer via l’API SullyGnome

Ce guide explique comment :

1. **Convertir un pseudo Twitch en ID SullyGnome**
2. **Utiliser cet ID pour récupérer le tableau complet des jeux joués**
3. **Appeler l’API SullyGnome correctement**

---

## 🔍 1. Trouver l’ID SullyGnome à partir d’un pseudo Twitch

SullyGnome n’utilise **pas** l’ID Twitch officiel.  
Chaque streamer possède un **ID interne SullyGnome**, indispensable pour interroger l’API.

Pour récupérer cet ID, on utilise l’endpoint :

```
https://sullygnome.com/api/standardsearch/<PSEUDO_TWITCH>
```

### Exemple

```
https://sullygnome.com/api/standardsearch/sawancyberpotes
```

Réponse typique :

```json
[
  {
    "displaytext": "SawanCyberpotes",
    "value": 32047809,
    "description": "201",
    "itemtype": 1,
    "siteurl": "sawancyberpotes",
    "boxart": "https://static-cdn.jtvnw.net/jtv_user_pictures/df4595e8-55a5-45db-a8a7-c7bcf0387ef7-profile_image-300x300.png"
  }
]
```

➡️ **L’ID SullyGnome est `value`**, ici :  
**`32047809`**

---

## 📊 2. Récupérer le tableau complet des jeux joués

Une fois l’ID SullyGnome obtenu, on peut appeler l’API des jeux :

```
https://sullygnome.com/api/tables/channeltables/games/<PERIODE>/<ID_SULLYGNOME>/%20/1/2/desc/0/<LIMIT>
```

### Paramètres importants

| Paramètre | Description |
|----------|-------------|
| `<PERIODE>` | Nombre de jours analysés (ex : `7300` = ~20 ans) |
| `<ID_SULLYGNOME>` | ID interne récupéré via `standardsearch` |
| `<LIMIT>` | Nombre de lignes retournées (ex : `100`) |

---

### Exemple complet

Pseudo : **SawanCyberpotes**  
ID SullyGnome : **32047809**

Requête :

```
https://sullygnome.com/api/tables/channeltables/games/7300/32047809/%20/1/2/desc/0/200
```

Cette URL retourne :

- les **200 jeux les plus joués**
- sur les **7300 derniers jours**
- triés par **temps de stream décroissant**

---

## 🔁 3. Processus complet (pseudo → ID → tableau)

### Étape 1 : Convertir le pseudo en ID SullyGnome

```
GET https://sullygnome.com/api/standardsearch/<PSEUDO>
```

Extraire :

```
value = ID_SULLYGNOME
```

### Étape 2 : Récupérer les données complètes

```
GET https://sullygnome.com/api/tables/channeltables/games/7300/<ID_SULLYGNOME>/%20/1/2/desc/0/100
```

---

## 🧪 Exemple final avec MythMega

### 1. Trouver l’ID SullyGnome

```
https://sullygnome.com/api/standardsearch/MythMega
```

Supposons que la réponse contient :

```
"value": 10763925
```

### 2. Récupérer les jeux joués sur 7300 jours

```
https://sullygnome.com/api/tables/channeltables/games/7300/10763925/%20/1/2/desc/0/100
```

---

## 🧩 Notes utiles

- L’ID Twitch **ne sert à rien** dans l’API SullyGnome.  
- Le champ `value` est **toujours** l’ID interne à utiliser.  
- L’API fonctionne sans authentification.  
- Le paramètre `%20` correspond à un filtre vide (URL‑encoded).

---

Si tu veux, je peux aussi te générer une version **avec exemples en JavaScript, Python ou PHP**, ou un script qui fait tout automatiquement.