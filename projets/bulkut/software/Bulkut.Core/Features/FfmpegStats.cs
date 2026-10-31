using System.Diagnostics;
using System.Globalization;
using System.Text.RegularExpressions;
using Bulkut.Core.Models;

namespace Bulkut.Core.Features;

public sealed record StatsSample(double Seconds, double Speed, double Fps, double Frame);

public sealed class FfmpegProgressParser(double duration)
{
    private readonly double _duration = Math.Max(0, duration);
    private readonly Stopwatch _clock = Stopwatch.StartNew();
    private double _maxRatio;
    private double _smoothSpeed;
    private double _lastSeconds;
    private double _lastSpeed;
    private double _fps;
    private double _frame;

    public RenderProgress? Feed(string line)
    {
        if (line.StartsWith("out_time_us=", StringComparison.OrdinalIgnoreCase))
        {
            if (TryNumber(line[12..], out var micros)) _lastSeconds = micros / 1_000_000;
            return Snapshot();
        }

        if (line.StartsWith("out_time_ms=", StringComparison.OrdinalIgnoreCase))
        {
            // FFmpeg has historically written microseconds under this key too.
            if (TryNumber(line[12..], out var micros)) _lastSeconds = micros / 1_000_000;
            return Snapshot();
        }

        if (line.StartsWith("out_time=", StringComparison.OrdinalIgnoreCase))
        {
            var parsed = Timecode.ParseTimecode(line[9..].Trim());
            if (parsed is not null) _lastSeconds = parsed.Value;
            return Snapshot();
        }

        if (line.StartsWith("speed=", StringComparison.OrdinalIgnoreCase))
        {
            var raw = line[6..].Trim().TrimEnd('x');
            if (TryNumber(raw, out var speed)) _lastSpeed = speed;
            return null;
        }

        if (line.StartsWith("fps=", StringComparison.OrdinalIgnoreCase))
        {
            if (TryNumber(line[4..].Trim(), out var fps)) _fps = fps;
            return null;
        }

        if (line.StartsWith("frame=", StringComparison.OrdinalIgnoreCase))
        {
            if (TryNumber(line[6..].Trim(), out var frame)) _frame = frame;
            return null;
        }

        if (line.StartsWith("progress=", StringComparison.OrdinalIgnoreCase))
            return Snapshot();

        var sample = ParseStatsLine(line);
        if (sample is null) return null;

        _lastSeconds = sample.Seconds;
        _lastSpeed = sample.Speed;
        _fps = sample.Fps;
        _frame = sample.Frame;
        return Snapshot();
    }

    public RenderProgress Snapshot()
    {
        if (_duration <= 0) return new RenderProgress(0, 0, _lastSpeed, _lastSeconds);

        var rawRatio = Math.Clamp(_lastSeconds / _duration, 0, 1);
        _maxRatio = Math.Max(_maxRatio, rawRatio);
        _smoothSpeed = SmoothSpeed(_smoothSpeed, _lastSpeed);
        var eta = EstimateEtaSeconds(_lastSeconds, _duration, _maxRatio, _smoothSpeed, _clock.Elapsed.TotalMilliseconds);
        return new RenderProgress(_maxRatio, eta, _lastSpeed, _lastSeconds);
    }

    public static StatsSample? ParseStatsLine(string line)
    {
        // frame=  642 fps= 61 q=28.0 ... time=00:00:10.72 ... speed=1.02x
        var time = Regex.Match(line, @"\btime=\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)");
        if (!time.Success) return null;

        var seconds = int.Parse(time.Groups[1].Value, CultureInfo.InvariantCulture) * 3600
                      + int.Parse(time.Groups[2].Value, CultureInfo.InvariantCulture) * 60
                      + double.Parse(time.Groups[3].Value, CultureInfo.InvariantCulture);

        var speed = Regex.Match(line, @"\bspeed=\s*([\d.]+)\s*x");
        var fps = Regex.Match(line, @"\bfps=\s*([\d.]+)");
        var frame = Regex.Match(line, @"\bframe=\s*(\d+)");

        return new StatsSample(
            seconds,
            speed.Success && TryNumber(speed.Groups[1].Value, out var s) ? s : 0,
            fps.Success && TryNumber(fps.Groups[1].Value, out var f) ? f : 0,
            frame.Success && TryNumber(frame.Groups[1].Value, out var fr) ? fr : 0);
    }

    public static double SmoothSpeed(double previous, double next, double weight = 0.35)
    {
        if (!double.IsFinite(next) || next <= 0) return previous > 0 ? previous : 0;
        if (previous <= 0) return next;
        return previous * (1 - weight) + next * weight;
    }

    /// <summary>Blends FFmpeg's <c>speed=</c> with the elapsed/progress estimate.</summary>
    public static double EstimateEtaSeconds(
        double mediaSeconds,
        double duration,
        double ratio = 0,
        double speed = 0,
        double elapsedMs = 0)
    {
        var total = duration;
        var current = Math.Max(0, mediaSeconds);
        if (total <= 0 || current >= total) return 0;

        var remaining = total - current;
        var bySpeed = speed > 0 ? remaining / speed : 0;
        var byRatio = ratio >= 0.02 && elapsedMs > 700
            ? elapsedMs / 1000 * ((1 - ratio) / ratio)
            : 0;

        if (bySpeed > 0 && byRatio > 0) return Math.Round(bySpeed * 0.6 + byRatio * 0.4);
        return Math.Round(bySpeed > 0 ? bySpeed : byRatio);
    }

    private static bool TryNumber(string value, out double number) =>
        double.TryParse(value.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out number);
}
