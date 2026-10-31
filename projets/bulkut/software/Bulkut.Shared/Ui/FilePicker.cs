using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Platform.Storage;

namespace Bulkut.Ui;

public static class FilePicker
{
    private const int CopyBufferSize = 1024 * 1024;

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

    /// <param name="onImportError">
    /// Called with the file name when a platform URI cannot be copied locally.
    /// </param>
    public static async Task<IReadOnlyList<string>> PickVideosAsync(
        Visual visual,
        bool multiple,
        Action<string>? onImportError = null)
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
            var path = await LocalPathAsync(file, onImportError);
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
    private static async Task<string?> LocalPathAsync(IStorageFile file, Action<string>? onImportError)
    {
        var local = file.TryGetLocalPath();
        if (!string.IsNullOrWhiteSpace(local)) return local;

        // One folder per import keeps the original file name, which the list
        // displays and the output name is built from.
        var folder = Path.Combine(Path.GetTempPath(), "bulkut-input", Guid.NewGuid().ToString("N")[..8]);
        var target = Path.Combine(folder, Sanitize(file.Name));

        try
        {
            Directory.CreateDirectory(folder);

            // Avalonia reads the SAF stream through blocking JNI calls, so a
            // multi-hundred-megabyte copy on the UI thread froze the app (an
            // Android ANR a few seconds in). Everything happens on a worker.
            await Task.Run(async () =>
            {
                await using var source = await file.OpenReadAsync().ConfigureAwait(false);
                await using var destination = new FileStream(
                    target,
                    FileMode.Create,
                    FileAccess.Write,
                    FileShare.None,
                    CopyBufferSize,
                    useAsync: true);
                await source.CopyToAsync(destination, CopyBufferSize).ConfigureAwait(false);
            }).ConfigureAwait(false);

            return target;
        }
        catch (Exception)
        {
            // A revoked URI, a full cache or a provider that drops the stream
            // must not kill the whole batch: report the file and move on.
            TryDelete(folder, target);
            onImportError?.Invoke(file.Name);
            return null;
        }
    }

    private static void TryDelete(string folder, string target)
    {
        try
        {
            if (File.Exists(target)) File.Delete(target);
            if (Directory.Exists(folder)) Directory.Delete(folder, recursive: true);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            // Best effort: a leftover temporary file is harmless.
        }
    }

    private static string Sanitize(string name)
    {
        var cleaned = string.Concat(name.Select(character => Path.GetInvalidFileNameChars().Contains(character) ? '_' : character));
        return string.IsNullOrWhiteSpace(cleaned) ? "video.mp4" : cleaned;
    }
}
