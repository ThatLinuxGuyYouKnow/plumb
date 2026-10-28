# Plumb conversion service (SPEC §11, M7–M9)

Python service around `ezdxf` (see `requirements.txt`). No web framework —
`server.py` is stdlib `http.server`; a FastAPI app can wrap the `plumb_*`
modules later.

| module | job |
|---|---|
| `plumb_dxf.py` | plan → R2013 DXF (`$INSUNITS = 4`, AIA layers, `PLUMB` XDATA) |
| `plumb_parse.py` | DXF bytes → `DxfDocument` JSON for `reconstruct()` in `@plumb/io` |
| `plumb_ifc.py` | plan → IFC4 STEP text (hand-written; see DECISIONS.md) |
| `cli.py` | `dxf | ifc | parse | audit` filter for tests and scripts |
| `server.py` | `GET /health`, `POST /dxf`, `POST /ifc`, `POST /dxf/parse` |

Run locally on `:3102` (the Node server proxies `/api/convert/*` there when
`CONVERT_URL` is set):

```
pip install -r requirements.txt
python3 server.py 3102
```

DWG support slots in front of `/dxf/parse` as a separate converter process;
never link GPL code into this service.
