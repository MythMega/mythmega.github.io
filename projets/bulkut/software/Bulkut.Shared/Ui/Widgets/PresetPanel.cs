using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Bulkut.Core.Models;

namespace Bulkut.Ui.Widgets;

public sealed class PresetPanel : StackPanel
{
    private readonly AppServices _services;
    private readonly string _scope;
    private readonly string _sectionKey;
    private readonly Func<Dictionary<string, double>> _numbers;
    private readonly Func<Dictionary<string, string>> _texts;
    private readonly Func<Dictionary<string, double>, Dictionary<string, string>, IReadOnlyList<(string Label, string Value)>> _recap;
    private readonly Func<Preset, string> _summarize;
    private readonly Action<Preset> _apply;

    public PresetPanel(
        LocScope loc,
        AppServices services,
        string scope,
        string sectionKey,
        Func<Dictionary<string, double>> numbers,
        Func<Dictionary<string, string>> texts,
        Func<Dictionary<string, double>, Dictionary<string, string>, IReadOnlyList<(string Label, string Value)>> recap,
        Func<Preset, string> summarize,
        Action<Preset> apply)
    {
        _services = services;
        _scope = scope;
        _sectionKey = sectionKey;
        _numbers = numbers;
        _texts = texts;
        _recap = recap;
        _summarize = summarize;
        _apply = apply;

        Orientation = Orientation.Horizontal;
        Spacing = 8;

        var save = new Button { Classes = { "ghost", "compact" } };
        loc.BindButton(save, "presets.save");
        save.Click += async (_, _) => await SaveAsync();
        Children.Add(save);

        var load = new Button { Classes = { "ghost", "compact" } };
        loc.BindButton(load, "presets.load");
        load.Click += async (_, _) => await LoadAsync();
        Children.Add(load);
    }

    private string Title(string key) =>
        _services.I18n.T(key, ("section", _services.I18n.T(_sectionKey)));

    private async Task SaveAsync()
    {
        var numbers = _numbers();
        var texts = _texts();
        var recap = _recap(numbers, texts);

        var preset = await DialogHost.ShowAsync<Preset?>(
            this,
            Title("presets.saveTitle"),
            done => BuildSaveBody(done, numbers, texts, recap),
            new DialogSize(470));

        if (preset is null) return;
        _services.Toasts.Success(_services.I18n.T("presets.saved", ("name", preset.Name)));
    }

    private async Task LoadAsync()
    {
        var preset = await DialogHost.ShowAsync<Preset?>(
            this,
            Title("presets.loadTitle"),
            done => new PresetLoadBody(_services, _scope, _summarize, done),
            new DialogSize(540, 500, MinHeight: 300));

        if (preset is null) return;
        _apply(preset);
        _services.Toasts.Success(_services.I18n.T("presets.loaded", ("name", preset.Name)));
    }

    private Control BuildSaveBody(
        Action<Preset?> done,
        Dictionary<string, double> numbers,
        Dictionary<string, string> texts,
        IReadOnlyList<(string Label, string Value)> recap)
    {
        var i18n = _services.I18n;
        var stack = Ui.VStack(12);
        stack.Children.Add(Ui.Text(i18n.T("presets.saveHint"), "muted"));
        stack.Children.Add(Ui.Text(i18n.T("presets.recapTitle"), "label"));

        var recapStack = Ui.VStack(5);
        foreach (var (label, value) in recap)
        {
            var row = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto") };
            row.Children.Add(Ui.Text(label, "muted"));
            var valueText = Ui.Text(value, "mono", 11.5);
            Grid.SetColumn(valueText, 1);
            row.Children.Add(valueText);
            recapStack.Children.Add(row);
        }
        stack.Children.Add(new Border { Classes = { "inset" }, Child = recapStack });

        stack.Children.Add(Ui.Text(i18n.T("presets.nameLabel"), "label"));
        var name = new TextBox { PlaceholderText = i18n.T("presets.namePlaceholder"), MaxLength = 40 };
        stack.Children.Add(name);

        var error = Ui.Text("", "danger", 11.5);
        error.IsVisible = false;
        stack.Children.Add(error);

        var buttons = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Right,
            Spacing = 8,
        };
        var cancel = new Button { Classes = { "ghost" }, Content = i18n.T("common.cancel") };
        cancel.Click += (_, _) => done(null);
        var save = new Button { Classes = { "primary" }, Content = i18n.T("presets.saveAction") };
        save.Click += (_, _) =>
        {
            try
            {
                done(_services.Presets.Save(_scope, name.Text, numbers, texts));
            }
            catch (AppException exception)
            {
                var key = $"errors.{exception.Code}";
                error.Text = i18n.T(key, ("name", exception.Detail ?? ""));
                error.IsVisible = true;
            }
        };
        buttons.Children.Add(cancel);
        buttons.Children.Add(save);
        stack.Children.Add(buttons);

        return stack;
    }

    /// <summary>The list of saved presets, rebuilt after a deletion.</summary>
    private sealed class PresetLoadBody : StackPanel
    {
        private readonly AppServices _services;
        private readonly string _scope;
        private readonly Func<Preset, string> _summarize;
        private readonly Action<Preset?> _done;
        private readonly StackPanel _list = new() { Spacing = 8 };
        private readonly TextBlock _empty;

        public PresetLoadBody(AppServices services, string scope, Func<Preset, string> summarize, Action<Preset?> done)
        {
            _services = services;
            _scope = scope;
            _summarize = summarize;
            _done = done;

            Orientation = Orientation.Vertical;
            Spacing = 12;

            _empty = Ui.Text(services.I18n.T("presets.empty"), "muted");
            Children.Add(Ui.Text(services.I18n.T("presets.loadHint"), "muted"));
            Children.Add(new ScrollViewer
            {
                Content = _list,
                MaxHeight = 350,
                VerticalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Auto,
            });
            Children.Add(_empty);

            var close = new Button
            {
                Classes = { "ghost" },
                Content = services.I18n.T("common.close"),
                HorizontalAlignment = HorizontalAlignment.Right,
            };
            close.Click += (_, _) => _done(null);
            Children.Add(close);

            Refresh();
        }

        private void Refresh()
        {
            _list.Children.Clear();
            var presets = _services.Presets.List(_scope);
            _empty.IsVisible = presets.Count == 0;

            foreach (var preset in presets)
            {
                var stack = Ui.VStack(3);
                stack.Children.Add(Ui.Text(preset.Name, "h3"));
                stack.Children.Add(Ui.Text(_summarize(preset), "muted", 11.5));
                if (DateTimeOffset.TryParse(preset.CreatedAt, out var created))
                    stack.Children.Add(Ui.Text(created.LocalDateTime.ToString("g"), "muted", 10.5));

                var load = new Button { Classes = { "primary", "compact" }, Content = _services.I18n.T("presets.load") };
                load.Click += (_, _) => _done(preset);

                var delete = new Button { Classes = { "danger", "compact" }, Content = _services.I18n.T("presets.delete") };
                var armed = false;
                delete.Click += (_, _) =>
                {
                    if (!armed)
                    {
                        armed = true;
                        delete.Content = _services.I18n.T("presets.confirmDelete");
                        return;
                    }
                    _services.Presets.Delete(_scope, preset.Name);
                    _services.Toasts.Info(_services.I18n.T("presets.deleted", ("name", preset.Name)));
                    Refresh();
                };

                var buttons = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
                buttons.Children.Add(load);
                buttons.Children.Add(delete);
                buttons.VerticalAlignment = VerticalAlignment.Center;

                var row = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto") };
                row.Children.Add(stack);
                Grid.SetColumn(buttons, 1);
                row.Children.Add(buttons);

                _list.Children.Add(new Border { Classes = { "inset" }, Child = row });
            }
        }
    }
}
