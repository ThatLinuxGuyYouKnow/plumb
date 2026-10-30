# Plumb conversion + render service (SPEC §11, M7–M9)

Python service around `ezdxf` (see `requirements.txt`). No web framework —
`server.py` is stdlib `http.server` (threaded); a FastAPI app can wrap the
`plumb_*` modules later.

| module | job |
|---|---|
| `plumb_dxf.py` | plan → R2013 DXF (`$INSUNITS = 4`, AIA layers, `PLUMB` XDATA) |
| `plumb_dwg.py` | DWG ↔ DXF via an external converter subprocess (LibreDWG or ODA, never linked GPL) |
| `plumb_parse.py` | DXF bytes → `DxfDocument` JSON for `reconstruct()` in `@plumb/io` |
| `plumb_ifc.py` | plan → IFC4 STEP text (hand-written; see DECISIONS.md) |
| `plumb_svg.py` | plan → SVG (server-side mirror of `@plumb/io` `exportSvg`) |
| `plumb_pdf.py` | plan → A3 1:50 PDF via `reportlab` |
| `plumb_render.py` | plan → PNG via `plumb_svg` + `cairosvg` |
| `cli.py` | `dxf | ifc | svg | pdf | png | parse | audit` filter for tests and scripts |
| `server.py` | `GET /health`, `POST /dxf /dwg /ifc /svg /pdf /png /render /dxf/parse /dwg/parse` |

Run locally (binds `0.0.0.0:$PORT`, default `8080`; pass a port or set `PORT`):

```
pip install -r requirements.txt
python3 server.py 3102
```

On Vercel the service deploys as the `convert` container service (see root
`vercel.json`): `server.py` listens on 80 when `VERCEL=1`, matching the
platform's default container route, so no `PORT` setting is needed. The
`server` service reaches it over the `CONVERT_URL` service binding.

The Node server proxies `/api/convert/*` there when `CONVERT_URL` is set
(`CONVERT_TOKEN` forwards a bearer token when the service sets
`SERVICE_TOKEN`).

DWG endpoints answer **501** when no converter binary is installed; install
LibreDWG (`dwg2dxf`, `dxf2dwg`) or set `ODA_EXEC` to an ODA File Converter
binary. The Docker image bundles LibreDWG — see `Dockerfile` and
`DEPLOY_NEBIUS.md` for the Nebius Serverless deploy.
