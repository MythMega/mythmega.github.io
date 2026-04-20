# ERGussr — Arborescence des fichiers

```
ERGussr/
│
├── index.html              # Menu d'accueil
├── practice.html           # Page du mode entraînement
├── daily.html              # Page du daily (paramètre ?date=jj-mm-yyyy)
├── replay.html             # Grille de tous les dailies jouables
├── settings.html           # Paramètres (langue, export, import, suppression)
├── credits.html            # Crédits et lien GitHub
│
├── readme.md               # Documentation du projet de données source
├── spec.md                 # Spécification fonctionnelle et technique
├── arborescence.md         # Ce fichier
│
├── data/                   # Datasets d'items (générés par script Python)
│   ├── Dataset-goods.json       # Items consommables / utilitaires
│   ├── Dataset-weapon.json      # Armes
│   ├── Dataset-armor.json       # Armures
│   ├── Dataset-magic.json       # Sorts / magie
│   └── Dataset-accessories.json # Accessoires / talismans
│
├── translation/            # Fichiers de traduction (i18n)
│   ├── fr.json                  # Textes en français
│   └── en.json                  # Textes en anglais
│
├── styles/                 # Feuilles de style CSS
│   └── main.css                 # Thème principal (variables, layout, composants)
│
└── scripts/
    │
    ├── entity/             # Classes métier (un fichier par entité)
    │   ├── Item.js              # Classe Item : propriétés, getName(), getDesc*(), censorName()
    │   ├── Round.js             # Classe Round : état d'un round (fails, score, emojis)
    │   └── DailyResult.js       # Classe DailyResult : résultat complet d'un daily, sérialisation
    │
    ├── business/           # Logique métier
    │   ├── i18n.js              # Chargement et accès aux traductions (loadTranslations, t())
    │   ├── settings.js          # Lecture/écriture cookies (langue, highscore)
    │   ├── dataLoader.js        # Chargement de tous les Dataset-*.json → liste d'Item
    │   ├── seededRng.js         # PRNG déterministe Mulberry32 + pickRandom()
    │   ├── database.js          # Wrapper IndexedDB (save/get/getAll/clear DailyResult)
    │   ├── saveManager.js       # Export/import fichier .save (Base64 JSON compacté)
    │   └── gameLogic.js         # Helpers : normalize, checkGuess, autocomplete, dates
    │
    ├── visual/             # Construction d'interface
    │   ├── ui.js                # Traductions DOM, nav active, toasts, modals, shake
    │   ├── autocomplete.js      # Widget autocomplete (dropdown clavier/souris)
    │   └── roundRenderer.js     # Rendu HTML : image item, indices, carte résumé
    │
    └── pages/              # Contrôleurs de page (un fichier par page)
        ├── index.js             # Init index.html
        ├── practice.js          # Logique complète du mode entraînement
        ├── daily.js             # Logique complète du daily (validation date, rounds, sauvegarde)
        ├── replay.js            # Génération de la grille de dates
        ├── settings.js          # Gestion langue, export, import, suppression
        └── credits.js           # Init credits.html
```
