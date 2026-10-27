using System.Globalization;
using System.Text.RegularExpressions;
using Bulkut.Core.Features;
using Bulkut.Core.Models;

namespace Bulkut.Core.Services;

public static class MediaProbeParser
{
    private static readonly Regex DurationRegex =
        new(@"Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)", RegexOptions.Compiled);

    private static readonly Regex VideoRegex =
        new(@"Stream #\d+:\d+.*?: Video:\s*([^,\s]+)", RegexOptions.Compiled);

    private static readonly Regex AudioRegex =
        new(@"Stream #\d+:\d+.*?: Audio:\s*([^,\s]+)", RegexOptions.Compiled);

    private static readonly Regex SizeRegex =
        new(@"\b(\d{2,5})x(\d{2,5})\b", RegexOptions.Compiled);

    private static readonly Regex FpsRegex =
        new(@"([\d.]+)\s*fps", RegexOptions.Compiled);

    public static MediaInfo Parse(IEnumerable<string> lines, double durationHint = 0)
    {
        var info = new MediaInfo();
        foreach (var line in lines)
        {
            var duration = DurationRegex.Match(line);
            if (duration.Success)
            {
                info.Duration = int.Parse(duration.Groups[1].Value, CultureInfo.InvariantCulture) * 3600
                                + int.Parse(duration.Groups[2].Value, CultureInfo.InvariantCulture) * 60
                                + double.Parse(duration.Groups[3].Value, CultureInfo.InvariantCulture);
            }

            var video = VideoRegex.Match(line);
            if (video.Success)
            {
                info.HasVideo = true;
                info.VideoCodec = video.Groups[1].Value;
                var size = SizeRegex.Match(line);
                if (size.Success)
                {
                    info.Width = int.Parse(size.Groups[1].Value, CultureInfo.InvariantCulture);
                    info.Height = int.Parse(size.Groups[2].Value, CultureInfo.InvariantCulture);
                }

                var fps = FpsRegex.Match(line);
                if (fps.Success && double.TryParse(fps.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var value))
                    info.Fps = value;
            }

            var audio = AudioRegex.Match(line);
            if (audio.Success)
            {
                info.HasAudio = true;
                info.AudioCodec = audio.Groups[1].Value;
            }
        }

        if (info.Duration <= 0 && durationHint > 0) info.Duration = durationHint;
        return info;
    }

    public static string FormatDuration(double seconds) => Timecode.FormatTimecode(seconds);
}
