using System.Globalization;
using Bulkut.Core.Models;

namespace Bulkut.Core.Features;

public sealed record ConcatClip(bool HasAudio, double Duration, int Width, int Height);

public sealed record ConcatPlan(IReadOnlyList<string> Args, double Duration);

/// <summary>
/// Joining videos that can differ in resolution, frame rate and audio layout.
/// Every input is normalised (letterboxed scale, constant frame rate, stereo
/// 48 kHz) before the concat filter.
/// </summary>
public static class Concat
{
    private const int FallbackWidth = 1280;
    private const int FallbackHeight = 720;

    public static (int Width, int Height) TargetSize(IEnumerable<ConcatClip> clips)
    {
        ConcatClip? best = null;
        foreach (var clip in clips)
        {
            if (clip.Width < 16 || clip.Height < 16) continue;
            if (best is null || clip.Width * clip.Height > best.Width * best.Height) best = clip;
        }

        var width = best?.Width ?? FallbackWidth;
        var height = best?.Height ?? FallbackHeight;
        return (Even(width), Even(height));
    }

    public static double TotalDuration(IEnumerable<ConcatClip> clips) =>
        Timecode.RoundTo(clips.Sum(clip => Math.Max(0, clip.Duration)));

    public static string BuildFilterGraph(
        IReadOnlyList<ConcatClip> clips,
        int width,
        int height,
        int fps = 30,
        string pixelFormat = "yuv420p",
        FadeSettings? fade = null,
        double? totalDuration = null)
    {
        var hasAudio = clips.Any(clip => clip.HasAudio);
        var chains = new List<string>();
        var concatInputs = new List<string>();
        var rate = Math.Clamp(fps, 1, 120);

        for (var index = 0; index < clips.Count; index++)
        {
            var clip = clips[index];
            chains.Add(
                $"[{index}:v]scale={width}:{height}:force_original_aspect_ratio=decrease," +
                $"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black," +
                $"setsar=1,fps={rate},format={pixelFormat}[v{index}]");

            if (!hasAudio)
            {
                concatInputs.Add($"[v{index}]");
                continue;
            }

            var duration = Math.Max(0.01, clip.Duration).ToString("F3", CultureInfo.InvariantCulture);
            if (clip.HasAudio)
            {
                chains.Add(
                    $"[{index}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo," +
                    $"apad,atrim=0:{duration},asetpts=PTS-STARTPTS[a{index}]");
            }
            else
            {
                chains.Add(
                    $"anullsrc=channel_layout=stereo:sample_rate=48000:d={duration},asetpts=PTS-STARTPTS[a{index}]");
            }
            concatInputs.Add($"[v{index}][a{index}]");
        }

        chains.Add(
            $"{string.Concat(concatInputs)}concat=n={clips.Count}:v=1:a={(hasAudio ? 1 : 0)}[vout]{(hasAudio ? "[aout]" : "")}");

        // Fades apply once, on the joined result, never on the individual clips.
        var total = totalDuration ?? TotalDuration(clips);
        var videoFade = Fades.VideoFilter(fade, total);
        if (videoFade.Length > 0) chains.Add($"[vout]{videoFade}[vf]");
        if (hasAudio)
        {
            var audioFade = Fades.AudioFilter(fade, total);
            if (audioFade.Length > 0) chains.Add($"[aout]{audioFade}[afout]");
        }

        return string.Join(";", chains);
    }

    public static ConcatPlan BuildArgs(
        IReadOnlyList<string> inputs,
        IReadOnlyList<ConcatClip> clips,
        string output,
        ProcessingOptions processing,
        int? fps = null,
        FadeSettings? fade = null)
    {
        var hasAudio = clips.Any(clip => clip.HasAudio);
        var (width, height) = TargetSize(clips);
        var rate = Math.Clamp(fps ?? processing.ConcatFps, 1, 120);
        var total = TotalDuration(clips);
        var videoOut = Fades.VideoFilter(fade, total).Length > 0 ? "[vf]" : "[vout]";
        var audioOut = hasAudio && Fades.AudioFilter(fade, total).Length > 0 ? "[afout]" : "[aout]";

        var args = new List<string> { "-hide_banner" };
        foreach (var input in inputs) args.AddRange(["-i", input]);

        args.AddRange([
            "-filter_complex",
            BuildFilterGraph(clips, width, height, rate, processing.PixelFormat, fade, total),
            "-map", videoOut,
        ]);
        if (hasAudio) args.AddRange(["-map", audioOut]);

        args.AddRange([
            "-c:v", processing.VideoCodec,
            "-preset", processing.Preset,
            "-crf", processing.Crf.ToString(CultureInfo.InvariantCulture),
            "-pix_fmt", processing.PixelFormat,
            "-r", rate.ToString(CultureInfo.InvariantCulture),
        ]);
        if (hasAudio) args.AddRange(["-c:a", processing.AudioCodec, "-b:a", processing.AudioBitrate]);
        if (processing.Threads > 0) args.AddRange(["-threads", processing.Threads.ToString(CultureInfo.InvariantCulture)]);

        args.AddRange(["-movflags", "+faststart", "-map_metadata", "-1", "-y", output]);
        return new ConcatPlan(args, total);
    }

    private static int Even(int value)
    {
        var rounded = Math.Max(2, (int)Math.Round((double)Math.Max(2, value)));
        return Math.Max(2, (int)Math.Round(rounded / 2.0) * 2);
    }
}
