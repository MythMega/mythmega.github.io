using System.Text.RegularExpressions;

namespace Bulkut.Core.Features;

public static partial class Naming
{
    [GeneratedRegex(@"[\x00-\x1f<>:""/\\|?*]")]
    private static partial Regex InvalidCharsRegex();

    public static string SanitizeSuffix(string? value)
    {
        var clean = InvalidCharsRegex().Replace(value ?? "", "");
        clean = clean.TrimStart('.', ' ');
        clean = clean.TrimEnd('.', ' ');
        clean = Regex.Replace(clean, @"\s{2,}", " ");
        return clean.Length > 40 ? clean[..40] : clean;
    }

    public static string ExtensionOf(string? name)
    {
        var match = Regex.Match(name ?? "", @"\.([a-z0-9]{1,6})$", RegexOptions.IgnoreCase);
        return match.Success ? match.Groups[1].Value.ToLowerInvariant() : "mp4";
    }

    /// <summary><c>clip.mp4</c> + <c>-autocut</c> gives <c>clip-autocut.mp4</c>.</summary>
    public static string BuildOutputName(string? originalName, string? suffix, string extension = "mp4")
    {
        var name = string.IsNullOrWhiteSpace(originalName) ? "video" : originalName;
        var baseName = Regex.Replace(name, @"\.[^.]+$", "");
        baseName = InvalidCharsRegex().Replace(baseName, "-").Trim();
        if (baseName.Length == 0) baseName = "video";
        return $"{baseName}{SanitizeSuffix(suffix)}.{extension}";
    }

    /// <summary>Appends <c> (1)</c>, <c> (2)</c>… until the path is free.</summary>
    public static string UniquePath(string folder, string fileName)
    {
        var path = Path.Combine(folder, fileName);
        if (!File.Exists(path)) return path;

        var stem = Path.GetFileNameWithoutExtension(fileName);
        var extension = Path.GetExtension(fileName);
        for (var index = 1; index < 10_000; index++)
        {
            path = Path.Combine(folder, $"{stem} ({index}){extension}");
            if (!File.Exists(path)) return path;
        }

        return Path.Combine(folder, $"{stem}-{Guid.NewGuid():N}{extension}");
    }

    public static bool IsVideoExtension(string? path)
    {
        if (string.IsNullOrWhiteSpace(path) || !Path.HasExtension(path)) return false;
        var extension = ExtensionOf(path);
        return extension is "mp4" or "m4v" or "mov" or "webm" or "mkv" or "avi" or "ogv" or "ogg"
            or "mpg" or "mpeg" or "3gp" or "3g2" or "ts" or "mts" or "m2ts" or "flv" or "wmv";
    }

    public static string OutputFolder(string? configured)
    {
        if (!string.IsNullOrWhiteSpace(configured) && Directory.Exists(configured)) return configured;

        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var downloads = Path.Combine(home, "Downloads");
        if (Directory.Exists(downloads)) return downloads;

        var documents = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
        return Directory.Exists(documents) ? documents : home;
    }
}
