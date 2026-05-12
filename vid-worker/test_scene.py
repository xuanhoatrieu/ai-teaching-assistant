from manimlib import *

class GradientDescentScene(Scene):
    def construct(self):
        title = Text("Gradient Descent là gì?", font_size=60, color="#FFD700")
        self.play(Write(title))
        self.wait(1)
        self.play(title.animate.to_edge(UP))

        axes = Axes(
            x_range=[-3, 3, 1],
            y_range=[0, 9, 1],
            width=8,
            height=6,
            axis_config={"stroke_color": "#CCCCCC"}
        )
        axes.shift(DOWN * 0.5)

        # Draw a parabola y = x^2
        graph = axes.get_graph(lambda x: x**2, color="#00BFFF", x_range=[-3, 3])
        graph_label = Text("y = x²", font_size=36, color="#00BFFF").next_to(graph, UP)

        self.play(ShowCreation(axes))
        self.play(ShowCreation(graph), Write(graph_label))
        self.wait(1)

        # Draw a point moving down the gradient
        dot = Dot(color="#FF4500", radius=0.15)
        
        # Start at x = 2.5
        start_x = 2.5
        dot.move_to(axes.c2p(start_x, start_x**2))
        
        self.play(FadeIn(dot, scale=0.5))
        self.wait(0.5)

        # Simulate steps
        current_x = start_x
        learning_rate = 0.15
        
        for _ in range(5):
            gradient = 2 * current_x
            next_x = current_x - learning_rate * gradient
            
            # Arrow showing direction
            arrow = Arrow(
                axes.c2p(current_x, current_x**2),
                axes.c2p(next_x, next_x**2),
                buff=0, color="#FF00FF"
            )
            self.play(ShowCreation(arrow), run_time=0.5)
            self.play(dot.animate.move_to(axes.c2p(next_x, next_x**2)), run_time=0.5)
            self.play(FadeOut(arrow), run_time=0.2)
            
            current_x = next_x
            self.wait(0.3)
            
        self.wait(2)
