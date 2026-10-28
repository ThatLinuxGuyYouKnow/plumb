"""Plumb DXF import: DXF bytes -> DxfDocument JSON (SPEC sect 11, M9).

Inverse of plumb_dxf: y-up back to y-down app coords, rotations negated.
PLUMB XDATA rebuilds the semantic model exactly; everything else feeds the
`reconstruct()` heuristics in packages/io.
"""
from __future__ import annotations

from typing import Any

import ezdxf

from plumb_dxf import APPID, get_plumb_xdata


def _flip_y(y: float) -> float:
    return -float(y)


def parse_dxf_bytes(data: bytes) -> dict[str, Any]:
    import io as _io

    doc = ezdxf.read(_io.StringIO(data.decode("utf-8", errors="replace")))
    msp = doc.modelspace()

    try:
        insunits = int(doc.header.get("$INSUNITS", 0))
    except Exception:
        insunits = 0
    layers = [layer.dxf.name for layer in doc.layers]

    lines: list[dict[str, Any]] = []
    arcs: list[dict[str, Any]] = []
    polylines: list[dict[str, Any]] = []
    inserts: list[dict[str, Any]] = []
    texts: list[dict[str, Any]] = []

    walls: list[Any] = []
    openings: list[Any] = []
    rooms: list[Any] = []
    items: list[Any] = []

    def eat_xdata(ent: Any) -> None:
        payload = get_plumb_xdata(ent)
        if not payload or not isinstance(payload, dict):
            return
        kind = payload.get("type")
        entity = payload.get("entity")
        if entity is None:
            return
        if kind == "wall":
            walls.append(entity)
        elif kind == "opening":
            openings.append(entity)
        elif kind == "room":
            rooms.append(entity)
        elif kind == "item":
            items.append(entity)

    for ent in msp:
        t = ent.dxftype()
        layer = str(ent.dxf.get("layer", "0"))
        if t == "LINE":
            s, e = ent.dxf.start, ent.dxf.end
            lines.append({"layer": layer, "x1": s.x, "y1": _flip_y(s.y), "x2": e.x, "y2": _flip_y(e.y)})
        elif t == "LWPOLYLINE":
            pts = [(p[0], _flip_y(p[1])) for p in ent.get_points("xy")]
            closed = bool(ent.closed)
            polylines.append({"layer": layer, "closed": closed, "points": [[x, y] for x, y in pts]})
            # Open polylines also feed the segment-pair heuristic as lines.
            if not closed:
                for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
                    lines.append({"layer": layer, "x1": x1, "y1": y1, "x2": x2, "y2": y2})
            eat_xdata(ent)
        elif t == "ARC":
            c = ent.dxf.center
            arcs.append(
                {
                    "layer": layer,
                    "cx": c.x,
                    "cy": _flip_y(c.y),
                    "r": ent.dxf.radius,
                    "a0": -float(ent.dxf.end_angle),
                    "a1": -float(ent.dxf.start_angle),
                }
            )
        elif t == "CIRCLE":
            c = ent.dxf.center
            arcs.append({"layer": layer, "cx": c.x, "cy": _flip_y(c.y), "r": ent.dxf.radius, "a0": 0, "a1": 360})
        elif t == "INSERT":
            p = ent.dxf.insert
            inserts.append(
                {
                    "layer": layer,
                    "block": str(ent.dxf.name),
                    "x": p.x,
                    "y": _flip_y(p.y),
                    "rot": -float(ent.dxf.get("rotation", 0.0)),
                }
            )
            eat_xdata(ent)
        elif t in ("TEXT", "MTEXT"):
            p = ent.dxf.insert if t == "TEXT" else ent.dxf.insert
            txt = ent.dxf.text if t == "TEXT" else ent.text
            texts.append({"layer": layer, "x": p.x, "y": _flip_y(p.y), "text": str(txt)})
        elif t == "HATCH":
            continue  # derived fill; rooms come from XDATA or detection
        elif t == "DIMENSION":
            continue  # derived annotation
        else:
            continue

    doc_out: dict[str, Any] = {
        "insunits": insunits,
        "layers": layers,
        "lines": lines,
        "arcs": arcs,
        "polylines": polylines,
        "inserts": inserts,
        "texts": texts,
    }
    if walls or openings or rooms or items:
        doc_out["plumbEntities"] = {"walls": walls, "openings": openings, "rooms": rooms, "items": items}
    return doc_out
