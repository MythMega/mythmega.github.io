using System.Globalization;
using System.Text;
using Bulkut.Core.Models;

namespace Bulkut.Core.Features;

/// <summary>The three things Autocut can produce.</summary>
public static class AutocutOutput
{
    public const string Video = "video";
    public const string Premiere = "premiere";
    public const string Davinci = "davinci";

    public static IReadOnlyList<string> Formats { get; } = [Video, Premiere, Davinci];

    public static string Normalize(string? value) =>
        Formats.Contains(value, StringComparer.OrdinalIgnoreCase)
            ? value!.ToLowerInvariant()
            : Video;

    public static bool IsTimeline(string? value) => Normalize(value) is Premiere or Davinci;

    public static string Extension(string? value) => Normalize(value) switch
    {
        Premiere => "xml",
        Davinci => "fcpxml",
        _ => "mp4",
    };
}

/// <summary>Everything a timeline needs to know about the source clip.</summary>
public sealed record TimelineSource(
    string Name,
    string Path,
    double Duration,
    int Width,
    int Height,
    double Fps,
    bool HasAudio);

/// <summary>
/// Writes Autocut edits as a Premiere Pro sequence (FCP 7 XML) or a DaVinci
/// Resolve timeline (FCPXML). Both formats reference the original clip instead
/// of re-encoding it, and both are plain XML, so this class has no FFmpeg
/// dependency and is easy to unit test.
/// </summary>
public static class TimelineExport
{
    private sealed record FrameRate(double Fps, int Numerator, int Denominator, bool Ntsc);

    private sealed record FrameSegment(int Start, int End, int Duration, int Cursor);

    // Standard broadcast rates use a 1001/1000 time base. The tolerance absorbs
    // the rounded `fps` value printed by FFmpeg (29.97 rather than 29.970029…).
    private static readonly (double Fps, int Numerator, int Denominator)[] NtscRates =
    [
        (23.976, 1001, 24000),
        (29.97, 1001, 30000),
        (47.952, 1001, 48000),
        (59.94, 1001, 60000),
        (119.88, 1001, 120000),
    ];

    public static string Build(string output, TimelineSource source, IReadOnlyList<Segment> segments) =>
        AutocutOutput.Normalize(output) switch
        {
            AutocutOutput.Davinci => BuildDavinci(source, segments),
            AutocutOutput.Premiere => BuildPremiere(source, segments),
            _ => string.Empty,
        };

    private static string BuildPremiere(TimelineSource source, IReadOnlyList<Segment> segments)
    {
        var rate = RateFor(source.Fps);
        var clips = FrameSegments(segments, rate);
        if (clips.Count == 0) return string.Empty;

        var width = source.Width > 0 ? source.Width : 1920;
        var height = source.Height > 0 ? source.Height : 1080;
        var sourceFrames = Math.Max(1, ToFrames(source.Duration, rate));
        var totalFrames = clips.Sum(clip => clip.Duration);
        var label = Escape(BaseName(source.Name));
        var path = Escape(string.IsNullOrWhiteSpace(source.Path) ? source.Name : source.Path);
        var rateXml = PremiereRateXml(rate);

        var xml = new StringBuilder();
        xml.AppendLine("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
        xml.AppendLine("<xmeml version=\"5\">");
        xml.AppendLine("  <sequence explodedTracks=\"true\">");
        xml.AppendLine($"    <name>{label}</name>");
        xml.AppendLine($"    <duration>{totalFrames}</duration>");
        xml.AppendLine($"    {rateXml}");
        xml.AppendLine("    <media>");
        xml.AppendLine("      <video>");
        xml.AppendLine("        <format>");
        xml.AppendLine("          <samplecharacteristics>");
        xml.AppendLine($"            <width>{width}</width>");
        xml.AppendLine($"            <height>{height}</height>");
        xml.AppendLine("            <pixelaspectratio>square</pixelaspectratio>");
        xml.AppendLine($"            {rateXml}");
        xml.AppendLine("          </samplecharacteristics>");
        xml.AppendLine("        </format>");
        xml.AppendLine("        <track>");

        for (var index = 0; index < clips.Count; index++)
            AppendPremiereVideoClip(xml, clips[index], index, clips.Count, label, path, rateXml, source, sourceFrames, width, height);

        xml.AppendLine("        </track>");
        xml.AppendLine("      </video>");

        if (source.HasAudio)
        {
            xml.AppendLine("      <audio>");
            xml.AppendLine("        <numOutputChannels>2</numOutputChannels>");
            xml.AppendLine("        <format>");
            xml.AppendLine("          <samplecharacteristics>");
            xml.AppendLine("            <depth>16</depth>");
            xml.AppendLine("            <samplerate>48000</samplerate>");
            xml.AppendLine("          </samplecharacteristics>");
            xml.AppendLine("        </format>");
            for (var channel = 1; channel <= 2; channel++)
            {
                xml.AppendLine($"        <track currentExplodedTrackIndex=\"{channel - 1}\" totalExplodedTrackCount=\"2\" premiereTrackType=\"Stereo\">");
                xml.AppendLine($"          <outputchannelindex>{channel}</outputchannelindex>");
                for (var index = 0; index < clips.Count; index++)
                    AppendPremiereAudioClip(xml, clips[index], index, clips.Count, channel, label);
                xml.AppendLine("        </track>");
            }
            xml.AppendLine("      </audio>");
        }

        xml.AppendLine("    </media>");
        xml.AppendLine("  </sequence>");
        xml.AppendLine("</xmeml>");
        return xml.ToString();
    }

    private static void AppendPremiereVideoClip(
        StringBuilder xml,
        FrameSegment clip,
        int index,
        int count,
        string label,
        string path,
        string rateXml,
        TimelineSource source,
        int sourceFrames,
        int width,
        int height)
    {
        var videoId = $"clipitem-{index + 1}";
        var audioId = $"clipitem-{count + index + 1}";
        var secondAudioId = $"clipitem-{count * 2 + index + 1}";

        xml.AppendLine($"          <clipitem id=\"{videoId}\">");
        xml.AppendLine($"            <name>{label}</name>");
        xml.AppendLine("            <enabled>TRUE</enabled>");
        xml.AppendLine($"            <start>{clip.Cursor}</start>");
        xml.AppendLine($"            <end>{clip.Cursor + clip.Duration}</end>");
        xml.AppendLine($"            <in>{clip.Start}</in>");
        xml.AppendLine($"            <out>{clip.End}</out>");

        if (index == 0)
        {
            xml.AppendLine("            <file id=\"file-1\">");
            xml.AppendLine($"              <name>{label}</name>");
            xml.AppendLine($"              <pathurl>{path}</pathurl>");
            xml.AppendLine("              <timecode>");
            xml.AppendLine("                <string>00:00:00:00</string>");
            xml.AppendLine("                <displayformat>NDF</displayformat>");
            xml.AppendLine($"                {rateXml}");
            xml.AppendLine("              </timecode>");
            xml.AppendLine($"              {rateXml}");
            xml.AppendLine($"              <duration>{sourceFrames}</duration>");
            xml.AppendLine("              <media>");
            xml.AppendLine("                <video>");
            xml.AppendLine("                  <samplecharacteristics>");
            xml.AppendLine($"                    {rateXml}");
            xml.AppendLine($"                    <width>{width}</width>");
            xml.AppendLine($"                    <height>{height}</height>");
            xml.AppendLine("                    <pixelaspectratio>square</pixelaspectratio>");
            xml.AppendLine("                  </samplecharacteristics>");
            xml.AppendLine("                </video>");
            if (source.HasAudio)
            {
                xml.AppendLine("                <audio>");
                xml.AppendLine("                  <samplecharacteristics>");
                xml.AppendLine("                    <depth>16</depth>");
                xml.AppendLine("                    <samplerate>48000</samplerate>");
                xml.AppendLine("                  </samplecharacteristics>");
                xml.AppendLine("                  <channelcount>2</channelcount>");
                xml.AppendLine("                </audio>");
            }
            xml.AppendLine("              </media>");
            xml.AppendLine("            </file>");
        }
        else
        {
            xml.AppendLine("            <file id=\"file-1\" />");
        }

        xml.AppendLine("            <compositemode>normal</compositemode>");
        xml.AppendLine("            <link>");
        xml.AppendLine($"              <linkclipref>{videoId}</linkclipref>");
        xml.AppendLine("              <mediatype>video</mediatype>");
        xml.AppendLine("              <trackindex>1</trackindex>");
        xml.AppendLine($"              <clipindex>{index + 1}</clipindex>");
        xml.AppendLine("            </link>");

        if (source.HasAudio)
        {
            xml.AppendLine("            <link>");
            xml.AppendLine($"              <linkclipref>{audioId}</linkclipref>");
            xml.AppendLine("              <mediatype>audio</mediatype>");
            xml.AppendLine("              <trackindex>1</trackindex>");
            xml.AppendLine($"              <clipindex>{index + 1}</clipindex>");
            xml.AppendLine("            </link>");
            xml.AppendLine("            <link>");
            xml.AppendLine($"              <linkclipref>{secondAudioId}</linkclipref>");
            xml.AppendLine("              <mediatype>audio</mediatype>");
            xml.AppendLine("              <trackindex>2</trackindex>");
            xml.AppendLine($"              <clipindex>{index + 1}</clipindex>");
            xml.AppendLine("            </link>");
        }

        xml.AppendLine("          </clipitem>");
    }

    private static void AppendPremiereAudioClip(
        StringBuilder xml,
        FrameSegment clip,
        int index,
        int count,
        int channel,
        string label)
    {
        xml.AppendLine($"          <clipitem id=\"clipitem-{count * channel + index + 1}\" premiereChannelType=\"stereo\">");
        xml.AppendLine($"            <name>{label}</name>");
        xml.AppendLine("            <enabled>TRUE</enabled>");
        xml.AppendLine($"            <start>{clip.Cursor}</start>");
        xml.AppendLine($"            <end>{clip.Cursor + clip.Duration}</end>");
        xml.AppendLine($"            <in>{clip.Start}</in>");
        xml.AppendLine($"            <out>{clip.End}</out>");
        xml.AppendLine("            <file id=\"file-1\" />");
        xml.AppendLine("            <sourcetrack>");
        xml.AppendLine("              <mediatype>audio</mediatype>");
        xml.AppendLine($"              <trackindex>{channel}</trackindex>");
        xml.AppendLine("            </sourcetrack>");
        xml.AppendLine("          </clipitem>");
    }

    private static string BuildDavinci(TimelineSource source, IReadOnlyList<Segment> segments)
    {
        var rate = RateFor(source.Fps);
        var clips = FrameSegments(segments, rate);
        if (clips.Count == 0) return string.Empty;

        var width = source.Width > 0 ? source.Width : 1920;
        var height = source.Height > 0 ? source.Height : 1080;
        var sourceFrames = Math.Max(1, ToFrames(source.Duration, rate));
        var label = Escape(BaseName(source.Name));
        var media = Escape(MediaUrl(source.Path));

        var xml = new StringBuilder();
        xml.AppendLine("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
        xml.AppendLine("<fcpxml version=\"1.10\">");
        xml.AppendLine("  <resources>");
        xml.AppendLine($"    <format id=\"r1\" name=\"FFVideoFormatRateUndefined\" frameDuration=\"{FrameTime(1, rate)}\" width=\"{width}\" height=\"{height}\" colorSpace=\"1-1-1 (Rec. 709)\" />");
        xml.AppendLine($"    <asset id=\"r2\" name=\"{label}\" start=\"0s\" hasVideo=\"1\" format=\"r1\" hasAudio=\"{(source.HasAudio ? 1 : 0)}\" audioSources=\"{(source.HasAudio ? 1 : 0)}\" audioChannels=\"{(source.HasAudio ? 2 : 0)}\" duration=\"{FrameTime(sourceFrames, rate)}\">");
        xml.AppendLine($"      <media-rep kind=\"original-media\" src=\"{media}\" />");
        xml.AppendLine("    </asset>");
        xml.AppendLine("  </resources>");
        xml.AppendLine("  <library>");
        xml.AppendLine("    <event name=\"Bulkut\">");
        xml.AppendLine($"      <project name=\"{label}\">");
        xml.AppendLine("        <sequence format=\"r1\" tcStart=\"0s\" tcFormat=\"NDF\" audioLayout=\"stereo\" audioRate=\"48k\">");
        xml.AppendLine("          <spine>");
        foreach (var clip in clips)
        {
            xml.AppendLine($"            <asset-clip name=\"{label}\" ref=\"r2\" offset=\"{FrameTime(clip.Cursor, rate)}\" duration=\"{FrameTime(clip.Duration, rate)}\" start=\"{FrameTime(clip.Start, rate)}\" tcFormat=\"NDF\" />");
        }
        xml.AppendLine("          </spine>");
        xml.AppendLine("        </sequence>");
        xml.AppendLine("      </project>");
        xml.AppendLine("    </event>");
        xml.AppendLine("  </library>");
        xml.AppendLine("</fcpxml>");
        return xml.ToString();
    }

    private static List<FrameSegment> FrameSegments(IReadOnlyList<Segment> segments, FrameRate rate)
    {
        var clips = new List<FrameSegment>(segments.Count);
        var cursor = 0;
        foreach (var segment in segments)
        {
            var start = ToFrames(segment.Start, rate);
            var end = Math.Max(start + 1, ToFrames(segment.End, rate));
            var duration = end - start;
            clips.Add(new FrameSegment(start, end, duration, cursor));
            cursor += duration;
        }
        return clips;
    }

    private static int ToFrames(double seconds, FrameRate rate) =>
        Math.Max(0, (int)Math.Round(Math.Max(0, seconds) * rate.Fps));

    private static string FrameTime(int frames, FrameRate rate) =>
        frames == 0 ? "0s" : $"{frames * rate.Numerator}/{rate.Denominator}s";

    private static FrameRate RateFor(double fps)
    {
        if (!double.IsFinite(fps) || fps <= 0) return new FrameRate(30, 1, 30, false);

        foreach (var (value, numerator, denominator) in NtscRates)
        {
            if (Math.Abs(fps - value) <= 0.03)
                return new FrameRate(value, numerator, denominator, true);
        }

        var rounded = Math.Max(1, (int)Math.Round(fps));
        return new FrameRate(rounded, 1, rounded, false);
    }

    private static string PremiereRateXml(FrameRate rate) =>
        $"<rate><timebase>{Math.Round(rate.Fps).ToString(CultureInfo.InvariantCulture)}</timebase><ntsc>{(rate.Ntsc ? "TRUE" : "FALSE")}</ntsc></rate>";

    private static string BaseName(string? name)
    {
        var value = string.IsNullOrWhiteSpace(name) ? "video" : name;
        var dot = value.LastIndexOf('.');
        return dot > 0 ? value[..dot] : value;
    }

    private static string MediaUrl(string? path)
    {
        var value = string.IsNullOrWhiteSpace(path) ? "video.mp4" : path;
        if (value.StartsWith("file:", StringComparison.OrdinalIgnoreCase)) return value;
        if (value.Length > 2 && char.IsLetter(value[0]) && value[1] == ':')
            return "file:///" + value.Replace('\\', '/');
        return value;
    }

    private static string Escape(string? value) => System.Security.SecurityElement.Escape(value ?? "") ?? "";
}
