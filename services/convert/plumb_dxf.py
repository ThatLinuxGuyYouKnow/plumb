"""Plumb DXF export: semantic plan -> R2013 DXF (mm) via ezdxf.

Conventions (SPEC sect 11):
- y-down app coords become y-up DXF: (x, -y), rotations negated.
- Layers: A-WALL A-DOOR A-GLAZ A-FURN A-FLOR A-AREA A-ANNO-TEXT A-ANNO-DIMS.
- Every semantic entity carries PLUMB XDATA chunks with its JSON so that
  parse_dxf() rebuilds the model exactly.
"""
from __future__ import annotations

import json
import math
from typing import Any

import ezdxf
from ezdxf.entities import DXFEntity

APPID = "PLUMB"
LAYERS = ["A-WALL", "A-DOOR", "A-GLAZ", "A-FURN", "A-FLOR", "A-AREA", "A-ANNO-TEXT", "A-ANNO-DIMS"]
LAYER_COLORS = {
    "A-WALL": 7,
    "A-DOOR": 1,
    "A-GLAZ": 4,
    "A-FURN": 7,
    "A-FLOR": 8,
    "A-AREA": 3,
    "A-ANNO-TEXT": 7,
    "A-ANNO-DIMS": 2,
}

HATCH_PATTERN = {"timber": "LINE", "tile": "NET", "stone": "DOTS", "carpet": None}


def flip(p: tuple[float, float] | list[float]) -> tuple[float, float]:
    return (float(p[0]), -float(p[1]))


def set_plumb_xdata(ent: DXFEntity, payload: dict[str, Any]) -> None:
    raw = json.dumps(payload, separators=(",", ":"))
    chunks = [raw[i : i + 200] for i in range(0, len(raw), 200)] or [""]
    tags = [(1002, "{")] + [(1000, c) for c in chunks] + [(1002, "}")]
    ent.set_xdata(APPID, tags)


def get_plumb_xdata(ent: DXFEntity) -> dict[str, Any] | None:
    try:
        tags = ent.get_xdata(APPID)
    except Exception:
        return None
    if tags is None:
        return None
    parts = [v for code, v in tags if code == 1000]
    if not parts:
        return None
    try:
        return json.loads("".join(parts))
    except Exception:
        return None


def wall_rect(wall: dict[str, Any]) -> list[tuple[float, float]]:
    (ax, ay), (bx, by) = wall["a"], wall["b"]
    dx, dy = bx - ax, by - ay
    length = math.hypot(dx, dy) or 1.0
    ux, uy = dx / length, dy / length
    nx, ny = -uy, ux
    h = wall["thickness"] / 2.0
    e = h
    corners = [
        (ax - ux * e - nx * h, ay - uy * e - ny * h),
        (bx + ux * e - nx * h, by + uy * e - ny * h),
        (bx + ux * e + nx * h, by + uy * e + ny * h),
        (ax - ux * e + nx * h, ay - uy * e + ny * h),
    ]
    return corners


def wall_segments(wall: dict[str, Any], openings: list[dict[str, Any]]) -> list[tuple[float, float]]:
    """Wall centreline intervals between opening cuts (mirrors the renderer)."""
    ax, ay = wall["a"]
    bx, by = wall["b"]
    length = math.hypot(bx - ax, by - ay)
    cuts: list[tuple[float, float]] = []
    for o in openings:
        if o.get("wall") != wall["id"]:
            continue
        at, w = float(o["at"]), float(o["width"])
        cuts.append((at - w / 2.0, at + w / 2.0))
    cuts.sort()
    segs: list[tuple[float, float]] = []
    cur = 0.0
    for s0, s1 in cuts:
        if s0 > cur:
            segs.append((cur, max(cur, s0)))
        cur = max(cur, s1)
    if cur < length:
        segs.append((cur, length))
    return [(s, e) for s, e in segs if e - s > 1.0]


def seg_rect(wall: dict[str, Any], s0: float, s1: float) -> list[tuple[float, float]]:
    (ax, ay), (bx, by) = wall["a"], wall["b"]
    dx, dy = bx - ax, by - ay
    length = math.hypot(dx, dy) or 1.0
    ux, uy = dx / length, dy / length
    nx, ny = -uy, ux
    h = wall["thickness"] / 2.0
    p0 = (ax + ux * s0, ay + uy * s0)
    p1 = (ax + ux * s1, ay + uy * s1)
    return [
        (p0[0] - nx * h, p0[1] - ny * h),
        (p1[0] - nx * h, p1[1] - ny * h),
        (p1[0] + nx * h, p1[1] + ny * h),
        (p0[0] + nx * h, p0[1] + ny * h),
    ]


def opening_frame(opening: dict[str, Any], walls: list[dict[str, Any]]) -> tuple[float, float, float] | None:
    """Centre (app coords), wall angle deg (y-down, clockwise from +x), opening width."""
    wall = next((w for w in walls if w["id"] == opening["wall"]), None)
    if wall is None:
        return None
    (ax, ay), (bx, by) = wall["a"], wall["b"]
    length = math.hypot(bx - ax, by - ay) or 1.0
    ux, uy = (bx - ax) / length, (by - ay) / length
    cx, cy = ax + ux * opening["at"], ay + uy * opening["at"]
    ang = math.degrees(math.atan2(uy, ux))
    return (cx, cy, ang)


def build_doc(plan: dict[str, Any]) -> Any:
    level = plan["levels"][0]
    walls = level.get("walls", [])
    openings = level.get("openings", [])
    rooms = level.get("rooms", [])
    items = level.get("items", [])

    doc = ezdxf.new("R2013")
    doc.header["$INSUNITS"] = 4
    doc.header["$MEASUREMENT"] = 1
    if APPID not in doc.appids:
        doc.appids.add(APPID)
    for name in LAYERS:
        if name not in doc.layers:
            doc.layers.add(name, color=LAYER_COLORS[name])

    # Dimstyle PLUMB-50: 125 mm text (2.5 mm at 1:50), architectural ticks.
    if "PLUMB-50" not in doc.dimstyles:
        ds = doc.dimstyles.new("PLUMB-50")
        ds.dxf.dimtxt = 125.0
        ds.dxf.dimasz = 150.0
        ds.dxf.dimblk = "ARCHTICK"

    msp = doc.modelspace()

    # --- Walls: segments between openings, closed polylines + hatch ---
    for w in walls:
        for i, (s0, s1) in enumerate(wall_segments(w, openings)):
            pts = [flip(p) for p in seg_rect(w, s0, s1)]
            pl = msp.add_lwpolyline(pts, close=True, dxfattribs={"layer": "A-WALL"})
            if i == 0:
                set_plumb_xdata(pl, {"id": w["id"], "type": "wall", "entity": w})
            hatch = msp.add_hatch(color=7, dxfattribs={"layer": "A-WALL"})
            hatch.set_solid_fill(color=7)
            hatch.paths.add_polyline_path(pts, is_closed=True)

    # --- Door / window blocks + inserts ---
    made_blocks: set[str] = set()
    for o in openings:
        frame = opening_frame(o, walls)
        if frame is None:
            continue
        cx, cy, ang = frame
        c = flip((cx, cy))
        rot = -ang
        if o["kind"] == "door":
            blk_name = f"DOOR_{int(round(o['width']))}"
            if blk_name not in made_blocks:
                made_blocks.add(blk_name)
                blk = doc.blocks.new(blk_name)
                w = float(o["width"])
                blk.add_line((0, 0), (w, 0), dxfattribs={"layer": "A-DOOR"})
                blk.add_arc((0, 0), w, 0, 90, dxfattribs={"layer": "A-DOOR"})
            ins = msp.add_blockref(
                blk_name, c, dxfattribs={"layer": "A-DOOR", "rotation": rot}
            )
            set_plumb_xdata(ins, {"id": o["id"], "type": "opening", "entity": o})
        else:
            blk_name = f"WIN_{int(round(o['width']))}"
            if blk_name not in made_blocks:
                made_blocks.add(blk_name)
                blk = doc.blocks.new(blk_name)
                w = float(o["width"])
                for off in (-30.0, 0.0, 30.0):
                    blk.add_line((-w / 2, off), (w / 2, off), dxfattribs={"layer": "A-GLAZ"})
            ins = msp.add_blockref(blk_name, c, dxfattribs={"layer": "A-GLAZ", "rotation": rot})
            set_plumb_xdata(ins, {"id": o["id"], "type": "opening", "entity": o})

    # --- Furniture blocks + inserts ---
    for it in items:
        blk_name = f"FURN_{str(it['type']).upper()}"
        if blk_name not in made_blocks:
            made_blocks.add(blk_name)
            blk = doc.blocks.new(blk_name)
            blk.add_lwpolyline([(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)], close=True)
        ins = msp.add_blockref(
            blk_name,
            flip((it["x"], it["y"])),
            dxfattribs={
                "layer": "A-FURN",
                "rotation": -float(it.get("rot", 0)),
                "xscale": float(it["w"]),
                "yscale": float(it["d"]),
            },
        )
        set_plumb_xdata(ins, {"id": it["id"], "type": "item", "entity": it})

    # --- Rooms: area polyline, floor hatch, name+area text ---
    for r in rooms:
        rect = r["rect"]
        corners = [
            (rect["x"], rect["y"]),
            (rect["x"] + rect["w"], rect["y"]),
            (rect["x"] + rect["w"], rect["y"] + rect["h"]),
            (rect["x"], rect["y"] + rect["h"]),
        ]
        pts = [flip(p) for p in corners]
        pl = msp.add_lwpolyline(pts, close=True, dxfattribs={"layer": "A-AREA"})
        set_plumb_xdata(pl, {"id": r["id"], "type": "room", "entity": r})
        hatch = msp.add_hatch(color=8, dxfattribs={"layer": "A-FLOR"})
        pattern = HATCH_PATTERN.get(r.get("floor", "carpet"))
        if pattern:
            hatch.set_pattern_fill(pattern, color=8, angle=0.0, scale=100.0)
        else:
            hatch.set_solid_fill(color=8)
        hatch.paths.add_polyline_path(pts, is_closed=True)
        cx = rect["x"] + rect["w"] / 2.0
        cy = rect["y"] + rect["h"] / 2.0
        area_m2 = rect["w"] * rect["h"] / 1e6
        msp.add_mtext(
            f"{r['name']}\\P{area_m2:.1f} m2",
            dxfattribs={"layer": "A-ANNO-TEXT", "char_height": 150.0, "attachment_point": 5},
        ).set_location(flip((cx, cy)))

    # --- Overall dimensions (real DIMENSION entities) ---
    xs = [p for w in walls for end in (w["a"], w["b"]) for p in [end[0]]]
    ys = [p for w in walls for end in (w["a"], w["b"]) for p in [end[1]]]
    if xs and ys:
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        # y-up coords for the dim geometry
        dim_w = msp.add_linear_dim(
            base=flip(((x0 + x1) / 2.0, y1 + 900.0)),
            p1=flip((x0, y0)),
            p2=flip((x1, y0)),
            dimstyle="PLUMB-50",
            dxfattribs={"layer": "A-ANNO-DIMS"},
        )
        dim_w.render()
        dim_h = msp.add_linear_dim(
            base=flip((x1 + 900.0, (y0 + y1) / 2.0)),
            p1=flip((x1, y0)),
            p2=flip((x1, y1)),
            dimstyle="PLUMB-50",
            override={"dimtad": 1},
            dxfattribs={"layer": "A-ANNO-DIMS"},
        )
        dim_h.render()

    # --- Paper space A3 1:50 viewport framing the plan ---
    if "A3_1-50" not in doc.layouts:
        layout = doc.layouts.new("A3_1-50")
        if xs and ys:
            cx, cy = (x0 + x1) / 2.0, -(y0 + y1) / 2.0
            w, h = (x1 - x0) + 2200.0, (y1 - y0) + 1800.0
            vp = layout.add_viewport(
                center=(210.0, 148.5),
                size=(400.0, 280.0),
                view_center_point=(cx, cy),
                view_height=h,
            )
            _ = vp, w

    return doc


def export_dxf_bytes(plan: dict[str, Any]) -> bytes:
    import io as _io

    doc = build_doc(plan)
    buf = _io.StringIO()
    doc.write(buf)
    return buf.getvalue().encode("utf-8", errors="replace")
