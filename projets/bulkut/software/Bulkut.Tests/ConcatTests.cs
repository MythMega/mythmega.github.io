using Bulkut.Core.Features;
using Bulkut.Core.Models;
using Xunit;

namespace Bulkut.Tests;

public sealed class ConcatTests
{
    private static readonly ProcessingOptions Processing = new()
    {
        VideoCodec = "libx264",
        Preset = "veryfast",
        Crf = 23,
        PixelFormat = "yuv420p",
        AudioCodec = "aac",
        AudioBitrate = "128k",
        ConcatFps = 30,
    };

    [Fact]
    public void PicksTheLargestClipAndRoundsToEvenDimensions()
    {
        var clips = new List<ConcatClip>
        {
            new(true, 3, 640, 360),
            new(false, 2, 321, 241),
            new(true, 4, 1280, 718),
        };

        var (width, height) = Concat.TargetSize(clips);

        Assert.Equal(1280, width);
        Assert.Equal(718, height);
    }

    [Fact]
    public void FallsBackTo720pWhenNoSizeIsKnown()
    {
        var (width, height) = Concat.TargetSize([new ConcatClip(false, 2, 0, 0)]);
        Assert.Equal(1280, width);
        Assert.Equal(720, height);
    }

    [Fact]
    public void CreatesSilenceForClipsWithoutAudio()
    {
        var graph = Concat.BuildFilterGraph(
            [new ConcatClip(true, 2, 640, 360), new ConcatClip(false, 1.5, 320, 240)],
            640,
            360,
            30,
            "yuv420p");

        Assert.Contains("[0:a]aresample=48000", graph);
        Assert.Contains("anullsrc=channel_layout=stereo:sample_rate=48000:d=1.500", graph);
        Assert.Contains("concat=n=2:v=1:a=1[vout][aout]", graph);
    }

    [Fact]
    public void OmitsAudioWhenNoClipHasSound()
    {
        var graph = Concat.BuildFilterGraph(
            [new ConcatClip(false, 2, 640, 360)],
            640,
            360);

        Assert.DoesNotContain("anullsrc", graph);
        Assert.Contains("concat=n=1:v=1:a=0[vout]", graph);
    }

    [Fact]
    public void SumsClipDurations()
    {
        Assert.Equal(6.5, Concat.TotalDuration([
            new ConcatClip(true, 2.25, 640, 360),
            new ConcatClip(true, 4.25, 640, 360),
        ]));
    }

    [Fact]
    public void BuildsArgumentsWithThreadsAndFaststart()
    {
        var processing = new ProcessingOptions
        {
            VideoCodec = Processing.VideoCodec,
            Preset = Processing.Preset,
            Crf = Processing.Crf,
            PixelFormat = Processing.PixelFormat,
            AudioCodec = Processing.AudioCodec,
            AudioBitrate = Processing.AudioBitrate,
            Threads = 4,
        };
        var plan = Concat.BuildArgs(
            ["a.mp4", "b.mp4"],
            [new ConcatClip(true, 2, 640, 360), new ConcatClip(true, 3, 640, 360)],
            "out.mp4",
            processing,
            25);

        Assert.Equal(5, plan.Duration);
        Assert.Contains("-threads", plan.Args);
        Assert.Contains("4", plan.Args);
        Assert.Contains("25", plan.Args);
        Assert.Contains("+faststart", plan.Args);
        Assert.Equal("out.mp4", plan.Args[^1]);
    }
}
