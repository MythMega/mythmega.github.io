using Android.App;
using Avalonia;
using Avalonia.Android;

namespace BulkutMobile;

/// <summary>
/// Hosts the shared Avalonia view. The application type below is what tells
/// Avalonia which <see cref="Bulkut.App"/> to build.
/// </summary>
[Activity(
    Label = "@string/app_name",
    Theme = "@style/MyTheme.NoActionBar",
    Icon = "@mipmap/appicon",
    MainLauncher = true,
    ScreenOrientation = Android.Content.PM.ScreenOrientation.Unspecified,
    ConfigurationChanges = Android.Content.PM.ConfigChanges.Orientation
                           | Android.Content.PM.ConfigChanges.ScreenSize
                           | Android.Content.PM.ConfigChanges.UiMode
                           | Android.Content.PM.ConfigChanges.SmallestScreenSize)]
public class MainActivity : AvaloniaMainActivity
{
}

[Application(Label = "@string/app_name", Theme = "@style/MyTheme.NoActionBar")]
public class MainApplication : AvaloniaAndroidApplication<Bulkut.App>
{
    public MainApplication(IntPtr handle, Android.Runtime.JniHandleOwnership transfer)
        : base(handle, transfer)
    {
    }

    protected override AppBuilder CustomizeAppBuilder(AppBuilder builder)
    {
        // The picker copies content:// URIs into the cache, so every view keeps
        // working with real paths. This must run before the UI is created.
        Bulkut.App.ServicesFactory = AndroidPlatform.CreateServices;
        return base.CustomizeAppBuilder(builder).WithInterFont();
    }
}
