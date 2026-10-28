/** Simple per-IP token bucket: 20 requests per minute (SPEC §9 "per session" approximated by IP). */
export interface Bucket {
  count: number;
  reset: number;
}

const LIMIT = 20;
const WINDOW_MS = 60_000;

export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  /** True when the request is allowed (and counted). */
  allow(key: string, now = Date.now()): boolean {
    const cur = this.buckets.get(key);
    if (!cur || now >= cur.reset) {
      this.buckets.set(key, { count: 1, reset: now + WINDOW_MS });
      return true;
    }
    if (cur.count >= LIMIT) return false;
    cur.count += 1;
    return true;
  }

  resetAll(): void {
    this.buckets.clear();
  }
}
