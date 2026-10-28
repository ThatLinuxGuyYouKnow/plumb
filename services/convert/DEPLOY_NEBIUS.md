# Plumb convert service on Nebius Serverless

Stateless Docker image for the conversion + render service (`server.py`):
DXF / DWG / IFC / SVG / PDF / PNG plus `dxf/parse` and `dwg/parse`.
Deploy it as a **Nebius Serverless AI endpoint** (managed HTTPS, per-second
billing, scale-to-zero); the Node server proxies `/api/convert/*` there.

## What the image contains

- Python 3.12 slim, `ezdxf` (DXF), `reportlab` (PDF), `cairosvg` (PNG).
- **LibreDWG** `dwg2dxf` / `dxf2dwg` compiled from a pinned release
  (`ARG LIBREDWG_TAG`, default `0.14.8639`). GPL code is only ever shelled
  out to as a separate process — never linked (SPEC §11).
- Optional **ODA File Converter**: not bundled (licence download). Mount or
  install it in a derived image and set `ODA_EXEC=/path/to/ODAFileConverter`;
  the service prefers ODA over LibreDWG when present.
- Listens on `0.0.0.0:$PORT` (default `8080`), threaded, `GET /health` open
  for the platform health check. Non-root user.

## 1. Build (linux/amd64 — required by Nebius)

```bash
cd services/convert
docker buildx build --platform linux/amd64 -t plumb-convert:0.2.0 .
```

Smoke-test locally before pushing:

```bash
docker run --rm -p 8080:8080 plumb-convert:0.2.0
# in another shell:
curl -s localhost:8080/health
curl -s -X POST localhost:8080/svg -H 'content-type: application/json' \
  -d @../../fixtures/twoBed.plan.json -o /tmp/plan.svg
curl -s -X POST localhost:8080/pdf -H 'content-type: application/json' \
  -d @../../fixtures/twoBed.plan.json -o /tmp/plan.pdf
```

`GET /health` reports converter availability, e.g.
`{"ok":true,"dwg":{"dwg2dxf":true,"dxf2dwg":true,…},"png":true,"pdf":true}`.

## 2. Push to Nebius Container Registry

```bash
# one-time: create a registry in your project (console or CLI)
nebius registry create --name plumb --project-id <PROJECT_ID>

# log docker in (region is part of your registry hostname, e.g. eu-north1)
nebius iam get-access-token \
  | docker login --username iam --password-stdin cr.eu-north1.nebius.cloud

REG=cr.eu-north1.nebius.cloud/<REGISTRY_ID>/plumb-convert:0.2.0
docker tag plumb-convert:0.2.0 "$REG"
docker push "$REG"
```

## 3. Create the Serverless endpoint

CPU is enough (no GPU needed). Pick the platform/preset from
`nebius ai platform list` — example for a 2 vCPU / 8 GB CPU share:

```bash
nebius ai endpoint create \
  --name plumb-convert \
  --project-id <PROJECT_ID> \
  --image "$REG" \
  --platform cpu-e2 \
  --preset 2vcpu-8gb \
  --container-port 8080 \
  --disk-size 20Gi
```

Notes:

- Each `--container-port` gets a managed `https://` URL; the app needs only
  `8080`. See the endpoint's `status.public_endpoints` for the URL.
- The image already `EXPOSE`s 8080 and runs `HEALTHCHECK` on `/health`.
- Cold start is a few seconds (LibreDWG binaries are small; Python + ezdxf
  import on first request). Keep one minimum replica if p99 matters.
- Optional lock-down: add `--auth token --token <SECRET>` (or set the
  service env `SERVICE_TOKEN=<SECRET>` in the endpoint config). Then set
  `CONVERT_TOKEN=<SECRET>` on the Node server — it forwards
  `Authorization: Bearer …`. `/health` stays open for the load balancer.

## 4. Wire the app server

```bash
# apps/server/.env
CONVERT_URL=https://<your-endpoint-host>
# CONVERT_TOKEN=<SECRET>   # only if locked down
```

No code change needed: `/api/convert/*` proxies path + query string and
passes through content-type / content-disposition, so the new routes
(`/dwg`, `/svg`, `/pdf`, `/png`, `/render`, `/dwg/parse`) work through the
existing proxy. Without `CONVERT_URL` the app answers 501 as before.

## 5. Verify end to end

```bash
BASE=https://<your-endpoint-host>
curl -s $BASE/health
for f in dxf dwg ifc svg pdf png; do
  curl -s -o /tmp/e2e.$f -w "$f %{http_code} %{size_download}B\n" \
    -X POST $BASE/$f -H 'content-type: application/json' \
    -d @../../fixtures/twoBed.plan.json
done
curl -s -X POST $BASE/render -H 'content-type: application/json' \
  -d "{\"format\":\"png\",\"options\":{\"width\":800},\"plan\":$(cat ../../fixtures/twoBed.plan.json | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)))')}" \
  -o /tmp/e2e-render.png
```

`/dwg` and `/dwg/parse` answer **501** only when no converter binary is
present (local `pip install` without LibreDWG). The Docker image always
has LibreDWG, so they are live there.

## DWG fidelity notes

- `POST /dwg` exports via the normal DXF pipeline then `dxf2dwg`
  (default DWG `r2000`, override with `{"plan":…, "options":{"version":"r2013"}}`).
  LibreDWG `dxf2dwg` currently targets early DWG versions — fine for
  LibreCAD/QCAD/BricsCAD import, verify in AutoCAD before promising more.
- `POST /dwg/parse` runs `dwg2dxf --as r2013` then the standard parser, so
  Plumb-authored DWG (round-tripped through DXF XDATA) recovers exactly;
  third-party DWG goes through the usual `reconstruct()` heuristics.
- For maximum AutoCAD fidelity, derive the image with ODA File Converter
  installed and set `ODA_EXEC`; no service change needed.
