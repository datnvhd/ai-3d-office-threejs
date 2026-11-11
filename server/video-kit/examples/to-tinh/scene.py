# Example creative short: a confession in maths. No narration (script.json "voice": "none"), an original romantic
# backing track ("music": "romantic"), on-screen text typed out, glow, the heart equation, fireworks.
from mathvid_style import *


class Video(Short):
    theme = "romantic"
    progress = False

    def build(self):
        self.starfield()

        # opening line, typed
        self.at("mo_dau")
        line = self.typewrite("Gửi em,", fs=52, color=THEME["accent"], at=UP * 3.4, run_time=0.4)
        line2 = self.typewrite("cô gái làm anh giỏi Toán hơn mỗi ngày", fs=34, at=UP * 2.4, run_time=1.0)
        self.hold("mo_dau")
        self.play(FadeOut(VGroup(line, line2), shift=UP * 0.4), run_time=0.3)

        # two lines that are not parallel always meet
        self.at("hai_duong")
        ax = Axes(x_range=[-3, 3, 1], y_range=[-3, 3, 1], x_length=7.4, y_length=7.4,
                  axis_config={"color": THEME["soft"], "stroke_opacity": 0.35, "stroke_width": 2}).move_to(UP * 1.6)
        self.play(Create(ax), run_time=0.3)
        anh = ax.plot(lambda x: 0.8 * x + 0.2, x_range=[-3, 3], color="#7FB2FF", stroke_width=6)
        em = ax.plot(lambda x: -0.8 * x + 1.8, x_range=[-3, 3], color=THEME["accent"], stroke_width=6)
        la = T("anh", fs=30, color="#7FB2FF").next_to(ax.c2p(-2.6, -1.9), UP, buff=0.15)
        le = T("em", fs=30, color=THEME["accent"]).next_to(ax.c2p(-2.6, 3.0), DOWN, buff=0.15)
        self.play(Create(anh), Create(em), FadeIn(la), FadeIn(le), run_time=1.0)
        meet = ax.c2p(1, 1)
        self.play(Flash(meet, color=THEME["gold"], line_length=0.4, num_lines=12, flash_radius=0.4), run_time=0.45)
        dot = glow(Dot(meet, radius=0.12, color=THEME["gold"]), color=THEME["gold"])
        self.play(FadeIn(dot, scale=2))
        cap = fit(T("không song song… thì sẽ gặp nhau", fs=32, color=THEME["ink"], weight=MEDIUM), 8).move_to(DOWN * 2.6)
        self.play(FadeIn(cap, shift=UP * 0.3), run_time=0.3)
        self.hold("hai_duong")
        self.play(FadeOut(VGroup(ax, anh, em, la, le, dot, cap)), run_time=0.3)

        # the heart equation, drawn by a glowing pen
        self.at("trai_tim")
        eq = VGroup(M("x = 16·sin³t", fs=34, color=THEME["soft"]),
                    M("y = 13cos t − 5cos 2t − 2cos 3t − cos 4t", fs=34, color=THEME["soft"])).arrange(DOWN, buff=0.25).move_to(UP * 5.4)
        self.play(Write(eq), run_time=0.8)
        h = self.draw_heart(scale=0.2, at=UP * 1.2, run_time=1.5, beat=False)
        self.hold("trai_tim")

        # its only solution
        self.at("nghiem")
        sol = fit(T("Nghiệm duy nhất:  EM", fs=46, color=THEME["gold"]), 8).move_to(DOWN * 2.6)
        self.play(FadeIn(sol, scale=0.7), run_time=0.35)
        self.heartbeat(h, times=2)
        self.hold("nghiem")

        # the question
        self.at("hoi")
        self.play(FadeOut(VGroup(eq, sol)), h.animate.scale(0.55).move_to(UP * 4.6), run_time=0.4)
        self.end_title("Làm người yêu anh nhé?", "anh + em = 1")
        self.firework(UP * 4.6 + LEFT * 2.2)
        self.firework(UP * 4.6 + RIGHT * 2.2, color=THEME["gold"])
        self.float_hearts(n=14, run_time=1.6)
