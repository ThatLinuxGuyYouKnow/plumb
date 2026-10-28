/** Minimal Node globals without pulling in @types/node. */
declare const process: { env: Record<string, string | undefined> };
declare const Buffer: {
  from(data: ArrayBuffer | Uint8Array | string): { buffer: ArrayBuffer; byteOffset: number; byteLength: number } & Uint8Array;
};
interface ImportMeta {
  url: string;
}

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function writeFileSync(path: string, data: string): void;
  export function mkdtempSync(prefix: string): string;
}
declare module 'node:url' {
  export function fileURLToPath(url: string): string;
}
declare module 'node:path' {
  export function dirname(p: string): string;
  export function join(...parts: string[]): string;
}
declare module 'node:os' {
  export function tmpdir(): string;
}
