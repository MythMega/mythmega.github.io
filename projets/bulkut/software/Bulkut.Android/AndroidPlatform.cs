using Android.App;
using Android.Content;
using AndroidX.Core.Content;
using Bulkut;
using Bulkut.Ui;

namespace BulkutMobile;

/// <summary>
/// Android has no home folder to write to. Renders land in the app's external
/// files folder, which every file manager can see under Android/data, and the
/// share sheet is offered as the "reveal" action.
/// </summary>
public static class AndroidPlatform
{
    public static AppServices CreateServices()
    {
        var context = Application.Context;
        var files = context.FilesDir?.AbsolutePath ?? Path.GetTempPath();
        var output = Path.Combine(context.GetExternalFilesDir(null)?.AbsolutePath ?? files, "Bulkut");
        Directory.CreateDirectory(output);

        Ui.ExternalOpener = OpenInBrowser;

        return new AppServices(new PlatformOptions(
            StateDirectory: Path.Combine(files, "state"),
            OutputFolder: output,
            OpenOutput: Share,
            Runner: new AndroidFfmpegRunner()));
    }

    /// <summary>
    /// Hands the rendered file to the system so it can be saved, sent or opened
    /// by another app — the closest thing to "show in folder".
    /// </summary>
    private static void Share(string path)
    {
        try
        {
            if (!File.Exists(path)) return;

            var context = Application.Context;
            var authority = $"{context.PackageName}.fileprovider";
            var uri = FileProvider.GetUriForFile(context, authority, new Java.IO.File(path));
            var mime = MimeFor(path);

            var send = new Intent(Intent.ActionSend);
            send.SetType(mime);
            send.PutExtra(Intent.ExtraStream, uri);
            send.AddFlags(ActivityFlags.GrantReadUriPermission);

            var chooser = Intent.CreateChooser(send, "Bulkut");
            if (chooser is null) return;
            chooser.AddFlags(ActivityFlags.NewTask);
            context.StartActivity(chooser);
        }
        catch (Exception exception) when (exception is ActivityNotFoundException or Java.Lang.Exception)
        {
            // Sharing is a convenience: a device without a share target is fine.
        }
    }

    private static string MimeFor(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".xml" => "application/xml",
        ".fcpxml" => "application/xml",
        ".json" => "application/json",
        ".txt" => "text/plain",
        _ => "video/*",
    };

    private static void OpenInBrowser(string url)
    {
        try
        {
            var intent = new Intent(Intent.ActionView, Android.Net.Uri.Parse(url));
            intent.AddFlags(ActivityFlags.NewTask);
            Application.Context.StartActivity(intent);
        }
        catch (Exception exception) when (exception is ActivityNotFoundException or Java.Lang.Exception)
        {
        }
    }
}
