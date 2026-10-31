using System.Diagnostics;
using System.Text;
using Bulkut.Core.Features;
using Bulkut.Core.Models;

namespace Bulkut.Core.Services;

/// <summary>Saves rendered temp files with a unique name in the output folder.</summary>
public sealed class OutputService(SettingsStore settings, Action<string>? revealOverride = null)
{
    public string Folder => settings.OutputFolder;

    public RenderResult Save(
        string temporaryPath,
        string originalName,
        string? suffix,
        double duration,
        IReadOnlyList<Segment>? segments = null)
    {
        Directory.CreateDirectory(Folder);
        var fileName = Naming.BuildOutputName(originalName, suffix);
        var destination = Naming.UniquePath(Folder, fileName);
        Move(temporaryPath, destination);
        return new RenderResult(destination, Path.GetFileName(destination), duration, segments);
    }

    /// <summary>Writes a text artifact (an editor timeline) next to the rendered videos.</summary>
    public RenderResult SaveText(
        string content,
        string originalName,
        string? suffix,
        string extension,
        double duration,
        IReadOnlyList<Segment>? segments = null)
    {
        Directory.CreateDirectory(Folder);
        var fileName = Naming.BuildOutputName(originalName, suffix, extension);
        var destination = Naming.UniquePath(Folder, fileName);
        File.WriteAllText(destination, content, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
        return new RenderResult(destination, Path.GetFileName(destination), duration, segments);
    }

    public void Reveal(string path)
    {
        if (revealOverride is not null)
        {
            revealOverride(path);
            return;
        }

        try
        {
            if (OperatingSystem.IsWindows())
            {
                Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{path}\"") { UseShellExecute = true });
            }
            else if (OperatingSystem.IsMacOS())
            {
                Process.Start(new ProcessStartInfo("open", ["-R", path]) { UseShellExecute = false });
            }
            else
            {
                var folder = Path.GetDirectoryName(path) ?? Folder;
                Process.Start(new ProcessStartInfo("xdg-open", [folder]) { UseShellExecute = false });
            }
        }
        catch (Exception exception) when (exception is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            // Opening the file manager is a convenience; ignore failures.
        }
    }

    private static void Move(string source, string destination)
    {
        try
        {
            File.Move(source, destination, true);
        }
        catch (IOException)
        {
            // Temp and output can live on different volumes.
            File.Copy(source, destination, true);
            File.Delete(source);
        }
    }
}
