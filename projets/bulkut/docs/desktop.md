# Application desktop

`software/` contient **Bulkut Desktop**, une application native qui reprend les
six outils de [`pro.html`](../pro.html) avec FFmpeg natif. Elle lit les
fichiers directement sur le disque : aucune limite d'import, aucun navigateur,
aucun envoi réseau.

L'interface est construite avec **Avalonia 12** (et non WinForms) pour produire
la même application sur Windows, Linux et macOS à partir d'une seule base de
code. Le projet WinForms d'origine a été remplacé ; il n'en reste aucune
dépendance.

Depuis, l'interface vit dans `Bulkut.Shared` et sert aussi de base au portage
Android ([android.md](android.md)) : seules les têtes desktop et mobile
changent, les vues et les styles sont communs.

## Fonctionnalités

| Onglet | Comportement desktop |
| --- | --- |
| **Autocut** | Liste de vidéos, réglages globaux, override par vidéo, sortie MP4 / séquence Premiere / timeline DaVinci, extrait d'une minute annulable, pré-calcul de durée manuel ou automatique après 3 s, suffixe, presets, file avec « passer », « annuler les suivants » et « tout arrêter ». |
| **Fastcut** | Un fichier à la fois, durée détectée, sliders début/fin synchronisés avec les timecodes `hh:mm:ss`, suffixe, presets. |
| **Reverser** | Inversion vidéo + audio, suffixe, presets. |
| **Collage** | Plusieurs clips, réordonnancement par glisser-déposer ou flèches, suppression, durée totale recalculée, rendu unique. |
| **Intro / Outro** | Intro et outro communs au-dessus de la liste, mode par vidéo (les deux, intro seule, outro seule), durée prévue recalculée à chaque changement, rendu indépendant. |
| **Splitter** | Une vidéo, autant de segments que voulu, début/fin au slider ou au timecode, un fichier final numéroté par segment. |

Les réglages, les presets et la langue sont persistés entre deux lancements dans
le dossier de données de l'application :

- Windows : `%APPDATA%\JMD\bulkut\state.json` ;
- macOS : `~/Library/Application Support/JMD/bulkut/state.json` ;
- Linux : `~/.config/jmd/bulkut/state.json`.

Le fichier `state.json` contient les paramètres, les presets de chaque onglet et
le dernier dossier de sortie. Une ancienne installation Windows
(`%APPDATA%\Bulkut`) est copiée automatiquement au premier lancement.

## Démarrage

Prérequis : [.NET SDK 10](https://dotnet.microsoft.com/download).

```bash
cd software
dotnet run --project Bulkut/Bulkut.csproj
```

Au premier lancement, l'application cherche FFmpeg dans cet ordre :

1. la variable d'environnement `BULKUT_FFMPEG` ;
2. `./ffmpeg/ffmpeg.exe` (ou `./ffmpeg/ffmpeg` sur Unix), à côté de l'exécutable ;
3. `./ffmpeg.exe` à côté de l'exécutable ;
4. `./ffmpeg/ffmpeg` dans le dossier courant.

Si aucun binaire n'est trouvé :

- un build de release embarque FFmpeg dans l'exécutable et l'extrait dans
  `./ffmpeg/` au premier lancement ;
- un build de développement télécharge le binaire correspondant à la plateforme
  depuis `software/Bulkut.Core/Assets/desktop.json`.

Si le dossier de l'application est en lecture seule (par exemple
`C:\Program Files`), l'extraction bascule vers le dossier de données local de
l'utilisateur. Pour rester portable, placer l'exécutable dans un dossier
inscriptible.

## Build d'un exécutable unique

Le point d'entrée demandé est [`software/build.bat`](../software/build.bat) :

```bat
cd software

build.bat                 :: menu interactif (voir ci-dessous)
build.bat all             :: tests + Windows, Linux, macOS, APK Android
build.bat win             :: Windows seulement
build.bat linux           :: Linux x64
build.bat mac             :: macOS Intel + Apple Silicon
build.bat android         :: APK Android (voir android.md)
build.bat clean           :: nettoie bin/obj/dist
build.bat win -NoTests    :: publish rapide sans tests
build.bat win -NoFfmpeg   :: exécutable sans FFmpeg embarqué (téléchargé au lancement)
```

Lancé sans argument, `build.bat` propose quatre scénarios :

1. export complet (tests + Windows, Linux, macOS et Android) ;
2. build Windows uniquement, sans tests ;
3. tests uniquement ;
4. APK Android uniquement.

`build.bat` appelle [`build.ps1`](../software/build.ps1), qui :

1. copie `settings/config.json`, `settings/default.json` et les trois
   traductions dans `Bulkut.Core/Assets/` (source unique : les JSON du web) ;
2. lance `dotnet test` sauf avec `-NoTests` ;
3. télécharge FFmpeg `n8.1.2-1` depuis
   [shaka-project/static-ffmpeg-binaries](https://github.com/shaka-project/static-ffmpeg-binaries/releases/tag/n8.1.2-1)
   dans `software/ffmpeg-cache/<rid>/`, puis l'embarque dans l'assembly ;
4. publie en **self-contained, single-file, compressé**, avec les bibliothèques
   natives extraites à l'exécution ;
5. renomme la sortie et nettoie le dossier intermédiaire.

Résultat dans `software/dist/` :

| Fichier | Plateforme | Taille indicative |
| --- | --- | --- |
| `Bulkut-win-x64.exe` | Windows 10/11 x64 | ~68 Mo |
| `Bulkut-linux-x64` | Linux x64 | ~66 Mo |
| `Bulkut-osx-x64` | macOS Intel | ~66 Mo |
| `Bulkut-osx-arm64` | macOS Apple Silicon | ~62 Mo |
| `Bulkut-android.apk` | Android 7+ (arm64, x86_64) | ~60 Mo |

L'APK ne suit pas la même logique : il embarque les bibliothèques natives
FFmpegKit au lieu d'un exécutable, et l'interface est celle de `pro.html`
adaptée au mobile. Voir [android.md](android.md).

Chaque fichier est autonome : le runtime .NET, Avalonia, les JSON et FFmpeg sont
inclus. Aucun dossier annexe n'est nécessaire pour lancer l'application.

Le build croisé fonctionne depuis Windows. Les binaires Unix doivent être rendus
exécutables après un téléchargement :

```bash
chmod +x Bulkut-linux-x64
./Bulkut-linux-x64
```

Sur macOS, si Gatekeeper bloque le binaire téléchargé :

```bash
xattr -d com.apple.quarantine Bulkut-osx-arm64
chmod +x Bulkut-osx-arm64
./Bulkut-osx-arm64
```

## Publication

Les URLs sont centralisées dans `settings/config.json` :

```json
"downloads": {
  "version": "1.0.0",
  "baseUrl": "https://github.com/MythMega/mythmega.github.io/releases/latest/download",
  "files": {
    "windows": "Bulkut-win-x64.exe",
    "linux": "Bulkut-linux-x64",
    "macosIntel": "Bulkut-osx-x64",
    "macosAppleSilicon": "Bulkut-osx-arm64",
    "android": "Bulkut-android.apk"
  }
}
```

Pour publier :

1. lancer `build.bat` ;
2. créer une release GitHub (tag `desktop-v1.0.0` par exemple) et y joindre les
   fichiers de `dist/` avec exactement ces noms ;
3. mettre à jour `downloads.version` et, si besoin, `downloads.baseUrl`.

La page [`download.html`](../download.html) lit ces valeurs, marque la
plateforme détectée et affiche « build pas encore publié » si un fichier manque.
Le bouton « Version desktop » du header et le lien du footer y mènent depuis
`index.html` et `pro.html`.

## Tests

```bash
cd software
dotnet test Bulkut.Tests/Bulkut.Tests.csproj
```

La suite couvre :

- timecodes (conversion, arrondis, formatage) ;
- détection des silences, marges, durée minimale, fenêtre d'extrait ;
- concaténation (taille cible, graphe de filtres, durée) ;
- parsing des stats FFmpeg et ETA ;
- noms de fichiers et suffixes ;
- planification intro/outro (modes disponibles, durée prévue) ;
- presets et configuration (noms uniques, langue, fusion des valeurs) ;
- un test d'intégration qui génère de vraies vidéos avec FFmpeg et vérifie les
  cinq pipelines (ignoré automatiquement si FFmpeg est absent).

## Limites

- **Un seul processus FFmpeg à la fois** : un sémaphore global sérialise les
  rendus, même si plusieurs onglets sont ouverts. FFmpeg utilise en revanche
  tous les cœurs disponibles (`processing.threads` vaut `0` par défaut).
- Le single-file extrait ses bibliothèques natives dans un dossier temporaire
  au démarrage (comportement .NET) ; c'est transparent pour l'utilisateur.
- Le binaire macOS produit est un exécutable, pas un bundle `.app` : il se lance
  depuis le Finder ou le Terminal, sans icône dans le Dock tant qu'il n'est pas
  empaqueté.
- Les fichiers restent sur le disque ; les résultats sont enregistrés dans le
  dossier de sortie choisi (Téléchargements par défaut) et jamais envoyés.
