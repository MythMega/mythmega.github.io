using Bulkut.Core.Features;
using Xunit;

namespace Bulkut.Tests;

public sealed class IntroOutroTests
{
    private static readonly EdgeMedia Intro = new("intro.mp4", 2);
    private static readonly EdgeMedia Outro = new("outro.mp4", 1.5);

    [Fact]
    public void ListsOnlyAvailableModes()
    {
        Assert.Equal(new[] { EdgeMode.Both, EdgeMode.Intro, EdgeMode.Outro },
            IntroOutroPlanner.AvailableModes(Intro, Outro));
        Assert.Equal(new[] { EdgeMode.Intro }, IntroOutroPlanner.AvailableModes(Intro, null));
        Assert.Equal(new[] { EdgeMode.Outro }, IntroOutroPlanner.AvailableModes(null, Outro));
        Assert.Empty(IntroOutroPlanner.AvailableModes(null, null));
    }

    [Fact]
    public void NarrowsAModeWhenAnEdgeDisappears()
    {
        Assert.Equal(EdgeMode.Both, IntroOutroPlanner.EffectiveMode(EdgeMode.Both, Intro, Outro));
        Assert.Equal(EdgeMode.Intro, IntroOutroPlanner.EffectiveMode(EdgeMode.Both, Intro, null));
        Assert.Equal(EdgeMode.Outro, IntroOutroPlanner.EffectiveMode(EdgeMode.Both, null, Outro));
        Assert.Equal(EdgeMode.Both, IntroOutroPlanner.EffectiveMode(EdgeMode.Both, null, null));
        Assert.Equal(EdgeMode.Outro, IntroOutroPlanner.EffectiveMode(EdgeMode.Outro, Intro, Outro));
    }

    [Fact]
    public void ComputesExpectedDurationForEveryCombination()
    {
        Assert.Equal(13.5, IntroOutroPlanner.ExpectedDuration(10, EdgeMode.Both, Intro, Outro));
        Assert.Equal(12, IntroOutroPlanner.ExpectedDuration(10, EdgeMode.Intro, Intro, Outro));
        Assert.Equal(11.5, IntroOutroPlanner.ExpectedDuration(10, EdgeMode.Outro, Intro, Outro));
        Assert.Equal(10, IntroOutroPlanner.ExpectedDuration(10, EdgeMode.Both, null, null));
    }

    [Fact]
    public void OrdersInputsIntroClipOutro()
    {
        var plan = IntroOutroPlanner.Plan("clip.mp4", 10, EdgeMode.Both, Intro, Outro);

        Assert.Equal(new[] { "intro.mp4", "clip.mp4", "outro.mp4" }, plan.Inputs);
        Assert.Equal(new[] { 2.0, 10.0, 1.5 }, plan.Durations);
        Assert.True(plan.UsesIntro);
        Assert.True(plan.UsesOutro);
        Assert.Equal(13.5, plan.ExpectedDuration);
    }

    [Fact]
    public void OmitsTheOutroInIntroOnlyMode()
    {
        var plan = IntroOutroPlanner.Plan("clip.mp4", 10, EdgeMode.Intro, Intro, Outro);

        Assert.Equal(new[] { "intro.mp4", "clip.mp4" }, plan.Inputs);
        Assert.False(plan.UsesOutro);
        Assert.Equal(12, plan.ExpectedDuration);
    }
}
