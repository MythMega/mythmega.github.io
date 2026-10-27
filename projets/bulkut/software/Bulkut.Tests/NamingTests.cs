using Bulkut.Core.Features;
using Xunit;

namespace Bulkut.Tests;

public sealed class NamingTests
{
    [Theory]
    [InlineData("-autocut", "-autocut")]
    [InlineData("  -cut  ", "-cut")]
    [InlineData("a/b:c*?\"<>|", "abc")]
    [InlineData("...suffix...", "suffix")]
    public void SanitizesSuffixes(string input, string expected) =>
        Assert.Equal(expected, Naming.SanitizeSuffix(input));

    [Fact]
    public void LimitsSuffixLength()
    {
        Assert.Equal(40, Naming.SanitizeSuffix(new string('x', 80)).Length);
    }

    [Theory]
    [InlineData("clip.mp4", "-cut", "clip-cut.mp4")]
    [InlineData("my clip.mov", "", "my clip.mp4")]
    [InlineData("weird:name?.mkv", "-x", "weird-name--x.mp4")]
    [InlineData(null, "-x", "video-x.mp4")]
    public void BuildsOutputNames(string? input, string suffix, string expected) =>
        Assert.Equal(expected, Naming.BuildOutputName(input, suffix));

    [Theory]
    [InlineData("a.mp4", true)]
    [InlineData("a.MKV", true)]
    [InlineData("a.txt", false)]
    [InlineData("noextension", false)]
    [InlineData(null, false)]
    public void RecognisesVideoExtensions(string? name, bool expected) =>
        Assert.Equal(expected, Naming.IsVideoExtension(name));

    [Fact]
    public void FindsAFreeOutputPath()
    {
        var folder = Path.Combine(Path.GetTempPath(), "bulkut-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        try
        {
            File.WriteAllText(Path.Combine(folder, "clip-cut.mp4"), "x");
            File.WriteAllText(Path.Combine(folder, "clip-cut (1).mp4"), "x");

            var path = Naming.UniquePath(folder, "clip-cut.mp4");

            Assert.Equal("clip-cut (2).mp4", Path.GetFileName(path));
        }
        finally
        {
            Directory.Delete(folder, true);
        }
    }
}
