# Application Android (Bubblewrap)

MineCards est une PWA : Bubblewrap en fait un **Trusted Web Activity** (TWA), c'est-à-dire une
application Android qui ouvre le jeu en plein écran, sans barre d'URL, à condition que le domaine
soit vérifié par Digital Asset Links.

Le projet Android est déjà généré, construit et vérifié dans
[`external/android`](../../external/android/) : voir son README pour les commandes de build, la clé
de signature et le dépannage.

## État actuel

| Élément | Valeur |
|---|---|
| Package | `fr.jmdev.minecards` |
| Empreinte SHA-256 | `60:DF:DD:72:9F:E9:F6:42:11:D1:D1:3C:9E:7F:5E:0A:1A:20:B4:92:83:2F:9B:5E:FB:FD:E9:72:21:15:A3:76` |
| Keystore | `~/.android/minecards-release.keystore` |
| Alias | `minecards` |
| Mot de passe | dans `~/.android/minecards-release.password` (hors dépôt) |
| Fichier servi | `https://web.jmdev.fr/.well-known/assetlinks.json` |
| Source du fichier | racine du dépôt du site, `../../../../.well-known/assetlinks.json` depuis ce dossier |

La clé existe déjà (RSA 2048, validité 10000 jours) : c'est elle qui produit l'empreinte ci-dessus,
donc l'`assetlinks.json` est cohérent tant que l'APK est signé avec. **Sauvegarde le keystore** :
s'il est perdu, il suffit de régénérer une clé et de mettre à jour l'empreinte tant que l'app n'est
pas publiée ; après publication, la clé devient définitive.

## Construire l'app

```bash
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://web.jmdev.fr/projets/minecards/manifest.json
```

Réponses à donner pendant `init` :

- **Application ID / package** : `fr.jmdev.minecards`
- **Signing key** : le keystore déjà créé (`~/.android/minecards-release.keystore`, alias
  `minecards`). Bubblewrap peut aussi générer sa propre clé : dans ce cas, remplace l'empreinte dans
  `assetlinks.json` par celle qu'il produit (voir plus bas).
- **Orientation** : Bubblewrap lit `orientation` du manifeste web et le recopie dans
  `twa-manifest.json`. Le manifeste déclare `portrait`, donc l'app reste verticale ; si `init` pose
  une autre valeur, corrige-la en `portrait` puis `bubblewrap update`.
- **Host / start URL** : `https://web.jmdev.fr`, chemin `/projets/minecards/`.

Puis :

```bash
bubblewrap build
```

Le build produit `app-release-signed.apk` (test) et `app-release-bundle.aab` (Play Store).

## Récupérer l'empreinte réelle

Depuis le keystore local :

```bash
keytool -list -v -keystore ~/.android/minecards-release.keystore -alias minecards \
  | grep "SHA 256"
```

Si l'app est distribuée par le Play Store, Google la re-signe : il faut **aussi** ajouter
l'empreinte du certificat **Play App Signing** (Play Console → Intégrité de l'app → Certificat de
signature de l'application), en plus de celle de la clé d'upload.

Bubblewrap sait aussi générer le fichier à partir de sa configuration :

```bash
bubblewrap fingerprint add <SHA-256>
bubblewrap fingerprint generateAssetLinks --output=assetlinks.json
```

## Mettre à jour `assetlinks.json`

Édite `../../../../.well-known/assetlinks.json` (racine du dépôt, pas le dossier du jeu) et garde
une entrée par certificat dans `sha256_cert_fingerprints`.

Rappels de déploiement :

- le fichier **doit** être servi à `https://web.jmdev.fr/.well-known/assetlinks.json` ; sous
  `/projets/minecards/` il ne serait jamais lu par le vérificateur ;
- GitHub Pages publie la racine de ce dépôt et Jekyll ignore les dossiers commençant par un point :
  c'est `_config.yml` (`include: [.well-known]`) qui rend le dossier publiable ;
- la modification doit arriver sur la branche publiée par GitHub Pages, et le site doit être en
  HTTPS.

## Vérifier

```bash
curl -s https://web.jmdev.fr/.well-known/assetlinks.json
```

Puis l'API Google :

```text
https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://web.jmdev.fr&relation=delegate_permission/common.handle_all_urls
```

La réponse doit contenir le package et l'empreinte. Enfin, installe l'APK sur un téléphone :
l'app doit s'ouvrir sans barre d'URL et rester en portrait. Si la barre reste visible, c'est
l'empreinte (ou l'accès au fichier) qui est en cause, pas le manifeste.

## Plusieurs projets sur le même domaine

Le fichier est unique pour `web.jmdev.fr` : il ne réserve pas le domaine à MineCards et n'empêche
pas de convertir un autre dossier de `projets/` en application Android. Chaque TWA ajoute sa propre
entrée au tableau, avec son package et son empreinte :

```json
[
  { "relation": ["delegate_permission/common.handle_all_urls"],
    "target": { "namespace": "android_app", "package_name": "fr.jmdev.minecards",
                "sha256_cert_fingerprints": ["60:DF:…:A3:76"] } },
  { "relation": ["delegate_permission/common.handle_all_urls"],
    "target": { "namespace": "android_app", "package_name": "fr.jmdev.autreprojet",
                "sha256_cert_fingerprints": ["…"] } }
]
```

- Une app **absente** du fichier n'est pas bloquée : elle s'installe et fonctionne, mais sans
  vérification, donc avec la barre d'URL du navigateur.
- Le scope des apps reste indépendant : chaque manifeste déclare son propre
  `/projets/<projet>/`, et les liens de l'une ne concernent pas l'autre.
- **Ne pas écraser le fichier** : `bubblewrap fingerprint generateAssetLinks` produit un tableau
  avec la seule entrée du projet courant. Fusionne les entrées (ou régénère le fichier depuis une
  source qui les contient toutes) au lieu de remplacer le fichier servi.
- Un autre host (autre sous-domaine ou domaine) demande son propre `/.well-known/assetlinks.json`
  à sa racine : les déclarations ne traversent pas les origines.

## Notes

- Le TWA n'a pas besoin de `related_applications` dans le manifeste web : la liaison se fait
  uniquement par `assetlinks.json`.
- Le service worker du jeu ne met jamais `/.well-known/` en cache.
- Ce dossier est public une fois déployé : n'y mets aucune valeur secrète (le mot de passe du
  keystore reste hors du dépôt).
