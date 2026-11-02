using Bulkut.Core.Features;
using Xunit;

namespace Bulkut.Tests;

public sealed class TimecodeTests
{
    [Theory]
    [InlineData(0, "00:00:00")]
    [InlineData(83, "00:01:23")]
    [InlineData(3661, "01:01:01")]
    [InlineData(-5, "00:00:00")]
    public void FormatsTimecodes(double seconds, string expected) =>
        Assert.Equal(expected, Timecode.FormatTimecode(seconds));

    [Theory]
    [InlineData(83, "1:23")]
    [InlineData(3723, "1:02:03")]
    public void FormatsCompactDurations(double seconds, string expected) =>
        Assert.Equal(expected, Timecode.FormatDuration(seconds));

    [Theory]
    [InlineData("00:01:23", 83)]
    [InlineData("1:23", 83)]
    [InlineData("83", 83)]
    [InlineData("1:02:03", 3723)]
    public void ParsesTimecodes(string text, double expected) =>
        Assert.Equal(expected, Timecode.ParseTimecode(text));

    [Theory]
    [InlineData("")]
    [InlineData("aa:bb")]
    [InlineData("1:2:3:4")]
    [InlineData("-1:20")]
    public void RejectsInvalidTimecodes(string text) =>
        Assert.Null(Timecode.ParseTimecode(text));

    [Theory]
    [InlineData(12.34, 2, "12.34")]
    [InlineData(2, 0, "2")]
    [InlineData(2.5, 1, "2.5")]
    public void FormatsNumbers(double value, int decimals, string expected) =>
        Assert.Equal(expected, Timecode.FormatNumber(value, decimals));

    [Fact]
    public void FormatsBytes()
    {
        Assert.Equal("0 B", Timecode.FormatBytes(0));
        Assert.Equal("1 KB", Timecode.FormatBytes(1024));
        Assert.Equal("1.5 MB", Timecode.FormatBytes((long)(1.5 * 1024 * 1024)));
    }

    [Fact]
    public void ClampAndRound()
    {
        Assert.Equal(5, Timecode.Clamp(9, 0, 5));
        Assert.Equal(0, Timecode.Clamp(-2, 0, 5));
        Assert.Equal(1.235, Timecode.RoundTo(1.2345), 3);
    }
}
