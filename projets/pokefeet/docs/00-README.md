# Pokefeet — Documentation technique

Bienvenue dans la documentation de **Pokefeet**, une application web de devinettes Pokémon où il faut reconnaître un Pokémon à partir de ses pieds !

---

## 📚 Table des matières

| Fichier | Description |
|---|---|
| [01-ARCHITECTURE.md](./01-ARCHITECTURE.md) | Structure du projet, dépendances, organisation des fichiers |
| [02-CORE-CLASSES.md](./02-CORE-CLASSES.md) | Classes fondamentales : `Pokemon`, `TypeIcons`, `PokemonVersions` |
| [03-GAME-MODE.md](./03-GAME-MODE.md) | Mode Marathon (entraînement) — logique, session, scoring |
| [04-DAILY-MODE.md](./04-DAILY-MODE.md) | Mode Daily — 5 Pokémon par jour avec seed = date |
| [05-WEEKLY-MODE.md](./05-WEEKLY-MODE.md) | Mode Weekly — 10 Pokémon par semaine avec seed = lundi |
| [06-DATA-PERSISTENCE.md](./06-DATA-PERSISTENCE.md) | Stockage IndexedDB, cookies, export/import des données |
| [07-DEX-SYSTEM.md](./07-DEX-SYSTEM.md) | Pokédex interne : `Dex.js`, `Dex-ui.js`, `DailyToDexImport.js` |
| [08-XP-LEVELS-TROPHIES.md](./08-XP-LEVELS-TROPHIES.md) | Système d'XP, niveaux, trophées et récompenses |
| [09-PROFILE.md](./09-PROFILE.md) | Profil utilisateur, pseudo, badges |
| [10-HISTORY.md](./10-HISTORY.md) | Historique des parties (Daily & Weekly) |
| [11-STATS.md](./11-STATS.md) | Statistiques détaillées, courbes, graphiques |
| [12-I18N.md](./12-I18N.md) | Internationalisation, fichiers de traduction |
| [13-UI-COMPONENTS.md](./13-UI-COMPONENTS.md) | Composants UI, notifications, dropdowns, gauges |

---

## Vue d'ensemble rapide

Pokefeet est une **SPA (Single Page Application)** vanilla JS (sans framework) qui propose 3 modes de jeu :

1. **Marathon (Entraînement)** — Tous les Pokémon disponibles, dans un ordre aléatoire, avec reprise possible
2. **Daily** — 5 Pokémon identiques pour tout le monde chaque jour (seed = date)
3. **Weekly** — 10 Pokémon identiques pour toute la semaine (seed = lundi)

Chaque partie consiste à deviner un Pokémon à partir d'une **image partielle** (les pieds). En cas d'échec, des indices s'affichent (Type → Index → Groupe d'œuf → Catégorie). Le score diminue avec les indices utilisés.

Les résultats sont persistés dans **IndexedDB**, et un système d'**XP / niveaux / trophées / récompenses** débloque des badges et titres personnalisables.

---

## Pour commencer à développer

1. Lire [`01-ARCHITECTURE.md`](./01-ARCHITECTURE.md) pour comprendre la structure
2. Explorer [`02-CORE-CLASSES.md`](./02-CORE-CLASSES.md) pour la classe `Pokemon` et les versions
3. Lire le mode qui vous intéresse : [`03-GAME-MODE.md`](./03-GAME-MODE.md), [`04-DAILY-MODE.md`](./04-DAILY-MODE.md), [`05-WEEKLY-MODE.md`](./05-WEEKLY-MODE.md)
4. Consulter [`06-DATA-PERSISTENCE.md`](./06-DATA-PERSISTENCE.md) pour comprendre le stockage
5. Voir [`08-XP-LEVELS-TROPHIES.md`](./08-XP-LEVELS-TROPHIES.md) pour le système de progression

## Stack technique

- **Langage** : JavaScript vanilla (ES6+)
- **Stockage** : IndexedDB (résultats), Cookies (préférences), localStorage (session marathon)
- **UI** : HTML/CSS vanilla, responsive, design sombre
- **i18n** : Système maison avec fichiers JSON (`translations/fr.json`, `translations/en.json`)
- **Données** : Fichiers JSON statiques (`data/pokemons.json`, `data/trophies.json`, etc.)