using Bulkut.Core.Features;
using Bulkut.Core.Models;

namespace Bulkut.Core.Services;

public sealed record JobProgress(JobPhase Phase, double Ratio, double EtaSeconds = 0);

/// <summary>
/// Feature-agnostic rendering pipelines. Every method is fully asynchronous,
/// reports a phase + ratio + ETA, and honours cancellation by killing FFmpeg.
/// </summary>
public sealed class RenderEngine(SettingsStore settings, FfmpegService ffmpeg, OutputService output)
{
    public SettingsStore Settings => settings;
    public ProcessingOptions Processing => settings.Processing;

    public Task<MediaInfo> ProbeAsync(string path, CancellationToken cancellationToken) =>
        ffmpeg.ProbeAsync(path, cancellationToken);

    public async Task<AutocutEstimate> EstimateAutocutAsync(
        string path,
        MediaInfo? known,
        AutocutParameters parameters,
        IProgress<JobProgress>? progress,
        CancellationToken cancellationToken)
    {
        progress?.Report(new JobProgress(JobPhase.Preparing, 0.01));
        var info = await ResolveInfoAsync(path, known, cancellationToken).ConfigureAwait(false);
        var duration = ResolveDuration(info);
        var window = ComputeWindow(duration, preview: false);

        progress?.Report(new JobProgress(JobPhase.Analyzing, 0.02));
        var segments = await AnalyseAsync(path, info, parameters, window, progress, cancellationToken)
            .ConfigureAwait(false);

        progress?.Report(new JobProgress(JobPhase.Done, 1));
        return new AutocutEstimate(Silence.TotalKeptDuration(segments), segments.Count, duration);
    }

    public async Task<RenderResult> RenderAutocutAsync(
        string path,
        MediaInfo? known,
        AutocutParameters parameters,
        string? suffix,
        bool preview,
        IProgress<JobProgress>? progress,
        CancellationToken cancellationToken)
    {
        progress?.Report(new JobProgress(JobPhase.Preparing, 0.01));
        var info = await ResolveInfoAsync(path, known, cancellationToken).ConfigureAwait(false);
        var duration = ResolveDuration(info);
        var window = ComputeWindow(duration, preview);

        var segments = await AnalyseAsync(path, info, parameters, window, progress, cancellationToken)
            .ConfigureAwait(false);

        if (segments.Count == 0) throw new AppException(AppErrorCodes.NoSegments);
        if (segments.Count > Processing.MaxSegments)
            throw new AppException(AppErrorCodes.TooManySegments, Processing.MaxSegments.ToString());

        var keptDuration = Silence.TotalKeptDuration(segments);

        // A timeline is just an edit list: nothing is encoded, so the analysis
        // above is the whole job. Previews always stay playable MP4 files.
        if (!preview && AutocutOutput.IsTimeline(parameters.Output))
        {
            var source = new TimelineSource(
                Path.GetFileName(path),
                path,
                duration,
                info.Width,
                info.Height,
                info.Fps > 0 ? info.Fps : Processing.ConcatFps,
                info.HasAudio);
            var timeline = TimelineExport.Build(parameters.Output, source, segments);

            progress?.Report(new JobProgress(JobPhase.Rendering, 0.96));
            var saved = output.SaveText(
                timeline,
                Path.GetFileName(path),
                suffix,
                AutocutOutput.Extension(parameters.Output),
                keptDuration,
                segments);
            progress?.Report(new JobProgress(JobPhase.Done, 1));
            return saved;
        }

        var temp = TempOutput();
        try
        {
            var args = Silence.BuildAutocutArgs(
                path,
                temp,
                segments,
                info.HasAudio,
                Processing,
                window.Seek,
                window.Length,
                parameters.Fade);

            progress?.Report(new JobProgress(JobPhase.Rendering, 0.07));
            await ffmpeg.RunAsync(
                    args,
                    keptDuration,
                    Wrap(progress, JobPhase.Rendering, 0.07, 0.93),
                    cancellationToken)
                .ConfigureAwait(false);

            progress?.Report(new JobProgress(JobPhase.Rendering, 0.96));
            var result = output.Save(temp, Path.GetFileName(path), preview ? "-preview" : suffix, keptDuration, segments);
            progress?.Report(new JobProgress(JobPhase.Done, 1));
            return result;
        }
        finally
        {
            SafeDelete(temp);
        }
    }

    public async Task<RenderResult> RenderFastcutAsync(
        string path,
        MediaInfo? known,
        double start,
        double end,
        string? suffix,
        FadeSettings? fade,
        IProgress<JobProgress>? progress,
        CancellationToken cancellationToken)
    {
        progress?.Report(new JobProgress(JobPhase.Preparing, 0.01));
        var info = known ?? await ffmpeg.ProbeAsync(path, cancellationToken).ConfigureAwait(false);
        if (!info.HasVideo) throw new AppException(AppErrorCodes.NoVideoStream);

        var duration = Math.Max(0.1, end - start);
        var temp = TempOutput();
        try
        {
            progress?.Report(new JobProgress(JobPhase.Rendering, 0.04));
            await ffmpeg.RunAsync(
                    Fastcut.BuildArgs(path, temp, start, duration, Processing, info.HasAudio, fade),
                    duration,
                    Wrap(progress, JobPhase.Rendering, 0.04, 0.94),
                    cancellationToken)
                .ConfigureAwait(false);

            progress?.Report(new JobProgress(JobPhase.Rendering, 0.96));
            var result = output.Save(temp, Path.GetFileName(path), suffix, duration);
            progress?.Report(new JobProgress(JobPhase.Done, 1));
            return result;
        }
        finally
        {
            SafeDelete(temp);
        }
    }

    public async Task<RenderResult> RenderReverseAsync(
        string path,
        MediaInfo? known,
        string? suffix,
        FadeSettings? fade,
        IProgress<JobProgress>? progress,
        CancellationToken cancellationToken)
    {
        progress?.Report(new JobProgress(JobPhase.Preparing, 0.01));
        var info = known ?? await ffmpeg.ProbeAsync(path, cancellationToken).ConfigureAwait(false);
        if (!info.HasVideo) throw new AppException(AppErrorCodes.NoVideoStream);
        if (info.Duration <= 0) throw new AppException(AppErrorCodes.Duration);

        var temp = TempOutput();
        try
        {
            progress?.Report(new JobProgress(JobPhase.Rendering, 0.06));
            await ffmpeg.RunAsync(
                    Reverse.BuildArgs(path, temp, info.HasAudio, Processing, info.Duration, fade),
                    info.Duration,
                    Wrap(progress, JobPhase.Rendering, 0.06, 0.94),
                    cancellationToken)
                .ConfigureAwait(false);

            progress?.Report(new JobProgress(JobPhase.Rendering, 0.96));
            var result = output.Save(temp, Path.GetFileName(path), suffix, info.Duration);
            progress?.Report(new JobProgress(JobPhase.Done, 1));
            return result;
        }
        finally
        {
            SafeDelete(temp);
        }
    }

    public async Task<RenderResult> RenderConcatAsync(
        IReadOnlyList<string> paths,
        IReadOnlyList<double>? knownDurations,
        string? suffix,
        FadeSettings? fade,
        IProgress<JobProgress>? progress,
        CancellationToken cancellationToken)
    {
        if (paths.Count == 0) throw new AppException(AppErrorCodes.NoClips);

        progress?.Report(new JobProgress(JobPhase.Preparing, 0.01));
        var clips = new List<ConcatClip>(paths.Count);
        for (var index = 0; index < paths.Count; index++)
        {
            var info = await ffmpeg.ProbeAsync(paths[index], cancellationToken).ConfigureAwait(false);
            if (!info.HasVideo) throw new AppException(AppErrorCodes.NoVideoStream, Path.GetFileName(paths[index]));
            var duration = info.Duration > 0
                ? info.Duration
                : knownDurations is not null && index < knownDurations.Count ? knownDurations[index] : 0;
            if (duration <= 0) throw new AppException(AppErrorCodes.Duration, Path.GetFileName(paths[index]));
            clips.Add(new ConcatClip(info.HasAudio, duration, info.Width, info.Height));
            progress?.Report(new JobProgress(JobPhase.Preparing, 0.01 + 0.04 * (index + 1) / paths.Count));
        }

        return await RenderConcatCoreAsync(paths, clips, Path.GetFileName(paths[0]), suffix, fade, progress, cancellationToken)
            .ConfigureAwait(false);
    }

    public async Task<RenderResult> RenderIntroOutroAsync(
        IntroOutroPlan plan,
        string itemName,
        string? suffix,
        FadeSettings? fade,
        IProgress<JobProgress>? progress,
        CancellationToken cancellationToken)
    {
        progress?.Report(new JobProgress(JobPhase.Preparing, 0.01));
        var clips = new List<ConcatClip>(plan.Inputs.Count);
        for (var index = 0; index < plan.Inputs.Count; index++)
        {
            var info = await ffmpeg.ProbeAsync(plan.Inputs[index], cancellationToken).ConfigureAwait(false);
            if (!info.HasVideo) throw new AppException(AppErrorCodes.NoVideoStream, Path.GetFileName(plan.Inputs[index]));
            var duration = info.Duration > 0 ? info.Duration : plan.Durations[index];
            if (duration <= 0) throw new AppException(AppErrorCodes.Duration, Path.GetFileName(plan.Inputs[index]));
            clips.Add(new ConcatClip(info.HasAudio, duration, info.Width, info.Height));
            progress?.Report(new JobProgress(JobPhase.Preparing, 0.01 + 0.04 * (index + 1) / plan.Inputs.Count));
        }

        return await RenderConcatCoreAsync(plan.Inputs, clips, itemName, suffix, fade, progress, cancellationToken)
            .ConfigureAwait(false);
    }

    /// <summary>
    /// Exports every range as its own final file. Fades are applied to each
    /// segment because each one is a finished file, and the files are produced
    /// one after another so a single FFmpeg process runs at a time.
    /// </summary>
    public async Task<IReadOnlyList<RenderResult>> RenderSplitAsync(
        string path,
        MediaInfo? known,
        IReadOnlyList<SplitRange> ranges,
        string? suffix,
        FadeSettings? fade,
        IProgress<JobProgress>? progress,
        CancellationToken cancellationToken)
    {
        if (ranges.Count == 0) throw new AppException(AppErrorCodes.NoSegments);

        progress?.Report(new JobProgress(JobPhase.Preparing, 0.01));
        var info = known ?? await ffmpeg.ProbeAsync(path, cancellationToken).ConfigureAwait(false);
        if (!info.HasVideo) throw new AppException(AppErrorCodes.NoVideoStream);
        if (info.Duration <= 0) throw new AppException(AppErrorCodes.Duration);

        var segments = Splitter.Normalize(ranges, info.Duration);
        if (segments.Count == 0) throw new AppException(AppErrorCodes.NoSegments);
        if (segments.Count > Processing.MaxSegments)
            throw new AppException(AppErrorCodes.TooManySegments, Processing.MaxSegments.ToString());

        var results = new List<RenderResult>(segments.Count);
        progress?.Report(new JobProgress(JobPhase.Preparing, 0.04));
        for (var index = 0; index < segments.Count; index++)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var segment = segments[index];
            var duration = Math.Max(0.1, segment.Duration);
            var temp = TempOutput();
            try
            {
                var args = Splitter.BuildArgs(
                    path,
                    temp,
                    segment.Start,
                    segment.End,
                    info.HasAudio,
                    Processing,
                    fade);

                var from = 0.04 + 0.94 * index / segments.Count;
                var to = 0.04 + 0.94 * (index + 1) / segments.Count;
                await ffmpeg.RunAsync(
                        args,
                        duration,
                        Wrap(progress, JobPhase.Rendering, from, to),
                        cancellationToken)
                    .ConfigureAwait(false);

                var result = output.Save(
                    temp,
                    Path.GetFileName(path),
                    Splitter.SegmentSuffix(suffix, index + 1),
                    duration);
                results.Add(result);
                progress?.Report(new JobProgress(JobPhase.Rendering, to));
            }
            finally
            {
                SafeDelete(temp);
            }
        }

        progress?.Report(new JobProgress(JobPhase.Done, 1));
        return results;
    }

    private async Task<RenderResult> RenderConcatCoreAsync(
        IReadOnlyList<string> inputs,
        IReadOnlyList<ConcatClip> clips,
        string originalName,
        string? suffix,
        FadeSettings? fade,
        IProgress<JobProgress>? progress,
        CancellationToken cancellationToken)
    {
        var temp = TempOutput();
        try
        {
            var plan = Concat.BuildArgs(inputs, clips, temp, Processing, fade: fade);
            progress?.Report(new JobProgress(JobPhase.Rendering, 0.06));
            await ffmpeg.RunAsync(
                    plan.Args,
                    plan.Duration,
                    Wrap(progress, JobPhase.Rendering, 0.06, 0.94),
                    cancellationToken)
                .ConfigureAwait(false);

            progress?.Report(new JobProgress(JobPhase.Rendering, 0.96));
            var result = output.Save(temp, originalName, suffix, plan.Duration);
            progress?.Report(new JobProgress(JobPhase.Done, 1));
            return result;
        }
        finally
        {
            SafeDelete(temp);
        }
    }

    private async Task<List<Segment>> AnalyseAsync(
        string path,
        MediaInfo info,
        AutocutParameters parameters,
        (double Seek, double Length) window,
        IProgress<JobProgress>? progress,
        CancellationToken cancellationToken)
    {
        if (!info.HasAudio) throw new AppException(AppErrorCodes.NoAudio);

        var analysisProgress = new Progress<RenderProgress>(sample =>
        {
            progress?.Report(new JobProgress(JobPhase.Analyzing, 0.02 + Math.Clamp(sample.Ratio, 0, 1) * 0.05));
        });

        var result = await ffmpeg.RunAsync(
                Silence.BuildSilenceArgs(
                    path,
                    parameters.ThresholdDb,
                    parameters.MinSilence,
                    window.Seek,
                    window.Length),
                window.Length,
                analysisProgress,
                cancellationToken,
                allowFailure: true)
            .ConfigureAwait(false);

        if (result.ExitCode != 0)
        {
            var detail = string.Join(Environment.NewLine, result.Logs.TakeLast(8));
            throw new AppException(AppErrorCodes.RenderFailed, detail);
        }

        return Silence.ComputeKeepSegments(
            Silence.ParseLogs(result.Logs),
            window.Length,
            parameters.PreCut,
            parameters.PostCut,
            parameters.MinClipDuration);
    }

    private async Task<MediaInfo> ResolveInfoAsync(string path, MediaInfo? known, CancellationToken cancellationToken)
    {
        if (known is not null && known.Duration > 0) return known;
        return await ffmpeg.ProbeAsync(path, cancellationToken).ConfigureAwait(false);
    }

    private static double ResolveDuration(MediaInfo info)
    {
        if (info.Duration <= 0) throw new AppException(AppErrorCodes.Duration);
        return info.Duration;
    }

    private (double Seek, double Length) ComputeWindow(double duration, bool preview) =>
        preview
            ? Silence.ComputePreviewWindow(duration, Processing.PreviewDuration)
            : (0, duration);

    private static IProgress<RenderProgress>? Wrap(
        IProgress<JobProgress>? progress,
        JobPhase phase,
        double from,
        double to)
    {
        if (progress is null) return null;
        return new Progress<RenderProgress>(sample =>
        {
            var ratio = from + Math.Clamp(sample.Ratio, 0, 1) * (to - from);
            progress.Report(new JobProgress(phase, ratio, sample.EtaSeconds));
        });
    }

    private static string TempOutput()
    {
        var folder = Path.Combine(Path.GetTempPath(), "bulkut");
        Directory.CreateDirectory(folder);
        return Path.Combine(folder, $"bulkut-{Guid.NewGuid():N}.mp4");
    }

    private static void SafeDelete(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch (IOException)
        {
        }
    }
}
