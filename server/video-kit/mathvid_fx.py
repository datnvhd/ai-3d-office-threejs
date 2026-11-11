"""Cinematic effects for creative math videos (tỏ tình, sinh nhật, kỷ niệm, tri ân thầy cô, chúc mừng…).
Loaded by mathvid_style: every Short scene has these methods, and the helpers are importable from mathvid_style.

    class Video(Short):
        theme = "romantic"                 # background + accents: dark (lessons), romantic, sunset, galaxy, birthday
    self.starfield()                       # twinkling dots behind everything
    g = self.draw_heart()                  # the heart equation drawn with a glowing pen, filled, beating
    self.gather(heart_points())            # scattered dots fly in to form the heart
    self.typewrite("Gửi em…")              # a message typed letter by letter
    self.firework(UP * 4) ; self.sparkle(ORIGIN) ; self.float_hearts()
    self.graph_reveal(lambda x: 1 / x, (0.3, 3), label="y = 1/x")
    self.end_title("Làm người yêu anh nhé?", "x = anh, y = em, x + y = mãi mãi")
"""
import numpy as np
from manim import *

THEMES = {
    "dark": {"bg": "#0E1120", "accent": "#FFD43B", "soft": "#FF5D8F", "glow": "#FFD43B", "gold": "#FFD43B", "ink": "#F4F6FF"},
    "romantic": {"bg": "#14061C", "accent": "#FF4F8B", "soft": "#FFB3CF", "glow": "#FF7AA8", "gold": "#FFD98A", "ink": "#FFF0F6"},
    "sunset": {"bg": "#1B0E1A", "accent": "#FF8A5B", "soft": "#FFD1A6", "glow": "#FFA07A", "gold": "#FFE29A", "ink": "#FFF4EA"},
    "galaxy": {"bg": "#05061A", "accent": "#8AB4FF", "soft": "#D7C6FF", "glow": "#7FA7FF", "gold": "#FFF1B8", "ink": "#EEF2FF"},
    "birthday": {"bg": "#0D1530", "accent": "#FFD43B", "soft": "#7CE3FF", "glow": "#FFE066", "gold": "#FFD43B", "ink": "#F4F6FF"},
}
THEME = dict(THEMES["dark"])


def use_theme(name):
    """Switch the accents (Short does this from its `theme` attribute and paints the background)."""
    THEME.clear(); THEME.update(THEMES.get(name, THEMES["dark"]))


def backdrop():
    """Full-frame background in the theme colour, a little lighter at the bottom."""
    bg = Rectangle(width=9.2, height=16.2, stroke_width=0)
    bg.set_fill([ManimColor(THEME["bg"]), interpolate_color(ManimColor(THEME["bg"]), ManimColor(THEME["accent"]), 0.18)], opacity=1)
    bg.set_sheen_direction(DOWN)
    bg.keep = True
    return bg


def glow(mobj, color=None, layers=8, width=26, opacity=0.08):
    """Soft neon glow: wider, fainter copies of the outline behind the object. Returns VGroup(halo, mobj)."""
    color = color or THEME["glow"]
    halo = VGroup(*[mobj.copy().set_fill(opacity=0).set_stroke(color, width=width * (i + 1) / layers, opacity=min(1, opacity * (layers - i) / layers * 2))
                    for i in range(layers)])
    return VGroup(halo, mobj)


def _heart_xy(t):
    return np.array([16 * np.sin(t) ** 3, 13 * np.cos(t) - 5 * np.cos(2 * t) - 2 * np.cos(3 * t) - np.cos(4 * t), 0])


def heart(scale=0.18, color=None, fill=0.0, stroke=6):
    """The heart curve x = 16·sin³t, y = 13·cos t − 5·cos 2t − 2·cos 3t − cos 4t (a real equation worth showing)."""
    color = color or THEME["accent"]
    c = ParametricFunction(lambda t: _heart_xy(t) * scale, t_range=[0, TAU], color=color, stroke_width=stroke)
    c.set_fill(color, opacity=fill)
    return c


def heart_points(n=140, scale=0.18, center=ORIGIN):
    return [_heart_xy(a) * scale + center for a in np.linspace(0, TAU, n, endpoint=False)]


def star(size=0.12, color=None):
    """A four-point twinkle."""
    color = color or THEME["gold"]
    s = size
    pts = [(0, 2.4, 0), (.45, .45, 0), (2.4, 0, 0), (.45, -.45, 0), (0, -2.4, 0), (-.45, -.45, 0), (-2.4, 0, 0), (-.45, .45, 0)]
    return Polygon(*[np.array(p) * s for p in pts], stroke_width=0, fill_color=color, fill_opacity=1)


class Effects:
    """Mixed into Short (mathvid_style): cinematic building blocks."""

    def starfield(self, n=70, seed=3):
        """Faint dots that twinkle slowly behind everything (depth). Survives recap/clears."""
        rng = np.random.default_rng(seed)
        dots = VGroup(*[Dot(np.array([rng.uniform(-4.4, 4.4), rng.uniform(-7.8, 7.8), 0]), radius=rng.uniform(0.012, 0.035),
                            color=THEME["soft"]) for _ in range(n)])
        phase, base = rng.uniform(0, TAU, n), rng.uniform(0.25, 0.8, n)

        def tw(m):
            for d, p, b in zip(m, phase, base):
                d.set_opacity(b * (0.55 + 0.45 * np.sin(self.renderer.time * 2.2 + p)))
        dots.add_updater(tw)
        dots.keep = True
        self.add(dots); self.bring_to_back(dots)
        return dots

    def sparkle(self, where=ORIGIN, n=10, radius=2.2, seed=0, run_time=0.9):
        """Twinkling stars around a point (a 'magic' moment)."""
        rng = np.random.default_rng(seed)
        where = np.array(where, dtype=float)
        stars = [star(rng.uniform(0.06, 0.14)).move_to(where + np.array([rng.uniform(-radius, radius), rng.uniform(-radius, radius), 0])) for _ in range(n)]
        self.play(LaggedStart(*[Succession(FadeIn(s, scale=0.2, run_time=0.25), FadeOut(s, scale=1.6, run_time=0.45)) for s in stars], lag_ratio=0.12), run_time=run_time)

    def firework(self, where=UP * 3, color=None, n=26, radius=2.0, run_time=0.8):
        """A burst of dots from one point, fading as they fly."""
        color = color or THEME["accent"]
        where = np.array(where, dtype=float)
        dots = VGroup(*[Dot(where, radius=0.05, color=interpolate_color(ManimColor(color), ManimColor(THEME["gold"]), (i % 3) / 2)) for i in range(n)])
        targets = [where + radius * np.array([np.cos(a), np.sin(a), 0]) * (0.75 + 0.25 * (i % 2)) for i, a in enumerate(np.linspace(0, TAU, n, endpoint=False))]
        self.add(dots)
        self.play(*[d.animate(rate_func=rush_from).move_to(t).set_opacity(0) for d, t in zip(dots, targets)], run_time=run_time)
        self.remove(dots)

    def float_hearts(self, n=12, seed=1, run_time=2.0):
        """Small hearts drifting up and fading (background romance)."""
        rng = np.random.default_rng(seed)
        hs = [heart(scale=rng.uniform(0.02, 0.04), color=[THEME["accent"], THEME["soft"]][i % 2], fill=0.85, stroke=2)
              .move_to(np.array([rng.uniform(-4, 4), rng.uniform(-7.4, -5.6), 0])) for i in range(n)]
        self.play(LaggedStart(*[h.animate(rate_func=linear).shift(UP * rng.uniform(7, 12) + RIGHT * rng.uniform(-0.8, 0.8)).set_opacity(0)
                                for h in hs], lag_ratio=0.15), run_time=run_time)

    def draw_heart(self, scale=0.18, at=UP * 1.6, run_time=1.5, beat=True):
        """Draw the heart curve with a glowing pen, fill it, and let it beat. Returns the glowing heart."""
        h = heart(scale=scale).move_to(at)
        g = glow(h)
        pen = Dot(color=THEME["gold"], radius=0.09)
        pen.add_updater(lambda d: d.move_to(h.get_end()))
        self.add(pen)
        self.play(Create(h), run_time=run_time, rate_func=smooth)
        pen.clear_updaters(); self.remove(pen)
        self.play(FadeIn(g[0]), h.animate.set_fill(THEME["accent"], opacity=0.35), run_time=0.35)
        if beat:
            self.heartbeat(g)
        return g

    def heartbeat(self, mobj, times=2):
        """Lub-dub pulse."""
        for _ in range(times):
            self.play(mobj.animate(rate_func=there_and_back).scale(1.12), run_time=0.25)
            self.play(mobj.animate(rate_func=there_and_back).scale(1.06), run_time=0.22)

    def gather(self, points, color=None, seed=2, run_time=1.3):
        """Scattered dots fly in to form a shape (e.g. heart_points()); returns the dots."""
        color = color or THEME["soft"]
        rng = np.random.default_rng(seed)
        dots = VGroup(*[Dot(np.array([rng.uniform(-4.4, 4.4), rng.uniform(-7.5, 7.5), 0]), radius=0.045, color=color) for _ in points])
        self.play(LaggedStart(*[FadeIn(d, scale=0.3) for d in dots], lag_ratio=0.005), run_time=0.3)
        self.play(*[d.animate.move_to(p) for d, p in zip(dots, points)], run_time=run_time, rate_func=smooth)
        return dots

    def typewrite(self, text, fs=40, color=None, at=DOWN * 1.5, width=8.0, run_time=None):
        """A line typed letter by letter (messages, confessions)."""
        from mathvid_style import T, fit
        t = fit(T(text, fs=fs, color=color or THEME["ink"], weight=MEDIUM), width).move_to(at)
        self.play(AddTextLetterByLetter(t, run_time=run_time or min(1.6, max(0.5, len(text) * 0.035))))
        return t

    def graph_reveal(self, func, x_range=(-3, 3), y_range=(-3, 4), color=None, label=None, run_time=1.3, at=UP * 1.2):
        """Plot a function with a glowing line on a clean plane (e.g. y = 1/x 'getting closer', the heart, sin waves)."""
        from mathvid_style import M, fit
        ax = Axes(x_range=[x_range[0], x_range[1], 1], y_range=[y_range[0], y_range[1], 1], x_length=8, y_length=7,
                  axis_config={"color": THEME["soft"], "stroke_opacity": 0.5, "stroke_width": 2}).move_to(at)
        self.play(Create(ax), run_time=0.4)
        g = ax.plot(func, x_range=list(x_range), color=color or THEME["accent"], stroke_width=6)
        self.play(Create(glow(g)), run_time=run_time)
        if label:
            self.play(FadeIn(fit(M(label, fs=40, color=color or THEME["accent"]), 7.8).next_to(ax, DOWN, buff=0.3), scale=0.6), run_time=0.4)
        return ax, g

    def end_title(self, title, sub=None, color=None):
        """Closing title with a glow and sparkles (for creative videos, instead of the GHI NHỚ card)."""
        from mathvid_style import T, fit
        t = glow(fit(T(title, fs=58, color=color or THEME["accent"]), 8.2), layers=4, width=9, opacity=0.05)  # text: a faint halo, or it smudges
        g = VGroup(t)
        if sub:
            g.add(fit(T(sub, fs=32, color=THEME["soft"], weight=MEDIUM), 8.2).next_to(t, DOWN, buff=0.4))
        g.move_to(UP * 1.0)
        self.play(FadeIn(t, scale=0.8), run_time=0.5)
        if sub:
            self.play(FadeIn(g[1], shift=UP * 0.3), run_time=0.3)
        self.sparkle(t.get_center(), n=12, radius=3)
        return g
