using System.Globalization;

namespace Bulkut.Core.Features;

/// <summary>Timecode, duration and number formatting helpers. All pure.</summary>
public static class Timecode
{
    public static double Clamp(double value, double min, double max) => Math.Min(max, Math.Max(min, value));

    public static string Pad(int value, int size = 2) =>
        Math.Abs(value).ToString(CultureInfo.InvariantCulture).PadLeft(size, '0');

    public static (int Hours, int Minutes, int Seconds) Split(double seconds)
    {
        var total = Math.Max(0, (int)Math.Round(seconds));
        return (total / 3600, total % 3600 / 60, total % 60);
    }

    /// <summary><c>00:01:23</c></summary>
    public static string FormatTimecode(double seconds)
    {
        var (hours, minutes, secs) = Split(seconds);
        return $"{Pad(hours)}:{Pad(minutes)}:{Pad(secs)}";
    }

    /// <summary><c>1:23</c> or <c>1:02:03</c>, for compact meta lines.</summary>
    public static string FormatDuration(double seconds)
    {
        var (hours, minutes, secs) = Split(seconds);
        return hours > 0 ? $"{hours}:{Pad(minutes)}:{Pad(secs)}" : $"{minutes}:{Pad(secs)}";
    }

    /// <summary><c>8 s</c> or <c>1:23</c>.</summary>
    public static string FormatEta(double seconds)
    {
        var total = Math.Max(0, (int)Math.Round(seconds));
        return total < 60 ? $"{total} s" : FormatDuration(total);
    }

    /// <summary>Parses <c>hh:mm:ss</c>, <c>mm:ss</c> or <c>ss</c>.</summary>
    public static double? ParseTimecode(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var parts = value.Trim().Split(':');
        if (parts.Length is 0 or > 3) return null;

        var numbers = new double[parts.Length];
        for (var i = 0; i < parts.Length; i++)
        {
            if (!double.TryParse(parts[i], NumberStyles.Float, CultureInfo.InvariantCulture, out numbers[i]) ||
                !double.IsFinite(numbers[i]) || numbers[i] < 0)
                return null;
        }

        return parts.Length switch
        {
            3 => numbers[0] * 3600 + numbers[1] * 60 + numbers[2],
            2 => numbers[0] * 60 + numbers[1],
            _ => numbers[0],
        };
    }

    public static double ToSeconds(int hours, int minutes, int seconds) => hours * 3600 + minutes * 60 + seconds;

    public static string FormatNumber(double value, int decimals = 2)
    {
        if (!double.IsFinite(value)) return "0";
        var fixedValue = value.ToString("F" + decimals.ToString(CultureInfo.InvariantCulture), CultureInfo.InvariantCulture);
        if (!fixedValue.Contains('.')) return fixedValue;
        return fixedValue.TrimEnd('0').TrimEnd('.');
    }

    public static double RoundTo(double value, int decimals = 3)
    {
        var factor = Math.Pow(10, decimals);
        return Math.Round(value * factor, MidpointRounding.AwayFromZero) / factor;
    }

    public static string FormatBytes(long bytes)
    {
        var value = (double)Math.Max(0, bytes);
        if (value < 1024) return $"{value:0} B";
        string[] units = ["KB", "MB", "GB", "TB"];
        var size = value / 1024;
        var unit = 0;
        while (size >= 1024 && unit < units.Length - 1)
        {
            size /= 1024;
            unit++;
        }
        return $"{FormatNumber(size, size >= 10 ? 0 : 1)} {units[unit]}";
    }
}
