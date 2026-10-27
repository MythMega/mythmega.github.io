using Avalonia.Controls;
using Bulkut.Core.Features;

namespace Bulkut.Ui.Widgets;

/// <summary>
/// Chooses what Autocut writes: an MP4, a Premiere sequence or a DaVinci
/// timeline. Used both for the shared settings and inside a video's dialog.
/// </summary>
public sealed class OutputField : StackPanel
{
    private readonly LocScope _loc;
    private readonly ComboBox _combo = new();
    private string _value = AutocutOutput.Video;
    private bool _syncing;

    public OutputField(LocScope loc, string? value)
    {
        _loc = loc;
        Spacing = 5;

        Children.Add(loc.Text("autocut.output.title", "label"));

        _combo.HorizontalAlignment = Avalonia.Layout.HorizontalAlignment.Stretch;
        _combo.SelectionChanged += (_, _) =>
        {
            if (_syncing) return;
            var selected = Selected();
            if (selected == _value) return;
            _value = selected;
            ValueChanged?.Invoke(selected);
        };
        Children.Add(_combo);
        Children.Add(loc.Text("autocut.output.hint", "muted"));

        SetValue(value);
    }

    public event Action<string>? ValueChanged;

    public string Value => _value;

    public void SetValue(string? value)
    {
        _value = AutocutOutput.Normalize(value);
        Rebuild();
    }

    /// <summary>Rebuilds the item labels after a language change.</summary>
    public void Refresh() => Rebuild();

    private void Rebuild()
    {
        _syncing = true;
        try
        {
            _combo.Items.Clear();
            foreach (var format in AutocutOutput.Formats)
            {
                _combo.Items.Add(new ComboBoxItem
                {
                    Tag = format,
                    Content = _loc.Text($"autocut.output.{format}", "body"),
                });
            }

            var index = AutocutOutput.Formats.ToList().IndexOf(_value);
            _combo.SelectedIndex = Math.Max(0, index);
        }
        finally
        {
            _syncing = false;
        }
    }

    private string Selected() =>
        _combo.SelectedItem is ComboBoxItem { Tag: string format }
            ? AutocutOutput.Normalize(format)
            : AutocutOutput.Video;
}
