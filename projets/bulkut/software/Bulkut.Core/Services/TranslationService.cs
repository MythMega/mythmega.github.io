using System.Globalization;
using System.Text.Json.Nodes;

namespace Bulkut.Core.Services;

/// <summary>
/// Reads the web translation files (nested JSON) and exposes dotted keys with
/// <c>{placeholder}</c> interpolation. Missing keys fall back to English.
/// </summary>
public sealed class TranslationService
{
    private readonly AppAssets _assets;
    private readonly Dictionary<string, Dictionary<string, string>> _catalogues = new(StringComparer.OrdinalIgnoreCase);
    private Dictionary<string, string> _current = new();
    private readonly List<string> _languages;

    public TranslationService(AppAssets assets, IEnumerable<string> configuredLanguages, string? preferred = null)
    {
        _assets = assets;
        _languages = configuredLanguages
            .Where(lang => !string.IsNullOrWhiteSpace(lang))
            .Select(lang => lang.Trim().ToLowerInvariant())
            .Distinct()
            .ToList();
        if (_languages.Count == 0) _languages.Add("en");
        if (!_languages.Contains("en")) _languages.Add("en");

        Language = Resolve(preferred);
        Load(Language);
    }

    public event Action? LanguageChanged;

    public string Language { get; private set; }

    public IReadOnlyList<string> Languages => _languages;

    public string T(string key, params (string Key, object? Value)[] args)
    {
        var text = Lookup(_current, key);
        if (text is null)
        {
            var fallback = Catalogue("en");
            text = Lookup(fallback, key);
        }

        text ??= key;
        foreach (var (name, value) in args)
            text = text.Replace("{" + name + "}", Convert.ToString(value, CultureInfo.InvariantCulture) ?? "", StringComparison.Ordinal);

        return text;
    }

    public string LanguageLabel(string code) => code.ToUpperInvariant() switch
    {
        "EN" => "English",
        "FR" => "Français",
        "ES" => "Español",
        _ => code.ToUpperInvariant(),
    };

    public bool SetLanguage(string? code)
    {
        var next = Resolve(code);
        if (string.Equals(next, Language, StringComparison.OrdinalIgnoreCase)) return false;
        Language = next;
        Load(next);
        LanguageChanged?.Invoke();
        return true;
    }

    private string Resolve(string? requested)
    {
        if (!string.IsNullOrWhiteSpace(requested) && _languages.Contains(requested, StringComparer.OrdinalIgnoreCase))
            return _languages.First(lang => string.Equals(lang, requested, StringComparison.OrdinalIgnoreCase));

        var system = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName.ToLowerInvariant();
        return _languages.Contains(system) ? system : "en";
    }

    private void Load(string language)
    {
        _current = Catalogue(language);
    }

    private Dictionary<string, string> Catalogue(string language)
    {
        if (_catalogues.TryGetValue(language, out var cached)) return cached;

        var node = _assets.TranslationNode(language);
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        Flatten(node, "", result);
        _catalogues[language] = result;
        return result;
    }

    private static void Flatten(JsonNode? node, string prefix, Dictionary<string, string> output)
    {
        if (node is not JsonObject obj) return;
        foreach (var (key, value) in obj)
        {
            var path = string.IsNullOrEmpty(prefix) ? key : $"{prefix}.{key}";
            if (value is JsonObject)
            {
                Flatten(value, path, output);
            }
            else if (value is not null)
            {
                output[path] = value.ToString();
            }
        }
    }

    private static string? Lookup(IReadOnlyDictionary<string, string> catalogue, string key) =>
        catalogue.TryGetValue(key, out var value) ? value : null;
}
