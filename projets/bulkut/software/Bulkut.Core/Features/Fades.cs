using System.Globalization;
using Bulkut.Core.Models;

namespace Bulkut.Core.Features;

/// <summary>
/// Audio and video fades applied once to a finished file. Each stream can fade
/// in, out, both or not at all, and the duration is shared by both.
/// </summary>
public static class Fades
{
    public static readonly string[] Modes = ["none", "in", "out", "both"];

    public static string NormalizeMode(string? mode) =>
        mode is not null && Modes.Contains(mode, StringComparer.OrdinalIgnoreCase)
            ? mode.ToLowerInvariant()
            : "none";

    public static double NormalizeDuration(double value, FadeConfig? config = null)
    {
        var min = config is not null && config.Min > 0 ? config.Min : 0.1;
        var max = config is not null && config.Max >= min ? config.Max : 1;
        var duration = double.IsFinite(value) ? value : config?.DefaultDuration ?? 1;
        return Timecode.RoundTo(Timecode.Clamp(duration, min, max), 1);
    }

    public static FadeSettings Normalize(FadeSettings? value, FadeConfig? config = null, FadeSettings? fallback = null)
    {
        var source = value ?? fallback ?? new FadeSettings();
        return new FadeSettings
        {
            Audio = NormalizeMode(source.Audio),
            Video = NormalizeMode(source.Video),
            Duration = NormalizeDuration(source.Duration, config),
        };
    }

    public static bool IsActive(FadeSettings? fade) =>
        fade is not null && (NormalizeMode(fade.Audio) != "none" || NormalizeMode(fade.Video) != "none");

    /// <summary>Video filter chain (without a leading comma), empty when inactive.</summary>
    public static string VideoFilter(FadeSettings? fade, double totalDuration) =>
        Build(fade?.Video, "fade", fade?.Duration ?? 1, totalDuration);

    /// <summary>Audio filter chain (without a leading comma), empty when inactive.</summary>
    public static string AudioFilter(FadeSettings? fade, double totalDuration) =>
        Build(fade?.Audio, "afade", fade?.Duration ?? 1, totalDuration);

    private static string Build(string? mode, string name, double duration, double totalDuration)
    {
        var normalized = NormalizeMode(mode);
        if (normalized == "none") return "";

        var length = Math.Max(0.05, NormalizeDuration(duration));
        var total = Math.Max(length, double.IsFinite(totalDuration) ? totalDuration : length);
        var filters = new List<string>();

        if (normalized is "in" or "both")
            filters.Add($"{name}=t=in:st=0:d={F(length)}");
        if (normalized is "out" or "both")
            filters.Add($"{name}=t=out:st={F(total - length)}:d={F(length)}");

        return string.Join(",", filters);
    }

    /// <summary>Writes the fade values into the preset dictionaries.</summary>
    public static void ToPreset(FadeSettings fade, IDictionary<string, double> numbers, IDictionary<string, string> texts)
    {
        texts["fadeAudio"] = NormalizeMode(fade.Audio);
        texts["fadeVideo"] = NormalizeMode(fade.Video);
        numbers["fadeDuration"] = NormalizeDuration(fade.Duration);
    }

    /// <summary>Reads fade values from a preset, keeping the current ones when absent.</summary>
    public static void FromPreset(Preset preset, FadeSettings fade, FadeConfig? config = null)
    {
        if (preset.Texts.TryGetValue("fadeAudio", out var audio)) fade.Audio = NormalizeMode(audio);
        if (preset.Texts.TryGetValue("fadeVideo", out var video)) fade.Video = NormalizeMode(video);
        if (preset.Numbers.TryGetValue("fadeDuration", out var duration))
            fade.Duration = NormalizeDuration(duration, config);
    }

    public static string PresetSummary(FadeSettings fade) =>
        $"{NormalizeMode(fade.Audio)} / {NormalizeMode(fade.Video)} · {NormalizeDuration(fade.Duration):0.0}s";

    private static string F(double value) => value.ToString("F3", CultureInfo.InvariantCulture);
}
