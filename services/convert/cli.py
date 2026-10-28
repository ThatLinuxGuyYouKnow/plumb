"""CLI for tests and scripts: dxf | ifc | parse | audit."""
import json
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "dxf":
        from plumb_dxf import export_dxf_bytes

        plan = json.load(sys.stdin)
        sys.stdout.buffer.write(export_dxf_bytes(plan))
    elif cmd == "ifc":
        from plumb_ifc import export_ifc

        plan = json.load(sys.stdin)
        sys.stdout.write(export_ifc(plan))
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
        print("usage: cli.py dxf|ifc|parse|audit", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
