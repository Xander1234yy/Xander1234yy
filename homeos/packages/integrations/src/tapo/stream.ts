import { spawn, type ChildProcess } from "node:child_process";

/**
 * MJPEG uit een RTSP-stream via ffmpeg (lokaal op de laptop van de gebruiker). Eén ffmpeg-proces per camera,
 * gedeeld door alle kijkers; stopt vanzelf als niemand meer kijkt of na de maximale kijktijd.
 */

export interface FfmpegInput {
  /** ffmpeg-argumenten vóór de uitvoer, bijv. ["-rtsp_transport", "tcp", "-i", url]. */
  args: string[];
}

export interface StreamOptions {
  ffmpegPath: string;
  input: () => Promise<FfmpegInput>;
  fps?: number;
  idleStopMs?: number;
  maxSessionMs?: number;
  /** Logt zonder de invoer-URL (die bevat het camerawachtwoord). */
  onError?: (message: string) => void;
}

const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);
const MAX_BUFFER = 8 * 1024 * 1024;

/** Haalt complete JPEG-beelden uit een bytestroom. */
export class JpegSplitter {
  private buf: Buffer = Buffer.alloc(0);
  push(chunk: Buffer, onFrame: (jpeg: Buffer) => void) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      const start = this.buf.indexOf(SOI);
      if (start < 0) {
        this.buf = Buffer.alloc(0);
        return;
      }
      const end = this.buf.indexOf(EOI, start + 2);
      if (end < 0) {
        if (start > 0) this.buf = this.buf.subarray(start);
        if (this.buf.length > MAX_BUFFER) this.buf = Buffer.alloc(0);
        return;
      }
      onFrame(Buffer.from(this.buf.subarray(start, end + 2)));
      this.buf = this.buf.subarray(end + 2);
    }
  }
}

/** Verwijdert inloggegevens uit tekst van ffmpeg (foutmeldingen kunnen de URL bevatten). */
export function redact(text: string): string {
  return text.replace(/rtsp:\/\/[^\s@/]*@/gi, "rtsp://***@").slice(0, 500);
}

const outputArgs = (fps: number) => ["-an", "-vf", `fps=${fps}`, "-f", "mjpeg", "-q:v", "7", "pipe:1"];

export class MjpegStream {
  private proc: ChildProcess | null = null;
  private subs = new Set<(jpeg: Buffer) => void>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  latest: { jpeg: Buffer; at: number } | null = null;
  lastError: string | null = null;

  constructor(private readonly o: StreamOptions) {}

  get running() {
    return !!this.proc;
  }
  get viewers() {
    return this.subs.size;
  }

  subscribe(cb: (jpeg: Buffer) => void): () => void {
    this.subs.add(cb);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (this.latest && Date.now() - this.latest.at < 2000) cb(this.latest.jpeg);
    if (!this.proc) void this.start();
    return () => {
      this.subs.delete(cb);
      if (this.subs.size === 0) {
        this.idleTimer = setTimeout(() => this.stop(), this.o.idleStopMs ?? 10_000);
        this.idleTimer.unref?.();
      }
    };
  }

  private async start() {
    let input: FfmpegInput;
    try {
      input = await this.o.input();
    } catch (e) {
      this.fail((e as Error).message);
      return;
    }
    if (this.proc || this.subs.size === 0) return;
    const proc = spawn(this.o.ffmpegPath, ["-hide_banner", "-loglevel", "error", "-nostdin", ...input.args, ...outputArgs(this.o.fps ?? 5)], { stdio: ["ignore", "pipe", "pipe"] });
    this.proc = proc;
    this.lastError = null;
    const splitter = new JpegSplitter();
    proc.stdout!.on("data", (chunk: Buffer) =>
      splitter.push(chunk, (jpeg) => {
        this.latest = { jpeg, at: Date.now() };
        for (const s of this.subs) s(jpeg);
      }),
    );
    let stderr = "";
    proc.stderr!.on("data", (c: Buffer) => (stderr = (stderr + c.toString()).slice(-2000)));
    proc.on("error", (e) => this.fail((e as NodeJS.ErrnoException).code === "ENOENT" ? "ffmpeg niet gevonden. Installeer het met: brew install ffmpeg" : e.message));
    proc.on("close", (code) => {
      if (this.proc === proc) this.proc = null;
      if (code && code !== 255 && stderr) this.fail(redact(stderr.trim().split("\n").pop() ?? "ffmpeg gestopt"));
      this.clearTimers();
      // Kijkers krijgen een einde van de stream; de browser kan opnieuw beginnen.
      for (const s of [...this.subs]) s(Buffer.alloc(0));
      this.subs.clear();
    });
    this.maxTimer = setTimeout(() => this.stop(), this.o.maxSessionMs ?? 15 * 60_000);
    this.maxTimer.unref?.();
  }

  private fail(message: string) {
    this.lastError = message;
    this.o.onError?.(message);
    for (const s of [...this.subs]) s(Buffer.alloc(0));
    this.subs.clear();
  }

  private clearTimers() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.maxTimer) clearTimeout(this.maxTimer);
    this.idleTimer = this.maxTimer = null;
  }

  stop() {
    this.clearTimers();
    this.proc?.kill("SIGTERM");
    this.proc = null;
  }

  /** Eén beeld: het laatste live beeld als dat vers is, anders een los ffmpeg-proces. */
  async snapshot(timeoutMs = 15_000): Promise<Buffer> {
    if (this.latest && Date.now() - this.latest.at < 3000) return this.latest.jpeg;
    const input = await this.o.input();
    return new Promise((resolve, reject) => {
      const proc = spawn(this.o.ffmpegPath, ["-hide_banner", "-loglevel", "error", "-nostdin", ...input.args, "-an", "-frames:v", "1", "-f", "image2", "-c:v", "mjpeg", "-q:v", "4", "pipe:1"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      const chunks: Buffer[] = [];
      let size = 0;
      let stderr = "";
      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        reject(new Error("Geen beeld van de camera binnen de tijd"));
      }, timeoutMs);
      proc.stdout!.on("data", (c: Buffer) => {
        size += c.length;
        if (size < 10 * 1024 * 1024) chunks.push(c);
      });
      proc.stderr!.on("data", (c: Buffer) => (stderr = (stderr + c.toString()).slice(-2000)));
      proc.on("error", (e) => {
        clearTimeout(timer);
        reject(new Error((e as NodeJS.ErrnoException).code === "ENOENT" ? "ffmpeg niet gevonden. Installeer het met: brew install ffmpeg" : e.message));
      });
      proc.on("close", () => {
        clearTimeout(timer);
        const jpeg = Buffer.concat(chunks);
        if (jpeg.length > 100 && jpeg[0] === 0xff && jpeg[1] === 0xd8) {
          this.latest = { jpeg, at: Date.now() };
          resolve(jpeg);
        } else reject(new Error(redact(stderr.trim().split("\n").pop() || "Geen beeld ontvangen van de camera")));
      });
    });
  }
}
