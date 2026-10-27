using Avalonia.Controls;
using Bulkut.Ui;

namespace Bulkut.Ui.Views;

public abstract class FeatureView : UserControl
{
    protected FeatureView(AppServices services)
    {
        Services = services;
        Loc = new LocScope(services.I18n);
    }

    protected AppServices Services { get; }
    protected LocScope Loc { get; }
    internal LocScope Localize => Loc;

    /// <summary>Called after a language change so static labels and rows update.</summary>
    public virtual void RefreshLanguage() => Loc.Refresh();
}
