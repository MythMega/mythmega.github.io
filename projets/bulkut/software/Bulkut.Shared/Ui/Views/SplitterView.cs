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

/// <summary>
/// One video split into any number of ranges. Every range is exported as its
/// own finished file, with the tab suffix and the final-file fades.
/// </summary>
public sealed class SplitterView : FeatureView
{
    private readonly SuffixField _suffix;
    private readonly FadeField _fade;
    private readonly Button _run;
    private readonly Button _stop;
    private readonly Button _add;
    private readonly DropZone _drop;
    private readonly StackPanel _stage = new() { Spacing = 10 };
    private readonly StackPanel _segments = new() { Spacing = 10 };
    private readonly Border _fileStripHost = new() { IsVisible = false };
    private readonly TextBlock _count;
    private readonly ProgressBar _bar = Ui.Progress();
    private readonly TextBlock _status;
    private readonly TextBlock _eta;
    private readonly TextBlock _percent;
    private readonly StackPanel _job;
    private readonly List<SegmentRow> _rows = [];

    private string? _path;
    private string _name = "";
    private long _size;
    private MediaInfo? _info;
    private double _duration;
    private JobPhase _phase = JobPhase.Idle;
    private double _progress;
    private double _etaSeconds;
    private string _error = "";
    private int _results;
    private CancellationTokenSource? _cts;

    public SplitterView(AppServices services) : base(services)
    {
        _suffix = new SuffixField(Loc, services.Settings.Params.Splitter.Suffix, value =>
        {
            services.Settings.Params.Splitter.Suffix = value;
            services.Save();
        });

        _fade = new FadeField(Loc, services.Settings.Params.Splitter.Fade, services.Settings.Config.Fade, services.Toasts, services.Save);

        _run = new Button { Classes = { "primary" }, HorizontalAlignment = HorizontalAlignment.Stretch, IsEnabled = false };
        Loc.BindButton(_run, "splitter.run");
        _run.Click += async (_, _) => await RenderAsync();

        _stop = new Button { Classes = { "danger" }, HorizontalAlignment = HorizontalAlignment.Stretch, IsVisible = false };
        Loc.BindButton(_stop, "common.stop");
        _stop.Click += (_, _) => _cts?.Cancel();

        var presets = new PresetPanel(
            Loc,
            services,
            "splitter",
            "nav.splitter",
            () =>
            {
                var numbers = new Dictionary<string, double>();
                Fades.ToPreset(services.Settings.Params.Splitter.Fade, numbers, new Dictionary<string, string>());
                return numbers;
            },
            () =>
            {
                var texts = new Dictionary<string, string> { ["suffix"] = services.Settings.Params.Splitter.Suffix };
                Fades.ToPreset(services.Settings.Params.Splitter.Fade, new Dictionary<string, double>(), texts);
                return texts;
            },
            (_, texts) =>
            [
                (Loc.T("common.suffix.label"), texts.GetValueOrDefault("suffix", "")),
                (Loc.T("fade.title"), Fades.PresetSummary(services.Settings.Params.Splitter.Fade)),
            ],
            preset => preset.Texts.GetValueOrDefault("suffix", "—"),
            preset =>
            {
                if (preset.Texts.TryGetValue("suffix", out var suffix))
                {
                    services.Settings.Params.Splitter.Suffix = Naming.SanitizeSuffix(suffix);
                    _suffix.SetValue(services.Settings.Params.Splitter.Suffix);
                }
                Fades.FromPreset(preset, services.Settings.Params.Splitter.Fade, services.Settings.Config.Fade);
                _fade.Refresh();
                services.Save();
            });

        var settingsStack = Ui.VStack(12);
        settingsStack.Children.Add(Loc.Text("splitter.settings.title", "h2"));
        settingsStack.Children.Add(Loc.Text("splitter.settings.hint", "muted"));
        settingsStack.Children.Add(_suffix);
        settingsStack.Children.Add(_fade);
        settingsStack.Children.Add(presets);
        settingsStack.Children.Add(_run);
        settingsStack.Children.Add(_stop);
        settingsStack.Children.Add(Ui.Text(Loc.T("splitter.note"), "muted", 11));
        settingsStack.Children.Add(Ui.Text(Loc.T("common.oneAtATime"), "muted", 11));
        var settings = new Border { Classes = { "card" }, Child = settingsStack };

        _drop = new DropZone(Loc, false, async paths => await LoadAsync(paths[0]), "common.dropFileTitle");
        _count = Ui.Text("0", null, 11, FontWeight.SemiBold);
        _count.HorizontalAlignment = HorizontalAlignment.Center;

        _add = new Button { Classes = { "compact" } };
        var addContent = Ui.HStack(6);
        addContent.Children.Add(Ui.Icon("M12 5v14 M5 12h14", 14, Ui.NavyBrush, 2.2));
        addContent.Children.Add(Loc.Text("splitter.addSegment", "label"));
        _add.Content = addContent;
        _add.IsEnabled = false;
        _add.Click += (_, _) => AddSegment();

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

        _stage.Children.Add(_fileStripHost);
        _stage.Children.Add(_segments);
        _stage.Children.Add(_add);
        _stage.Children.Add(_job);

        var title = Ui.VStack(2);
        title.Children.Add(Loc.Text("splitter.list.title", "h2"));
        title.Children.Add(Loc.Text("splitter.list.hint", "muted"));
        var headActions = Ui.HStack(8);
        headActions.Children.Add(new Border { Classes = { "pill" }, Child = _count });
        var head = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto") };
        head.Children.Add(title);
        Grid.SetColumn(headActions, 1);
        headActions.VerticalAlignment = VerticalAlignment.Center;
        head.Children.Add(headActions);

        var listStack = Ui.VStack(12);
        listStack.Children.Add(head);
        listStack.Children.Add(_drop);
        listStack.Children.Add(_stage);
        Content = Ui.TwoColumns(settings, new Border { Classes = { "card" }, Child = listStack });

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
        _results = 0;
        _rows.Clear();
        _segments.Children.Clear();
        Sync();

        try
        {
            _info = await Services.Engine.ProbeAsync(path, CancellationToken.None);
            _duration = _info.Duration;
            _phase = JobPhase.Idle;
            BuildFileStrip();
            _rows.Clear();
            _segments.Children.Clear();
            _rows.Add(new SegmentRow(this, new SplitRange(0, _duration)));
            RebuildSegments();
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

    private void RemoveFile()
    {
        if (IsBusy) return;
        _cts?.Cancel();
        _path = null;
        _name = "";
        _size = 0;
        _info = null;
        _duration = 0;
        _phase = JobPhase.Idle;
        _progress = 0;
        _error = "";
        _results = 0;
        _rows.Clear();
        _segments.Children.Clear();
        _fileStripHost.IsVisible = false;
        _fileStripHost.Child = null;
        Sync();
    }

    private void AddSegment()
    {
        if (IsBusy || _duration <= 0) return;
        var max = Math.Max(1, Services.Settings.Config.Splitter.MaxSegments);
        if (_rows.Count >= max)
        {
            Services.Toasts.Error(Loc.T("splitter.tooManySegments", ("max", max)));
            return;
        }

        var gap = MinimumGap();
        var last = _rows.LastOrDefault();
        var start = Math.Min(_duration, Math.Max(0, last?.Range.End ?? 0));
        var end = Math.Min(_duration, start + Math.Max(1, Math.Round(_duration / 4)));
        if (end - start < gap)
        {
            start = Math.Max(0, _duration - gap);
            end = _duration;
        }

        _rows.Add(new SegmentRow(this, new SplitRange(start, end)));
        RebuildSegments();
        Sync();
    }

    private void RemoveSegment(SegmentRow row)
    {
        if (IsBusy || _rows.Count <= 1) return;
        _rows.Remove(row);
        RebuildSegments();
        Sync();
    }

    private void RebuildSegments()
    {
        _segments.Children.Clear();
        for (var index = 0; index < _rows.Count; index++)
        {
            _rows[index].Build(index + 1);
            _segments.Children.Add(_rows[index].Root);
        }
        _count.Text = _rows.Count.ToString(CultureInfo.InvariantCulture);
    }

    private double MinimumGap() => Math.Min(1, Math.Max(0.1, _duration));

    private void SetBoundary(SegmentRow row, bool start, double seconds, bool feedback)
    {
        if (_duration <= 0) return;
        var gap = MinimumGap();
        var rounded = Math.Round(seconds);

        if (start)
        {
            var maxStart = Math.Max(0, row.Range.End - gap);
            var next = Timecode.Clamp(rounded, 0, maxStart);
            if (feedback && Math.Abs(next - rounded) > 0.01) Services.Toasts.Error(Loc.T("errors.startBeforeEnd"));
            row.Range = row.Range with { Start = next };
        }
        else
        {
            var minEnd = Math.Min(_duration, row.Range.Start + gap);
            var next = Timecode.Clamp(rounded, minEnd, Math.Floor(_duration));
            if (feedback && Math.Abs(next - rounded) > 0.01) Services.Toasts.Error(Loc.T("errors.endAfterStart"));
            row.Range = row.Range with { End = next };
        }

        row.Sync();
        Sync();
    }

    private bool CanEdit => !IsBusy && _duration > 0;

    private double Duration => _duration;

    private void Sync()
    {
        _drop.IsVisible = _path is null;
        _stage.IsVisible = _path is not null;
        _fileStripHost.IsVisible = _path is not null && _fileStripHost.Child is not null;
        _add.IsEnabled = CanEdit;

        foreach (var row in _rows) row.Sync();

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
            JobPhase.Done => Loc.T("splitter.resultDone", ("count", _results)),
            JobPhase.Error => _error,
            _ => "",
        };
        _status.Foreground = _phase == JobPhase.Error ? Ui.DangerBrush : Ui.MutedBrush;
        _stop.IsVisible = IsBusy;
        _run.IsEnabled = _path is not null && _duration > 0 && !IsBusy && _rows.Count > 0;
    }

    private async Task RenderAsync()
    {
        if (_path is null || IsBusy || _duration <= 0 || _rows.Count == 0) return;

        var cts = new CancellationTokenSource();
        _cts = cts;
        _phase = JobPhase.Preparing;
        _progress = 0;
        _etaSeconds = 0;
        _error = "";
        _results = 0;
        Sync();

        try
        {
            var ranges = _rows.Select(row => row.Range).ToList();
            var results = await Services.Engine.RenderSplitAsync(
                _path,
                _info,
                ranges,
                Services.Settings.Params.Splitter.Suffix,
                Services.Settings.Params.Splitter.Fade,
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
            _results = results.Count;
            Services.Toasts.Show(new ToastMessage(
                Loc.T("splitter.resultDone", ("count", results.Count)),
                ToastKind.Success,
                results.Count > 0 ? () => Services.Output.Reveal(results[0].OutputPath) : null,
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

    private sealed class SegmentRow
    {
        private readonly SplitterView _owner;
        private readonly TextBlock _title;
        private readonly TextBlock _length;
        private readonly CutRow _start;
        private readonly CutRow _end;
        private readonly Button _remove;

        public SegmentRow(SplitterView owner, SplitRange range)
        {
            _owner = owner;
            Range = range;

            _title = Ui.Text("", "h3");
            _length = Ui.Text("", "mono", 11.5);
            _length.HorizontalAlignment = HorizontalAlignment.Right;
            _remove = Ui.IconButton("M6 6l12 12 M18 6 6 18", owner.Loc.T("common.remove"), () => owner.RemoveSegment(this), danger: true);

            _start = new CutRow(this, start: true);
            _end = new CutRow(this, start: false);

            var head = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto,Auto") };
            head.Children.Add(_title);
            Grid.SetColumn(_length, 1);
            _length.Margin = new Thickness(0, 0, 8, 0);
            head.Children.Add(_length);
            Grid.SetColumn(_remove, 2);
            head.Children.Add(_remove);

            var body = Ui.VStack(8);
            body.Children.Add(head);
            body.Children.Add(_start.Root);
            body.Children.Add(_end.Root);

            Root = new Border { Classes = { "inset" }, Child = body };
        }

        public SplitRange Range { get; set; }

        public Border Root { get; }

        public void Build(int index)
        {
            _title.Text = $"#{index}";
            Sync();
        }

        public void Sync()
        {
            _length.Text = Timecode.FormatTimecode(Range.Duration);
            _remove.IsEnabled = _owner.CanEdit && _owner._rows.Count > 1;
            _start.SetSeconds(Range.Start, _owner.Duration, !_owner.CanEdit);
            _end.SetSeconds(Range.End, _owner.Duration, !_owner.CanEdit);
        }

        private sealed class CutRow
        {
            private readonly SegmentRow _row;
            private readonly bool _start;
            private readonly TextBlock _title;
            private readonly Slider _slider;
            private readonly TextBox _hours;
            private readonly TextBox _minutes;
            private readonly TextBox _seconds;
            private bool _sync;

            public CutRow(SegmentRow row, bool start)
            {
                _row = row;
                _start = start;

                var stack = Ui.VStack(5);
                _title = Ui.Text("", "label");
                row._owner.Loc.Bind(_title, start ? "splitter.start" : "splitter.end");
                stack.Children.Add(_title);

                _hours = TimeBox();
                _minutes = TimeBox();
                _seconds = TimeBox();
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
                    var seconds = _slider.Value / 100 * Math.Max(0, _row._owner.Duration);
                    _row._owner.SetBoundary(_row, _start, seconds, false);
                };
                stack.Children.Add(_slider);

                Root = new Border { Classes = { "cut-row" }, Child = stack };
            }

            public Border Root { get; }

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
                    _row._owner.Services.Toasts.Error(_row._owner.Loc.T("errors.timecode"));
                    _row.Sync();
                    return;
                }

                _row._owner.SetBoundary(_row, _start, Timecode.ToSeconds(hours, minutes, secs), true);
            }

            private static TextBox TimeBox() => new()
            {
                Width = 44,
                Text = "0",
                MaxLength = 2,
                HorizontalContentAlignment = HorizontalAlignment.Center,
            };

            private Control TimePart(TextBox box, string labelKey)
            {
                var stack = Ui.VStack(1);
                stack.Children.Add(box);
                stack.Children.Add(Ui.Text(_row._owner.Loc.T(labelKey), "muted", 9.5));
                stack.HorizontalAlignment = HorizontalAlignment.Center;
                return stack;
            }
        }
    }
}
