# Comptes de test : `TESTUSERBDD` dans le pseudo

Tout compte de test doit contenir **`TESTUSERBDD`** dans son pseudo (`TESTUSERBDD_like1`,
`testuserbdd_tradeA`, …). C'est le marqueur que le backend utilise pour supprimer d'un coup les
données de test sans toucher aux vrais joueurs : `minecard.backend` exécute à la main
`sql/schema/admin/clean_testuserbdd_accounts.sql`, qui efface tout compte dont le pseudo contient ce
texte.

## Ce que fait le jeu

`ProfileView` (dialogue « Modifier le pseudo ») :

1. à l'enregistrement, si le pseudo contient `TESTUSERBDD` (casse ignorée), **rien n'est
   enregistré** ;
2. un avertissement s'affiche dans la boîte de dialogue, avec le bouton « Oui, je suis un compte de
   test » (`[data-profile-name-test-warning]` dans `index.html`) ;
3. cliquer ce bouton enregistre le pseudo ; modifier le champ retire l'avertissement et redemande
   la confirmation.

Les clés de traduction sont `profile.name.testWarning` et `profile.name.testConfirm`
(`settings/i18n/fr.json` et `en.json`).

## Pourquoi un avertissement et pas un refus

Le marqueur est pratique : on crée un compte jetable en deux clics, on teste, on nettoie. Il ne doit
simplement jamais être choisi par un vrai joueur qui perdrait son compte au nettoyage suivant.

## Vérifier rapidement

Créez un compte, renommez-le `TESTUSERBDD_test1` : l'avertissement doit apparaître avant tout
enregistrement, et le pseudo ne doit changer qu'après confirmation. `curl` sur le worker ne suffit
pas, c'est une règle d'interface : le backend ne vérifie pas le marqueur.

Référence backend : `minecard.backend/doc/test-accounts.md`.
