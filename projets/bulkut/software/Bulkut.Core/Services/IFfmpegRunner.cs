using Bulkut.Core.Models;

namespace Bulkut.Core.Services;

/// <summary>
/// Runs FFmpeg commands. The desktop shells out to a native binary; Android links
/// FFmpegKit instead, because the platform forbids starting an executable from an
/// application sandbox. Everything above this interface is platform agnostic:
/// probes, silence analysis and the rendering pipeline only ever see arguments,
/// log lines and progress.
/// </summary>
public interface IFfmpegRunner
{
    bool IsAvailable { get; }

    /// <summary>Where FFmpeg comes from, shown in the engine status card.</summary>
    string Location { get; }

    Task PrepareAsync(IProgress<EngineStatus>? progress, CancellationToken cancellationToken);

    /// <summary>
    /// Runs one command. Implementations report progress on their own (process
    /// pipes on desktop, FFmpegKit statistics on Android) and return every log
    /// line, which the silence analysis parses.
    /// </summary>
    Task<FfmpegResult> ExecuteAsync(
        IReadOnlyList<string> args,
        double outputDuration,
        IProgress<RenderProgress>? progress,
        CancellationToken cancellationToken);
}
