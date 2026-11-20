import https from "node:https";
import tls from "node:tls";
import type { Duplex } from "node:stream";

/**
 * Het netwerkgedeelte van de Hue-adapter. De bridge gebruikt een certificaat dat niet door publieke CA's is
 * ondertekend; daarom pinnen we de vingerafdruk (SHA-256) die we bij het koppelen hebben gezien
 * ("trust on first use"). Bij een andere vingerafdruk wordt de verbinding verbroken VOORDAT er data
 * (zoals de application key) wordt verstuurd.
 */

export interface HueResponse<T = unknown> {
  status: number;
  body: T;
}

export interface HueHttp {
  request<T = unknown>(method: "GET" | "PUT" | "POST", path: string, body?: unknown, timeoutMs?: number): Promise<HueResponse<T>>;
  /** Server-Sent Events (eventstream). Resolvet wanneer de stream sluit. */
  stream(path: string, onData: (data: string) => void, signal: AbortSignal): Promise<void>;
}

export class CertificateMismatchError extends Error {
  constructor() {
    super("Het certificaat van de bridge is veranderd. Koppel de bridge opnieuw als dit verwacht is.");
  }
}

export interface PeerInfo {
  fingerprint256: string;
  commonName: string | null;
}

/** Leest het certificaat van de bridge (zonder iets te versturen). */
export function fetchPeerCertificate(host: string, port = 443, timeoutMs = 5000): Promise<PeerInfo> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, rejectUnauthorized: false, timeout: timeoutMs });
    socket.once("secureConnect", () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      const cn = cert?.subject?.CN;
      resolve({ fingerprint256: cert.fingerprint256, commonName: Array.isArray(cn) ? (cn[0] ?? null) : (cn ?? null) });
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("Time-out bij verbinden met de bridge"));
    });
    socket.once("error", reject);
  });
}

class PinnedAgent extends https.Agent {
  constructor(private readonly expected: string) {
    super({ keepAlive: true, maxSockets: 4 });
  }
  override createConnection(options: https.RequestOptions, cb?: (err: Error | null, stream: Duplex) => void): Duplex | null | undefined {
    let done = false;
    const finish = (err: Error | null, s?: Duplex) => {
      if (done) return;
      done = true;
      cb?.(err, s as Duplex);
    };
    const socket = tls.connect({ ...(options as tls.ConnectionOptions), rejectUnauthorized: false, servername: undefined });
    socket.once("secureConnect", () => {
      if (socket.getPeerCertificate().fingerprint256 !== this.expected) {
        socket.destroy();
        finish(new CertificateMismatchError());
        return;
      }
      finish(null, socket);
    });
    socket.once("error", (e) => finish(e));
    // Callback-variant: Node wacht op cb voordat er data verstuurd wordt.
    return undefined;
  }
}

export function createHueHttp(o: { host: string; port?: number; fingerprint256: string; appKey: string | null }): HueHttp {
  const agent = new PinnedAgent(o.fingerprint256);
  const port = o.port ?? 443;
  const headers = (extra: Record<string, string> = {}) => ({
    ...(o.appKey ? { "hue-application-key": o.appKey } : {}),
    ...extra,
  });

  return {
    request<T>(method: string, path: string, body?: unknown, timeoutMs = 8000) {
      return new Promise<HueResponse<T>>((resolve, reject) => {
        const payload = body === undefined ? undefined : JSON.stringify(body);
        const req = https.request(
          { host: o.host, port, path, method, agent, timeout: timeoutMs, headers: headers(payload ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(payload)) } : {}) },
          (res) => {
            const chunks: Buffer[] = [];
            let size = 0;
            res.on("data", (c: Buffer) => {
              size += c.length;
              if (size > 5_000_000) req.destroy(new Error("Antwoord van bridge te groot"));
              else chunks.push(c);
            });
            res.on("end", () => {
              const text = Buffer.concat(chunks).toString("utf8");
              try {
                resolve({ status: res.statusCode ?? 0, body: (text ? JSON.parse(text) : null) as T });
              } catch {
                reject(new Error("Ongeldig antwoord van de bridge"));
              }
            });
          },
        );
        req.on("timeout", () => req.destroy(new Error("Time-out van de bridge")));
        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
      });
    },
    stream(path, onData, signal) {
      return new Promise<void>((resolve, reject) => {
        const req = https.request({ host: o.host, port, path, method: "GET", agent, headers: headers({ accept: "text/event-stream" }) }, (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`Eventstream status ${res.statusCode}`));
            return;
          }
          let buf = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => {
            buf += chunk;
            let i;
            while ((i = buf.indexOf("\n\n")) >= 0) {
              const block = buf.slice(0, i);
              buf = buf.slice(i + 2);
              const data = block
                .split("\n")
                .filter((l) => l.startsWith("data:"))
                .map((l) => l.slice(5).trim())
                .join("\n");
              if (data) onData(data);
            }
            if (buf.length > 1_000_000) buf = "";
          });
          res.on("end", () => resolve());
          res.on("error", reject);
        });
        req.on("error", (e) => (signal.aborted ? resolve() : reject(e)));
        signal.addEventListener("abort", () => req.destroy());
        req.end();
      });
    },
  };
}

/** Alleen privé-netwerkadressen zijn toegestaan als bridge-adres (geen SSRF naar internet). */
export function isPrivateLanHost(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([m[1], m[2], m[3], m[4]].some((p) => Number(p) > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}
