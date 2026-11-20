import WebSocket from "ws";
import type { TLSSocket } from "node:tls";
import { registrationMessage, type SsapMessage, WS_PORT, WSS_PORT } from "./protocol";

export class WebOsError extends Error {
  constructor(
    message: string,
    readonly code: "UNREACHABLE" | "CERTIFICATE" | "REJECTED" | "TIMEOUT" | "PROTOCOL" | "CLOSED",
  ) {
    super(message);
  }
}

export interface ClientOptions {
  host: string;
  /** Vastgepinde certificaatvingerafdruk (wss). null = eerste keer: vingerafdruk vastleggen (alleen bij koppelen). */
  fingerprint256: string | null;
  scheme: "wss" | "ws";
  wssPort?: number;
  wsPort?: number;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
}

type Pending = { resolve: (m: SsapMessage) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

/**
 * Minimale SSAP-client. Eén WebSocket per tv. Verstuurt pas iets nadat het certificaat is gecontroleerd,
 * zodat de client-key nooit naar een ander apparaat gaat.
 */
export class WebOsClient {
  private ws: WebSocket | null = null;
  private seq = 1;
  private pending = new Map<string, Pending>();
  private subs = new Map<string, (payload: Record<string, unknown>) => void>();
  private regWaiters: ((m: SsapMessage) => void)[] = [];
  fingerprint256: string | null;
  onClose: (() => void) | null = null;

  constructor(private readonly o: ClientOptions) {
    this.fingerprint256 = o.fingerprint256;
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  async open(): Promise<void> {
    const port = this.o.scheme === "wss" ? (this.o.wssPort ?? WSS_PORT) : (this.o.wsPort ?? WS_PORT);
    const url = `${this.o.scheme}://${this.o.host}:${port}`;
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url, { rejectUnauthorized: false, handshakeTimeout: this.o.connectTimeoutMs ?? 5000, maxPayload: 4 * 1024 * 1024 });
      let settled = false;
      const fail = (e: Error) => {
        if (settled) return;
        settled = true;
        ws.terminate();
        reject(e);
      };
      ws.on("upgrade", (res) => {
        if (this.o.scheme !== "wss") return;
        const fp = (res.socket as TLSSocket).getPeerCertificate?.()?.fingerprint256 ?? null;
        if (!fp) return fail(new WebOsError("Geen certificaat van de tv ontvangen", "CERTIFICATE"));
        if (this.fingerprint256 && fp !== this.fingerprint256) {
          return fail(new WebOsError("Het certificaat van de tv is veranderd. Koppel de tv opnieuw als dit verwacht is.", "CERTIFICATE"));
        }
        this.fingerprint256 = fp;
      });
      ws.once("open", () => {
        if (settled) return;
        settled = true;
        this.ws = ws;
        resolve();
      });
      ws.once("error", (e) => fail(new WebOsError(`Tv niet bereikbaar (${(e as NodeJS.ErrnoException).code ?? e.message})`, "UNREACHABLE")));
      ws.on("message", (data) => this.onMessage(data.toString()));
      ws.on("close", () => {
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(new WebOsError("Verbinding met de tv verbroken", "CLOSED"));
        }
        this.pending.clear();
        this.subs.clear();
        if (this.ws === ws) {
          this.ws = null;
          this.onClose?.();
        }
      });
    });
  }

  close() {
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  private onMessage(raw: string) {
    let m: SsapMessage;
    try {
      m = JSON.parse(raw) as SsapMessage;
    } catch {
      return;
    }
    if (!m || typeof m !== "object") return;
    const id = m.id === undefined ? "" : String(m.id);
    if (id === "register_0") {
      const w = this.regWaiters.shift();
      w?.(m);
      return;
    }
    const sub = this.subs.get(id);
    if (sub && m.type === "response" && m.payload) sub(m.payload);
    const p = this.pending.get(id);
    if (p) {
      clearTimeout(p.timer);
      this.pending.delete(id);
      p.resolve(m);
    }
  }

  private nextRegistration(timeoutMs: number): Promise<SsapMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.regWaiters = this.regWaiters.filter((w) => w !== done);
        reject(new WebOsError("Geen antwoord op de koppelvraag. Bevestig de melding op de tv binnen een minuut.", "TIMEOUT"));
      }, timeoutMs);
      const done = (m: SsapMessage) => {
        clearTimeout(timer);
        resolve(m);
      };
      this.regWaiters.push(done);
    });
  }

  /**
   * Registreert bij de tv. Zonder client-key toont de tv een melding; de gebruiker moet die bevestigen.
   * `allowPrompt=false`: een opgeslagen key wordt niet (meer) geaccepteerd → fout in plaats van een melding.
   */
  async register(clientKey: string | null, opts: { allowPrompt: boolean; promptTimeoutMs?: number } = { allowPrompt: true }): Promise<string> {
    const attempt = async (signed: boolean) => {
      const reply = this.nextRegistration(10_000);
      this.send(registrationMessage(clientKey, signed));
      return reply;
    };
    let m = await attempt(true);
    if (m.type === "error") m = await attempt(false);
    if (m.type === "response" && m.payload?.pairingType === "PROMPT") {
      if (!opts.allowPrompt) throw new WebOsError("De tv vraagt opnieuw om toestemming. Koppel de tv opnieuw in Instellingen.", "REJECTED");
      m = await this.nextRegistration(opts.promptTimeoutMs ?? 60_000);
    }
    if (m.type === "error") throw new WebOsError(m.error?.includes("403") ? "De koppeling is geweigerd op de tv." : `Koppelen mislukt: ${m.error ?? "onbekende fout"}`, "REJECTED");
    if (m.type !== "registered") throw new WebOsError("Onverwacht antwoord van de tv bij koppelen", "PROTOCOL");
    const key = typeof m.payload?.["client-key"] === "string" ? (m.payload["client-key"] as string) : clientKey;
    if (!key || key.length > 200) throw new WebOsError("De tv gaf geen geldige client-key", "PROTOCOL");
    return key;
  }

  private send(msg: unknown) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new WebOsError("Niet verbonden met de tv", "CLOSED");
    this.ws.send(JSON.stringify(msg));
  }

  /** Verzoek met antwoord. Gooit bij een fout of returnValue=false. */
  async request(uri: string, payload: Record<string, unknown> = {}, type: "request" | "subscribe" = "request"): Promise<Record<string, unknown>> {
    const id = `${type === "subscribe" ? "sub" : "req"}_${this.seq++}`;
    const reply = new Promise<SsapMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new WebOsError(`Geen antwoord van de tv (${uri})`, "TIMEOUT"));
      }, this.o.requestTimeoutMs ?? 8000);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.send({ id, type, uri: `ssap://${uri}`, payload });
    const m = await reply;
    if (m.type === "error") throw new WebOsError(`De tv weigerde ${uri}: ${m.error ?? "fout"}`, "PROTOCOL");
    const p = m.payload ?? {};
    if (p.returnValue === false) throw new WebOsError(`De tv kon ${uri} niet uitvoeren`, "PROTOCOL");
    return p;
  }

  /** Abonneert op wijzigingen; de callback krijgt ook het eerste antwoord. */
  async subscribe(uri: string, cb: (payload: Record<string, unknown>) => void): Promise<Record<string, unknown>> {
    const id = `sub_${this.seq}`;
    this.subs.set(id, cb);
    try {
      return await this.request(uri, {}, "subscribe");
    } catch (e) {
      this.subs.delete(id);
      throw e;
    }
  }

  /** Verstuurt zonder op antwoord te wachten (uitzetten: de tv antwoordt dan niet altijd). */
  fire(uri: string, payload: Record<string, unknown> = {}) {
    this.send({ id: `req_${this.seq++}`, type: "request", uri: `ssap://${uri}`, payload });
  }
}
