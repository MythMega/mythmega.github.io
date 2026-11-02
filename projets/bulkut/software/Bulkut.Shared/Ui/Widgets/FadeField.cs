using System.Globalization;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Bulkut.Core.Features;
using Bulkut.Core.Models;

namespace Bulkut.Ui.Widgets;

/// <summary>
/// Audio and video fade modes plus the shared duration. Changes are written
/// straight into the bound <see cref="FadeSettings"/> and persisted by the caller.
/// </summary>
public sealed class FadeField : StackPanel
{
    private readonly FadeSettings _fade;
    private readonly FadeConfig _config;
    private readonly ToastService _toasts;
    private readonly LocScope _loc;
    private readonly ComboBox _audio = new() { MinWidth = 168 };
    private readonly ComboBox _video = new() { MinWidth = 168 };
    private readonly Slider _slider;
    private readonly TextBox _box;
    private bool _syncing;

    public FadeField(LocScope loc, FadeSettings fade, FadeConfig config, ToastService toasts, Action? onChange = null)
    {
        _fade = fade;
        _config = config;
        _toasts = toasts;
        _loc = loc;
        Spacing = 7;

        Children.Add(loc.Text("fade.title", "label"));
        Children.Add(loc.Text("fade.hint", "muted"));

        BuildModeItems(_audio, fade.Audio);
        BuildModeItems(_video, fade.Video);
        _audio.SelectionChanged += (_, _) => SetMode(isAudio: true, SelectedMode(_audio));
        _video.SelectionChanged += (_, _) => SetMode(isAudio: false, SelectedMode(_video));

        Children.Add(ModeRow("fade.audio", _audio));
        Children.Add(ModeRow("fade.video", _video));

        var min = config.Min > 0 ? config.Min : 0.1;
        var max = config.Max >= min ? config.Max : 1;
        var step = config.Step > 0 ? config.Step : 0.1;
        var value = Fades.NormalizeDuration(fade.Duration, config);

        Children.Add(loc.Text("fade.duration", "label"));
        Children.Add(loc.Text("fade.durationHint", "muted"));

        _slider = new Slider
        {
            Minimum = min,
            Maximum = max,
            TickFrequency = step,
            Value = value,
            Width = 190,
        };
        _box = new TextBox
        {
            Width = 66,
            Text = value.ToString("0.0", CultureInfo.InvariantCulture),
            HorizontalContentAlignment = HorizontalAlignment.Right,
        };

        var row = Ui.HStack(8);
        row.Children.Add(_slider);
        row.Children.Add(_box);
        row.Children.Add(Ui.Text("s", "muted", 11.5));
        Children.Add(row);

        _slider.ValueChanged += (_, _) =>
        {
            if (_syncing) return;
            _fade.Duration = Fades.NormalizeDuration(_slider.Value, _config);
            _box.Text = _fade.Duration.ToString("0.0", CultureInfo.InvariantCulture);
            onChange?.Invoke();
        };

        _box.LostFocus += (_, _) => Commit(onChange);
        _box.KeyDown += (_, args) =>
        {
            if (args.Key is not (Key.Enter or Key.Return)) return;
            Commit(onChange);
            args.Handled = true;
        };
    }

    private Control ModeRow(string labelKey, ComboBox combo)
    {
        var row = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*") };
        var label = _loc.Text(labelKey, "label");
        label.VerticalAlignment = VerticalAlignment.Center;
        label.Margin = new Thickness(0, 0, 10, 0);
        row.Children.Add(label);
        Grid.SetColumn(combo, 1);
        combo.HorizontalAlignment = HorizontalAlignment.Stretch;
        row.Children.Add(combo);
        return row;
    }

    /// <summary>Repaints the controls after the bound fade object was replaced in place.</summary>
    public void Refresh()
    {
        BuildModeItems(_audio, _fade.Audio);
        BuildModeItems(_video, _fade.Video);
        _syncing = true;
        try
        {
            var value = Fades.NormalizeDuration(_fade.Duration, _config);
            _slider.Value = value;
            _box.Text = value.ToString("0.0", CultureInfo.InvariantCulture);
        }
        finally
        {
            _syncing = false;
        }
    }

    private void BuildModeItems(ComboBox combo, string current)
    {
        _syncing = true;
        try
        {
            combo.Items.Clear();
            foreach (var mode in Fades.Modes)
            {
                var item = new ComboBoxItem
                {
                    Tag = mode,
                    Content = _loc.Text($"fade.modes.{mode}", "body"),
                };
                combo.Items.Add(item);
            }
            combo.SelectedIndex = Math.Max(0, Array.IndexOf(Fades.Modes, Fades.NormalizeMode(current)));
        }
        finally
        {
            _syncing = false;
        }
    }

    private static string SelectedMode(ComboBox combo) =>
        combo.SelectedItem is ComboBoxItem { Tag: string mode } ? mode : "none";

    private void SetMode(bool isAudio, string mode)
    {
        if (_syncing) return;
        if (isAudio) _fade.Audio = Fades.NormalizeMode(mode);
        else _fade.Video = Fades.NormalizeMode(mode);
    }

    private void Commit(Action? onChange)
    {
        var min = _config.Min > 0 ? _config.Min : 0.1;
        var max = _config.Max >= min ? _config.Max : 1;
        if (!double.TryParse(_box.Text, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed) ||
            !double.IsFinite(parsed) ||
            parsed < min ||
            parsed > max)
        {
            _toasts.Error(_loc.T("errors.numberRange", ("min", min), ("max", max)));
            _box.Text = _fade.Duration.ToString("0.0", CultureInfo.InvariantCulture);
            return;
        }

        _fade.Duration = Fades.NormalizeDuration(parsed, _config);
        _syncing = true;
        try
        {
            _slider.Value = _fade.Duration;
        }
        finally
        {
            _syncing = false;
        }
        _box.Text = _fade.Duration.ToString("0.0", CultureInfo.InvariantCulture);
        onChange?.Invoke();
    }
}
