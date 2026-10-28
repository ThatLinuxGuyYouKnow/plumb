"""CLI for tests and scripts: dxf | ifc | svg | pdf | png | parse | audit."""
import json
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])


def _plan_and_opts() -> tuple:
    """stdin: bare plan, .plumb.json, or {plan, options}."""
    obj = json.load(sys.stdin)
    if isinstance(obj, dict) and "levels" not in obj and isinstance(obj.get("plan"), dict):
        opts = obj.get("options") if isinstance(obj.get("options"), dict) else {}
        return obj["plan"], opts
    if isinstance(obj, dict) and "levels" in obj:
        return obj, {}
    return obj, {}


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "dxf":
        from plumb_dxf import export_dxf_bytes

        plan, _ = _plan_and_opts()
        sys.stdout.buffer.write(export_dxf_bytes(plan))
    elif cmd == "ifc":
        from plumb_ifc import export_ifc

        plan, _ = _plan_and_opts()
        sys.stdout.write(export_ifc(plan))
    elif cmd == "svg":
        from plumb_svg import export_svg

        plan, opts = _plan_and_opts()
        sys.stdout.write(export_svg(plan, bool(opts.get("trueScale", False)), opts.get("background")))
    elif cmd == "pdf":
        from plumb_pdf import export_pdf_bytes

        plan, opts = _plan_and_opts()
        sys.stdout.buffer.write(export_pdf_bytes(plan, float(opts.get("scale", 50.0))))
    elif cmd == "png":
        from plumb_render import render_png_bytes

        plan, opts = _plan_and_opts()
        sys.stdout.buffer.write(
            render_png_bytes(plan, int(opts.get("width", 1600)), opts.get("background", "white"))
        )
    elif cmd == "parse":
        from plumb_parse import parse_dxf_bytes

        doc = parse_dxf_bytes(sys.stdin.buffer.read())
        json.dump(doc, sys.stdout)
    elif cmd == "audit":
        import io as _io

        import ezdxf

        data = sys.stdin.buffer.read()
        doc = ezdxf.read(_io.StringIO(data.decode("utf-8", errors="replace")))
        auditor = doc.audit()
        print(f"errors={len(auditor.errors)}")
        for e in auditor.errors[:20]:
            print(f"- {e}")
        return 1 if auditor.errors else 0
    else:
        print("usage: cli.py dxf|ifc|svg|pdf|png|parse|audit", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
