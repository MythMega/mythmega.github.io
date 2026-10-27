using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;

namespace Bulkut;

public partial class App : Application
{
    /// <summary>
    /// Set by a head that needs its own paths, such as the Android app. When it
    /// stays null the desktop defaults are used.
    /// </summary>
    public static Func<AppServices>? ServicesFactory { get; set; }

    public override void Initialize() => AvaloniaXamlLoader.Load(this);

    public override void OnFrameworkInitializationCompleted()
    {
        switch (ApplicationLifetime)
        {
            case IClassicDesktopStyleApplicationLifetime desktop:
                desktop.MainWindow = new MainWindow(CreateServices());
                break;
            case ISingleViewApplicationLifetime single:
                Ui.Ui.CompactLayout = true;
                single.MainView = new MainView(CreateServices());
                break;
        }

        base.OnFrameworkInitializationCompleted();
    }

    private static AppServices CreateServices() => ServicesFactory?.Invoke() ?? new AppServices();
}
