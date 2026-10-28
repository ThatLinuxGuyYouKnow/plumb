/**
 * /api/convert: thin proxy in front of the Python conversion service
 * (local `python3 server.py` or a Nebius Serverless endpoint — see
 * services/convert/DEPLOY_NEBIUS.md). DWG conversion lives in the service
 * as a separate converter subprocess (SPEC §11); until CONVERT_URL is set,
 * conversion endpoints answer 501, never GPL code.
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
      { error: 'Conversion service not configured. Set CONVERT_URL to enable conversion.' },
      501,
    );
  }
  // Preserve the query string (?format=… on /render, future options).
  const q = c.req.query() as Record<string, string>;
  const qs = new URLSearchParams(q).toString();
  const url = `${base}${path}${qs ? `?${qs}` : ''}`;
  const headers: Record<string, string> = {
    'content-type': c.req.header('content-type') ?? 'application/octet-stream',
  };
  // Bearer token for a locked-down service (SERVICE_TOKEN / Nebius --auth token).
  const token = process.env.CONVERT_TOKEN;
  if (token && token.length > 0) headers['authorization'] = `Bearer ${token}`;
  const init: RequestInit = { method: c.req.method, headers };
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    init.body = Buffer.from(await c.req.arrayBuffer());
  }
  const upstream = await fetch(url, init);
  const buf = Buffer.from(await upstream.arrayBuffer());
  const outHeaders: Record<string, string> = {
    'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
  };
  const cd = upstream.headers.get('content-disposition');
  if (cd) outHeaders['content-disposition'] = cd;
  return new Response(buf, { status: upstream.status, headers: outHeaders });
}
