using Bulkut.Core.Features;
using Bulkut.Core.Models;
using Xunit;

namespace Bulkut.Tests;

public sealed class SilenceTests
{
    [Fact]
    public void ParsesCompleteAndOpenSilences()
    {
        string[] logs =
        [
            "[silencedetect @ 0x1] silence_start: 1.5",
            "[silencedetect @ 0x1] silence_end: 3.25 | silence_duration: 1.75",
            "[silencedetect @ 0x1] silence_start: 8",
        ];

        var silences = Silence.ParseLogs(logs);

        Assert.Equal(2, silences.Count);
        Assert.Equal(1.5, silences[0].Start);
        Assert.Equal(3.25, silences[0].End);
        Assert.Equal(8, silences[1].Start);
        Assert.Null(silences[1].End);
    }

    [Fact]
    public void InvertsSilencesAndAppliesMargins()
    {
        var silences = new List<SilenceRange> { new(2, 4), new(6, 8) };

        var kept = Silence.ComputeKeepSegments(silences, 10, preCut: 0.5, postCut: 0.5);

        Assert.Equal(3, kept.Count);
        Assert.Equal(0, kept[0].Start);
        Assert.Equal(2.5, kept[0].End, 3);
        Assert.Equal(3.5, kept[1].Start, 3);
        Assert.Equal(6.5, kept[1].End, 3);
        Assert.Equal(7.5, kept[2].Start, 3);
        Assert.Equal(10, kept[2].End, 3);
    }

    [Fact]
    public void DropsClipsShorterThanTheMinimum()
    {
        var silences = new List<SilenceRange> { new(0, 1), new(1.2, 10) };

        var kept = Silence.ComputeKeepSegments(silences, 10, minSegment: 0.5);

        // The 0.2 s speech blip between the two silences is dropped.
        Assert.Empty(kept);
    }

    [Fact]
    public void MergesOverlappingSilencesAndMargins()
    {
        var silences = new List<SilenceRange> { new(2, 5), new(4, 6) };

        var kept = Silence.ComputeKeepSegments(silences, 10, preCut: 0.2, postCut: 0.2, minSegment: 0);

        Assert.Equal(2, kept.Count);
        Assert.Equal(2.2, kept[0].End, 3);
        Assert.Equal(5.8, kept[1].Start, 3);
    }

    [Fact]
    public void TotalKeptDurationRoundsToMilliseconds()
    {
        var kept = new List<Segment> { new(0, 1.2345), new(2, 3.1) };
        Assert.Equal(2.335, Silence.TotalKeptDuration(kept), 3);
    }

    [Fact]
    public void BuildsConcatenatingFilterGraph()
    {
        var graph = Silence.BuildFilterGraph([new Segment(0, 1), new Segment(2, 3)], hasAudio: true);

        Assert.Contains("[0:v]trim=start=0.000:end=1.000", graph);
        Assert.Contains("[0:a]atrim=start=2.000:end=3.000", graph);
        Assert.Contains("concat=n=2:v=1:a=1[vout][aout]", graph);
    }

    [Fact]
    public void ComputesMiddlePreviewWindow()
    {
        var (seek, length) = Silence.ComputePreviewWindow(180, 60);
        Assert.Equal(60, seek);
        Assert.Equal(60, length);

        var (shortSeek, shortLength) = Silence.ComputePreviewWindow(20, 60);
        Assert.Equal(0, shortSeek);
        Assert.Equal(20, shortLength);
    }

    [Fact]
    public void BuildsSilenceDetectionArguments()
    {
        var args = Silence.BuildSilenceArgs("in.mp4", -32, 0.6, 12.5, 30);

        Assert.Contains("-ss", args);
        Assert.Contains("12.500", args);
        Assert.Contains("-af", args);
        Assert.Contains("silencedetect=noise=-32.00dB:d=0.60", args);
    }
}
