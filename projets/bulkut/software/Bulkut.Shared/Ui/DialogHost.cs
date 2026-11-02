using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;

namespace Bulkut.Ui;

/// <summary>Size of a modal surface, in device-independent pixels.</summary>
public sealed record DialogSize(double Width = 520, double Height = 0, double MinHeight = 0);

/// <summary>
/// Shows a modal surface. Desktop opens a child window; single-view platforms
/// (Android) have no windows at all, so the shell provides a layer that the same
/// content is dropped into. The caller only ever sees the result value.
/// </summary>
public static class DialogHost
{
    /// <summary>Set by the shell when the platform cannot open a second window.</summary>
    public static IModalLayer? Layer { get; set; }

    public static Task<T?> ShowAsync<T>(
        Visual anchor,
        string title,
        Func<Action<T?>, Control> build,
        DialogSize? size = null)
    {
        var top = TopLevel.GetTopLevel(anchor);
        return top is Window window
            ? ShowWindow(window, title, build, size ?? new DialogSize())
            : ShowInline(title, build);
    }

    private static Task<T?> ShowWindow<T>(
        Window owner,
        string title,
        Func<Action<T?>, Control> build,
        DialogSize size)
    {
        var completion = new TaskCompletionSource<T?>();
        var dialog = new Window
        {
            Title = title,
            Width = size.Width,
            Height = size.Height > 0 ? size.Height : double.NaN,
            MinWidth = Math.Min(size.Width, 320),
            MinHeight = size.MinHeight,
            SizeToContent = size.Height > 0 ? SizeToContent.Manual : SizeToContent.Height,
            CanResize = size.Height > 0,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            ShowInTaskbar = false,
            Background = new SolidColorBrush(Color.Parse("#F3F7FF")),
        };

        dialog.Content = new Border
        {
            Margin = new Thickness(18),
            Child = new Border { Classes = { "card" }, Child = build(result =>
            {
                completion.TrySetResult(result);
                dialog.Close();
            }) },
        };

        dialog.Closed += (_, _) => completion.TrySetResult(default);
        _ = dialog.ShowDialog(owner);
        return completion.Task;
    }

    private static Task<T?> ShowInline<T>(string title, Func<Action<T?>, Control> build)
    {
        var completion = new TaskCompletionSource<T?>();
        var layer = Layer ?? throw new InvalidOperationException("No modal layer was registered by the shell.");

        IDisposable? surface = null;
        var body = build(result =>
        {
            completion.TrySetResult(result);
            surface?.Dispose();
        });

        surface = layer.Show(title, body);
        return completion.Task;
    }
}

public interface IModalLayer
{
    IDisposable Show(string title, Control body);
}

/// <summary>
/// The inline modal layer: a scrim plus a card on top of the whole window. Used
/// on Android, where <c>Window.ShowDialog</c> has nothing to open.
/// </summary>
public sealed class ModalLayer : Grid, IModalLayer
{
    private readonly Border _scrim;
    private readonly TextBlock _title;
    private readonly ContentControl _slot;
    private readonly ScrollViewer _scroll;

    public ModalLayer()
    {
        IsVisible = false;
        Background = Brushes.Transparent;
        Margin = new Thickness(0);

        _scrim = new Border { Background = new SolidColorBrush(Color.Parse("#1B2A4A"), 0.42) };
        Children.Add(_scrim);

        _title = new TextBlock { Classes = { "h2" }, TextWrapping = TextWrapping.Wrap };
        _slot = new ContentControl();
        _scroll = new ScrollViewer
        {
            VerticalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Auto,
            MaxHeight = 620,
            Content = _slot,
        };

        var stack = new StackPanel { Spacing = 12 };
        stack.Children.Add(_title);
        stack.Children.Add(_scroll);

        var card = new Border
        {
            Classes = { "card" },
            Margin = new Thickness(18),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            MaxWidth = 620,
            Child = stack,
        };
        Children.Add(card);

        _scrim.PointerPressed += (_, _) => Close();
    }

    public IDisposable Show(string title, Control body)
    {
        _title.Text = title;
        _slot.Content = body;
        IsVisible = true;
        return new Handle(this);
    }

    private void Close()
    {
        IsVisible = false;
        _slot.Content = null;
    }

    private sealed class Handle(ModalLayer layer) : IDisposable
    {
        public void Dispose() => layer.Close();
    }
}
