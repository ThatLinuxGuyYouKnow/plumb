"""Plumb PDF export: plan -> A3 1:50 print PDF via reportlab.

Page: A3 landscape (420 x 297 mm). Default scale 1:50, plan centred with
title block (plan name, scale note, room areas). Pure projection of the
semantic model — same geometry helpers as plumb_svg.
"""
from __future__ import annotations

import io
import math
from typing import Any

A3_LANDSCAPE_MM = (420.0, 297.0)
MM_TO_PT = 72.0 / 25.4


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
        return (0.0, 0.0, 10000.0, 7600.0)
    return (x0, y0, x1, y1)


def _wall_polygon(w: dict[str, Any]) -> list[tuple[float, float]]:
    ax, ay = float(w["a"][0]), float(w["a"][1])
    bx, by = float(w["b"][0]), float(w["b"][1])
    dx, dy = bx - ax, by - ay
    length = math.hypot(dx, dy) or 1.0
    ux, uy = dx / length, dy / length
    nx, ny = -uy, ux
    h = float(w["thickness"]) / 2.0
    e = h
    return [
        (ax - ux * e - nx * h, ay - uy * e - ny * h),
        (bx + ux * e - nx * h, by + uy * e - ny * h),
        (bx + ux * e + nx * h, by + uy * e + ny * h),
        (ax - ux * e + nx * h, ay - uy * e + ny * h),
    ]


def export_pdf_bytes(plan: dict[str, Any], scale: float = 50.0) -> bytes:
    try:
        from reportlab.pdfgen import canvas
    except ImportError as e:
        raise RuntimeError("PDF export needs the 'reportlab' package") from e

    level = plan["levels"][0]
    x0, y0, x1, y1 = _bounds(level)
    plan_w, plan_h = (x1 - x0), (y1 - y0)
    page_w_mm, page_h_mm = A3_LANDSCAPE_MM
    margin_mm = 15.0

    # Fit check: at 1:scale the plan must fit the usable area; shrink only if needed.
    usable_w = page_w_mm - margin_mm * 2
    usable_h = page_h_mm - margin_mm * 2 - 18.0  # title strip
    need_w, need_h = plan_w / scale, plan_h / scale
    fit = min(1.0, usable_w / need_w if need_w else 1.0, usable_h / need_h if need_h else 1.0)
    eff = scale / fit if fit < 1.0 else scale

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(page_w_mm * MM_TO_PT, page_h_mm * MM_TO_PT))

    def X(mm_x: float) -> float:
        return (margin_mm + (mm_x - x0) / eff + (usable_w - plan_w / eff) / 2.0) * MM_TO_PT

    def Y(mm_y: float) -> float:
        # PDF y-up: flip plan y, reserve bottom margin + title strip.
        return (margin_mm + 18.0 + (y1 - mm_y) / eff + (usable_h - plan_h / eff) / 2.0) * MM_TO_PT

    def W(mm: float) -> float:
        return mm / eff * MM_TO_PT

    # Border + title.
    c.setStrokeColorRGB(0.1, 0.1, 0.1)
    c.setLineWidth(0.8)
    c.rect(margin_mm * MM_TO_PT, margin_mm * MM_TO_PT,
           (page_w_mm - margin_mm * 2) * MM_TO_PT, (page_h_mm - margin_mm * 2) * MM_TO_PT)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(margin_mm * MM_TO_PT + 6, (margin_mm + 6) * MM_TO_PT,
                 str(plan.get("name", "Plumb plan")))
    c.setFont("Helvetica", 8)
    total_m2 = sum(r["rect"]["w"] * r["rect"]["h"] / 1e6 for r in level.get("rooms", []))
    if fit < 1.0:
        note = f"1:{eff:.0f} (fit to page; plan too large for 1:{scale:.0f} on A3)"
    else:
        note = f"1:{scale:.0f}  A3  net {total_m2:.1f} m2  all dims mm"
    c.drawRightString((page_w_mm - margin_mm) * MM_TO_PT - 6, (margin_mm + 6) * MM_TO_PT, note)

    # Rooms.
    for r in level.get("rooms", []):
        rc = r["rect"]
        c.setFillColorRGB(0.96, 0.96, 0.96)
        c.setStrokeColorRGB(0.45, 0.45, 0.45)
        c.setLineWidth(0.4)
        c.rect(X(rc["x"]), Y(rc["y"] + rc["h"]), W(rc["w"]), W(rc["h"]), stroke=1, fill=1)
        c.setFillColorRGB(0.15, 0.15, 0.15)
        c.setFont("Helvetica-Bold", 7)
        c.drawCentredString(X(rc["x"] + rc["w"] / 2), Y(rc["y"] + rc["h"] / 2) + 8,
                            str(r["name"]).upper())
        c.setFont("Helvetica", 8)
        c.drawCentredString(X(rc["x"] + rc["w"] / 2), Y(rc["y"] + rc["h"] / 2) - 5,
                            f"{rc['w'] * rc['h'] / 1e6:.1f} m2")

    # Walls (filled).
    c.setFillColorRGB(0.12, 0.12, 0.13)
    c.setStrokeColorRGB(0.12, 0.12, 0.13)
    for w in level.get("walls", []):
        pts = _wall_polygon(w)
        p = c.beginPath()
        p.moveTo(X(pts[0][0]), Y(pts[0][1]))
        for px, py in pts[1:]:
            p.lineTo(X(px), Y(py))
        p.close()
        c.drawPath(p, stroke=1, fill=1)

    # Openings: windows blue line, doors arc marker.
    for o in level.get("openings", []):
        wall = next((w for w in level.get("walls", []) if w["id"] == o["wall"]), None)
        if wall is None:
            continue
        dx = wall["b"][0] - wall["a"][0]
        dy = wall["b"][1] - wall["a"][1]
        length = math.hypot(dx, dy) or 1.0
        ux, uy = dx / length, dy / length
        cx = wall["a"][0] + ux * o["at"]
        cy = wall["a"][1] + uy * o["at"]
        x1p = wall["a"][0] + ux * (o["at"] - o["width"] / 2)
        y1p = wall["a"][1] + uy * (o["at"] - o["width"] / 2)
        x2p = wall["a"][0] + ux * (o["at"] + o["width"] / 2)
        y2p = wall["a"][1] + uy * (o["at"] + o["width"] / 2)
        if o.get("kind") == "window":
            c.setStrokeColorRGB(0.15, 0.35, 0.65)
            c.setLineWidth(1.4)
            c.line(X(x1p), Y(y1p), X(x2p), Y(y2p))
        else:
            c.setStrokeColorRGB(0.75, 0.2, 0.1)
            c.setLineWidth(0.9)
            r = W(o["width"] / 2)
            c.circle(X(cx), Y(cy), r, stroke=1, fill=0)

    # Furniture outlines + labels.
    c.setStrokeColorRGB(0.2, 0.2, 0.2)
    c.setLineWidth(0.5)
    c.setFont("Helvetica", 5)
    c.setFillColorRGB(0.2, 0.2, 0.2)
    for it in level.get("items", []):
        c.saveState()
        c.translate(X(it["x"]), Y(it["y"]))
        c.rotate(float(it.get("rot", 0)))
        ww, dd = W(it["w"]), W(it["d"])
        c.rect(-ww / 2, -dd / 2, ww, dd, stroke=1, fill=0)
        c.drawCentredString(0, -1.5, str(it.get("label", ""))[:22])
        c.restoreState()

    # Overall dims (mm).
    c.setFont("Helvetica", 6)
    c.setFillColorRGB(0.3, 0.3, 0.3)
    c.drawCentredString(X((x0 + x1) / 2), Y(y0) - 10, f"{plan_w:.0f}")
    # vertical dim via rotated text
    c.saveState()
    c.translate(X(x1) + 10, Y((y0 + y1) / 2))
    c.rotate(90)
    c.drawCentredString(0, 0, f"{plan_h:.0f}")
    c.restoreState()

    c.showPage()
    c.save()
    return buf.getvalue()
