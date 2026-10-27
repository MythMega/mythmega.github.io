using Avalonia;
using Avalonia.Controls;

namespace Bulkut;

/// <summary>The desktop shell: a window sized from the shared desktop settings.</summary>
public sealed class MainWindow : Window
{
    public MainWindow(AppServices services)
    {
        Title = "Bulkut";
        Width = services.Settings.Desktop.Window.Width;
        Height = services.Settings.Desktop.Window.Height;
        MinWidth = services.Settings.Desktop.Window.MinWidth;
        MinHeight = services.Settings.Desktop.Window.MinHeight;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;

        Content = new MainView(services);
    }
}
