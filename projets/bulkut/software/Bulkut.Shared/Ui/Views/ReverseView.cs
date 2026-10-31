using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Bulkut.Core.Features;
using Bulkut.Core.Models;
using Bulkut.Core.Services;
using Bulkut.Ui.Widgets;

namespace Bulkut.Ui.Views;

/// <summary>One video, reversed video and audio, with a warning for long clips.</summary>
public sealed class ReverseView : FeatureView
{
    private readonly SuffixField _suffix;
    private readonly FadeField _fade;
    private readonly Button _run;
    private readonly Button _stop;
    private readonly DropZone _drop;
    private readonly StackPanel _stage = new() { Spacing = 10 };
    private readonly ProgressBar _bar = Ui.Progress();
    private readonly TextBlock _status;
    private readonly TextBlock _eta;
    private readonly TextBlock _percent;
    private readonly StackPanel _job;

    private string? _path;
    private string _name = "";
    private long _size;
    private MediaInfo? _info;
    private double _duration;
    private JobPhase _phase = JobPhase.Idle;
    private double _progress;
    private double _etaSeconds;
    private string _error = "";
    private CancellationTokenSource? _cts;

    public ReverseView(AppServices services) : base(services)
    {
        _suffix = new SuffixField(Loc, services.Settings.Params.Reverse.Suffix, value =>
        {
            services.Settings.Params.Reverse.Suffix = value;
            services.Save();
        });

        _fade = new FadeField(Loc, services.Settings.Params.Reverse.Fade, services.Settings.Config.Fade, services.Toasts, services.Save);

        _run = new Button { Classes = { "primary" }, HorizontalAlignment = HorizontalAlignment.Stretch, IsEnabled = false };
        Loc.BindButton(_run, "reverse.run");
        _run.Click += async (_, _) => await RenderAsync();

        _stop = new Button { Classes = { "danger" }, HorizontalAlignment = HorizontalAlignment.Stretch, IsVisible = false };
        Loc.BindButton(_stop, "common.stop");
        _stop.Click += (_, _) => _cts?.Cancel();

        var presets = new PresetPanel(
            Loc,
            services,
            "reverse",
            "nav.reverse",
            () =>
            {
                var numbers = new Dictionary<string, double>();
                Fades.ToPreset(services.Settings.Params.Reverse.Fade, numbers, new Dictionary<string, string>());
                return numbers;
            },
            () =>
            {
                var texts = new Dictionary<string, string> { ["suffix"] = services.Settings.Params.Reverse.Suffix };
                Fades.ToPreset(services.Settings.Params.Reverse.Fade, new Dictionary<string, double>(), texts);
                return texts;
            },
            (_, texts) =>
            [
                (Loc.T("common.suffix.label"), texts.GetValueOrDefault("suffix", "")),
                (Loc.T("fade.title"), Fades.PresetSummary(services.Settings.Params.Reverse.Fade)),
            ],
            preset => preset.Texts.GetValueOrDefault("suffix", "—"),
            preset =>
            {
                if (preset.Texts.TryGetValue("suffix", out var suffix))
                {
                    services.Settings.Params.Reverse.Suffix = Naming.SanitizeSuffix(suffix);
                    _suffix.SetValue(services.Settings.Params.Reverse.Suffix);
                }
                Fades.FromPreset(preset, services.Settings.Params.Reverse.Fade, services.Settings.Config.Fade);
                _fade.Refresh();
                services.Save();
            });

        var settingsStack = Ui.VStack(12);
        settingsStack.Children.Add(Loc.Text("reverse.settings.title", "h2"));
        settingsStack.Children.Add(Loc.Text("reverse.settings.hint", "muted"));
        settingsStack.Children.Add(_suffix);
        settingsStack.Children.Add(_fade);
        settingsStack.Children.Add(presets);
        settingsStack.Children.Add(_run);
        settingsStack.Children.Add(_stop);
        settingsStack.Children.Add(Ui.Text(Loc.T("reverse.warning"), "muted", 11));
        settingsStack.Children.Add(Ui.Text(Loc.T("common.oneAtATime"), "muted", 11));
        var settings = new Border { Classes = { "card" }, Child = settingsStack };

        _drop = new DropZone(Loc, false, async paths => await LoadAsync(paths[0]), "common.dropFileTitle");
        _status = Ui.Text("", "muted", 11.5);
        _eta = Ui.Text("", "muted", 11);
        _percent = Ui.Text("", "muted", 11);
        _job = Ui.VStack(6);
        _job.IsVisible = false;
        var statusRight = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        statusRight.Children.Add(_eta);
        statusRight.Children.Add(_percent);
        var statusRow = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto") };
        statusRow.Children.Add(_status);
        Grid.SetColumn(statusRight, 1);
        statusRow.Children.Add(statusRight);
        _job.Children.Add(statusRow);
        _job.Children.Add(_bar);
        _stage.Children.Add(_job);

        var titleStack = Ui.VStack(2);
        titleStack.Children.Add(Loc.Text("reverse.list.title", "h2"));
        titleStack.Children.Add(Loc.Text("reverse.list.hint", "muted"));
        var listStack = Ui.VStack(12);
        listStack.Children.Add(titleStack);
        listStack.Children.Add(_drop);
        listStack.Children.Add(_stage);
        Content = Ui.TwoColumns(settings, new Border { Classes = { "card" }, Child = listStack });
        Sync();
    }

    public override void RefreshLanguage()
    {
        base.RefreshLanguage();
        Sync();
    }

    private bool IsBusy => _phase is JobPhase.Preparing or JobPhase.Analyzing or JobPhase.Rendering;

    private async Task LoadAsync(string path)
    {
        if (IsBusy) return;
        if (!File.Exists(path) || !Naming.IsVideoExtension(path))
        {
            Services.Toasts.Error(Loc.T("errors.notVideo", ("name", Path.GetFileName(path))));
            return;
        }

        _path = path;
        _name = Path.GetFileName(path);
        _size = new FileInfo(path).Length;
        _info = null;
        _duration = 0;
        _phase = JobPhase.Preparing;
        _progress = 0;
        _error = "";
        Sync();

        try
        {
            _info = await Services.Engine.ProbeAsync(path, CancellationToken.None);
            _duration = _info.Duration;
            _phase = JobPhase.Idle;
            RebuildStage();
            Sync();
        }
        catch (Exception exception)
        {
            _phase = JobPhase.Error;
            _error = Ui.DescribeError(exception, Services.I18n);
            Services.Toasts.Error(_error);
            Sync();
        }
    }

    private void RebuildStage()
    {
        while (_stage.Children.Count > 1) _stage.Children.RemoveAt(0);

        var remove = Ui.IconButton("M4 7h16 M9 7V4h6v3 M6 7l1 14h10l1-14 M10 11v6 M14 11v6",
            Loc.T("common.remove"), RemoveFile, danger: true);
        remove.IsEnabled = !IsBusy;

        var strip = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*,Auto") };
        strip.Children.Add(new Border
        {
            Width = 36,
            Height = 36,
            CornerRadius = new CornerRadius(10),
            Background = new SolidColorBrush(Color.Parse("#E7EFFF")),
            Child = Ui.Icon("M3 7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7Z M10 9.5l5 2.5-5 2.5v-5Z", 18),
        });
        var info = Ui.VStack(3);
        info.Margin = new Thickness(10, 0, 8, 0);
        var name = Ui.Text(_name, "h3");
        name.TextTrimming = TextTrimming.CharacterEllipsis;
        info.Children.Add(name);
        info.Children.Add(Ui.Text(
            _duration > 0 ? $"{Timecode.FormatDuration(_duration)} · {Timecode.FormatBytes(_size)}" : Timecode.FormatBytes(_size),
            "muted",
            11.5));
        Grid.SetColumn(info, 1);
        strip.Children.Add(info);
        Grid.SetColumn(remove, 2);
        strip.Children.Add(remove);
        _stage.Children.Insert(0, new Border { Classes = { "inset" }, Child = strip });

        if (_duration > Services.Processing.ReverseWarningSeconds)
        {
            var warning = new Border
            {
                Classes = { "inset" },
                Background = new SolidColorBrush(Color.Parse("#FFF8E8")),
                Child = Ui.Text(Loc.T("reverse.longWarning", ("duration", Timecode.FormatDuration(_duration))), "muted", 11.5),
            };
            _stage.Children.Insert(1, warning);
        }
    }

    private void RemoveFile()
    {
        if (IsBusy) return;
        _path = null;
        _name = "";
        _size = 0;
        _info = null;
        _duration = 0;
        _phase = JobPhase.Idle;
        _progress = 0;
        _error = "";
        while (_stage.Children.Count > 1) _stage.Children.RemoveAt(0);
        Sync();
    }

    private void Sync()
    {
        _drop.IsVisible = _path is null;
        _stage.IsVisible = _path is not null;
        var visible = _phase is JobPhase.Preparing or JobPhase.Analyzing or JobPhase.Rendering or JobPhase.Done or JobPhase.Error;
        _job.IsVisible = visible;
        _bar.Value = Math.Clamp(_progress, 0, 1);
        _bar.IsVisible = IsBusy;
        _eta.Text = IsBusy && _etaSeconds > 0 ? Loc.T("common.eta", ("time", Timecode.FormatEta(_etaSeconds))) : "";
        _percent.Text = IsBusy ? $"{(int)Math.Round(_progress * 100)}%" : _phase == JobPhase.Done ? "100%" : "";
        _status.Text = _phase switch
        {
            JobPhase.Preparing => Loc.T("common.preparing"),
            JobPhase.Analyzing => Loc.T("common.analyzing"),
            JobPhase.Rendering => Loc.T("common.rendering"),
            JobPhase.Done => Loc.T("common.done"),
            JobPhase.Error => _error,
            _ => "",
        };
        _status.Foreground = _phase == JobPhase.Error ? Ui.DangerBrush : Ui.MutedBrush;
        _run.IsEnabled = _path is not null && _info is not null && !IsBusy;
        _stop.IsVisible = IsBusy;
    }

    private async Task RenderAsync()
    {
        if (_path is null || _info is null || IsBusy) return;
        var cts = new CancellationTokenSource();
        _cts = cts;
        _phase = JobPhase.Preparing;
        _progress = 0;
        _etaSeconds = 0;
        _error = "";
        Sync();

        try
        {
            var result = await Services.Engine.RenderReverseAsync(
                _path,
                _info,
                Services.Settings.Params.Reverse.Suffix,
                Services.Settings.Params.Reverse.Fade,
                new Progress<JobProgress>(progress =>
                {
                    if (progress.Phase == JobPhase.Done) return;
                    _phase = progress.Phase;
                    _progress = progress.Ratio;
                    _etaSeconds = progress.EtaSeconds;
                    Sync();
                }),
                cts.Token);

            _phase = JobPhase.Done;
            _progress = 1;
            _etaSeconds = 0;
            Services.Toasts.Show(new ToastMessage(
                Loc.T("desktop.savedTo", ("name", result.FileName), ("folder", Services.Output.Folder)),
                ToastKind.Success,
                () => Services.Output.Reveal(result.OutputPath),
                Loc.T("desktop.reveal")));
        }
        catch (Exception exception) when (exception is OperationCanceledException || exception is AppException { Code: AppErrorCodes.Cancelled })
        {
            _phase = JobPhase.Idle;
            _progress = 0;
        }
        catch (Exception exception)
        {
            _phase = JobPhase.Error;
            _progress = 0;
            _error = Ui.DescribeError(exception, Services.I18n);
            Services.Toasts.Error(_error);
        }
        finally
        {
            _cts = null;
            cts.Dispose();
            Sync();
        }
    }
}
