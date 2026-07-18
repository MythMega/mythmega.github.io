# Composants UI

## Vue d'ensemble

Les composants UI partagés sont principalement dans `ui.js` (pour le mode Marathon) et intégrés directement dans `daily.js` et `weekly.js` pour leurs modes respectifs.

---

## Notifications (`#notifications`)

Système de notifications temporaires (toast) partagé par tous les modes.

```js
function showNotification(message, type = 'info') {
    const n = document.createElement('div');
    n.className = 'notification';
    n.textContent = message;
    if (type === 'fail') n.style.background = '#491111';
    if (type === 'hint') n.style.background = '#334155';
    notif.appendChild(n);
    setTimeout(() => {
        n.style.opacity = 0;
        try { notif.removeChild(n); } catch (e) {}
    }, 1600);
}
```

| Type | Couleur | Usage |
|---|---|---|
| `info` / `success` | Défaut (accent) | Succès, copie, etc. |
| `fail` | Rouge foncé | Erreurs, échecs |
| `hint` | Gris foncé | Indices affichés |

---

## Autocomplete (Dropdown)

Système de suggestions personnalisé pour l'input de nom de Pokémon.

### Structure HTML

```html
<div class="autocomplete-wrapper">
    <input id="dailyInput" type="text" autocomplete="off" />
    <div id="namesDropdown" class="autocomplete-dropdown hidden"></div>
</div>
```

### Fonctionnement

1. À chaque `input`, filtre les Pokémon dont le nom (FR ou EN) contient la chaîne normalisée
2. Limite à 40 suggestions max
3. Navigation au clavier : `ArrowDown`, `ArrowUp`, `Escape`, `Enter`
4. Au clic ou Enter : remplit l'input et soumet la réponse
5. Au `blur` : ferme le dropdown après 150ms (pour laisser le temps au clic)

### Normalisation

```js
function normalizeStr(s) {
    return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
```

### Validation des noms

```js
function isValidName(val) {
    // Vérifie que le nom existe dans la liste complète des Pokémon (FR ou EN)
    // Si invalide : animation shake + notification "Nom invalide"
}
```

---

## Jauge de score (`#attemptGauge`)

Barre verticale qui montre les points potentiels pour la prochaine réponse correcte.

```html
<div id="attemptGauge" class="gauge-container">
    <div class="gauge-fill" style="height:100%"></div>
    <div class="gauge-label">+10</div>
</div>
```

- Hauteur = `(pointsActuels / pointsMax) * 100%`
- Label = `+N` points

---

## Pastilles de progression (Round dots)

Indicateurs visuels pour chaque round (5 pour Daily, 10 pour Weekly).

```html
<div id="round-dot-0" class="round-dot completed"></div>
<div id="round-dot-1" class="round-dot imperfect"></div>
<div id="round-dot-2" class="round-dot active"></div>
<div id="round-dot-3" class="round-dot"></div>
<div id="round-dot-4" class="round-dot failed"></div>
```

| Classe | Signification |
|---|---|
| `completed` | 🟩 Trouvé du 1er coup |
| `imperfect` | 🟧 Trouvé après échecs |
| `failed` | 🟥 Échec |
| `active` | Round en cours |

---

## Écran de révélation (`#dailyReveal` / `#weeklyReveal`)

Affiche les informations du Pokémon après l'avoir trouvé ou après échec.

```html
<div id="dailyReveal" class="hidden">
    <p>Génération : <span id="dGen"></span></p>
    <p>Index : <span id="dIndex"></span></p>
    <p>Type 1 : <span id="dT1"></span></p>
    <p>Type 2 : <span id="dT2"></span></p>
    <img id="dailyImg" src="" />
</div>
```

---

## Écran de fin / Partage (`#afterDone`)

Affiché après avoir complété un Daily ou Weekly.

```html
<div id="afterDone" class="hidden">
    <div id="shareTextArea"></div>
    <button id="copyShare">Copier (standard)</button>
    <button id="copyMiniShare">Copier (mini)</button>
    <button id="copyDiscordShare">Copier + Discord</button>
    <button id="viewDetails">Détails</button>
    <div id="dailyFullImages"></div>
</div>
```

### Formats de partage

**Standard** (5 lignes de 5 carrés) :
```
Pokefeet Daily — 2026-07-09 — score 42
🟩🟩🟩🟩🟩
🟧🟧🟩🟩🟩
🟥🟥🟥🟥🟥
🟩🟩🟩🟩🟩
🟧🟩🟩🟩🟩
```

**Mini** (1 ligne avec 1 emoji par round) :
```
Pokefeet Daily (mini) — 2026-07-09 — score 42
🟩 🟧 🟥 🟩 🟧
```

**Avec échecs** (ajouté automatiquement au texte copié) :
```
R1 : ||Pikachu|| ||Carapuce||
R3 : ||Salamèche||
```

---

## Bannière Nouveau Pokémon

```html
<div class="new-pokemon-banner">
    <div class="npb-star">✨</div>
    <div class="npb-label">Nouveau Pokémon !</div>
    <div class="npb-name">Bulbizarre</div>
</div>
```

Affichée pendant 3.4 secondes quand un Pokémon est trouvé pour la première fois.

---

## Animation Shake

Pour les entrées invalides :

```css
@keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-8px); }
    75% { transform: translateX(8px); }
}
.shake {
    animation: shake 0.4s ease-in-out;
}
```

---

## Badges de types

```html
<span class="type-badge t-fire">Feu</span>
<span class="type-badge t-water">Eau</span>
```

Utilisés dans les indices pour afficher les types avec leur couleur associée.

---

## Popup Dex

```html
<div id="dexPopup" style="display:none">
    <div id="popupDetails">
        <!-- Contenu généré dynamiquement -->
    </div>
    <button id="closePopup">Fermer</button>
</div>
```

Popup modale pour les détails d'un Pokémon dans le Dex. Fermeture par clic sur le bouton, clic extérieur, ou Escape.