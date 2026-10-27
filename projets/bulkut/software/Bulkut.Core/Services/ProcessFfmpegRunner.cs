using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using Bulkut.Core.Features;
using Bulkut.Core.Models;

namespace Bulkut.Core.Services;

/// <summary>
/// Desktop FFmpeg: finds or downloads a native binary, then pipes one command at
/// a time into it. Reading <c>-progress pipe:1</c> keeps the progress bar honest
/// even on very long files.
/// </summary>
public sealed class ProcessFfmpegRunner : IFfmpegRunner
{
    private const string EmbeddedResource = "Bulkut.Core.Assets.ffmpeg.bin";
    private static readonly HttpClient HttpClient = new() { Timeout = TimeSpan.FromMinutes(10) };

    private readonly DesktopOptions _desktop;
    private readonly SemaphoreSlim _initGate = new(1, 1);
    private string _installDirectory;

    public ProcessFfmpegRunner(DesktopOptions desktop, string? baseDirectory = null)
    {
        _desktop = desktop;
        _installDirectory = Path.Combine(baseDirectory ?? AppContext.BaseDirectory, "ffmpeg");
    }

    public event Action<EngineStatus>? StatusChanged;

    public string? ExecutablePath { get; private set; }

    public bool IsAvailable => !string.IsNullOrWhiteSpace(ExecutablePath) && File.Exists(ExecutablePath);

    public string Location => _installDirectory;

    public async Task PrepareAsync(IProgress<EngineStatus>? progress, CancellationToken cancellationToken)
    {
        if (IsAvailable) return;

        await _initGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (IsAvailable) return;
            Report(EngineState.Checking, "checking", 0, progress);

            var existing = FindExistingBinary();
            if (existing is not null && await VerifyAsync(existing, cancellationToken).ConfigureAwait(false))
            {
                SetExecutable(existing, progress);
                return;
            }

            EnsureInstallDirectory();
            var target = Path.Combine(_installDirectory, BinaryName);

            if (!File.Exists(target) && EmbeddedAssemblyHasFfmpeg())
            {
                Report(EngineState.Downloading, "extracting", 0.35, progress);
                await ExtractEmbeddedAsync(target, cancellationToken).ConfigureAwait(false);
            }

            if (!File.Exists(target))
            {
                var url = DownloadUrl();
                if (string.IsNullOrWhiteSpace(url))
                    throw new AppException(AppErrorCodes.FfmpegUnavailable, "no download URL for this platform");

                await DownloadAsync(url, target, progress, cancellationToken).ConfigureAwait(false);
            }

            if (!await VerifyAsync(target, cancellationToken).ConfigureAwait(false))
            {
                TryDelete(target);
                throw new AppException(AppErrorCodes.FfmpegUnavailable, "the downloaded FFmpeg binary could not be started");
            }

            SetExecutable(target, progress);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            ExecutablePath = null;
            StatusChanged?.Invoke(new EngineStatus(EngineState.Failed, exception.Message));
            throw;
        }
        finally
        {
            _initGate.Release();
        }
    }

    public async Task<FfmpegResult> ExecuteAsync(
        IReadOnlyList<string> args,
        double outputDuration,
        IProgress<RenderProgress>? progress,
        CancellationToken cancellationToken)
    {
        var executable = ExecutablePath ?? throw new AppException(AppErrorCodes.FfmpegUnavailable);
        var startInfo = new ProcessStartInfo
        {
            FileName = executable,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };

        startInfo.ArgumentList.Add("-nostats");
        startInfo.ArgumentList.Add("-progress");
        startInfo.ArgumentList.Add("pipe:1");
        foreach (var arg in args) startInfo.ArgumentList.Add(arg);

        using var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        var logs = new List<string>();
        var parser = new FfmpegProgressParser(outputDuration);
        var lastReport = Stopwatch.StartNew();
        var progressLock = new object();

        void ReportFromLine(string line)
        {
            if (progress is null) return;
            var snapshot = parser.Feed(line);
            if (snapshot is null) return;

            lock (progressLock)
            {
                if (lastReport.ElapsedMilliseconds < 120 && snapshot.Ratio < 0.999) return;
                lastReport.Restart();
            }
            progress.Report(snapshot);
        }

        process.OutputDataReceived += (_, eventArgs) =>
        {
            if (eventArgs.Data is null) return;
            ReportFromLine(eventArgs.Data);
        };

        process.ErrorDataReceived += (_, eventArgs) =>
        {
            if (eventArgs.Data is null) return;
            lock (logs)
            {
                logs.Add(eventArgs.Data);
                if (logs.Count > 20_000) logs.RemoveRange(0, logs.Count - 20_000);
            }
            ReportFromLine(eventArgs.Data);
        };

        try
        {
            if (!process.Start()) throw new AppException(AppErrorCodes.FfmpegUnavailable);
        }
        catch (Exception exception) when (exception is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            throw new AppException(AppErrorCodes.FfmpegUnavailable, exception.Message);
        }

        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        try
        {
            await process.WaitForExitAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            TryKill(process);
            throw new AppException(AppErrorCodes.Cancelled);
        }
        finally
        {
            if (!process.HasExited) TryKill(process);
        }

        // Flush asynchronous readers.
        try
        {
            process.WaitForExit();
        }
        catch (InvalidOperationException)
        {
        }

        return new FfmpegResult(process.ExitCode, logs, null);
    }

    /// <summary>
    /// Prefers a portable ./ffmpeg folder next to the executable. When that
    /// folder is read-only (Program Files, a read-only mounted volume), falls
    /// back to the per-user application data folder.
    /// </summary>
    private void EnsureInstallDirectory()
    {
        try
        {
            Directory.CreateDirectory(_installDirectory);
            var probe = Path.Combine(_installDirectory, ".write-test");
            File.WriteAllText(probe, "ok");
            File.Delete(probe);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            _installDirectory = Path.Combine(local, "Bulkut", "ffmpeg");
            Directory.CreateDirectory(_installDirectory);
        }
    }

    private string? FindExistingBinary()
    {
        var env = Environment.GetEnvironmentVariable("BULKUT_FFMPEG");
        var candidates = new[]
        {
            env,
            Path.Combine(_installDirectory, BinaryName),
            Path.Combine(AppContext.BaseDirectory, BinaryName),
            Path.Combine(Environment.CurrentDirectory, "ffmpeg", BinaryName),
            Path.Combine(Environment.CurrentDirectory, "ffmpeg.bin"),
        };

        return candidates.FirstOrDefault(path => !string.IsNullOrWhiteSpace(path) && File.Exists(path));
    }

    private async Task<bool> VerifyAsync(string path, CancellationToken cancellationToken)
    {
        try
        {
            var startInfo = new ProcessStartInfo
            {
                FileName = path,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            startInfo.ArgumentList.Add("-version");

            using var process = Process.Start(startInfo);
            if (process is null) return false;
            var output = process.StandardOutput.ReadToEnd() + process.StandardError.ReadToEnd();
            await process.WaitForExitAsync(cancellationToken).ConfigureAwait(false);
            return process.ExitCode == 0 && output.Contains("ffmpeg version", StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception exception) when (exception is System.ComponentModel.Win32Exception or InvalidOperationException or IOException)
        {
            return false;
        }
    }

    private static bool EmbeddedAssemblyHasFfmpeg()
    {
        using var stream = typeof(ProcessFfmpegRunner).Assembly.GetManifestResourceStream(EmbeddedResource);
        return stream is not null;
    }

    private async Task ExtractEmbeddedAsync(string target, CancellationToken cancellationToken)
    {
        await using var resource = typeof(ProcessFfmpegRunner).Assembly.GetManifestResourceStream(EmbeddedResource)
                                  ?? throw new AppException(AppErrorCodes.FfmpegUnavailable, "no embedded binary");
        var temp = target + ".tmp";
        await using (var file = File.Create(temp))
        {
            await resource.CopyToAsync(file, cancellationToken).ConfigureAwait(false);
        }

        File.Move(temp, target, true);
        MakeExecutable(target);
    }

    private async Task DownloadAsync(
        string url,
        string target,
        IProgress<EngineStatus>? progress,
        CancellationToken cancellationToken)
    {
        Report(EngineState.Downloading, "downloading", 0, progress);
        var temp = target + ".download";
        try
        {
            using var response = await HttpClient.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, cancellationToken)
                .ConfigureAwait(false);
            response.EnsureSuccessStatusCode();

            var total = response.Content.Headers.ContentLength ?? 0;
            await using var source = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);

            // The file must be closed before the rename: Windows refuses to move
            // a handle that is still open.
            await using (var destination = File.Create(temp))
            {
                var buffer = new byte[1024 * 128];
                long read = 0;
                int count;
                var last = 0.0;
                while ((count = await source.ReadAsync(buffer, cancellationToken).ConfigureAwait(false)) > 0)
                {
                    await destination.WriteAsync(buffer.AsMemory(0, count), cancellationToken).ConfigureAwait(false);
                    read += count;
                    if (total <= 0) continue;
                    var ratio = (double)read / total;
                    if (ratio - last < 0.01) continue;
                    last = ratio;
                    Report(EngineState.Downloading, "downloading", ratio, progress);
                }

                await destination.FlushAsync(cancellationToken).ConfigureAwait(false);
            }

            File.Move(temp, target, true);
            MakeExecutable(target);
        }
        catch
        {
            TryDelete(temp);
            throw;
        }
    }

    private void SetExecutable(string path, IProgress<EngineStatus>? progress)
    {
        ExecutablePath = path;
        MakeExecutable(path);
        Report(EngineState.Ready, "ready", 1, progress);
    }

    private void Report(EngineState state, string message, double ratio, IProgress<EngineStatus>? progress)
    {
        var status = new EngineStatus(state, message, Math.Clamp(ratio, 0, 1));
        StatusChanged?.Invoke(status);
        progress?.Report(status);
    }

    private string DownloadUrl()
    {
        var key = RuntimeKey();
        return _desktop.Ffmpeg.Downloads.TryGetValue(key, out var url) ? url : "";
    }

    private static string RuntimeKey()
    {
        if (OperatingSystem.IsWindows()) return "win-x64";
        if (OperatingSystem.IsMacOS()) return RuntimeInformation.ProcessArchitecture == Architecture.Arm64 ? "osx-arm64" : "osx-x64";
        return RuntimeInformation.ProcessArchitecture == Architecture.Arm64 ? "linux-arm64" : "linux-x64";
    }

    private static string BinaryName => OperatingSystem.IsWindows() ? "ffmpeg.exe" : "ffmpeg";

    private static void MakeExecutable(string path)
    {
        if (OperatingSystem.IsWindows()) return;
        try
        {
            File.SetUnixFileMode(
                path,
                UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute |
                UnixFileMode.GroupRead | UnixFileMode.GroupExecute |
                UnixFileMode.OtherRead | UnixFileMode.OtherExecute);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or PlatformNotSupportedException)
        {
            // chmod is best effort; the binary may still be executable.
        }
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch (IOException)
        {
        }
    }

    private static void TryKill(Process process)
    {
        try
        {
            if (!process.HasExited) process.Kill(true);
        }
        catch (InvalidOperationException)
        {
        }
        catch (System.ComponentModel.Win32Exception)
        {
        }
    }
}
