namespace Bulkut.Core.Features;

public enum EdgeMode
{
    Both,
    Intro,
    Outro,
}

public sealed record EdgeMedia(string Path, double Duration)
{
    public bool Exists => !string.IsNullOrWhiteSpace(Path);
}

public sealed record IntroOutroPlan(
    IReadOnlyList<string> Inputs,
    IReadOnlyList<double> Durations,
    double ExpectedDuration,
    bool UsesIntro,
    bool UsesOutro);

/// <summary>
/// Intro/outro planning: what edges are available, which combination a row uses,
/// the resulting input list and the expected duration. Pure.
/// </summary>
public static class IntroOutroPlanner
{
    public static IReadOnlyList<EdgeMode> AvailableModes(EdgeMedia? intro, EdgeMedia? outro)
    {
        var hasIntro = intro?.Exists == true;
        var hasOutro = outro?.Exists == true;
        if (hasIntro && hasOutro) return [EdgeMode.Both, EdgeMode.Intro, EdgeMode.Outro];
        if (hasIntro) return [EdgeMode.Intro];
        if (hasOutro) return [EdgeMode.Outro];
        return [];
    }

    /// <summary>Keeps the stored preference when possible; widens/narrows it to what exists.</summary>
    public static EdgeMode EffectiveMode(EdgeMode preferred, EdgeMedia? intro, EdgeMedia? outro)
    {
        var modes = AvailableModes(intro, outro);
        if (modes.Count == 0) return EdgeMode.Both;
        if (modes.Contains(preferred)) return preferred;
        if (modes.Contains(EdgeMode.Both)) return EdgeMode.Both;
        return modes[0];
    }

    public static bool IncludesIntro(EdgeMode mode, EdgeMedia? intro, EdgeMedia? outro) =>
        intro?.Exists == true && mode is EdgeMode.Both or EdgeMode.Intro;

    public static bool IncludesOutro(EdgeMode mode, EdgeMedia? intro, EdgeMedia? outro) =>
        outro?.Exists == true && mode is EdgeMode.Both or EdgeMode.Outro;

    public static double ExpectedDuration(double itemDuration, EdgeMode mode, EdgeMedia? intro, EdgeMedia? outro)
    {
        var total = Math.Max(0, itemDuration);
        if (IncludesIntro(mode, intro, outro)) total += Math.Max(0, intro!.Duration);
        if (IncludesOutro(mode, intro, outro)) total += Math.Max(0, outro!.Duration);
        return total;
    }

    public static IntroOutroPlan Plan(
        string itemPath,
        double itemDuration,
        EdgeMode mode,
        EdgeMedia? intro,
        EdgeMedia? outro)
    {
        var inputs = new List<string>();
        var durations = new List<double>();
        var usesIntro = IncludesIntro(mode, intro, outro);
        var usesOutro = IncludesOutro(mode, intro, outro);

        if (usesIntro)
        {
            inputs.Add(intro!.Path);
            durations.Add(intro.Duration);
        }
        inputs.Add(itemPath);
        durations.Add(itemDuration);
        if (usesOutro)
        {
            inputs.Add(outro!.Path);
            durations.Add(outro.Duration);
        }

        return new IntroOutroPlan(
            inputs,
            durations,
            ExpectedDuration(itemDuration, mode, intro, outro),
            usesIntro,
            usesOutro);
    }
}
