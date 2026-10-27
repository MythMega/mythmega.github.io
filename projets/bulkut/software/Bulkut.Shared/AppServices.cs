using Bulkut.Core.Models;
using Bulkut.Core.Services;

namespace Bulkut;

/// <summary>
/// Locations and actions a head has to provide. Desktop keeps everything in the
/// OS application-data folder; Android can only write to its own sandbox, so it
/// passes the paths it owns.
/// </summary>
public sealed record PlatformOptions(
    string? StateDirectory = null,
    string? OutputFolder = null,
    Action<string>? OpenOutput = null,
    IFfmpegRunner? Runner = null);

/// <summary>Everything the views need, created once at startup.</summary>
public sealed class AppServices
{
    public AppServices(PlatformOptions? platform = null)
    {
        Assets = new AppAssets();
        Settings = new SettingsStore(Assets, platform?.StateDirectory);
        I18n = new TranslationService(Assets, Settings.Config.App.Languages, Settings.State.Language);
        Ffmpeg = platform?.Runner is null
            ? new FfmpegService(Settings.Desktop)
            : new FfmpegService(platform.Runner);
        Presets = new PresetStore(Settings);
        Output = new OutputService(Settings, platform?.OpenOutput);
        Engine = new RenderEngine(Settings, Ffmpeg, Output);
        Toasts = new ToastService();

        // A mobile head has exactly one writable output folder, so it wins over
        // whatever an older state file remembered.
        if (!string.IsNullOrWhiteSpace(platform?.OutputFolder))
        {
            Settings.State.OutputFolder = platform.OutputFolder;
            Directory.CreateDirectory(platform.OutputFolder);
        }
    }

    public AppAssets Assets { get; }
    public SettingsStore Settings { get; }
    public TranslationService I18n { get; }
    public FfmpegService Ffmpeg { get; }
    public PresetStore Presets { get; }
    public OutputService Output { get; }
    public RenderEngine Engine { get; }
    public ToastService Toasts { get; }

    public AutocutParameters Autocut => Settings.Params.Autocut;
    public ProcessingOptions Processing => Settings.Processing;

    public void Save()
    {
        Settings.State.Language = I18n.Language;
        Settings.Save();
    }

    public string OutputFolder => Settings.OutputFolder;

    public void SetOutputFolder(string folder)
    {
        Settings.State.OutputFolder = folder;
        Settings.Save();
    }
}

public enum ToastKind
{
    Info,
    Success,
    Error,
}

public sealed record ToastMessage(string Message, ToastKind Kind, Action? Action = null, string? ActionLabel = null);

public sealed class ToastService
{
    public event Action<ToastMessage>? Shown;

    public void Info(string message) => Shown?.Invoke(new ToastMessage(message, ToastKind.Info));
    public void Success(string message) => Shown?.Invoke(new ToastMessage(message, ToastKind.Success));
    public void Error(string message) => Shown?.Invoke(new ToastMessage(message, ToastKind.Error));
    public void Show(ToastMessage message) => Shown?.Invoke(message);
}
