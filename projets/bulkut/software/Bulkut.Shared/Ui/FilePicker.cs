using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Platform.Storage;

namespace Bulkut.Ui;

public static class FilePicker
{
    private static readonly FilePickerFileType VideoType = new("Videos")
    {
        Patterns =
        [
            "*.mp4", "*.m4v", "*.mov", "*.webm", "*.mkv", "*.avi", "*.ogv", "*.ogg",
            "*.mpg", "*.mpeg", "*.3gp", "*.3g2", "*.ts", "*.mts", "*.m2ts", "*.flv", "*.wmv",
        ],
        MimeTypes = ["video/*"],
        AppleUniformTypeIdentifiers = ["public.movie"],
    };

    public static async Task<IReadOnlyList<string>> PickVideosAsync(Visual visual, bool multiple)
    {
        var top = TopLevel.GetTopLevel(visual);
        if (top is null) return [];

        var files = await top.StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions
        {
            AllowMultiple = multiple,
            Title = "Bulkut",
            FileTypeFilter = [VideoType],
        });

        var paths = new List<string>(files.Count);
        foreach (var file in files)
        {
            var path = await LocalPathAsync(file);
            if (!string.IsNullOrWhiteSpace(path)) paths.Add(path!);
        }

        return paths;
    }

    /// <summary>Dropped files that are real local paths; remote drops are ignored.</summary>
    public static IReadOnlyList<string> LocalPaths(IDataTransfer data)
    {
        try
        {
            var files = data.TryGetFiles();
            if (files is null) return [];

            return files
                .Select(item => item.TryGetLocalPath())
                .Where(path => !string.IsNullOrWhiteSpace(path))
                .Select(path => path!)
                .ToList();
        }
        catch (Exception exception) when (exception is InvalidOperationException or NotSupportedException)
        {
            return [];
        }
    }

    /// <summary>
    /// Desktop pickers hand back a real path. Android hands back a <c>content://</c>
    /// URI that FFmpeg cannot open, so it is copied into the app cache first.
    /// </summary>
    private static async Task<string?> LocalPathAsync(IStorageFile file)
    {
        var local = file.TryGetLocalPath();
        if (!string.IsNullOrWhiteSpace(local)) return local;

        try
        {
            // One folder per import keeps the original file name, which the list
            // displays and the output name is built from.
            var folder = Path.Combine(Path.GetTempPath(), "bulkut-input", Guid.NewGuid().ToString("N")[..8]);
            Directory.CreateDirectory(folder);
            var target = Path.Combine(folder, Sanitize(file.Name));

            await using var source = await file.OpenReadAsync();
            await using var destination = File.Create(target);
            await source.CopyToAsync(destination);
            return target;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or NotSupportedException)
        {
            return null;
        }
    }

    private static string Sanitize(string name)
    {
        var cleaned = string.Concat(name.Select(character => Path.GetInvalidFileNameChars().Contains(character) ? '_' : character));
        return string.IsNullOrWhiteSpace(cleaned) ? "video.mp4" : cleaned;
    }
}
