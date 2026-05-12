"""
Manim Template: Graph Scene
Plot mathematical functions with animated axes and curves.
"""
from manimlib import *
import numpy as np


class GraphScene(Scene):
    """Animated function graph with labeled axes."""

    TITLE = "{title}"
    X_RANGE = "{x_range}"      # e.g. "-5,5,1"
    Y_RANGE = "{y_range}"      # e.g. "-3,3,1"
    FUNCTION = "{function}"    # e.g. "np.sin(x)"
    COLOR = "{color}"

    def construct(self):
        # Parse ranges
        x_range = self._parse_range(self.X_RANGE, [-5, 5, 1])
        y_range = self._parse_range(self.Y_RANGE, [-3, 3, 1])
        curve_color = self._parse_color(self.COLOR)

        # Title
        title = Text(self.TITLE, font_size=32, color=WHITE)
        title.to_edge(UP, buff=0.4)

        # Create axes
        axes = Axes(
            x_range=x_range,
            y_range=y_range,
            width=10,
            height=5.5,
            axis_config={"color": GREY_B, "include_tip": True},
        )
        axes.shift(DOWN * 0.3)

        # Labels
        x_label = Text("x", font_size=20, color=GREY_B)
        x_label.next_to(axes.x_axis, RIGHT, buff=0.2)
        y_label = Text("y", font_size=20, color=GREY_B)
        y_label.next_to(axes.y_axis, UP, buff=0.2)

        # Plot function
        try:
            func = eval(f"lambda x: {self.FUNCTION}")
            graph = axes.get_graph(func, color=curve_color, stroke_width=3)
        except Exception:
            graph = axes.get_graph(lambda x: x, color=curve_color, stroke_width=3)

        # Animations
        self.play(FadeIn(title), run_time=0.5)
        self.play(
            ShowCreation(axes),
            FadeIn(x_label), FadeIn(y_label),
            run_time=1.5,
        )
        self.play(
            ShowCreation(graph),
            run_time=2.5,
        )
        self.wait(3)

    def _parse_range(self, range_str: str, default: list) -> list:
        try:
            parts = [float(x.strip()) for x in range_str.split(",")]
            if len(parts) >= 3:
                return parts[:3]
        except (ValueError, AttributeError):
            pass
        return default

    def _parse_color(self, color_str: str):
        color_map = {
            "YELLOW": YELLOW, "BLUE": BLUE, "GREEN": GREEN,
            "RED": RED, "WHITE": WHITE, "ORANGE": ORANGE,
            "TEAL": TEAL, "PURPLE": PURPLE,
        }
        return color_map.get(color_str.upper(), BLUE)
