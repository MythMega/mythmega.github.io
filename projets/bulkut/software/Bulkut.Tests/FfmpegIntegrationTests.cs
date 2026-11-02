using System.Text.RegularExpressions;
using Bulkut.Core.Features;
using Bulkut.Core.Models;
using Bulkut.Core.Services;
using Xunit;

namespace Bulkut.Tests;

/// <summary>
/// End-to-end checks against a real FFmpeg build. They are skipped silently when
/// no binary is available, so a plain checkout can still run the unit tests.
/// </summary>
public sealed class FfmpegIntegrationTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "bulkut-it-" + Guid.NewGuid().ToString("N"));
    private readonly string? _ffmpeg = FindFfmpeg();
    private string? _previousEnv;

    [Fact]
    public async Task RunsEveryPipelineAndProducesPlayableFiles()
    {
        if (_ffmpeg is null) return;

        Directory.CreateDirectory(_root);
        var outputFolder = Path.Combine(_root, "out");
        Directory.CreateDirectory(outputFolder);

        var settings = new SettingsStore(new AppAssets(), Path.Combine(_root, "state"));
        settings.State.OutputFolder = outputFolder;
        settings.Save();

        _previousEnv = Environment.GetEnvironmentVariable("BULKUT_FFMPEG");
        Environment.SetEnvironmentVariable("BULKUT_FFMPEG", _ffmpeg);
        var ffmpeg = new FfmpegService(settings.Desktop, Path.Combine(_root, "app"));
        await ffmpeg.EnsureAvailableAsync();
        var engine = new RenderEngine(settings, ffmpeg, new OutputService(settings));

        var input = Path.Combine(_root, "input.mp4");
        await CreateToneVideoAsync(ffmpeg, input, 12, 2, 4);
        var info = await ffmpeg.ProbeAsync(input);
        Assert.True(info.HasVideo);
        Assert.True(info.HasAudio);
        Assert.InRange(info.Duration, 11.5, 12.5);
        Assert.InRange(info.Fps, 29.0, 31.0);

        var parameters = new AutocutParameters
        {
            ThresholdDb = -25,
            PreCut = 0.1,
            PostCut = 0.1,
            MinClipDuration = 0.2,
            MinSilence = 0.4,
        };

        var estimate = await engine.EstimateAutocutAsync(input, info, parameters, null, CancellationToken.None);
        Assert.Equal(3, estimate.Clips);
        Assert.InRange(estimate.OutputDuration, 5.5, 6.5);

        var autocut = await engine.RenderAutocutAsync(input, info, parameters, "-autocut", false, null, CancellationToken.None);
        Assert.True(File.Exists(autocut.OutputPath));
        var autocutInfo = await ffmpeg.ProbeAsync(autocut.OutputPath);
        Assert.InRange(autocutInfo.Duration, estimate.OutputDuration - 0.6, estimate.OutputDuration + 0.6);

        var timelineParameters = parameters.Clone();
        timelineParameters.Output = AutocutOutput.Premiere;
        var sequence = await engine.RenderAutocutAsync(
            input, info, timelineParameters, "-sequence", false, null, CancellationToken.None);
        Assert.EndsWith(".xml", sequence.FileName);
        var sequenceXml = await File.ReadAllTextAsync(sequence.OutputPath);
        Assert.Contains("<xmeml version=\"5\">", sequenceXml);
        // Three kept segments, each duplicated on the two stereo audio tracks.
        Assert.Equal(9, Regex.Matches(sequenceXml, "<clipitem id=").Count);

        var fastcut = await engine.RenderFastcutAsync(input, info, 2, 5, "-cut", null, null, CancellationToken.None);
        var cutInfo = await ffmpeg.ProbeAsync(fastcut.OutputPath);
        Assert.InRange(cutInfo.Duration, 2.7, 3.3);

        var reverse = await engine.RenderReverseAsync(input, info, "-reversed", null, null, CancellationToken.None);
        var reverseInfo = await ffmpeg.ProbeAsync(reverse.OutputPath);
        Assert.InRange(reverseInfo.Duration, 11.5, 12.5);

        var silent = Path.Combine(_root, "silent.mp4");
        await CreateSilentVideoAsync(ffmpeg, silent, 2);
        var collage = await engine.RenderConcatAsync([input, silent], [info.Duration, 2], "-collage", null, null, CancellationToken.None);
        var collageInfo = await ffmpeg.ProbeAsync(collage.OutputPath);
        Assert.InRange(collageInfo.Duration, 13.5, 14.5);
        Assert.True(collageInfo.HasAudio);

        var intro = Path.Combine(_root, "intro.mp4");
        await CreateToneVideoAsync(ffmpeg, intro, 2, 2, 4);
        var plan = IntroOutroPlanner.Plan(input, info.Duration, EdgeMode.Intro, new EdgeMedia(intro, 2), null);
        var withIntro = await engine.RenderIntroOutroAsync(plan, "input.mp4", "-intro", null, null, CancellationToken.None);
        var introInfo = await ffmpeg.ProbeAsync(withIntro.OutputPath);
        Assert.InRange(introInfo.Duration, 13.5, 14.5);

        var fade = new FadeSettings { Audio = "both", Video = "both", Duration = 1 };
        var splits = await engine.RenderSplitAsync(
            input,
            info,
            [new SplitRange(0, 2), new SplitRange(5, 7)],
            "-split",
            fade,
            null,
            CancellationToken.None);
        Assert.Equal(2, splits.Count);
        foreach (var split in splits)
        {
            Assert.True(File.Exists(split.OutputPath));
            var splitInfo = await ffmpeg.ProbeAsync(split.OutputPath);
            Assert.InRange(splitInfo.Duration, 1.5, 2.5);
            Assert.True(splitInfo.HasAudio);
        }

        Assert.Equal(7, Directory.GetFiles(outputFolder, "*.mp4").Length);
    }

    private static async Task CreateToneVideoAsync(FfmpegService ffmpeg, string path, int duration, int toneLength, int period)
    {
        var audio = $"aevalsrc='if(between(mod(t,{period}),0,{toneLength}),0.4*sin(2*PI*440*t),0)':s=48000:d={duration}";
        await ffmpeg.RunAsync(
            [
                "-f", "lavfi", "-i", $"color=c=black:s=320x240:r=30:d={duration}",
                "-f", "lavfi", "-i", audio,
                "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-shortest", "-y", path,
            ],
            0,
            null,
            CancellationToken.None);
    }

    private static async Task CreateSilentVideoAsync(FfmpegService ffmpeg, string path, int duration)
    {
        await ffmpeg.RunAsync(
            [
                "-f", "lavfi", "-i", $"color=c=black:s=320x240:r=30:d={duration}",
                "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
                "-y", path,
            ],
            0,
            null,
            CancellationToken.None);
    }

    private static string? FindFfmpeg()
    {
        var explicitPath = Environment.GetEnvironmentVariable("BULKUT_FFMPEG");
        if (!string.IsNullOrWhiteSpace(explicitPath) && File.Exists(explicitPath)) return explicitPath;

        var candidates = OperatingSystem.IsWindows()
            ? new[] { @"C:\PROG\FFMPEG\bin\ffmpeg.exe", @"C:\ffmpeg\bin\ffmpeg.exe" }
            : new[] { "/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg" };
        foreach (var candidate in candidates)
            if (File.Exists(candidate)) return candidate;

        var path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (var directory in path.Split(Path.PathSeparator))
        {
            var candidate = Path.Combine(directory, OperatingSystem.IsWindows() ? "ffmpeg.exe" : "ffmpeg");
            if (File.Exists(candidate)) return candidate;
        }

        return null;
    }

    public void Dispose()
    {
        if (_ffmpeg is not null) Environment.SetEnvironmentVariable("BULKUT_FFMPEG", _previousEnv);
        try
        {
            if (Directory.Exists(_root)) Directory.Delete(_root, true);
        }
        catch (IOException)
        {
        }
    }
}
