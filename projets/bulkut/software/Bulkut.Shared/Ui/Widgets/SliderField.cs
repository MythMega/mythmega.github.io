using System.Globalization;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Bulkut.Core.Features;

namespace Bulkut.Ui.Widgets;

/// <summary>A slider paired with a precise numeric box, validated on focus loss.</summary>
public sealed class SliderField : StackPanel
{
    private readonly Slider _slider;
    private readonly TextBox _box;
    private readonly AutocutFieldSpec _spec;
    private readonly ToastService _toasts;
    private readonly LocScope _loc;
    private bool _syncing;

    public SliderField(LocScope loc, AutocutFieldSpec spec, double value, ToastService toasts)
    {
        _spec = spec;
        _toasts = toasts;
        _loc = loc;
        Spacing = 4;

        Children.Add(loc.Text($"autocut.fields.{spec.Label}", "label"));
        Children.Add(loc.Text($"autocut.fields.{spec.Label}Hint", "muted"));

        _slider = new Slider
        {
            Minimum = spec.Min,
            Maximum = spec.Max,
            TickFrequency = spec.Step,
            Value = Timecode.Clamp(value, spec.Min, spec.Max),
            VerticalAlignment = VerticalAlignment.Center,
        };
        _box = new TextBox
        {
            Width = 74,
            Text = Timecode.FormatNumber(_slider.Value, spec.Decimals),
            HorizontalContentAlignment = HorizontalAlignment.Right,
        };

        var row = Ui.HStack(8);
        _slider.Width = 190;
        row.Children.Add(_slider);
        row.Children.Add(_box);
        row.Children.Add(Ui.Text(spec.Unit, "muted", 11.5));
        Children.Add(row);

        _slider.ValueChanged += (_, _) =>
        {
            if (_syncing) return;
            _box.Text = Timecode.FormatNumber(_slider.Value, _spec.Decimals);
            ValueChanged?.Invoke(_slider.Value);
        };

        _box.LostFocus += (_, _) => Commit();
        _box.KeyDown += (_, args) =>
        {
            if (args.Key is not (Key.Enter or Key.Return)) return;
            Commit();
            args.Handled = true;
        };
    }

    public event Action<double>? ValueChanged;
    public event Action<double>? Committed;

    public double Value => _slider.Value;

    public void SetValue(double value)
    {
        _syncing = true;
        try
        {
            var clamped = Timecode.Clamp(value, _spec.Min, _spec.Max);
            _slider.Value = clamped;
            _box.Text = Timecode.FormatNumber(clamped, _spec.Decimals);
        }
        finally
        {
            _syncing = false;
        }
    }

    private void Commit()
    {
        if (!double.TryParse(_box.Text, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed) ||
            !double.IsFinite(parsed) ||
            parsed < _spec.Min ||
            parsed > _spec.Max)
        {
            _toasts.Error(_loc.T("errors.numberRange", ("min", _spec.Min), ("max", _spec.Max)));
            SetValue(_slider.Value);
            return;
        }

        SetValue(parsed);
        Committed?.Invoke(_slider.Value);
    }
}
