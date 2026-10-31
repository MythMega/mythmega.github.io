# Presets

Chaque onglet peut sauvegarder ses réglages sous un nom, puis les recharger plus
tard. Les presets sont stockés dans un **cookie** : ils survivent au
rechargement de la page et sont séparés par onglet.

## Ce qu'un preset contient

| Onglet | Valeurs sauvegardées |
| --- | --- |
| **Autocut** | Seuil de silence, marge avant, marge après, durée minimale des clips, suffixe et format de sortie. |
| **Fastcut** | Suffixe de sortie (les bornes début/fin appartiennent au fichier importé, pas aux réglages globaux). |
| **Reverse** | Suffixe de sortie. |
| **Collage** | Suffixe de sortie (l'ordre et la liste des clips appartiennent à la session). |
| **Intro / Outro** | Suffixe de sortie (les fichiers intro/outro et les modes par vidéo ne sont pas persistés). |

Les overrides propres à une vidéo Autocut ne font pas partie des presets : un
preset décrit les réglages globaux.

## Utilisation

Les deux boutons se trouvent dans la carte de réglages, sous les paramètres, les
fondus et le format de sortie :

- **Sauvegarder un preset** ouvre une popup qui récapitule les valeurs qui
  seront enregistrées, puis demande un nom.
- **Charger un preset** ouvre la liste des presets de l'onglet. Chaque ligne
  affiche le nom, la date de création et un résumé des valeurs.

### Sauvegarde

- Le nom est obligatoire, limité à 40 caractères, et doit être **unique dans
  l'onglet** (comparaison insensible à la casse et aux espaces multiples).
- Un doublon affiche une erreur dans la popup et ne ferme pas la boîte, pour
  corriger le nom sans ressaisir le recap.
- Un preset enregistré est immédiatement disponible dans « Charger ».

### Chargement

- « Charger » remplace les réglages actuels de l'onglet, met à jour les
  curseurs et les champs numériques, puis sauvegarde `settings.params` dans
  `localStorage`.
- Les valeurs numériques sont bornées aux limites de `settings/config.json`
  avant d'être appliquées : un cookie modifié à la main ne peut pas produire un
  réglage hors plage.
- En Autocut, le chargement réutilise le même chemin qu'une modification
  manuelle : les rendus terminés deviennent « à relancer » si les paramètres ont
  changé, et le pré-calcul automatique repart si l'interrupteur est activé.

### Suppression

« Supprimer » demande une seconde confirmation (le bouton affiche « Confirmer
la suppression » pendant quelques secondes) puis retire le preset du cookie. La
liste se met à jour immédiatement.

## Stockage

- Un cookie par onglet : `bulkut.presets.autocut`, `bulkut.presets.fastcut`,
  `bulkut.presets.reverse`, `bulkut.presets.collage`,
  `bulkut.presets.introoutro`. Le préfixe vient de `app.storagePrefix`
  (`bulkut` par défaut) : le changer dans `settings/config.json` change aussi
  les noms de cookies.
- Format : JSON encodé en URI, `{ "v": 1, "presets": [...] }`, valable un an,
  `path=/`, `SameSite=Lax`.
- Taille maximale d'environ 3 900 caractères par cookie (limite des navigateurs
  autour de 4 Ko). Au-delà, l'enregistrement échoue avec le message
  `errors.presetTooLarge` : il faut supprimer des presets.
- Un cookie corrompu ou écrit par une autre version est ignoré (liste vide) et
  n'empêche pas l'application de démarrer.
- Si les cookies sont désactivés, la sauvegarde échoue avec
  `errors.presetStorage`.

Supprimer les cookies du site efface tous les presets.

## Ajouter des presets à un autre écran

`script/ui/preset-manager.js` construit les boutons, les deux popups et le
stockage. Il suffit de fournir un conteneur, les valeurs courantes, comment les
appliquer et comment les résumer :

```js
const presetManager = createPresetManager({
  i18n,
  toasts,
  scope: 'autocut',                     // autocut | fastcut | reverse | collage | introoutro
  sectionKey: 'nav.autocut',            // titre traduit de l'onglet
  storageKey: settings.storageKeys.presets,
  container: $('#autocut-presets', panel),
  getValues: () => ({ ...params }),
  applyValues: (values) => { /* valider, appliquer, persister */ },
  summarize: (values) => [{ label: i18n.t('common.suffix.label'), value: values.suffix }],
});
```

Appeler `presetManager.refresh()` depuis `feature.refresh()` pour traduire les
boutons lors d'un changement de langue.

## Tests

`tests/presets.test.js` couvre les fonctions pures de
`script/core/presets.js` : normalisation des noms, unicité insensible à la
casse, encodage/décodage du cookie et tolérance aux données corrompues. Le
stockage cookie lui-même (`document.cookie`) est vérifié manuellement dans le
navigateur.
