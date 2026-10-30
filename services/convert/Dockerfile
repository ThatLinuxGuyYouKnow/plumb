# ---- builder: compile LibreDWG (DWG<->DXF) from source ---------------------
# LibreDWG is GPL: it is only ever shelled out to as a separate process
# (SPEC sect 11). Building here keeps the runtime image self-contained.
FROM python:3.12-bookworm AS dwg-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential git autoconf automake libtool pkg-config texinfo \
    && rm -rf /var/lib/apt/lists/*

# Pinned LibreDWG tag for reproducible builds (tags are plain 0.14.NNNN).
ARG LIBREDWG_TAG=0.14.8639
RUN git clone --depth 1 --branch ${LIBREDWG_TAG} \
    https://github.com/LibreDWG/libredwg.git /tmp/libredwg \
    && cd /tmp/libredwg \
    && sh autogen.sh \
    && ./configure \
    && make -j"$(nproc)" \
    && make install \
    && ldconfig \
    && dwg2dxf --version && dxf2dwg --version

# ---- runtime ----------------------------------------------------------------
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
# NOTE: no baked PORT here. server.py listens on $PORT when set (Nebius
# injects it; `docker run -e PORT=…` overrides), on 80 when VERCEL=1 (the
# Vercel container runtime routes to port 80 by default), else 8080.

# Runtime libs: cairo/pango for cairosvg (PNG), DejaVu for SVG text.
# xvfb-run is optional (only used if ODA File Converter is mounted in).
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf-2.0-0 \
    shared-mime-info fonts-dejavu-core xvfb \
    && rm -rf /var/lib/apt/lists/*

# LibreDWG binaries + shared libs from the builder stage.
COPY --from=dwg-builder /usr/local/bin/dwg2dxf /usr/local/bin/dwgread /usr/local/bin/dxf2dwg /usr/local/bin/
COPY --from=dwg-builder /usr/local/lib/ /usr/local/lib/
RUN ldconfig

WORKDIR /srv/convert
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY plumb_dxf.py plumb_ifc.py plumb_parse.py plumb_svg.py plumb_pdf.py \
     plumb_render.py plumb_dwg.py server.py cli.py ./

# Non-root for serverless hardening.
RUN useradd --create-home --uid 10001 app && chown -R app:app /srv/convert
USER app

EXPOSE 8080

# Nebius health check: GET /health
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python3 -c "import os,urllib.request;urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\") or (80 if os.environ.get(\"VERCEL\") else 8080)}/health',timeout=4)"

CMD ["python3", "server.py"]
