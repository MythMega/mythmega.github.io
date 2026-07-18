# Profil utilisateur — `profile.js`

## Vue d'ensemble

Le profil utilisateur est géré par `profile.js` et permet de définir un **pseudo** qui est affiché sur la page de statistiques.

**Note** : `profile.html` est une page obsolète qui redirige vers `data_management.html`.

## Pseudo

Stocké dans le cookie `pk_pseudo` (durée : 365 jours).

### Fonctions

```js
// Lecture
function getCookie('pk_pseudo') // Retourne le pseudo ou null

// Écriture
setCookie('pk_pseudo', 'MonPseudo', 365)

// Suppression
eraseCookie('pk_pseudo')
```

### UI

La fonction `ProfileInit()` est appelée au DOMContentLoaded :
1. Remplit l'input avec le pseudo sauvegardé (si existant)
2. Bouton **Sauvegarder** : valide (non vide, max 30 caractères) et sauvegarde
3. Bouton **Effacer** : supprime le cookie
4. Appui sur Entrée déclenche la sauvegarde

### Affichage du pseudo

Sur la page stats, le pseudo est affiché via `#statsPseudo` :

```js
function updatePseudo() {
    const pseudo = getCookie('pk_pseudo');
    const el = document.getElementById('statsPseudo');
    if (el) el.textContent = pseudo || '—';
}
```

## Badges et Titres

### Badges

Les badges débloqués (via le système de récompenses) sont affichés dans `#profileBadges` sur la page stats. Ce sont des images provenant de `data/reward.json`, filtrées par `type === 'Badge'`.

### Titre

Le plus haut titre débloqué (`type === 'Title'`) est affiché à la place du libellé "Pseudo" dans `#statsPseudoLabel`.

### Fonction d'affichage

```js
async function updateProfileBadgesAndTitle(currentLevel) {
    // Charge data/reward.json
    // Filtre les récompenses débloquées (level <= currentLevel)
    // Affiche les badges dans #profileBadges
    // Affiche le plus haut titre dans #statsPseudoLabel
}