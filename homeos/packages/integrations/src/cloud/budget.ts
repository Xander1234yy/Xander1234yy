/**
 * Bewaakt een daglimiet van een cloud-API (sliding window van 24 uur), met een aparte reserve voor
 * gebruikersopdrachten. Achtergrondverversing mag de reserve niet opmaken.
 */
export class RequestBudget {
  private calls: number[] = [];
  private blockedUntil = 0;

  constructor(
    private readonly perDay: number,
    private readonly reserveForCommands: number,
    private readonly now: () => number = Date.now,
  ) {}

  private prune() {
    const cutoff = this.now() - 86_400_000;
    while (this.calls.length && this.calls[0]! < cutoff) this.calls.shift();
  }

  used(): number {
    this.prune();
    return this.calls.length;
  }

  remaining(): number {
    return Math.max(0, this.perDay - this.used());
  }

  /** kind "background" respecteert de reserve, "command" mag de reserve gebruiken. */
  canSpend(kind: "background" | "command"): boolean {
    if (this.now() < this.blockedUntil) return false;
    const limit = kind === "command" ? this.perDay : this.perDay - this.reserveForCommands;
    return this.used() < limit;
  }

  spend(): void {
    this.calls.push(this.now());
  }

  /** Server meldt de werkelijke resterende hoeveelheid (bijv. X-RateLimit-Remaining-day). */
  syncRemaining(remaining: number | null): void {
    if (remaining == null || !Number.isFinite(remaining)) return;
    const used = this.perDay - remaining;
    while (this.used() < used) this.calls.push(this.now());
  }

  blockFor(seconds: number): void {
    this.blockedUntil = Math.max(this.blockedUntil, this.now() + seconds * 1000);
  }

  /** Voor de cloudmodus: budget bewaren tussen aanvragen. */
  exportState(): { calls: number[]; blockedUntil: number } {
    this.prune();
    return { calls: [...this.calls], blockedUntil: this.blockedUntil };
  }
  importState(s: unknown): void {
    const v = s as { calls?: unknown; blockedUntil?: unknown } | null;
    if (!v) return;
    if (Array.isArray(v.calls)) this.calls = v.calls.filter((n): n is number => typeof n === "number").sort((a, b) => a - b).slice(-this.perDay * 2);
    if (typeof v.blockedUntil === "number") this.blockedUntil = v.blockedUntil;
    this.prune();
  }

  blockedForSeconds(): number {
    return Math.max(0, Math.ceil((this.blockedUntil - this.now()) / 1000));
  }
}

/** "YYYY-MM-DD HH:mm:ss" in een IANA-tijdzone → ISO-tijd (UTC). */
export function zonedToIso(local: string, timeZone: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(local);
  if (!m) throw new Error(`Ongeldige datum: ${local}`);
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const offset = (t: number) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(t));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - t;
  };
  let ts = guess - offset(guess);
  ts = guess - offset(ts); // corrigeer rond zomertijd-overgangen
  return new Date(ts).toISOString();
}

/** Datum (YYYY-MM-DD) van tijdstip t in een tijdzone. */
export function dateInZone(t: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
}

export class CloudApiError extends Error {
  constructor(
    message: string,
    public readonly kind: "auth" | "rate_limited" | "budget" | "network" | "server" | "invalid",
  ) {
    super(message);
  }
}
