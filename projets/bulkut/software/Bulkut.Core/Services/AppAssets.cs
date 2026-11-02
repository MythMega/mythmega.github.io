using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using Bulkut.Core.Models;

namespace Bulkut.Core.Services;

/// <summary>
/// Loads the configuration and translation files shared with the web app. They
/// are embedded in the assembly; when the same files sit next to the executable
/// (in a <c>settings/</c> or <c>translations/</c> folder) they take precedence,
/// so users can tweak them without rebuilding.
/// </summary>
public sealed class AppAssets
{
    private readonly Assembly _assembly = typeof(AppAssets).Assembly;
    private readonly string _baseDirectory;
    private readonly Dictionary<string, JsonNode?> _translations = new(StringComparer.OrdinalIgnoreCase);

    public AppAssets(string? baseDirectory = null)
    {
        _baseDirectory = baseDirectory ?? AppContext.BaseDirectory;
    }

    public string RawConfig => ReadText("Bulkut.Core.Assets.config.json", "settings/config.json");
    public string RawDefaults => ReadText("Bulkut.Core.Assets.default.json", "settings/default.json");
    public string RawDesktop => ReadText("Bulkut.Core.Assets.desktop.json", "settings/desktop.json");

    public WebConfig Config => Deserialize<WebConfig>(RawConfig);
    public DefaultsFile Defaults => Deserialize<DefaultsFile>(RawDefaults);
    public DesktopOptions Desktop => Deserialize<DesktopOptions>(RawDesktop);

    public IReadOnlyList<string> AvailableLanguages()
    {
        var embedded = _assembly.GetManifestResourceNames()
            .Where(name => name.StartsWith("Bulkut.Core.Assets.translations.", StringComparison.OrdinalIgnoreCase))
            .Select(name => name["Bulkut.Core.Assets.translations.".Length..])
            .Where(name => name.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
            .Select(Path.GetFileNameWithoutExtension)
            .Where(name => !string.IsNullOrEmpty(name))
            .Select(name => name!)
            .ToList();

        var folder = Path.Combine(_baseDirectory, "translations");
        if (Directory.Exists(folder))
        {
            embedded.AddRange(Directory.EnumerateFiles(folder, "*.json")
                .Select(Path.GetFileNameWithoutExtension)
                .Where(name => !string.IsNullOrEmpty(name))
                .Select(name => name!));
        }

        return embedded.Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(lang => lang).ToList();
    }

    public JsonNode TranslationNode(string language)
    {
        if (_translations.TryGetValue(language, out var cached)) return cached ?? new JsonObject();

        var resourceName = $"Bulkut.Core.Assets.translations.{language}.json";
        var text = ReadText(resourceName, Path.Combine("translations", $"{language}.json"));

        try
        {
            var node = JsonNode.Parse(text) ?? new JsonObject();
            _translations[language] = node;
            return node;
        }
        catch (JsonException)
        {
            return new JsonObject();
        }
    }

    public string ReadText(string resourceName, string overrideRelativePath)
    {
        var overridePath = Path.Combine(_baseDirectory, overrideRelativePath);
        if (File.Exists(overridePath))
        {
            try
            {
                return File.ReadAllText(overridePath);
            }
            catch (IOException)
            {
                // Fall through to the embedded copy.
            }
        }

        using var stream = _assembly.GetManifestResourceStream(resourceName)
                           ?? throw new FileNotFoundException($"Missing embedded asset {resourceName}");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    public static T Deserialize<T>(string json) where T : new()
    {
        try
        {
            return JsonSerializer.Deserialize<T>(json, JsonDefaults.Options) ?? new T();
        }
        catch (JsonException)
        {
            return new T();
        }
    }
}
