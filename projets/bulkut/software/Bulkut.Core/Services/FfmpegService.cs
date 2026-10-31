using Bulkut.Core.Models;

namespace Bulkut.Core.Services;

public enum EngineState
{
    Checking,
    Downloading,
    Ready,
    Failed,
}

public sealed record EngineStatus(EngineState State, string Message = "", double Ratio = 0);

/// <summary>
/// The single entry point the pipeline talks to. It keeps the "one command at a
/// time" promise with a global gate, whatever the runner underneath, and turns
/// a probe into a <see cref="MediaInfo"/>.
/// </summary>
public sealed class FfmpegService
{
    private readonly SemaphoreSlim _gate = new(1, 1);

    public FfmpegService(DesktopOptions desktop, string? baseDirectory = null)
        : this(new ProcessFfmpegRunner(desktop, baseDirectory))
    {
    }

    public FfmpegService(IFfmpegRunner runner)
    {
        Runner = runner;
    }

    public IFfmpegRunner Runner { get; }

    public bool IsAvailable => Runner.IsAvailable;

    public string? ExecutablePath => Runner.IsAvailable ? Runner.Location : null;

    /// <summary>Shown by the engine card: the install folder or the bundled library.</summary>
    public string InstallDirectory => Runner.Location;

    public Task EnsureAvailableAsync(IProgress<EngineStatus>? progress = null, CancellationToken cancellationToken = default) =>
        Runner.PrepareAsync(progress, cancellationToken);

    public async Task<MediaInfo> ProbeAsync(string path, CancellationToken cancellationToken = default)
    {
        var result = await RunAsync(
            ["-hide_banner", "-i", path],
            0,
            null,
            cancellationToken,
            allowFailure: true).ConfigureAwait(false);

        var info = MediaProbeParser.Parse(result.Logs);
        if (!info.HasVideo && !info.HasAudio)
            throw new AppException(AppErrorCodes.NotVideo, Path.GetFileName(path));
        return info;
    }

    public async Task<FfmpegResult> RunAsync(
        IReadOnlyList<string> args,
        double outputDuration,
        IProgress<RenderProgress>? progress,
        CancellationToken cancellationToken,
        bool allowFailure = false)
    {
        if (!IsAvailable)
            throw new AppException(AppErrorCodes.FfmpegUnavailable);

        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var result = await Runner.ExecuteAsync(args, outputDuration, progress, cancellationToken)
                .ConfigureAwait(false);

            progress?.Report(new RenderProgress(1, 0, 0, outputDuration));
            if (result.ExitCode == 0 || allowFailure) return result;

            var tail = string.Join(Environment.NewLine, result.Logs.TakeLast(12));
            throw new AppException(AppErrorCodes.RenderFailed, tail);
        }
        finally
        {
            _gate.Release();
        }
    }
}
