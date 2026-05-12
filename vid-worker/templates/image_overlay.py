"""
Manim Template: Image Overlay
Display image with title, annotations, and zoom animation.
Used when user provides an image or AI generates one.
"""
from manimlib import *


class ImageOverlayScene(Scene):
    """Display image with text overlay and pan/zoom."""

    IMAGE_PATH = "{image_path}"
    TITLE = "{title}"
    ANNOTATIONS = "{annotations}"  # comma-separated annotation texts

    def construct(self):
        title = Text(
            self.TITLE if self.TITLE != "{title}" else "",
            font_size=32, color=WHITE,
        )
        title.to_edge(UP, buff=0.4)

        # Load image
        image_path = self.IMAGE_PATH if self.IMAGE_PATH != "{image_path}" else None
        if image_path and image_path != "None":
            try:
                img = ImageMobject(image_path)
                img.set_height(5.0)
                img.move_to(DOWN * 0.3)
            except Exception:
                img = self._create_placeholder()
        else:
            img = self._create_placeholder()

        # Parse annotations
        ann_str = self.ANNOTATIONS if self.ANNOTATIONS != "{annotations}" else ""
        annotations = [a.strip() for a in ann_str.split(",") if a.strip()]

        # Animations
        if self.TITLE and self.TITLE != "{title}":
            self.play(Write(title), run_time=0.8)

        self.play(FadeIn(img, scale=0.9), run_time=1.2)
        self.wait(1)

        # Slow zoom effect
        self.play(
            img.animate.scale(1.15),
            run_time=4,
            rate_func=linear,
        )

        # Show annotations as labels
        if annotations:
            ann_texts = VGroup()
            for i, ann in enumerate(annotations[:4]):
                ann_text = Text(ann, font_size=20, color=YELLOW)
                ann_bg = BackgroundRectangle(ann_text, color=BLACK, fill_opacity=0.7, buff=0.1)
                ann_group = VGroup(ann_bg, ann_text)
                # Position around the image
                positions = [UR, UL, DR, DL]
                ann_group.move_to(img.get_corner(positions[i % 4]) + positions[i % 4] * 0.3)
                ann_texts.add(ann_group)

            self.play(*[FadeIn(a) for a in ann_texts], run_time=1.0)

        self.wait(2)

    def _create_placeholder(self):
        """Create a placeholder rectangle when no image available."""
        rect = Rectangle(
            width=8, height=4.5,
            fill_color="#1e293b",
            fill_opacity=1,
            stroke_color=GREY_D,
        )
        icon = Text("🖼️", font_size=64)
        return VGroup(rect, icon).move_to(DOWN * 0.3)
