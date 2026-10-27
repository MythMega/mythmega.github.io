using Avalonia.Controls;
using Bulkut.Core.Services;

namespace Bulkut.Ui;

/// <summary>
/// Binds text controls to translation keys and refreshes them when the language
/// changes. Rows rebuilt dynamically read <see cref="T"/> at sync time instead.
/// </summary>
public sealed class LocScope(TranslationService i18n)
{
    private readonly List<Action> _bindings = [];

    public TranslationService I18n => i18n;

    public string T(string key, params (string Key, object? Value)[] args) => i18n.T(key, args);

    public TextBlock Text(string key, string classes = "muted")
    {
        var block = new TextBlock { Classes = { classes } };
        Bind(block, key);
        return block;
    }

    public TextBlock Bind(TextBlock block, string key)
    {
        void Apply() => block.Text = i18n.T(key);
        Apply();
        _bindings.Add(Apply);
        return block;
    }

    public Button BindButton(Button button, string key)
    {
        var text = new TextBlock();
        button.Content = text;
        void Apply() => text.Text = i18n.T(key);
        Apply();
        _bindings.Add(Apply);
        return button;
    }

    public void Refresh()
    {
        foreach (var binding in _bindings.ToArray())
        {
            try
            {
                binding();
            }
            catch (InvalidOperationException)
            {
                // The control may have been removed with its row.
            }
        }
    }
}
