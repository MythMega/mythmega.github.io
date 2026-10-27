using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using Bulkut.Core.Features;
using Bulkut.Core.Models;
using Bulkut.Core.Services;
using Bulkut.Ui.Widgets;

namespace Bulkut.Ui.Views;

/// <summary>
/// Autocut tab: global sliders, per-video overrides, previews, batch renders and
/// the three queue controls. The native engine runs one FFmpeg process at a
/// time, so this tab also serialises its own work explicitly.
/// </summary>
public sealed class AutocutView : FeatureView
{
    private const string ClockIcon = "M12 7v5l3.2 2 M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z";
    private const string PreviewIcon = "M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z";
    private const string GearIcon = "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.36a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.64 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.64 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.64a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.36 9v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z";
    private const string StopIcon = "M7 7h10v10H7Z";
    private const string TrashIcon = "M4 7h16 M9 7V4h6v3 M6 7l1 14h10l1-14 M10 11v6 M14 11v6";
    private const string PlusIcon = "M12 5v14 M5 12h14";
    private const string PlayIcon = "m5 4 14 8-14 8V4Z";

    private readonly List<Item> _items = [];
    private readonly StackPanel _listStack = new() { Spacing = 8 };
    private readonly TextBlock _empty;
    private readonly TextBlock _count;
    private readonly Button _runAll;
    private readonly StackPanel _queuePanel;
    private readonly TextBlock _queueActive;
    private readonly Button _skip;
    private readonly Button _cancelNext;
    private readonly Button _stopAll;
    private ToggleSwitch _autoToggle = null!;
    private readonly List<SliderField> _globalFields = [];
    private readonly Dictionary<string, AutocutFieldSpec> _specs;
    private readonly Queue<Item> _estimateQueue = new();
    private CancellationTokenSource _estimateBatchCts = new();
    private SuffixField? _suffixField;
    private OutputField? _outputField;
    private FadeField? _fadeField;
    private CancellationTokenSource? _autoDebounce;
    private CancellationTokenSource? _saveDebounce;
    private CancellationTokenSource? _batchCts;
    private bool _batchRunning;
    private bool _cancelFollowing;
    private bool _estimateWorker;
    private Item? _active;

    public AutocutView(AppServices services) : base(services)
    {
        _specs = AutocutFields.Specs(services.Settings.Config).ToDictionary(spec => spec.Key);
        var parameters = services.Autocut;

        _empty = Loc.Text("autocut.empty", "muted");
        _count = Ui.Text("0", null, 11, FontWeight.SemiBold);
        _count.HorizontalAlignment = HorizontalAlignment.Center;

        var toolbar = BuildToolbar();
        var settings = BuildSettings();
        var list = BuildList();

        var body = Ui.TwoColumns(settings, list);
        var root = Ui.VStack(12);
        root.Children.Add(toolbar);
        root.Children.Add(body);
        Content = root;

        var settingsStack = (StackPanel)((Border)settings).Child!;
        _runAll = (Button)settingsStack.Children.First(control => control is Button { Tag: "run-all" });
        _queuePanel = (StackPanel)settingsStack.Children.First(control => control is StackPanel { Tag: "queue" });
        _queueActive = (TextBlock)_queuePanel.Children[0];
        var queueActions = (StackPanel)_queuePanel.Children[1];
        _skip = (Button)queueActions.Children[0];
        _cancelNext = (Button)queueActions.Children[1];
        _stopAll = (Button)queueActions.Children[2];

        _autoToggle.IsChecked = services.Settings.State.AutoEstimate;
        _autoToggle.PropertyChanged += (_, args) =>
        {
            if (args.Property.Name == "IsChecked") SetAutoEstimate(_autoToggle.IsChecked == true);
        };

        RefreshChrome();
    }

    private Control BuildToolbar()
    {
        var text = Ui.VStack(2);
        text.Children.Add(Loc.Text("autocut.autoEstimate.title", "h3"));
        text.Children.Add(Loc.Text("autocut.autoEstimate.hint", "muted"));

        _autoToggle = new ToggleSwitch { OnContent = " ", OffContent = " " };
        var grid = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto") };
        grid.Children.Add(text);
        Grid.SetColumn(_autoToggle, 1);
        _autoToggle.VerticalAlignment = VerticalAlignment.Center;
        ToolTip.SetTip(_autoToggle, Loc.T("autocut.autoEstimate.toggle"));
        grid.Children.Add(_autoToggle);

        return new Border { Classes = { "glass" }, Padding = new Thickness(16, 10), Child = grid };
    }

    private Control BuildSettings()
    {
        var stack = Ui.VStack(12);
        stack.Children.Add(Loc.Text("autocut.settings.title", "h2"));
        stack.Children.Add(Loc.Text("autocut.settings.hint", "muted"));

        var fieldStack = Ui.VStack(9);
        foreach (var spec in _specs.Values)
        {
            var field = new SliderField(Loc, spec, AutocutFields.ValueOf(Services.Autocut, spec.Key), Services.Toasts);
            field.ValueChanged += value =>
            {
                AutocutFields.SetValue(Services.Autocut, spec.Key, value);
                SaveLater();
                OnGlobalParametersChanged();
            };
            field.Committed += _ => Services.Save();
            _globalFields.Add(field);
            fieldStack.Children.Add(field);
        }
        stack.Children.Add(fieldStack);

        var suffix = new SuffixField(Loc, Services.Autocut.Suffix, value =>
        {
            Services.Autocut.Suffix = value;
            Services.Save();
        });
        _suffixField = suffix;
        stack.Children.Add(suffix);

        _outputField = new OutputField(Loc, Services.Autocut.Output);
        _outputField.ValueChanged += value =>
        {
            Services.Autocut.Output = value;
            Services.Save();
            OnGlobalParametersChanged();
        };
        stack.Children.Add(_outputField);

        _fadeField = new FadeField(Loc, Services.Autocut.Fade, Services.Settings.Config.Fade, Services.Toasts, () =>
        {
            Services.Save();
            OnGlobalParametersChanged();
        });
        stack.Children.Add(_fadeField);

        var presets = BuildAutocutPresets();
        stack.Children.Add(presets);

        var run = new Button { Classes = { "primary" }, Tag = "run-all" };
        _runAllLabel = new TextBlock();
        var runContent = Ui.HStack(8);
        runContent.Children.Add(Ui.Icon(PlayIcon, 15, Brushes.White, 2));
        runContent.Children.Add(_runAllLabel);
        run.Content = runContent;
        run.HorizontalAlignment = HorizontalAlignment.Stretch;
        ToolTip.SetTip(run, Loc.T("autocut.runAll", ("count", 0)));
        run.Click += (_, _) => RunAll();
        stack.Children.Add(run);

        var queue = Ui.VStack(7);
        queue.Tag = "queue";
        var active = Ui.Text("", "muted", 11.5);
        queue.Children.Add(active);
        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        var skip = new Button { Classes = { "compact" } };
        Loc.BindButton(skip, "autocut.queue.skip");
        skip.Click += (_, _) => SkipCurrent();
        var cancelNext = new Button { Classes = { "compact" } };
        Loc.BindButton(cancelNext, "autocut.queue.cancelNext");
        cancelNext.Click += (_, _) => CancelFollowing();
        var stop = new Button { Classes = { "danger", "compact" } };
        Loc.BindButton(stop, "autocut.queue.stopAll");
        stop.Click += (_, _) => StopAll();
        actions.Children.Add(skip);
        actions.Children.Add(cancelNext);
        actions.Children.Add(stop);
        queue.Children.Add(actions);
        stack.Children.Add(queue);

        stack.Children.Add(Ui.Text(Loc.T("common.oneAtATime"), "muted", 11));

        var card = new Border { Classes = { "card" }, Child = stack };
        return card;
    }

    private TextBlock _runAllLabel = null!;

    private PresetPanel BuildAutocutPresets()
    {
        return new PresetPanel(
            Loc,
            Services,
            "autocut",
            "nav.autocut",
            () =>
            {
                var numbers = new Dictionary<string, double>();
                foreach (var spec in _specs.Values)
                    numbers[spec.Key] = AutocutFields.ValueOf(Services.Autocut, spec.Key);
                Fades.ToPreset(Services.Autocut.Fade, numbers, new Dictionary<string, string>());
                return numbers;
            },
            () =>
            {
                var texts = new Dictionary<string, string>
                {
                    ["suffix"] = Services.Autocut.Suffix,
                    ["output"] = AutocutOutput.Normalize(Services.Autocut.Output),
                };
                Fades.ToPreset(Services.Autocut.Fade, new Dictionary<string, double>(), texts);
                return texts;
            },
            (numbers, texts) =>
            {
                var rows = new List<(string, string)>();
                foreach (var spec in _specs.Values)
                {
                    var value = numbers.TryGetValue(spec.Key, out var number) ? number : 0;
                    rows.Add((Loc.T($"autocut.fields.{spec.Label}"), $"{Timecode.FormatNumber(value, spec.Decimals)} {spec.Unit}"));
                }
                rows.Add((Loc.T("common.suffix.label"), texts.GetValueOrDefault("suffix", "")));
                rows.Add((Loc.T("autocut.output.title"), OutputLabel(texts.GetValueOrDefault("output"))));
                rows.Add((Loc.T("fade.title"), Fades.PresetSummary(Services.Autocut.Fade)));
                return rows;
            },
            preset => string.Join(" · ", preset.Numbers.Select(pair => $"{pair.Key} {Timecode.FormatNumber(pair.Value, 2)}").Take(4)),
            preset =>
            {
                var index = 0;
                foreach (var spec in _specs.Values)
                {
                    if (preset.Numbers.TryGetValue(spec.Key, out var value))
                    {
                        var clamped = Timecode.Clamp(value, spec.Min, spec.Max);
                        AutocutFields.SetValue(Services.Autocut, spec.Key, clamped);
                        if (index < _globalFields.Count) _globalFields[index].SetValue(clamped);
                    }
                    index++;
                }
                if (preset.Texts.TryGetValue("suffix", out var suffix))
                {
                    Services.Autocut.Suffix = Naming.SanitizeSuffix(suffix);
                    _suffixField?.SetValue(Services.Autocut.Suffix);
                }
                if (preset.Texts.TryGetValue("output", out var output))
                {
                    Services.Autocut.Output = AutocutOutput.Normalize(output);
                    _outputField?.SetValue(Services.Autocut.Output);
                }
                Fades.FromPreset(preset, Services.Autocut.Fade, Services.Settings.Config.Fade);
                _fadeField?.Refresh();
                Services.Save();
                OnGlobalParametersChanged();
            });
    }

    private Control BuildList()
    {
        var title = Ui.VStack(2);
        title.Children.Add(Loc.Text("autocut.list.title", "h2"));
        title.Children.Add(Loc.Text("autocut.list.hint", "muted"));

        var countPill = new Border { Classes = { "pill" }, Child = _count };
        var add = new Button { Classes = { "compact" } };
        var addContent = Ui.HStack(6);
        addContent.Children.Add(Ui.Icon(PlusIcon, 14, Ui.NavyBrush, 2.2));
        addContent.Children.Add(Loc.Text("common.addFiles", "label"));
        add.Content = addContent;
        add.Click += async (_, _) => await AddFilesAsync(await FilePicker.PickVideosAsync(this, true));
        var headActions = Ui.HStack(8);
        headActions.Children.Add(countPill);
        headActions.Children.Add(add);
        var head = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto") };
        head.Children.Add(title);
        Grid.SetColumn(headActions, 1);
        headActions.VerticalAlignment = VerticalAlignment.Center;
        head.Children.Add(headActions);

        var drop = new DropZone(Loc, true, AddFilesAsync);
        var stack = Ui.VStack(12);
        stack.Children.Add(head);
        stack.Children.Add(drop);
        stack.Children.Add(_listStack);
        stack.Children.Add(_empty);
        return new Border { Classes = { "card" }, Child = stack };
    }

    public override void RefreshLanguage()
    {
        base.RefreshLanguage();
        RefreshChrome();
        _outputField?.Refresh();
        foreach (var item in _items) item.Row.Sync();
        if (_active is not null) UpdateQueuePanel();
    }

    private string OutputLabel(string? output) =>
        Loc.T($"autocut.output.{AutocutOutput.Normalize(output)}");

    private void RefreshChrome()
    {
        _count.Text = _items.Count.ToString();
        _empty.IsVisible = _items.Count == 0;
        var pending = _items.Count(item => CanRun(item));
        _runAllLabel.Text = Loc.T("autocut.runAll", ("count", pending));
        _runAll.IsEnabled = pending > 0 && !_batchRunning;
        ToolTip.SetTip(_runAll, _runAllLabel.Text);
        UpdateQueuePanel();
    }

    private void UpdateQueuePanel()
    {
        var waiting = _items.Count(item => item.RenderStatus == JobPhase.Queued);
        var hasWork = _batchRunning || _active is not null || _items.Any(item => item.EstimateState is JobPhase.Queued or JobPhase.Rendering);
        _queuePanel.IsVisible = hasWork;
        _queueActive.Text = _active is not null
            ? Loc.T("autocut.queue.active", ("name", _active.Name))
            : Loc.T("autocut.queue.waiting", ("count", waiting));
        _skip.IsEnabled = _active is not null;
        _cancelNext.IsEnabled = waiting > 0;
        _stopAll.IsEnabled = hasWork;
    }

    private async Task AddFilesAsync(IReadOnlyList<string> paths)
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
                Path = path,
                Name = Path.GetFileName(path),
                Size = new FileInfo(path).Length,
                Status = JobPhase.Preparing,
            };
            item.Row = new Row(this, item);
            _items.Add(item);
            _listStack.Children.Add(item.Row.Root);
            item.Row.Sync();
            RefreshChrome();

            try
            {
                item.Info = await Services.Engine.ProbeAsync(path, CancellationToken.None);
                item.Status = JobPhase.Idle;
                item.Row.Sync();
                RefreshChrome();
                if (_autoToggle.IsChecked == true) QueueEstimate(item, force: true);
            }
            catch (Exception exception)
            {
                item.Status = JobPhase.Error;
                item.Error = Ui.DescribeError(exception, Services.I18n);
                item.Row.Sync();
                Services.Toasts.Error(item.Error);
            }
        }
    }

    private void OnGlobalParametersChanged()
    {
        foreach (var item in _items)
        {
            if (item.Status == JobPhase.Done) item.Stale = item.RenderedKey is not null && Effective(item).RenderChangedSince(item.RenderedKey);
            item.Row.Sync();
        }

        ResetEstimates();
        if (_autoToggle.IsChecked == true) ScheduleAutoEstimates();
        RefreshChrome();
    }

    private void SaveLater()
    {
        _saveDebounce?.Cancel();
        var cts = new CancellationTokenSource();
        _saveDebounce = cts;
        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(300, cts.Token);
                Dispatcher.UIThread.Post(() => Services.Save());
            }
            catch (OperationCanceledException)
            {
            }
        });
    }

    private void SetAutoEstimate(bool enabled)
    {
        Services.Settings.State.AutoEstimate = enabled;
        Services.Save();
        if (enabled)
        {
            EstimateAll(force: true);
        }
        else
        {
            ResetEstimates();
            RefreshChrome();
        }
    }

    private void ScheduleAutoEstimates()
    {
        _autoDebounce?.Cancel();
        var cts = new CancellationTokenSource();
        _autoDebounce = cts;
        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(3000, cts.Token);
                Dispatcher.UIThread.Post(() =>
                {
                    if (!cts.IsCancellationRequested && _autoToggle.IsChecked == true) EstimateAll(force: true);
                });
            }
            catch (OperationCanceledException)
            {
            }
        });
    }

    private void EstimateAll(bool force)
    {
        if (_batchRunning || _items.Any(item => item.RenderCts is not null)) return;
        foreach (var item in _items)
        {
            if (item.Status is JobPhase.Idle or JobPhase.Done or JobPhase.Error) QueueEstimate(item, force);
        }
    }

    private void QueueEstimate(Item item, bool force)
    {
        if (item.RenderCts is not null || item.EstimateCts is not null) return;
        if (item.EstimateState is JobPhase.Queued or JobPhase.Rendering) return;
        if (!force && item.Estimate?.Key == EstimateKey(item)) return;

        item.EstimateState = JobPhase.Queued;
        item.EstimateError = "";
        _estimateQueue.Enqueue(item);
        item.Row.Sync();
        EnsureEstimateWorker();
        RefreshChrome();
    }

    private void EnsureEstimateWorker()
    {
        if (_estimateWorker) return;
        _estimateWorker = true;
        _ = RunEstimateQueueAsync();
    }

    private async Task RunEstimateQueueAsync()
    {
        try
        {
            while (_estimateQueue.Count > 0)
            {
                var item = _estimateQueue.Dequeue();
                if (item.EstimateState != JobPhase.Queued) continue;

                var token = _estimateBatchCts.Token;
                var cts = CancellationTokenSource.CreateLinkedTokenSource(token);
                item.EstimateCts = cts;
                item.EstimateState = JobPhase.Rendering;
                item.Row.Sync();

                try
                {
                    var key = EstimateKey(item);
                    var estimate = await Services.Engine.EstimateAutocutAsync(
                        item.Path,
                        item.Info,
                        Effective(item),
                        new Progress<JobProgress>(progress =>
                        {
                            if (item.EstimateState == JobPhase.Rendering)
                            {
                                item.EstimateProgress = Math.Clamp(progress.Ratio, 0, 1);
                                item.Row.Sync();
                            }
                        }),
                        cts.Token);

                    item.Estimate = new EstimateValue(estimate.OutputDuration, estimate.Clips, key);
                    item.EstimateState = JobPhase.Idle;
                }
                catch (OperationCanceledException)
                {
                    item.EstimateState = JobPhase.Idle;
                }
                catch (AppException exception)
                {
                    item.EstimateState = JobPhase.Error;
                    item.EstimateError = Ui.DescribeError(exception, Services.I18n);
                }
                catch (Exception exception)
                {
                    item.EstimateState = JobPhase.Error;
                    item.EstimateError = Ui.DescribeError(exception, Services.I18n);
                }
                finally
                {
                    cts.Dispose();
                    item.EstimateCts = null;
                    item.Row.Sync();
                    RefreshChrome();
                }
            }
        }
        finally
        {
            _estimateWorker = false;
            if (_estimateQueue.Count > 0) EnsureEstimateWorker();
        }
    }

    private void ResetEstimates()
    {
        _estimateBatchCts.Cancel();
        _estimateQueue.Clear();
        foreach (var item in _items)
        {
            item.EstimateCts?.Cancel();
            item.EstimateState = JobPhase.Idle;
            item.Estimate = null;
            item.EstimateError = "";
            item.Row.Sync();
        }
        // A cancelled batch cannot be reused.
        _estimateBatchCts = new CancellationTokenSource();
    }

    private void CancelEstimate(Item item)
    {
        item.EstimateCts?.Cancel();
        item.EstimateState = JobPhase.Idle;
        item.Row.Sync();
    }

    private string EstimateKey(Item item) =>
        string.Join(",", Effective(item).RenderKey().Select(value => value.ToString("F4")));

    private AutocutParameters Effective(Item item) => Services.Autocut.With(item.Override);

    private bool CanRun(Item item) =>
        item.Info is not null &&
        item.Status is JobPhase.Idle or JobPhase.Error ||
        item.Status == JobPhase.Done && item.Stale;

    private bool IsBusy(Item item) => item.RenderCts is not null || item.EstimateCts is not null;

    private async void RunAll()
    {
        if (_batchRunning) return;
        var pending = _items.Where(CanRun).ToList();
        if (pending.Count == 0) return;

        _batchRunning = true;
        _cancelFollowing = false;
        _batchCts = new CancellationTokenSource();
        foreach (var item in pending)
        {
            item.RenderStatus = JobPhase.Queued;
            item.Status = JobPhase.Queued;
            item.Progress = 0;
            item.Eta = 0;
            item.Error = "";
            item.Row.Sync();
        }
        RefreshChrome();

        try
        {
            foreach (var item in pending)
            {
                if (_batchCts.IsCancellationRequested || _cancelFollowing)
                {
                    item.Status = JobPhase.Idle;
                    item.RenderStatus = JobPhase.Idle;
                    item.Row.Sync();
                    continue;
                }
                await RenderItemAsync(item, preview: false);
            }
        }
        finally
        {
            _batchRunning = false;
            _batchCts?.Dispose();
            _batchCts = null;
            _cancelFollowing = false;
            _active = null;
            foreach (var item in _items)
            {
                if (item.RenderStatus is JobPhase.Queued) item.RenderStatus = JobPhase.Idle;
                if (item.Status is JobPhase.Queued or JobPhase.Preparing or JobPhase.Analyzing or JobPhase.Rendering)
                {
                    item.Status = JobPhase.Idle;
                    item.Progress = 0;
                }
                item.Row.Sync();
            }
            RefreshChrome();
        }
    }

    private async Task RenderItemAsync(Item item, bool preview)
    {
        var token = preview ? CancellationToken.None : _batchCts?.Token ?? CancellationToken.None;
        var cts = CancellationTokenSource.CreateLinkedTokenSource(token);
        item.RenderCts = cts;
        _active = item;
        item.Status = JobPhase.Preparing;
        item.Progress = 0;
        item.Eta = 0;
        item.Error = "";
        item.Row.Sync();
        RefreshChrome();

        try
        {
            var result = await Services.Engine.RenderAutocutAsync(
                item.Path,
                item.Info,
                Effective(item),
                Services.Autocut.Suffix,
                preview,
                new Progress<JobProgress>(progress =>
                {
                    item.Status = progress.Phase;
                    item.Progress = progress.Ratio;
                    item.Eta = progress.EtaSeconds;
                    item.Row.Sync();
                }),
                cts.Token);

            if (!preview)
            {
                item.Status = JobPhase.Done;
                item.Progress = 1;
                item.ResultName = result.FileName;
                item.ResultPath = result.OutputPath;
                item.RenderedKey = Effective(item).RenderKey();
                item.Stale = false;
                var toast = new ToastMessage(
                    Loc.T("desktop.savedTo", ("name", result.FileName), ("folder", Services.Output.Folder)),
                    ToastKind.Success,
                    () => Services.Output.Reveal(result.OutputPath),
                    Loc.T("desktop.reveal"));
                Services.Toasts.Show(toast);
            }
            else
            {
                Services.Toasts.Success(Loc.T("autocut.previewDone", ("name", result.FileName)));
                item.Status = JobPhase.Idle;
                item.Progress = 0;
            }
        }
        catch (OperationCanceledException)
        {
            item.Status = JobPhase.Idle;
            item.Progress = 0;
        }
        catch (AppException exception) when (exception.Code == AppErrorCodes.Cancelled)
        {
            item.Status = JobPhase.Idle;
            item.Progress = 0;
        }
        catch (Exception exception)
        {
            if (preview)
            {
                item.Status = JobPhase.Idle;
                item.Progress = 0;
                Services.Toasts.Error(Ui.DescribeError(exception, Services.I18n));
            }
            else
            {
                item.Status = JobPhase.Error;
                item.Progress = 0;
                item.Error = Ui.DescribeError(exception, Services.I18n);
                Services.Toasts.Error(item.Error);
            }
        }
        finally
        {
            item.RenderCts = null;
            cts.Dispose();
            if (_active == item) _active = null;
            item.Row.Sync();
            RefreshChrome();
        }
    }

    private void SkipCurrent()
    {
        var item = _active;
        if (item is null) return;

        item.RenderCts?.Cancel();
        item.EstimateCts?.Cancel();
        Services.Toasts.Info(Loc.T("autocut.queue.skipped", ("name", item.Name)));
    }

    private void CancelFollowing()
    {
        if (!_batchRunning) return;
        _cancelFollowing = true;
        var count = _items.Count(item => item.RenderStatus == JobPhase.Queued);
        if (count > 0) Services.Toasts.Info(Loc.T("autocut.queue.cancelledNext", ("count", count)));
        RefreshChrome();
    }

    private void StopAll()
    {
        _cancelFollowing = true;
        _batchCts?.Cancel();
        foreach (var item in _items)
        {
            item.RenderCts?.Cancel();
            item.EstimateCts?.Cancel();
        }
        ResetEstimates();
        Services.Toasts.Info(Loc.T("autocut.queue.stoppedAll"));
        RefreshChrome();
    }

    private async void PreviewItem(Item item)
    {
        if (IsBusy(item) || item.Info is null || _batchRunning) return;
        await RenderItemAsync(item, preview: true);
    }

    private void RemoveItem(Item item)
    {
        if (IsBusy(item) || item.Status is JobPhase.Preparing or JobPhase.Analyzing or JobPhase.Rendering) return;
        item.EstimateCts?.Cancel();
        item.RenderCts?.Cancel();
        _items.Remove(item);
        _listStack.Children.Remove(item.Row.Root);
        RefreshChrome();
    }

    private async void OpenItemSettings(Item item)
    {
        if (IsBusy(item)) return;
        var draft = Effective(item).Clone();
        var result = await DialogHost.ShowAsync<AutocutOverrideResult>(
            this,
            Loc.T("autocut.modal.title", ("name", item.Name)),
            done => BuildItemBody(done, draft),
            new DialogSize(880, 780, MinHeight: 520));
        if (result is null || !result.Applied) return;

        item.Override = result.Override;
        item.Stale = item.Status == JobPhase.Done && item.RenderedKey is not null &&
                    Effective(item).RenderChangedSince(item.RenderedKey);
        item.Row.Sync();
        ResetEstimates();
        if (_autoToggle.IsChecked == true) QueueEstimate(item, force: true);
        RefreshChrome();
    }

    private void RefreshGlobalFields()
    {
        var index = 0;
        foreach (var field in _globalFields)
        {
            field.SetValue(AutocutFields.ValueOf(Services.Autocut, _specs.Values.ElementAt(index).Key));
            index++;
        }
        _suffixField?.SetValue(Services.Autocut.Suffix);
        _outputField?.SetValue(Services.Autocut.Output);
    }

    private sealed class EstimateValue(double duration, int clips, string key)
    {
        public double Duration { get; } = duration;
        public int Clips { get; } = clips;
        public string Key { get; } = key;
    }

    private sealed class Item
    {
        public string Path { get; init; } = "";
        public string Name { get; init; } = "";
        public long Size { get; init; }
        public MediaInfo? Info { get; set; }
        public AutocutParameters? Override { get; set; }
        public JobPhase Status { get; set; } = JobPhase.Idle;
        public JobPhase RenderStatus { get; set; } = JobPhase.Idle;
        public double Progress { get; set; }
        public double Eta { get; set; }
        public string Error { get; set; } = "";
        public bool Stale { get; set; }
        public double[]? RenderedKey { get; set; }
        public string? ResultName { get; set; }
        public string? ResultPath { get; set; }
        public CancellationTokenSource? RenderCts { get; set; }
        public CancellationTokenSource? EstimateCts { get; set; }
        public JobPhase EstimateState { get; set; } = JobPhase.Idle;
        public double EstimateProgress { get; set; }
        public string EstimateError { get; set; } = "";
        public EstimateValue? Estimate { get; set; }
        public Row Row { get; set; } = null!;
    }

    private sealed class Row
    {
        private readonly AutocutView _owner;
        private readonly Item _item;
        private readonly TextBlock _name;
        private readonly Border _badge;
        private readonly TextBlock _badgeText;
        private readonly TextBlock _meta;
        private readonly TextBlock _estimate;
        private readonly Border _estimateBorder;
        private readonly TextBlock _status;
        private readonly TextBlock _percent;
        private readonly TextBlock _eta;
        private readonly ProgressBar _bar;
        private readonly Button _estimateButton;
        private readonly Button _previewButton;
        private readonly Button _configButton;
        private readonly Button _stopButton;
        private readonly Button _removeButton;

        public Row(AutocutView owner, Item item)
        {
            _owner = owner;
            _item = item;

            _name = Ui.Text(item.Name, "h3");
            _name.TextTrimming = TextTrimming.CharacterEllipsis;
            _badgeText = Ui.Text("", null, 10.5, FontWeight.SemiBold);
            _badge = new Border { Classes = { "pill" }, Padding = new Thickness(8, 2), Child = _badgeText };
            _meta = Ui.Text("", "muted", 11.5);
            _estimate = Ui.Text("", "muted", 11);
            _estimateBorder = new Border { Classes = { "inset" }, Padding = new Thickness(8, 4), Child = _estimate, IsVisible = false };
            _status = Ui.Text("", "muted", 11);
            _percent = Ui.Text("", "muted", 11);
            _eta = Ui.Text("", "muted", 11);
            _bar = Ui.Progress();

            _estimateButton = Ui.IconButton(ClockIcon, owner.Localize.T("autocut.estimate.button"), () => owner.QueueEstimate(item, true));
            _previewButton = Ui.IconButton(PreviewIcon, owner.Localize.T("autocut.excerpt.title"), () => owner.PreviewItem(item));
            _configButton = Ui.IconButton(GearIcon, owner.Localize.T("common.configure"), () => owner.OpenItemSettings(item));
            _stopButton = Ui.IconButton(StopIcon, owner.Localize.T("common.stop"), () =>
            {
                item.RenderCts?.Cancel();
                if (item.EstimateCts is not null) owner.CancelEstimate(item);
            }, danger: true);
            _removeButton = Ui.IconButton(TrashIcon, owner.Localize.T("common.remove"), () => owner.RemoveItem(item), danger: true);

            var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
            actions.Children.Add(_estimateButton);
            actions.Children.Add(_previewButton);
            actions.Children.Add(_configButton);
            actions.Children.Add(_stopButton);
            actions.Children.Add(_removeButton);

            var nameRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 7 };
            nameRow.Children.Add(_name);
            nameRow.Children.Add(_badge);

            var statusRight = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            statusRight.Children.Add(_eta);
            statusRight.Children.Add(_percent);
            var statusRow = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto") };
            statusRow.Children.Add(_status);
            Grid.SetColumn(statusRight, 1);
            statusRow.Children.Add(statusRight);

            var info = Ui.VStack(4);
            info.Children.Add(nameRow);
            info.Children.Add(_meta);
            info.Children.Add(_estimateBorder);
            info.Children.Add(_bar);
            info.Children.Add(statusRow);

            var thumb = new Border
            {
                Width = 36,
                Height = 36,
                CornerRadius = new CornerRadius(10),
                Background = new SolidColorBrush(Color.Parse("#E7EFFF")),
                Child = Ui.Icon("M3 7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7Z M10 9.5l5 2.5-5 2.5v-5Z", 18),
                VerticalAlignment = VerticalAlignment.Top,
            };

            var grid = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*,Auto") };
            grid.Children.Add(thumb);
            Grid.SetColumn(info, 1);
            info.Margin = new Thickness(10, 0, 8, 0);
            grid.Children.Add(info);
            Grid.SetColumn(actions, 2);
            grid.Children.Add(actions);

            Root = new Border
            {
                Classes = { "inset" },
                Padding = new Thickness(11),
                Child = grid,
            };
            Sync();
        }

        public Border Root { get; }

        public void Sync()
        {
            var owner = _owner;
            var item = _item;
            var effective = owner.Effective(item);
            var busy = item.RenderCts is not null;
            var estimating = item.EstimateCts is not null;
            var custom = item.Override is not null;
            var stale = item.Status == JobPhase.Done && item.Stale;

            _name.Text = item.Name;
            ToolTip.SetTip(_name, item.Name);
            _badge.Background = new SolidColorBrush(Color.Parse(custom ? "#FCEFD8" : "#E7EFFF"));
            _badgeText.Foreground = new SolidColorBrush(Color.Parse(custom ? "#8A5200" : "#1B356E"));
            _badgeText.Text = owner.Localize.T(custom ? "common.customBadge" : "common.defaultBadge");
            ToolTip.SetTip(_badge, owner.Localize.T(custom ? "autocut.badge.custom" : "autocut.badge.default"));

            var duration = item.Info?.Duration ?? 0;
            var format = owner.OutputLabel(effective.Output);
            _meta.Text = duration > 0
                ? $"{Timecode.FormatDuration(duration)} · {Timecode.FormatBytes(item.Size)} · {format} · {AutocutFields.Summary(effective)}"
                : $"{Timecode.FormatBytes(item.Size)} · {format} · {AutocutFields.Summary(effective)}";

            _estimateBorder.IsVisible = item.EstimateState is JobPhase.Queued or JobPhase.Rendering or JobPhase.Error ||
                                         item.Estimate is not null;
            if (item.EstimateState == JobPhase.Queued)
            {
                _estimate.Text = owner.Localize.T("autocut.estimate.queued");
            }
            else if (item.EstimateState == JobPhase.Rendering)
            {
                _estimate.Text = owner.Localize.T("autocut.estimate.running", ("percent", (int)Math.Round(item.EstimateProgress * 100)));
            }
            else if (item.EstimateState == JobPhase.Error)
            {
                _estimate.Text = item.EstimateError;
            }
            else if (item.Estimate is not null)
            {
                _estimate.Text = owner.Localize.T("autocut.estimate.ready",
                    ("duration", Timecode.FormatDuration(item.Estimate.Duration)),
                    ("clips", item.Estimate.Clips));
            }

            var showProgress = busy && item.Status is JobPhase.Preparing or JobPhase.Analyzing or JobPhase.Rendering || item.Status == JobPhase.Queued;
            _bar.IsVisible = showProgress;
            _bar.Value = Math.Clamp(item.Progress, 0, 1);

            _percent.Text = busy || item.Status == JobPhase.Queued ? $"{(int)Math.Round(item.Progress * 100)}%" : stale ? "" : item.Status == JobPhase.Done ? "100%" : "";
            _eta.Text = busy && item.Eta > 0 ? owner.Localize.T("common.eta", ("time", Timecode.FormatEta(item.Eta))) : "";

            _status.Text = item.Status switch
            {
                JobPhase.Queued => owner.Localize.T("common.queued"),
                JobPhase.Preparing => owner.Localize.T("common.preparing"),
                JobPhase.Analyzing => owner.Localize.T("common.analyzing"),
                JobPhase.Rendering => owner.Localize.T("common.rendering"),
                JobPhase.Done => stale
                    ? owner.Localize.T("autocut.stale")
                    : string.IsNullOrWhiteSpace(item.ResultName) ? owner.Localize.T("common.done") : item.ResultName,
                JobPhase.Error => item.Error,
                _ => owner.Localize.T("common.ready"),
            };
            _status.Foreground = item.Status == JobPhase.Error
                ? Ui.DangerBrush
                : stale ? new SolidColorBrush(Color.Parse("#8A5200")) : Ui.MutedBrush;

            _estimateButton.IsEnabled = !busy && !estimating;
            _previewButton.IsEnabled = !busy && !estimating && item.Info is not null;
            _configButton.IsEnabled = !busy && !estimating;
            _removeButton.IsEnabled = !busy && !estimating;
            _stopButton.IsVisible = busy || estimating;

            Root.Background = new SolidColorBrush(stale
                ? Color.Parse("#FFF9EE")
                : item.Status == JobPhase.Error ? Color.Parse("#FFF4F3")
                : item.Status == JobPhase.Done ? Color.Parse("#F4FBF7")
                : Color.Parse("#F7FAFF"));
        }
    }

    private sealed record AutocutOverrideResult(bool Applied, AutocutParameters? Override);

    /// <summary>
    /// Body of the per-video settings sheet. The host decides whether it becomes
    /// a window or an inline modal, so the same controls serve both heads.
    /// </summary>
    private Control BuildItemBody(Action<AutocutOverrideResult> done, AutocutParameters draft)
    {
        var loc = Loc;
        var stack = Ui.VStack(12);
        stack.Children.Add(Ui.Text(loc.T("autocut.modal.hint"), "muted"));

        var output = new OutputField(loc, draft.Output);
        output.ValueChanged += value => draft.Output = value;
            stack.Children.Add(output);

        var specs = AutocutFields.Specs(Services.Settings.Config);
        foreach (var spec in specs)
        {
            var field = new SliderField(loc, spec, AutocutFields.ValueOf(draft, spec.Key), Services.Toasts);
            field.ValueChanged += value => AutocutFields.SetValue(draft, spec.Key, value);
            field.Committed += value => AutocutFields.SetValue(draft, spec.Key, value);
            stack.Children.Add(field);
        }

        var buttons = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, HorizontalAlignment = HorizontalAlignment.Right };
        var reset = new Button { Classes = { "ghost" }, Content = loc.T("autocut.modal.useDefaults") };
        reset.Click += (_, _) => done(new AutocutOverrideResult(true, null));
        var cancel = new Button { Classes = { "ghost" }, Content = loc.T("common.cancel") };
        cancel.Click += (_, _) => done(new AutocutOverrideResult(false, null));
        var apply = new Button { Classes = { "primary" }, Content = loc.T("autocut.modal.apply") };
        apply.Click += (_, _) => done(new AutocutOverrideResult(true, draft.Clone()));
        buttons.Children.Add(reset);
        buttons.Children.Add(cancel);
        buttons.Children.Add(apply);
        stack.Children.Add(buttons);

        return new ScrollViewer { Content = stack };
    }
}
