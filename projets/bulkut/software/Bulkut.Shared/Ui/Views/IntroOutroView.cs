using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Bulkut.Core.Features;
using EdgeMode = Bulkut.Core.Features.EdgeMode;
using Bulkut.Core.Models;
using Bulkut.Core.Services;
using Bulkut.Ui.Widgets;

namespace Bulkut.Ui.Views;

/// <summary>
/// Shared intro/outro slots above a list of independent videos. Each video is
/// exported on its own with the edges selected on its row.
/// </summary>
public sealed class IntroOutroView : FeatureView
{
    private sealed class Edge
    {
        public required string Path { get; init; }
        public required string Name { get; init; }
        public long Size { get; init; }
        public MediaInfo? Info { get; set; }
        public double Duration => Info?.Duration ?? 0;
    }

    private sealed class Item
    {
        public int Id { get; init; }
        public required string Path { get; init; }
        public required string Name { get; init; }
        public long Size { get; init; }
        public MediaInfo? Info { get; set; }
        public EdgeMode Mode { get; set; } = EdgeMode.Both;
        public JobPhase Status { get; set; } = JobPhase.Idle;
        public JobPhase RenderStatus { get; set; } = JobPhase.Idle;
        public double Progress { get; set; }
        public double Eta { get; set; }
        public string Error { get; set; } = "";
        public string? ResultName { get; set; }
        public CancellationTokenSource? Cts { get; set; }
        public Row Row { get; set; } = null!;
    }

    private readonly StackPanel _introSlot = new();
    private readonly StackPanel _outroSlot = new();
    private readonly StackPanel _list = new() { Spacing = 8 };
    private readonly TextBlock _empty;
    private readonly TextBlock _count;
    private readonly Button _runAll;
    private readonly TextBlock _runAllLabel;
    private readonly Button _stopAll;
    private readonly StackPanel _queuePanel;
    private readonly TextBlock _queueActive;
    private readonly TextBlock _hint;
    private readonly SuffixField _suffix;
    private readonly FadeField _fade;

    private readonly List<Item> _items = [];
    private Edge? _intro;
    private Edge? _outro;
    private bool _batchRunning;
    private CancellationTokenSource? _batchCts;
    private Item? _active;
    private int _nextId = 1;

    public IntroOutroView(AppServices services) : base(services)
    {
        _empty = Loc.Text("introoutro.empty", "muted");
        _count = Ui.Text("0", null, 11, FontWeight.SemiBold);
        _count.HorizontalAlignment = HorizontalAlignment.Center;

        _suffix = new SuffixField(Loc, services.Settings.Params.IntroOutro.Suffix, value =>
        {
            services.Settings.Params.IntroOutro.Suffix = value;
            services.Save();
        });

        _fade = new FadeField(Loc, services.Settings.Params.IntroOutro.Fade, services.Settings.Config.Fade, services.Toasts, services.Save);

        _runAllLabel = new TextBlock();
        _runAll = new Button { Classes = { "primary" }, HorizontalAlignment = HorizontalAlignment.Stretch, IsEnabled = false };
        var runContent = Ui.HStack(7);
        runContent.Children.Add(Ui.Icon("m5 4 14 8-14 8V4Z", 14, Brushes.White, 2));
        runContent.Children.Add(_runAllLabel);
        _runAll.Content = runContent;
        _runAll.Click += (_, _) => RunAll();

        _stopAll = new Button { Classes = { "danger" }, HorizontalAlignment = HorizontalAlignment.Stretch, IsVisible = false };
        Loc.BindButton(_stopAll, "introoutro.queue.stopAll");
        _stopAll.Click += (_, _) => StopAll();

        _queueActive = Ui.Text("", "muted", 11.5);
        _queuePanel = Ui.VStack(6);
        _queuePanel.Children.Add(_queueActive);
        _queuePanel.Children.Add(_stopAll);
        _queuePanel.IsVisible = false;

        _hint = Ui.Text(Loc.T("introoutro.needEdge"), "muted", 11);
        _hint.IsVisible = false;

        var presets = new PresetPanel(
            Loc,
            services,
            "introoutro",
            "nav.introoutro",
            () =>
            {
                var numbers = new Dictionary<string, double>();
                Fades.ToPreset(services.Settings.Params.IntroOutro.Fade, numbers, new Dictionary<string, string>());
                return numbers;
            },
            () =>
            {
                var texts = new Dictionary<string, string> { ["suffix"] = services.Settings.Params.IntroOutro.Suffix };
                Fades.ToPreset(services.Settings.Params.IntroOutro.Fade, new Dictionary<string, double>(), texts);
                return texts;
            },
            (_, texts) =>
            [
                (Loc.T("common.suffix.label"), texts.GetValueOrDefault("suffix", "")),
                (Loc.T("fade.title"), Fades.PresetSummary(services.Settings.Params.IntroOutro.Fade)),
            ],
            preset => preset.Texts.GetValueOrDefault("suffix", "—"),
            preset =>
            {
                if (preset.Texts.TryGetValue("suffix", out var suffix))
                {
                    services.Settings.Params.IntroOutro.Suffix = Naming.SanitizeSuffix(suffix);
                    _suffix.SetValue(services.Settings.Params.IntroOutro.Suffix);
                }
                Fades.FromPreset(preset, services.Settings.Params.IntroOutro.Fade, services.Settings.Config.Fade);
                _fade.Refresh();
                services.Save();
            });

        var settingsStack = Ui.VStack(12);
        settingsStack.Children.Add(Loc.Text("introoutro.settings.title", "h2"));
        settingsStack.Children.Add(Loc.Text("introoutro.settings.hint", "muted"));
        settingsStack.Children.Add(_suffix);
        settingsStack.Children.Add(_fade);
        settingsStack.Children.Add(presets);
        settingsStack.Children.Add(_runAll);
        settingsStack.Children.Add(_queuePanel);
        settingsStack.Children.Add(_hint);
        settingsStack.Children.Add(Ui.Text(Loc.T("common.oneAtATime"), "muted", 11));
        var settings = new Border { Classes = { "card" }, Child = settingsStack };

        var title = Ui.VStack(2);
        title.Children.Add(Loc.Text("introoutro.list.title", "h2"));
        title.Children.Add(Loc.Text("introoutro.list.hint", "muted"));
        var add = new Button { Classes = { "compact" } };
        var addContent = Ui.HStack(6);
        addContent.Children.Add(Ui.Icon("M12 5v14 M5 12h14", 14, Ui.NavyBrush, 2.2));
        addContent.Children.Add(Loc.Text("common.addFiles", "label"));
        add.Content = addContent;
        add.Click += async (_, _) => await AddAsync(await FilePicker.PickVideosAsync(this, true));

        var headActions = Ui.HStack(8);
        headActions.Children.Add(new Border { Classes = { "pill" }, Child = _count });
        headActions.Children.Add(add);
        var head = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto") };
        head.Children.Add(title);
        Grid.SetColumn(headActions, 1);
        headActions.VerticalAlignment = VerticalAlignment.Center;
        head.Children.Add(headActions);

        var slots = new Grid { ColumnDefinitions = new ColumnDefinitions("*,10,*") };
        Grid.SetColumn(_introSlot, 0);
        Grid.SetColumn(_outroSlot, 2);
        slots.Children.Add(_introSlot);
        slots.Children.Add(_outroSlot);

        var drop = new DropZone(Loc, true, AddAsync, noteKey: "common.localOnly");

        var listStack = Ui.VStack(12);
        listStack.Children.Add(head);
        listStack.Children.Add(slots);
        listStack.Children.Add(drop);
        listStack.Children.Add(_list);
        listStack.Children.Add(_empty);
        var listCard = new Border { Classes = { "card" }, Child = listStack };

        Content = Ui.TwoColumns(settings, listCard);
        RefreshSlots();
        RefreshChrome();
    }

    public override void RefreshLanguage()
    {
        base.RefreshLanguage();
        RefreshSlots();
        RebuildList();
        RefreshChrome();
    }

    private IReadOnlyList<EdgeMode> Modes => IntroOutroPlanner.AvailableModes(EdgeMediaOf(_intro), EdgeMediaOf(_outro));

    private static EdgeMedia? EdgeMediaOf(Edge? edge) =>
        edge is null ? null : new EdgeMedia(edge.Path, edge.Duration);

    private EdgeMode ModeOf(Item item) => IntroOutroPlanner.EffectiveMode(item.Mode, EdgeMediaOf(_intro), EdgeMediaOf(_outro));

    private double Expected(Item item) =>
        IntroOutroPlanner.ExpectedDuration(item.Info?.Duration ?? 0, ModeOf(item), EdgeMediaOf(_intro), EdgeMediaOf(_outro));

    private bool IsBusy(Item item) => item.Cts is not null;

    private bool CanRun(Item item) =>
        item.Info is not null && Modes.Count > 0 && !IsBusy(item) &&
        item.Status is JobPhase.Idle or JobPhase.Error or JobPhase.Done;

    private void RefreshChrome()
    {
        _count.Text = _items.Count.ToString();
        _empty.IsVisible = _items.Count == 0;
        _hint.IsVisible = _items.Count > 0 && Modes.Count == 0;
        var pending = _items.Count(CanRun);
        _runAllLabel.Text = Loc.T("introoutro.runAll", ("count", pending));
        _runAll.IsEnabled = pending > 0 && !_batchRunning;
        _stopAll.IsVisible = _batchRunning || _active is not null;
        _queuePanel.IsVisible = _batchRunning || _active is not null;
        if (_queuePanel.IsVisible)
        {
            var waiting = _items.Count(item => item.RenderStatus == JobPhase.Queued);
            _queueActive.Text = _active is not null
                ? Loc.T("introoutro.queue.active", ("name", _active.Name))
                : Loc.T("introoutro.queue.waiting", ("count", waiting));
        }
        foreach (var item in _items) item.Row.Sync();
    }

    private async Task AddAsync(IReadOnlyList<string> paths)
    {
        foreach (var path in paths)
        {
            if (!File.Exists(path) || !Naming.IsVideoExtension(path))
            {
                Services.Toasts.Error(Loc.T("errors.notVideo", ("name", Path.GetFileName(path))));
                continue;
            }

            var item = new Item
            {
                Id = _nextId++,
                Path = path,
                Name = Path.GetFileName(path),
                Size = new FileInfo(path).Length,
                Status = JobPhase.Preparing,
            };
            item.Row = new Row(this, item);
            _items.Add(item);
            _list.Children.Add(item.Row.Root);
            item.Row.Sync();
            RefreshChrome();

            try
            {
                item.Info = await Services.Engine.ProbeAsync(path, CancellationToken.None);
                item.Status = JobPhase.Idle;
            }
            catch (Exception exception)
            {
                item.Status = JobPhase.Error;
                item.Error = Ui.DescribeError(exception, Services.I18n);
                Services.Toasts.Error(item.Error);
            }
            item.Row.Sync();
            RefreshChrome();
        }
    }

    private void RebuildList()
    {
        _list.Children.Clear();
        foreach (var item in _items)
        {
            item.Row = new Row(this, item);
            _list.Children.Add(item.Row.Root);
        }
    }

    private void RefreshSlots()
    {
        BuildSlot(_introSlot, "intro", "introoutro.addIntro", "introoutro.introHint", _intro);
        BuildSlot(_outroSlot, "outro", "introoutro.addOutro", "introoutro.outroHint", _outro);
        RebuildList();
        RefreshChrome();
    }

    private void BuildSlot(StackPanel host, string kind, string titleKey, string hintKey, Edge? edge)
    {
        host.Children.Clear();
        if (edge is null)
        {
            host.Children.Add(new DropZone(Loc, false, async paths => await LoadEdgeAsync(kind, paths[0]), titleKey, hintKey));
            return;
        }

        var remove = Ui.IconButton("M4 7h16 M9 7V4h6v3 M6 7l1 14h10l1-14 M10 11v6 M14 11v6",
            Loc.T("common.remove"), () => RemoveEdge(kind), danger: true);
        remove.IsEnabled = !_batchRunning;

        var info = Ui.VStack(2);
        var name = Ui.Text(edge.Name, "h3");
        name.TextTrimming = TextTrimming.CharacterEllipsis;
        info.Children.Add(name);
        info.Children.Add(Ui.Text(
            edge.Duration > 0 ? $"{Timecode.FormatDuration(edge.Duration)} · {Timecode.FormatBytes(edge.Size)}" : Timecode.FormatBytes(edge.Size),
            "muted",
            11));
        info.Margin = new Thickness(8, 0);
        var row = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*,Auto") };
        row.Children.Add(new Border
        {
            Width = 30,
            Height = 30,
            CornerRadius = new CornerRadius(9),
            Background = new SolidColorBrush(Color.Parse("#E7EFFF")),
            Child = Ui.Icon(
                kind == "intro"
                    ? "M3.5 12h12 M10.5 7l5 5-5 5 M20.5 5v14"
                    : "M20.5 12h-12 M13.5 7l-5 5 5 5 M3.5 5v14",
                16),
        });
        Grid.SetColumn(info, 1);
        row.Children.Add(info);
        Grid.SetColumn(remove, 2);
        row.Children.Add(remove);
        host.Children.Add(new Border { Classes = { "inset" }, Child = row });
    }

    private async Task LoadEdgeAsync(string kind, string path)
    {
        if (_batchRunning) return;
        if (!File.Exists(path) || !Naming.IsVideoExtension(path))
        {
            Services.Toasts.Error(Loc.T("errors.notVideo", ("name", Path.GetFileName(path))));
            return;
        }

        var edge = new Edge { Path = path, Name = Path.GetFileName(path), Size = new FileInfo(path).Length };
        try
        {
            edge.Info = await Services.Engine.ProbeAsync(path, CancellationToken.None);
        }
        catch (Exception exception)
        {
            Services.Toasts.Error(Ui.DescribeError(exception, Services.I18n));
            return;
        }

        if (kind == "intro") _intro = edge;
        else _outro = edge;
        RefreshSlots();
    }

    private void RemoveEdge(string kind)
    {
        if (_batchRunning) return;
        if (kind == "intro") _intro = null;
        else _outro = null;
        RefreshSlots();
    }

    private async void RunAll()
    {
        if (_batchRunning) return;
        var pending = _items.Where(CanRun).ToList();
        if (pending.Count == 0) return;

        _batchRunning = true;
        _batchCts = new CancellationTokenSource();
        foreach (var item in pending)
        {
            item.Status = JobPhase.Queued;
            item.RenderStatus = JobPhase.Queued;
            item.Progress = 0;
            item.Error = "";
            item.Row.Sync();
        }
        RefreshChrome();

        try
        {
            foreach (var item in pending)
            {
                if (_batchCts.IsCancellationRequested)
                {
                    item.Status = JobPhase.Idle;
                    item.RenderStatus = JobPhase.Idle;
                    item.Row.Sync();
                    continue;
                }
                await RenderItemAsync(item, _batchCts.Token);
            }
        }
        finally
        {
            _batchRunning = false;
            _batchCts?.Dispose();
            _batchCts = null;
            _active = null;
            foreach (var item in _items)
            {
                if (item.RenderStatus == JobPhase.Queued) item.RenderStatus = JobPhase.Idle;
                if (item.Status is JobPhase.Queued or JobPhase.Preparing or JobPhase.Analyzing or JobPhase.Rendering)
                    item.Status = JobPhase.Idle;
                item.Row.Sync();
            }
            RefreshChrome();
        }
    }

    private async Task RenderItemAsync(Item item, CancellationToken batchToken)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(batchToken);
        item.Cts = cts;
        item.Status = JobPhase.Preparing;
        item.Progress = 0;
        item.Eta = 0;
        item.Error = "";
        _active = item;
        item.Row.Sync();
        RefreshChrome();

        try
        {
            var mode = ModeOf(item);
            var plan = IntroOutroPlanner.Plan(item.Path, item.Info?.Duration ?? 0, mode, EdgeMediaOf(_intro), EdgeMediaOf(_outro));
            var result = await Services.Engine.RenderIntroOutroAsync(
                plan,
                item.Name,
                Services.Settings.Params.IntroOutro.Suffix,
                Services.Settings.Params.IntroOutro.Fade,
                new Progress<JobProgress>(progress =>
                {
                    if (progress.Phase == JobPhase.Done) return;
                    item.Status = progress.Phase;
                    item.Progress = progress.Ratio;
                    item.Eta = progress.EtaSeconds;
                    item.Row.Sync();
                }),
                cts.Token);

            item.Status = JobPhase.Done;
            item.Progress = 1;
            item.ResultName = result.FileName;
            Services.Toasts.Show(new ToastMessage(
                Loc.T("desktop.savedTo", ("name", result.FileName), ("folder", Services.Output.Folder)),
                ToastKind.Success,
                () => Services.Output.Reveal(result.OutputPath),
                Loc.T("desktop.reveal")));
        }
        catch (Exception exception) when (exception is OperationCanceledException || exception is AppException { Code: AppErrorCodes.Cancelled })
        {
            item.Status = JobPhase.Idle;
            item.Progress = 0;
        }
        catch (Exception exception)
        {
            item.Status = JobPhase.Error;
            item.Progress = 0;
            item.Error = Ui.DescribeError(exception, Services.I18n);
            Services.Toasts.Error(item.Error);
        }
        finally
        {
            item.Cts = null;
            cts.Dispose();
            if (_active == item) _active = null;
            item.Row.Sync();
            RefreshChrome();
        }
    }

    private void StopAll()
    {
        _batchCts?.Cancel();
        foreach (var item in _items) item.Cts?.Cancel();
        Services.Toasts.Info(Loc.T("introoutro.queue.stoppedAll"));
    }

    private async void RenderOne(Item item)
    {
        if (!CanRun(item) || _batchRunning) return;
        await RenderItemAsync(item, CancellationToken.None);
    }

    private void RemoveItem(Item item)
    {
        if (IsBusy(item)) return;
        item.Cts?.Cancel();
        _items.Remove(item);
        _list.Children.Remove(item.Row.Root);
        RefreshChrome();
    }

    private void ChangeMode(Item item, EdgeMode mode)
    {
        item.Mode = mode;
        item.Row.Sync();
        RefreshChrome();
    }

    private sealed class Row
    {
        private readonly IntroOutroView _owner;
        private readonly Item _item;
        private readonly Border _root;
        private readonly TextBlock _name;
        private readonly TextBlock _meta;
        private readonly TextBlock _expected;
        private readonly TextBlock _status;
        private readonly TextBlock _percent;
        private readonly TextBlock _eta;
        private readonly ProgressBar _bar;
        private readonly ComboBox _modes;
        private readonly Button _render;
        private readonly Button _stop;
        private readonly Button _remove;
        private bool _syncing;

        public Row(IntroOutroView owner, Item item)
        {
            _owner = owner;
            _item = item;

            _name = Ui.Text(item.Name, "h3");
            _name.TextTrimming = TextTrimming.CharacterEllipsis;
            _meta = Ui.Text("", "muted", 11.5);
            _expected = Ui.Text("", "muted", 11);
            _status = Ui.Text("", "muted", 11);
            _percent = Ui.Text("", "muted", 11);
            _eta = Ui.Text("", "muted", 11);
            _bar = Ui.Progress();

            _modes = new ComboBox { MinWidth = 120, IsEnabled = false };
            _modes.SelectionChanged += (_, _) =>
            {
                if (_syncing) return;
                var modes = owner.Modes;
                if (_modes.SelectedIndex < 0 || _modes.SelectedIndex >= modes.Count) return;
                owner.ChangeMode(item, modes[_modes.SelectedIndex]);
            };

            _render = new Button { Classes = { "compact" } };
            owner.Loc.BindButton(_render, "introoutro.run");
            _render.Click += (_, _) => owner.RenderOne(item);
            _stop = new Button { Classes = { "danger", "compact" }, Content = owner.Loc.T("common.stop") };
            _stop.Click += (_, _) => item.Cts?.Cancel();
            _remove = Ui.IconButton("M4 7h16 M9 7V4h6v3 M6 7l1 14h10l1-14 M10 11v6 M14 11v6",
                owner.Loc.T("common.remove"), () => owner.RemoveItem(item), danger: true);

            var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
            actions.Children.Add(_modes);
            actions.Children.Add(_render);
            actions.Children.Add(_stop);
            actions.Children.Add(_remove);

            var statusRight = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            statusRight.Children.Add(_eta);
            statusRight.Children.Add(_percent);
            var statusRow = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto") };
            statusRow.Children.Add(_status);
            Grid.SetColumn(statusRight, 1);
            statusRow.Children.Add(statusRight);

            var info = Ui.VStack(3);
            info.Children.Add(_name);
            info.Children.Add(_meta);
            info.Children.Add(_expected);
            info.Children.Add(_bar);
            info.Children.Add(statusRow);

            var grid = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto") };
            grid.Children.Add(info);
            Grid.SetColumn(actions, 1);
            actions.Margin = new Thickness(10, 0, 0, 0);
            grid.Children.Add(actions);

            _root = new Border { Classes = { "inset" }, Padding = new Thickness(10), Child = grid };
            Sync();
        }

        public Border Root => _root;

        public void Sync()
        {
            var owner = _owner;
            var item = _item;
            var busy = item.Cts is not null;
            var mode = owner.ModeOf(item);
            var modes = owner.Modes;

            var duration = item.Info?.Duration ?? 0;
            _meta.Text = duration > 0
                ? $"{Timecode.FormatDuration(duration)} · {Timecode.FormatBytes(item.Size)}"
                : Timecode.FormatBytes(item.Size);

            _expected.Text = owner.Loc.T("introoutro.expected", ("duration", Timecode.FormatDuration(owner.Expected(item))));
            _expected.IsVisible = duration > 0 && modes.Count > 0;

            _syncing = true;
            _modes.ItemsSource = modes.Select(value => owner.Loc.T($"introoutro.mode.{value.ToString().ToLowerInvariant()}")).ToList();
            _modes.SelectedIndex = Math.Max(0, modes.ToList().IndexOf(mode));
            _modes.IsEnabled = !busy && !owner._batchRunning && modes.Count > 1;
            _syncing = false;

            _bar.Value = Math.Clamp(item.Progress, 0, 1);
            _bar.IsVisible = busy && item.Status is JobPhase.Preparing or JobPhase.Analyzing or JobPhase.Rendering;
            _percent.Text = busy || item.Status == JobPhase.Queued ? $"{(int)Math.Round(item.Progress * 100)}%" : item.Status == JobPhase.Done ? "100%" : "";
            _eta.Text = busy && item.Eta > 0 ? owner.Loc.T("common.eta", ("time", Timecode.FormatEta(item.Eta))) : "";
            _status.Text = item.Status switch
            {
                JobPhase.Queued => owner.Loc.T("common.queued"),
                JobPhase.Preparing => owner.Loc.T("common.preparing"),
                JobPhase.Analyzing => owner.Loc.T("common.analyzing"),
                JobPhase.Rendering => owner.Loc.T("common.rendering"),
                JobPhase.Done => item.ResultName ?? owner.Loc.T("common.done"),
                JobPhase.Error => item.Error,
                _ => modes.Count == 0 ? owner.Loc.T("introoutro.needEdge") : owner.Loc.T("common.ready"),
            };
            _status.Foreground = item.Status == JobPhase.Error ? Ui.DangerBrush : Ui.MutedBrush;

            _render.IsEnabled = owner.CanRun(item);
            _stop.IsVisible = busy;
            _remove.IsEnabled = !busy;
            _root.Background = new SolidColorBrush(item.Status == JobPhase.Done
                ? Color.Parse("#F4FBF7")
                : item.Status == JobPhase.Error ? Color.Parse("#FFF4F3") : Color.Parse("#F7FAFF"));
        }
    }
}
