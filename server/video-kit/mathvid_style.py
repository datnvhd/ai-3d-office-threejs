"""Look and timing helpers for vertical math shorts (Manim). In a scene file:

    from mathvid_style import *

    class Video(Short):
        def build(self):
            self.hook("Mẹo 5 giây", "tính nhanh diện tích tam giác")
            self.at("y_tuong")                   # wait until the narration segment "y_tuong" starts
            f = M("S = a·h / 2", fs=56)
            self.play(Write(f))
            self.hold("y_tuong")                 # keep it until that segment's narration ends
            self.recap(["S = ½·a·h", "h vuông góc với a"])

The frame is 9 units wide and 16 tall (x: -4.5..4.5, y: -8..8). Keep content in y -3.6..6.4: the top has the app's
title bar, the bottom the captions (burned in by `mathvid mux`) and the TikTok/Shorts buttons.
"""
import json, os, re, shutil, sys
from manim import *
from mathvid_fx import Effects, THEMES, THEME, use_theme, backdrop, glow, heart, heart_points, star

SPEED = max(0.5, min(2.0, float(os.environ.get("MATHVID_SPEED") or 1.0)))  # from script.json "speed" (mathvid render)

config.frame_height = 16
config.frame_width = 9
config.background_color = "#0E1120"

FONT = {"win32": "Arial", "darwin": "Helvetica Neue"}.get(sys.platform, "DejaVu Sans")
MATH_FONT = {"win32": "Cambria Math", "darwin": "STIX Two Math"}.get(sys.platform, "DejaVu Sans")
HAS_LATEX = bool(shutil.which("latex"))

# Palette: one accent per idea, the same colour for the same object in every scene
INK, MUTED = "#F4F6FF", "#9AA3C7"
YELLOW, TEAL, PINK, BLUE, ORANGE, GREEN, PURPLE = "#FFD43B", "#2EE6C5", "#FF5D8F", "#4DA3FF", "#FF9F43", "#7CE38B", "#B48CFF"
CARD = "#1A1F38"
TOP, BOTTOM = 6.4, -3.6          # safe content area (y)

SUP = str.maketrans("0123456789+-n()", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻ⁿ⁽⁾")
SUB = str.maketrans("0123456789", "₀₁₂₃₄₅₆₇₈₉")


def pretty(expr):
    """Plain math to Unicode: x^2 → x², sqrt(x) → √(x), <= → ≤, pi → π, a_1 → a₁, * → ·, -> → →."""
    s = str(expr)
    s = re.sub(r"\^\{([^}]*)\}", lambda m: m[1].translate(SUP), s)
    s = re.sub(r"\^([0-9n+\-]+)", lambda m: m[1].translate(SUP), s)
    s = re.sub(r"_\{?([0-9]+)\}?", lambda m: m[1].translate(SUB), s)
    for a, b in [("sqrt", "√"), ("<=", "≤"), (">=", "≥"), ("!=", "≠"), ("->", "→"), ("=>", "⇒"), ("<=>", "⇔"), ("*", "·"),
                 ("pi", "π"), ("alpha", "α"), ("beta", "β"), ("delta", "Δ"), ("Delta", "Δ"), ("theta", "θ"), ("inf", "∞"),
                 ("+-", "±"), ("deg", "°"), ("in R", "∈ ℝ"), ("vec", "→")]:
        s = s.replace(a, b)
    return s


def T(text, fs=40, color=INK, weight=BOLD, font=None):
    """Vietnamese text. fs is roughly the size you would use on a normal 8-unit Manim frame."""
    return Text(str(text), font=font or FONT, font_size=fs * 2, color=color, weight=weight)


def M(expr, fs=48, color=INK, tex=None, width=7.8):
    """A formula, shrunk to fit the frame width. Uses LaTeX (MathTex) when the machine has it and tex= is given,
    otherwise Unicode text (x^2 → x², sqrt → √ …, see pretty())."""
    if tex and HAS_LATEX:
        return fit(MathTex(tex, font_size=fs * 2, color=color), width)
    return fit(Text(pretty(expr), font=MATH_FONT, font_size=fs * 2, color=color), width)


def card(mobj, color=CARD, pad=0.4, stroke=None):
    """Rounded card behind a group (a 'sticker' look)."""
    r = RoundedRectangle(corner_radius=0.35, width=mobj.width + 2 * pad, height=mobj.height + 2 * pad,
                         fill_color=color, fill_opacity=0.95, stroke_color=stroke or color, stroke_width=3 if stroke else 0)
    r.move_to(mobj)
    return VGroup(r, mobj)


def fit(mobj, width=8.0, height=None):
    """Shrink to the frame width (and height) if too big."""
    if mobj.width > width:
        mobj.scale_to_fit_width(width)
    if height and mobj.height > height:
        mobj.scale_to_fit_height(height)
    return mobj


class Timeline:
    """Narration timings written by `mathvid tts` (timings.json): when each segment starts and ends."""
    def __init__(self):
        p = os.environ.get("MATHVID_TIMINGS") or "timings.json"
        try:
            d = json.load(open(p, encoding="utf-8"))
        except Exception:
            d = {"total": 0, "segments": []}
        self.total = d.get("total", 0)
        self.seg = {s["id"]: s for s in d.get("segments", [])}

    def start(self, sid): return self.seg[sid]["start"] if sid in self.seg else None
    def end(self, sid): return self.seg[sid]["end"] if sid in self.seg else None


class Short(Effects, Scene):
    """Base scene: progress bar, narration sync, trend-style blocks and effects (mathvid_fx). Write the video in build().
    theme: "dark" (lessons) or a creative look: "romantic", "sunset", "galaxy", "birthday"."""
    progress = True
    theme = "dark"

    def construct(self):
        use_theme(self.theme)
        if self.theme != "dark":
            self.add(backdrop())
        self.tl = Timeline()
        if self.progress and self.tl.total:
            self.add_progress()
        self.build()
        if self.tl.total:
            self.wait_until(self.tl.total + 0.3)
        else:
            self.wait(0.5)

    def build(self):
        raise NotImplementedError("Viết nội dung video trong build(self)")

    # ---- timing ----
    @property
    def now(self):
        return self.renderer.time

    def wait_until(self, t):
        if t is not None and t - self.now > 1 / config.frame_rate:
            Scene.wait(self, t - self.now)   # absolute clock: already at the video's speed

    def play(self, *animations, **kwargs):
        """Animations run SPEED times faster, each keeping its own length relative to the others."""
        if SPEED != 1.0:
            from manim.animation.animation import prepare_animation
            if "run_time" in kwargs:
                kwargs["run_time"] = kwargs["run_time"] / SPEED
            else:
                animations = [prepare_animation(a) for a in animations]
                for a in animations:
                    a.run_time = a.get_run_time() / SPEED
        return super().play(*animations, **kwargs)

    def wait(self, duration=1.0, *args, **kwargs):
        return super().wait(duration / SPEED, *args, **kwargs)

    def at(self, sid, offset=0.0):
        """Wait until narration segment `sid` starts (+offset seconds). Missing id: no wait."""
        s = self.tl.start(sid)
        if s is not None:
            self.wait_until(s + offset)

    def hold(self, sid, offset=0.0):
        """Wait until narration segment `sid` has been said."""
        e = self.tl.end(sid)
        if e is not None:
            self.wait_until(e + offset)

    def left(self, sid):
        """Seconds left in segment `sid` from now (to size an animation's run_time)."""
        e = self.tl.end(sid)
        # play() divides run_time by SPEED; this is real time left, so hand it over pre-multiplied
        return (max(0.3, (e - self.now)) if e is not None else 1.0) * SPEED

    # ---- building blocks ----
    def add_progress(self):
        bar_bg = Rectangle(width=9, height=0.09, fill_color="#2A3050", fill_opacity=1, stroke_width=0).to_edge(UP, buff=0)
        bar = Rectangle(width=0.01, height=0.09, fill_color=YELLOW, fill_opacity=1, stroke_width=0).align_to(bar_bg, LEFT).align_to(bar_bg, UP)
        total = self.tl.total + 0.3

        def grow(m):
            w = max(0.01, 9 * min(1, self.now / total))
            m.stretch_to_fit_width(w).align_to(bar_bg, LEFT)
        bar.add_updater(grow)
        bar_bg.keep = bar.keep = True
        self.add(bar_bg, bar)

    def hook(self, title, sub=None, color=YELLOW, hold=None):
        """Opening hook: a big punchy title that pops in (first 1-2 s decide if people keep watching)."""
        t = fit(T(title, fs=64, color=color), 8.2)
        g = VGroup(t)
        if sub:
            s = fit(T(sub, fs=34, color=INK, weight=MEDIUM), 8.2).next_to(t, DOWN, buff=0.35)
            g.add(s)
        g.move_to(UP * 2.6)
        self.play(FadeIn(t, scale=1.6, rate_func=rush_from, run_time=0.3))
        if sub:
            self.play(FadeIn(g[1], shift=UP * 0.3, run_time=0.25))
        self.play(Wiggle(t, scale_value=1.08, rotation_angle=0.03 * TAU, run_time=0.45))
        if hold:
            self.hold(hold)
        return g

    def title(self, text, color=INK):
        """Small section title at the top of the safe area."""
        t = fit(T(text, fs=36, color=color), 8.4).move_to(UP * (TOP - 0.3))
        self.play(FadeIn(t, shift=DOWN * 0.3, run_time=0.25))
        return t

    def pop(self, mobj, run_time=0.3):
        self.play(FadeIn(mobj, scale=0.5, rate_func=rush_from, run_time=run_time))
        return mobj

    def stress(self, mobj, color=YELLOW):
        """Draw the eye to something: a quick circle + flash."""
        self.play(Circumscribe(mobj, color=color, time_width=0.6, run_time=0.55))

    def quiz(self, question, seconds=3, color=PINK, y=-1.9):
        """'Đố bạn' pause with a countdown, under the picture so viewers look at it while they think
        (good for watch time and comments). y: height of the question card."""
        q = card(fit(T(question, fs=40, color=INK), 7.0), stroke=color).move_to(UP * y)
        self.pop(q)
        # countdown in a round badge on the card's corner (clear of the picture and of the captions)
        badge = Circle(radius=0.62, fill_color=color, fill_opacity=1, stroke_color=INK, stroke_width=4).move_to(q.get_corner(UR) + np.array([-0.15, 0.1, 0]))
        self.play(GrowFromCenter(badge), run_time=0.25)
        n = None
        for i in range(seconds, 0, -1):
            m = T(str(i), fs=44, color=INK).move_to(badge)
            self.play(FadeIn(m, scale=1.8, run_time=0.25) if n is None else ReplacementTransform(n, m, run_time=0.25))
            self.wait(0.5)
            n = m
        self.play(FadeOut(VGroup(n, badge), scale=0.4, run_time=0.25))
        return q

    def reveal(self, text, color=GREEN):
        """The answer after a quiz: green check card."""
        a = card(fit(T("✓ " + str(text), fs=44, color=color), 8), stroke=color).move_to(DOWN * 0.8)
        self.pop(a)
        return a

    def wrong(self, text):
        """A common mistake, crossed out in red (the 'sai lầm hay gặp' format)."""
        t = fit(T(text, fs=44, color=PINK), 8)
        x = Cross(t, stroke_color=PINK, stroke_width=8)
        self.play(FadeIn(t, run_time=0.2))
        self.play(Create(x, run_time=0.25))
        return VGroup(t, x)

    def recap(self, lines, cta="Lưu lại để ôn thi nhé!", hold_from=None):
        """End card: 2-4 key points and a call to action (save / share / follow)."""
        old = [m for m in self.mobjects if not getattr(m, "keep", False)]
        if old:
            self.play(*[FadeOut(m) for m in old], run_time=0.25)
        head = T("GHI NHỚ", fs=40, color=YELLOW).move_to(UP * 5.2)
        items = fit(VGroup(*[T("• " + l, fs=32, color=INK, weight=MEDIUM) for l in lines]).arrange(DOWN, aligned_edge=LEFT, buff=0.45), 7.6)
        box = card(items, stroke=YELLOW).next_to(head, DOWN, buff=0.5)
        c = fit(T(cta, fs=34, color=TEAL), 8.2).next_to(box, DOWN, buff=0.7)
        self.play(FadeIn(head, shift=DOWN * 0.3), run_time=0.25)
        self.play(FadeIn(box, scale=0.9), run_time=0.3)
        self.play(FadeIn(c, shift=UP * 0.3), run_time=0.25)
        self.play(Indicate(c, color=TEAL, scale_factor=1.1), run_time=0.5)
        return VGroup(head, box, c)

    def axes(self, x_range=(-4, 4, 1), y_range=(-3, 5, 1), width=8.2, height=8.0, labels=True):
        """Coordinate plane that fits the vertical frame."""
        ax = Axes(x_range=list(x_range), y_range=list(y_range), x_length=width, y_length=height, tips=True,
                  axis_config={"color": MUTED, "stroke_width": 3, "include_numbers": labels, "font_size": 30,
                               "decimal_number_config": {"num_decimal_places": 0}})
        return ax
