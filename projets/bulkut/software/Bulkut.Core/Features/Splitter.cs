using Bulkut.Core.Models;

namespace Bulkut.Core.Features;

/// <summary>One user-defined range exported by the Splitter tab.</summary>
public sealed record SplitRange(double Start, double End)
{
    public double Duration => Math.Max(0, End - Start);
}

/// <summary>Splitter range validation and FFmpeg arguments.</summary>
public static class Splitter
{
    /// <summary>
    /// Clamps and orders the ranges, dropping empty ones. Segments that no longer
    /// fit inside the source are trimmed to its duration.
    /// </summary>
    public static List<SplitRange> Normalize(IEnumerable<SplitRange> ranges, double duration)
    {
        var total = Math.Max(0, duration);
        var result = new List<SplitRange>();
        foreach (var range in ranges)
        {
            var start = Timecode.Clamp(Timecode.RoundTo(range.Start), 0, total);
            var end = Timecode.Clamp(Timecode.RoundTo(range.End), 0, total);
            if (end - start < 0.1) continue;
            result.Add(new SplitRange(start, end));
        }
        return result;
    }

    /// <summary>A numbered suffix keeps exported segments apart without overwriting.</summary>
    public static string SegmentSuffix(string? suffix, int index) =>
        $"{Naming.SanitizeSuffix(suffix)}-{Math.Max(1, index):00}";

    public static IReadOnlyList<string> BuildArgs(
        string input,
        string output,
        double start,
        double end,
        bool hasAudio,
        ProcessingOptions processing,
        FadeSettings? fade)
    {
        var duration = Math.Max(0.1, end - start);
        return Fastcut.BuildArgs(input, output, start, duration, processing, hasAudio, fade);
    }
}
