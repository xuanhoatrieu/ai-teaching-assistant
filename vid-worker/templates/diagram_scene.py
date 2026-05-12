"""
Manim Template: Diagram Scene
Flowchart / architecture diagram with step-by-step build animation.
"""
from manimlib import *


class DiagramScene(Scene):
    """Animated flowchart/diagram with nodes and edges."""

    TITLE = "{title}"
    # Nodes format: "label1:color1,label2:color2,..."
    NODES = "{nodes}"
    # Edges format: "0-1,1-2,2-3" (index pairs)
    EDGES = "{edges}"

    def construct(self):
        title = Text(
            self.TITLE if self.TITLE != "{title}" else "Diagram",
            font_size=32, color=WHITE,
        )
        title.to_edge(UP, buff=0.4)

        # Parse nodes
        nodes_str = self.NODES if self.NODES != "{nodes}" else "Start:BLUE,Process:GREEN,End:RED"
        node_defs = [n.strip().split(":") for n in nodes_str.split(",")]

        # Parse edges
        edges_str = self.EDGES if self.EDGES != "{edges}" else "0-1,1-2"
        edge_defs = [e.strip().split("-") for e in edges_str.split(",")]

        # Create node objects
        color_map = {
            "BLUE": BLUE, "GREEN": GREEN, "RED": RED,
            "YELLOW": YELLOW, "ORANGE": ORANGE, "TEAL": TEAL,
            "PURPLE": PURPLE, "WHITE": WHITE,
        }

        nodes = []
        n = len(node_defs)

        # Layout: horizontal or grid
        if n <= 5:
            # Horizontal layout
            spacing = min(3.0, 12.0 / max(n, 1))
            start_x = -(n - 1) * spacing / 2
            for i, node_def in enumerate(node_defs):
                label = node_def[0]
                color = color_map.get(node_def[1].upper() if len(node_def) > 1 else "BLUE", BLUE)
                pos = RIGHT * (start_x + i * spacing)
                nodes.append(self._create_node(label, color, pos))
        else:
            # Grid layout (2 rows)
            cols = (n + 1) // 2
            spacing = min(3.0, 12.0 / max(cols, 1))
            for i, node_def in enumerate(node_defs):
                label = node_def[0]
                color = color_map.get(node_def[1].upper() if len(node_def) > 1 else "BLUE", BLUE)
                row = i // cols
                col = i % cols
                start_x = -(cols - 1) * spacing / 2
                pos = RIGHT * (start_x + col * spacing) + DOWN * (row * 2 - 0.5)
                nodes.append(self._create_node(label, color, pos))

        # Create edge arrows
        arrows = []
        for edge_def in edge_defs:
            try:
                src = int(edge_def[0])
                dst = int(edge_def[1])
                if src < len(nodes) and dst < len(nodes):
                    arrow = Arrow(
                        nodes[src].get_right(),
                        nodes[dst].get_left(),
                        color=GREY_B,
                        stroke_width=2,
                        buff=0.1,
                    )
                    arrows.append(arrow)
            except (ValueError, IndexError):
                pass

        # Animations
        self.play(FadeIn(title), run_time=0.5)

        for node in nodes:
            self.play(FadeIn(node, scale=0.8), run_time=0.5)

        for arrow in arrows:
            self.play(GrowArrow(arrow), run_time=0.4)

        self.wait(3)

    def _create_node(self, label: str, color, position):
        """Create a rounded rectangle node with label."""
        box = RoundedRectangle(
            width=2.2, height=0.9,
            corner_radius=0.15,
            fill_color=color,
            fill_opacity=0.2,
            stroke_color=color,
            stroke_width=2,
        )
        text = Text(label, font_size=20, color=WHITE)
        group = VGroup(box, text)
        group.move_to(position)
        return group
