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
/// Convert tab: re-encodes a list of videos into another container, with the
/// bitrate left to FFmpeg or set explicitly. Only the formats the bundled
/// FFmpeg can write are listed.
/// </summary>
public sealed class ConvertView : FeatureView
{
    private sealed class Item
    {
        public required string Path { get; init; }
        public required string Name { get; init; }
        public long Size { get; init; }
        public MediaInfo? Info { get; set; }
        public JobPhase Phase { get; set; } = JobPhase.Idle;
        public double Progress { get; set; }
        public string Error { get; set; } = "";
        public RenderResult? Result { get; set; }
        public ItemRow? Row { get; set; }
    }

    private sealed class ItemRow
    {
        private readonly ConvertView _owner;
        private readonly Item _item;
        private readonly TextBlock _meta;
        private readonly TextBlock _status;
        private readonly TextBlock _percent;
        private readonly ProgressBar _bar;
        private readonly Button _remove;

        public ItemRow(ConvertView owner, Item item)
        {
            _owner = owner;
            _item = item;

            var thumb = new Border
            {
                Width = 34,
                Height = 34,
                CornerRadius = new CornerRadius(10),
                Background = new SolidColorBrush(Color.Parse("#E7EFFF")),
                Child = Ui.Icon("M3 7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7Z M10 9.5l5 2.5-5 2.5v-5Z", 16),
            };

            var name = Ui.Text(item.Name, "h3");
            name.TextTrimming = TextTrimming.CharacterEllipsis;
            _meta = Ui.Text("", "muted", 11);
            var info = Ui.VStack(2);
            info.Margin = new Thickness(9, 0, 8, 0);
            info.Children.Add(name);
            info.Children.Add(_meta);

            _remove = Ui.IconButton(
                "M4 7h16 M9 7V4h6v3 M6 7l1 14h10l1-14 M10 11v6 M14 11v6",
                owner.Loc.T("common.remove"),
                () => owner.Remove(item),
                danger: true);

            var head = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*,Auto") };
            head.Children.Add(thumb);
            Grid.SetColumn(info, 1);
            head.Children.Add(info);
            Grid.SetColumn(_remove, 2);
            _remove.VerticalAlignment = VerticalAlignment.Center;
            head.Children.Add(_remove);

            _status = Ui.Text("", "muted", 11.5);
            _percent = Ui.Text("", "mono", 11, FontWeight.SemiBold);
            var statusRow = new Grid
            {
                ColumnDefinitions = new ColumnDefinitions("*,Auto"),
                Margin = new Thickness(0, 6, 0, 0),
            };
            statusRow.Children.Add(_status);
            Grid.SetColumn(_percent, 1);
            statusRow.Children.Add(_percent);

            _bar = Ui.Progress();
            _bar.Height = 5;
            _bar.Margin = new Thickness(0, 5, 0, 0);

            var body = Ui.VStack(1);
            body.Children.Add(head);
            body.Children.Add(statusRow);
            body.Children.Add(_bar);

            Root = new Border { Classes = { "inset" }, Padding = new Thickness(9), Child = body };
            Sync();
        }

        public Border Root { get; }

        public void Sync()
        {
            var busy = _item.Phase is JobPhase.Preparing or JobPhase.Rendering;
            var failed = _item.Phase == JobPhase.Error;
            var done = _item.Phase == JobPhase.Done;

            var details = new List<string>();
            if (_item.Info is { Duration: > 0 }) details.Add(Timecode.FormatDuration(_item.Info.Duration));
            details.Add(Timecode.FormatBytes(_item.Size));
            details.Add($"→ {_owner.FormatId}");
            _meta.Text = string.Join(" · ", details);

            _bar.IsVisible = busy || done || failed;
            _bar.Value = Math.Clamp(_item.Progress, 0, 1);

            _status.Text = _item.Phase switch
            {
                JobPhase.Queued => _owner.Loc.T("common.queued"),
                JobPhase.Preparing => _owner.Loc.T("convert.probing"),
                JobPhase.Rendering => _owner.Loc.T("common.rendering"),
                JobPhase.Done => _owner.Loc.T("common.done"),
                JobPhase.Error => _item.Error,
                _ => "",
            };
            _status.Foreground = failed
                ? Ui.DangerBrush
                : done
                    ? new SolidColorBrush(Color.Parse("#0F7A55"))
                    : Ui.MutedBrush;
            _percent.Text = busy ? $"{(int)Math.Round(_item.Progress * 100)}%" : done ? "100%" : "";
            _remove.IsEnabled = !_owner.IsBusy && !busy;
        }
    }

    private readonly ComboBox _format = new();
    private readonly ComboBox _videoMode = new();
    private readonly ComboBox _audioMode = new();
    private readonly TextBox _videoBitrate = new() { Width = 92 };
    private readonly TextBox _audioBitrate = new() { Width = 92 };
    private readonly TextBlock _support;
    private readonly TextBlock _runLabel;
    private readonly TextBlock _status;
    private readonly TextBlock _eta;
    private readonly TextBlock _percent;
    private readonly ProgressBar _bar = Ui.Progress();
    private readonly StackPanel _job;
    private readonly SuffixField _suffix;
    private readonly Button _run;
    private readonly Button _stop;
    private readonly Button _add;
    private readonly DropZone _drop;
    private readonly StackPanel _list = new() { Spacing = 8 };
    private readonly StackPanel _empty;
    private readonly TextBlock _count;
    private readonly List<Item> _items = [];

    private IReadOnlyList<ConvertTarget> _targets = ConvertOps.DefaultTargets();
    private CancellationTokenSource? _cts;
    private bool _busy;
    private bool _targetsLoaded;
    private bool _syncingFormat;
    private bool _syncingModes;
    private JobPhase _phase = JobPhase.Idle;
    private double _progress;
    private double _etaSeconds;
    private string _error = "";

    public ConvertView(AppServices services) : base(services)
    {
        var settings = services.Settings.Params.Convert;

        _support = Ui.Text("", "muted", 10.5);
        _count = Ui.Text("0", null, 11, FontWeight.SemiBold);
        _count.HorizontalAlignment = HorizontalAlignment.Center;

        _suffix = new SuffixField(Loc, settings.Suffix, value =>
        {
            settings.Suffix = value;
            services.Save();
        });

        _videoBitrate.Text = "2500";
        _audioBitrate.Text = "128";
        _videoBitrate.VerticalAlignment = VerticalAlignment.Center;
        _audioBitrate.VerticalAlignment = VerticalAlignment.Center;
        ToolTip.SetTip(_videoBitrate, Loc.T("convert.videoBitrateHint"));
        ToolTip.SetTip(_audioBitrate, Loc.T("convert.audioBitrateHint"));

        BuildModeCombo(_videoMode);
        BuildModeCombo(_audioMode);
        SetBitrateControls(_videoMode, _videoBitrate, settings.VideoBitrate);
        SetBitrateControls(_audioMode, _audioBitrate, settings.AudioBitrate);

        _videoMode.SelectionChanged += (_, _) =>
        {
            if (_syncingModes) return;
            ApplyBitrateMode(_videoMode, _videoBitrate, video: true, fallback: "2500");
        };
        _audioMode.SelectionChanged += (_, _) =>
        {
            if (_syncingModes) return;
            ApplyBitrateMode(_audioMode, _audioBitrate, video: false, fallback: "128");
        };

        foreach (var (box, video, fallback) in new[]
                 {
                     (_videoBitrate, true, "2500"),
                     (_audioBitrate, false, "128"),
                 })
        {
            box.LostFocus += (_, _) => CommitBitrate(box, video ? _videoMode : _audioMode, video, fallback);
            box.KeyDown += (_, args) =>
            {
                if (args.Key is not (Key.Enter or Key.Return)) return;
                CommitBitrate(box, video ? _videoMode : _audioMode, video, fallback);
                args.Handled = true;
            };
        }

        _format.HorizontalAlignment = HorizontalAlignment.Stretch;
        _format.SelectionChanged += (_, _) =>
        {
            if (_syncingFormat) return;
            if (_format.SelectedItem is not ComboBoxItem { Tag: ConvertTarget target }) return;
            if (string.Equals(settings.Format, target.Id, StringComparison.OrdinalIgnoreCase)) return;
            settings.Format = target.Id;
            services.Save();
            Sync();
        };

        _runLabel = new TextBlock();
        _run = new Button
        {
            Classes = { "primary" },
            Content = _runLabel,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            IsEnabled = false,
        };
        _run.Click += async (_, _) => await RenderAsync();

        _stop = new Button
        {
            Classes = { "danger" },
            HorizontalAlignment = HorizontalAlignment.Stretch,
            IsVisible = false,
        };
        Loc.BindButton(_stop, "common.stop");
        _stop.Click += (_, _) => _cts?.Cancel();

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
        settingsStack.Children.Add(Loc.Text("convert.settings.title", "h2"));
        settingsStack.Children.Add(Loc.Text("convert.settings.hint", "muted"));
        settingsStack.Children.Add(BuildFormatField());
        settingsStack.Children.Add(BuildBitrateField(
            "convert.videoBitrate", "convert.videoBitrateHint", _videoMode, _videoBitrate));
        settingsStack.Children.Add(BuildBitrateField(
            "convert.audioBitrate", "convert.audioBitrateHint", _audioMode, _audioBitrate));
        settingsStack.Children.Add(_suffix);
        settingsStack.Children.Add(_run);
        settingsStack.Children.Add(_stop);
        settingsStack.Children.Add(_job);
        settingsStack.Children.Add(Ui.Text(Loc.T("convert.note"), "muted", 11));
        settingsStack.Children.Add(Ui.Text(Loc.T("common.oneAtATime"), "muted", 11));
        var settingsCard = new Border { Classes = { "card" }, Child = settingsStack };

        _drop = new DropZone(Loc, true, AddAsync);

        _add = new Button { Classes = { "compact" } };
        var addContent = Ui.HStack(6);
        addContent.Children.Add(Ui.Icon("M12 5v14 M5 12h14", 14, Ui.NavyBrush, 2.2));
        addContent.Children.Add(Loc.Text("common.addFiles", "label"));
        _add.Content = addContent;
        _add.Click += async (_, _) => await _drop.PickAsync();

        var title = Ui.VStack(2);
        title.Children.Add(Loc.Text("convert.list.title", "h2"));
        title.Children.Add(Loc.Text("convert.list.hint", "muted"));
        var headActions = Ui.HStack(8);
        headActions.Children.Add(new Border { Classes = { "pill" }, Child = _count });
        headActions.Children.Add(_add);
        var head = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto") };
        head.Children.Add(title);
        Grid.SetColumn(headActions, 1);
        headActions.VerticalAlignment = VerticalAlignment.Center;
        head.Children.Add(headActions);

        _empty = Ui.VStack(0);
        _empty.Children.Add(Loc.Text("convert.empty", "muted"));

        var listStack = Ui.VStack(12);
        listStack.Children.Add(head);
        listStack.Children.Add(_drop);
        listStack.Children.Add(_list);
        listStack.Children.Add(_empty);
        var listCard = new Border { Classes = { "card" }, Child = listStack };

        Content = Ui.TwoColumns(settingsCard, listCard);

        RefreshTargets();
        Sync();

        AttachedToVisualTree += async (_, _) => await DetectTargetsAsync();
    }

    private bool IsBusy => _busy;

    private string FormatId => (SelectedTarget()?.Id ?? "mp4").ToUpperInvariant();

    public override void RefreshLanguage()
    {
        base.RefreshLanguage();
        RefreshTargets();
        Sync();
    }

    private void BuildModeCombo(ComboBox combo)
    {
        combo.HorizontalAlignment = HorizontalAlignment.Stretch;
        combo.MinWidth = 150;
        combo.Items.Add(new ComboBoxItem { Content = Loc.Text("convert.bitrate.auto", "body") });
        combo.Items.Add(new ComboBoxItem { Content = Loc.Text("convert.bitrate.custom", "body") });
    }

    private Control BuildFormatField()
    {
        var stack = Ui.VStack(5);
        stack.Children.Add(Loc.Text("convert.format", "label"));
        stack.Children.Add(_format);
        stack.Children.Add(Loc.Text("convert.formatHint", "muted"));
        stack.Children.Add(_support);
        return stack;
    }

    private Control BuildBitrateField(string titleKey, string hintKey, ComboBox mode, TextBox box)
    {
        var row = Ui.HStack(8);
        row.Children.Add(mode);
        row.Children.Add(box);
        row.Children.Add(Loc.Text("convert.bitrateUnit", "muted"));

        var stack = Ui.VStack(5);
        stack.Children.Add(Loc.Text(titleKey, "label"));
        stack.Children.Add(row);
        stack.Children.Add(Loc.Text(hintKey, "muted"));
        return stack;
    }

    private void SetBitrateControls(ComboBox mode, TextBox box, string value)
    {
        _syncingModes = true;
        try
        {
            var auto = ConvertOps.NormalizeBitrate(value) == "auto";
            mode.SelectedIndex = auto ? 0 : 1;
            box.Text = auto ? "" : ConvertOps.NormalizeBitrate(value);
            box.IsEnabled = !auto;
            box.Opacity = auto ? 0.5 : 1;
        }
        finally
        {
            _syncingModes = false;
        }
    }

    private void ApplyBitrateMode(ComboBox mode, TextBox box, bool video, string fallback)
    {
        var auto = mode.SelectedIndex <= 0;
        var value = auto ? "auto" : ConvertOps.NormalizeBitrate(box.Text);
        if (!auto && value == "auto") value = fallback;

        SetBitrateControls(mode, box, value);
        if (video) Services.Settings.Params.Convert.VideoBitrate = value;
        else Services.Settings.Params.Convert.AudioBitrate = value;
        Services.Save();
    }

    private void CommitBitrate(TextBox box, ComboBox mode, bool video, string fallback)
    {
        var value = ConvertOps.NormalizeBitrate(box.Text);
        if (value == "auto") value = fallback;

        SetBitrateControls(mode, box, value);
        if (video) Services.Settings.Params.Convert.VideoBitrate = value;
        else Services.Settings.Params.Convert.AudioBitrate = value;
        Services.Save();
    }

    private ConvertTarget? SelectedTarget() =>
        _format.SelectedItem is ComboBoxItem { Tag: ConvertTarget target } ? target : _targets.FirstOrDefault();

    private void RefreshTargets()
    {
        _syncingFormat = true;
        try
        {
            _format.Items.Clear();
            foreach (var target in _targets)
            {
                _format.Items.Add(new ComboBoxItem
                {
                    Tag = target,
                    Content = Ui.Text(target.Id.ToUpperInvariant(), "body"),
                });
            }

            var current = ConvertOps.NormalizeFormat(Services.Settings.Params.Convert.Format, _targets);
            if (!string.Equals(current, Services.Settings.Params.Convert.Format, StringComparison.OrdinalIgnoreCase))
            {
                Services.Settings.Params.Convert.Format = current;
                Services.Save();
            }

            var index = 0;
            for (var i = 0; i < _targets.Count; i++)
            {
                if (!string.Equals(_targets[i].Id, current, StringComparison.OrdinalIgnoreCase)) continue;
                index = i;
                break;
            }
            _format.SelectedIndex = _targets.Count > 0 ? index : -1;
            _format.IsEnabled = _targets.Count > 1;
        }
        finally
        {
            _syncingFormat = false;
        }

        _support.Text = Loc.T("convert.support", ("formats", string.Join(", ", _targets.Select(target => target.Id.ToUpperInvariant()))));
    }

    private async Task DetectTargetsAsync()
    {
        if (_targetsLoaded) return;
        _targetsLoaded = true;

        try
        {
            var targets = await Services.Engine.DetectConvertTargetsAsync(CancellationToken.None);
            if (targets.Count == 0) return;
            _targets = targets;
            RefreshTargets();
            Sync();
        }
        catch (Exception)
        {
            // Keep the standard list: a probe failure must not disable the tab.
        }
    }

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

            var item = new Item
            {
                Path = path,
                Name = Path.GetFileName(path),
                Size = new FileInfo(path).Length,
                Phase = JobPhase.Preparing,
            };
            _items.Add(item);
            RebuildList();
            Sync();

            try
            {
                item.Info = await Services.Engine.ProbeAsync(path, CancellationToken.None);
                item.Phase = JobPhase.Idle;
            }
            catch (Exception exception)
            {
                _items.Remove(item);
                Services.Toasts.Error(Ui.DescribeError(exception, Services.I18n));
            }

            RebuildList();
            Sync();
        }
    }

    private void RebuildList()
    {
        _list.Children.Clear();
        foreach (var item in _items)
        {
            item.Row = new ItemRow(this, item);
            _list.Children.Add(item.Row.Root);
        }
    }

    private void Remove(Item item)
    {
        if (IsBusy) return;
        _items.Remove(item);
        RebuildList();
        Sync();
    }

    private void Sync()
    {
        _count.Text = _items.Count.ToString(CultureInfo.InvariantCulture);
        _empty.IsVisible = _items.Count == 0;

        var pending = _items.Count(item => item.Info is not null);
        _runLabel.Text = Loc.T("convert.run", ("count", pending));
        _run.IsEnabled = pending > 0 && !IsBusy && _targets.Count > 0;
        _add.IsEnabled = !IsBusy;
        _stop.IsVisible = IsBusy;

        var visible = _phase is JobPhase.Preparing or JobPhase.Rendering or JobPhase.Done or JobPhase.Error;
        _job.IsVisible = visible;
        _bar.Value = Math.Clamp(_progress, 0, 1);
        _bar.IsVisible = IsBusy;
        _eta.Text = IsBusy && _etaSeconds > 0
            ? Loc.T("common.eta", ("time", Timecode.FormatEta(_etaSeconds)))
            : "";
        _percent.Text = IsBusy ? $"{(int)Math.Round(_progress * 100)}%" : _phase == JobPhase.Done ? "100%" : "";
        _status.Text = _phase switch
        {
            JobPhase.Preparing => Loc.T("common.preparing"),
            JobPhase.Rendering => Loc.T("common.rendering"),
            JobPhase.Done => Loc.T("convert.done", ("count", _items.Count(item => item.Phase == JobPhase.Done))),
            JobPhase.Error => _error,
            _ => "",
        };
        _status.Foreground = _phase == JobPhase.Error ? Ui.DangerBrush : Ui.MutedBrush;

        foreach (var item in _items) item.Row?.Sync();
    }

    private async Task RenderAsync()
    {
        if (IsBusy || _items.Count == 0) return;

        var target = SelectedTarget();
        if (target is null) return;

        var ready = _items.Where(item => item.Info is not null).ToList();
        if (ready.Count == 0) return;

        var cts = new CancellationTokenSource();
        _cts = cts;
        _busy = true;
        _phase = JobPhase.Preparing;
        _progress = 0;
        _etaSeconds = 0;
        _error = "";

        foreach (var item in ready)
        {
            item.Phase = JobPhase.Queued;
            item.Progress = 0;
            item.Error = "";
            item.Result = null;
        }
        Sync();

        try
        {
            var settings = Services.Settings.Params.Convert;

            for (var index = 0; index < ready.Count; index++)
            {
                cts.Token.ThrowIfCancellationRequested();
                var item = ready[index];
                item.Phase = JobPhase.Preparing;
                Sync();

                RenderResult result;
                try
                {
                    result = await Services.Engine.RenderConvertAsync(
                        item.Path,
                        item.Info,
                        target,
                        settings.VideoBitrate,
                        settings.AudioBitrate,
                        settings.Suffix,
                        new Progress<JobProgress>(progress =>
                        {
                            if (progress.Phase == JobPhase.Done) return;
                            item.Phase = progress.Phase;
                            item.Progress = progress.Ratio;
                            _phase = progress.Phase;
                            _progress = (index + Math.Clamp(progress.Ratio, 0, 1)) / ready.Count;
                            _etaSeconds = progress.EtaSeconds;
                            Sync();
                        }),
                        cts.Token);
                }
                catch (Exception exception) when (exception is OperationCanceledException || exception is AppException { Code: AppErrorCodes.Cancelled })
                {
                    throw;
                }
                catch (Exception exception)
                {
                    item.Phase = JobPhase.Error;
                    item.Progress = 0;
                    item.Error = Ui.DescribeError(exception, Services.I18n);
                    Services.Toasts.Error(item.Error);
                    Sync();
                    continue;
                }

                item.Phase = JobPhase.Done;
                item.Progress = 1;
                item.Result = result;
                _phase = JobPhase.Rendering;
                _progress = (index + 1d) / ready.Count;
                Sync();
            }

            _phase = JobPhase.Done;
            _progress = 1;
            _etaSeconds = 0;

            var last = ready.LastOrDefault(item => item.Result is not null)?.Result;
            if (last is not null)
            {
                Services.Toasts.Show(new ToastMessage(
                    Loc.T("desktop.savedTo", ("name", last.FileName), ("folder", Services.Output.Folder)),
                    ToastKind.Success,
                    () => Services.Output.Reveal(last.OutputPath),
                    Loc.T("desktop.reveal")));
            }
        }
        catch (Exception exception) when (exception is OperationCanceledException || exception is AppException { Code: AppErrorCodes.Cancelled })
        {
            foreach (var item in _items)
            {
                if (item.Phase is not (JobPhase.Queued or JobPhase.Preparing or JobPhase.Rendering)) continue;
                item.Phase = JobPhase.Idle;
                item.Progress = 0;
            }
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
            _busy = false;
            _cts = null;
            cts.Dispose();
            Sync();
        }
    }
}
