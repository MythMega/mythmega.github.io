# 🚀 Guide de Démarrage Rapide - Pokéice

## 📦 Installation

1. **Vérifier l'arborescence:**
```
pokiece/
├── index.html              ✓
├── game.html               ✓
├── credits.html            ✓
├── data/
│   └── mons.json           ✓
├── styles/
│   └── style.css           ✓
└── js/
    ├── global.js           ✓
    ├── translation.js      ✓
    ├── code.js             ✓
    └── game.js             ✓
```

2. **Configurer un serveur web:**

   **Avec Python 3:**
   ```cmd
   python -m http.server 8000
   ```

   **Avec Node.js (http-server):**
   ```cmd
   npm install -g http-server
   http-server
   ```

   **Avec PHP:**
   ```cmd
   php -S localhost:8000
   ```

3. **Accéder à l'application:**
   - Ouvrez `http://localhost:8000/pokiece/` dans votre navigateur

## 🎮 Premier Test

### Scenario 1: Nouvelle Partie
1. Cliquez sur le bouton "Commencer"
2. Attendez le chargement des Pokémons
3. Observez la grille 6×5
4. Vérifiez que les données s'affichent correctement

### Scenario 2: Vérifier les Logs
1. Ouvrez la console (F12 → Console)
2. Vous devez voir:
   - "🎮 Page Index" ou "🎮 Initialisation du jeu"
   - Logs colorés en cyan et violet
   - Messages détaillés pour chaque action

### Scenario 3: Tester le Dark Mode
1. Cliquez sur le bouton 🌙 (bas droit)
2. La page devient sombre
3. Cliquez à nouveau pour revenir en clair
4. Rechargez la page (F5)
5. Le mode doit être sauvegardé

### Scenario 4: Tester la Traduction
1. Cliquez sur le bouton 🌐 (bas droit)
2. Tous les textes doivent basculer EN → FR ou FR → EN
3. Rechargez la page
4. La langue doit être sauvegardée

### Scenario 5: Tester le Code
1. Lancez une nouvelle partie
2. Observez l'URL: `game.html?Code=XXXXXXXX`
3. Copiez l'URL complète
4. Ouvrez une nouvelle fenêtre
5. Allez sur `index.html`
6. Collez le code et cliquez "Rejoindre"
7. Les mêmes Pokémons doivent s'afficher

### Scenario 6: Tester les Interactions
1. Sur une carte Pokémon:
   - Cliquez ✨ → Sprite devient shiny
   - Cliquez 🚫 → Carte devient grise
   - Cliquez à nouveau pour réinitialiser

### Scenario 7: Tester les Boutons
- **🏠 Accueil**: Retour à index.html
- **🔄 Relancer**: Nouvelle partie (autre code)
- **📋 Copier code**: Message "✅ Code copié!"

## 🔍 Vérifications Techniques

### 1. Console (F12)
Recherchez les messages suivants:
```
✓ "🚀 Pokéice - Application Web"
✓ "📄 DOM chargé"
✓ "✅ Initialisation globale terminée"
✓ Logs colorés en #00ffff (cyan)
```

### 2. Cookies
Ouvrez DevTools (F12) → Application → Cookies:
```
✓ language: "FR" ou "EN"
✓ darkMode: "light" ou "dark"
```

### 3. Réseau
Vérifiez que le fichier `mons.json` se charge:
```
DevTools (F12) → Network → Cherchez "mons.json"
```

### 4. Sprites Pokémons
Vérifiez que les images se chargent:
```
DevTools (F12) → Network → Images
Tous les fichiers pokemondb.net doivent être "200 OK"
```

### 5. Icônes de Type
Vérifiez les icônes Bulbapedia:
```
URL format: archives.bulbagarden.net/.../<Type>_icon_HOME3.png
```

## 🎨 Tester le Design

### Colors
- Boutons bleu-violet: **#00d4ff** (cyan), **#b000ff** (violet)
- Mode clair: Fond **#f5f5f5**
- Mode sombre: Fond **#1a1a1a**

### Responsivité
Testez avec DevTools (F12 → Responsive Design Mode):
- Desktop (1920×1080): Grille 6×5 ✓
- Tablette (768×1024): Grille 5×6 ✓
- Mobile (375×812): Grille 3-4×? ✓

### Animations
- Passage souris sur bouton → Glow effet ✓
- Changement langue → Texte se met à jour ✓
- Toast notification → Slide depuis bas ✓

## 🐛 Dépannage

### Les Pokémons ne s'affichent pas
→ Vérifiez que `mons.json` est dans `./data/`
→ Consultez la console pour les erreurs

### Les sprites ne chargent pas
→ Vérifiez la connexion internet
→ Vérifiez que pokemondb.net est accessible
→ Aucun blocage CORS ne doit existe

### Les cookies ne se sauvegardent pas
→ Vérifiez que les cookies sont activés
→ Le domaine ne doit pas être "file://"
→ Utilisez un serveur web, pas file://

### Le code ne fonctionne pas
→ Vérifiez de copier le code entier
→ Pas d'espaces au début/fin
→ Utilisez le même navigateur

### Dark Mode ne se sauvegarde pas
→ Cache du navigateur à vider
→ Cookies doivent être activés
→ Attendez 1 seconde après le clic

## 📚 Documentation Supplémentaire

- **README.md**: Documentation complète du projet
- **CHECKLIST.md**: Vérification des spécifications
- **config.json**: Paramètres et configuration
- **Logs Console**: Messages de débogage détaillés

## 🎯 Checklist de Déploiement

Avant de mettre en production:
- [ ] Tous les fichiers HTML/CSS/JS sont en place
- [ ] mons.json est dans ./data/
- [ ] Aucune console.error (sauf assets externes)
- [ ] Responsivité testée sur mobile/tablet/desktop
- [ ] Dark mode fonctionne et persiste
- [ ] Traduction FR/EN fonctionne
- [ ] Système de code fonctionne
- [ ] Tous les boutons sont fonctionnels
- [ ] Logs console sont informatifs
- [ ] Aucune dépendance externe manquante

## 🎉 Vous êtes Prêt!

L'application est complète et prête à être utilisée!

**Remarques:**
- Aucune compilation requise
- Aucune dépendance npm/pip
- Fonctionne sur tous les navigateurs modernes
- Design responsive et moderne
- Console logs détaillés pour debugging

**Amusez-vous bien avec Pokéice! 🎮**
