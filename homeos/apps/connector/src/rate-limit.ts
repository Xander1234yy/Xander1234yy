/** Eenvoudige token-bucket per sleutel (bijv. IP + categorie). */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; updated: number }>();

  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(key: string): boolean {
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: this.perMinute, updated: t };
    b.tokens = Math.min(this.perMinute, b.tokens + ((t - b.updated) / 60_000) * this.perMinute);
    b.updated = t;
    const ok = b.tokens >= 1;
    if (ok) b.tokens -= 1;
    this.buckets.set(key, b);
    if (this.buckets.size > 10_000) this.buckets.clear();
    return ok;
  }
}
