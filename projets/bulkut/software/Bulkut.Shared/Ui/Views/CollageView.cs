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

/// <summary>Several clips joined end to end, reorderable by drag or arrows.</summary>
public sealed class CollageView : FeatureView
{
    private sealed class CollageItem
    {
        public required string Path { get; init; }
        public required string Name { get; init; }
        public long Size { get; init; }
        public MediaInfo? Info { get; set; }
        public double Duration => Info?.Duration ?? 0;
    }

    private readonly SuffixField _suffix;
    private readonly FadeField _fade;
    private readonly Button _run;
    private readonly Button _stop;
    private readonly Button _add;
    private readonly StackPanel _list = new() { Spacing = 7 };
    private readonly StackPanel _empty = new();
    private readonly StackPanel _totalStrip = new() { Orientation = Orientation.Horizontal, Spacing = 8 };
    private readonly TextBlock _totalValue;
    private readonly TextBlock _count;
    private readonly ProgressBar _bar = Ui.Progress();
    private readonly TextBlock _status;
    private readonly TextBlock _eta;
    private readonly TextBlock _percent;
    private readonly StackPanel _job;
    private readonly DropZone _drop;

    private readonly List<CollageItem> _clips = [];
    private CancellationTokenSource? _cts;
    private JobPhase _phase = JobPhase.Idle;
    private double _progress;
    private double _etaSeconds;
    private string _error = "";
    private bool _busy;
    private CollageItem? _dragClip;
    private Border? _dragRow;
    private Point _dragStart;
    private bool _dragging;

    public CollageView(AppServices services) : base(services)
    {
        _count = Ui.Text("0", null, 11, FontWeight.SemiBold);
        _count.HorizontalAlignment = HorizontalAlignment.Center;
        _totalValue = Ui.Text("00:00:00", "mono", 14, FontWeight.Bold);

        _suffix = new SuffixField(Loc, services.Settings.Params.Collage.Suffix, value =>
        {
            services.Settings.Params.Collage.Suffix = value;
            services.Save();
        });

        _fade = new FadeField(Loc, services.Settings.Params.Collage.Fade, services.Settings.Config.Fade, services.Toasts, services.Save);

        _run = new Button { Classes = { "primary" }, HorizontalAlignment = HorizontalAlignment.Stretch, IsEnabled = false };
        Loc.BindButton(_run, "collage.run");
        _run.Click += async (_, _) => await RenderAsync();

        _stop = new Button { Classes = { "danger" }, HorizontalAlignment = HorizontalAlignment.Stretch, IsVisible = false };
        Loc.BindButton(_stop, "common.stop");
        _stop.Click += (_, _) => _cts?.Cancel();

        var presets = new PresetPanel(
            Loc,
            services,
            "collage",
            "nav.collage",
            () =>
            {
                var numbers = new Dictionary<string, double>();
                Fades.ToPreset(services.Settings.Params.Collage.Fade, numbers, new Dictionary<string, string>());
                return numbers;
            },
            () =>
            {
                var texts = new Dictionary<string, string> { ["suffix"] = services.Settings.Params.Collage.Suffix };
                Fades.ToPreset(services.Settings.Params.Collage.Fade, new Dictionary<string, double>(), texts);
                return texts;
            },
            (_, texts) =>
            [
                (Loc.T("common.suffix.label"), texts.GetValueOrDefault("suffix", "")),
                (Loc.T("fade.title"), Fades.PresetSummary(services.Settings.Params.Collage.Fade)),
            ],
            preset => preset.Texts.GetValueOrDefault("suffix", "—"),
            preset =>
            {
                if (preset.Texts.TryGetValue("suffix", out var suffix))
                {
                    services.Settings.Params.Collage.Suffix = Naming.SanitizeSuffix(suffix);
                    _suffix.SetValue(services.Settings.Params.Collage.Suffix);
                }
                Fades.FromPreset(preset, services.Settings.Params.Collage.Fade, services.Settings.Config.Fade);
                _fade.Refresh();
                services.Save();
            });

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

        var settingsStack = Ui.VStack(12);
        settingsStack.Children.Add(Loc.Text("collage.settings.title", "h2"));
        settingsStack.Children.Add(Loc.Text("collage.settings.hint", "muted"));
        settingsStack.Children.Add(_suffix);
        settingsStack.Children.Add(_fade);
        settingsStack.Children.Add(presets);
        settingsStack.Children.Add(_run);
        settingsStack.Children.Add(_stop);
        settingsStack.Children.Add(_job);
        settingsStack.Children.Add(Ui.Text(Loc.T("collage.note"), "muted", 11));
        var settings = new Border { Classes = { "card" }, Child = settingsStack };

        _drop = new DropZone(Loc, true, AddAsync, noteKey: "common.localOnly");
        _add = new Button { Classes = { "compact" } };
        var addContent = Ui.HStack(6);
        addContent.Children.Add(Ui.Icon("M12 5v14 M5 12h14", 14, Ui.NavyBrush, 2.2));
        addContent.Children.Add(Loc.Text("common.addFiles", "label"));
        _add.Content = addContent;
        _add.Click += async (_, _) => await AddAsync(await FilePicker.PickVideosAsync(this, true));

        var title = Ui.VStack(2);
        title.Children.Add(Loc.Text("collage.list.title", "h2"));
        title.Children.Add(Loc.Text("collage.list.hint", "muted"));
        var headActions = Ui.HStack(8);
        headActions.Children.Add(new Border { Classes = { "pill" }, Child = _count });
        headActions.Children.Add(_add);
        var head = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto") };
        head.Children.Add(title);
        Grid.SetColumn(headActions, 1);
        headActions.VerticalAlignment = VerticalAlignment.Center;
        head.Children.Add(headActions);

        _totalStrip.Children.Add(Loc.Text("collage.total", "label"));
        _totalStrip.Children.Add(_totalValue);
        _totalStrip.VerticalAlignment = VerticalAlignment.Center;
        var totalBorder = new Border
        {
            Classes = { "inset" },
            Background = new SolidColorBrush(Color.Parse("#EDF3FF")),
            Child = _totalStrip,
            IsVisible = false,
        };

        var emptyText = Loc.Text("collage.empty", "muted");
        _empty.Children.Add(emptyText);

        var listStack = Ui.VStack(12);
        listStack.Children.Add(head);
        listStack.Children.Add(_drop);
        listStack.Children.Add(totalBorder);
        listStack.Children.Add(_list);
        listStack.Children.Add(_empty);
        var listCard = new Border { Classes = { "card" }, Child = listStack };
        _totalStrip.Tag = totalBorder;

        Content = Ui.TwoColumns(settings, listCard);
        UpdateSummary();
        Sync();
    }

    public override void RefreshLanguage()
    {
        base.RefreshLanguage();
        RebuildList();
        Sync();
    }

    private bool IsBusy => _busy || _phase is JobPhase.Preparing or JobPhase.Analyzing or JobPhase.Rendering;

    private async Task AddAsync(IReadOnlyList<string> paths)
    {
        if (IsBusy) return;
        foreach (var path in paths)
        {
            if (!File.Exists(path) || !Naming.IsVideoExtension(path))
            {
                Services.Toasts.Error(Loc.T("errors.notVideo", ("name", Path.GetFileName(path))));
                continue;
            }

            var clip = new CollageItem { Path = path, Name = Path.GetFileName(path), Size = new FileInfo(path).Length };
            _clips.Add(clip);
            UpdateSummary();
            Sync();

            try
            {
                clip.Info = await Services.Engine.ProbeAsync(path, CancellationToken.None);
                RebuildList();
                UpdateSummary();
            }
            catch (Exception exception)
            {
                _clips.Remove(clip);
                RebuildList();
                UpdateSummary();
                Services.Toasts.Error(Ui.DescribeError(exception, Services.I18n));
            }
        }
    }

    private void RebuildList()
    {
        _list.Children.Clear();
        for (var index = 0; index < _clips.Count; index++)
        {
            _list.Children.Add(BuildRow(_clips[index], index));
        }
        UpdateSummary();
    }

    private Control BuildRow(CollageItem clip, int index)
    {
        var grip = new Border
        {
            Width = 24,
            Height = 30,
            CornerRadius = new CornerRadius(6),
            Background = new SolidColorBrush(Color.Parse("#E7EFFF")),
            Child = Ui.Icon("M9 6h.01 M15 6h.01 M9 10h.01 M15 10h.01 M9 14h.01 M15 14h.01", 18, Ui.MutedBrush, 2.4),
            Cursor = new Cursor(StandardCursorType.Hand),
        };
        grip.PointerPressed += (_, args) => StartDrag(clip, args);

        var number = Ui.Text((index + 1).ToString(), "muted", 11, FontWeight.SemiBold);
        number.Width = 18;
        number.TextAlignment = TextAlignment.Center;

        var name = Ui.Text(clip.Name, "h3");
        name.TextTrimming = TextTrimming.CharacterEllipsis;
        var info = Ui.VStack(2);
        info.Children.Add(name);
        info.Children.Add(Ui.Text(
            clip.Duration > 0 ? $"{Timecode.FormatDuration(clip.Duration)} · {Timecode.FormatBytes(clip.Size)}" : Timecode.FormatBytes(clip.Size),
            "muted",
            11));
        info.Margin = new Thickness(8, 0);

        var up = Ui.IconButton("M6 14l6-6 6 6", Loc.T("common.moveUp"), () => Move(clip, -1));
        var down = Ui.IconButton("M6 10l6 6 6-6", Loc.T("common.moveDown"), () => Move(clip, 1));
        var remove = Ui.IconButton("M4 7h16 M9 7V4h6v3 M6 7l1 14h10l1-14 M10 11v6 M14 11v6", Loc.T("common.remove"), () => Remove(clip), danger: true);
        up.IsEnabled = !IsBusy && index > 0;
        down.IsEnabled = !IsBusy && index < _clips.Count - 1;
        remove.IsEnabled = !IsBusy;

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 1, VerticalAlignment = VerticalAlignment.Center };
        actions.Children.Add(up);
        actions.Children.Add(down);
        actions.Children.Add(remove);

        var grid = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,Auto,*,Auto") };
        grid.Children.Add(grip);
        Grid.SetColumn(number, 1);
        number.VerticalAlignment = VerticalAlignment.Center;
        grid.Children.Add(number);
        Grid.SetColumn(info, 2);
        grid.Children.Add(info);
        Grid.SetColumn(actions, 3);
        grid.Children.Add(actions);

        var row = new Border { Classes = { "inset" }, Padding = new Thickness(9), Child = grid };
        if (clip.Info is null)
            row.Opacity = 0.7;
        return row;
    }

    private void StartDrag(CollageItem clip, PointerPressedEventArgs args)
    {
        if (IsBusy) return;
        _dragClip = clip;
        _dragRow = FindRow(args.Source as Control);
        _dragStart = args.GetPosition(_list);
        _dragging = false;
        args.Pointer.Capture((IInputElement)args.Source!);
        if (args.Source is Control source)
        {
            source.PointerMoved += OnDragMove;
            source.PointerReleased += OnDragEnd;
        }
    }

    private static Border? FindRow(Control? control)
    {
        var current = control;
        while (current is not null)
        {
            if (current is Border border && border.Classes.Contains("inset")) return border;
            current = current.Parent as Control;
        }
        return null;
    }

    private void OnDragMove(object? sender, PointerEventArgs args)
    {
        if (_dragClip is null || _dragRow is null) return;
        var position = args.GetPosition(_list);
        if (!_dragging && Math.Abs(position.Y - _dragStart.Y) < 5) return;
        _dragging = true;
        _dragRow.Opacity = 0.55;
    }

    private void OnDragEnd(object? sender, PointerReleasedEventArgs args)
    {
        if (sender is Control source)
        {
            source.PointerMoved -= OnDragMove;
            source.PointerReleased -= OnDragEnd;
        }

        if (_dragClip is null || !_dragging)
        {
            ResetDrag();
            return;
        }

        var position = args.GetPosition(_list);
        var target = _clips.IndexOf(_dragClip);
        for (var index = 0; index < _list.Children.Count; index++)
        {
            var child = (Control)_list.Children[index];
            if (position.Y < child.Bounds.Y + child.Bounds.Height / 2)
            {
                target = index;
                break;
            }
            target = index;
        }

        var from = _clips.IndexOf(_dragClip);
        target = Math.Clamp(target, 0, _clips.Count - 1);
        if (from != target)
        {
            _clips.RemoveAt(from);
            _clips.Insert(target, _dragClip);
            RebuildList();
            UpdateSummary();
        }
        ResetDrag();
    }

    private void ResetDrag()
    {
        if (_dragRow is not null) _dragRow.Opacity = 1;
        _dragClip = null;
        _dragRow = null;
        _dragging = false;
    }

    private void Move(CollageItem clip, int offset)
    {
        if (IsBusy) return;
        var from = _clips.IndexOf(clip);
        var to = from + offset;
        if (from < 0 || to < 0 || to >= _clips.Count) return;
        _clips.RemoveAt(from);
        _clips.Insert(to, clip);
        RebuildList();
        UpdateSummary();
    }

    private void Remove(CollageItem clip)
    {
        if (IsBusy) return;
        _clips.Remove(clip);
        RebuildList();
        UpdateSummary();
    }

    private void UpdateSummary()
    {
        _count.Text = _clips.Count.ToString();
        _empty.IsVisible = _clips.Count == 0;
        _totalValue.Text = Timecode.FormatTimecode(_clips.Sum(clip => clip.Duration));
        if (_totalStrip.Tag is Border total) total.IsVisible = _clips.Count > 0;
        _run.IsEnabled = _clips.Count > 0 && _clips.All(clip => clip.Info is not null) && !IsBusy;
        _stop.IsVisible = IsBusy;
    }

    private void Sync()
    {
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
        _add.IsEnabled = !IsBusy;
        UpdateSummary();
    }

    private async Task RenderAsync()
    {
        if (_clips.Count == 0 || IsBusy || _clips.Any(clip => clip.Info is null)) return;
        var cts = new CancellationTokenSource();
        _cts = cts;
        _busy = true;
        _phase = JobPhase.Preparing;
        _progress = 0;
        _etaSeconds = 0;
        _error = "";
        Sync();

        try
        {
            var result = await Services.Engine.RenderConcatAsync(
                _clips.Select(clip => clip.Path).ToList(),
                _clips.Select(clip => clip.Duration).ToList(),
                Services.Settings.Params.Collage.Suffix,
                Services.Settings.Params.Collage.Fade,
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
            _busy = false;
            _cts = null;
            cts.Dispose();
            Sync();
        }
    }
}
