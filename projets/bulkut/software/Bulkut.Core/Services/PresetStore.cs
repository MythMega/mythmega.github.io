using Bulkut.Core.Models;

namespace Bulkut.Core.Services;

/// <summary>
/// Per-tab presets. The web app stores them in cookies; the desktop stores the
/// same structure in the application-data state file. Names are unique per tab,
/// case-insensitively.
/// </summary>
public sealed class PresetStore(SettingsStore settings)
{
    public IReadOnlyList<Preset> List(string scope) =>
        Collection(scope).Items
            .OrderBy(preset => preset.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToList();

    public Preset Save(string scope, string? rawName, Dictionary<string, double> numbers, Dictionary<string, string> texts)
    {
        var name = CleanName(rawName);
        if (name.Length == 0) throw new AppException(AppErrorCodes.PresetNameEmpty);

        var collection = Collection(scope);
        if (collection.Items.Any(preset => string.Equals(preset.Name, name, StringComparison.CurrentCultureIgnoreCase)))
            throw new AppException(AppErrorCodes.PresetNameTaken, name);

        var preset = new Preset
        {
            Name = name,
            CreatedAt = DateTimeOffset.Now.ToString("O"),
            Numbers = new Dictionary<string, double>(numbers),
            Texts = new Dictionary<string, string>(texts),
        };
        collection.Items.Add(preset);
        settings.Save();
        return preset;
    }

    public bool Delete(string scope, string name)
    {
        var collection = Collection(scope);
        var removed = collection.Items.RemoveAll(preset =>
            string.Equals(preset.Name, name, StringComparison.CurrentCultureIgnoreCase));
        if (removed > 0) settings.Save();
        return removed > 0;
    }

    public Preset? Find(string scope, string name) =>
        Collection(scope).Items.FirstOrDefault(preset =>
            string.Equals(preset.Name, name, StringComparison.CurrentCultureIgnoreCase));

    public string CleanName(string? raw)
    {
        var name = (raw ?? "").Trim();
        name = string.Join(' ', name.Split(' ', StringSplitOptions.RemoveEmptyEntries));
        return name.Length > 40 ? name[..40] : name;
    }

    private PresetCollection Collection(string scope)
    {
        if (!settings.State.Presets.TryGetValue(scope, out var collection))
        {
            collection = new PresetCollection();
            settings.State.Presets[scope] = collection;
        }
        return collection;
    }
}
