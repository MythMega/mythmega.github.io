using Bulkut.Core.Features;
using Bulkut.Core.Models;
using Xunit;

namespace Bulkut.Tests;

public sealed class FadeAndSplitterTests
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
    public void NormalizesModesAndClampsTheDuration()
    {
        var fade = Fades.Normalize(new FadeSettings { Audio = "BOTH", Video = "sideways", Duration = 9 });

        Assert.Equal("both", fade.Audio);
        Assert.Equal("none", fade.Video);
        Assert.Equal(1, fade.Duration);

        fade = Fades.Normalize(new FadeSettings { Duration = -3 });
        Assert.Equal(0.1, fade.Duration);
    }

    [Fact]
    public void BuildsInAndOutFiltersAtTheEndOfTheFile()
    {
        var fade = new FadeSettings { Audio = "both", Video = "in", Duration = 0.5 };

        Assert.Equal("fade=t=in:st=0:d=0.500", Fades.VideoFilter(fade, 10));
        Assert.Equal(
            "afade=t=in:st=0:d=0.500,afade=t=out:st=9.500:d=0.500",
            Fades.AudioFilter(fade, 10));
    }

    [Fact]
    public void FastcutAppliesTheFadeOnTheExportedFile()
    {
        var fade = new FadeSettings { Audio = "out", Video = "both", Duration = 1 };
        var args = Fastcut.BuildArgs("in.mp4", "out.mp4", 2, 8, Processing, hasAudio: true, fade: fade);

        var list = args.ToList();
        var video = list[list.IndexOf("-vf") + 1];
        var audio = list[list.IndexOf("-af") + 1];
        Assert.Contains("fade=t=in:st=0:d=1.000", video);
        Assert.Contains("fade=t=out:st=7.000:d=1.000", video);
        Assert.Equal("afade=t=out:st=7.000:d=1.000", audio);
    }

    [Fact]
    public void FastcutSkipsTheAudioFilterForSilentFiles()
    {
        var fade = new FadeSettings { Audio = "both", Video = "none", Duration = 1 };
        var args = Fastcut.BuildArgs("in.mp4", "out.mp4", 0, 5, Processing, hasAudio: false, fade: fade);

        Assert.DoesNotContain("-af", args);
    }

    [Fact]
    public void ConcatAppliesTheFadeOnceToTheJoinedResult()
    {
        var fade = new FadeSettings { Audio = "in", Video = "both", Duration = 1 };
        var clips = new List<ConcatClip> { new(true, 3, 640, 360), new(true, 2, 640, 360) };
        var graph = Concat.BuildFilterGraph(clips, 640, 360, 30, "yuv420p", fade, 5);

        Assert.Contains("[vout]fade=t=in:st=0:d=1.000,fade=t=out:st=4.000:d=1.000[vf]", graph);
        Assert.Contains("[aout]afade=t=in:st=0:d=1.000[afout]", graph);

        var plan = Concat.BuildArgs(["a.mp4", "b.mp4"], clips, "out.mp4", Processing, fade: fade);
        Assert.Contains("[vf]", plan.Args);
        Assert.Contains("[afout]", plan.Args);
        Assert.Equal(5, plan.Duration);
    }

    [Fact]
    public void AutocutAppliesTheFadeAfterTheKeptClipsAreJoined()
    {
        var fade = new FadeSettings { Audio = "none", Video = "out", Duration = 0.5 };
        var segments = new List<Segment> { new(0, 1), new(2, 3) };
        var graph = Silence.BuildFilterGraph(segments, hasAudio: true, fade: fade, totalDuration: 2);

        Assert.Contains("concat=n=2:v=1:a=1[vout][aout]", graph);
        Assert.Contains("[vout]fade=t=out:st=1.500:d=0.500[vf]", graph);
        Assert.DoesNotContain("[aout]afade", graph);

        var args = Silence.BuildAutocutArgs("in.mp4", "out.mp4", segments, true, Processing, fade: fade);
        Assert.Contains("[vf]", args);
        Assert.Contains("[aout]", args);
    }

    [Fact]
    public void SplitterKeepsOnlyValidRangesInsideTheSource()
    {
        var ranges = Splitter.Normalize(
            [new SplitRange(0, 2), new SplitRange(4, 4), new SplitRange(8, 12), new SplitRange(-1, 1)],
            10);

        Assert.Equal(3, ranges.Count);
        Assert.Equal(new SplitRange(0, 2), ranges[0]);
        Assert.Equal(new SplitRange(8, 10), ranges[1]);
        Assert.Equal(new SplitRange(0, 1), ranges[2]);
    }

    [Fact]
    public void SplitterNumbersEveryExportedFile()
    {
        Assert.Equal("-split-01", Splitter.SegmentSuffix("-split", 1));
        Assert.Equal("bad-12", Splitter.SegmentSuffix(" bad:* ", 12));
    }

    [Fact]
    public void FadeValuesRoundTripThroughAPreset()
    {
        var fade = new FadeSettings { Audio = "in", Video = "both", Duration = 0.3 };
        var numbers = new Dictionary<string, double>();
        var texts = new Dictionary<string, string>();

        Fades.ToPreset(fade, numbers, texts);
        var restored = new FadeSettings { Audio = "out", Video = "none", Duration = 1 };
        Fades.FromPreset(new Preset { Numbers = numbers, Texts = texts }, restored, new FadeConfig());

        Assert.Equal("in", restored.Audio);
        Assert.Equal("both", restored.Video);
        Assert.Equal(0.3, restored.Duration);
    }
}
