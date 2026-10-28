"""Plumb IFC export: semantic plan -> IFC4 STEP text (SPEC sect 11, M8).

Hand-written ISO-10303-21, no ifcopenshell dependency (it does not fit in
this environment; validate structurally here and in a viewer per the manual
checklist). Mapping table from the spec:
plan/level -> Project/Site/Building/Storey, wall -> IfcWall (2700 high),
opening -> IfcOpeningElement + IfcDoor/IfcWindow, room -> IfcSpace + Qto +
Pset_Plumb finish, item -> IfcFurniture box.

Coordinate map: app (x, y-down mm) -> IFC (x, -y, 0).
"""
from __future__ import annotations

import math
import random
import time
from typing import Any

GUID_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$"
WALL_HEIGHT = 2700.0
DOOR_HEIGHT = 2100.0
WINDOW_HEIGHT = 1500.0

FURNITURE_HEIGHT = {
    "wardrobe": 2000.0,
    "fridge": 2000.0,
    "bed": 600.0,
    "bathtub": 600.0,
    "toilet": 800.0,
    "sofa": 900.0,
    "armchair": 900.0,
    "dining": 750.0,
    "desk": 750.0,
    "counter": 900.0,
    "cooktop": 900.0,
    "sinkunit": 900.0,
    "island": 900.0,
    "vanity": 850.0,
}


def guid() -> str:
    return "".join(random.choice(GUID_CHARS) for _ in range(22))


def esc(s: str) -> str:
    return "'" + s.replace("\\", "\\\\").replace("'", "''") + "'"


def f(v: float) -> str:
    return f"{float(v):.1f}"


class B:
    """Numbered STEP entity builder."""

    def __init__(self) -> None:
        self.n = 0
        self.lines: list[str] = []

    def add(self, text: str) -> int:
        self.n += 1
        self.lines.append(f"#{self.n}={text};")
        return self.n


def _placement(b: B, x: float, y: float, ref_angle_rad: float | None) -> int:
    p = b.add(f"IFCCARTESIANPOINT(({f(x)},{f(-y)},0.))")
    dz = b.add("IFCDIRECTION((0.,0.,1.))")
    if ref_angle_rad is None:
        axis = b.add(f"IFCAXIS2PLACEMENT3D(#{p},#{dz}, $)")
    else:
        dx = b.add(f"IFCDIRECTION(({f(math.cos(ref_angle_rad))},{f(math.sin(ref_angle_rad))},0.))")
        axis = b.add(f"IFCAXIS2PLACEMENT3D(#{p},#{dz},#{dx})")
    return b.add(f"IFCLOCALPLACEMENT($,#{axis})")


def _box_shape(b: B, ctx: int, name: str, w: float, d: float, h: float) -> int:
    prof = b.add(f"IFCRECTANGLEPROFILEDEF(.AREA.,{esc(name)},$,{f(w)},{f(d)})")
    o = b.add("IFCCARTESIANPOINT((0.,0.,0.))")
    dz = b.add("IFCDIRECTION((0.,0.,1.))")
    dx = b.add("IFCDIRECTION((1.,0.,0.))")
    axis = b.add(f"IFCAXIS2PLACEMENT3D(#{o},#{dz},#{dx})")
    solid = b.add(f"IFCEXTRUDEDAREASOLID(#{prof},#{axis},#{dz},{f(h)})")
    rep = b.add(f"IFCSHAPEREPRESENTATION(#{ctx},'Body','SweptSolid',(#{solid}))")
    return b.add(f"IFCPRODUCTDEFINITIONSHAPE($,$,(#{rep}))")


def _rel_defines(b: B, owner: int, related: int, pset: int) -> int:
    return b.add(f"IFCRELDEFINESBYPROPERTIES('{guid()}',#{owner},$,$,(#{related}),#{pset})")


def export_ifc(plan: dict[str, Any], wall_height: float = WALL_HEIGHT) -> str:
    level = plan["levels"][0]
    walls = level.get("walls", [])
    openings = level.get("openings", [])
    rooms = level.get("rooms", [])
    items = level.get("items", [])

    b = B()
    person = b.add("IFCPERSON($,$,'Plumb',$,$,$,$,$)")
    org = b.add("IFCORGANIZATION($,'Plumb',$,$,$)")
    pao = b.add(f"IFCPERSONANDORGANIZATION(#{person},#{org},$)")
    app = b.add(f"IFCAPPLICATION(#{org},'1.0','Plumb','PLUMB')")
    owner = b.add(f"IFCOWNERHISTORY(#{pao},#{app},$,.ADDED.,$,#{pao},#{app},0)")
    wcs_o = b.add("IFCCARTESIANPOINT((0.,0.,0.))")
    wcs_z = b.add("IFCDIRECTION((0.,0.,1.))")
    wcs_x = b.add("IFCDIRECTION((1.,0.,0.))")
    wcs = b.add(f"IFCAXIS2PLACEMENT3D(#{wcs_o},#{wcs_z},#{wcs_x})")
    ctx = b.add(f"IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#{wcs},$)")
    u_len = b.add("IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)")
    u_area = b.add("IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)")
    u_vol = b.add("IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)")
    u_ang = b.add("IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)")
    units = b.add(f"IFCUNITASSIGNMENT((#{u_len},#{u_area},#{u_vol},#{u_ang}))")
    proj = b.add(f"IFCPROJECT('{guid()}',#{owner},{esc(str(plan.get('name', 'Plumb plan')))},$,$,$,$,(#{ctx}),#{units})")
    site = b.add(f"IFCSITE('{guid()}',#{owner},'Site',$,$,#{_placement(b, 0, 0, None)},$,$,.ELEMENT.,$,$,$,$,$)")
    bld = b.add(f"IFCBUILDING('{guid()}',#{owner},'Building',$,$,#{_placement(b, 0, 0, None)},$,$,.ELEMENT.,$,$,$)")
    storey = b.add(
        f"IFCBUILDINGSTOREY('{guid()}',#{owner},{esc(str(level.get('name', 'Level 1')))},$,$,"
        f"#{_placement(b, 0, 0, None)},$,$,.ELEMENT.,0.)"
    )
    b.add(f"IFCRELAGGREGATES('{guid()}',#{owner},$,$,#{proj},(#{site}))")
    b.add(f"IFCRELAGGREGATES('{guid()}',#{owner},$,$,#{site},(#{bld}))")
    b.add(f"IFCRELAGGREGATES('{guid()}',#{owner},$,$,#{bld},(#{storey}))")

    wall_ids: dict[str, int] = {}
    contained: list[int] = []
    for w in walls:
        (ax, ay), (bx, by) = w["a"], w["b"]
        dx, dy = bx - ax, by - ay
        length = math.hypot(dx, dy) or 1.0
        ang = math.atan2(dy, dx)
        mx, my = (ax + bx) / 2.0, (ay + by) / 2.0
        place = _placement(b, mx, my, -ang)
        shape = _box_shape(b, ctx, f"Wall {w['id']}", length, float(w["thickness"]), wall_height)
        ent = b.add(f"IFCWALL('{guid()}',#{owner},{esc('Wall ' + str(w['id']))},$,$,#{place},#{shape},$)")
        wall_ids[w["id"]] = ent
        contained.append(ent)

    for o in openings:
        wall = next((w for w in walls if w["id"] == o["wall"]), None)
        if wall is None:
            continue
        (ax, ay), (bx, by) = wall["a"], wall["b"]
        length = math.hypot(bx - ax, by - ay) or 1.0
        ang = math.atan2(by - ay, bx - ax)
        ux, uy = (bx - ax) / length, (by - ay) / length
        cx, cy = ax + ux * float(o["at"]), ay + uy * float(o["at"])
        h = DOOR_HEIGHT if o["kind"] == "door" else WINDOW_HEIGHT
        shape = _box_shape(b, ctx, f"Opening {o['id']}", float(o["width"]), float(wall["thickness"]) + 20.0, h)
        void = b.add(
            f"IFCOPENINGELEMENT('{guid()}',#{owner},{esc('Opening ' + str(o['id']))},$,$,"
            f"#{_placement(b, cx, cy, -ang)},#{shape},$)"
        )
        host = wall_ids.get(o["wall"])
        if host is not None:
            b.add(f"IFCRELVOIDSELEMENT('{guid()}',#{owner},$,$,#{host},#{void})")
        if o["kind"] == "door":
            fshape = _box_shape(b, ctx, f"Door {o['id']}", float(o["width"]), 50.0, DOOR_HEIGHT)
            fill = b.add(
                f"IFCDOOR('{guid()}',#{owner},{esc('Door ' + str(o['id']))},$,$,"
                f"#{_placement(b, cx, cy, -ang)},#{fshape},$,.DOOR.,{f(float(o['width']))},{f(DOOR_HEIGHT)})"
            )
            props = [
                b.add(f"IFCPROPERTYSINGLEVALUE('PlumbId',$,IFCLABEL({esc(str(o['id']))}),$)"),
                b.add(f"IFCPROPERTYSINGLEVALUE('Swing',$,IFCINTEGER({int(o.get('swing', 1))}),$)"),
                b.add(f"IFCPROPERTYSINGLEVALUE('Hinge',$,IFCLABEL({esc(str(o.get('hinge', 'a')))}),$)"),
            ]
        else:
            fshape = _box_shape(b, ctx, f"Window {o['id']}", float(o["width"]), 60.0, WINDOW_HEIGHT)
            fill = b.add(
                f"IFCWINDOW('{guid()}',#{owner},{esc('Window ' + str(o['id']))},$,$,"
                f"#{_placement(b, cx, cy, -ang)},#{fshape},$,.WINDOW.,{f(float(o['width']))},{f(WINDOW_HEIGHT)})"
            )
            props = [b.add(f"IFCPROPERTYSINGLEVALUE('PlumbId',$,IFCLABEL({esc(str(o['id']))}),$)")]
        pset = b.add(f"IFCPROPERTYSET('{guid()}',#{owner},'Pset_Plumb',$,({','.join(f'#{p}' for p in props)}))")
        b.add(f"IFCRELFILLSELEMENT('{guid()}',#{owner},$,$,#{void},#{fill})")
        _rel_defines(b, owner, fill, pset)
        contained.extend([void, fill])

    for r in rooms:
        rect = r["rect"]
        cx, cy = rect["x"] + rect["w"] / 2.0, rect["y"] + rect["h"] / 2.0
        place = _placement(b, cx, cy, None)
        space = b.add(
            f"IFCSPACE('{guid()}',#{owner},{esc(str(r['name']))},$,$,#{place},$,$,.ELEMENT.,$,$)"
        )
        area_m2 = rect["w"] * rect["h"] / 1e6
        q = b.add(f"IFCQUANTITYAREA('NetFloorArea',$,$,{f(area_m2)},$)")
        qto = b.add(f"IFCELEMENTQUANTITY('{guid()}',#{owner},'Qto_SpaceBaseQuantities',$,$,(#{q}))")
        b.add(f"IFCRELDEFINESBYPROPERTIES('{guid()}',#{owner},$,$,(#{space}),#{qto})")
        fp = b.add(f"IFCPROPERTYSINGLEVALUE('FloorFinish',$,IFCLABEL({esc(str(r.get('floor', 'carpet')))}),$)")
        pset = b.add(f"IFCPROPERTYSET('{guid()}',#{owner},'Pset_Plumb',$,(#{fp}))")
        _rel_defines(b, owner, space, pset)
        contained.append(space)

    for it in items:
        h = FURNITURE_HEIGHT.get(str(it.get("type", "")), 900.0)
        place = _placement(b, float(it["x"]), float(it["y"]), -math.radians(float(it.get("rot", 0))))
        shape = _box_shape(b, ctx, str(it.get("label", "item")), float(it["w"]), float(it["d"]), h)
        ent = b.add(
            f"IFCFURNITURE('{guid()}',#{owner},{esc(str(it.get('label', 'item')))},$,"
            f"{esc(str(it.get('type', 'item')))},#{place},#{shape},$)"
        )
        contained.append(ent)

    if contained:
        refs = ",".join(f"#{c}" for c in contained)
        b.add(f"IFCRELCONTAINEDINSPATIALSTRUCTURE('{guid()}',#{owner},$,$,({refs}),#{storey})")

    stamp = time.strftime("%Y-%m-%dT%H:%M:%S")
    header = (
        "ISO-10303-21;\nHEADER;\n"
        "FILE_DESCRIPTION(('IFC4'),'2;1');\n"
        f"FILE_NAME('plumb.ifc','{stamp}',('Plumb'),('Plumb'),'Plumb 0.1','Plumb 0.1','');\n"
        "FILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n"
    )
    return header + "\n".join(b.lines) + "\nENDSEC;\nEND-ISO-10303-21;\n"
