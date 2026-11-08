using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Platform.Storage;

namespace Bulkut.Ui;

/// <summary>Progress of one file being copied into the app (content:// URIs on Android).</summary>
public sealed record ImportProgress(string FileName, int Index, int Count, double Ratio);

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
    /// <param name="progress">
    /// Reports the file being copied and its percentage. Android copies every
    /// picked URI into the app cache, which can take a while for long videos.
    /// </param>
    public static async Task<IReadOnlyList<string>> PickVideosAsync(
        Visual visual,
        bool multiple,
        Action<string>? onImportError = null,
        IProgress<ImportProgress>? progress = null)
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
        for (var index = 0; index < files.Count; index++)
        {
            var path = await LocalPathAsync(files[index], onImportError, progress, index, files.Count);
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
    private static async Task<string?> LocalPathAsync(
        IStorageFile file,
        Action<string>? onImportError,
        IProgress<ImportProgress>? progress,
        int index,
        int count)
    {
        var local = file.TryGetLocalPath();
        if (!string.IsNullOrWhiteSpace(local)) return local;

        // One folder per import keeps the original file name, which the list
        // displays and the output name is built from.
        var folder = Path.Combine(Path.GetTempPath(), "bulkut-input", Guid.NewGuid().ToString("N")[..8]);
        var target = Path.Combine(folder, Sanitize(file.Name));

        long total = 0;
        try
        {
            total = (long)((await file.GetBasicPropertiesAsync()).Size ?? 0);
        }
        catch (Exception)
        {
            // Some providers cannot answer; the copy still works without a total.
        }

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

                var buffer = new byte[CopyBufferSize];
                long copied = 0;
                var lastReport = -1000L;
                var clock = System.Diagnostics.Stopwatch.StartNew();

                int read;
                while ((read = await source.ReadAsync(buffer, 0, buffer.Length).ConfigureAwait(false)) > 0)
                {
                    await destination.WriteAsync(buffer, 0, read).ConfigureAwait(false);
                    copied += read;

                    if (progress is null) continue;
                    // Roughly one update every 80 ms keeps the bar moving
                    // without flooding the UI thread.
                    if (clock.ElapsedMilliseconds - lastReport < 80 && copied != total) continue;
                    lastReport = clock.ElapsedMilliseconds;
                    progress.Report(new ImportProgress(
                        file.Name,
                        index + 1,
                        count,
                        total > 0 ? Math.Clamp((double)copied / total, 0, 1) : 0));
                }

                progress?.Report(new ImportProgress(file.Name, index + 1, count, 1));
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
