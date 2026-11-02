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
    public void ShotcutProjectHoldsOneChainPerKeptCut()
    {
        var xml = TimelineExport.Build(
            AutocutOutput.Shotcut,
            Source,
            [new Segment(0, 2), new Segment(3.5, 5)]);

        Assert.Contains("<mlt LC_NUMERIC=\"C\" version=\"7.9.0\"", xml);
        Assert.Contains("frame_rate_num=\"30\" frame_rate_den=\"1\"", xml);
        Assert.Equal(2, Regex.Matches(xml, "<chain id=\"chain").Count);
        Assert.Contains("<entry producer=\"bg\" in=\"00:00:00.000\" out=\"00:00:03.500\" />", xml);
        Assert.Contains("<entry producer=\"chain0\" in=\"00:00:00.000\" out=\"00:00:02.000\" />", xml);
        Assert.Contains("<entry producer=\"chain1\" in=\"00:00:03.500\" out=\"00:00:05.000\" />", xml);
        Assert.Contains("<property name=\"resource\">C:\\Videos\\interview.mp4</property>", xml);
    }

    [Fact]
    public void FinalCutProTimelineUsesItsOwnFcpxmlVersion()
    {
        var xml = TimelineExport.Build(AutocutOutput.FinalCut, Source, [new Segment(1, 3)]);

        Assert.Contains("<fcpxml version=\"1.11\">", xml);
        Assert.Contains("frameDuration=\"1/30s\"", xml);
        Assert.Contains("offset=\"0s\" duration=\"60/30s\" start=\"30/30s\"", xml);
    }

    [Fact]
    public void VegasProReusesThePremiereSequence()
    {
        var segments = new[] { new Segment(0, 1) };

        Assert.Equal(
            TimelineExport.Build(AutocutOutput.Premiere, Source, segments),
            TimelineExport.Build(AutocutOutput.Vegas, Source, segments));
    }

    [Theory]
    [InlineData(AutocutOutput.Premiere, "xml")]
    [InlineData(AutocutOutput.Vegas, "xml")]
    [InlineData(AutocutOutput.Davinci, "fcpxml")]
    [InlineData(AutocutOutput.FinalCut, "fcpxml")]
    [InlineData(AutocutOutput.Shotcut, "mlt")]
    [InlineData(AutocutOutput.Video, "mp4")]
    public void EveryOutputHasAMatchingExtension(string output, string extension)
    {
        Assert.Equal(extension, AutocutOutput.Extension(output));
        Assert.True(AutocutOutput.IsTimeline(output) == (extension != "mp4"));
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
