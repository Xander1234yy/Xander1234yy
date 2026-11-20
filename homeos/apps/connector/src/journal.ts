import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";

/** Append-only JSONL-logboek met een in-memory staart (audit- en gebeurtenislog). */
export class Journal<T extends object> {
  private tail: T[] = [];

  constructor(
    private readonly file: string | null,
    private readonly keep = 500,
  ) {}

  static async open<T extends object>(dataDir: string | null, name: string, keep = 500): Promise<Journal<T>> {
    const j = new Journal<T>(dataDir ? path.join(dataDir, "logs", `${name}.jsonl`) : null, keep);
    if (j.file) {
      try {
        const lines = (await readFile(j.file, "utf8")).trim().split("\n").slice(-keep);
        j.tail = lines.filter(Boolean).map((l) => JSON.parse(l) as T);
      } catch {
        j.tail = [];
      }
    }
    return j;
  }

  append(entry: T): void {
    this.tail.push(entry);
    if (this.tail.length > this.keep) this.tail.splice(0, this.tail.length - this.keep);
    if (this.file) void appendFile(this.file, JSON.stringify(entry) + "\n", { mode: 0o600 }).catch(() => undefined);
  }

  /** Nieuwste eerst. */
  latest(limit: number): T[] {
    return this.tail.slice(-limit).reverse();
  }
}
