"""Renderers package — dispatch to correct renderer based on approach."""
from .manim_renderer import render_manim
from .playwright_renderer import render_playwright
from .static_renderer import render_static
from .imagen_renderer import render_imagen

__all__ = ["render_manim", "render_playwright", "render_static", "render_imagen"]
