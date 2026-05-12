#!/usr/bin/env python3
"""
Build Manim Reference Dictionary from 3b1b/manim example_scenes.py
and 3b1b/videos source code.

Extracts Scene class patterns with their construct() methods,
categorizes them, and outputs a JSON reference file for AI code generation.

Usage:
    python3 scripts/build_manim_reference.py
"""
import ast
import json
import os
import re
import sys
from typing import List, Dict, Tuple

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
VID_WORKER_DIR = os.path.dirname(SCRIPTS_DIR)
REPO_ROOT = os.path.dirname(VID_WORKER_DIR)
WORKSPACE = os.path.join(REPO_ROOT, "3b1b-workspace")
EXAMPLE_FILE = os.path.join(WORKSPACE, "manim", "example_scenes.py")
VIDEOS_DIR = os.path.join(WORKSPACE, "videos")
OUTPUT_FILE = os.path.join(VID_WORKER_DIR, "manim_reference.json")

# Tags for auto-categorization
TAG_PATTERNS = {
    "axes": ["Axes(", "axes.", "get_graph", "add_coordinate_labels", "i2gp", "c2p", "p2c"],
    "graph": ["get_graph", "sin_graph", "parabola", "ValueTracker", "x_tracker"],
    "tex": ["Tex(", "TexText(", "TransformMatchingStrings", "TransformMatchingShapes"],
    "formula": ["Tex(", "^2", "\\frac", "\\sum", "\\sqrt", "equation"],
    "text": ["Text(", "Write(", "FadeIn(", "FadeOut("],
    "animation": ["self.play(", "self.wait(", ".animate.", "run_time="],
    "transform": ["Transform(", "ReplacementTransform(", "FadeTransform("],
    "color": ["set_color(", "set_fill(", "t2c=", "BLUE", "YELLOW", "RED", "GREEN"],
    "geometry": ["Circle(", "Square(", "Rectangle(", "Line(", "Arrow(", "Dot("],
    "numberplane": ["NumberPlane(", "ComplexPlane(", "apply_matrix", "apply_complex_function"],
    "updater": ["add_updater", "always_redraw", "f_always", "ValueTracker"],
    "matrix": ["IntegerMatrix(", "Matrix("],
    "3d": ["ThreeDScene", "Surface", "Torus(", "Sphere(", "self.frame"],
    "title": ["title", "to_edge(UP)", "font_size=56", "font_size=48"],
    "brace": ["Brace(", "always_redraw"],
    "implicit": ["ImplicitFunction("],
}


def extract_scenes_from_file(filepath: str) -> List[Dict]:
    """Extract all Scene classes from a Python file."""
    try:
        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
            source = f.read()
    except Exception:
        return []

    # Quick check: skip files without Scene
    if "Scene" not in source or "def construct" not in source:
        return []

    try:
        tree = ast.parse(source)
    except SyntaxError:
        return []

    scenes = []
    lines = source.split("\n")

    for node in ast.walk(tree):
        if not isinstance(node, ast.ClassDef):
            continue

        # Check if inherits from Scene (or ThreeDScene, etc.)
        base_names = []
        for base in node.bases:
            if isinstance(base, ast.Name):
                base_names.append(base.id)
            elif isinstance(base, ast.Attribute):
                base_names.append(base.attr)

        if not any("Scene" in b for b in base_names):
            continue

        # Extract construct method
        construct_node = None
        for item in node.body:
            if isinstance(item, ast.FunctionDef) and item.name == "construct":
                construct_node = item
                break

        if not construct_node:
            continue

        # Get source code for the entire class
        start_line = node.lineno - 1
        end_line = node.end_lineno if hasattr(node, 'end_lineno') else start_line + 50
        class_source = "\n".join(lines[start_line:end_line])

        # Skip very long scenes (>100 lines) — too complex for reference
        line_count = end_line - start_line
        if line_count > 120:
            # Truncate to first 80 lines + comment
            class_source = "\n".join(lines[start_line:start_line + 80])
            class_source += "\n        # ... (truncated for brevity)"

        # Auto-tag
        tags = auto_tag(class_source)

        # Determine template type
        template_type = classify_scene(class_source, tags)

        scenes.append({
            "name": node.name,
            "base_class": base_names[0] if base_names else "Scene",
            "source": filepath.replace(REPO_ROOT + "/", ""),
            "line_count": min(line_count, 80),
            "template_type": template_type,
            "tags": tags,
            "code": class_source,
        })

    return scenes


def auto_tag(code: str) -> List[str]:
    """Auto-detect tags based on code content."""
    tags = []
    for tag, patterns in TAG_PATTERNS.items():
        if any(p in code for p in patterns):
            tags.append(tag)
    return sorted(set(tags))


def classify_scene(code: str, tags: List[str]) -> str:
    """Classify scene into a template type."""
    if "3d" in tags:
        return "3d_scene"
    if "axes" in tags or "graph" in tags:
        return "graph_scene"
    if "formula" in tags and "transform" in tags:
        return "formula_transform"
    if "formula" in tags or "tex" in tags:
        return "formula_scene"
    if "numberplane" in tags:
        return "coordinate_transform"
    if "matrix" in tags:
        return "matrix_scene"
    if "updater" in tags:
        return "updater_animation"
    if "title" in tags:
        return "title_card"
    if "geometry" in tags:
        return "geometry_scene"
    return "general"


def build_reference():
    """Build the complete reference dictionary."""
    all_scenes = []

    # 1. Extract from example_scenes.py (highest priority)
    print(f"📖 Reading {EXAMPLE_FILE}...")
    examples = extract_scenes_from_file(EXAMPLE_FILE)
    for s in examples:
        s["priority"] = "high"
        s["source_type"] = "official_examples"
    all_scenes.extend(examples)
    print(f"   Found {len(examples)} scenes")

    # 2. Extract from 3b1b/videos (real-world patterns)
    video_count = 0
    if os.path.exists(VIDEOS_DIR):
        print(f"📹 Scanning {VIDEOS_DIR}...")
        for root, dirs, files in os.walk(VIDEOS_DIR):
            # Skip hidden dirs
            dirs[:] = [d for d in dirs if not d.startswith(".")]
            for fname in files:
                if not fname.endswith(".py"):
                    continue
                filepath = os.path.join(root, fname)
                scenes = extract_scenes_from_file(filepath)
                for s in scenes:
                    s["priority"] = "medium"
                    s["source_type"] = "3b1b_videos"
                all_scenes.extend(scenes)
                video_count += 1

        print(f"   Scanned {video_count} files, found {len(all_scenes) - len(examples)} scenes")

    # 3. Deduplicate by name (keep highest priority)
    seen = {}
    for scene in all_scenes:
        key = scene["name"]
        if key not in seen or scene["priority"] == "high":
            seen[key] = scene
    unique_scenes = list(seen.values())

    # 4. Sort: official examples first, then by template type
    unique_scenes.sort(key=lambda s: (
        0 if s["priority"] == "high" else 1,
        s["template_type"],
        s["name"],
    ))

    # 5. Select top patterns per category (max 5 per type)
    categories = {}
    for scene in unique_scenes:
        t = scene["template_type"]
        if t not in categories:
            categories[t] = []
        if len(categories[t]) < 5:
            categories[t].append(scene)

    selected = []
    for scenes in categories.values():
        selected.extend(scenes)

    # 6. Build output
    reference = {
        "_meta": {
            "version": "1.0",
            "total_files_scanned": video_count + 1,
            "total_scenes_found": len(all_scenes),
            "selected_patterns": len(selected),
            "categories": {k: len(v) for k, v in categories.items()},
        },
        "patterns": {},
    }

    for scene in selected:
        reference["patterns"][scene["name"]] = {
            "template_type": scene["template_type"],
            "tags": scene["tags"],
            "base_class": scene["base_class"],
            "source": scene["source"],
            "line_count": scene["line_count"],
            "code": scene["code"],
        }

    # 7. Write output
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(reference, f, indent=2, ensure_ascii=False)

    print(f"\n✅ Reference dictionary built: {OUTPUT_FILE}")
    print(f"   {len(selected)} patterns in {len(categories)} categories")
    print(f"   Categories: {', '.join(f'{k}({v})' for k, v in sorted(categories.items(), key=lambda x: -len(x[1])))}")

    return reference


if __name__ == "__main__":
    build_reference()
