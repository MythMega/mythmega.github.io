# 🧪 Plan de Test - Pokéice

## 📋 Tests Fonctionnels

### A. Page Index (index.html)

#### A.1 Affichage Initial
- [ ] Page charge correctement
- [ ] Titre "Pokéice" s'affiche
- [ ] Deux sections visibles: "Nouvelle partie" et "Rejoindre une partie"
- [ ] Boutons 🌐 et 🌙 sont présents en bas droit
- [ ] Lien "Crédits" est visible

#### A.2 Bouton "Commencer"
- [ ] Clic sur "Commencer" redirige vers game.html
- [ ] Pas de paramètre Code dans l'URL
- [ ] Liste des Pokémons se charge rapidement

#### A.3 Bouton "Rejoindre"
- [ ] Clic avec code valide redirige vers game.html?Code=XXXX
- [ ] Code est correctement transféré dans l'URL
- [ ] Clic sur code vide: alerter l'utilisateur
- [ ] Touche Entrée fonctionne aussi

#### A.4 Traduction
- [ ] Clic sur 🌐 bascule FR ↔ EN
- [ ] Tous les textes changent
- [ ] Statut persiste après rechargement

#### A.5 Dark Mode
- [ ] Clic sur 🌙 active/désactive mode sombre
- [ ] Fond passe de clair à foncé
- [ ] Texte devient blanc en mode sombre
- [ ] Statut persiste après rechargement

### B. Page Game (game.html)

#### B.1 Grille de Jeu
- [ ] Grille 6 colonnes × 5 lignes
- [ ] Exactement 30 cartes Pokémons
- [ ] Chaque carte affiche:
  - [ ] Sprite valide
  - [ ] Nom en français/anglais
  - [ ] Icônes de type (1 ou 2)
  - [ ] Poids en kg
  - [ ] Taille en mètres
  - [ ] Index Pokédex (#XXX)
  - [ ] Région (Serie)

#### B.2 Interactions Shiny
- [ ] Clic sur ✨ remplace sprite par shiny
- [ ] Clic de nouveau reprend sprite normal
- [ ] Fonctionne pour chaque carte indépendamment

#### B.3 Interactions Disable
- [ ] Clic sur 🚫 grise la carte
- [ ] Texte devient moins visible
- [ ] Sprite devient noir et blanc (grayscale)
- [ ] Clic de nouveau réactive la carte

#### B.4 Boutons Globaux
- [ ] Bouton 🏠: Redirige vers index.html
- [ ] Bouton 🔄: Recharge game.html (nouveau code)
- [ ] Bouton 📋: Copie URL et affiche toast "Code copié"

#### B.5 Changement de Langue
- [ ] Clic sur 🌐 change langue
- [ ] Noms des Pokémons se mettent à jour
- [ ] Grille se redessine automatiquement

#### B.6 Changement de Dark Mode
- [ ] Fonctionne même pendant le jeu
- [ ] Grille reste lisible en mode sombre

### C. Page Credits (credits.html)

#### C.1 Contenu
- [ ] Titre "Crédits" visible
- [ ] Sections "À propos", "Sources", "Technologie"
- [ ] Liens vers sources de données
- [ ] Lien de retour vers index.html

#### C.2 Navigation
- [ ] Boutons 🌐 et 🌙 fonctionnent
- [ ] Traduction et dark mode active

### D. Système de Code

#### D.1 Génération
- [ ] Code généré automatiquement au lancement
- [ ] Code unique à chaque nouvelle partie
- [ ] Code est une chaîne hexadécimale valide
- [ ] Longueur = 120 caractères (30 × 4)

#### D.2 Encodage/Décodage
- [ ] Encodage produit une chaîne hex valide
- [ ] Décodage retrouve les indices exacts
- [ ] Inversibilité: encode(decode(x)) = x

#### D.3 Partage
- [ ] URL copiée contient ?Code=XXXX
- [ ] URL copiée est complète et valide
- [ ] Ouvrir URL copiée → mêmes Pokémons

#### D.4 Validation
- [ ] Code vide → erreur
- [ ] Code court → erreur
- [ ] Code long → erreur
- [ ] Code invalide (non-hex) → erreur et redirection

### E. Persistance (Cookies)

#### E.1 Langue
- [ ] Cookie `language` créé au changement
- [ ] Valeur correct (FR ou EN)
- [ ] Expiration: 365 jours
- [ ] Statut sur toutes les pages

#### E.2 Dark Mode
- [ ] Cookie `darkMode` créé au changement
- [ ] Valeur correcte (light ou dark)
- [ ] Expiration: 365 jours
- [ ] Statut sur toutes les pages

## 🔍 Tests de Console

### A. Logs d'Application

#### A.1 Démarrage
```
Console doit contenir:
✓ "🚀 Pokéice - Application Web"
✓ "📄 DOM chargé"
✓ "✅ Initialisation globale terminée"
✓ Logs colorés en cyan (#00ffff)
```

#### A.2 Actions Utilisateur
```
Pour chaque action, console doit afficher:
✓ Description de l'action
✓ Paramètres associés
✓ Statut (✅ succès ou ❌ erreur)
```

## 📱 Tests Responsivité

### A. Desktop (> 1024px)
- [ ] Grille 6 colonnes
- [ ] Boutons flottants bas droit
- [ ] Contenu lisible sans scroll horizontal

### B. Tablette (768px - 1024px)
- [ ] Grille 5 colonnes
- [ ] Mise en page adaptée
- [ ] Touch-friendly

### C. Mobile (480px - 768px)
- [ ] Grille 4 colonnes
- [ ] Boutons flottants accessibles
- [ ] Textes lisibles sans zoom

### D. Petit Mobile (< 480px)
- [ ] Grille 3 colonnes
- [ ] Tous les éléments accessibles
- [ ] Pas de débordement

## 🎨 Tests de Design

### A. Couleurs
- [ ] Boutons cyan #00d4ff en mode clair
- [ ] Boutons violet #b000ff en mode clair
- [ ] Mode sombre fond #1a1a1a
- [ ] Texte blanc en mode sombre

### B. Effets Visuels
- [ ] Lueur (glow) sur boutons au survol
- [ ] Transitions smooth (0.3s)
- [ ] Animations fadeIn au chargement
- [ ] Ombres (shadow) sur cartes

### C. Icônes Pokémons
- [ ] Tous les sprites chargent correctement
- [ ] Icônes de type visibles
- [ ] Pas d'icône cassée (fallback en place)

## 🌐 Tests Réseau

### A. Chargement des Ressources
- [ ] mons.json charge correctement
- [ ] Sprites pokemondb.net chargent
- [ ] Icônes Bulbapedia chargent
- [ ] Aucune erreur 404 (sauf assets oubliés)

### B. Gestion des Erreurs Réseau
- [ ] Si mons.json indisponible → alerter utilisateur
- [ ] Si sprite indisponible → afficher fallback
- [ ] Si icône indisponible → afficher placeholder
- [ ] Console logs des erreurs actifs

## 🔒 Tests de Sécurité

### A. Entrées Utilisateur
- [ ] Code accepte uppercase et lowercase
- [ ] Code rejeté avec caractères invalides
- [ ] Pas d'injection XSS possible
- [ ] Pas d'eval() ou innerHTML dangereux

### B. Stockage Local
- [ ] Cookies contiennent seulement texte
- [ ] Pas de données sensibles
- [ ] Cleanup automatique après 365 jours

## ⚡ Tests de Performance

### A. Chargement
- [ ] Grille affiche en < 1 seconde
- [ ] Pas de freezing lors du changement de langue
- [ ] Pas de lag lors de shiny/disable

### B. Mémoire
- [ ] Pas de fuite mémoire après interactions répétées
- [ ] DevTools Memory: pas augmentation constante

## 🎯 Scenarios Complets

### Scenario 1: Utilisateur Français
1. Accès index.html (langue par défaut: FR)
2. Clique "Commencer"
3. Vérifier grille en français
4. Clique ✨ sur un Pokémon
5. Clique 📋 pour copier code
6. Retour accueil
7. Rentre code et rejoint partie
8. Mêmes Pokémons s'affichent

### Scenario 2: Mode Sombre
1. Clique 🌙 pour activer dark mode
2. Vérifie fond gris foncé
3. Vérifie texte blanc
4. Rechargement page
5. Mode sombre persiste
6. Clique 🌙 pour désactiver
7. Mode clair revient

### Scenario 3: Partage de Partie
1. Utilisateur A: Commence jeu → Reçoit code
2. Copie code et l'envoie à l'ami
3. Utilisateur B: Entre code sur index
4. Grille identique s'affiche
5. Les deux joueurs voient mêmes Pokémons

### Scenario 4: Traduction Dynamique
1. Jeu en français avec partie lancée
2. Clique 🌐 pour passer en anglais
3. Noms Pokémons changent
4. Boutons textes changent
5. Grille redessine automatiquement
6. Rechargement persiste EN

## 📊 Matrice de Test

| Cas | Desktop | Tablet | Mobile | Dark | FR | EN |
|-----|---------|--------|--------|------|----|----|
| Index | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Game | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Credits | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Code | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Share | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## ✅ Résumé

**Tests Essentiels:**
1. [ ] Navigation entre pages fonctionne
2. [ ] Dark mode et langue persistent
3. [ ] Grille s'affiche correctement
4. [ ] Système de code fonctionne
5. [ ] Partage de partie fonctionne
6. [ ] Console logs informatifs
7. [ ] Responsive sur tous appareils
8. [ ] Tous les boutons fonctionnent

**Quand tout est ✓: Application Prête pour Production! 🚀**
