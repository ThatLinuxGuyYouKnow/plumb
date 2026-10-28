/**
 * /api/convert: thin proxy in front of the Python conversion service.
 * DWG support slots in here later as a separate converter process (SPEC §11);
 * until CONVERT_URL is set, conversion endpoints answer 501, never GPL code.
 */
import type { Context } from 'hono';

function convertUrl(): string | undefined {
  const u = process.env.CONVERT_URL;
  return u && u.length > 0 ? u.replace(/\/$/, '') : undefined;
}

export async function handleConvertProxy(c: Context, path: string): Promise<Response> {
  const base = convertUrl();
  if (!base) {
    return c.json(
      { error: 'Conversion service not configured. Set CONVERT_URL to enable DXF/IFC conversion.' },
      501,
    );
  }
  const url = `${base}${path}`;
  const init: RequestInit = {
    method: c.req.method,
    headers: { 'content-type': c.req.header('content-type') ?? 'application/octet-stream' },
  };
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    init.body = Buffer.from(await c.req.arrayBuffer());
  }
  const upstream = await fetch(url, init);
  const buf = Buffer.from(await upstream.arrayBuffer());
  return new Response(buf, { status: upstream.status, headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream' } });
}
