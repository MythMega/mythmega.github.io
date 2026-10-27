# Application Android

`software/Bulkut.Android` est le portage mobile de l'application native. Il
partage **toute** l'interface Avalonia avec la version desktop : mêmes six
onglets, mêmes réglages, mêmes presets, mêmes fichiers `settings/*.json` et
`translations/*.json`. Seule la couche qui parle à FFmpeg et au système change.

> Prérequis : .NET SDK 10 avec la charge de travail `android`
> (`dotnet workload install android`), et un SDK Android (API 36).

## Trois projets, une interface

```
Bulkut.Shared   interface Avalonia : App, MainView, vues, styles, dialogues
Bulkut          tête desktop : fenêtre, icône, single-file
Bulkut.Android  tête mobile : activité, manifeste, FFmpegKit, chemins Android
Bulkut.Core     logique pure : pipelines, presets, réglages, parsing
```

`Bulkut.Shared` ne contient aucune référence à une plateforme : il s'appuie sur
`OperatingSystem.IsAndroid()` et sur un indicateur `Ui.CompactLayout` pour
empiler le panneau de réglages au-dessus de la liste des vidéos, seul agencement
lisible sur un téléphone.

## FFmpeg embarqué

Android interdit de lancer un exécutable depuis le bac à sable d'une
application : `Bulkut.Core/Services/ProcessFfmpegRunner.cs` n'y est donc pas
utilisé. La tête mobile fournit à la place un `IFfmpegRunner` basé sur
[FFmpegKit](https://github.com/sbokatuk/FFmpegKit.Android) :

- variante **FullGpl** (`FFmpegKit.Net.FullGpl.Android`), la seule qui embarque
  `libx264` — les réglages de rendu du web et du desktop restent valables tels
  quels ;
- bibliothèques `arm64-v8a` et `x86_64`, rien à télécharger au lancement ;
- au démarrage, un `ffmpeg -version` charge la bibliothèque : si elle ne charge
  pas, l'écran d'erreur moteur s'affiche au lieu d'un échec au premier rendu ;
- chaque commande est convertie en ligne unique, guillemets compris, par
  `FfmpegCommandLine` (testé dans `Bulkut.Tests`), puis son transcript complet
  est relu **une ligne à la fois** : c'est exactement l'entrée qu'attendent
  l'analyse des silences et le parsing des médias.

FFmpegKit ne tourne jamais sur le fil d'interface : le chargement de la
bibliothèque native prend plusieurs secondes à froid et bloquerait l'UI
(« Bulkut isn't responding »). Les commandes passent par `Task.Run`, et un
sémaphore global dans `FfmpegService` garantit un seul rendu à la fois, comme
sur desktop.

## Fichiers et sorties

| Élément | Emplacement |
| --- | --- |
| Réglages, presets, langue | `/data/user/0/com.jmd.bulkut/files/state/state.json` |
| Vidéos importées | copiées dans le cache de l'application avant analyse |
| Rendus | `Android/data/com.jmd.bulkut/files/Bulkut/` |

Android ne donne pas de chemin réel pour un fichier choisi : le sélecteur rend
une URI `content://` que FFmpeg ne sait pas ouvrir. `FilePicker` copie donc le
fichier dans un sous-dossier du cache (en gardant son nom d'origine) avant de
l'ajouter à la liste. Le dossier de sortie n'est pas configurable, et l'action
« ouvrir le dossier » devient un partage système (`FileProvider` + feuille de
partage) pour envoyer ou enregistrer le rendu.

## Interface

- Le panneau de réglages passe **au-dessus** de la liste des vidéos, et les
  onglets défilent horizontalement.
- Les boîtes de dialogue (réglages d'une vidéo, presets) s'affichent en
  superposition dans la fenêtre : `Window.ShowDialog` n'existe pas en mode
  « vue unique ». `DialogHost` choisit la fenêtre sur desktop, la couche
  intégrée ailleurs, et le même contenu sert aux deux.
- Le glisser-déposer et la mention « aucun envoi » laissent place à
  « Touchez pour choisir vos vidéos » et à une note sur la copie dans le cache.
- Le bouton « version web » ouvre le navigateur par un `Intent`.

## Build

```bat
cd software
build.bat android          :: APK seul, sans tests
build.bat                  :: menu : export complet, Windows, tests, Android
```

`build.ps1` publie avec `dotnet publish -c Release -f net10.0-android36.0
-p:AndroidPackageFormats=apk`, prend le fichier `*-Signed.apk` produit et le
copie en `software/dist/Bulkut-android.apk`. Ce nom est celui attendu par
`settings/config.json` (`downloads.files.android`) et par la page
[`download.html`](../download.html).

L'APK est signé avec la clé de développement tant qu'aucun keystore n'est
configuré (`AndroidSigningKeyStore`). Pour publier sur un store, fournir un
keystore et son mot de passe au `dotnet publish`.

## Vérifications effectuées

Sur un émulateur API 37 (`x86_64`), avec l'APK de release :

- démarrage à froid, moteur « Native engine ready » ;
- import d'un MP4 par le sélecteur système (copie dans le cache) ;
- sonde : durée, flux vidéo et audio détectés ;
- autocut complet : analyse des silences puis rendu `android-test-autocut.mp4`
  dans le dossier de sortie ;
- ouverture d'une boîte de dialogue (preset) en superposition.

## Limites connues

- Pas de glisser-déposer, ni de choix du dossier de sortie : Android impose ses
  propres sélecteurs.
- L'import copie le fichier dans le cache : prévoir de la place libre pour de
  grosses vidéos.
- La variante GPL de FFmpegKit place l'APK sous GPL-3.0, comme les binaires
  FFmpeg embarqués dans les builds desktop.
- Le rendu utilise tous les cœurs disponibles ; il n'y a pas encore de réglage
  de threads spécifique au mobile.
