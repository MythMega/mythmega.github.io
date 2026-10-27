using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Layout;
using Avalonia.Media;

namespace Bulkut.Ui.Widgets;

/// <summary>
/// Import zone. A transparent overlay covers the whole padded area so clicks
/// and file drops work everywhere in the box, not only on the text and icon.
/// </summary>
public sealed class DropZone : Border
{
    private static readonly IBrush IdleBorder = new SolidColorBrush(Color.Parse("#9DB9E4"));
    private static readonly IBrush ActiveBorder = new SolidColorBrush(Color.Parse("#2E5BFF"));

    private readonly bool _multiple;
    private readonly Func<IReadOnlyList<string>, Task> _onFiles;

    public DropZone(
        LocScope loc,
        bool multiple,
        Func<IReadOnlyList<string>, Task> onFiles,
        string titleKey = "common.dropTitle",
        string noteKey = "desktop.storageNote")
    {
        _multiple = multiple;
        _onFiles = onFiles;

        // A phone has no drag and drop, and picks files through a document
        // picker that copies them into the app first.
        if (Ui.CompactLayout)
        {
            if (titleKey == "common.dropTitle") titleKey = "mobile.dropTitle";
            if (titleKey == "common.dropFileTitle") titleKey = "mobile.dropFileTitle";
            if (noteKey == "desktop.storageNote") noteKey = "mobile.storageNote";
        }

        Classes.Add("dropzone");
        MinHeight = 112;

        var stack = Ui.VStack(5);
        stack.HorizontalAlignment = HorizontalAlignment.Center;
        stack.VerticalAlignment = VerticalAlignment.Center;
        stack.IsHitTestVisible = false;
        stack.Children.Add(new Border
        {
            Background = new SolidColorBrush(Color.Parse("#E7EFFF")),
            CornerRadius = new CornerRadius(20),
            Width = 38,
            Height = 38,
            Child = Ui.Icon("M3 7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7Z M10 9.5l5 2.5-5 2.5v-5Z", 19),
        });
        stack.Children.Add(loc.Text(titleKey, "h3"));
        stack.Children.Add(loc.Text("common.browse", "label"));
        stack.Children.Add(loc.Text(noteKey, "muted"));

        var overlay = new Border
        {
            Background = Brushes.Transparent,
            Cursor = new Cursor(StandardCursorType.Hand),
            IsHitTestVisible = true,
        };

        var grid = new Grid();
        grid.Children.Add(stack);
        grid.Children.Add(overlay);
        Child = grid;

        Wire(overlay);
        Wire(this);

        void Wire(Control target)
        {
            DragDrop.SetAllowDrop(target, true);

            target.AddHandler(DragDrop.DragOverEvent, (_, args) =>
            {
                if (!HasFiles(args.DataTransfer)) return;
                args.DragEffects = DragDropEffects.Copy;
                args.Handled = true;
                BorderBrush = ActiveBorder;
            }, RoutingStrategies.Tunnel | RoutingStrategies.Bubble);

            target.AddHandler(DragDrop.DragLeaveEvent, (_, _) =>
                BorderBrush = IdleBorder,
                RoutingStrategies.Tunnel | RoutingStrategies.Bubble);

            target.AddHandler(DragDrop.DropEvent, async (_, args) =>
            {
                BorderBrush = IdleBorder;
                args.Handled = true;
                var paths = FilePicker.LocalPaths(args.DataTransfer);
                if (paths.Count == 0) return;
                await _onFiles(_multiple ? paths : [paths[0]]);
            }, RoutingStrategies.Tunnel | RoutingStrategies.Bubble);
        }

        PointerReleased += async (_, args) =>
        {
            if (args.Handled || args.InitialPressMouseButton != MouseButton.Left) return;
            await BrowseAsync();
        };
    }

    private static bool HasFiles(IDataTransfer data)
    {
        try
        {
            if (data.Contains(DataFormat.File)) return true;
            var files = data.TryGetFiles();
            return files is { Length: > 0 };
        }
        catch (Exception)
        {
            return false;
        }
    }

    private async Task BrowseAsync()
    {
        var paths = await FilePicker.PickVideosAsync(this, _multiple);
        if (paths.Count == 0) return;
        await _onFiles(_multiple ? paths : [paths[0]]);
    }
}
