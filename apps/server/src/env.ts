/**
 * Zero-dep `.env` loader: keeps provider config across restarts. Reads
 * `apps/server/.env` (see `.env.example`); real env vars always win, so a
 * one-off `PLUMB_MODEL=... pnpm start` still overrides the file. Runs once
 * at import time, before `resolveProvider` reads anything.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');

/** Parse dotenv-formatted text into key/value pairs (no env side effects). */
export function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

export function loadEnvFile(path: string = envPath): void {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return; // No .env — plain env vars only (the common dev case).
  }
  for (const [key, val] of Object.entries(parseEnvText(text))) {
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnvFile();
