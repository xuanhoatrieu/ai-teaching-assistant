"""
Manim Template: Formula Scene
Display LaTeX formula with step-by-step highlight and explanation.
"""
from manimlib import *


class FormulaScene(Scene):
    """Display and animate LaTeX mathematical formulas."""

    FORMULA = "{formula}"
    EXPLANATION = "{explanation}"
    STEP_BY_STEP = "{step_by_step}"

    def construct(self):
        # Title label
        label = Text("Công thức", font_size=24, color=GREY_B)
        label.to_edge(UP, buff=0.5)

        # Main formula
        try:
            formula = Tex(self.FORMULA, font_size=48)
        except Exception:
            formula = Text(self.FORMULA, font_size=36)

        formula.move_to(UP * 0.5)

        # Explanation text
        explanation = Text(
            self.EXPLANATION,
            font_size=24,
            color=GREY_A,
        )
        explanation.next_to(formula, DOWN, buff=1.0)

        # Box around formula
        box = SurroundingRectangle(
            formula, color=YELLOW, buff=0.3,
            stroke_width=2,
        )

        # Animations
        self.play(FadeIn(label), run_time=0.5)
        self.play(Write(formula), run_time=2.0)
        self.wait(1)

        self.play(ShowCreation(box), run_time=0.8)
        self.wait(0.5)

        if self.EXPLANATION and self.EXPLANATION != "{explanation}":
            self.play(
                FadeIn(explanation, shift=UP * 0.3),
                run_time=1.0,
            )

        self.wait(3)
        self.play(
            FadeOut(VGroup(label, formula, box, explanation)),
            run_time=0.8,
        )
