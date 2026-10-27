using System.Text.Json;
using Bulkut.Core.Features;
using Bulkut.Core.Models;
using Bulkut.Core.Services;
using Xunit;

namespace Bulkut.Tests;

public sealed class SettingsAndPresetTests : IDisposable
{
    private readonly string _stateDirectory = Path.Combine(Path.GetTempPath(), "bulkut-state-" + Guid.NewGuid().ToString("N"));

    [Fact]
    public void LoadsDefaultsFromTheSharedWebFiles()
    {
        var settings = new SettingsStore(new AppAssets(), _stateDirectory);

        Assert.Equal(-30, settings.Params.Autocut.ThresholdDb);
        Assert.Equal(0.15, settings.Params.Autocut.PreCut);
        Assert.Equal("-autocut", settings.Params.Autocut.Suffix);
        Assert.Equal("-cut", settings.Params.Fastcut.Suffix);
        Assert.Equal(60, settings.Processing.PreviewDuration);
        Assert.Equal(400, settings.Processing.MaxSegments);
        Assert.Equal("libx264", settings.Processing.VideoCodec);
    }

    [Fact]
    public void PersistsAndClampsEditedParameters()
    {
        var first = new SettingsStore(new AppAssets(), _stateDirectory);
        first.Params.Autocut.ThresholdDb = -120;
        first.Params.Autocut.PreCut = 5;
        first.Params.Autocut.Suffix = " /bad:* ";
        first.Save();

        var second = new SettingsStore(new AppAssets(), _stateDirectory);
        Assert.Equal(-60, second.Params.Autocut.ThresholdDb);
        Assert.Equal(2, second.Params.Autocut.PreCut);
        Assert.Equal("bad", second.Params.Autocut.Suffix);
    }

    [Fact]
    public void PresetNamesAreUniquePerTabAndCaseInsensitive()
    {
        var settings = new SettingsStore(new AppAssets(), _stateDirectory);
        var presets = new PresetStore(settings);

        presets.Save("autocut", "Podcast", new() { ["thresholdDb"] = -34 }, new());
        var error = Assert.Throws<AppException>(() =>
            presets.Save("autocut", " podcast ", new() { ["thresholdDb"] = -20 }, new()));
        Assert.Equal(AppErrorCodes.PresetNameTaken, error.Code);

        presets.Save("fastcut", "Podcast", new(), new() { ["suffix"] = "-p" });

        Assert.Single(presets.List("autocut"));
        Assert.Single(presets.List("fastcut"));
        Assert.True(presets.Delete("autocut", "PODCAST"));
        Assert.Empty(presets.List("autocut"));
    }

    [Fact]
    public void RejectsAnEmptyPresetName()
    {
        var presets = new PresetStore(new SettingsStore(new AppAssets(), _stateDirectory));
        var error = Assert.Throws<AppException>(() => presets.Save("autocut", "   ", new(), new()));
        Assert.Equal(AppErrorCodes.PresetNameEmpty, error.Code);
    }

    [Fact]
    public void AllLanguagesShareTheSameKeys()
    {
        var assets = new AppAssets();
        var english = Flatten(assets.TranslationNode("en"));
        foreach (var language in new[] { "fr", "es" })
        {
            var translated = Flatten(assets.TranslationNode(language));
            Assert.Equal(english.Keys.OrderBy(key => key), translated.Keys.OrderBy(key => key));
        }
    }

    [Fact]
    public void DesktopStringsExistInEveryLanguage()
    {
        var assets = new AppAssets();
        foreach (var language in new[] { "en", "fr", "es" })
        {
            var catalogue = Flatten(assets.TranslationNode(language));
            Assert.True(catalogue.ContainsKey("desktop.engineReady"));
            Assert.True(catalogue.ContainsKey("desktop.savedTo"));
            Assert.True(catalogue.ContainsKey("download.title"));
        }
    }

    [Fact]
    public void TranslationServiceDetectsAndFallsBackToEnglish()
    {
        var assets = new AppAssets();
        var service = new TranslationService(assets, ["en", "fr", "es"], "fr");
        Assert.Equal("fr", service.Language);
        Assert.Equal("Exporter l'extrait", service.T("fastcut.run"));

        Assert.False(service.SetLanguage("fr"));
        Assert.True(service.SetLanguage("en"));
        Assert.Equal("Export clip", service.T("fastcut.run"));
        Assert.Equal("missing.key", service.T("missing.key"));
        Assert.Equal("Bulkut", service.T("app.name", ("ignored", 1)));
    }

    [Fact]
    public void AutoEstimatePersists()
    {
        var first = new SettingsStore(new AppAssets(), _stateDirectory);
        first.State.AutoEstimate = true;
        first.Save();

        var second = new SettingsStore(new AppAssets(), _stateDirectory);
        Assert.True(second.State.AutoEstimate);
    }

    private static Dictionary<string, string> Flatten(System.Text.Json.Nodes.JsonNode? node)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        Walk(node, "", result);
        return result;
    }

    private static void Walk(System.Text.Json.Nodes.JsonNode? node, string prefix, Dictionary<string, string> output)
    {
        if (node is not System.Text.Json.Nodes.JsonObject obj) return;
        foreach (var (key, value) in obj)
        {
            var path = string.IsNullOrEmpty(prefix) ? key : $"{prefix}.{key}";
            if (value is System.Text.Json.Nodes.JsonObject) Walk(value, path, output);
            else if (value is not null) output[path] = value.ToString();
        }
    }

    public void Dispose()
    {
        try
        {
            if (Directory.Exists(_stateDirectory)) Directory.Delete(_stateDirectory, true);
        }
        catch (IOException)
        {
        }
    }
}
