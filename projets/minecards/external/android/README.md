# MineCards — application Android (TWA)

Projet Android généré par **Bubblewrap 1.27** : une Trusted Web Activity qui ouvre
`https://web.jmdev.fr/projets/minecards/` en plein écran, avec le Chrome du téléphone. Le jeu
n'est pas embarqué ni dupliqué : c'est la PWA complète (service worker, cache hors-ligne, WebGL,
audio, IndexedDB, téléchargements) qui tourne dans l'application.

## Valeurs du projet

| Élément | Valeur |
|---|---|
| Package | `fr.jmdev.minecards` |
| Host | `web.jmdev.fr` |
| URL de lancement | `https://web.jmdev.fr/projets/minecards/` |
| Scope (liens interceptés) | `/projets/minecards/` uniquement |
| Orientation | `portrait` (verrouillée) |
| Affichage | `standalone`, repli Custom Tabs |
| Notifications | délégation activée (`POST_NOTIFICATIONS`) |
| Version | `1.0.0` (`versionCode` 1) |
| SDK | min 24, cible/compilation 36 |
| Clé de signature | `C:/Users/mythm/.android/minecards-release.keystore`, alias `minecards` |
| Mot de passe | `~/.android/minecards-release.password` (hors dépôt) |
| Empreinte SHA-256 | `60:DF:DD:72:9F:E9:F6:42:11:D1:D1:3C:9E:7F:5E:0A:1A:20:B4:92:83:2F:9B:5E:FB:FD:E9:72:21:15:A3:76` |

Le scope est volontairement limité au sous-dossier du jeu : l'app n'intercepte pas les liens des
autres projets de `projets/`, même s'ils partagent le même domaine. La liaison Digital Asset Links
est décrite dans [docs/android](../../docs/android/README.md).

## Prérequis (Bubblewrap CLI)

- Node.js 18+ (installé : v22).
- **JDK 17** : Bubblewrap refuse toute autre version (`JDK version not found`). Le JDK 25 / 26
  installé sur la machine ne convient pas. Temurin 17 est attendu dans
  `C:/Users/mythm/.bubblewrap/jdk-17.0.11+9` ; Bubblewrap peut aussi le télécharger lui-même au
  premier lancement.
- Android SDK : `C:/Users/mythm/AppData/Local/Android/Sdk`, avec `cmdline-tools`, `platforms;android-36`
  et `build-tools;36.1.0` (Bubblewrap exige exactement cette version de build-tools).
- `npm i -g @bubblewrap/cli` (installé : 1.27.0).

Configurer les chemins une fois :

```bash
bubblewrap updateConfig \
  --jdkPath="C:/Users/mythm/.bubblewrap/jdk-17.0.11+9" \
  --androidSdkPath="C:/Users/mythm/AppData/Local/Android/Sdk"
bubblewrap doctor
```

## Construire

Sous Windows, `build.cmd` règle les pièges de l'environnement (mot de passe,
`NoDefaultCurrentDirectoryInExePath`, et shim npm qui perd les variables) puis appelle Bubblewrap :

```bat
cd external/android
build.cmd --skipPwaValidation
```

`--skipPwaValidation` n'est nécessaire que tant que le site n'est pas déployé : Bubblewrap valide
l'URL publique avant de construire.

Équivalent manuel :

```bash
cd external/android

# Les deux variables évitent les questions de mot de passe pendant le build.
export BUBBLEWRAP_KEYSTORE_PASSWORD="$(cat ~/.android/minecards-release.password)"
export BUBBLEWRAP_KEY_PASSWORD="$(cat ~/.android/minecards-release.password)"

bubblewrap build
```

Sous PowerShell :

```powershell
$env:BUBBLEWRAP_KEYSTORE_PASSWORD = Get-Content "$HOME/.android/minecards-release.password" -Raw
$env:BUBBLEWRAP_KEY_PASSWORD = $env:BUBBLEWRAP_KEYSTORE_PASSWORD
bubblewrap build
```

Le build produit :

- `app-release-signed.apk` — installation directe (`adb install -r app-release-signed.apk`) ;
- `app-release-bundle.aab` — envoi au Play Store.

Pour installer sur un téléphone branché en USB :

```bash
bubblewrap install
```

### Depuis Android Studio

Ouvrir ce dossier (`external/android`), laisser Gradle se synchroniser, puis *Build > Build Bundle(s)
/ APK(s)*. Dans *Settings > Build Tools > Gradle*, choisir le **Gradle JDK 17**
(`C:/Users/mythm/.bubblewrap/jdk-17.0.11+9`) : Gradle 8.11.1 ne supporte pas le JDK 25 embarqué par
Studio. Android Studio crée `local.properties` avec le chemin du SDK (fichier ignoré par Git).

## Mettre à jour le projet

Les fichiers Android sont générés : ne pas les modifier à la main, ils seraient écrasés. Modifier
`twa-manifest.json`, puis :

```bash
bubblewrap update            # incrémente la version et régénère le projet
bubblewrap update --skipVersionUpgrade   # régénère sans toucher à la version
```

`bubblewrap update` télécharge de nouveau l'icône et le manifeste web depuis `web.jmdev.fr` : il faut
donc que le site soit déployé. C'est aussi ce qui régénère `app-release-signed.apk`.

> Le projet a été généré avant le déploiement du site : `app/build.gradle` contient déjà
> l'`webManifestUrl` de production. Un `bubblewrap update` après mise en ligne produira exactement le
> même fichier.

## Vérifier l'application

```bash
adb install -r app-release-signed.apk
adb shell am start -n fr.jmdev.minecards/.LauncherActivity
```

Attendu : le jeu s'ouvre sans barre d'URL, reste en portrait, et fonctionne hors-ligne après une
première ouverture. Si la barre d'URL apparaît, c'est la vérification Digital Asset Links qui échoue
(empreinte, accès à `/.well-known/assetlinks.json`, ou APK signé avec une autre clé).

Le stockage de la TWA est **propre à l'application** : IndexedDB et cache ne sont pas partagés avec
Chrome. Pour reprendre une progression jouée dans le navigateur, passer par l'export/import de
sauvegarde (`.save`) de l'écran Réglages.

Build vérifié le 19/10/2026 : `app-release-signed.apk` (2,6 Mo) et `app-release-bundle.aab`
(2,7 Mo), signés avec le certificat dont l'empreinte est ci-dessus, `launchUrl`
`https://web.jmdev.fr/projets/minecards/`, `pathPrefix` limité au jeu, orientation `portrait`,
minSdk 24, targetSdk 36.

## Dépannage

- `'gradlew.bat' n'est pas reconnu` : l'environnement définit `NoDefaultCurrentDirectoryInExePath`,
  qui empêche `cmd` de trouver le wrapper dans le dossier courant. `build.cmd` le neutralise ; à la
  main, faire `set NoDefaultCurrentDirectoryInExePath=` avant `bubblewrap build`.
- `JDK version not found` : `bubblewrap doctor`, puis `bubblewrap updateConfig --jdkPath=...`.
- `Failed to find target with hash string 'android-36'` : installer `platforms;android-36` (SDK
  Manager) ; vérifier que `platforms/android-36/android.jar` existe.
- `minSdkVersion 21 cannot be smaller than 24` : le manifeste TWA doit rester à `minSdkVersion: 24`
  (android-browser-helper 2.7.4).

## Signer pour le Play Store

- L'APK/AAB local est signé avec la clé ci-dessus. Si l'app passe par le Play Store, Google la
  re-signe : ajouter l'empreinte **Play App Signing** (Play Console → Intégrité de l'app) dans
  `../../../../.well-known/assetlinks.json`, en plus de l'empreinte d'upload.
- Ne jamais committer le keystore ni le fichier de mot de passe : ils vivent sous `~/.android/`.
- Sauvegarder le keystore : après publication, la clé ne peut plus changer sans perte de mise à jour.
