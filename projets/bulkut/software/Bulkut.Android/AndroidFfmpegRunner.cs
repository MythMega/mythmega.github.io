using Bulkut.Core.Features;
using Bulkut.Core.Models;
using Bulkut.Core.Services;
using Ffmpegkit.Droid;

namespace BulkutMobile;

/// <summary>
/// FFmpeg on Android. The platform forbids starting an executable from an app
/// sandbox, so the native FFmpegKit library is linked instead and every command
/// runs in process. Its output becomes plain log lines, which is exactly what
/// the probe and the silence analysis already consume on desktop.
/// </summary>
public sealed class AndroidFfmpegRunner : IFfmpegRunner
{
    private static readonly object CaptureLock = new();

    /// <summary>Lines of the command currently running; one command at a time.</summary>
    private static List<string>? _capture;

    static AndroidFfmpegRunner()
    {
        try
        {
            // The callback is the live stream, the session keeps the transcript.
            // Both are cheap to keep in sync, and the transcript is not always
            // flushed when the session completes.
            FFmpegKitConfig.EnableLogCallback(entry =>
            {
                var text = entry.Message;
                if (string.IsNullOrEmpty(text)) return;
                lock (CaptureLock) _capture?.AddRange(SplitLines(text!));
            });
        }
        catch (Java.Lang.Exception)
        {
            // Without the callback the session transcript is still available.
        }
    }

    public bool IsAvailable => true;

    public string Location => "FFmpegKit · FFmpeg 8 (intégré à l'application)";

    /// <summary>The library banner, once it has been loaded.</summary>
    public static string? Version { get; private set; }

    /// <summary>
    /// Loads the native library once at startup by asking for its banner, so a
    /// device that cannot run FFmpeg shows an engine error instead of failing
    /// on the first render.
    /// </summary>
    public async Task PrepareAsync(IProgress<EngineStatus>? progress, CancellationToken cancellationToken)
    {
        progress?.Report(new EngineStatus(EngineState.Checking, "checking", 0));

        // Keep only the last few sessions: each one holds its whole transcript.
        FFmpegKitConfig.SessionHistorySize = 6;

        var result = await ExecuteAsync(["-hide_banner", "-version"], 0, null, cancellationToken)
            .ConfigureAwait(false);

        var banner = result.Logs.FirstOrDefault(line =>
            line.Contains("ffmpeg version", StringComparison.OrdinalIgnoreCase));
        if (result.ExitCode != 0 || banner is null)
            throw new AppException(AppErrorCodes.FfmpegUnavailable, result.Logs.LastOrDefault() ?? "FFmpegKit");

        Version = banner;
        progress?.Report(new EngineStatus(EngineState.Ready, "ready", 1));
    }

    /// <summary>
    /// FFmpegKit does expensive work on the calling thread — loading the native
    /// library, building the session — so a command is never started from the UI
    /// thread. On a cold start that load takes seconds even on a fast device.
    /// </summary>
    public Task<FfmpegResult> ExecuteAsync(
        IReadOnlyList<string> args,
        double outputDuration,
        IProgress<RenderProgress>? progress,
        CancellationToken cancellationToken) =>
        Task.Run(() => ExecuteCoreAsync(args, outputDuration, progress, cancellationToken), cancellationToken);

    private async Task<FfmpegResult> ExecuteCoreAsync(
        IReadOnlyList<string> args,
        double outputDuration,
        IProgress<RenderProgress>? progress,
        CancellationToken cancellationToken)
    {
        var command = FfmpegCommandLine.Build(args);
        var reporter = new Progress<FFmpegProgress>(sample => progress?.Report(Translate(sample, outputDuration)));

        // The duration is what lets FFmpegKit report a percentage and an ETA.
        TimeSpan? known = outputDuration > 0 ? TimeSpan.FromSeconds(outputDuration) : null;

        var captured = new List<string>();
        lock (CaptureLock) _capture = captured;

        FFmpegSession session;
        try
        {
            session = await FFmpegKit.ExecuteAsync(command, reporter, known, cancellationToken)
                .ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            lock (CaptureLock) _capture = null;
            throw new AppException(AppErrorCodes.Cancelled);
        }

        lock (CaptureLock) _capture = null;
        if (cancellationToken.IsCancellationRequested) throw new AppException(AppErrorCodes.Cancelled);

        var logs = ReadTranscript(session, captured);
        if (session.Succeeded()) return new FfmpegResult(0, logs, null);

        var detail = session.FailStackTrace;
        if (!string.IsNullOrWhiteSpace(detail)) logs.Add(detail!);

        var exitCode = session.ReturnCode?.Value ?? 1;
        return new FfmpegResult(exitCode == 0 ? 1 : exitCode, logs, null);
    }

    private static RenderProgress Translate(FFmpegProgress sample, double outputDuration)
    {
        var ratio = sample.Percent is { } percent ? percent / 100 : 0;
        if (ratio <= 0 && outputDuration > 0 && sample.Position.TotalSeconds > 0)
            ratio = sample.Position.TotalSeconds / outputDuration;

        return new RenderProgress(
            Math.Clamp(ratio, 0, 1),
            Math.Max(0, sample.EstimatedTimeRemaining?.TotalSeconds ?? 0),
            sample.Speed,
            sample.Position.TotalSeconds);
    }

    /// <summary>
    /// The complete FFmpeg transcript, one line per entry. The session output is
    /// preferred because individual log entries arrive in chunks; the buffered
    /// and live copies are only fallbacks.
    /// </summary>
    private static List<string> ReadTranscript(AbstractSession session, List<string> captured)
    {
        try
        {
            var raw = session.Output;
            if (!string.IsNullOrEmpty(raw)) return SplitLines(raw!).ToList();
        }
        catch (Java.Lang.Exception)
        {
        }

        try
        {
            var buffered = session.GetAllLogs(500)?
                .SelectMany(entry => SplitLines(entry.Message ?? string.Empty))
                .ToList();
            if (buffered is { Count: > 0 }) return buffered;
        }
        catch (Java.Lang.Exception)
        {
        }

        return captured;
    }

    private static IEnumerable<string> SplitLines(string text) =>
        text.Split('\n').Select(line => line.TrimEnd('\r'));
}
