"""
Manim Template: Code Display
Animated code with syntax highlighting, line-by-line reveal, and output box.
"""
from manimlib import *


class CodeDisplayScene(Scene):
    """Display code with animated typing and output."""

    TITLE = "{title}"
    CODE = "{code}"             # Multi-line code string
    LANGUAGE = "{language}"
    OUTPUT = "{output}"
    HIGHLIGHT_LINES = "{highlight_lines}"  # e.g. "1,3,5"

    def construct(self):
        # Title
        title = Text(self.TITLE, font_size=28, color=YELLOW)
        title.to_edge(UP, buff=0.4)

        # Code block background
        code_bg = Rectangle(
            width=11, height=4.5,
            fill_color="#1e1e1e",
            fill_opacity=0.95,
            stroke_color=GREY_D,
            stroke_width=1,
        )
        code_bg.move_to(UP * 0.2)

        # Language badge
        lang_text = self.LANGUAGE if self.LANGUAGE != "{language}" else "Code"
        badge = Text(lang_text, font_size=14, color=GREY_B)
        badge.move_to(code_bg.get_corner(UR) + LEFT * 0.8 + DOWN * 0.25)

        # Code text
        code_str = self.CODE if self.CODE != "{code}" else "# Hello World\nprint('Hello!')"
        code_lines = code_str.split("\\n") if "\\n" in code_str else code_str.split("\n")

        code_texts = VGroup()
        for i, line in enumerate(code_lines[:12]):  # Max 12 lines
            # Line number
            line_num = Text(f"{i+1:2d}", font_size=16, color=GREY_D)
            # Code content
            code_line = Text(line, font_size=18, color=WHITE, font="Consolas")

            line_num.move_to(code_bg.get_left() + RIGHT * 0.5 + DOWN * (i * 0.35 - 1.5))
            code_line.next_to(line_num, RIGHT, buff=0.3)
            code_line.align_to(code_bg.get_left() + RIGHT * 1.2, LEFT)

            code_texts.add(VGroup(line_num, code_line))

        # Output box (if provided)
        output_group = VGroup()
        if self.OUTPUT and self.OUTPUT != "{output}":
            output_bg = Rectangle(
                width=11, height=1.2,
                fill_color="#0d1117",
                fill_opacity=0.95,
                stroke_color=GREEN_D,
                stroke_width=1,
            )
            output_bg.next_to(code_bg, DOWN, buff=0.2)

            output_label = Text("Output:", font_size=14, color=GREEN_D)
            output_label.move_to(output_bg.get_left() + RIGHT * 0.8)

            output_text = Text(self.OUTPUT, font_size=18, color=GREEN_A, font="Consolas")
            output_text.next_to(output_label, RIGHT, buff=0.4)

            output_group = VGroup(output_bg, output_label, output_text)

        # Animations
        self.play(FadeIn(title), run_time=0.5)
        self.play(FadeIn(code_bg), FadeIn(badge), run_time=0.5)

        # Reveal code line by line
        for code_line_group in code_texts:
            self.play(FadeIn(code_line_group, shift=RIGHT * 0.2), run_time=0.4)

        self.wait(1)

        # Show output
        if output_group:
            self.play(FadeIn(output_group, shift=UP * 0.2), run_time=0.8)

        self.wait(3)
