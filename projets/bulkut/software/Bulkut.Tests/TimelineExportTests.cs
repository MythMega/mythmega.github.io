using System.Text.RegularExpressions;
using Bulkut.Core.Features;
using Bulkut.Core.Models;
using Bulkut.Core.Services;
using Xunit;

namespace Bulkut.Tests;

public sealed class TimelineExportTests
{
    private static readonly TimelineSource Source = new(
        "interview.mp4",
        @"C:\Videos\interview.mp4",
        10,
        1920,
        1080,
        30,
        true);

    [Fact]
    public void PremiereSequenceContainsOneClipPerKeptSegment()
    {
        var xml = TimelineExport.Build(
            AutocutOutput.Premiere,
            Source,
            [new Segment(0, 2), new Segment(3.5, 5)]);

        Assert.Contains("<xmeml version=\"5\">", xml);
        Assert.Contains("<duration>105</duration>", xml);
        Assert.Contains("<in>105</in>", xml);
        Assert.Contains("<out>150</out>", xml);
        Assert.Contains(@"C:\Videos\interview.mp4", xml);
        Assert.Equal(6, Regex.Matches(xml, "<clipitem id=").Count);
    }

    [Fact]
    public void DavinciTimelineUsesExactNtscFrameDurations()
    {
        var source = Source with { Fps = 59.94 };
        var xml = TimelineExport.Build(
            AutocutOutput.Davinci,
            source,
            [new Segment(1, 3)]);

        Assert.Contains("<fcpxml version=\"1.10\">", xml);
        Assert.Contains("frameDuration=\"1001/60000s\"", xml);
        Assert.Contains("src=\"file:///C:/Videos/interview.mp4\"", xml);
        Assert.Contains("offset=\"0s\" duration=\"120120/60000s\" start=\"60060/60000s\"", xml);
    }

    [Fact]
    public void TimelinesEscapeTheSourceName()
    {
        var source = Source with { Name = "A & B.mp4" };
        var xml = TimelineExport.Build(AutocutOutput.Premiere, source, [new Segment(0, 1)]);

        Assert.Contains("A &amp; B", xml);
    }

    [Fact]
    public void OutputFormatIsPartOfTheRenderKey()
    {
        var parameters = new AutocutParameters();
        var first = parameters.RenderKey();

        parameters.Output = AutocutOutput.Premiere;

        Assert.True(parameters.RenderChangedSince(first));
        Assert.Equal(8, first.Length);
    }

    [Fact]
    public void PerVideoOverrideCarriesItsOwnOutputFormat()
    {
        var global = new AutocutParameters { Output = AutocutOutput.Video };
        var effective = global.With(new AutocutParameters { Output = AutocutOutput.Davinci });

        Assert.Equal(AutocutOutput.Davinci, effective.Output);
    }

    [Fact]
    public void SettingsDefaultToVideoAndNormaliseUnknownFormats()
    {
        using var state = new TemporaryState();
        var settings = new SettingsStore(new AppAssets(), state.Directory);

        Assert.Equal(AutocutOutput.Video, settings.Params.Autocut.Output);

        settings.Params.Autocut.Output = "not-a-format";
        var normalised = settings.Normalize(settings.Params);
        Assert.Equal(AutocutOutput.Video, normalised.Autocut.Output);
    }

    private sealed class TemporaryState : IDisposable
    {
        public string Directory { get; } = Path.Combine(Path.GetTempPath(), "bulkut-timeline-" + Guid.NewGuid().ToString("N"));

        public void Dispose()
        {
            try
            {
                if (System.IO.Directory.Exists(Directory)) System.IO.Directory.Delete(Directory, true);
            }
            catch (IOException)
            {
            }
        }
    }
}
