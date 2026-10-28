"""Plumb PNG render: plan -> PNG bytes via SVG + cairosvg.

Keeps the vector source of truth in plumb_svg; this module only rasterises.
Requires the optional 'cairosvg' package (+ system cairo in Docker).
Raises RuntimeError -> the server answers 501 when it is missing.
"""
from __future__ import annotations

from typing import Any


def render_png_bytes(plan: dict[str, Any], width_px: int = 1600,
                     background: str | None = "white") -> bytes:
    try:
        import cairosvg
    except ImportError as e:
        raise RuntimeError("PNG render needs the 'cairosvg' package") from e
    from plumb_svg import export_svg

    svg = export_svg(plan, background=background or "white")
    width_px = max(320, min(int(width_px), 4096))
    return bytes(cairosvg.svg2png(bytestring=svg.encode("utf-8"), output_width=width_px))
