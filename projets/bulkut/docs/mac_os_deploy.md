# Déploiement macOS

Cette page explique quel fichier macOS télécharger, comment l'installer, et
pourquoi la version macOS porte le tag **Alpha** sur la page de téléchargement.

Le build macOS est produit depuis Windows (compilation croisée) par
`software/build.ps1`. Il ne peut pas être signé ni notarié sur cette machine :
voir [Pourquoi Alpha](#pourquoi-le-tag-alpha).

## Les deux fichiers macOS

| Fichier | Architecture | Usage |
| --- | --- | --- |
| `Bulkut-macos-arm64.zip` | Apple Silicon (M1, M2, M3, M4…) | **Recommandé** sur les Mac récents. |
| `Bulkut-macos-x64.zip` | Intel x64 | Mac Intel (2015 et avant pour l'essentiel). |

Chaque ZIP contient une application `Bulkut.app` prête à glisser dans
`/Applications` : FFmpeg est déjà embarqué dans l'exécutable, rien d'autre à
télécharger.

Le build laisse aussi les binaires bruts `Bulkut-osx-arm64` et
`Bulkut-osx-x64` dans `software/dist/`. Ils servent au dépannage ou aux scripts,
mais ils n'ont ni icône, ni intégration Dock : préférer le ZIP.

## Quel fichier choisir

### Méthode graphique

1. Menu  → **À propos de ce Mac**.
2. Lire la ligne **Puce** ou **Processeur** :
   - « Puce Apple M1 / M2 / M3 / M4 » → `Bulkut-macos-arm64.zip` ;
   - « Processeur Intel Core… » → `Bulkut-macos-x64.zip`.

### Méthode Terminal

```bash
uname -m
# arm64   -> Bulkut-macos-arm64.zip
# x86_64 -> Bulkut-macos-x64.zip
```

### Cas particuliers

- **Apple Silicon avec Rosetta 2** : le fichier Intel fonctionne si Rosetta est
  installé (`softwareupdate --install-rosetta --agree-to-license`), mais il est
  plus lent et consomme plus de mémoire. Toujours préférer `arm64`.
- **Mac Intel** : `arm64` ne démarrera pas du tout (« Bad CPU type in
  executable »).
- **macOS minimum** : 12 Monterey. L'application cible `net10.0` avec Avalonia,
  testée sur macOS 12+.

## Installation de l'application (.app)

1. Télécharger `Bulkut-macos-arm64.zip` (ou `-x64`).
2. Double-cliquer sur le ZIP : l'utilitaire d'archive crée `Bulkut.app`.
3. Glisser `Bulkut.app` dans le dossier **Applications**.
   Sans droits administrateur, créer `~/Applications` et l'y déposer : cela
   fonctionne aussi.
4. Premier lancement : macOS bloque une application non signée.
   - **macOS 12 à 14** : clic droit (ou Ctrl + clic) sur `Bulkut.app` →
     **Ouvrir** → confirmer **Ouvrir**.
   - **macOS 15 et plus** : double-cliquer, puis suivre le message →
     **Réglages Système** → **Confidentialité et sécurité** → section
     **Sécurité** → **Ouvrir quand même**, puis relancer l'application.
5. Le premier démarrage prend quelques secondes : Bulkut extrait FFmpeg dans
   son bundle, puis affiche « Moteur natif prêt ».

### Alternative en Terminal

Si le dialogue de sécurité ne propose pas « Ouvrir quand même », retirer
manuellement l'attribut de quarantaine du bundle téléchargé :

```bash
xattr -dr com.apple.quarantine /Applications/Bulkut.app
open /Applications/Bulkut.app
```

C'est la même opération que le bouton « Ouvrir quand même », sans passer par
l'interface. À ne faire que pour un fichier récupéré depuis la page de
téléchargement officielle.

### Où vont les fichiers

| Élément | Emplacement |
| --- | --- |
| Application | `/Applications/Bulkut.app` (ou `~/Applications`) |
| FFmpeg extrait au premier lancement | `Bulkut.app/Contents/MacOS/ffmpeg/ffmpeg` |
| Réglages et presets | `~/Library/Application Support/JMD/bulkut` |
| Sorties par défaut | `~/Downloads` (dossier modifiable dans l'application) |

Supprimer le dossier `Contents/MacOS/ffmpeg` force une nouvelle extraction au
lancement suivant : utile si le binaire a été corrompu par une copie partielle.
Si le bundle n'est pas inscriptible (lançé depuis une image disque, par
exemple), Bulkut bascule sur `~/Library/Application Support/Bulkut/ffmpeg`.

## Installation du binaire brut (avancé)

Le ZIP est recommandé, mais les fichiers `Bulkut-osx-*` restent publiés pour les
scripts et le diagnostic. Après téléchargement, macOS retire le bit exécutable
et ajoute la quarantaine :

```bash
xattr -d com.apple.quarantine Bulkut-osx-arm64
chmod +x Bulkut-osx-arm64
./Bulkut-osx-arm64
```

Sans `chmod +x`, le Terminal répond « Permission denied ». Sans `xattr`, macOS
peut afficher « impossible d'ouvrir car le développeur est non identifié ».
L'application s'ouvre alors sans icône dans le Dock et sans entrée dans le
Launchpad ; c'est normal pour un binaire nu.

## Pourquoi le tag Alpha

Le tag Alpha de la page de téléchargement signale trois choses :

1. **Pas de signature ni de notarisation Apple.** Le build est produit sous
   Windows et il n'existe pas de certificat *Developer ID Application*. macOS
   bloque donc le premier lancement tant que l'utilisateur n'a pas confirmé
   « Ouvrir quand même ».
2. **Gatekeeper évolue.** Chaque version majeure de macOS déplace ce dialogue ;
   le parcours décrit ci-dessus peut changer d'une release à l'autre.
3. **Pas de mise à jour automatique.** Il faut retélécharger le ZIP pour passer
   à une nouvelle version.
4. **Icône générique.** Le bundle n'embarque pas encore d'icônes `.icns` :
   Finder affiche l'icône d'application par défaut.

Pour sortir du tag Alpha, il faut un compte **Apple Developer Program** et une
machine macOS pour signer puis notarier :

```bash
# Sur un Mac, après avoir récupéré Bulkut.app
codesign --deep --force --options runtime \
  --sign "Developer ID Application: VOTRE NOM (TEAMID)" Bulkut.app
ditto -c -k --keepParent Bulkut.app Bulkut.zip
xcrun notarytool submit Bulkut.zip --apple-id … --team-id … --password … --wait
xcrun stapler staple Bulkut.app
```

Le reste de la chaîne (embarquement de FFmpeg, `Info.plist`, ZIP avec droits
Unix) peut rester dans `build.ps1` : seule la signature exige macOS.

## Reconstruire les fichiers macOS

```bat
cd software
build.bat
REM menu 1 : tout, ou en ligne de commande :
powershell -File build.ps1 -Target mac
```

La cible `mac` compile `osx-x64` et `osx-arm64`, puis crée :

```text
software/dist/Bulkut-macos-arm64.zip
software/dist/Bulkut-macos-x64.zip
software/dist/Bulkut-osx-arm64        (binaire brut)
software/dist/Bulkut-osx-x64          (binaire brut)
```

Le script construit le bundle (`Contents/Info.plist`, `Contents/MacOS/Bulkut`,
`Contents/PkgInfo`) et l'archive en conservant les droits Unix : l'exécutable
garde le mode `755`, sinon macOS refuserait de le lancer après extraction.

`Info.plist` déclare `com.jmd.bulkut`, `CFBundleExecutable = Bulkut`, la
catégorie `public.app-category.video` et `LSMinimumSystemVersion = 12.0`.

## Désinstallation

1. Quitter Bulkut.
2. Glisser `Bulkut.app` dans la corbeille.
3. Supprimer les réglages et presets si souhaité :

```bash
rm -rf ~/Library/Application\ Support/JMD/bulkut
```

Les vidéos rendues restent dans le dossier de sortie choisi ; Bulkut ne les
supprime jamais.

## Dépannage

| Symptôme | Cause | Solution |
| --- | --- | --- |
| « Impossible d'ouvrir car le développeur est non identifié » | Application non signée | Clic droit → Ouvrir, ou Réglages Système → Confidentialité et sécurité → Ouvrir quand même. |
| « Bulkut est endommagé et ne peut pas être ouvert » | Attribut de quarantaine | `xattr -dr com.apple.quarantine /Applications/Bulkut.app`. |
| « Bad CPU type in executable » | Mauvaise architecture | Télécharger l'autre ZIP (`arm64` sur Apple Silicon, `x64` sur Intel). |
| « Permission denied » au lancement du binaire brut | Bit exécutable perdu | `chmod +x Bulkut-osx-arm64`. |
| L'icône saute dans le Dock puis l'app se ferme | Extraction FFmpeg impossible | Vérifier que le bundle est dans un dossier inscriptible (`~/Applications`), relancer, consulter Console.app. |
| « Moteur FFmpeg indisponible » | Extraction incomplète | Supprimer `Bulkut.app/Contents/MacOS/ffmpeg`, relancer l'application. |
| Le ZIP extrait un dossier sans extension `.app` | Archive décompressée par un outil tiers | Utiliser l'utilitaire d'archive de macOS, ou renommer le dossier en `Bulkut.app`. |

En cas de doute sur une version, comparer la taille du fichier avec celle
affichée sur la page de téléchargement, ou relancer `build.ps1` pour produire un
artefact neuf.
