"""
Manim Validator — Validate Manim code before rendering.
Checks syntax, imports, and safety constraints.
"""
import ast
import logging
from typing import Tuple

logger = logging.getLogger(__name__)

# Allowed imports for Manim code
ALLOWED_IMPORTS = {
    "manim", "manimlib", "numpy", "np", "math", "random", "functools", "itertools",
    "colour", "scipy",
}

# Dangerous modules that should NOT be imported
BLOCKED_IMPORTS = {
    "os", "sys", "subprocess", "shutil", "pathlib", "socket",
    "http", "urllib", "requests", "importlib", "__builtins__",
}


def validate_manim_code(code: str) -> Tuple[bool, str]:
    """
    Validate Manim Python code for syntax and safety.

    Args:
        code: Python code string

    Returns:
        Tuple of (is_valid, error_message). error_message is empty if valid.
    """
    # 1. Check if code is non-empty
    if not code or not code.strip():
        return False, "Empty code"

    # 2. Syntax check via AST parse
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return False, f"Syntax error at line {e.lineno}: {e.msg}"

    # 3. Check for Scene class
    has_scene_class = False
    has_construct = False

    for node in ast.walk(tree):
        # Check class definitions
        if isinstance(node, ast.ClassDef):
            for base in node.bases:
                base_name = ""
                if isinstance(base, ast.Name):
                    base_name = base.id
                elif isinstance(base, ast.Attribute):
                    base_name = base.attr
                if base_name == "Scene":
                    has_scene_class = True
                    # Check for construct method
                    for item in node.body:
                        if isinstance(item, ast.FunctionDef) and item.name == "construct":
                            has_construct = True

        # Check imports
        if isinstance(node, ast.Import):
            for alias in node.names:
                module = alias.name.split(".")[0]
                if module in BLOCKED_IMPORTS:
                    return False, f"Blocked import: {alias.name}"

        if isinstance(node, ast.ImportFrom):
            if node.module:
                module = node.module.split(".")[0]
                if module in BLOCKED_IMPORTS:
                    return False, f"Blocked import: {node.module}"

    if not has_scene_class:
        return False, "No Scene class found (must inherit from Scene)"

    if not has_construct:
        return False, "No construct() method found in Scene class"

    # 4. Check code length (sanity check)
    if len(code) > 50000:
        return False, f"Code too long: {len(code)} chars (max 50000)"

    line_count = len(code.split("\n"))
    if line_count > 500:
        return False, f"Too many lines: {line_count} (max 500)"

    return True, ""
