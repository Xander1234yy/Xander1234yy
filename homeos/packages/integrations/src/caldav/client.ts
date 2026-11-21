/**
 * Apple iCloud-agenda via CalDAV (RFC 4791), de open standaard die Apple voor agenda-apps van derden ondersteunt.
 * Aanmelden met Apple ID + app-specifiek wachtwoord (appleid.apple.com → Inloggen en beveiliging). Alleen-lezen.
 *
 * Veiligheid: alleen https naar caldav.icloud.com of pNN-caldav.icloud.com (iCloud stuurt na de eerste aanvraag door
 * naar een eigen server); redirects worden handmatig gevolgd en gecontroleerd, zodat het wachtwoord nooit naar een
 * andere host gaat.
 */
export const ICLOUD_CALDAV = "https://caldav.icloud.com/";

export class CaldavError extends Error {
  constructor(
    message: string,
    readonly code: "UNAUTHORIZED" | "UNAVAILABLE" | "INVALID" | "FAILED",
  ) {
    super(message);
  }
}

export interface CalendarInfo {
  href: string;
  name: string;
  color: string | null;
}

export function isIcloudHost(hostname: string): boolean {
  return hostname === "caldav.icloud.com" || /^p\d{1,3}-caldav\.icloud\.com$/.test(hostname);
}

// ---------- minimale XML-hulpjes (alleen voor de vaste CalDAV-antwoorden) ----------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export function xmlText(s: string): string {
  const cdata = s.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  if (cdata) return cdata[1]!;
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITIES[e] ?? m),
  );
}
const NS = "(?:[\\w-]+:)?";
/** Binnenkant van alle elementen met deze lokale naam (namespace-prefix maakt niet uit). */
export function xmlAll(xml: string, name: string): string[] {
  const re = new RegExp(`<${NS}${name}(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</${NS}${name}\\s*>)`, "g");
  return [...xml.matchAll(re)].map((m) => m[1] ?? "");
}
export function xmlFirst(xml: string, name: string): string | null {
  return xmlAll(xml, name)[0] ?? null;
}
/** Alleen de eigenschappen uit propstat-blokken met status 200. */
function okProps(response: string): string {
  return xmlAll(response, "propstat")
    .filter((p) => /\s200\s/.test(xmlFirst(p, "status") ?? ""))
    .map((p) => xmlFirst(p, "prop") ?? "")
    .join("");
}

// ---------- client ----------

export class CaldavClient {
  private readonly auth: string;

  constructor(
    username: string,
    password: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly base = ICLOUD_CALDAV,
    private readonly allowHost: (hostname: string) => boolean = isIcloudHost,
  ) {
    this.auth = "Basic " + Buffer.from(`${username}:${password}`, "utf8").toString("base64");
  }

  private resolve(href: string, from: string): URL {
    const u = new URL(href, from);
    if (u.protocol !== "https:" || !this.allowHost(u.hostname) || u.username || u.password) throw new CaldavError("Onverwacht adres van de agendaserver", "FAILED");
    return u;
  }

  async request(method: "PROPFIND" | "REPORT", href: string, body: string, depth: "0" | "1", from = this.base): Promise<{ url: string; xml: string }> {
    let url = this.resolve(href, from);
    for (let hop = 0; hop < 4; hop++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method,
          redirect: "manual",
          headers: { authorization: this.auth, depth, "content-type": "application/xml; charset=utf-8" },
          body,
          signal: AbortSignal.timeout(20_000),
        });
      } catch (e) {
        throw new CaldavError(`iCloud niet bereikbaar: ${(e as Error).message}`, "UNAVAILABLE");
      }
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) throw new CaldavError("iCloud gaf een doorverwijzing zonder adres", "FAILED");
        url = this.resolve(loc, url.toString());
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new CaldavError("Apple weigert de aanmelding: controleer je Apple ID en het app-specifieke wachtwoord", "UNAUTHORIZED");
      if (res.status === 429 || res.status >= 500) throw new CaldavError(`iCloud is tijdelijk niet beschikbaar (${res.status})`, "UNAVAILABLE");
      if (res.status !== 207 && res.status !== 200) throw new CaldavError(`Onverwacht antwoord van iCloud (${res.status})`, "FAILED");
      return { url: url.toString(), xml: await res.text() };
    }
    throw new CaldavError("Te veel doorverwijzingen van iCloud", "FAILED");
  }

  /** Zoekt de agenda's van het account (alleen agenda's met afspraken, geen herinneringen). */
  async discover(): Promise<{ homeUrl: string; calendars: CalendarInfo[] }> {
    const p1 = await this.request("PROPFIND", this.base, `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`, "0");
    const principal = xmlFirst(xmlFirst(okProps(p1.xml), "current-user-principal") ?? "", "href");
    if (!principal) throw new CaldavError("iCloud gaf geen account-adres terug", "FAILED");
    const p2 = await this.request(
      "PROPFIND",
      xmlText(principal.trim()),
      `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`,
      "0",
      p1.url,
    );
    const home = xmlFirst(xmlFirst(okProps(p2.xml), "calendar-home-set") ?? "", "href");
    if (!home) throw new CaldavError("iCloud gaf geen agenda-adres terug", "FAILED");
    const p3 = await this.request(
      "PROPFIND",
      xmlText(home.trim()),
      `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/"><d:prop><d:resourcetype/><d:displayname/><c:supported-calendar-component-set/><a:calendar-color/></d:prop></d:propfind>`,
      "1",
      p2.url,
    );
    const calendars: CalendarInfo[] = [];
    for (const r of xmlAll(p3.xml, "response")) {
      const props = okProps(r);
      const type = xmlFirst(props, "resourcetype") ?? "";
      if (!new RegExp(`<${NS}calendar[\\s/>]`).test(type)) continue;
      const comps = xmlFirst(props, "supported-calendar-component-set");
      if (comps !== null && comps.trim() && !/name="VEVENT"/i.test(comps)) continue;
      const href = this.resolve(xmlText((xmlFirst(r, "href") ?? "").trim()), p3.url).toString();
      const color = xmlFirst(props, "calendar-color");
      calendars.push({
        href,
        name: xmlText(xmlFirst(props, "displayname") ?? "").trim().slice(0, 80) || "Agenda",
        color: color && /^#[0-9a-f]{6}/i.test(color.trim()) ? color.trim().slice(0, 7) : null,
      });
    }
    return { homeUrl: p3.url, calendars };
  }

  /** Ruwe iCalendar-teksten van afspraken die (deels) in de periode vallen. */
  async events(calendarHref: string, start: Date, end: Date): Promise<string[]> {
    const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const body = `<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${fmt(start)}" end="${fmt(end)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
    const r = await this.request("REPORT", calendarHref, body, "1");
    return xmlAll(r.xml, "response")
      .map((resp) => xmlFirst(okProps(resp), "calendar-data"))
      .filter((d): d is string => !!d && d.includes("BEGIN:VCALENDAR"))
      .map((d) => xmlText(d));
  }
}
