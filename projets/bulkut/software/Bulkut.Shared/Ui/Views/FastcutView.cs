using System.Globalization;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Bulkut.Core.Features;
using Bulkut.Core.Models;
using Bulkut.Core.Services;
using Bulkut.Ui.Widgets;

namespace Bulkut.Ui.Views;

/// <summary>One video, a start/end range driven by both sliders and timecodes.</summary>
public sealed class FastcutView : FeatureView
{
    private readonly SuffixField _suffix;
    private readonly FadeField _fade;
    private readonly Button _run;
    private readonly Button _stop;
    private readonly StackPanel _stage = new() { Spacing = 10 };
    private readonly DropZone _drop;
    private readonly ProgressBar _bar = Ui.Progress();
    private readonly TextBlock _status;
    private readonly TextBlock _eta;
    private readonly TextBlock _percent;
    private readonly TextBlock _output;
    private readonly TextBlock _outputSub;
    private readonly CutRow _startRow;
    private readonly CutRow _endRow;
    private readonly StackPanel _jobPanel;
    private readonly Border _fileStripHost = new() { IsVisible = false };
    private CancellationTokenSource? _cts;

    private string? _path;
    private string _name = "";
    private long _size;
    private MediaInfo? _info;
    private double _duration;
    private double _start;
    private double _end;
    private JobPhase _phase = JobPhase.Idle;
    private double _progress;
    private double _etaSeconds;
    private string _error = "";

    public FastcutView(AppServices services) : base(services)
    {
        _suffix = new SuffixField(Loc, services.Settings.Params.Fastcut.Suffix, value =>
        {
            services.Settings.Params.Fastcut.Suffix = value;
            services.Save();
        });

        _fade = new FadeField(Loc, services.Settings.Params.Fastcut.Fade, services.Settings.Config.Fade, services.Toasts, services.Save);

        _run = new Button { Classes = { "primary" } };
        Loc.BindButton(_run, "fastcut.run");
        _run.HorizontalAlignment = HorizontalAlignment.Stretch;
        _run.IsEnabled = false;
        _run.Click += async (_, _) => await RenderAsync();

        _stop = new Button { Classes = { "danger" } };
        Loc.BindButton(_stop, "common.stop");
        _stop.HorizontalAlignment = HorizontalAlignment.Stretch;
        _stop.IsVisible = false;
        _stop.Click += (_, _) => _cts?.Cancel();

        var presets = new PresetPanel(
            Loc,
            services,
            "fastcut",
            "nav.fastcut",
            () =>
            {
                var numbers = new Dictionary<string, double>();
                Fades.ToPreset(services.Settings.Params.Fastcut.Fade, numbers, new Dictionary<string, string>());
                return numbers;
            },
            () =>
            {
                var texts = new Dictionary<string, string> { ["suffix"] = services.Settings.Params.Fastcut.Suffix };
                Fades.ToPreset(services.Settings.Params.Fastcut.Fade, new Dictionary<string, double>(), texts);
                return texts;
            },
            (_, texts) =>
            [
                (Loc.T("common.suffix.label"), texts.GetValueOrDefault("suffix", "")),
                (Loc.T("fade.title"), Fades.PresetSummary(services.Settings.Params.Fastcut.Fade)),
            ],
            preset => string.IsNullOrWhiteSpace(preset.Texts.GetValueOrDefault("suffix")) ? "—" : preset.Texts["suffix"],
            preset =>
            {
                if (preset.Texts.TryGetValue("suffix", out var suffix))
                {
                    services.Settings.Params.Fastcut.Suffix = Naming.SanitizeSuffix(suffix);
                    _suffix.SetValue(services.Settings.Params.Fastcut.Suffix);
                }
                Fades.FromPreset(preset, services.Settings.Params.Fastcut.Fade, services.Settings.Config.Fade);
                _fade.Refresh();
                services.Save();
            });

        var settingsStack = Ui.VStack(12);
        settingsStack.Children.Add(Loc.Text("fastcut.settings.title", "h2"));
        settingsStack.Children.Add(Loc.Text("fastcut.settings.hint", "muted"));
        settingsStack.Children.Add(_suffix);
        settingsStack.Children.Add(_fade);
        settingsStack.Children.Add(presets);
        settingsStack.Children.Add(_run);
        settingsStack.Children.Add(_stop);
        settingsStack.Children.Add(Ui.Text(Loc.T("common.oneAtATime"), "muted", 11));
        var settings = new Border { Classes = { "card" }, Child = settingsStack };

        _drop = new DropZone(Loc, false, async paths => await LoadAsync(paths[0]), "common.dropFileTitle");
        _output = Ui.Text("00:00:00", "mono", 22, FontWeight.Bold);
        _outputSub = Loc.Text("fastcut.outputHint", "muted");
        _status = Ui.Text("", "muted", 11.5);
        _eta = Ui.Text("", "muted", 11);
        _percent = Ui.Text("", "muted", 11);
        _jobPanel = Ui.VStack(6);
        _jobPanel.IsVisible = false;

        var statusRight = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        statusRight.Children.Add(_eta);
        statusRight.Children.Add(_percent);
        var statusRow = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto") };
        statusRow.Children.Add(_status);
        Grid.SetColumn(statusRight, 1);
        statusRow.Children.Add(statusRight);
        _jobPanel.Children.Add(statusRow);
        _jobPanel.Children.Add(_bar);

        _startRow = new CutRow(this, "start", seconds => SetStart(seconds, false), seconds => SetStart(seconds, true));
        _endRow = new CutRow(this, "end", seconds => SetEnd(seconds, false), seconds => SetEnd(seconds, true));

        var outputStack = Ui.VStack(1);
        outputStack.Children.Add(Loc.Text("fastcut.outputHint", "label"));
        outputStack.Children.Add(_output);
        outputStack.Children.Add(_outputSub);
        var outputBox = new Border { Classes = { "inset" }, Child = outputStack };

        _stage.Children.Add(_fileStripHost);
        _stage.Children.Add(_startRow.Root);
        _stage.Children.Add(_endRow.Root);
        _stage.Children.Add(outputBox);
        _stage.Children.Add(_jobPanel);

        var titleStack = Ui.VStack(2);
        titleStack.Children.Add(Loc.Text("fastcut.list.title", "h2"));
        titleStack.Children.Add(Loc.Text("fastcut.list.hint", "muted"));
        var listStack = Ui.VStack(12);
        listStack.Children.Add(titleStack);
        listStack.Children.Add(_drop);
        listStack.Children.Add(_stage);
        var list = new Border { Classes = { "card" }, Child = listStack };

        Content = Ui.TwoColumns(settings, list);

        _duration = 0;
        _start = 0;
        _end = 0;
        Sync();
    }

    public override void RefreshLanguage()
    {
        base.RefreshLanguage();
        Sync();
        _startRow.RefreshLabels();
        _endRow.RefreshLabels();
    }

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
            _start = 0;
            _end = Math.Max(1, Math.Floor(_duration));
            _phase = JobPhase.Idle;
            BuildFileStrip();
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

    private void BuildFileStrip()
    {
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
            _duration > 0 ? $"{Timecode.FormatTimecode(_duration)} · {Timecode.FormatBytes(_size)}" : Timecode.FormatBytes(_size),
            "muted",
            11.5));
        Grid.SetColumn(info, 1);
        strip.Children.Add(info);
        Grid.SetColumn(remove, 2);
        strip.Children.Add(remove);
        _fileStripHost.Child = new Border { Classes = { "inset" }, Child = strip };
        _fileStripHost.IsVisible = true;
    }

    private bool IsBusy => _phase is JobPhase.Preparing or JobPhase.Analyzing or JobPhase.Rendering;

    private void RemoveFile()
    {
        if (IsBusy) return;
        _cts?.Cancel();
        _path = null;
        _name = "";
        _size = 0;
        _info = null;
        _duration = 0;
        _start = 0;
        _end = 0;
        _phase = JobPhase.Idle;
        _progress = 0;
        _error = "";
        _fileStripHost.IsVisible = false;
        _fileStripHost.Child = null;
        Sync();
    }

    private void SetStart(double seconds, bool feedback)
    {
        if (_duration <= 0) return;
        var rounded = Math.Round(seconds);
        var clamped = Fastcut.ClampStart(seconds, _end, _duration);
        if (feedback && Math.Abs(clamped - rounded) > 0.01) Services.Toasts.Error(Loc.T("errors.startBeforeEnd"));
        _start = clamped;
        SyncRange();
    }

    private void SetEnd(double seconds, bool feedback)
    {
        if (_duration <= 0) return;
        var rounded = Math.Round(seconds);
        var clamped = Fastcut.ClampEnd(seconds, _start, _duration);
        if (feedback && Math.Abs(clamped - rounded) > 0.01) Services.Toasts.Error(Loc.T("errors.endAfterStart"));
        _end = clamped;
        SyncRange();
    }

    private void SyncRange()
    {
        _startRow.SetSeconds(_start, _duration, _phase is JobPhase.Preparing or JobPhase.Analyzing or JobPhase.Rendering);
        _endRow.SetSeconds(_end, _duration, _phase is JobPhase.Preparing or JobPhase.Analyzing or JobPhase.Rendering);
        var length = Fastcut.OutputLength(_start, _end);
        _output.Text = Timecode.FormatTimecode(length);
        _outputSub.Text = Loc.T("fastcut.lengthSeconds", ("seconds", Timecode.FormatNumber(length, 0)));
        _run.IsEnabled = _path is not null && _duration > 0 && !IsBusy && length >= 1;
    }

    private void Sync()
    {
        _drop.IsVisible = _path is null;
        _stage.IsVisible = _path is not null;
        _fileStripHost.IsVisible = _path is not null && _fileStripHost.Child is not null;
        SyncRange();

        var visible = _phase is JobPhase.Preparing or JobPhase.Analyzing or JobPhase.Rendering or JobPhase.Done or JobPhase.Error;
        _jobPanel.IsVisible = visible;
        _bar.Value = Math.Clamp(_progress, 0, 1);
        _bar.IsVisible = IsBusy;
        _eta.Text = IsBusy && _etaSeconds > 0 ? Loc.T("common.eta", ("time", Timecode.FormatEta(_etaSeconds))) : "";
        _percent.Text = IsBusy ? $"{(int)Math.Round(_progress * 100)}%" : _phase == JobPhase.Done ? "100%" : "";
        _status.Text = _phase switch
        {
            JobPhase.Preparing => Loc.T("common.preparing"),
            JobPhase.Analyzing => Loc.T("common.analyzing"),
            JobPhase.Rendering => Loc.T("common.rendering"),
            JobPhase.Done => Loc.T("fastcut.resultDone", ("name", _name)),
            JobPhase.Error => _error,
            _ => "",
        };
        _status.Foreground = _phase == JobPhase.Error ? Ui.DangerBrush : Ui.MutedBrush;
        _stop.IsVisible = IsBusy;
        _run.IsEnabled = _path is not null && _duration > 0 && !IsBusy && Fastcut.OutputLength(_start, _end) >= 1;

        if (_path is not null && _fileStripHost.Child is null && _phase != JobPhase.Preparing) BuildFileStrip();
    }

    private async Task RenderAsync()
    {
        if (_path is null || IsBusy || _duration <= 0) return;
        var length = Fastcut.OutputLength(_start, _end);
        if (length < 1) return;

        var cts = new CancellationTokenSource();
        _cts = cts;
        _phase = JobPhase.Preparing;
        _progress = 0;
        _etaSeconds = 0;
        _error = "";
        Sync();

        try
        {
            var result = await Services.Engine.RenderFastcutAsync(
                _path,
                _info,
                _start,
                _end,
                Services.Settings.Params.Fastcut.Suffix,
                Services.Settings.Params.Fastcut.Fade,
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
            _error = Ui.DescribeError(exception, Services.I18n);
            _progress = 0;
            Services.Toasts.Error(_error);
        }
        finally
        {
            _cts = null;
            cts.Dispose();
            Sync();
        }
    }

    private sealed class CutRow
    {
        private readonly FastcutView _owner;
        private readonly string _kind;
        private readonly Slider _slider;
        private readonly TextBox _hours;
        private readonly TextBox _minutes;
        private readonly TextBox _seconds;
        private readonly TextBlock _title;
        private readonly Action<double> _live;
        private readonly Action<double> _commit;
        private bool _sync;

        public CutRow(FastcutView owner, string kind, Action<double> live, Action<double> commit)
        {
            _owner = owner;
            _kind = kind;
            _live = live;
            _commit = commit;

            var stack = Ui.VStack(7);
            _title = Ui.Text(owner.Loc.T($"fastcut.{kind}"), "h3");
            stack.Children.Add(_title);

            _hours = TimeBox(99);
            _minutes = TimeBox(59);
            _seconds = TimeBox(59);
            var timecode = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 3, VerticalAlignment = VerticalAlignment.Center };
            timecode.Children.Add(TimePart(_hours, "common.hours"));
            timecode.Children.Add(Ui.Text(":", "h3"));
            timecode.Children.Add(TimePart(_minutes, "common.minutes"));
            timecode.Children.Add(Ui.Text(":", "h3"));
            timecode.Children.Add(TimePart(_seconds, "common.seconds"));
            stack.Children.Add(timecode);

            foreach (var box in new[] { _hours, _minutes, _seconds })
            {
                box.LostFocus += (_, _) => Commit();
                box.KeyDown += (_, args) =>
                {
                    if (args.Key is not (Key.Enter or Key.Return)) return;
                    Commit();
                    args.Handled = true;
                };
            }

            _slider = new Slider { Minimum = 0, Maximum = 100, Value = 0 };
            _slider.PropertyChanged += (_, args) =>
            {
                if (args.Property != Slider.ValueProperty || _sync) return;
                var seconds = _slider.Value / 100 * Math.Max(0, owner._duration);
                _live(seconds);
            };
            stack.Children.Add(_slider);

            Root = new Border { Classes = { "inset" }, Child = stack };
        }

        public Border Root { get; }

        public void RefreshLabels()
        {
            _title.Text = _owner.Loc.T($"fastcut.{_kind}");
        }

        public void SetSeconds(double seconds, double duration, bool disabled)
        {
            _sync = true;
            try
            {
                var (hours, minutes, secs) = Timecode.Split(seconds);
                _hours.Text = hours.ToString(CultureInfo.InvariantCulture);
                _minutes.Text = minutes.ToString(CultureInfo.InvariantCulture);
                _seconds.Text = secs.ToString(CultureInfo.InvariantCulture);
                _slider.Value = duration > 0 ? Math.Clamp(seconds / duration * 100, 0, 100) : 0;
                _slider.IsEnabled = !disabled;
                _hours.IsEnabled = !disabled;
                _minutes.IsEnabled = !disabled;
                _seconds.IsEnabled = !disabled;
            }
            finally
            {
                _sync = false;
            }
        }

        private void Commit()
        {
            if (_sync) return;
            if (!int.TryParse(_hours.Text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var hours) ||
                !int.TryParse(_minutes.Text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var minutes) ||
                !int.TryParse(_seconds.Text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var secs) ||
                hours is < 0 or > 99 || minutes is < 0 or > 59 || secs is < 0 or > 59)
            {
                _owner.Services.Toasts.Error(_owner.Loc.T("errors.timecode"));
                _owner.SyncRange();
                return;
            }

            _commit(Timecode.ToSeconds(hours, minutes, secs));
        }

        private static TextBox TimeBox(int max) => new()
        {
            Width = 48,
            Text = "0",
            MaxLength = 2,
            HorizontalContentAlignment = HorizontalAlignment.Center,
            Tag = max,
        };

        private Control TimePart(TextBox box, string labelKey)
        {
            var stack = Ui.VStack(1);
            stack.Children.Add(box);
            stack.Children.Add(Ui.Text(_owner.Loc.T(labelKey), "muted", 9.5));
            stack.HorizontalAlignment = HorizontalAlignment.Center;
            return stack;
        }
    }
}
