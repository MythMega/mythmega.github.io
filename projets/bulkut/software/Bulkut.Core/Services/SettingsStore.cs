using System.Text.Json;
using Bulkut.Core.Features;
using Bulkut.Core.Models;

namespace Bulkut.Core.Services;

/// <summary>
/// Loads the web configuration and defaults, merges the user's persisted state
/// and writes changes to a JSON file in the OS application-data folder.
/// </summary>
public sealed class SettingsStore
{
    private readonly object _lock = new();

    public SettingsStore(AppAssets? assets = null, string? stateDirectory = null)
    {
        Assets = assets ?? new AppAssets();
        Config = Assets.Config;
        Defaults = Assets.Defaults;
        Desktop = Assets.Desktop;

        var usesDefaultLocation = stateDirectory is null;
        StateDirectory = stateDirectory ?? DefaultStateDirectory();
        StatePath = Path.Combine(StateDirectory, "state.json");
        Directory.CreateDirectory(StateDirectory);
        if (usesDefaultLocation) MigrateLegacyState(StatePath);

        var hasState = File.Exists(StatePath);
        State = ReadState();
        Params = Normalize(hasState ? State.Params : null);

        Processing = CloneProcessing(Config.Processing);
        Processing.Threads = Desktop.Processing.Threads;

        if (string.IsNullOrWhiteSpace(State.OutputFolder) && !string.IsNullOrWhiteSpace(Desktop.Output.Folder))
            State.OutputFolder = Desktop.Output.Folder;
    }

    public AppAssets Assets { get; }
    public WebConfig Config { get; }
    public DefaultsFile Defaults { get; }
    public DesktopOptions Desktop { get; }
    public UserState State { get; }
    public Parameters Params { get; }
    public ProcessingOptions Processing { get; }
    public string StateDirectory { get; }
    public string StatePath { get; }

    public string OutputFolder => Naming.OutputFolder(State.OutputFolder);

    public void Save() => Save(State);

    public void Save(UserState state)
    {
        lock (_lock)
        {
            try
            {
                Directory.CreateDirectory(StateDirectory);
                state.Params = Params;
                var json = JsonSerializer.Serialize(state, JsonDefaults.Options);
                var temp = StatePath + ".tmp";
                File.WriteAllText(temp, json);
                File.Move(temp, StatePath, true);
            }
            catch (IOException)
            {
                // Persistence is best effort: a read-only folder must not break rendering.
            }
            catch (UnauthorizedAccessException)
            {
            }
        }
    }

    public Parameters Normalize(Parameters? input)
    {
        var defaults = Defaults;
        var source = input ?? new Parameters();
        var result = new Parameters
        {
            Autocut = new AutocutParameters
            {
                ThresholdDb = Pick(source.Autocut.ThresholdDb, defaults.Autocut.ThresholdDb),
                PreCut = Pick(source.Autocut.PreCut, defaults.Autocut.PreCut),
                PostCut = Pick(source.Autocut.PostCut, defaults.Autocut.PostCut),
                MinClipDuration = Pick(source.Autocut.MinClipDuration, defaults.Autocut.MinClipDuration),
                MinSilence = Math.Max(0.1, Pick(source.Autocut.MinSilence, defaults.Autocut.MinSilence)),
                Suffix = Naming.SanitizeSuffix(FirstNonEmpty(source.Autocut.Suffix, defaults.Autocut.Suffix, "-autocut")),
                Output = AutocutOutput.Normalize(FirstNonEmpty(source.Autocut.Output, defaults.Autocut.Output, AutocutOutput.Video)),
                Fade = Fades.Normalize(source.Autocut.Fade, Config.Fade, defaults.Autocut.Fade),
            },
            Fastcut = new SuffixSettings
            {
                Suffix = Naming.SanitizeSuffix(FirstNonEmpty(source.Fastcut.Suffix, defaults.Fastcut.Suffix, "-cut")),
                Fade = Fades.Normalize(source.Fastcut.Fade, Config.Fade, defaults.Fastcut.Fade),
            },
            Reverse = new SuffixSettings
            {
                Suffix = Naming.SanitizeSuffix(FirstNonEmpty(source.Reverse.Suffix, defaults.Reverse.Suffix, "-reversed")),
                Fade = Fades.Normalize(source.Reverse.Fade, Config.Fade, defaults.Reverse.Fade),
            },
            Collage = new SuffixSettings
            {
                Suffix = Naming.SanitizeSuffix(FirstNonEmpty(source.Collage.Suffix, defaults.Collage?.Suffix, "-collage")),
                Fade = Fades.Normalize(source.Collage.Fade, Config.Fade, defaults.Collage?.Fade),
            },
            IntroOutro = new SuffixSettings
            {
                Suffix = Naming.SanitizeSuffix(FirstNonEmpty(source.IntroOutro.Suffix, defaults.IntroOutro?.Suffix, "-intro-outro")),
                Fade = Fades.Normalize(source.IntroOutro.Fade, Config.Fade, defaults.IntroOutro?.Fade),
            },
            Splitter = new SuffixSettings
            {
                Suffix = Naming.SanitizeSuffix(FirstNonEmpty(source.Splitter.Suffix, defaults.Splitter?.Suffix, "-split")),
                Fade = Fades.Normalize(source.Splitter.Fade, Config.Fade, defaults.Splitter?.Fade),
            },
        };

        foreach (var spec in AutocutFields.Specs(Config))
        {
            var current = AutocutFields.ValueOf(result.Autocut, spec.Key);
            AutocutFields.SetValue(result.Autocut, spec.Key, Timecode.Clamp(current, spec.Min, spec.Max));
        }

        return result;
    }

    private UserState ReadState()
    {
        try
        {
            if (!File.Exists(StatePath)) return new UserState();
            var json = File.ReadAllText(StatePath);
            return JsonSerializer.Deserialize<UserState>(json, JsonDefaults.Options) ?? new UserState();
        }
        catch (Exception exception) when (exception is IOException or JsonException or UnauthorizedAccessException)
        {
            return new UserState();
        }
    }

    private static string FirstNonEmpty(params string?[] values) =>
        values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value)) ?? "";

    private static double Pick(double value, double fallback) => double.IsFinite(value) ? value : fallback;

    private static ProcessingOptions CloneProcessing(ProcessingOptions source) => new()
    {
        MaxFileSizeMb = source.MaxFileSizeMb,
        PreviewDuration = source.PreviewDuration,
        VideoCodec = source.VideoCodec,
        Preset = source.Preset,
        Crf = source.Crf,
        PixelFormat = source.PixelFormat,
        AudioCodec = source.AudioCodec,
        AudioBitrate = source.AudioBitrate,
        MaxSegments = source.MaxSegments,
        ReverseWarningSeconds = source.ReverseWarningSeconds,
        ConcatFps = source.ConcatFps,
        Threads = source.Threads,
    };

    /// <summary>
    /// Copies a state file written by an older build (before the vendor folder was
    /// introduced) so existing presets and settings survive the move.
    /// </summary>
    private static void MigrateLegacyState(string statePath)
    {
        if (!OperatingSystem.IsWindows() || File.Exists(statePath)) return;

        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var legacy = Path.Combine(appData, "Bulkut", "state.json");
        if (!File.Exists(legacy)) return;

        try
        {
            File.Copy(legacy, statePath);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            // A missing copy only means default settings on this launch.
        }
    }

    private static string DefaultStateDirectory()
    {
        if (OperatingSystem.IsWindows())
        {
            var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            return Path.Combine(appData, "JMD", "bulkut");
        }

        if (OperatingSystem.IsMacOS())
        {
            var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            return Path.Combine(home, "Library", "Application Support", "JMD", "bulkut");
        }

        var xdg = Environment.GetEnvironmentVariable("XDG_CONFIG_HOME");
        if (!string.IsNullOrWhiteSpace(xdg)) return Path.Combine(xdg, "jmd", "bulkut");
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".config", "jmd", "bulkut");
    }
}
