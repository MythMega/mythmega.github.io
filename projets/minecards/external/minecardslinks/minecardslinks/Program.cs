using System;
using System.IO;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace minecardslinks
{
    internal class Program
    {
        private static readonly JsonSerializerOptions JsonOptions = new()
        {
            PropertyNameCaseInsensitive = true
        };

        private static readonly object ConsoleLock = new();

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
            else
            {
                await SendJsonResponseAsync(response, 404, "Érreur : Route introuvable.");
            }
        }

        private static async Task SendJsonResponseAsync(HttpListenerResponse response, int statusCode, string message)
        {
            response.StatusCode = statusCode;
            response.ContentType = "application/json; charset=utf-8";

            var payload = new
            {
                Code = statusCode,
                Message = message
            };

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