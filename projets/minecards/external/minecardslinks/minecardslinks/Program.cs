using System;
using System.IO;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using minecardslinks.Entity;

namespace minecardslinks
{
    internal class Program
    {
        private static readonly JsonSerializerOptions JsonOptions = new()
        {
            PropertyNameCaseInsensitive = true
        };

        private static readonly object ConsoleLock = new();

        // Clé partagée (base64, 32 octets) = useritemCode.key de settings/config.json.
        // À définir dans la variable d'environnement MINECARDS_USERITEM_KEY.
        private const string CodeKeyEnvVar = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

        private static readonly Lazy<CodeGeneration> CodeGenerator = new(() =>
            CodeGeneration.FromBase64Key("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="));

        private static async Task Main(string[] args)
        {
            DatabaseApp.Initialize();

            using var listener = new HttpListener();
            listener.Prefixes.Add("http://localhost:9191/");
            listener.Start();

            LogConsole(200, "Serveur démarré sur http://localhost:9191/");

            while (true)
            {
                var context = await listener.GetContextAsync();
                _ = Task.Run(() => HandleRequestAsync(context));
            }
        }

        private static async Task HandleRequestAsync(HttpListenerContext context)
        {
            var request = context.Request;
            using var response = context.Response;
            if (request.HttpMethod == "OPTIONS")
                return;
            Console.WriteLine("Path: " + request.Url?.AbsolutePath + " - Method: " + request.HttpMethod);
            if (request.HttpMethod == "POST" && request.Url?.AbsolutePath == "/Link")
            {
                try
                {
                    using var reader = new StreamReader(request.InputStream, request.ContentEncoding);
                    string body = await reader.ReadToEndAsync();

                    var linkObj = JsonSerializer.Deserialize<LinkObject>(body, JsonOptions);

                    if (linkObj == null || string.IsNullOrWhiteSpace(linkObj.ID) ||
                        string.IsNullOrWhiteSpace(linkObj.Username) || string.IsNullOrWhiteSpace(linkObj.UUID))
                    {
                        await SendJsonResponseAsync(response, 400, "Érreur : Champs JSON manquants ou invalides.");
                        return;
                    }

                    if (!Validator.IsValidUuid(linkObj.UUID))
                    {
                        await SendJsonResponseAsync(response, 400, "Érreur : L'UUID doit respecter le format 00000000-0000-0000-0000-000000000000.");
                        return;
                    }

                    DatabaseApp.SaveOrUpdate(linkObj);
                    await SendJsonResponseAsync(response, 200, "Succès : Liens enregistrés avec succès.");
                }
                catch (JsonException)
                {
                    await SendJsonResponseAsync(response, 400, "Érreur : Le corps de la requête n'est pas un JSON valide.");
                }
                catch (Exception ex)
                {
                    await SendJsonResponseAsync(response, 500, $"Érreur : Problème lors du traitement ({ex.Message}).");
                }
            }
            // =================================================================
            //  POST /GenerateCode
            //  Génère un code personnel « useritem » (voir CodeGeneration.cs).
            //  Corps JSON : { "Type", "ID", "Quantity", "UUID", "Layout" (card seulement, optionnel) }
            //
            //  Exemple 1 : un booster A1
            //{
            //    "Type": "booster",
            //      "ID": "A1",
            //      "Quantity": 1,
            //      "UUID": "123e4567-e89b-12d3-a456-426614174000"
            //  }
            //
            //  Exemple 2 : une carte spécifique (l'ID est l'Index EXACT de la carte, espaces compris)
            //  {
            //      "Type": "card",
            //      "ID": "SERIE-A1 / P004",
            //      "Quantity": 1,
            //      "Layout": "fullart",
            //      "UUID": "123e4567-e89b-12d3-a456-426614174000"
            //  }
            //
            //  Exemple 3 : 200 sparks (ID ignoré, on peut l'omettre)
            //  {
            //      "Type": "spark",
            //      "Quantity": 200,
            //      "UUID": "123e4567-e89b-12d3-a456-426614174000"
            //  }
            //
            //  Réponse : { "Code": 200, "Message": "...", "Data": { "Code": "XXXX-XXXX-...", "Item": "booster:A1", "Quantity": 1, "UUID": "..." } }
            // =================================================================
            else if (request.HttpMethod == "POST" &&
                     string.Equals((request.Url?.AbsolutePath ?? "").TrimEnd('/'), "/GenerateCode", StringComparison.OrdinalIgnoreCase))
            {
                await HandleGenerateCodeAsync(request, response);
            }
            // =================================================================
            //  POST
            //  Renvoie simplement le UUID Minecards enregistré pour un ID
            //  Twitch/YouTube/Discord (celui enregistré par POST /Link).
            //
            //  Exemple : POST http://localhost:9191/GetUuid
            //            { "Id": "154512"}
            //
            //  Réponse : { "Code": 200, "Message": "...",
            //              "Data": { "ID": "...", "Username": "...", "UUID": "..." } }
            //  404 quand l'ID n'a jamais été enregistré, 400 quand l'ID manque.
            // =================================================================
            else if (request.HttpMethod == "POST" && IsRoute(request, "GetUuid"))
            {
                await HandlePostUuidAsync(request, response);
            }
            else
            {
                await SendJsonResponseAsync(response, 404, "Érreur : Route introuvable.");
            }
        }

        /// <summary>
        /// Compare le PREMIER segment du chemin à un nom de route (insensible à la casse) :
        /// « /GetUuid », « /GetUuid/ » et « /GetUuid/mon_id » désignent la même route.
        /// </summary>
        private static bool IsRoute(HttpListenerRequest request, string route)
        {
            string path = (request.Url?.AbsolutePath ?? string.Empty).Trim('/');
            if (path.Length == 0)
                return false;

            int slash = path.IndexOf('/');
            string head = slash < 0 ? path : path.Substring(0, slash);
            return string.Equals(head, route, StringComparison.OrdinalIgnoreCase);
        }


        /// <summary>
        /// Post /GetUuid : lit l'ID demandé et renvoie le lien enregistré, sans rien modifier.
        /// </summary>
        private static async Task HandlePostUuidAsync(HttpListenerRequest request, HttpListenerResponse response)
        {
            try
            {

                using var reader = new StreamReader(request.InputStream, request.ContentEncoding);
                string body = await reader.ReadToEndAsync();

                var req = JsonSerializer.Deserialize<GenerateCodeRequest>(body, JsonOptions);

                if (string.IsNullOrWhiteSpace(req.ID))
                {
                    await SendJsonResponseAsync(response, 400, "Érreur : Paramètre 'id' manquant (GET /GetUuid?id=...).");
                    return;
                }

                LinkObject link = DatabaseApp.GetById(req.ID);
                if (link == null)
                {
                    await SendJsonResponseAsync(response, 404, $"Érreur : Aucun UUID enregistré pour l'ID '{req.ID}'.");
                    return;
                }

                await SendJsonResponseAsync(response, 200, "Succès : UUID trouvé.", new
                {
                    ID = link.ID,
                    Username = link.Username,
                    UUID = link.UUID
                });
            }
            catch (Exception ex)
            {
                await SendJsonResponseAsync(response, 500, $"Érreur : Problème lors du traitement ({ex.Message}).");
            }
        }

        private static async Task HandleGenerateCodeAsync(HttpListenerRequest request, HttpListenerResponse response)
        {
            try
            {
                using var reader = new StreamReader(request.InputStream, request.ContentEncoding);
                string body = await reader.ReadToEndAsync();

                var req = JsonSerializer.Deserialize<GenerateCodeRequest>(body, JsonOptions);

                if (req == null || string.IsNullOrWhiteSpace(req.Type) || string.IsNullOrWhiteSpace(req.UUID))
                {
                    await SendJsonResponseAsync(response, 400, "Érreur : Champs JSON manquants ou invalides (Type, Quantity et UUID sont requis).");
                    return;
                }

                if (req.Quantity < 1 || req.Quantity > CodeGeneration.MaxQuantity)
                {
                    await SendJsonResponseAsync(response, 400, $"Érreur : Quantity doit être comprise entre 1 et {CodeGeneration.MaxQuantity}.");
                    return;
                }

                if (!CodeGeneration.TryParseUuid(req.UUID, out _))
                {
                    await SendJsonResponseAsync(response, 400, "Érreur : UUID invalide.");
                    return;
                }

                CodeGeneration generator;
                try
                {
                    generator = CodeGenerator.Value;
                }
                catch (Exception)
                {
                    await SendJsonResponseAsync(response, 500, $"Érreur : Clé de génération absente ou invalide (variable d'environnement {CodeKeyEnvVar}).");
                    return;
                }

                GeneratedCode generated;
                switch (req.Type.Trim().ToLowerInvariant())
                {
                    case "spark":
                    case "sparks":
                        generated = generator.GenerateSparks(req.UUID, req.Quantity);
                        break;

                    case "booster":
                        if (string.IsNullOrWhiteSpace(req.ID))
                        {
                            await SendJsonResponseAsync(response, 400, "Érreur : ID (id de l'extension, ex. A1) requis pour un booster.");
                            return;
                        }
                        generated = generator.GenerateBooster(req.UUID, req.ID, req.Quantity);
                        break;

                    case "card":
                        if (string.IsNullOrWhiteSpace(req.ID))
                        {
                            await SendJsonResponseAsync(response, 400, "Érreur : ID (Index de la carte) requis pour une carte.");
                            return;
                        }
                        string layout = string.IsNullOrWhiteSpace(req.Layout) ? "classic" : req.Layout;
                        generated = generator.GenerateCard(req.UUID, req.ID, layout, req.Quantity);
                        break;

                    default:
                        await SendJsonResponseAsync(response, 400, "Érreur : Type inconnu (valeurs possibles : card, booster, spark).");
                        return;
                }

                await SendJsonResponseAsync(response, 200, "Succès : Code généré.", new
                {
                    Code = generated.Code,
                    Item = generated.CanonicalItem,
                    Quantity = generated.Quantity,
                    UUID = generated.Uuid
                });
            }
            catch (JsonException)
            {
                await SendJsonResponseAsync(response, 400, "Érreur : Le corps de la requête n'est pas un JSON valide.");
            }
            catch (ArgumentException ex)
            {
                await SendJsonResponseAsync(response, 400, $"Érreur : {ex.Message}");
            }
            catch (Exception ex)
            {
                await SendJsonResponseAsync(response, 500, $"Érreur : Problème lors du traitement ({ex.Message}).");
            }
        }

        private static async Task SendJsonResponseAsync(HttpListenerResponse response, int statusCode, string message, object data = null)
        {
            response.StatusCode = statusCode;
            response.ContentType = "application/json; charset=utf-8";

            object payload = data == null
                ? new { Code = statusCode, Message = message }
                : new { Code = statusCode, Message = message, Data = data };

            string jsonResponse = JsonSerializer.Serialize(payload);
            byte[] buffer = Encoding.UTF8.GetBytes(jsonResponse);

            response.ContentLength64 = buffer.Length;
            await response.OutputStream.WriteAsync(buffer);

            // Affichage dans la console
            LogConsole(statusCode, message);
        }

        private static void LogConsole(int statusCode, string message)
        {
            lock (ConsoleLock)
            {
                bool isSuccess = statusCode >= 200 && statusCode < 300;
                Console.ForegroundColor = isSuccess ? ConsoleColor.Green : ConsoleColor.Red;
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] [{statusCode}] {message}");
                Console.ResetColor();
            }
        }
    }
}