using System.Globalization;
using System.Text.RegularExpressions;
using Bulkut.Core.Models;

namespace Bulkut.Core.Features;

public sealed record SilenceRange(double Start, double? End);

/// <summary>
/// Autocut maths: parse <c>silencedetect</c> output, apply pre/post-cut margins,
/// build the kept segments and the FFmpeg filter graph. Pure and testable.
/// </summary>
public static partial class Silence
{
    [GeneratedRegex(@"silence_start:\s*(-?\d+(?:\.\d+)?)")]
    private static partial Regex SilenceStartRegex();

    [GeneratedRegex(@"silence_end:\s*(-?\d+(?:\.\d+)?)")]
    private static partial Regex SilenceEndRegex();

    /// <summary>An unterminated silence (still silent at EOF) has a null end.</summary>
    public static List<SilenceRange> ParseLogs(IEnumerable<string> lines)
    {
        var silences = new List<SilenceRange>();
        double? openStart = null;

        foreach (var line in lines)
        {
            var startMatch = SilenceStartRegex().Match(line);
            if (startMatch.Success)
            {
                openStart = Math.Max(0, ParseDouble(startMatch.Groups[1].Value));
                continue;
            }

            var endMatch = SilenceEndRegex().Match(line);
            if (endMatch.Success)
            {
                var end = Math.Max(0, ParseDouble(endMatch.Groups[1].Value));
                var start = openStart ?? 0;
                if (end > start) silences.Add(new SilenceRange(start, end));
                openStart = null;
            }
        }

        if (openStart is not null) silences.Add(new SilenceRange(openStart.Value, null));
        return silences;
    }

    /// <summary>
    /// Inverts silences into speech blocks, applies the margins and drops blocks
    /// shorter than <paramref name="minSegment"/>.
    /// </summary>
    public static List<Segment> ComputeKeepSegments(
        IEnumerable<SilenceRange> silences,
        double duration,
        double preCut = 0,
        double postCut = 0,
        double minSegment = 0.25)
    {
        var total = Math.Max(0, duration);
        if (total <= 0) return [];

        var safePre = Timecode.Clamp(preCut, 0, total);
        var safePost = Timecode.Clamp(postCut, 0, total);
        var minLength = Math.Max(0, minSegment);

        var normalised = silences
            .Select(s => new SilenceRange(
                Timecode.Clamp(s.Start, 0, total),
                Timecode.Clamp(s.End ?? total, 0, total)))
            .Where(s => (s.End ?? 0) > s.Start)
            .OrderBy(s => s.Start)
            .ToList();

        // Merge overlapping detected silences.
        var merged = new List<SilenceRange>();
        foreach (var silence in normalised)
        {
            if (merged.Count > 0 && silence.Start <= merged[^1].End)
            {
                var last = merged[^1];
                merged[^1] = last with { End = Math.Max(last.End ?? 0, silence.End ?? 0) };
            }
            else
            {
                merged.Add(silence);
            }
        }

        // Speech = gaps between silences.
        var speech = new List<Segment>();
        var cursor = 0.0;
        foreach (var silence in merged)
        {
            if (silence.Start > cursor) speech.Add(new Segment(cursor, silence.Start));
            cursor = Math.Max(cursor, silence.End ?? cursor);
        }
        if (cursor < total) speech.Add(new Segment(cursor, total));

        // Margins can make neighbours overlap: merge again.
        var kept = new List<Segment>();
        foreach (var block in speech)
        {
            var start = Math.Max(0, block.Start - safePre);
            var end = Math.Min(total, block.End + safePost);
            if (kept.Count > 0 && start <= kept[^1].End)
                kept[^1] = kept[^1] with { End = Math.Max(kept[^1].End, end) };
            else
                kept.Add(new Segment(start, end));
        }

        return kept
            .Where(block => block.Duration >= minLength)
            .Select(block => new Segment(Timecode.RoundTo(block.Start), Timecode.RoundTo(block.End)))
            .ToList();
    }

    public static double TotalKeptDuration(IEnumerable<Segment> segments) =>
        Timecode.RoundTo(segments.Sum(segment => segment.Duration));

    public static string BuildFilterGraph(
        IReadOnlyList<Segment> segments,
        bool hasAudio,
        FadeSettings? fade = null,
        double totalDuration = 0)
    {
        var chains = new List<string>();
        var concatInputs = "";

        for (var index = 0; index < segments.Count; index++)
        {
            var segment = segments[index];
            var start = F(segment.Start);
            var end = F(segment.End);
            chains.Add($"[0:v]trim=start={start}:end={end},setpts=PTS-STARTPTS[v{index}]");
            if (hasAudio)
            {
                chains.Add($"[0:a]atrim=start={start}:end={end},asetpts=PTS-STARTPTS[a{index}]");
                concatInputs += $"[v{index}][a{index}]";
            }
            else
            {
                concatInputs += $"[v{index}]";
            }
        }

        chains.Add($"{concatInputs}concat=n={segments.Count}:v=1:a={(hasAudio ? 1 : 0)}[vout]{(hasAudio ? "[aout]" : "")}");

        // The fades belong to the finished file, not to each kept clip.
        var total = totalDuration > 0 ? totalDuration : TotalKeptDuration(segments);
        var videoFade = Fades.VideoFilter(fade, total);
        if (videoFade.Length > 0) chains.Add($"[vout]{videoFade}[vf]");
        if (hasAudio)
        {
            var audioFade = Fades.AudioFilter(fade, total);
            if (audioFade.Length > 0) chains.Add($"[aout]{audioFade}[afout]");
        }

        return string.Join(";", chains);
    }

    public static IReadOnlyList<string> BuildSilenceArgs(
        string input,
        double thresholdDb,
        double minSilence,
        double seek = 0,
        double length = 0)
    {
        var args = new List<string> { "-hide_banner" };
        if (seek > 0) args.AddRange(["-ss", F(seek)]);
        args.AddRange(["-i", input]);
        if (length > 0) args.AddRange(["-t", F(length)]);
        args.AddRange([
            "-af",
            $"silencedetect=noise={thresholdDb.ToString("F2", CultureInfo.InvariantCulture)}dB:d={minSilence.ToString("F2", CultureInfo.InvariantCulture)}",
            "-vn",
            "-f", "null",
            "-",
        ]);
        return args;
    }

    public static IReadOnlyList<string> BuildAutocutArgs(
        string input,
        string output,
        IReadOnlyList<Segment> segments,
        bool hasAudio,
        ProcessingOptions processing,
        double seek = 0,
        double length = 0,
        FadeSettings? fade = null)
    {
        var args = new List<string> { "-hide_banner" };
        if (seek > 0) args.AddRange(["-ss", F(seek)]);
        args.AddRange(["-i", input]);
        if (length > 0) args.AddRange(["-t", F(length)]);

        var total = TotalKeptDuration(segments);
        var videoOut = Fades.VideoFilter(fade, total).Length > 0 ? "[vf]" : "[vout]";
        var audioOut = hasAudio && Fades.AudioFilter(fade, total).Length > 0 ? "[afout]" : "[aout]";

        args.AddRange(["-filter_complex", BuildFilterGraph(segments, hasAudio, fade, total), "-map", videoOut]);
        if (hasAudio) args.AddRange(["-map", audioOut]);

        args.AddRange([
            "-c:v", processing.VideoCodec,
            "-preset", processing.Preset,
            "-crf", processing.Crf.ToString(CultureInfo.InvariantCulture),
            "-pix_fmt", processing.PixelFormat,
        ]);

        if (hasAudio) args.AddRange(["-c:a", processing.AudioCodec, "-b:a", processing.AudioBitrate]);
        if (processing.Threads > 0) args.AddRange(["-threads", processing.Threads.ToString(CultureInfo.InvariantCulture)]);

        args.AddRange(["-movflags", "+faststart", "-map_metadata", "-1", "-y", output]);
        return args;
    }

    /// <summary>One minute in the middle of the source, used by the preview action.</summary>
    public static (double Seek, double Length) ComputePreviewWindow(double duration, double previewDuration = 60)
    {
        var total = Math.Max(0, duration);
        var length = Math.Min(Math.Max(0.1, previewDuration), total);
        var seek = Math.Max(0, (total - length) / 2);
        return (Timecode.RoundTo(seek), Timecode.RoundTo(length));
    }

    private static string F(double value) => value.ToString("F3", CultureInfo.InvariantCulture);

    private static double ParseDouble(string value) =>
        double.Parse(value, NumberStyles.Float, CultureInfo.InvariantCulture);
}
