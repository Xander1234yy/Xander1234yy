import { appendLine, joinPath, readLines } from "./fs-utils";

/** Append-only JSONL-logboek met een in-memory staart (audit- en gebeurtenislog). */
export class Journal<T extends object> {
  private tail: T[] = [];

  constructor(
    private readonly file: string | null,
    private readonly keep = 500,
  ) {}

  static async open<T extends object>(dataDir: string | null, name: string, keep = 500): Promise<Journal<T>> {
    const j = new Journal<T>(dataDir ? joinPath(dataDir, "logs", `${name}.jsonl`) : null, keep);
    if (j.file) {
      try {
        j.tail = (await readLines(j.file, keep)).map((l) => JSON.parse(l) as T);
      } catch {
        j.tail = [];
      }
    }
    return j;
  }

  /** Voor de cloudmodus: wacht tot alle schrijfacties klaar zijn voordat de functie eindigt. */
  private pending: Promise<void> = Promise.resolve();
  flush(): Promise<void> {
    return this.pending;
  }

  append(entry: T): void {
    this.tail.push(entry);
    if (this.tail.length > this.keep) this.tail.splice(0, this.tail.length - this.keep);
    if (this.file) {
      const file = this.file;
      this.pending = this.pending.then(() => appendLine(file, JSON.stringify(entry))).catch(() => undefined);
    }
  }

  /** Nieuwste eerst. */
  latest(limit: number): T[] {
    return this.tail.slice(-limit).reverse();
  }
}
