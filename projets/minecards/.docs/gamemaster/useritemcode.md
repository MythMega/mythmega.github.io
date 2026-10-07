# Codes `useritem` : fonctionnement & algorithme de génération

Un code `useritem` est un code **personnel** : il ne fonctionne que pour **un UUID**, offre **un item en une quantité donnée**, et ne peut être utilisé **qu'une fois**. L'app le vérifie **sans serveur**.

Exemple : `040G-40R4-0M2R-Q5R0-0CG6-BF0Z-HP5Q-WZ30`

Lien direct : `index.html?Redeem=040G-40R4-0M2R-Q5R0-0CG6-BF0Z-HP5Q-WZ30`

## 1. Principe
- Le code contient : version, nonce aléatoire, empreinte de l'item, quantité, empreinte courte de l'UUID, et une signature (MAC).
- L'UUID complet n'est **pas écrit** dans le code (128 bits le rendraient trop long). Il est **lié cryptographiquement** : le MAC est calculé avec l'UUID complet. Un autre compte recalcule un MAC différent et refuse le code.
- L'usage unique est local : l'app inscrit le code dans `redeemed_codes` à la réclamation.
- Le game master ne peut pas "annuler" un code déjà donné côté app ; son registre (§6) sert à ne jamais émettre deux fois le même.

## 2. Modèle de sécurité (à lire)
La vérification se fait dans le navigateur, donc la clé secrète `K` est présente dans `settings/config.json`. **Quiconque l'extrait peut fabriquer des codes valides pour n'importe quel UUID.** Ce système empêche : deviner un code, réutiliser le code d'un autre, modifier la quantité ou l'item d'un code. Il n'empêche pas un attaquant motivé de lire `K` dans les sources, ni de contourner l'usage unique en vidant sa base locale. Acceptable pour un jeu sans enjeu (même philosophie que l'Étape 8).

*Variante infalsifiable (non retenue, car codes ~150 caractères)* : remplacer le MAC par une signature ECDSA P-256 (64 octets). La clé privée reste chez le game master, seule la clé publique est dans l'app. Même structure de charge utile, version `0x02`.

## 3. Paramètres
| Élément | Valeur |
|---|---|
| Clé `K` | 32 octets aléatoires, base64 dans `config.json` (`useritemCode.key`) |
| Alphabet | Crockford Base32 : `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (pas de `I L O U`) |
| Longueur | 20 octets = 160 bits = **32 caractères**, affichés en 8 groupes de 4 séparés par `-` |
| Item canonique | `booster:<setId>` (ex. `booster:A1`) ou `card:<Index>\|<Layout>` (ex. `card:SERIE-A1 / P004\|fullart`, `Layout` tel que dans le JSON, en minuscules) |
| Quantité | entier 1 à 65535 |

## 4. Format binaire (20 octets)
| Octets | Contenu |
|---|---|
| 0 | version = `0x01` |
| 1–5 | `nonce` : 5 octets aléatoires |
| 6–8 | `itemHash` = `SHA-256(UTF-8(itemCanonique))[0..3]` |
| 9–10 | `qty` : uint16 big-endian |
| 11–12 | `uuidTag` = `SHA-256(uuidBytes)[0..2]` |
| 13–19 | `mac` = `HMAC-SHA256(K, "UIC1" ‖ uuidBytes ‖ octets[0..12])[0..7]` |

`uuidBytes` = les 16 octets de l'UUID (hex sans tirets, insensible à la casse). `‖` = concaténation. `"UIC1"` = 4 octets ASCII.

Le tout est encodé en Crockford Base32 (5 bits par caractère, sans padding : 160 bits = 32 caractères exacts).

## 5. Génération (côté game master)
```
entrées : uuid, item (booster:<setId> | card:<Index>|<Layout>), qty
1. valider uuid (format UUID), item (existe dans le catalogue), 1 ≤ qty ≤ 65535
2. calculer itemHash ; vérifier qu'AUCUN autre item du catalogue n'a le même
   itemHash (3 octets). Si collision : refuser (voir §8).
3. nonce = 5 octets aléatoires (CSPRNG)
4. construire octets[0..12], calculer mac, assembler les 20 octets
5. encoder en Base32 Crockford, grouper par 4 avec "-"
6. consulter le registre (§6) : si ce code OU ce nonce existe déjà, retourner à 3
7. écrire dans le registre, puis remettre le code
```

Implémentation de référence (Node ≥ 18) :
```js
import { createHmac, createHash, randomBytes } from 'node:crypto';
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const sha = (b) => createHash('sha256').update(b).digest();

function b32enc(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += ALPHABET[(val >>> (bits - 5)) & 31]; bits -= 5; }
    val &= (1 << bits) - 1;
  }
  return out; // 160 bits => aucun reste
}

export function generate(key /* Buffer 32 */, uuid, item, qty, nonce = randomBytes(5)) {
  const ub = Buffer.from(uuid.replace(/-/g, ''), 'hex');
  const head = Buffer.alloc(13);
  head[0] = 1;
  nonce.copy(head, 1);
  sha(Buffer.from(item, 'utf8')).copy(head, 6, 0, 3);
  head.writeUInt16BE(qty, 9);
  sha(ub).copy(head, 11, 0, 2);
  const mac = createHmac('sha256', key)
    .update(Buffer.concat([Buffer.from('UIC1'), ub, head]))
    .digest().subarray(0, 7);
  return b32enc(Buffer.concat([head, mac])).match(/.{4}/g).join('-');
}
```

## 6. Registre du game master
À chaque code émis, enregistrer (CSV, SQLite ou JSON, **append-only**) :
`createdAt, uuid, item, qty, nonce (hex), code, note`.
Le registre sert à : (1) garantir l'unicité du nonce et du code, (2) retrouver à qui un code a été donné, (3) ré-envoyer un code perdu (ne pas en regénérer un nouveau). Ne jamais le publier : il associe des UUID à des codes.

## 7. Vérification (côté app, `UserItemCode.verify`)
Dans cet ordre :
1. **Normaliser** : majuscules, retirer `-` et espaces, `O→0`, `I→1`, `L→1`. Longueur ≠ 32 ou caractère hors alphabet (dont `U`) → `invalid_format`.
2. Décoder en 20 octets. `octets[0] ≠ 0x01` → `invalid_format`.
3. `uuidTag` ≠ `SHA-256(uuidBytes du compte)[0..2]` → `wrong_user` ("ce code n'est pas destiné à ce compte").
4. Recalculer le MAC avec l'UUID du compte ; comparer en **temps constant** ; différent → `invalid`.
5. Retrouver l'item dont le `itemHash` correspond dans le catalogue courant (sets + cartes). Zéro ou plusieurs résultats → `unknown_item` (code **non consommé** : peut fonctionner après une mise à jour du catalogue).
6. `redeemed_codes` contient déjà le code normalisé sans tirets (32 caractères) → `already_used`.
7. Sinon `ok` avec la récompense `{ type, key, quantity }`.

Limite connue de l'étape 3 : le `uuidTag` ne fait que 16 bits. Un code destiné à un autre compte passe l'étape 3 une fois sur 65 536, puis échoue à l'étape 4 avec `invalid` au lieu de `wrong_user`. Sans conséquence de sécurité, seulement le message d'erreur.

## 8. Collisions d'`itemHash`
24 bits pour quelques centaines d'items : une collision entre deux items est improbable (~1 % à 500 items) mais possible. Le générateur **refuse** d'émettre un code pour un item dont l'empreinte est partagée avec un autre item du catalogue. Remède : renommer l'item, ou passer à la version `0x02` avec une empreinte plus longue.

## 9. Vecteurs de test
Clé de test (**ne jamais utiliser en production**) : 32 octets `00 01 02 … 1f`.
UUID : `123e4567-e89b-12d3-a456-426614174000`

| Item | Qty | Nonce | itemHash | Octets (hex) | Code |
|---|---|---|---|---|---|
| `booster:A1` | 3 | `0102030405` | `058b97` | `010102030405058b9700032065bc1f8d8b7e7c60` | `040G-40R4-0M2R-Q5R0-0CG6-BF0Z-HP5Q-WZ30` |
| `card:SERIE-A1 / P004\|fullart` | 1 | `a1b2c3d4e5` | `b75d84` | `01a1b2c3d4e5b75d8400012065e1c817d43eb5f8` | `06GV-5GYM-WPVN-V100-04G6-BRE8-2ZA3-XDFR` |

`uuidTag` pour cet UUID : `2065`. Même item/qty/nonce que la ligne 1, mais UUID `00000000-0000-4000-8000-000000000000` : `uuidTag = 9318`, MAC `a069dae05e8d8b`, code `040G-40R4-0M2R-Q5R0-0E9H-H839-VBG5-X3CB` (donc deux comptes ne partagent jamais un code valide).

## 10. Résumé des cas d'erreur
| Statut | Signification | Popup via `?Redeem=` |
|---|---|---|
| `invalid_format` | Pas un code reconnaissable | non, toast |
| `wrong_user` | Destiné à un autre compte | non, toast |
| `invalid` | Code altéré ou mal copié | non, toast |
| `unknown_item` | Item absent du catalogue | non, toast |
| `already_used` | Déjà réclamé sur ce compte | non, toast |
| `ok` | Valide | oui |
