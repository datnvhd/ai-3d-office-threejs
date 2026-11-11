# Example short: why the Pythagorean theorem holds (squares on the sides). Each block waits for its narration segment
# (ids from script.json) so pictures and voice stay in sync.
from mathvid_style import *


class Video(Short):
    def build(self):
        hook = self.hook("90% học sinh không biết", "vì sao a² + b² = c² ?", hold="hook")
        self.play(FadeOut(hook, shift=UP), run_time=0.4)

        # the right triangle, legs 3 and 4 (units scaled to fit the frame)
        self.at("tam_giac")
        k = 0.95
        A, B, C = np.array([-1.9, -0.6, 0]), np.array([-1.9 + 4 * k, -0.6, 0]), np.array([-1.9, -0.6 + 3 * k, 0])
        tri = Polygon(A, B, C, color=INK, stroke_width=6, fill_color=BLUE, fill_opacity=0.25)
        right = RightAngle(Line(A, B), Line(A, C), length=0.35, color=INK)
        la = M("a", fs=40, color=TEAL).next_to(Line(A, C), LEFT, buff=0.2)
        lb = M("b", fs=40, color=ORANGE).next_to(Line(A, B), DOWN, buff=0.2)
        lc = M("c", fs=40, color=PINK).move_to((B + C) / 2 + np.array([0.35, 0.35, 0]))
        self.play(Create(tri), Create(right), run_time=1)
        self.play(LaggedStart(*[FadeIn(x, scale=1.5) for x in (la, lb, lc)], lag_ratio=0.3), run_time=0.9)
        self.hold("tam_giac")

        # squares on each side
        self.at("hinh_vuong")
        centre = (A + B + C) / 3
        def square_on(p, q, color):
            # square on side pq, on the outside of the triangle
            d = q - p
            n = np.array([-d[1], d[0], 0])
            if np.dot(n, centre - (p + q) / 2) > 0:
                n = -n
            return Polygon(p, q, q + n, p + n, color=color, fill_color=color, fill_opacity=0.35, stroke_width=4)
        sa = square_on(C, A, TEAL)
        sb = square_on(A, B, ORANGE)
        sc = square_on(B, C, PINK)
        pic = VGroup(tri, right, la, lb, lc, sa, sb, sc)
        self.play(LaggedStart(GrowFromEdge(sa, RIGHT), GrowFromEdge(sb, UP), GrowFromEdge(sc, DOWN), lag_ratio=0.35), run_time=1.4)
        self.play(pic.animate.scale_to_fit_height(7.2).move_to(UP * 2.4), run_time=0.6)
        self.hold("hinh_vuong")

        # quiz pause
        self.at("quiz")
        q = self.quiz("Xanh + Cam = Hồng ?", seconds=3)
        self.play(FadeOut(q), run_time=0.3)

        # answer: the areas
        self.at("dap_an")
        f = M("a² + b² = c²", fs=60, color=YELLOW).move_to(DOWN * 2.6)
        self.play(Indicate(sa, color=TEAL), Indicate(sb, color=ORANGE), run_time=0.8)
        self.play(TransformFromCopy(VGroup(sa, sb), sc), run_time=1)
        self.play(Write(f), run_time=0.9)
        self.stress(f)
        self.hold("dap_an")

        # worked example
        self.at("vi_du")
        self.play(FadeOut(pic), f.animate.move_to(UP * 4.6).scale(0.8), run_time=0.5)
        ex = VGroup(M("3² + 4² = 9 + 16 = 25", fs=46), M("c = √25 = 5", fs=56, color=GREEN)).arrange(DOWN, buff=0.6).move_to(UP * 1.2)
        self.play(Write(ex[0]), run_time=self.left("vi_du") * 0.5)
        self.play(FadeIn(ex[1], scale=1.4), run_time=0.5)
        self.hold("vi_du")

        self.at("ket")
        self.recap(["a² + b² = c²  (c là cạnh huyền)", "Chỉ đúng với tam giác vuông", "Bộ số đẹp: 3 – 4 – 5"])
