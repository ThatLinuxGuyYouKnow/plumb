"""Plumb SVG export (server-side mirror of packages/io/src/svg.ts).

Pure stdlib: plan level -> SVG string. Layers follow the AIA naming used
by the DXF export (SPEC sect 11). Keeps the Docker image free of extra
dependencies for the vector path; PNG rasterisation lives in plumb_render.
"""
from __future__ import annotations

from typing import Any
from xml.sax.saxutils import escape


def _wall_path(w: dict[str, Any]) -> str:
    import math

    ax, ay = float(w["a"][0]), float(w["a"][1])
    bx, by = float(w["b"][0]), float(w["b"][1])
    dx, dy = bx - ax, by - ay
    length = math.hypot(dx, dy) or 1.0
    ux, uy = dx / length, dy / length
    nx, ny = -uy, ux
    h = float(w["thickness"]) / 2.0
    e = h  # square caps extended by half thickness

    def p(s: float, o: float) -> str:
        return f"{(ax + ux * s + nx * o):.1f},{(ay + uy * s + ny * o):.1f}"

    return f"M{p(-e, -h)} L{p(length + e, -h)} L{p(length + e, h)} L{p(-e, h)} Z"


def _bounds(level: dict[str, Any]) -> tuple[float, float, float, float]:
    x0 = y0 = float("inf")
    x1 = y1 = float("-inf")
    for w in level.get("walls", []):
        for pt in (w["a"], w["b"]):
            x0 = min(x0, float(pt[0]))
            x1 = max(x1, float(pt[0]))
            y0 = min(y0, float(pt[1]))
            y1 = max(y1, float(pt[1]))
    if x0 == float("inf"):
        return (0.0, 0.0, 1000.0, 1000.0)
    return (x0, y0, x1, y1)


def export_svg(plan: dict[str, Any], true_scale: bool = False, background: str | None = None) -> str:
    level = plan["levels"][0]
    pad = 0.0 if true_scale else 500.0
    x0, y0, x1, y1 = _bounds(level)
    vx, vy = x0 - pad, y0 - pad
    vw, vh = (x1 - x0) + pad * 2.0, (y1 - y0) + pad * 2.0

    parts: list[str] = []
    parts.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vx:.1f} {vy:.1f} {vw:.1f} {vh:.1f}" font-family="sans-serif">'
    )
    if background:
        parts.append(f'<rect x="{vx:.1f}" y="{vy:.1f}" width="{vw:.1f}" height="{vh:.1f}" fill="{escape(background)}"/>')

    parts.append('<g id="A-FLOR">')
    for r in level.get("rooms", []):
        rc = r["rect"]
        parts.append(
            f'<rect x="{rc["x"]}" y="{rc["y"]}" width="{rc["w"]}" height="{rc["h"]}" fill="none" stroke="#999" stroke-width="8"/>'
        )
    parts.append("</g>")

    parts.append('<g id="A-WALL" fill="#222">')
    for w in level.get("walls", []):
        parts.append(f'<path d="{_wall_path(w)}"/>')
    parts.append("</g>")

    parts.append('<g id="A-GLAZ" stroke="#222" fill="none" stroke-width="12">')
    for o in level.get("openings", []):
        if o.get("kind") != "window":
            continue
        wall = next((w for w in level.get("walls", []) if w["id"] == o["wall"]), None)
        if wall is None:
            continue
        import math

        dx = wall["b"][0] - wall["a"][0]
        dy = wall["b"][1] - wall["a"][1]
        length = math.hypot(dx, dy) or 1.0
        ux, uy = dx / length, dy / length
        x1p = wall["a"][0] + ux * (o["at"] - o["width"] / 2)
        y1p = wall["a"][1] + uy * (o["at"] - o["width"] / 2)
        x2p = wall["a"][0] + ux * (o["at"] + o["width"] / 2)
        y2p = wall["a"][1] + uy * (o["at"] + o["width"] / 2)
        parts.append(f'<line x1="{x1p:.1f}" y1="{y1p:.1f}" x2="{x2p:.1f}" y2="{y2p:.1f}"/>')
    parts.append("</g>")

    parts.append('<g id="A-DOOR" stroke="#222" fill="none" stroke-width="12">')
    for o in level.get("openings", []):
        if o.get("kind") != "door":
            continue
        wall = next((w for w in level.get("walls", []) if w["id"] == o["wall"]), None)
        if wall is None:
            continue
        import math

        dx = wall["b"][0] - wall["a"][0]
        dy = wall["b"][1] - wall["a"][1]
        length = math.hypot(dx, dy) or 1.0
        ux, uy = dx / length, dy / length
        cx = wall["a"][0] + ux * o["at"]
        cy = wall["a"][1] + uy * o["at"]
        parts.append(
            f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{(o["width"] / 2):.1f}" stroke-dasharray="60,40"/>'
        )
    parts.append("</g>")

    parts.append('<g id="A-FURN" stroke="#222" fill="none" stroke-width="12">')
    for it in level.get("items", []):
        parts.append(
            f'<g transform="translate({it["x"]} {it["y"]}) rotate({it.get("rot", 0)})">'
            f'<rect x="{-it["w"] / 2}" y="{-it["d"] / 2}" width="{it["w"]}" height="{it["d"]}">'
            f"</rect>"
            f'<text x="0" y="0" text-anchor="middle" font-size="120" fill="#222" stroke="none">{escape(str(it.get("label", "")))}</text></g>'
        )
    parts.append("</g>")

    parts.append('<g id="A-ANNO-TEXT" text-anchor="middle">')
    for r in level.get("rooms", []):
        rc = r["rect"]
        cx = rc["x"] + rc["w"] / 2.0
        cy = rc["y"] + rc["h"] / 2.0
        area = rc["w"] * rc["h"] / 1e6
        parts.append(
            f'<text x="{cx:.0f}" y="{(cy - 60):.0f}" font-size="130" letter-spacing="2">{escape(str(r["name"]).upper())}</text>'
        )
        parts.append(f'<text x="{cx:.0f}" y="{(cy + 110):.0f}" font-size="170">{area:.1f} m2</text>')
    parts.append("</g>")

    parts.append('<g id="A-AREA" fill="none" stroke="#666" stroke-width="6">')
    for r in level.get("rooms", []):
        rc = r["rect"]
        parts.append(f'<rect x="{rc["x"]}" y="{rc["y"]}" width="{rc["w"]}" height="{rc["h"]}"/>')
    parts.append("</g>")

    parts.append("</svg>")
    return "\n".join(parts)
