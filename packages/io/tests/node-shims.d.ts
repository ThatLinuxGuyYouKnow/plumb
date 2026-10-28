/** Node built-ins used by the golden tests (no @types/node on this toolchain). */
declare module 'node:child_process' {
  export function execFileSync(file: string, args: string[], options: { input?: string | Uint8Array; maxBuffer?: number; timeout?: number }): Uint8Array & { toString(enc?: string): string };
}
declare module 'node:buffer' {
  export interface Buffer extends Uint8Array {
    toString(enc?: string): string;
  }
}
interface ImportMeta {
  url: string;
}
declare class URL {
  constructor(url: string, base?: string);
  pathname: string;
}
