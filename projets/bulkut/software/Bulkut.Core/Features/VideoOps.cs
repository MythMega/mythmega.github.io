using System.Globalization;
using Bulkut.Core.Models;

namespace Bulkut.Core.Features;

/// <summary>Fastcut range maths and FFmpeg arguments.</summary>
public static class Fastcut
{
    public static double OutputLength(double start, double end) => Math.Max(0, end - start);

    /// <summary>Clamps the start so at least one second remains before the end.</summary>
    public static double ClampStart(double requested, double end, double duration)
    {
        var maxStart = Math.Max(0, Math.Min(end - 1, Math.Floor(duration) - 1));
        return Timecode.Clamp(Math.Round(requested), 0, maxStart);
    }

    /// <summary>Clamps the end so the range is at least one second long.</summary>
    public static double ClampEnd(double requested, double start, double duration)
    {
        var maxEnd = Math.Max(1, Math.Floor(duration));
        var minEnd = Math.Min(maxEnd, start + 1);
        return Timecode.Clamp(Math.Round(requested), minEnd, maxEnd);
    }

    public static IReadOnlyList<string> BuildArgs(
        string input,
        string output,
        double start,
        double duration,
        ProcessingOptions processing,
        bool hasAudio = true,
        FadeSettings? fade = null)
    {
        var videoFilter = Fades.VideoFilter(fade, duration);
        var audioFilter = Fades.AudioFilter(fade, duration);

        var args = new List<string>
        {
            "-hide_banner",
            "-ss", start.ToString("F3", CultureInfo.InvariantCulture),
            "-i", input,
            "-t", duration.ToString("F3", CultureInfo.InvariantCulture),
            "-map", "0:v:0",
            "-map", "0:a:0?",
        };

        if (videoFilter.Length > 0) args.AddRange(["-vf", videoFilter]);
        if (hasAudio && audioFilter.Length > 0) args.AddRange(["-af", audioFilter]);

        args.AddRange([
            "-c:v", processing.VideoCodec,
            "-preset", processing.Preset,
            "-crf", processing.Crf.ToString(CultureInfo.InvariantCulture),
            "-pix_fmt", processing.PixelFormat,
            "-c:a", processing.AudioCodec,
            "-b:a", processing.AudioBitrate,
            "-avoid_negative_ts", "make_zero",
        ]);
        if (processing.Threads > 0) args.AddRange(["-threads", processing.Threads.ToString(CultureInfo.InvariantCulture)]);
        args.AddRange(["-movflags", "+faststart", "-map_metadata", "-1", "-y", output]);
        return args;
    }
}

/// <summary>Reverse arguments (video and audio played backwards).</summary>
public static class Reverse
{
    public static IReadOnlyList<string> BuildArgs(
        string input,
        string output,
        bool hasAudio,
        ProcessingOptions processing,
        double duration = 0,
        FadeSettings? fade = null)
    {
        var videoFilter = "reverse";
        var fadeVideo = Fades.VideoFilter(fade, duration);
        if (fadeVideo.Length > 0) videoFilter += "," + fadeVideo;

        var args = new List<string> { "-hide_banner", "-i", input, "-vf", videoFilter };
        if (hasAudio)
        {
            var audioFilter = "areverse";
            var fadeAudio = Fades.AudioFilter(fade, duration);
            if (fadeAudio.Length > 0) audioFilter += "," + fadeAudio;
            args.AddRange(["-af", audioFilter]);
        }

        args.AddRange([
            "-map", "0:v:0",
            "-map", "0:a:0?",
            "-c:v", processing.VideoCodec,
            "-preset", processing.Preset,
            "-crf", processing.Crf.ToString(CultureInfo.InvariantCulture),
            "-pix_fmt", processing.PixelFormat,
            "-c:a", processing.AudioCodec,
            "-b:a", processing.AudioBitrate,
        ]);
        if (processing.Threads > 0) args.AddRange(["-threads", processing.Threads.ToString(CultureInfo.InvariantCulture)]);
        args.AddRange(["-movflags", "+faststart", "-map_metadata", "-1", "-y", output]);
        return args;
    }
}
