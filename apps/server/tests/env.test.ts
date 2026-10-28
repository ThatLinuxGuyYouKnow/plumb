import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadEnvFile, parseEnvText } from '../src/env.js';

const KEYS = ['PLUMB_PROVIDER', 'PLUMB_TEST_A', 'PLUMB_TEST_B'];
const saved: Record<string, string | undefined> = {};

function stash(): void {
  for (const k of KEYS) saved[k] = process.env[k];
}
function restore(): void {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

afterEach(restore);

describe('env file loader', () => {
  it('parses comments, blanks, quoting and ignores junk lines', () => {
    const parsed = parseEnvText(
      '# comment\n\nPLUMB_PROVIDER=deepseek\nPLUMB_TEST_A="quoted value"\n' +
        "PLUMB_TEST_B='single'\njunk line without equals\n=novalue\n",
    );
    expect(parsed).toEqual({
      PLUMB_PROVIDER: 'deepseek',
      PLUMB_TEST_A: 'quoted value',
      PLUMB_TEST_B: 'single',
    });
  });

  it('fills missing keys but never overrides real env vars', () => {
    stash();
    process.env.PLUMB_PROVIDER = 'anthropic';
    delete process.env.PLUMB_TEST_A;
    const dir = mkdtempSync(join(tmpdir(), 'plumb-env-'));
    const file = join(dir, '.env');
    writeFileSync(file, 'PLUMB_PROVIDER=deepseek\nPLUMB_TEST_A=from-file\n');
    loadEnvFile(file);
    expect(process.env.PLUMB_PROVIDER).toBe('anthropic');
    expect(process.env.PLUMB_TEST_A).toBe('from-file');
  });

  it('is a no-op when the file is absent', () => {
    stash();
    delete process.env.PLUMB_TEST_B;
    loadEnvFile(join(tmpdir(), `plumb-env-missing-${Date.now()}.env`));
    expect(process.env.PLUMB_TEST_B).toBeUndefined();
  });
});
