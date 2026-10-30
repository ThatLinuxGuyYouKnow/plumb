"""Plumb conversion + render service (SPEC sect 11).

Stateless stdlib HTTP service (no web framework). Designed for Nebius
Serverless containers: binds 0.0.0.0:$PORT (default 8080), threaded,
no local state beyond temp files, logs to stdout.

Endpoints:
  GET  /health            {ok, service, version, capabilities}
  GET  /version           alias with format list
  POST /dxf               {plan} -> application/dxf
  POST /dwg               {plan} -> application/acad (needs converter, else 501)
  POST /ifc               {plan} -> application/step
  POST /svg               {plan[, options]} -> image/svg+xml
  POST /pdf               {plan[, options]} -> application/pdf (A3 1:50)
  POST /png               {plan[, options]} -> image/png
  POST /render            {plan, format, options?} -> unified render/convert
  POST /dxf/parse         raw DXF -> DxfDocument JSON
  POST /dwg/parse         raw DWG -> DxfDocument JSON (needs converter, else 501)

DWG goes through plumb_dwg (external subprocess only — never linked GPL).
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, __file__.rsplit("/", 1)[0])

SERVICE = "plumb-convert"
VERSION = "0.2.0"
MAX_BODY = 32 * 1024 * 1024
SERVICE_TOKEN = os.environ.get("SERVICE_TOKEN", "").strip()


def _plan_and_options(raw: bytes) -> tuple[dict, dict]:
    obj = json.loads(raw.decode("utf-8"))
    if not isinstance(obj, dict):
        raise ValueError("body must be a JSON object")
    # Accept a .plumb.json file ({schemaVersion, plan}) or {plan, options}.
    if "levels" not in obj and isinstance(obj.get("plan"), dict):
        opts = obj.get("options") if isinstance(obj.get("options"), dict) else {}
        # top-level format leaks into options for /render convenience
        if isinstance(obj.get("format"), str):
            opts = {**opts, "format": obj["format"]}
        return obj["plan"], opts
    if "levels" in obj:
        return obj, {}
    raise ValueError("body must be a Plan, a .plumb.json file, or {plan, options}")


def _capabilities() -> dict:
    caps: dict = {"service": SERVICE, "version": VERSION,
                  "formats": ["dxf", "dwg", "ifc", "svg", "pdf", "png"]}
    try:
        from plumb_dwg import capabilities as _dwg
        caps["dwg"] = _dwg()
    except Exception:
        caps["dwg"] = {"available": False}
    try:
        import cairosvg  # noqa: F401
        caps["png"] = True
    except Exception:
        caps["png"] = False
    try:
        import reportlab  # noqa: F401
        caps["pdf"] = True
    except Exception:
        caps["pdf"] = False
    caps["svg"] = True
    return caps


class Handler(BaseHTTPRequestHandler):
    server_version = "PlumbConvert/0.2"

    def log_message(self, fmt, *args):  # stdout logs for Nebius
        sys.stdout.write("%s - %s\n" % (self.address_string(), fmt % args))
        sys.stdout.flush()

    # -- helpers ------------------------------------------------------
    def _read(self) -> bytes:
        try:
            n = int(self.headers.get("Content-Length", "0") or "0")
        except ValueError:
            n = 0
        if n > MAX_BODY:
            raise ValueError(f"body too large ({n} > {MAX_BODY})")
        return self.rfile.read(n) if n > 0 else b""

    def _cors(self) -> None:
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-methods", "GET, POST, OPTIONS")
        self.send_header("access-control-allow-headers", "content-type")

    def _send(self, status: int, ctype: str, body: bytes, filename: str | None = None):
        self.send_response(status)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(body)))
        if filename:
            self.send_header("content-disposition", f'attachment; filename="{filename}"')
        self._cors()
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, status: int, obj: object):
        self._send(status, "application/json", json.dumps(obj).encode())

    def _err(self, status: int, msg: str):
        self._json(status, {"error": str(msg)[:300]})

    def _authorized(self) -> bool:
        if not SERVICE_TOKEN:
            return True
        auth = self.headers.get("Authorization", "")
        return auth == f"Bearer {SERVICE_TOKEN}"

    # -- routes --------------------------------------------------------
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?", 1)[0].rstrip("/") or "/"
        if path == "/health":
            self._json(200, {"ok": True, **_capabilities()})
        elif path in ("/version", "/capabilities"):
            self._json(200, _capabilities())
        elif path == "/":
            self._json(200, {"service": SERVICE, "version": VERSION,
                             "docs": "POST /dxf|/dwg|/ifc|/svg|/pdf|/png|/render, POST /dxf/parse|/dwg/parse, GET /health",
                             **_capabilities()})
        else:
            self._err(404, "not found")

    def do_HEAD(self):
        self.do_GET()

    def do_POST(self):
        if not self._authorized():
            self._err(401, "unauthorized (bad or missing bearer token)")
            return
        try:
            path = self.path.split("?", 1)[0].rstrip("/") or "/"
            if path == "/dxf":
                from plumb_dxf import export_dxf_bytes
                plan, _ = _plan_and_options(self._read())
                self._send(200, "application/dxf", export_dxf_bytes(plan), "plan.dxf")
            elif path == "/dwg":
                from plumb_dwg import DwgUnavailableError, dxf_to_dwg_bytes
                from plumb_dxf import export_dxf_bytes
                plan, opts = _plan_and_options(self._read())
                try:
                    out = dxf_to_dwg_bytes(export_dxf_bytes(plan),
                                           str(opts.get("version", "r2000")))
                except DwgUnavailableError as e:
                    self._err(501, str(e))
                    return
                self._send(200, "application/acad", out, "plan.dwg")
            elif path == "/ifc":
                from plumb_ifc import export_ifc
                plan, _ = _plan_and_options(self._read())
                self._send(200, "application/step", export_ifc(plan).encode("utf-8"), "plan.ifc")
            elif path == "/svg":
                from plumb_svg import export_svg
                plan, opts = _plan_and_options(self._read())
                svg = export_svg(plan, bool(opts.get("trueScale", False)),
                                 opts.get("background"))
                self._send(200, "image/svg+xml", svg.encode("utf-8"), "plan.svg")
            elif path == "/pdf":
                from plumb_pdf import export_pdf_bytes
                plan, opts = _plan_and_options(self._read())
                try:
                    scale = float(opts.get("scale", 50.0))
                except (TypeError, ValueError):
                    scale = 50.0
                try:
                    out = export_pdf_bytes(plan, scale)
                except RuntimeError as e:
                    self._err(501, str(e))
                    return
                self._send(200, "application/pdf", out, "plan.pdf")
            elif path == "/png":
                from plumb_render import render_png_bytes
                plan, opts = _plan_and_options(self._read())
                try:
                    width = int(opts.get("width", 1600))
                except (TypeError, ValueError):
                    width = 1600
                try:
                    out = render_png_bytes(plan, width, opts.get("background", "white"))
                except RuntimeError as e:
                    self._err(501, str(e))
                    return
                self._send(200, "image/png", out, "plan.png")
            elif path == "/render":
                self._handle_render()
            elif path == "/dxf/parse":
                from plumb_parse import parse_dxf_bytes
                doc = parse_dxf_bytes(self._read())
                self._send(200, "application/json", json.dumps(doc).encode())
            elif path == "/dwg/parse":
                from plumb_dwg import DwgUnavailableError, dwg_to_dxf_bytes
                from plumb_parse import parse_dxf_bytes
                try:
                    dxf = dwg_to_dxf_bytes(self._read())
                except DwgUnavailableError as e:
                    self._err(501, str(e))
                    return
                doc = parse_dxf_bytes(dxf)
                self._send(200, "application/json", json.dumps(doc).encode())
            else:
                self._err(404, "not found")
        except Exception as e:  # never leak a stack to the client
            try:
                self._err(400, e)
            except BrokenPipeError:
                pass

    def _handle_render(self):
        raw = self._read()
        obj = json.loads(raw.decode("utf-8"))
        if not isinstance(obj, dict):
            raise ValueError("body must be {plan, format}")
        fmt = str(obj.get("format", "")).lower()
        plan = obj["plan"] if isinstance(obj.get("plan"), dict) else None
        if plan is None:
            # allow bare plan + ?format=… or {format} merged at top level
            if "levels" in obj:
                plan, fmt = obj, str(obj.get("format", "")).lower()
            else:
                raise ValueError("body must be {plan, format}")
        opts = obj.get("options") if isinstance(obj.get("options"), dict) else {}
        if fmt == "dxf":
            from plumb_dxf import export_dxf_bytes
            self._send(200, "application/dxf", export_dxf_bytes(plan), "plan.dxf")
        elif fmt == "dwg":
            from plumb_dwg import DwgUnavailableError, dxf_to_dwg_bytes
            from plumb_dxf import export_dxf_bytes
            try:
                out = dxf_to_dwg_bytes(export_dxf_bytes(plan), str(opts.get("version", "r2000")))
            except DwgUnavailableError as e:
                self._err(501, str(e))
                return
            self._send(200, "application/acad", out, "plan.dwg")
        elif fmt == "ifc":
            from plumb_ifc import export_ifc
            self._send(200, "application/step", export_ifc(plan).encode("utf-8"), "plan.ifc")
        elif fmt == "svg":
            from plumb_svg import export_svg
            svg = export_svg(plan, bool(opts.get("trueScale", False)), opts.get("background"))
            self._send(200, "image/svg+xml", svg.encode("utf-8"), "plan.svg")
        elif fmt == "pdf":
            from plumb_pdf import export_pdf_bytes
            try:
                out = export_pdf_bytes(plan, float(opts.get("scale", 50.0)))
            except RuntimeError as e:
                self._err(501, str(e))
                return
            self._send(200, "application/pdf", out, "plan.pdf")
        elif fmt == "png":
            from plumb_render import render_png_bytes
            try:
                out = render_png_bytes(plan, int(opts.get("width", 1600)),
                                       opts.get("background", "white"))
            except RuntimeError as e:
                self._err(501, str(e))
                return
            self._send(200, "image/png", out, "plan.png")
        else:
            self._err(400, f"unknown format '{fmt}' (dxf|dwg|ifc|svg|pdf|png)")


def resolve_port(argv: list[str], env) -> int:
    """Pick the listen port: explicit argv > $PORT > platform default.

    The platform default is 80 on Vercel (its container runtime routes to
    port 80 unless the PORT project setting overrides it) and 8080
    everywhere else, so local runs stay unprivileged and match the README /
    DEPLOY_NEBIUS.md examples.
    """
    if len(argv) > 1:
        return int(argv[1])
    port = int(env.get("PORT", "0") or "0")
    if port:
        return port
    return 80 if env.get("VERCEL") else 8080


def main() -> None:
    port = resolve_port(sys.argv, os.environ)
    srv = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    srv.daemon_threads = True
    print(f"{SERVICE} {VERSION} listening on 0.0.0.0:{port}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
