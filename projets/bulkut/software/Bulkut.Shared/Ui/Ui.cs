using System.Diagnostics;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Shapes;
using Avalonia.Layout;
using Avalonia.Media;
using Bulkut.Core.Models;
using Bulkut.Core.Services;

namespace Bulkut.Ui;

public static class Ui
{
    /// <summary>
    /// Set by a head that cannot rely on the desktop layout: the parameter card
    /// then sits above the list instead of beside it, which is the only thing
    /// that fits on a phone.
    /// </summary>
    public static bool CompactLayout { get; set; }

    /// <summary>
    /// Opens a URL. Heads without a shell (Android) install their own handler.
    /// </summary>
    public static Action<string>? ExternalOpener { get; set; }

    private static readonly IBrush Navy = new SolidColorBrush(Color.Parse("#0B1C46"));
    private static readonly IBrush NavySoft = new SolidColorBrush(Color.Parse("#1B356E"));
    private static readonly IBrush Muted = new SolidColorBrush(Color.Parse("#5B6B92"));
    private static readonly IBrush Danger = new SolidColorBrush(Color.Parse("#B3261E"));

    public static TextBlock Text(string value, string? classes = null, double? size = null, FontWeight? weight = null)
    {
        var block = new TextBlock { Text = value };
        if (!string.IsNullOrWhiteSpace(classes))
            foreach (var name in classes.Split(' ', StringSplitOptions.RemoveEmptyEntries))
                block.Classes.Add(name);
        if (size is not null) block.FontSize = size.Value;
        if (weight is not null) block.FontWeight = weight.Value;
        return block;
    }

    public static TextBlock Title(string key, LocScope loc, string classes = "h2") => loc.Text(key, classes);

    public static Button Button(string text, Action click, string classes = "", string? tooltip = null)
    {
        var button = new Button { Content = text };
        foreach (var name in classes.Split(' ', StringSplitOptions.RemoveEmptyEntries)) button.Classes.Add(name);
        button.Click += (_, _) => click();
        if (tooltip is not null) ToolTip.SetTip(button, tooltip);
        return button;
    }

    public static Button IconButton(string path, string tooltip, Action click, bool danger = false)
    {
        var button = new Button
        {
            Content = Icon(path, 16, danger ? Danger : NavySoft),
            Classes = { "icon" },
        };
        if (danger) button.Classes.Add("danger");
        ToolTip.SetTip(button, tooltip);
        button.Click += (_, _) => click();
        return button;
    }

    public static Avalonia.Controls.Shapes.Path Icon(string data, double size = 16, IBrush? stroke = null, double thickness = 1.8)
    {
        return new Avalonia.Controls.Shapes.Path
        {
            Data = Geometry.Parse(data),
            Stroke = stroke ?? NavySoft,
            StrokeThickness = thickness,
            StrokeLineCap = PenLineCap.Round,
            StrokeJoin = PenLineJoin.Round,
            Fill = null,
            Width = size,
            Height = size,
            Stretch = Stretch.Uniform,
        };
    }

    public static Border Pill(string text, string background = "#EAF1FF", string foreground = "#1B356E")
    {
        return new Border
        {
            Classes = { "pill" },
            Background = new SolidColorBrush(Color.Parse(background)),
            Child = new TextBlock
            {
                Text = text,
                FontSize = 11,
                FontWeight = FontWeight.SemiBold,
                Foreground = new SolidColorBrush(Color.Parse(foreground)),
            },
        };
    }

    public static StackPanel VStack(double spacing = 0) => new()
    {
        Orientation = Orientation.Vertical,
        Spacing = spacing,
    };

    public static StackPanel HStack(double spacing = 0) => new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = spacing,
        VerticalAlignment = VerticalAlignment.Center,
    };

    public static Border Card(Control child, string classes = "card") => new()
    {
        Classes = { classes },
        Child = child,
    };

    public static ProgressBar Progress() => new()
    {
        Minimum = 0,
        Maximum = 1,
        Value = 0,
        Height = 6,
    };

    public static Grid TwoColumns(Control left, Control right, double leftWidth = 330)
    {
        var grid = new Grid();
        if (CompactLayout)
        {
            grid.RowDefinitions = new RowDefinitions("Auto,14,Auto");
            Grid.SetRow(left, 0);
            Grid.SetRow(right, 2);
            grid.Children.Add(left);
            grid.Children.Add(right);
            return grid;
        }

        grid.ColumnDefinitions = new ColumnDefinitions($"{leftWidth},16,*");
        Grid.SetColumn(left, 0);
        Grid.SetColumn(right, 2);
        grid.Children.Add(left);
        grid.Children.Add(right);
        return grid;
    }

    public static string DescribeError(Exception exception, TranslationService i18n)
    {
        if (exception is OperationCanceledException)
            return i18n.T("errors.cancelled");

        if (exception is AppException appError)
        {
            var key = $"errors.{appError.Code}";
            var message = i18n.T(key, ("name", appError.Detail ?? ""));
            if (message != key) return message;

            if (!string.IsNullOrWhiteSpace(appError.Detail)) return appError.Detail;
        }

        return i18n.T("errors.unknown");
    }

    public static void OpenExternal(string url)
    {
        if (string.IsNullOrWhiteSpace(url)) return;

        if (ExternalOpener is not null)
        {
            ExternalOpener(url);
            return;
        }

        try
        {
            if (OperatingSystem.IsWindows())
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }
            else
            {
                var info = new ProcessStartInfo(OperatingSystem.IsMacOS() ? "open" : "xdg-open") { UseShellExecute = false };
                info.ArgumentList.Add(url);
                Process.Start(info);
            }
        }
        catch (Exception exception) when (exception is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
        }
    }

    public static string Version => typeof(Ui).Assembly.GetName().Version?.ToString(3) ?? "1.0.0";

    public static IBrush NavyBrush => Navy;
    public static IBrush MutedBrush => Muted;
    public static IBrush DangerBrush => Danger;
}
