using Bulkut.Core.Features;
using Xunit;

namespace Bulkut.Tests;

public sealed class FfmpegStatsTests
{
    [Fact]
    public void ParsesClassicStatsLine()
    {
        var sample = FfmpegProgressParser.ParseStatsLine(
            "frame=  642 fps= 61 q=28.0 size=   1344kB time=00:00:10.72 bitrate=1027.0kbits/s speed=1.02x");

        Assert.NotNull(sample);
        Assert.Equal(10.72, sample!.Seconds, 2);
        Assert.Equal(61, sample.Fps);
        Assert.Equal(642, sample.Frame);
        Assert.Equal(1.02, sample.Speed, 2);
    }

    [Fact]
    public void ParsesProgressPipeLinesAndEta()
    {
        var parser = new FfmpegProgressParser(10);
        parser.Feed("out_time_us=5000000");
        var snapshot = parser.Feed("progress=continue");

        Assert.NotNull(snapshot);
        Assert.Equal(0.5, snapshot!.Ratio, 3);
        Assert.True(snapshot.EtaSeconds >= 0);
    }

    [Fact]
    public void NeverLetsProgressGoBackwards()
    {
        var parser = new FfmpegProgressParser(10);
        parser.Feed("out_time_us=6000000");
        var high = parser.Snapshot();
        parser.Feed("out_time_us=2000000");
        var low = parser.Snapshot();

        Assert.Equal(0.6, high.Ratio, 3);
        Assert.Equal(high.Ratio, low.Ratio, 3);
    }

    [Fact]
    public void SmoothsSpeedAndEstimatesEta()
    {
        Assert.Equal(2, FfmpegProgressParser.SmoothSpeed(0, 2));
        Assert.True(FfmpegProgressParser.SmoothSpeed(2, 4) is > 2 and < 4);
        Assert.Equal(10, FfmpegProgressParser.EstimateEtaSeconds(0, 10, 0, 1, 0));
        Assert.Equal(0, FfmpegProgressParser.EstimateEtaSeconds(10, 10, 1, 1, 1000));
    }

    [Fact]
    public void IgnoresUnrelatedLines()
    {
        var parser = new FfmpegProgressParser(10);
        Assert.Null(parser.Feed("Stream mapping:"));
        Assert.Null(FfmpegProgressParser.ParseStatsLine("frame=1 fps=1"));
    }
}
