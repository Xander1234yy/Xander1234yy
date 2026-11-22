import { createHash, randomBytes } from "node:crypto";

/**
 * Minimale ONVIF-client (Profile S) voor Tapo-camera's. Tapo documenteert ONVIF officieel voor koppeling met recorders
 * van derden (poort 2020, apart "camera-account" in de Tapo-app). Alleen de onderdelen die HomeOS nodig heeft:
 * apparaatinfo, profielen, draaien/kantelen en bewegingsgebeurtenissen (PullPoint).
 * Authenticatie: WS-Security UsernameToken met wachtwoord-digest (het wachtwoord gaat nooit leesbaar over het netwerk).
 */

export class OnvifError extends Error {
  constructor(
    message: string,
    readonly code: "UNREACHABLE" | "UNAUTHORIZED" | "FAULT" | "TIMEOUT",
  ) {
    super(message);
  }
}

export interface OnvifOptions {
  host: string;
  port?: number;
  username: string;
  password: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface OnvifEvent {
  topic: string;
  kind: "motion" | "person" | "other";
  active: boolean;
}

const NS = {
  tds: "http://www.onvif.org/ver10/device/wsdl",
  trt: "http://www.onvif.org/ver10/media/wsdl",
  tptz: "http://www.onvif.org/ver20/ptz/wsdl",
  tev: "http://www.onvif.org/ver10/events/wsdl",
  tt: "http://www.onvif.org/ver10/schema",
  wsnt: "http://docs.oasis-open.org/wsn/b-2",
};

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

/** WS-Security digest: Base64(SHA1(nonce + created + wachtwoord)). */
export function passwordDigest(nonce: Buffer, created: string, password: string): string {
  return createHash("sha1").update(Buffer.concat([nonce, Buffer.from(created + password, "utf8")])).digest("base64");
}

/** Waarde van het eerste element met deze lokale naam (namespace-onafhankelijk). */
export function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([^<]*)</(?:[\\w-]+:)?${name}>`).exec(xml);
  return m ? m[1]!.trim() : null;
}
function section(xml: string, name: string): string | null {
  const m = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`).exec(xml);
  return m ? m[1]! : null;
}

export function parseEvents(xml: string): OnvifEvent[] {
  const out: OnvifEvent[] = [];
  const re = /<(?:[\w-]+:)?NotificationMessage(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?NotificationMessage>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const block = m[1]!;
    const topic = tag(block, "Topic") ?? "";
    const items = [...block.matchAll(/<(?:[\w-]+:)?SimpleItem\s+Name="([^"]+)"\s+Value="([^"]*)"/g)];
    const data = section(block, "Data") ?? "";
    const dataItems = [...data.matchAll(/<(?:[\w-]+:)?SimpleItem\s+Name="([^"]+)"\s+Value="([^"]*)"/g)];
    const relevant = (dataItems.length ? dataItems : items).find(([, n]) => /^(IsMotion|IsPeople|IsPerson|State|Motion)$/i.test(n!));
    if (!relevant) continue;
    const kind: OnvifEvent["kind"] = /people|person|human/i.test(topic + relevant[1]) ? "person" : /motion/i.test(topic + relevant[1]) ? "motion" : "other";
    out.push({ topic: topic.slice(0, 200), kind, active: /^(true|1)$/i.test(relevant[2]!) });
  }
  return out;
}

export class OnvifClient {
  private offsetMs = 0;
  private xaddr: { media: string | null; ptz: string | null; events: string | null } | null = null;
  private profileToken: string | null = null;

  constructor(private readonly o: OnvifOptions) {}

  private get base() {
    return `http://${this.o.host}:${this.o.port ?? 2020}`;
  }

  private security(): string {
    const nonce = randomBytes(16);
    const created = new Date(Date.now() + this.offsetMs).toISOString().replace(/\.\d{3}Z$/, "Z");
    return `<Security s:mustUnderstand="1" xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"><UsernameToken><Username>${esc(this.o.username)}</Username><Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${passwordDigest(nonce, created, this.o.password)}</Password><Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce.toString("base64")}</Nonce><Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">${created}</Created></UsernameToken></Security>`;
  }

  /** Alleen adressen op dezelfde camera volgen (geen doorsturen naar andere hosts). */
  private sameHost(url: string | null): string | null {
    if (!url) return null;
    try {
      const u = new URL(url);
      if (u.hostname !== this.o.host) u.hostname = this.o.host;
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      return u.toString();
    } catch {
      return null;
    }
  }

  async call(url: string, body: string, opts: { auth?: boolean; headers?: string; timeoutMs?: number } = {}): Promise<string> {
    const envelope = `<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Header>${opts.auth === false ? "" : this.security()}${opts.headers ?? ""}</s:Header><s:Body>${body}</s:Body></s:Envelope>`;
    let res: Response;
    try {
      res = await (this.o.fetchImpl ?? fetch)(url, {
        method: "POST",
        headers: { "content-type": "application/soap+xml; charset=utf-8" },
        body: envelope,
        signal: AbortSignal.timeout(opts.timeoutMs ?? this.o.timeoutMs ?? 8000),
        redirect: "error",
      });
    } catch (e) {
      const timeout = (e as Error).name === "TimeoutError";
      throw new OnvifError(timeout ? "Camera reageert niet op tijd" : "Camera niet bereikbaar", timeout ? "TIMEOUT" : "UNREACHABLE");
    }
    const text = (await res.text()).slice(0, 2_000_000);
    if (res.status === 401 || /NotAuthorized|FailedAuthentication|Sender not Authorized/i.test(text)) {
      throw new OnvifError("De camera weigert de inloggegevens. Controleer het camera-account in de Tapo-app.", "UNAUTHORIZED");
    }
    if (!res.ok || /<(?:[\w-]+:)?Fault>/.test(text)) throw new OnvifError(`ONVIF-fout: ${tag(text, "Text") ?? `status ${res.status}`}`, "FAULT");
    return text;
  }

  /** Klok van de camera (zonder inloggen), zodat de WS-Security-tijdstempel klopt. */
  async syncTime(): Promise<void> {
    const xml = await this.call(`${this.base}/onvif/device_service`, `<GetSystemDateAndTime xmlns="${NS.tds}"/>`, { auth: false });
    const utc = section(xml, "UTCDateTime");
    if (!utc) return;
    const n = (k: string) => Number(tag(utc, k));
    const cam = Date.UTC(n("Year"), n("Month") - 1, n("Day"), n("Hour"), n("Minute"), n("Second"));
    if (Number.isFinite(cam)) this.offsetMs = cam - Date.now();
  }

  async deviceInformation(): Promise<{ manufacturer: string; model: string; firmware: string; serial: string }> {
    const xml = await this.call(`${this.base}/onvif/device_service`, `<GetDeviceInformation xmlns="${NS.tds}"/>`);
    return {
      manufacturer: (tag(xml, "Manufacturer") ?? "").slice(0, 80),
      model: (tag(xml, "Model") ?? "").slice(0, 80),
      firmware: (tag(xml, "FirmwareVersion") ?? "").slice(0, 80),
      serial: (tag(xml, "SerialNumber") ?? "").slice(0, 80),
    };
  }

  async capabilities() {
    if (this.xaddr) return this.xaddr;
    const xml = await this.call(`${this.base}/onvif/device_service`, `<GetCapabilities xmlns="${NS.tds}"><Category>All</Category></GetCapabilities>`);
    const x = (n: string) => {
      const s = section(xml, n);
      return s ? this.sameHost(tag(s, "XAddr")) : null;
    };
    this.xaddr = { media: x("Media"), ptz: x("PTZ"), events: x("Events") };
    return this.xaddr;
  }

  async profile(): Promise<string> {
    if (this.profileToken) return this.profileToken;
    const caps = await this.capabilities();
    if (!caps.media) throw new OnvifError("Camera meldt geen mediaservice", "FAULT");
    const xml = await this.call(caps.media, `<GetProfiles xmlns="${NS.trt}"/>`);
    const m = /<(?:[\w-]+:)?Profiles[^>]*\stoken="([^"]{1,64})"/.exec(xml);
    if (!m) throw new OnvifError("Geen videoprofiel gevonden", "FAULT");
    this.profileToken = m[1]!;
    return this.profileToken;
  }

  /** Beweegt kort in één richting en stopt dan. */
  async ptzNudge(direction: "up" | "down" | "left" | "right", ms = 500): Promise<void> {
    const caps = await this.capabilities();
    if (!caps.ptz) throw new OnvifError("Deze camera kan niet draaien of kantelen", "FAULT");
    const token = esc(await this.profile());
    const [x, y] = { left: [-0.5, 0], right: [0.5, 0], up: [0, 0.5], down: [0, -0.5] }[direction];
    await this.call(caps.ptz, `<ContinuousMove xmlns="${NS.tptz}"><ProfileToken>${token}</ProfileToken><Velocity><PanTilt xmlns="${NS.tt}" x="${x}" y="${y}"/></Velocity></ContinuousMove>`);
    await new Promise((r) => setTimeout(r, ms));
    await this.call(caps.ptz, `<Stop xmlns="${NS.tptz}"><ProfileToken>${token}</ProfileToken><PanTilt>true</PanTilt><Zoom>false</Zoom></Stop>`);
  }

  async createPullPoint(): Promise<string> {
    const caps = await this.capabilities();
    if (!caps.events) throw new OnvifError("Camera meldt geen gebeurtenissenservice", "FAULT");
    const xml = await this.call(caps.events, `<CreatePullPointSubscription xmlns="${NS.tev}"><InitialTerminationTime>PT600S</InitialTerminationTime></CreatePullPointSubscription>`);
    const ref = section(xml, "SubscriptionReference");
    const addr = this.sameHost(ref ? tag(ref, "Address") : null);
    if (!addr) throw new OnvifError("Camera gaf geen abonnement terug", "FAULT");
    return addr;
  }

  private addressing(action: string, to: string) {
    return `<Action xmlns="http://www.w3.org/2005/08/addressing">${action}</Action><To xmlns="http://www.w3.org/2005/08/addressing">${esc(to)}</To>`;
  }

  async pullMessages(address: string, timeoutSec = 10): Promise<OnvifEvent[]> {
    const xml = await this.call(address, `<PullMessages xmlns="${NS.tev}"><Timeout>PT${timeoutSec}S</Timeout><MessageLimit>20</MessageLimit></PullMessages>`, {
      headers: this.addressing("http://www.onvif.org/ver10/events/wsdl/PullPointSubscription/PullMessagesRequest", address),
      timeoutMs: (timeoutSec + 5) * 1000,
    });
    return parseEvents(xml);
  }

  async renew(address: string): Promise<void> {
    await this.call(address, `<Renew xmlns="${NS.wsnt}"><TerminationTime>PT600S</TerminationTime></Renew>`, {
      headers: this.addressing("http://docs.oasis-open.org/wsn/bw-2/SubscriptionManager/RenewRequest", address),
    });
  }

  async unsubscribe(address: string): Promise<void> {
    await this.call(address, `<Unsubscribe xmlns="${NS.wsnt}"/>`, {
      headers: this.addressing("http://docs.oasis-open.org/wsn/bw-2/SubscriptionManager/UnsubscribeRequest", address),
      timeoutMs: 3000,
    }).catch(() => undefined);
  }
}
