namespace Bulkut.Core.Models;

public sealed record Segment(double Start, double End)
{
    public double Duration => Math.Max(0, End - Start);
}

public sealed class MediaInfo
{
    public double Duration { get; set; }
    public bool HasVideo { get; set; }
    public bool HasAudio { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    public double Fps { get; set; }
    public string VideoCodec { get; set; } = "";
    public string AudioCodec { get; set; } = "";
}

public enum JobPhase
{
    Queued,
    Preparing,
    Analyzing,
    Rendering,
    Done,
    Error,
    Idle,
}

public sealed record RenderProgress(double Ratio, double EtaSeconds, double Speed, double MediaSeconds)
{
    public RenderProgress Clamp() => new(Math.Clamp(Ratio, 0, 1), Math.Max(0, EtaSeconds), Math.Max(0, Speed), Math.Max(0, MediaSeconds));
}

public sealed record FfmpegResult(int ExitCode, IReadOnlyList<string> Logs, MediaInfo? Probe);

public sealed record RenderResult(string OutputPath, string FileName, double Duration, IReadOnlyList<Segment>? Segments = null);

public sealed record AutocutEstimate(double OutputDuration, int Clips, double SourceDuration);

public sealed class AppException(string code, string? detail = null) : Exception(detail ?? code)
{
    /// <summary>Translation key suffix, e.g. <c>noAudio</c> becomes <c>errors.noAudio</c>.</summary>
    public string Code { get; } = code;

    public string? Detail { get; } = detail;
}

public static class AppErrorCodes
{
    public const string NumberRange = "numberRange";
    public const string NotVideo = "notVideo";
    public const string FileTooLarge = "fileTooLarge";
    public const string Busy = "busy";
    public const string StartBeforeEnd = "startBeforeEnd";
    public const string EndAfterStart = "endAfterStart";
    public const string Timecode = "timecode";
    public const string Duration = "duration";
    public const string NoAudio = "noAudio";
    public const string NoSegments = "noSegments";
    public const string TooManySegments = "tooManySegments";
    public const string NoVideoStream = "noVideoStream";
    public const string RenderFailed = "renderFailed";
    public const string FfmpegUnavailable = "ffmpegUnavailable";
    public const string Cancelled = "cancelled";
    public const string NoClips = "noClips";
    public const string PresetNameEmpty = "presetNameEmpty";
    public const string PresetNameTaken = "presetNameTaken";
    public const string Unknown = "unknown";
}
