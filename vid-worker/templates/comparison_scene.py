"""
Manim Template: Comparison Scene
Side-by-side comparison of two concepts/options.
"""
from manimlib import *


class ComparisonScene(Scene):
    """Side-by-side comparison with animated items."""

    LEFT_TITLE = "{left_title}"
    RIGHT_TITLE = "{right_title}"
    LEFT_ITEMS = "{left_items}"     # comma-separated: "item1,item2,item3"
    RIGHT_ITEMS = "{right_items}"   # comma-separated
    WINNER = "{winner}"             # "left" or "right" or "none"

    def construct(self):
        # Center divider
        divider = DashedLine(UP * 3, DOWN * 3, color=GREY_D, dash_length=0.1)

        # Left title
        left_title = Text(
            self.LEFT_TITLE if self.LEFT_TITLE != "{left_title}" else "Option A",
            font_size=32, color=BLUE,
        )
        left_title.move_to(LEFT * 3.5 + UP * 2.5)

        # Right title
        right_title = Text(
            self.RIGHT_TITLE if self.RIGHT_TITLE != "{right_title}" else "Option B",
            font_size=32, color=GREEN,
        )
        right_title.move_to(RIGHT * 3.5 + UP * 2.5)

        # Parse items
        left_items_str = self.LEFT_ITEMS if self.LEFT_ITEMS != "{left_items}" else "Item 1,Item 2,Item 3"
        right_items_str = self.RIGHT_ITEMS if self.RIGHT_ITEMS != "{right_items}" else "Item 1,Item 2,Item 3"
        left_items = [s.strip() for s in left_items_str.split(",")]
        right_items = [s.strip() for s in right_items_str.split(",")]

        # Create item texts
        left_group = VGroup()
        for i, item in enumerate(left_items[:6]):
            bullet = Text(f"• {item}", font_size=22, color=WHITE)
            bullet.move_to(LEFT * 3.5 + UP * (1.5 - i * 0.6))
            bullet.align_to(LEFT * 5.5, LEFT)
            left_group.add(bullet)

        right_group = VGroup()
        for i, item in enumerate(right_items[:6]):
            bullet = Text(f"• {item}", font_size=22, color=WHITE)
            bullet.move_to(RIGHT * 3.5 + UP * (1.5 - i * 0.6))
            bullet.align_to(RIGHT * 1.5, LEFT)
            right_group.add(bullet)

        # Animations
        self.play(ShowCreation(divider), run_time=0.5)
        self.play(Write(left_title), Write(right_title), run_time=1.0)

        for l_item, r_item in zip(left_group, right_group):
            self.play(FadeIn(l_item), FadeIn(r_item), run_time=0.5)

        # Show remaining items if unequal
        remaining = list(left_group)[len(right_group):] + list(right_group)[len(left_group):]
        for item in remaining:
            self.play(FadeIn(item), run_time=0.4)

        self.wait(2)

        # Highlight winner
        winner = self.WINNER if self.WINNER != "{winner}" else "none"
        if winner == "left":
            box = SurroundingRectangle(VGroup(left_title, left_group), color=YELLOW, buff=0.3)
            self.play(ShowCreation(box), run_time=0.8)
        elif winner == "right":
            box = SurroundingRectangle(VGroup(right_title, right_group), color=YELLOW, buff=0.3)
            self.play(ShowCreation(box), run_time=0.8)

        self.wait(2)
