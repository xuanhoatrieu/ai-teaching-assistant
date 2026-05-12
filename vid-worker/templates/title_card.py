"""
Manim Template: Title Card
Animated title + subtitle with professional styling.
"""
from manimlib import *


class TitleCardScene(Scene):
    """Animated title card for video intro/section headers."""

    # Template parameters (replaced by orchestrator)
    TITLE = "{title}"
    SUBTITLE = "{subtitle}"
    COLOR = "{color}"

    def construct(self):
        title_color = self._parse_color(self.COLOR)

        # Background gradient line
        line = Line(LEFT * 8, RIGHT * 8, stroke_width=2, color=title_color)
        line.set_opacity(0.3)

        # Title
        title = Text(
            self.TITLE,
            font_size=56,
            color=title_color,
            weight=BOLD,
        )
        title.move_to(UP * 0.5)

        # Subtitle
        subtitle = Text(
            self.SUBTITLE,
            font_size=28,
            color=GREY_B,
        )
        subtitle.next_to(title, DOWN, buff=0.6)

        # Decorative underline
        underline = Line(
            LEFT * 2, RIGHT * 2,
            stroke_width=3,
            color=title_color,
        )
        underline.next_to(title, DOWN, buff=0.25)

        # Animations
        self.play(
            GrowFromCenter(line),
            run_time=0.8,
        )
        self.play(
            Write(title),
            run_time=1.5,
        )
        self.play(
            GrowFromCenter(underline),
            FadeIn(subtitle, shift=UP * 0.3),
            run_time=1.0,
        )
        self.wait(3)
        self.play(
            FadeOut(VGroup(title, subtitle, underline, line)),
            run_time=0.8,
        )

    def _parse_color(self, color_str: str):
        """Parse color string to Manim color."""
        color_map = {
            "YELLOW": YELLOW, "BLUE": BLUE, "GREEN": GREEN,
            "RED": RED, "WHITE": WHITE, "ORANGE": ORANGE,
            "PURPLE": PURPLE, "TEAL": TEAL, "PINK": PINK,
        }
        return color_map.get(color_str.upper(), YELLOW)
