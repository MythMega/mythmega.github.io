using System.Globalization;
using System.Text.RegularExpressions;
using Bulkut.Core.Models;

namespace Bulkut.Core.Features;

/// <summary>A container FFmpeg could write, with its preferred codecs.</summary>
public sealed record ConvertFormat(
    string Id,
    string Extension,
    string Muxer,
    IReadOnlyList<string> Video,
    IReadOnlyList<string> Audio,
    bool FastStart);

/// <summary>A format the running FFmpeg build can actually produce.</summary>
public sealed record ConvertTarget(
    string Id,
    string Extension,
    string Muxer,
    string VideoCodec,
    string? AudioCodec,
    bool FastStart);

/// <summary>
/// Conversion formats, capability parsing and FFmpeg arguments. Pure functions:
/// the view and the render engine only feed in probe logs and settings.
/// </summary>
public static partial class ConvertOps
{
    [GeneratedRegex(@"^\s*[D ]E\s+([A-Za-z0-9_]+)")]
    private static partial Regex MuxerLine();

    [GeneratedRegex(@"^\s*([VAS])[A-Z.]{5}\s+([A-Za-z0-9_-]+)")]
    private static partial Regex EncoderLine();

    public static IReadOnlyList<ConvertFormat> Formats { get; } =
    [
        new("mp4", "mp4", "mp4", ["libx264"], ["aac"], true),
        new("mov", "mov", "mov", ["libx264"], ["aac"], true),
        new("mkv", "mkv", "matroska", ["libx264"], ["aac", "libopus", "libvorbis", "libmp3lame"], false),
        new("avi", "avi", "avi", ["mpeg4", "libx264"], ["libmp3lame", "libvorbis", "aac"], false),
        new("webm", "webm", "webm", ["libvpx-vp9", "libvpx"], ["libopus", "libvorbis"], false),
    ];

    /// <summary>Every format with its preferred codecs, before capability detection.</summary>
    public static IReadOnlyList<ConvertTarget> DefaultTargets() =>
        Formats.Select(format => new ConvertTarget(
            format.Id,
            format.Extension,
            format.Muxer,
            format.Video[0],
            format.Audio[0],
            format.FastStart)).ToList();

    /// <summary>Muxers listed by <c>ffmpeg -muxers</c>.</summary>
    public static IReadOnlyList<string> ParseMuxers(IEnumerable<string> logs) =>
        logs.Select(line => MuxerLine().Match(line))
            .Where(match => match.Success)
            .Select(match => match.Groups[1].Value.ToLowerInvariant())
            .Distinct()
            .ToList();

    /// <summary>Video and audio encoders listed by <c>ffmpeg -encoders</c>.</summary>
    public static (IReadOnlyList<string> Video, IReadOnlyList<string> Audio) ParseEncoders(IEnumerable<string> logs)
    {
        var video = new List<string>();
        var audio = new List<string>();

        foreach (var line in logs)
        {
            var match = EncoderLine().Match(line);
            if (!match.Success) continue;

            var name = match.Groups[2].Value.ToLowerInvariant();
            if (match.Groups[1].Value == "V" && !video.Contains(name)) video.Add(name);
            else if (match.Groups[1].Value == "A" && !audio.Contains(name)) audio.Add(name);
        }

        return (video, audio);
    }

    /// <summary>
    /// Keeps only the formats whose container and video codec are available.
    /// A format with no usable audio encoder is still offered, without audio.
    /// </summary>
    public static IReadOnlyList<ConvertTarget> Supported(
        IReadOnlyCollection<string> muxers,
        IReadOnlyCollection<string> videoEncoders,
        IReadOnlyCollection<string> audioEncoders)
    {
        var muxerSet = new HashSet<string>(muxers, StringComparer.OrdinalIgnoreCase);
        var videoSet = new HashSet<string>(videoEncoders, StringComparer.OrdinalIgnoreCase);
        var audioSet = new HashSet<string>(audioEncoders, StringComparer.OrdinalIgnoreCase);

        var targets = new List<ConvertTarget>();
        foreach (var format in Formats)
        {
            if (!muxerSet.Contains(format.Muxer)) continue;

            var videoCodec = format.Video.FirstOrDefault(videoSet.Contains);
            if (videoCodec is null) continue;

            var audioCodec = format.Audio.FirstOrDefault(audioSet.Contains);
            targets.Add(new ConvertTarget(format.Id, format.Extension, format.Muxer, videoCodec, audioCodec, format.FastStart));
        }

        return targets;
    }

    /// <summary>Falls back to the first available format when the saved one is gone.</summary>
    public static string NormalizeFormat(string? id, IReadOnlyList<ConvertTarget>? available = null)
    {
        var targets = available ?? DefaultTargets();
        var match = targets.FirstOrDefault(target => string.Equals(target.Id, id, StringComparison.OrdinalIgnoreCase));
        return match?.Id ?? targets.FirstOrDefault()?.Id ?? "mp4";
    }

    /// <summary><c>auto</c>, or a bitrate in kbps clamped to a sane range.</summary>
    public static string NormalizeBitrate(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Equals("auto", StringComparison.OrdinalIgnoreCase))
            return "auto";

        if (!int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var number) || number <= 0)
            return "auto";

        return Math.Clamp(number, 100, 100000).ToString(CultureInfo.InvariantCulture);
    }

    /// <summary>
    /// Conversion arguments. "auto" bitrates are omitted so FFmpeg applies its
    /// own default for the chosen codec.
    /// </summary>
    public static IReadOnlyList<string> BuildArgs(
        string input,
        string output,
        ConvertTarget target,
        string? videoBitrate,
        string? audioBitrate,
        ProcessingOptions processing)
    {
        var args = new List<string>
        {
            "-hide_banner",
            "-i", input,
            "-map", "0:v:0",
            "-map", "0:a:0?",
            "-c:v", target.VideoCodec,
            "-pix_fmt", "yuv420p",
        };

        if (target.VideoCodec == "libx264")
        {
            args.AddRange(["-preset", processing.Preset]);
        }
        else if (target.VideoCodec is "libvpx" or "libvpx-vp9")
        {
            args.AddRange(["-deadline", "good", "-cpu-used", "2"]);
        }

        var video = NormalizeBitrate(videoBitrate);
        if (video != "auto") args.AddRange(["-b:v", $"{video}k"]);

        if (target.AudioCodec is not null)
        {
            args.AddRange(["-c:a", target.AudioCodec]);
            var audio = NormalizeBitrate(audioBitrate);
            if (audio != "auto") args.AddRange(["-b:a", $"{audio}k"]);
        }
        else
        {
            args.Add("-an");
        }

        if (target.FastStart) args.AddRange(["-movflags", "+faststart"]);
        if (processing.Threads > 0)
            args.AddRange(["-threads", processing.Threads.ToString(CultureInfo.InvariantCulture)]);

        args.AddRange(["-map_metadata", "-1", "-y", output]);
        return args;
    }
}
