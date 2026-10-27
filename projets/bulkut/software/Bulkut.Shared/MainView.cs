using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Platform.Storage;
using Avalonia.Threading;
using Bulkut.Core.Models;
using Bulkut.Core.Services;
using Bulkut.Ui;
using Bulkut.Ui.Views;
using UiFactory = Bulkut.Ui.Ui;

namespace Bulkut;

/// <summary>
/// The application shell: header, tabs, content and toasts. It is a plain view
/// so the desktop window and the Android activity can both host it.
/// </summary>
public sealed class MainView : UserControl
{
    private static readonly (string Key, string Icon)[] TabDefinitions =
    [
        ("autocut", "M4 6h4l2 3h4l2 3h4 M4 18h4l2-3h4l2-3h4"),
        ("fastcut", "M6 3.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8Z M6 15.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8Z M8 7.4 19 19 M8 16.6 19 5"),
        ("reverse", "M4 9a7 7 0 0 1 12-3.5 M16 2.5V6h-3.5 M20 15a7 7 0 0 1-12 3.5 M8 21.5V18h3.5"),
        ("collage", "M3 7.5a2.2 2.2 0 0 1 2.2-2.2h7.6A2.2 2.2 0 0 1 15 7.5v3.8a2.2 2.2 0 0 1-2.2 2.2H5.2A2.2 2.2 0 0 1 3 11.3V7.5Z M9 12.7a2.2 2.2 0 0 1 2.2-2.2h7.6a2.2 2.2 0 0 1 2.2 2.2v3.8a2.2 2.2 0 0 1-2.2 2.2h-7.6A2.2 2.2 0 0 1 9 16.5v-3.8Z"),
        ("introoutro", "M8.5 4.5H4v15h4.5 M15.5 4.5H20v15h-4.5 M9.5 9l4.5 3-4.5 3v-6Z"),
        ("splitter", "M4 5v14 M20 5v14 M8 8h3v8H8V8Z M13 8h3v8h-3V8Z"),
    ];

    private static readonly IBrush TabInk = new SolidColorBrush(Color.Parse("#1B356E"));

    private readonly AppServices _services;
    private readonly LocScope _loc;
    private readonly ContentControl _content = new();
    private readonly StackPanel _tabBar = UiFactory.HStack(4);
    private readonly StackPanel _toasts = new()
    {
        Spacing = 8,
        VerticalAlignment = VerticalAlignment.Bottom,
        HorizontalAlignment = HorizontalAlignment.Right,
        Margin = new Thickness(22),
        MaxWidth = 430,
    };
    private readonly ModalLayer _modals = new();
    private readonly Dictionary<string, (Button Button, FeatureView View)> _views = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, (TextBlock Label, Avalonia.Controls.Shapes.Path Icon)> _tabVisuals = new(StringComparer.OrdinalIgnoreCase);
    private readonly TextBlock _engineText;
    private readonly Avalonia.Controls.Shapes.Ellipse _engineDot;
    private readonly TextBlock _outputLabel;
    private readonly ComboBox _language;
    private string _currentTab = "autocut";
    private bool _viewsBuilt;
    private bool _engineReady;
    private bool _syncingLanguage;
    private EngineState _engineState = EngineState.Checking;

    public MainView(AppServices services)
    {
        _services = services;
        _loc = new LocScope(services.I18n);

        Background = Gradient();
        _engineText = UiFactory.Text(_loc.T("engine.idle"), "muted", 11.5, FontWeight.SemiBold);
        _engineDot = new Avalonia.Controls.Shapes.Ellipse { Width = 7, Height = 7, Fill = new SolidColorBrush(Color.Parse("#93A5C4")) };
        _outputLabel = UiFactory.Text("", "muted", 11.5);

        _language = new ComboBox
        {
            ItemsSource = services.I18n.Languages.Select(lang => lang.ToUpperInvariant()).ToList(),
            SelectedIndex = Math.Max(0, services.I18n.Languages.ToList().IndexOf(services.I18n.Language)),
            MinWidth = 68,
        };
        _language.SelectionChanged += (_, _) => ChangeLanguage();
        ToolTip.SetTip(_language, _loc.T("lang.label"));

        Content = BuildLayout();
        DialogHost.Layer = _modals;
        _services.Toasts.Shown += ShowToast;

        AttachedToVisualTree += async (_, _) => await StartEngineAsync();
    }

    private Control BuildLayout()
    {
        var root = new Grid
        {
            RowDefinitions = new RowDefinitions("Auto,Auto,*,Auto"),
            Margin = UiFactory.CompactLayout ? new Thickness(10, 8, 10, 8) : new Thickness(18, 14, 18, 12),
        };

        var header = new Border
        {
            Classes = { "glass" },
            Padding = new Thickness(18, 12),
            Margin = new Thickness(0, 0, 0, 10),
        };
        var headerGrid = new Grid();
        var actions = UiFactory.HStack(12);
        actions.Children.Add(BuildEngineChip());
        actions.Children.Add(_language);
        headerGrid.Children.Add(BuildBrand());

        if (UiFactory.CompactLayout)
        {
            // A phone cannot fit the brand and the engine chip side by side.
            headerGrid.RowDefinitions = new RowDefinitions("Auto,10,Auto");
            Grid.SetRow(actions, 2);
        }
        else
        {
            headerGrid.ColumnDefinitions = new ColumnDefinitions("*,Auto");
            Grid.SetColumn(actions, 1);
        }

        headerGrid.Children.Add(actions);
        header.Child = headerGrid;

        var tabsBorder = new Border
        {
            Classes = { "glass" },
            Padding = new Thickness(7),
            Margin = new Thickness(0, 0, 0, 12),
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        BuildTabs();
        tabsBorder.Child = new ScrollViewer
        {
            Content = _tabBar,
            HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled,
        };

        var contentBorder = new ScrollViewer
        {
            Content = _content,
            HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled,
            VerticalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Auto,
            Padding = new Thickness(0, 0, 4, 0),
        };

        var footer = BuildFooter();

        Grid.SetRow(header, 0);
        Grid.SetRow(tabsBorder, 1);
        Grid.SetRow(contentBorder, 2);
        Grid.SetRow(footer, 3);
        root.Children.Add(header);
        root.Children.Add(tabsBorder);
        root.Children.Add(contentBorder);
        root.Children.Add(footer);

        var overlay = new Grid { IsHitTestVisible = true };
        overlay.Children.Add(root);
        overlay.Children.Add(_toasts);
        overlay.Children.Add(_modals);
        _toasts.IsHitTestVisible = true;
        return new Border { Background = Gradient(), Child = overlay };
    }

    private Control BuildBrand()
    {
        var mark = new Border
        {
            Width = 42,
            Height = 42,
            CornerRadius = new CornerRadius(13),
            Background = new SolidColorBrush(Color.Parse("#0B1C46")),
            Child = new Viewbox
            {
                Width = 26,
                Height = 26,
                Child = new Canvas
                {
                    Width = 32,
                    Height = 32,
                    Children =
                    {
                        new Avalonia.Controls.Shapes.Path
                        {
                            Data = Geometry.Parse("M7 22.5 15 16 7 9.5"),
                            Stroke = Brushes.White,
                            StrokeThickness = 2.6,
                            StrokeLineCap = PenLineCap.Round,
                            StrokeJoin = PenLineJoin.Round,
                        },
                        new Avalonia.Controls.Shapes.Path
                        {
                            Data = Geometry.Parse("M17 23h8"),
                            Stroke = new SolidColorBrush(Color.Parse("#7BA4FF")),
                            StrokeThickness = 2.6,
                            StrokeLineCap = PenLineCap.Round,
                        },
                    },
                },
            },
        };

        var copy = UiFactory.VStack(1);
        copy.Children.Add(_loc.Text("app.name", "h1"));
        copy.Children.Add(_loc.Text("app.tagline", "muted"));

        var stack = UiFactory.HStack(12);
        stack.Children.Add(mark);
        stack.Children.Add(copy);
        return stack;
    }

    private Control BuildEngineChip()
    {
        var stack = UiFactory.HStack(7);
        stack.Children.Add(_engineDot);
        stack.Children.Add(_engineText);
        return new Border
        {
            Classes = { "pill" },
            Padding = new Thickness(11, 6),
            Child = stack,
            VerticalAlignment = VerticalAlignment.Center,
        };
    }

    private void BuildTabs()
    {
        foreach (var (key, icon) in TabDefinitions)
        {
            var content = UiFactory.HStack(7);
            var iconControl = UiFactory.Icon(icon, 16, TabInk, 1.9);
            content.Children.Add(iconControl);
            var label = new TextBlock { FontSize = 12.5, FontWeight = FontWeight.SemiBold, Foreground = TabInk };
            content.Children.Add(label);

            var button = new Button
            {
                Classes = { "tab" },
                Content = content,
                Tag = key,
            };
            _loc.Bind(label, $"nav.{key}");
            button.Click += (_, _) => SelectTab(key);
            _tabBar.Children.Add(button);
            _views[key] = (button, null!);
            _tabVisuals[key] = (label, iconControl);
        }
        UpdateTabClasses();
    }

    private Control BuildFooter()
    {
        var left = UiFactory.CompactLayout ? UiFactory.VStack(2) : UiFactory.HStack(8);
        left.Children.Add(_loc.Text("desktop.footer", "muted"));
        if (!UiFactory.CompactLayout) left.Children.Add(UiFactory.Text("·", "muted"));
        left.Children.Add(UiFactory.Text($"{_loc.T("app.versionLabel")} {_services.Settings.Config.App.Version}", "muted"));

        var right = UiFactory.HStack(10);
        // The Android output folder is fixed and long enough to crowd the row.
        if (!UiFactory.CompactLayout) right.Children.Add(_outputLabel);

        if (!UiFactory.CompactLayout)
        {
            var folderButton = new Button
            {
                Classes = { "ghost", "compact" },
                Content = _loc.Text("desktop.outputFolder", "label"),
            };
            ToolTip.SetTip(folderButton, _loc.T("desktop.chooseFolder"));
            folderButton.Click += async (_, _) => await ChooseOutputFolderAsync();
            right.Children.Add(folderButton);
        }

        var web = new Button { Classes = { "ghost", "compact" }, Content = _loc.Text("desktop.web", "label") };
        web.Click += (_, _) => UiFactory.OpenExternal(WebUrl);
        right.Children.Add(web);

        var grid = new Grid { Margin = new Thickness(4, 8, 4, 0) };
        grid.Children.Add(left);

        if (UiFactory.CompactLayout)
        {
            grid.RowDefinitions = new RowDefinitions("Auto,Auto");
            Grid.SetRow(right, 1);
            right.Margin = new Thickness(0, 6, 0, 0);
        }
        else
        {
            grid.ColumnDefinitions = new ColumnDefinitions("*,Auto");
            Grid.SetColumn(right, 1);
        }

        grid.Children.Add(right);
        UpdateOutputLabel();
        return grid;
    }

    private string WebUrl => string.IsNullOrWhiteSpace(_services.Settings.Config.App.WebUrl)
        ? "https://mythmega.github.io/projets/bulkut/"
        : _services.Settings.Config.App.WebUrl;

    private async Task StartEngineAsync()
    {
        _engineReady = false;
        UpdateTabClasses();
        SetEngineStatus(EngineState.Checking, _loc.T("desktop.engineChecking"));
        ShowLoading();

        var progress = new Progress<EngineStatus>(status =>
        {
            var text = status.State switch
            {
                EngineState.Downloading when status.Message == "extracting" => _loc.T("desktop.engineChecking"),
                EngineState.Downloading => _loc.T("desktop.engineDownloading", ("percent", Math.Round(status.Ratio * 100))),
                EngineState.Ready => _loc.T("desktop.engineReady"),
                EngineState.Failed => _loc.T("desktop.engineFailed"),
                _ => _loc.T("desktop.engineChecking"),
            };
            SetEngineStatus(status.State, text);
            UpdateLoading(status);
        });

        try
        {
            await _services.Ffmpeg.EnsureAvailableAsync(progress);
            _engineReady = true;
            SetEngineStatus(EngineState.Ready, _loc.T("desktop.engineReady"));
            BuildViews();
            SelectTab(_currentTab);
            UpdateTabClasses();
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            SetEngineStatus(EngineState.Failed, _loc.T("desktop.engineFailed"));
            ShowEngineError(exception);
        }
    }

    private void BuildViews()
    {
        if (_viewsBuilt) return;
        _viewsBuilt = true;

        AddView("autocut", new AutocutView(_services));
        AddView("fastcut", new FastcutView(_services));
        AddView("reverse", new ReverseView(_services));
        AddView("introoutro", new IntroOutroView(_services));
        AddView("collage", new CollageView(_services));
        AddView("splitter", new SplitterView(_services));
    }

    private void AddView(string key, FeatureView view)
    {
        if (!_views.TryGetValue(key, out var entry)) return;
        _views[key] = (entry.Button, view);
    }

    private void SelectTab(string key)
    {
        if (!_views.TryGetValue(key, out var entry)) return;
        if (_viewsBuilt && entry.View is null) return;

        _currentTab = key;
        if (_viewsBuilt) _content.Content = entry.View;
        UpdateTabClasses();
    }

    private void UpdateTabClasses()
    {
        foreach (var (key, (button, _)) in _views)
        {
            button.Classes.Remove("active");
            var active = string.Equals(key, _currentTab, StringComparison.OrdinalIgnoreCase);
            if (active) button.Classes.Add("active");
            if (_tabVisuals.TryGetValue(key, out var visual))
            {
                visual.Label.Foreground = active ? Brushes.White : TabInk;
                visual.Icon.Stroke = active ? Brushes.White : TabInk;
            }
            button.IsEnabled = _engineReady;
        }
    }

    private void ChangeLanguage()
    {
        if (_syncingLanguage) return;
        var index = _language.SelectedIndex;
        if (index < 0 || index >= _services.I18n.Languages.Count) return;

        _syncingLanguage = true;
        try
        {
            var language = _services.I18n.Languages[index];
            if (_services.I18n.SetLanguage(language))
            {
                _services.Settings.State.Language = language;
                _services.Settings.Save();
                _loc.Refresh();
                foreach (var (_, view) in _views.Values) view?.RefreshLanguage();
                UpdateEngineTextForState();
                UpdateOutputLabel();
                ShowToast(new ToastMessage(_loc.T("toasts.languageChanged", ("language", _services.I18n.LanguageLabel(language))), ToastKind.Info));
            }
        }
        finally
        {
            _syncingLanguage = false;
        }
    }

    private void SetEngineStatus(EngineState state, string text)
    {
        _engineState = state;
        _engineText.Text = text;
        _engineDot.Fill = new SolidColorBrush(Color.Parse(state switch
        {
            EngineState.Ready => "#2E9E6B",
            EngineState.Failed => "#C43B32",
            EngineState.Downloading => "#2E5BFF",
            _ => "#93A5C4",
        }));
    }

    private void UpdateEngineTextForState()
    {
        var text = _engineState switch
        {
            EngineState.Ready => _loc.T("desktop.engineReady"),
            EngineState.Failed => _loc.T("desktop.engineFailed"),
            _ => _loc.T("engine.idle"),
        };
        SetEngineStatus(_engineState, text);
    }

    private void ShowLoading()
    {
        var stack = UiFactory.VStack(14);
        stack.MaxWidth = 560;
        stack.Children.Add(_loc.Text("app.name", "h1"));
        stack.Children.Add(_loc.Text("desktop.engineHint", "muted"));
        var status = UiFactory.Text(_loc.T("desktop.engineChecking"), "label");
        status.Name = "EngineLoadingStatus";
        stack.Children.Add(status);
        var bar = UiFactory.Progress();
        bar.Name = "EngineLoadingBar";
        bar.IsIndeterminate = true;
        stack.Children.Add(bar);

        var retry = new Button { Classes = { "primary" }, Content = _loc.Text("desktop.engineRetry", "label") };
        retry.Name = "EngineRetry";
        retry.IsVisible = false;
        retry.Click += async (_, _) => await StartEngineAsync();
        stack.Children.Add(retry);

        var card = new Border
        {
            Classes = { "card" },
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 50, 0, 50),
            Child = stack,
        };
        _content.Content = card;
    }

    private void UpdateLoading(EngineStatus status)
    {
        if (_content.Content is not Border { Child: StackPanel stack }) return;
        foreach (var child in stack.Children)
        {
            if (child is TextBlock { Name: "EngineLoadingStatus" } text)
                text.Text = status.State == EngineState.Downloading && status.Message == "downloading"
                    ? _loc.T("desktop.engineDownloading", ("percent", Math.Round(status.Ratio * 100)))
                    : _loc.T("desktop.engineChecking");
            if (child is ProgressBar { Name: "EngineLoadingBar" } bar && status.State == EngineState.Downloading)
            {
                bar.IsIndeterminate = false;
                bar.Value = status.Ratio;
            }
        }
    }

    private void ShowEngineError(Exception exception)
    {
        var stack = UiFactory.VStack(14);
        stack.MaxWidth = 620;
        stack.Children.Add(_loc.Text("desktop.engineFailed", "h1"));
        stack.Children.Add(_loc.Text("desktop.engineHint", "muted"));
        stack.Children.Add(UiFactory.Text(_services.Ffmpeg.InstallDirectory, "mono", 11.5));
        var message = UiFactory.Text(UiFactory.DescribeError(exception, _services.I18n), "danger", 12);
        stack.Children.Add(message);
        var retry = new Button { Classes = { "primary" }, Content = _loc.Text("desktop.engineRetry", "label") };
        retry.Click += async (_, _) => await StartEngineAsync();
        stack.Children.Add(retry);
        _content.Content = new Border
        {
            Classes = { "card" },
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 50, 0, 50),
            Child = stack,
        };
    }

    private void UpdateOutputLabel() => _outputLabel.Text = _services.OutputFolder;

    private async Task ChooseOutputFolderAsync()
    {
        try
        {
            var folders = await TopLevel.GetTopLevel(this)!.StorageProvider.OpenFolderPickerAsync(new FolderPickerOpenOptions
            {
                AllowMultiple = false,
                Title = _loc.T("desktop.selectFolderTitle"),
            });
            var path = folders.FirstOrDefault()?.TryGetLocalPath();
            if (string.IsNullOrWhiteSpace(path)) return;
            _services.SetOutputFolder(path);
            UpdateOutputLabel();
        }
        catch (Exception exception) when (exception is InvalidOperationException or System.Runtime.InteropServices.COMException)
        {
            _services.Toasts.Error(UiFactory.DescribeError(exception, _services.I18n));
        }
    }

    private void ShowToast(ToastMessage message)
    {
        Dispatcher.UIThread.Post(() =>
        {
            var content = UiFactory.HStack(10);
            var icon = message.Kind switch
            {
                ToastKind.Success => "M5 12l4.5 4.5L19 7",
                ToastKind.Error => "M6 6l12 12 M18 6 6 18",
                _ => "M12 8v8 M12 5v.5",
            };
            content.Children.Add(UiFactory.Icon(icon, 15, message.Kind == ToastKind.Error ? UiFactory.DangerBrush : UiFactory.NavyBrush, 2));
            var text = UiFactory.Text(message.Message, null, 12);
            text.MaxWidth = UiFactory.CompactLayout ? 220 : 330;
            content.Children.Add(text);

            if (message.Action is not null && message.ActionLabel is not null)
            {
                var action = new Button { Classes = { "ghost", "compact" }, Content = message.ActionLabel };
                action.Click += (_, _) => message.Action();
                content.Children.Add(action);
            }

            var close = new Button { Classes = { "icon" }, Content = UiFactory.Icon("M6 6l12 12 M18 6 6 18", 12, UiFactory.MutedBrush, 2) };
            content.Children.Add(close);

            var border = new Border
            {
                Classes = { "glass" },
                Background = new SolidColorBrush(Color.Parse(message.Kind switch
                {
                    ToastKind.Error => "#FFF1F0",
                    ToastKind.Success => "#F0FBF5",
                    _ => "#F2F6FF",
                })),
                Padding = new Thickness(13, 10),
                Child = content,
            };
            close.Click += (_, _) => _toasts.Children.Remove(border);
            _toasts.Children.Insert(0, border);

            var delay = Math.Max(1200, _services.Settings.Config.Ui.ToastDuration);
            _ = Task.Delay(delay).ContinueWith(_ => Dispatcher.UIThread.Post(() => _toasts.Children.Remove(border)));
        });
    }

    private static IBrush Gradient()
    {
        var brush = new LinearGradientBrush
        {
            StartPoint = new RelativePoint(0, 0, RelativeUnit.Relative),
            EndPoint = new RelativePoint(1, 1, RelativeUnit.Relative),
        };
        brush.GradientStops.Add(new GradientStop(Color.Parse("#F8FBFF"), 0));
        brush.GradientStops.Add(new GradientStop(Color.Parse("#EDF3FF"), 0.55));
        brush.GradientStops.Add(new GradientStop(Color.Parse("#E4ECFC"), 1));
        return brush;
    }
}
