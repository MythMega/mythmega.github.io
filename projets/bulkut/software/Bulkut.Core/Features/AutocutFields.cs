using Bulkut.Core.Models;

namespace Bulkut.Core.Features;

public sealed record AutocutFieldSpec(
    string Key,
    string Label,
    string Unit,
    int Decimals,
    double Min,
    double Max,
    double Step);

public static class AutocutFields
{
    public static IReadOnlyList<AutocutFieldSpec> Specs(WebConfig config)
    {
        var specs = new List<AutocutFieldSpec>
        {
            new("thresholdDb", "threshold", "dB", 0, -60, -5, 1),
            new("preCut", "precut", "s", 2, 0, 2, 0.05),
            new("postCut", "postcut", "s", 2, 0, 2, 0.05),
            new("minClipDuration", "minClip", "s", 2, 0, 10, 0.05),
        };

        return specs.Select(spec =>
        {
            if (!config.Autocut.Fields.TryGetValue(spec.Key, out var bounds)) return spec;
            return spec with
            {
                Min = double.IsFinite(bounds.Min) ? bounds.Min : spec.Min,
                Max = double.IsFinite(bounds.Max) ? bounds.Max : spec.Max,
                Step = double.IsFinite(bounds.Step) && bounds.Step > 0 ? bounds.Step : spec.Step,
            };
        }).ToList();
    }

    public static double ValueOf(AutocutParameters parameters, string key) => key switch
    {
        "thresholdDb" => parameters.ThresholdDb,
        "preCut" => parameters.PreCut,
        "postCut" => parameters.PostCut,
        "minClipDuration" => parameters.MinClipDuration,
        _ => 0,
    };

    public static void SetValue(AutocutParameters parameters, string key, double value)
    {
        switch (key)
        {
            case "thresholdDb": parameters.ThresholdDb = value; break;
            case "preCut": parameters.PreCut = value; break;
            case "postCut": parameters.PostCut = value; break;
            case "minClipDuration": parameters.MinClipDuration = value; break;
        }
    }

    public static string Summary(AutocutParameters parameters) =>
        string.Join(" · ", new[]
        {
            $"{Timecode.FormatNumber(parameters.ThresholdDb, 0)} dB",
            $"{Timecode.FormatNumber(parameters.PreCut, 2)} s",
            $"{Timecode.FormatNumber(parameters.PostCut, 2)} s",
            $"≥ {Timecode.FormatNumber(parameters.MinClipDuration, 2)} s",
        });
}
