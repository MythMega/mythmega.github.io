using System.Text.Json.Serialization;
using Bulkut.Core.Features;

namespace Bulkut.Core.Models;

/// <summary>Bounds and step of one Autocut slider, read from <c>config.json</c>.</summary>
public sealed class FieldBounds
{
    public double Min { get; set; }
    public double Max { get; set; }
    public double Step { get; set; } = 1;
}

/// <summary>The <c>autocut</c> section of <c>settings/config.json</c>.</summary>
public sealed class AutocutConfig
{
    public Dictionary<string, FieldBounds> Fields { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}

/// <summary>Bounds of the fade duration slider, read from <c>config.json</c>.</summary>
public sealed class FadeConfig
{
    public double Min { get; set; } = 0.1;
    public double Max { get; set; } = 1;
    public double Step { get; set; } = 0.1;
    public double DefaultDuration { get; set; } = 1;
}

/// <summary>The <c>splitter</c> section of <c>config.json</c>.</summary>
public sealed class SplitterConfig
{
    public int MaxSegments { get; set; } = 50;
}

/// <summary>Audio and video fades applied once to a finished file.</summary>
public sealed class FadeSettings
{
    public string Audio { get; set; } = "none";
    public string Video { get; set; } = "none";
    public double Duration { get; set; } = 1;

    public FadeSettings Clone() => (FadeSettings)MemberwiseClone();
}

/// <summary>Video encoding options shared by every feature.</summary>
public sealed class ProcessingOptions
{
    public double MaxFileSizeMb { get; set; } = 2048;
    public double PreviewDuration { get; set; } = 60;
    public string VideoCodec { get; set; } = "libx264";
    public string Preset { get; set; } = "veryfast";
    public int Crf { get; set; } = 23;
    public string PixelFormat { get; set; } = "yuv420p";
    public string AudioCodec { get; set; } = "aac";
    public string AudioBitrate { get; set; } = "128k";
    public int MaxSegments { get; set; } = 400;
    public double ReverseWarningSeconds { get; set; } = 120;
    public int ConcatFps { get; set; } = 30;

    /// <summary>0 lets FFmpeg use every available core.</summary>
    public int Threads { get; set; }
}

public sealed class UiConfig
{
    public int ToastDuration { get; set; } = 4500;
}

public sealed class DownloadsConfig
{
    public string Version { get; set; } = "1.0.0";
    public string BaseUrl { get; set; } = "";
    public Dictionary<string, string> Files { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}

/// <summary>The subset of the web <c>config.json</c> the desktop needs.</summary>
public sealed class WebConfig
{
    public AppConfig App { get; set; } = new();
    public ProcessingOptions Processing { get; set; } = new();
    public AutocutConfig Autocut { get; set; } = new();
    public FadeConfig Fade { get; set; } = new();
    public SplitterConfig Splitter { get; set; } = new();
    public UiConfig Ui { get; set; } = new();
    public DownloadsConfig Downloads { get; set; } = new();
}

public sealed class AppConfig
{
    public string Name { get; set; } = "Bulkut";
    public string Version { get; set; } = "1.0.0";
    public string StoragePrefix { get; set; } = "bulkut";
    public string WebUrl { get; set; } = "https://mythmega.github.io/projets/bulkut/";
    public List<string> Languages { get; set; } = ["en", "fr", "es"];
    public string DefaultLanguage { get; set; } = "auto";
}

/// <summary>Editable Autocut parameters, shared by the global settings and per-video overrides.</summary>
public sealed class AutocutParameters
{
    public double ThresholdDb { get; set; } = -30;
    public double PreCut { get; set; } = 0.15;
    public double PostCut { get; set; } = 0.2;
    public double MinClipDuration { get; set; } = 0.25;
    public double MinSilence { get; set; } = 0.5;
    public string Suffix { get; set; } = "-autocut";

    /// <summary><c>video</c>, <c>premiere</c> or <c>davinci</c>.</summary>
    public string Output { get; set; } = "video";
    public FadeSettings Fade { get; set; } = new();

    public AutocutParameters Clone() => (AutocutParameters)MemberwiseClone();

    /// <summary>Applies an override on top of these (global) values.</summary>
    public AutocutParameters With(AutocutParameters? overrides)
    {
        if (overrides is null) return Clone();
        return new AutocutParameters
        {
            ThresholdDb = overrides.ThresholdDb,
            PreCut = overrides.PreCut,
            PostCut = overrides.PostCut,
            MinClipDuration = overrides.MinClipDuration,
            MinSilence = overrides.MinSilence,
            Suffix = Suffix,
            Output = AutocutOutput.Normalize(overrides.Output),
            Fade = Fade.Clone(),
        };
    }

    /// <summary>Normalised snapshot of the values that change the rendered output.</summary>
    public double[] RenderKey() =>
    [
        Math.Round(ThresholdDb, 4),
        Math.Round(PreCut, 4),
        Math.Round(PostCut, 4),
        Math.Round(MinClipDuration, 4),
        Math.Round(Fade.Duration, 4),
        FadeModeCode(Fade.Audio),
        FadeModeCode(Fade.Video),
        OutputCode(Output),
    ];

    private static double FadeModeCode(string? mode) => mode switch
    {
        "in" => 1,
        "out" => 2,
        "both" => 3,
        _ => 0,
    };

    private static double OutputCode(string? output) => AutocutOutput.Normalize(output) switch
    {
        AutocutOutput.Premiere => 1,
        AutocutOutput.Davinci => 2,
        _ => 0,
    };

    public bool RenderChangedSince(double[]? previous)
    {
        if (previous is null || previous.Length != 8) return true;
        var current = RenderKey();
        for (var i = 0; i < 8; i++)
            if (Math.Abs(previous[i] - current[i]) > 1e-9) return true;
        return false;
    }
}

/// <summary>Suffix-only settings for the features that have no numeric options.</summary>
public sealed class SuffixSettings
{
    public string Suffix { get; set; } = "";
    public FadeSettings Fade { get; set; } = new();

    public SuffixSettings Clone() => new() { Suffix = Suffix, Fade = Fade.Clone() };
}

/// <summary>Live parameters edited by the user, merged over <c>default.json</c>.</summary>
public sealed class Parameters
{
    public AutocutParameters Autocut { get; set; } = new();
    public SuffixSettings Fastcut { get; set; } = new() { Suffix = "-cut" };
    public SuffixSettings Reverse { get; set; } = new() { Suffix = "-reversed" };
    public SuffixSettings Collage { get; set; } = new() { Suffix = "-collage" };
    public SuffixSettings IntroOutro { get; set; } = new() { Suffix = "-intro-outro" };
    public SuffixSettings Splitter { get; set; } = new() { Suffix = "-split" };

    public Parameters Clone() => new()
    {
        Autocut = Autocut.Clone(),
        Fastcut = Fastcut.Clone(),
        Reverse = Reverse.Clone(),
        Collage = Collage.Clone(),
        IntroOutro = IntroOutro.Clone(),
        Splitter = Splitter.Clone(),
    };
}

/// <summary>Shape of <c>settings/default.json</c>.</summary>
public sealed class DefaultsFile
{
    public AutocutParameters Autocut { get; set; } = new();
    public SuffixSettings Fastcut { get; set; } = new() { Suffix = "-cut" };
    public SuffixSettings Reverse { get; set; } = new() { Suffix = "-reversed" };
    public SuffixSettings? Collage { get; set; }
    public SuffixSettings? IntroOutro { get; set; }
    public SuffixSettings? Splitter { get; set; }
}

public sealed class FfmpegOptions
{
    public string Version { get; set; } = "";
    public Dictionary<string, string> Downloads { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}

public sealed class OutputOptions
{
    /// <summary>Empty means the user's Downloads folder.</summary>
    public string Folder { get; set; } = "";
}

public sealed class WindowOptions
{
    public double Width { get; set; } = 1320;
    public double Height { get; set; } = 880;
    public double MinWidth { get; set; } = 1040;
    public double MinHeight { get; set; } = 680;
}

/// <summary>Shape of the desktop-only <c>desktop.json</c>.</summary>
public sealed class DesktopOptions
{
    public FfmpegOptions Ffmpeg { get; set; } = new();
    public ProcessingOptions Processing { get; set; } = new();
    public OutputOptions Output { get; set; } = new();
    public WindowOptions Window { get; set; } = new();
}

public sealed class Preset
{
    public string Name { get; set; } = "";
    public string CreatedAt { get; set; } = "";
    public Dictionary<string, double> Numbers { get; set; } = new();
    public Dictionary<string, string> Texts { get; set; } = new();
}

public sealed class PresetCollection
{
    public List<Preset> Items { get; set; } = [];
}

/// <summary>Persisted user state, stored in the OS application-data folder.</summary>
public sealed class UserState
{
    public string? Language { get; set; }
    public Parameters Params { get; set; } = new();
    public bool AutoEstimate { get; set; }
    public string? OutputFolder { get; set; }
    public Dictionary<string, PresetCollection> Presets { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}

public static class JsonDefaults
{
    public static readonly System.Text.Json.JsonSerializerOptions Options = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase,
        WriteIndented = true,
        ReadCommentHandling = System.Text.Json.JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };
}
