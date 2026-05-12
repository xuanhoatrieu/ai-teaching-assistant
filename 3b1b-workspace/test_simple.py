from manimlib import *

class SimpleTest(Scene):
    def construct(self):
        title = Text("3Blue1Brown Style!", font_size=56, color=YELLOW)
        subtitle = Text("Rendered with ManimGL on CPU", font_size=28, color=GREY_B)
        subtitle.next_to(title, DOWN, buff=0.5)

        self.play(Write(title), run_time=1.5)
        self.play(FadeIn(subtitle, shift=UP*0.3))
        self.wait(1)

        # Math formula
        formula = Tex(r"e^{i\pi} + 1 = 0", font_size=72)
        formula.next_to(subtitle, DOWN, buff=1)
        box = SurroundingRectangle(formula, color=BLUE, buff=0.3)

        self.play(Write(formula), run_time=2)
        self.play(ShowCreation(box))
        self.wait(2)
