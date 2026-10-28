"""Stdlib HTTP conversion service (SPEC sect 2 allows the shape to evolve).

No third-party web framework: only ezdxf is required. Endpoints:
  GET  /health
  POST /dxf        {plan} -> application/dxf
  POST /ifc        {plan} -> application/step
  POST /dxf/parse  raw DXF -> DxfDocument JSON
A DWG->DXF step slots in front of /dxf/parse later as a separate process.
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, __file__.rsplit("/", 1)[0])


def _plan_of(raw: bytes) -> dict:
    import json as _json

    obj = _json.loads(raw.decode("utf-8"))
    # Accept a Plan or a .plumb.json file ({schemaVersion, plan}).
    if isinstance(obj, dict) and "levels" not in obj and isinstance(obj.get("plan"), dict):
        return obj["plan"]
    return obj


class Handler(BaseHTTPRequestHandler):
    server_version = "PlumbConvert/0.1"

    def log_message(self, *args):  # quieter logs
        pass

    def _read(self) -> bytes:
        n = int(self.headers.get("Content-Length", "0") or "0")
        return self.rfile.read(n) if n > 0 else b""

    def do_GET(self):
        if self.path == "/health":
            body = json.dumps({"ok": True}).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        try:
            if self.path == "/dxf":
                from plumb_dxf import export_dxf_bytes

                out = export_dxf_bytes(_plan_of(self._read()))
                self._send(200, "application/dxf", out)
            elif self.path == "/ifc":
                from plumb_ifc import export_ifc

                self._send(200, "application/step", export_ifc(_plan_of(self._read())).encode("utf-8"))
            elif self.path == "/dxf/parse":
                from plumb_parse import parse_dxf_bytes

                doc = parse_dxf_bytes(self._read())
                self._send(200, "application/json", json.dumps(doc).encode())
            else:
                self.send_response(404)
                self.end_headers()
        except Exception as e:  # never leak a stack to the client
            body = json.dumps({"error": str(e)[:300]}).encode()
            self.send_response(400)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def _send(self, status: int, ctype: str, body: bytes):
        self.send_response(status)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3102
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()
