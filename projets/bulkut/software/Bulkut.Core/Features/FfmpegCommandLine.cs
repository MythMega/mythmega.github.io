namespace Bulkut.Core.Features;

/// <summary>
/// Desktop FFmpeg takes an argument vector; FFmpegKit takes one command line.
/// Tokens are quoted only when they have to be, so paths with spaces and filter
/// graphs full of commas, brackets and semicolons arrive intact.
/// </summary>
public static class FfmpegCommandLine
{
    private static readonly char[] Safe =
        "-_.:/=+@".ToCharArray();

    public static string Build(IEnumerable<string> args) =>
        string.Join(' ', args.Select(Quote));

    public static string Quote(string value)
    {
        if (value.Length > 0 && value.All(character => char.IsLetterOrDigit(character) || Safe.Contains(character)))
            return value;

        return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
    }
}
