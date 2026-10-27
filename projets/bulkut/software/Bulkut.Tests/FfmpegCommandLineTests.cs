using Bulkut.Core.Features;
using Xunit;

namespace Bulkut.Tests;

public sealed class FfmpegCommandLineTests
{
    [Fact]
    public void LeavesPlainArgumentsAlone()
    {
        var line = FfmpegCommandLine.Build(["-hide_banner", "-i", "/data/user/0/app/cache/clip.mp4", "-y", "/tmp/out.mp4"]);

        Assert.Equal("-hide_banner -i /data/user/0/app/cache/clip.mp4 -y /tmp/out.mp4", line);
    }

    [Fact]
    public void QuotesPathsWithSpaces()
    {
        var line = FfmpegCommandLine.Build(["-i", "/sdcard/My Videos/holiday clip.mp4"]);

        Assert.Equal("-i \"/sdcard/My Videos/holiday clip.mp4\"", line);
    }

    [Fact]
    public void KeepsFilterGraphsAsOneArgument()
    {
        var filter = "[0:v]trim=start=0.5:end=3.2,setpts=PTS-STARTPTS[v0];[0:a]atrim=0.5:3.2,asetpts=PTS-STARTPTS[a0]";
        var line = FfmpegCommandLine.Build(["-filter_complex", filter, "-map", "[v0]"]);

        Assert.Equal($"-filter_complex \"{filter}\" -map \"[v0]\"", line);
    }

    [Fact]
    public void EscapesQuotesAndBackslashes()
    {
        var line = FfmpegCommandLine.Build(["drawtext=text=\"hi\":x=10"]);

        Assert.Equal("\"drawtext=text=\\\"hi\\\":x=10\"", line);
    }

    [Fact]
    public void QuotesEmptyArguments()
    {
        Assert.Equal("\"\"", FfmpegCommandLine.Build([""]));
    }
}
