"""Plumb DWG bridge: DWG <-> DXF via an external converter subprocess.

SPEC sect 11: DWG is a business/licensing decision; never link GPL code
into the service. This module only shells out to a converter binary that
is installed next to the service (never imported):

  1. ODA File Converter (commercial, best fidelity) if ODA_EXEC is set
     or ODAFileConverter is on PATH. Headless Linux runs it under xvfb-run.
  2. LibreDWG dwg2dxf / dxf2dwg (GPL, separate process — allowed) if on PATH.
     Built into the Docker image from source (see Dockerfile).

Both paths use temp dirs, a 60 s timeout, and verify outputs before
returning. When neither is present, callers get DwgUnavailableError and
the server answers 501 with install hints.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile

TIMEOUT_S = 60


class DwgUnavailableError(RuntimeError):
    pass


def _which(name: str) -> str | None:
    return shutil.which(name)


def oda_executable() -> str | None:
    hint = os.environ.get("ODA_EXEC", "").strip()
    if hint and os.path.isfile(hint) and os.access(hint, os.X_OK):
        return hint
    return _which("ODAFileConverter")


def capabilities() -> dict[str, object]:
    return {
        "dwg2dxf": bool(_which("dwg2dxf")),
        "dxf2dwg": bool(_which("dxf2dwg")),
        "oda": bool(oda_executable()),
        "available": bool(_which("dwg2dxf") or oda_executable()),
    }


def _run(cmd: list[str]) -> None:
    try:
        subprocess.run(cmd, check=True, timeout=TIMEOUT_S,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except subprocess.TimeoutExpired as e:
        raise RuntimeError(f"DWG converter timed out after {TIMEOUT_S}s") from e
    except subprocess.CalledProcessError as e:
        tail = (e.stderr or b"")[-400:].decode("utf-8", errors="replace")
        raise RuntimeError(f"DWG converter failed: {tail[:300]}") from e


def dwg_to_dxf_bytes(dwg: bytes, out_version: str = "r2013") -> bytes:
    """DWG bytes -> ASCII DXF bytes."""
    if len(dwg) < 16:
        raise ValueError("not a DWG file (too short)")
    oda = oda_executable()
    if oda:
        return _oda_convert(dwg, ".dwg", ".dxf", out_version)
    exe = _which("dwg2dxf")
    if exe:
        with tempfile.TemporaryDirectory(prefix="plumb-dwg-") as td:
            src = os.path.join(td, "in.dwg")
            with open(src, "wb") as f:
                f.write(dwg)
            _run([exe, "--as", out_version, "-y", "-o", os.path.join(td, "out.dxf"), src])
            out = os.path.join(td, "out.dxf")
            if not os.path.isfile(out):
                # older dwg2dxf writes next to input as in.dxf
                alt = os.path.join(td, "in.dxf")
                out = alt
            with open(out, "rb") as f:
                data = f.read()
            if not data:
                raise RuntimeError("dwg2dxf produced empty output")
            return data
    raise DwgUnavailableError(
        "no DWG converter installed (need 'dwg2dxf' from LibreDWG or ODA File Converter)")

ODA_OUTVER = {"r14": "ACAD2000", "r2000": "ACAD2004", "r2004": "ACAD2004",
              "r2007": "ACAD2007", "r2010": "ACAD2010", "r2013": "ACAD2013",
              "r2018": "ACAD2018"}


def dxf_to_dwg_bytes(dxf: bytes, out_version: str = "r2000") -> bytes:
    """ASCII DXF bytes -> DWG bytes."""
    if not dxf.strip():
        raise ValueError("empty DXF input")
    exe = _which("dxf2dwg")
    if exe:
        with tempfile.TemporaryDirectory(prefix="plumb-dxf-") as td:
            src = os.path.join(td, "in.dxf")
            with open(src, "wb") as f:
                f.write(dxf)
            _run([exe, "--as", out_version, "-y", "-o", os.path.join(td, "out.dwg"), src])
            out = os.path.join(td, "out.dwg")
            if not os.path.isfile(out):
                out = os.path.join(td, "in.dwg")
            with open(out, "rb") as f:
                data = f.read()
            if not data:
                raise RuntimeError("dxf2dwg produced empty output")
            return data
    oda = oda_executable()
    if oda:
        return _oda_convert(dxf, ".dxf", ".dwg", out_version)
    raise DwgUnavailableError(
        "no DWG converter installed (need 'dxf2dwg' from LibreDWG or ODA File Converter)")


def _oda_convert(data: bytes, in_ext: str, out_ext: str, version: str) -> bytes:
    """ODA File Converter CLI takes dirs, not files; wrap it safely."""
    oda = oda_executable()
    assert oda
    outver = ODA_OUTVER.get(version, "ACAD2013") if out_ext == ".dxf" else ODA_OUTVER.get(version, "ACAD2007")
    outfmt = "DXF" if out_ext == ".dxf" else "DWG"
    filt = "*.DWG" if in_ext == ".dwg" else "*.DXF"
    with tempfile.TemporaryDirectory(prefix="plumb-oda-in-") as ind, \
            tempfile.TemporaryDirectory(prefix="plumb-oda-out-") as outd:
        with open(os.path.join(ind, "in" + in_ext), "wb") as f:
            f.write(data)
        cmd = [oda, ind, outd, outver, outfmt, "0", "1", filt]
        xvfb = _which("xvfb-run")
        if xvfb and not os.environ.get("DISPLAY"):
            cmd = [xvfb, "-a"] + cmd
        _run(cmd)
        outs = [f for f in os.listdir(outd) if f.lower().endswith(out_ext)]
        if not outs:
            raise RuntimeError("ODA File Converter produced no output")
        with open(os.path.join(outd, outs[0]), "rb") as f:
            return f.read()
