// =============================================================================
//  CodeGeneration.cs — Générateur de codes personnels « useritem » (C#)
//
//  Fichier AUTONOME : il ne dépend d'aucun autre fichier du projet MineCards et
//  peut être copié tel quel dans un autre projet (back-office, bot Discord,
//  outil interne, jeu master...). Seuls les types du framework .NET sont utilisés
//  (System.Security.Cryptography, System.Text, System.Convert).
//
//  ---------------------------------------------------------------------------
//  À QUOI SERT UN CODE « useritem » ?
//  ---------------------------------------------------------------------------
//  Un code personnel offre UNE SEULE récompense à UN SEUL compte, désigné par son
//  UUID. Trois natures de récompense sont possibles :
//
//    - « Sparks » : une quantité de la monnaie du jeu ;
//    - « Booster » : des boosters BONUS d'une extension (ex. « A1 ») ;
//    - « Carte »   : des exemplaires d'une impression de carte précise.
//
//  Le code est vérifié HORS LIGNE par le jeu, à l'aide d'une clé partagée de
//  32 octets (documentée en base64 sous `useritemCode.key` dans
//  settings/config.json). Il est lié au compte (par son UUID) et n'est
//  utilisable qu'UNE SEULE FOIS (le jeu l'enregistre après le premier usage).
//
//  ---------------------------------------------------------------------------
//  FORMAT BINAIRE (20 octets = 160 bits, affichés en 8 groupes de 4 caractères)
//  ---------------------------------------------------------------------------
//    octet  0        version   = 0x01
//    octets 1-5      nonce     = 5 octets aléatoires. Ils ne sont PAS secrets :
//                                ils rendent simplement chaque code unique, pour
//                                que deux codes offrant le même cadeau ne se
//                                ressemblent pas.
//    octets 6-8      itemHash  = SHA-256(UTF-8(item canonique))[0..3]   (3 octets)
//    octets 9-10     quantité  = entier 16 bits NON signé, BIG-ENDIAN
//                                => minimum 1, maximum 65535.
//    octets 11-12    uuidTag   = SHA-256(UUID du compte)[0..2]          (2 octets)
//    octets 13-19    mac       = HMAC-SHA256(K, "UIC1" ‖ UUID ‖ octets 0..12)[0..7]
//
//  Encodage final : Base32 « Crockford ». L'alphabet exclut volontairement les
//  lettres I, L, O et U, qui se confondent avec 1, 1, 0 et V à la lecture.
//  160 bits / 5 bits par caractère = exactement 32 caractères, présentés sous la
//  forme `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`.
//
//  ---------------------------------------------------------------------------
//  ITEM CANONIQUE (la chaîne dont on hache les 3 premiers octets)
//  ---------------------------------------------------------------------------
//    Sparks :  "sparks"                       (constante, pas de paramètre)
//    Booster : "booster:<setId>"              ex. "booster:A1"
//    Carte :   "card:<Index>|<layout>"        ex. "card:SERIE-A1 / P004|fullart"
//
//  Points à respecter scrupuleusement, sinon le hash ne correspondra pas et le
//  jeu répondra « unknown_item » :
//    - le préfixe est en minuscules (`booster:` / `card:` / `sparks`) ;
//    - le layout est en MINUSCULES (`classic`, `fullart`) ;
//    - l'Index est repris EXACTEMENT tel qu'écrit dans le fichier de l'extension,
//      espaces compris (ex. « SERIE-A1 / P004 »).
//
//  ---------------------------------------------------------------------------
//  EXEMPLE D'UTILISATION
//  ---------------------------------------------------------------------------
//    // 1) Construire le générateur à partir de la clé partagée.
//    var generator = CodeGeneration.FromBase64Key(cléBase64DuFichierConfig);
//
//    // 2) Générer un code pour un joueur (UUID récupéré dans ses Réglages).
//    string uuid = "123e4567-e89b-42d3-a456-426614174000";
//
//    GeneratedCode sparks  = generator.GenerateSparks(uuid, 500);
//    GeneratedCode booster = generator.GenerateBooster(uuid, "A1", 3);
//    GeneratedCode card    = generator.GenerateCard(uuid, "SERIE-A1 / P004", "fullart", 1);
//
//    Console.WriteLine(sparks.Code);       // 04AB-CD23-...
//    Console.WriteLine(sparks.Normalized); // 04ABCD23...  (sans tirets)
//
//    // 3) (Facultatif) Vérifier un code localement, comme le fait le jeu.
//    var result = generator.Verify(sparks.Code, uuid, new[] { "sparks" });
//    if (result.Status == VerifyStatus.Ok)
//        Console.WriteLine($"Valide : {result.CanonicalItem} x{result.Quantity}");
//
//  ---------------------------------------------------------------------------
//  AVERTISSEMENT DE SÉCURITÉ (à lire avant de s'appuyer dessus)
//  ---------------------------------------------------------------------------
//  La clé K est servie au client (le navigateur la lit dans le config.json), donc
//  cette génération n'est PAS une signature cryptographique fiable : toute
//  personne capable de lire la clé peut fabriquer exactement les mêmes codes.
//  Ce mécanisme empêche seulement :
//    - de DEVISER un code au hasard ;
//    - d'utiliser le code destiné à un autre compte (uuidTag + MAC) ;
//    - de MODIFIER le cadeau ou la quantité sans casser le MAC.
//  Il ne protège pas contre quelqu'un qui extrait la clé, ni contre un joueur qui
//  efface ses données locales pour contourner la règle « usage unique ».
//  Ne pas s'en servir pour des récompenses ayant une valeur réelle.
// =============================================================================

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace minecardslinks
{
    /// <summary>
    /// Statut renvoyé par <see cref="CodeGeneration.Verify"/>.
    /// Les noms correspondent exactement à ceux utilisés par le jeu (JavaScript),
    /// pour que les messages affichés restent cohérents entre les deux mondes.
    /// </summary>
    public enum VerifyStatus
    {
        /// <summary>Le code est valide : il a été émis pour ce compte et contient une récompense connue.</summary>
        Ok,

        /// <summary>Longueur ou alphabet incorrects (le code n'a pas la forme d'un code personnel).</summary>
        InvalidFormat,

        /// <summary>Le code est valide mais destiné à un AUTRE compte (uuidTag différent).</summary>
        WrongUser,

        /// <summary>Le tag de compte passe mais le MAC est faux : le code a été altéré ou forgé sans la clé.</summary>
        Invalid,

        /// <summary>Le MAC est valide mais aucun item du catalogue ne correspond au hash embarqué.</summary>
        UnknownItem,
    }

    /// <summary>
    /// Résultat d'une génération : le code et tout ce qu'il faut pour l'afficher,
    /// l'archiver ou le déboguer.
    /// </summary>
    public sealed class GeneratedCode
    {
        /// <summary>Forme affichée, avec tirets : <c>XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX</c>.</summary>
        public string Code { get; }

        /// <summary>Forme normalisée, sans tirets ni espaces : 32 caractères Crockford.</summary>
        public string Normalized { get; }

        /// <summary>Les 20 octets du payload (avant encodage Base32).</summary>
        public byte[] Bytes { get; }

        /// <summary>Item canonique embarqué (ex. <c>booster:A1</c>).</summary>
        public string CanonicalItem { get; }

        /// <summary>Quantité embarquée (1 à 65535).</summary>
        public int Quantity { get; }

        /// <summary>UUID du compte destinataire, tel qu'il a été fourni.</summary>
        public string Uuid { get; }

        /// <summary>
        /// Crée le résultat d'une génération. Constructeur interne au fichier : les
        /// instances proviennent uniquement de <see cref="CodeGeneration.Generate"/>.
        /// </summary>
        internal GeneratedCode(string code, string normalized, byte[] bytes, string canonicalItem, int quantity, string uuid)
        {
            Code = code;
            Normalized = normalized;
            Bytes = bytes;
            CanonicalItem = canonicalItem;
            Quantity = quantity;
            Uuid = uuid;
        }

        /// <summary>Renvoie la forme affichée du code (pratique avec <c>Console.WriteLine</c>).</summary>
        public override string ToString() => Code;
    }

    /// <summary>Résultat d'une vérification locale.</summary>
    public sealed class VerifyResult
    {
        /// <summary>Statut de la vérification.</summary>
        public VerifyStatus Status { get; }

        /// <summary>Item reconnu, ou <c>null</c> quand le statut n'est pas <see cref="VerifyStatus.Ok"/>.</summary>
        public string CanonicalItem { get; }

        /// <summary>Quantité lue dans le code (0 quand le statut n'est pas <see cref="VerifyStatus.Ok"/>).</summary>
        public int Quantity { get; }

        /// <summary>UUID lu dans le code, quand il a pu être reconstitué.</summary>
        public string Uuid { get; }

        internal VerifyResult(VerifyStatus status, string canonicalItem, int quantity, string uuid)
        {
            Status = status;
            CanonicalItem = canonicalItem;
            Quantity = quantity;
            Uuid = uuid;
        }
    }

    /// <summary>Rapport de <see cref="CodeGeneration.RunSelfTests"/>.</summary>
    public sealed class SelfTestReport
    {
        /// <summary>Vrai quand tous les contrôles sont passés.</summary>
        public bool Passed { get; }

        /// <summary>Nombre de contrôles exécutés.</summary>
        public int Checks { get; }

        /// <summary>Libellés des contrôles en échec (vide quand tout va bien).</summary>
        public IReadOnlyList<string> Failures { get; }

        internal SelfTestReport(bool passed, int checks, IReadOnlyList<string> failures)
        {
            Passed = passed;
            Checks = checks;
            Failures = failures;
        }
    }

    /// <summary>
    /// Générateur (et vérificateur) de codes personnels « useritem ».
    ///
    /// Instancier une fois avec la clé partagée, puis appeler les méthodes
    /// <c>Generate*</c> autant de fois que nécessaire : l'objet ne conserve aucun
    /// état mutable et peut être réutilisé sans risque.
    /// </summary>
    public sealed class CodeGeneration
    {
        // ---------------------------------------------------------------------
        //  Constantes du format. Elles sont identiques côté jeu : ne les changez
        //  pas isolément, sinon les codes générés ici ne seront plus reconnus.
        // ---------------------------------------------------------------------

        /// <summary>Version du format écrite dans le premier octet.</summary>
        public const byte Version = 0x01;

        /// <summary>Taille du payload, en octets (avant encodage Base32).</summary>
        public const int PayloadBytes = 20;

        /// <summary>Longueur du code normalisé (sans tirets).</summary>
        public const int NormalizedLength = 32;

        /// <summary>Taille du nonce, en octets.</summary>
        public const int NonceBytes = 5;

        /// <summary>Taille de la clé partagée, en octets.</summary>
        public const int KeyBytes = 32;

        /// <summary>Quantité maximale représentable (uint16).</summary>
        public const int MaxQuantity = 65535;

        /// <summary>Alphabet Base32 de Crockford : sans I, L, O ni U.</summary>
        public const string CrockfordAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

        /// <summary>Séparateur de domaine du MAC (4 octets ASCII), propre à ce format.</summary>
        public const string MacContext = "UIC1";

        /// <summary>
        /// Clé de test (hex) des vecteurs du document de spécification.
        /// À N'UTILISER QUE POUR LES TESTS : elle est publique, donc sans valeur.
        /// </summary>
        public const string TestKeyHex = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

        /// <summary>UUID de test du document de spécification.</summary>
        public const string TestUuid = "123e4567-e89b-12d3-a456-426614174000";

        /// <summary>Second UUID de test, utilisé par le vecteur « mauvais compte ».</summary>
        public const string TestOtherUuid = "00000000-0000-4000-8000-000000000000";

        /// <summary>Clé partagée, 32 octets. Jamais journalisée, jamais exposée en clair.</summary>
        private readonly byte[] _key;

        /// <summary>
        /// Crée un générateur à partir de la clé BRUTE (32 octets).
        /// </summary>
        /// <param name="key">Clé partagée. Une copie défensive en est faite.</param>
        /// <exception cref="ArgumentNullException">Clé nulle.</exception>
        /// <exception cref="ArgumentException">Clé d'une longueur différente de 32 octets.</exception>
        public CodeGeneration(byte[] key)
        {
            if (key == null)
                throw new ArgumentNullException(nameof(key));
            if (key.Length != KeyBytes)
                throw new ArgumentException(
                    $"La clé partagée doit faire exactement {KeyBytes} octets (reçu : {key.Length}).",
                    nameof(key));

            // Copie défensive : le tableau du tableau reçu ne doit pas pouvoir être
            // modifié après coup (ce qui changerait silencieusement le générateur).
            _key = new byte[KeyBytes];
            Buffer.BlockCopy(key, 0, _key, 0, KeyBytes);
        }

        /// <summary>
        /// Crée un générateur depuis la clé en base64 telle qu'elle figure dans
        /// <c>settings/config.json</c> (<c>useritemCode.key</c>).
        /// </summary>
        /// <param name="base64Key">Clé encodée en base64 (32 octets une fois décodée).</param>
        /// <returns>Le générateur prêt à l'emploi.</returns>
        /// <exception cref="ArgumentException">Clé vide, base64 invalide, ou taille incorrecte.</exception>
        public static CodeGeneration FromBase64Key(string base64Key)
        {
            if (string.IsNullOrWhiteSpace(base64Key))
                throw new ArgumentException("La clé partagée est vide.", nameof(base64Key));

            byte[] decoded;
            try
            {
                decoded = Convert.FromBase64String(base64Key.Trim());
            }
            catch (FormatException exception)
            {
                throw new ArgumentException(
                    "La clé partagée n'est pas du base64 valide.",
                    nameof(base64Key),
                    exception);
            }
            return new CodeGeneration(decoded);
        }

        /// <summary>
        /// Crée un générateur depuis une clé écrite en hexadécimal (64 caractères).
        /// Sert aux TESTS et au débogage : la clé réelle reste du base64.
        /// </summary>
        /// <param name="hexKey">Clé en hexadécimal (64 caractères).</param>
        /// <returns>Le générateur prêt à l'emploi.</returns>
        /// <exception cref="ArgumentException">Chaîne vide, longueur ou caractères invalides.</exception>
        public static CodeGeneration FromHexKey(string hexKey)
        {
            if (string.IsNullOrWhiteSpace(hexKey) || hexKey.Length != KeyBytes * 2)
                throw new ArgumentException(
                    $"La clé hexadécimale doit contenir {KeyBytes * 2} caractères.",
                    nameof(hexKey));
            return new CodeGeneration(HexToBytes(hexKey));
        }

        // ---------------------------------------------------------------------
        //  Items canoniques
        // ---------------------------------------------------------------------

        /// <summary>Item canonique des Sparks : une constante, la quantité porte le montant.</summary>
        public static string CanonicalSparks() => "sparks";

        /// <summary>
        /// Item canonique d'un lot de boosters bonus.
        /// </summary>
        /// <param name="setId">Identifiant d'extension, ex. <c>A1</c>.</param>
        /// <returns><c>booster:&lt;setId&gt;</c>.</returns>
        /// <exception cref="ArgumentException">Identifiant vide.</exception>
        public static string CanonicalBooster(string setId)
        {
            if (string.IsNullOrWhiteSpace(setId))
                throw new ArgumentException("L'identifiant d'extension est vide.", nameof(setId));
            return "booster:" + setId.Trim();
        }

        /// <summary>
        /// Item canonique d'une impression de carte.
        /// </summary>
        /// <param name="index">
        /// Valeur <c>Index</c> de la carte, reprise EXACTEMENT du fichier de
        /// l'extension (ex. <c>SERIE-A1 / P004</c>).
        /// </param>
        /// <param name="layout">Layout (<c>classic</c> ou <c>fullart</c>) ; la casse est ignorée.</param>
        /// <returns><c>card:&lt;Index&gt;|&lt;layout minuscule&gt;</c>.</returns>
        /// <exception cref="ArgumentException">Index ou layout vide.</exception>
        public static string CanonicalCard(string index, string layout)
        {
            if (string.IsNullOrWhiteSpace(index))
                throw new ArgumentException("L'Index de la carte est vide.", nameof(index));
            if (string.IsNullOrWhiteSpace(layout))
                throw new ArgumentException("Le layout de la carte est vide.", nameof(layout));
            return "card:" + index.Trim() + "|" + layout.Trim().ToLowerInvariant();
        }

        // ---------------------------------------------------------------------
        //  Génération
        // ---------------------------------------------------------------------

        /// <summary>
        /// Génère un code pour un item canonique quelconque.
        ///
        /// C'est la méthode « bas niveau » : les trois méthodes <c>GenerateSparks</c>,
        /// <c>GenerateBooster</c> et <c>GenerateCard</c> l'appellent après avoir
        /// construit l'item canonique, et sont plus agréables à utiliser au quotidien.
        /// </summary>
        /// <param name="uuid">
        /// UUID du compte destinataire. Tiret(s) optionnel(s), casse ignorée
        /// (32 caractères hexadécimaux après suppression des tirets).
        /// </param>
        /// <param name="canonicalItem">
        /// Item canonique embarqué (voir <see cref="CanonicalSparks"/>,
        /// <see cref="CanonicalBooster"/> et <see cref="CanonicalCard"/>).
        /// </param>
        /// <param name="quantity">Quantité à offrir, de 1 à 65535.</param>
        /// <param name="nonce">
        /// Nonce de 5 octets, ou <c>null</c> pour en tirer un au hasard. Ne le
        /// fournissez que dans les tests : en production, laisser <c>null</c>, sinon
        /// deux codes du même cadeau seraient identiques.
        /// </param>
        /// <returns>Le code généré et ses métadonnées.</returns>
        /// <exception cref="ArgumentException">Item canonique vide, UUID invalide ou nonce de mauvaise taille.</exception>
        /// <exception cref="ArgumentOutOfRangeException">Quantité hors de [1, 65535].</exception>
        public GeneratedCode Generate(string uuid, string canonicalItem, int quantity, byte[] nonce = null)
        {
            // --- 1. Validation des entrées -----------------------------------
            if (string.IsNullOrWhiteSpace(canonicalItem))
                throw new ArgumentException("L'item canonique ne peut pas être vide.", nameof(canonicalItem));

            if (quantity < 1 || quantity > MaxQuantity)
                throw new ArgumentOutOfRangeException(
                    nameof(quantity),
                    quantity,
                    $"La quantité doit être comprise entre 1 et {MaxQuantity} (elle tient sur 16 bits).");

            if (!TryParseUuid(uuid, out byte[] uuidBytes))
                throw new ArgumentException(
                    $"UUID invalide : « {uuid} ». Attendu : 32 caractères hexadécimaux, avec ou sans tirets.",
                    nameof(uuid));

            byte[] nonceBytes = nonce ?? CreateNonce();
            if (nonceBytes.Length != NonceBytes)
                throw new ArgumentException(
                    $"Le nonce doit faire exactement {NonceBytes} octets (reçu : {nonceBytes.Length}).",
                    nameof(nonce));

            // --- 2. Les deux empreintes --------------------------------------
            // itemHash : identifie le CADEAU. Seuls les 3 premiers octets sont
            // conservés (24 bits), ce qui suffit pour distinguer les items d'un
            // catalogue et garder le payload compact.
            byte[] itemHash = Sha256(Encoding.UTF8.GetBytes(canonicalItem));

            // uuidTag : identifie le COMPTE, sur 2 octets (16 bits). Un code destiné
            // à un autre joueur échoue ici la plupart du temps (1 chance sur 65536
            // de passer, puis le MAC tranche).
            byte[] uuidTag = Sha256(uuidBytes);

            // --- 3. Construction des 13 premiers octets ----------------------
            // Ce « head » est à la fois le début du payload et le message signé par
            // le HMAC : c'est le cœur du format.
            byte[] head = new byte[13];
            head[0] = Version;                              // octet 0     : version
            Buffer.BlockCopy(nonceBytes, 0, head, 1, 5);    // octets 1-5  : nonce
            Buffer.BlockCopy(itemHash, 0, head, 6, 3);      // octets 6-8  : itemHash
            head[9] = (byte)((quantity >> 8) & 0xFF);       // octet 9     : quantité, poids fort
            head[10] = (byte)(quantity & 0xFF);             // octet 10    : quantité, poids faible
            Buffer.BlockCopy(uuidTag, 0, head, 11, 2);      // octets 11-12: uuidTag

            // --- 4. Le MAC (7 octets) ----------------------------------------
            byte[] mac = ComputeMac(_key, uuidBytes, head);

            // --- 5. Assemblage du payload complet ----------------------------
            byte[] payload = new byte[PayloadBytes];
            Buffer.BlockCopy(head, 0, payload, 0, 13);      // octets 0-12
            Buffer.BlockCopy(mac, 0, payload, 13, 7);       // octets 13-19

            // --- 6. Encodage Base32 Crockford + mise en forme ----------------
            string normalized = EncodeCrockford(payload);
            return new GeneratedCode(Format(normalized), normalized, payload, canonicalItem, quantity, uuid);
        }

        /// <summary>
        /// Génère un code offrant une quantité de Sparks.
        /// </summary>
        /// <param name="uuid">UUID du compte destinataire.</param>
        /// <param name="amount">Nombre de Sparks (1 à 65535).</param>
        /// <param name="nonce">Nonce de 5 octets, ou <c>null</c> (voir <see cref="Generate"/>).</param>
        /// <returns>Le code généré.</returns>
        public GeneratedCode GenerateSparks(string uuid, int amount, byte[] nonce = null)
            => Generate(uuid, CanonicalSparks(), amount, nonce);

        /// <summary>
        /// Génère un code offrant des boosters bonus d'une extension.
        /// </summary>
        /// <param name="uuid">UUID du compte destinataire.</param>
        /// <param name="setId">Identifiant d'extension, ex. <c>A1</c>.</param>
        /// <param name="quantity">Nombre de boosters (1 à 65535).</param>
        /// <param name="nonce">Nonce de 5 octets, ou <c>null</c> (voir <see cref="Generate"/>).</param>
        /// <returns>Le code généré.</returns>
        public GeneratedCode GenerateBooster(string uuid, string setId, int quantity, byte[] nonce = null)
            => Generate(uuid, CanonicalBooster(setId), quantity, nonce);

        /// <summary>
        /// Génère un code offrant des exemplaires d'une carte.
        /// </summary>
        /// <param name="uuid">UUID du compte destinataire.</param>
        /// <param name="index">Valeur <c>Index</c> de la carte (ex. <c>SERIE-A1 / P004</c>).</param>
        /// <param name="layout">Layout (<c>classic</c> ou <c>fullart</c>).</param>
        /// <param name="quantity">Nombre d'exemplaires (1 à 65535).</param>
        /// <param name="nonce">Nonce de 5 octets, ou <c>null</c> (voir <see cref="Generate"/>).</param>
        /// <returns>Le code généré.</returns>
        public GeneratedCode GenerateCard(string uuid, string index, string layout, int quantity, byte[] nonce = null)
            => Generate(uuid, CanonicalCard(index, layout), quantity, nonce);

        // ---------------------------------------------------------------------
        //  Vérification locale (facultatif, mais pratique pour se rassurer)
        // ---------------------------------------------------------------------

        /// <summary>
        /// Vérifie un code comme le ferait le jeu, sans accès à la base de données.
        ///
        /// Cet outil sert à TESTER un code avant de l'envoyer (relire un code tapé à
        /// la main, contrôler un catalogue...). Le jeu, lui, exécute la même logique ;
        /// cette méthode n'ajoute donc aucune confiance supplémentaire.
        /// </summary>
        /// <param name="code">Code affiché (<c>XXXX-…</c>) ou normalisé (32 caractères).</param>
        /// <param name="uuid">UUID du compte censé pouvoir l'utiliser.</param>
        /// <param name="candidateCanonicalItems">
        /// Tous les items connus du catalogue. Le hash embarqué doit correspondre à
        /// EXACTEMENT un de ces items ; sinon le résultat est
        /// <see cref="VerifyStatus.UnknownItem"/>. Pour les Sparks, passez
        /// <see cref="CanonicalSparks"/>.
        /// </param>
        /// <returns>Le résultat de la vérification.</returns>
        /// <exception cref="ArgumentException">UUID invalide pour le compte attendu.</exception>
        public VerifyResult Verify(string code, string uuid, IEnumerable<string> candidateCanonicalItems)
        {
            if (string.IsNullOrWhiteSpace(code))
                return new VerifyResult(VerifyStatus.InvalidFormat, null, 0, null);

            if (!TryParseUuid(uuid, out byte[] expectedUuidBytes))
                throw new ArgumentException($"UUID invalide : « {uuid} ».", nameof(uuid));

            // --- 1. Forme et décodage ----------------------------------------
            string normalized = Normalize(code);
            if (normalized.Length != NormalizedLength)
                return new VerifyResult(VerifyStatus.InvalidFormat, null, 0, null);

            byte[] payload = DecodeCrockford(normalized);
            if (payload == null)
                return new VerifyResult(VerifyStatus.InvalidFormat, null, 0, null);

            if (payload[0] != Version)
                return new VerifyResult(VerifyStatus.InvalidFormat, null, 0, null);

            // --- 2. Le code est-il bien adressé à ce compte ? ----------------
            byte[] expectedTag = Sha256(expectedUuidBytes);
            byte[] actualTag = Slice(payload, 11, 2);
            if (!FixedTimeEquals(actualTag, Slice(expectedTag, 0, 2)))
                return new VerifyResult(VerifyStatus.WrongUser, null, 0, null);

            // --- 3. Le MAC est-il authentique ? ------------------------------
            byte[] head = Slice(payload, 0, 13);
            byte[] expectedMac = ComputeMac(_key, expectedUuidBytes, head);
            if (!FixedTimeEquals(Slice(payload, 13, 7), Slice(expectedMac, 0, 7)))
                return new VerifyResult(VerifyStatus.Invalid, null, 0, null);

            // --- 4. Quantité --------------------------------------------------
            int quantity = (payload[9] << 8) | payload[10];
            if (quantity < 1)
                return new VerifyResult(VerifyStatus.Invalid, null, 0, null);

            // --- 5. Résolution de l'item --------------------------------------
            string actualHash = ToHex(Slice(payload, 6, 3));
            string matched = null;
            int matches = 0;

            if (candidateCanonicalItems != null)
            {
                foreach (string candidate in candidateCanonicalItems)
                {
                    if (string.IsNullOrEmpty(candidate))
                        continue;
                    string candidateHash = ToHex(Slice(Sha256(Encoding.UTF8.GetBytes(candidate)), 0, 3));
                    if (string.Equals(candidateHash, actualHash, StringComparison.OrdinalIgnoreCase))
                    {
                        matched = candidate;
                        matches++;
                    }
                }
            }

            // Deux items qui partagent le même hash (collision) rendraient le code
            // ambigu : on refuse plutôt que de créditer au hasard.
            if (matches != 1)
                return new VerifyResult(VerifyStatus.UnknownItem, null, 0, null);

            return new VerifyResult(VerifyStatus.Ok, matched, quantity, uuid);
        }

        // ---------------------------------------------------------------------
        //  Outils de cryptographie
        // ---------------------------------------------------------------------

        /// <summary>Calcule le SHA-256 d'un tableau d'octets.</summary>
        private static byte[] Sha256(byte[] data)
        {
            using (SHA256 sha = SHA256.Create())
            {
                return sha.ComputeHash(data);
            }
        }

        /// <summary>
        /// Calcule le HMAC-SHA256 du message <c>"UIC1" ‖ uuidBytes ‖ head</c>.
        /// Seuls les 7 premiers octets du résultat sont utilisés, mais les 32 sont
        /// renvoyés (la troncature est faite par l'appelant, ce qui rend explicite
        /// la partie conservée).
        /// </summary>
        private static byte[] ComputeMac(byte[] key, byte[] uuidBytes, byte[] head)
        {
            byte[] context = Encoding.ASCII.GetBytes(MacContext);  // "UIC1" = 4 octets
            byte[] message = new byte[context.Length + uuidBytes.Length + head.Length];
            Buffer.BlockCopy(context, 0, message, 0, context.Length);
            Buffer.BlockCopy(uuidBytes, 0, message, context.Length, uuidBytes.Length);
            Buffer.BlockCopy(head, 0, message, context.Length + uuidBytes.Length, head.Length);

            using (HMACSHA256 hmac = new HMACSHA256(key))
            {
                return hmac.ComputeHash(message);
            }
        }

        /// <summary>Tire un nonce aléatoire de 5 octets (cryptographiquement sûr).</summary>
        private static byte[] CreateNonce()
        {
            byte[] nonce = new byte[NonceBytes];
            using (RandomNumberGenerator rng = RandomNumberGenerator.Create())
            {
                rng.GetBytes(nonce);
            }
            return nonce;
        }

        /// <summary>
        /// Convertit un UUID textuel en ses 16 octets.
        /// Accepte les tirets optionnels et n'importe quelle casse.
        /// </summary>
        /// <param name="uuid">UUID à convertir.</param>
        /// <param name="bytes">16 octets, ou <c>null</c> en cas d'échec.</param>
        /// <returns><c>true</c> quand l'UUID a pu être converti.</returns>
        public static bool TryParseUuid(string uuid, out byte[] bytes)
        {
            bytes = null;
            if (string.IsNullOrWhiteSpace(uuid))
                return false;

            string hex = uuid.Replace("-", string.Empty).Trim();
            if (hex.Length != 32)
                return false;

            byte[] result = new byte[16];
            for (int index = 0; index < result.Length; index++)
            {
                if (!byte.TryParse(
                        hex.Substring(index * 2, 2),
                        NumberStyles.HexNumber,
                        CultureInfo.InvariantCulture,
                        out result[index]))
                {
                    return false;
                }
            }

            bytes = result;
            return true;
        }

        /// <summary>Compare deux tableaux d'octets sans sortie anticipée (anti « timing attack »).</summary>
        private static bool FixedTimeEquals(byte[] left, byte[] right)
        {
            if (left == null || right == null || left.Length != right.Length)
                return false;

            int difference = 0;
            for (int index = 0; index < left.Length; index++)
                difference |= left[index] ^ right[index];
            return difference == 0;
        }

        /// <summary>Extrait une tranche d'un tableau d'octets (copie).</summary>
        private static byte[] Slice(byte[] source, int offset, int length)
        {
            byte[] result = new byte[length];
            Buffer.BlockCopy(source, offset, result, 0, length);
            return result;
        }

        // ---------------------------------------------------------------------
        //  Encodage Base32 « Crockford »
        // ---------------------------------------------------------------------

        /// <summary>
        /// Encode un payload en Base32 Crockford.
        ///
        /// Principe : on lit les octets bit à bit et on émet un caractère dès que
        /// 5 bits sont disponibles (5 bits = 1 caractère). 20 octets = 160 bits =
        /// exactement 32 caractères, sans remplissage.
        /// </summary>
        /// <param name="bytes">Octets à encoder.</param>
        /// <returns>La chaîne de 32 caractères, sans tirets.</returns>
        public static string EncodeCrockford(byte[] bytes)
        {
            if (bytes == null)
                throw new ArgumentNullException(nameof(bytes));

            StringBuilder output = new StringBuilder((bytes.Length * 8) / 5);
            int buffer = 0;   // bits en attente d'émission
            int bitCount = 0; // nombre de bits valides dans `buffer`

            foreach (byte value in bytes)
            {
                buffer = (buffer << 8) | value;
                bitCount += 8;

                while (bitCount >= 5)
                {
                    bitCount -= 5;
                    output.Append(CrockfordAlphabet[(buffer >> bitCount) & 31]);
                }

                // On ne garde que les bits non encore émis : sans ce masque, le
                // buffer grossirait indéfiniment.
                buffer &= (1 << bitCount) - 1;
            }

            return output.ToString();
        }

        /// <summary>
        /// Décode une chaîne Base32 Crockford (déjà normalisée).
        /// </summary>
        /// <param name="normalized">32 caractères de l'alphabet Crockford.</param>
        /// <returns>Les 20 octets, ou <c>null</c> si un caractère est hors alphabet ou si le résultat n'a pas la bonne taille.</returns>
        public static byte[] DecodeCrockford(string normalized)
        {
            if (string.IsNullOrEmpty(normalized))
                return null;

            List<byte> output = new List<byte>(PayloadBytes);
            int buffer = 0;
            int bitCount = 0;

            foreach (char character in normalized)
            {
                int index = CrockfordAlphabet.IndexOf(character);
                if (index < 0)
                    return null;

                buffer = (buffer << 5) | index;
                bitCount += 5;

                if (bitCount >= 8)
                {
                    bitCount -= 8;
                    output.Add((byte)((buffer >> bitCount) & 0xFF));
                }

                buffer &= (1 << bitCount) - 1;
            }

            return output.Count == PayloadBytes ? output.ToArray() : null;
        }

        /// <summary>
        /// Normalise un code saisi par un humain : majuscules, suppression des
        /// espaces et des tirets, et correction des confusions classiques
        /// (O→0, I→1, L→1). Exactement la même règle que côté jeu.
        /// </summary>
        /// <param name="code">Code brut.</param>
        /// <returns>La forme normalisée (peut être plus courte que 32 si l'entrée l'est).</returns>
        public static string Normalize(string code)
        {
            if (string.IsNullOrEmpty(code))
                return string.Empty;

            StringBuilder output = new StringBuilder(code.Length);
            foreach (char raw in code.ToUpperInvariant())
            {
                if (char.IsWhiteSpace(raw) || raw == '-')
                    continue;

                char character = raw;
                if (character == 'O')
                    character = '0';
                else if (character == 'I' || character == 'L')
                    character = '1';

                output.Append(character);
            }
            return output.ToString();
        }

        /// <summary>
        /// Met un code normalisé sous la forme affichée, en groupes de 4 séparés
        /// par des tirets (<c>XXXX-XXXX-…</c>), plus lisible et plus facile à dicter.
        /// </summary>
        /// <param name="normalized">Code sans tirets.</param>
        /// <returns>Le code mis en forme.</returns>
        public static string Format(string normalized)
        {
            if (string.IsNullOrEmpty(normalized))
                return string.Empty;

            StringBuilder output = new StringBuilder(normalized.Length + normalized.Length / 4);
            for (int index = 0; index < normalized.Length; index++)
            {
                if (index > 0 && index % 4 == 0)
                    output.Append('-');
                output.Append(normalized[index]);
            }
            return output.ToString();
        }

        /// <summary>Convertit des octets en chaîne hexadécimale minuscule (débogage et tests).</summary>
        public static string ToHex(byte[] bytes)
        {
            if (bytes == null)
                throw new ArgumentNullException(nameof(bytes));

            StringBuilder output = new StringBuilder(bytes.Length * 2);
            foreach (byte value in bytes)
                output.Append(value.ToString("x2", CultureInfo.InvariantCulture));
            return output.ToString();
        }

        /// <summary>Convertit une chaîne hexadécimale en octets (débogage et tests).</summary>
        public static byte[] HexToBytes(string hex)
        {
            if (string.IsNullOrWhiteSpace(hex))
                throw new ArgumentException("La chaîne hexadécimale est vide.", nameof(hex));

            string text = hex.Trim();
            if (text.Length % 2 != 0)
                throw new ArgumentException("La chaîne hexadécimale doit avoir une longueur paire.", nameof(hex));

            byte[] bytes = new byte[text.Length / 2];
            for (int index = 0; index < bytes.Length; index++)
            {
                if (!byte.TryParse(
                        text.Substring(index * 2, 2),
                        NumberStyles.HexNumber,
                        CultureInfo.InvariantCulture,
                        out bytes[index]))
                {
                    throw new ArgumentException(
                        $"La chaîne hexadécimale contient un caractère invalide : « {text} ».",
                        nameof(hex));
                }
            }
            return bytes;
        }

        // ---------------------------------------------------------------------
        //  Auto-tests (vecteurs de la spécification + aller-retour)
        // ---------------------------------------------------------------------

        /// <summary>
        /// Rejoue les vecteurs de test du document de spécification et un aller-retour
        /// génération → vérification, avec la CLÉ DE TEST (jamais la clé réelle).
        ///
        /// Sert à vérifier que ce portage C# produit exactement les mêmes codes que le
        /// jeu. Renvoie un rapport plutôt que d'échouer, pour rester utilisable dans
        /// n'importe quel hôte (application console, test unitaire, outil de build).
        /// </summary>
        /// <returns>Le rapport d'exécution.</returns>
        public static SelfTestReport RunSelfTests()
        {
            List<string> failures = new List<string>();
            int checks = 0;

            // Petit utilitaire local : compte un contrôle et mémorise les échecs.
            Action<string, bool> check = (label, condition) =>
            {
                checks++;
                if (!condition)
                    failures.Add(label);
            };

            CodeGeneration generator = FromHexKey(TestKeyHex);

            // --- Vecteurs officiels ------------------------------------------
            // Ces deux codes sont fournis par la spécification : s'ils sont
            // reproduits à l'octet près, le portage est correct.
            GeneratedCode boosterVector = generator.Generate(
                TestUuid,
                CanonicalBooster("A1"),
                3,
                HexToBytes("0102030405"));
            check(
                "vecteur 1 : payload",
                ToHex(boosterVector.Bytes) == "010102030405058b9700032065bc1f8d8b7e7c60");
            check(
                "vecteur 1 : code",
                boosterVector.Code == "040G-40R4-0M2R-Q5R0-0CG6-BF0Z-HP5Q-WZ30");

            GeneratedCode cardVector = generator.Generate(
                TestUuid,
                CanonicalCard("SERIE-A1 / P004", "fullart"),
                1,
                HexToBytes("a1b2c3d4e5"));
            check(
                "vecteur 2 : payload",
                ToHex(cardVector.Bytes) == "01a1b2c3d4e5b75d8400012065e1c817d43eb5f8");
            check(
                "vecteur 2 : code",
                cardVector.Code == "06GV-5GYM-WPVN-V100-04G6-BRE8-2ZA3-XDFR");

            GeneratedCode otherUserVector = generator.Generate(
                TestOtherUuid,
                CanonicalBooster("A1"),
                3,
                HexToBytes("0102030405"));
            check(
                "vecteur « autre compte » : payload",
                ToHex(otherUserVector.Bytes) == "010102030405058b9700039318a069dae05e8d8b");

            // --- Aller-retour génération → vérification ----------------------
            string[] catalogue = { CanonicalSparks(), CanonicalBooster("A1") };
            VerifyResult sparksCheck = generator.Verify(
                generator.GenerateSparks(TestUuid, 42).Code,
                TestUuid,
                catalogue);
            check("aller-retour Sparks : statut", sparksCheck.Status == VerifyStatus.Ok);
            check("aller-retour Sparks : quantité", sparksCheck.Quantity == 42);
            check("aller-retour Sparks : item", sparksCheck.CanonicalItem == CanonicalSparks());

            // Un code émis pour un autre compte doit être refusé.
            VerifyResult foreignCheck = generator.Verify(
                generator.GenerateSparks(TestOtherUuid, 1).Code,
                TestUuid,
                catalogue);
            check("code d'un autre compte refusé", foreignCheck.Status == VerifyStatus.WrongUser);

            // Un code dont un caractère est modifié doit casser le MAC.
            GeneratedCode tamperSource = generator.GenerateSparks(TestUuid, 10);
            char last = tamperSource.Normalized[NormalizedLength - 1];
            string tampered = tamperSource.Normalized.Substring(0, NormalizedLength - 1)
                + (last == '0' ? '1' : '0');
            check(
                "code altéré refusé",
                generator.Verify(tampered, TestUuid, catalogue).Status == VerifyStatus.Invalid);

            // Un item inconnu du catalogue doit être signalé comme tel.
            check(
                "item inconnu",
                generator.Verify(
                    generator.GenerateSparks(TestUuid, 5).Code,
                    TestUuid,
                    new[] { CanonicalBooster("A1") }).Status == VerifyStatus.UnknownItem);

            // Un code bien formé mais trop court doit être refusé au format.
            check(
                "format invalide",
                generator.Verify("AAAA", TestUuid, catalogue).Status == VerifyStatus.InvalidFormat);

            // --- Encodage / décodage ----------------------------------------
            byte[] sample = new byte[PayloadBytes];
            for (int index = 0; index < sample.Length; index++)
                sample[index] = (byte)(index * 7 + 3);
            check(
                "décodage de l'encodage",
                ToHex(DecodeCrockford(EncodeCrockford(sample))) == ToHex(sample));

            // --- Tolérance de saisie ----------------------------------------
            GeneratedCode lenientSource = generator.GenerateSparks(TestUuid, 7);
            string lenient = lenientSource.Normalized.ToLowerInvariant().Replace("0", "o");
            check(
                "saisie tolérante (minuscules + O au lieu de 0)",
                generator.Verify(lenient, TestUuid, catalogue).Status == VerifyStatus.Ok);

            return new SelfTestReport(failures.Count == 0, checks, failures);
        }
    }
}