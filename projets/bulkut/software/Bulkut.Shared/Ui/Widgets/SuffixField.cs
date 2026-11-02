using Avalonia.Controls;
using Avalonia.Input;
using Bulkut.Core.Features;

namespace Bulkut.Ui.Widgets;

public sealed class SuffixField : StackPanel
{
    private readonly TextBox _box;
    private readonly Action<string> _changed;

    public SuffixField(LocScope loc, string value, Action<string> changed)
    {
        _changed = changed;
        Spacing = 4;

        Children.Add(loc.Text("common.suffix.label", "label"));
        _box = new TextBox { Text = value, MaxLength = 40 };
        ToolTip.SetTip(_box, loc.T("common.suffix.placeholder"));
        Children.Add(_box);
        Children.Add(loc.Text("common.suffix.hint", "muted"));

        _box.LostFocus += (_, _) => Commit();
        _box.KeyDown += (_, args) =>
        {
            if (args.Key is not (Key.Enter or Key.Return)) return;
            Commit();
            args.Handled = true;
        };
    }

    public string Value => _box.Text ?? "";

    public void SetValue(string value) => _box.Text = value;

    private void Commit()
    {
        var clean = Naming.SanitizeSuffix(_box.Text);
        _box.Text = clean;
        _changed(clean);
    }
}
