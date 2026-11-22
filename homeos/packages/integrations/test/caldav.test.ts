import { describe, expect, it } from "vitest";
import { CaldavClient, expandCalendar, isIcloudHost, xmlAll, xmlText } from "../src/caldav/index";
import { ICS_ALLDAY, ICS_WEEKLY, fakeIcloud } from "./fake-icloud";

describe("iCloud-agenda (CalDAV)", () => {
  it("vindt de agenda's via principal → calendar-home-set, volgt de iCloud-redirect en slaat herinneringen over", async () => {
    const f = fakeIcloud();
    const { calendars } = await new CaldavClient(f.user, f.password, f.fetchImpl).discover();
    expect(calendars).toEqual([
      { href: "https://p42-caldav.icloud.com/123456/calendars/home/", name: "Thuis & gezin", color: "#34C759" },
      { href: "https://p42-caldav.icloud.com/123456/calendars/work/", name: "Werk", color: null },
    ]);
    expect(f.state.requests.every((r) => r.auth?.startsWith("Basic "))).toBe(true);
  });

  it("meldt een verkeerd wachtwoord duidelijk", async () => {
    const f = fakeIcloud();
    await expect(new CaldavClient(f.user, "fout-fout-fout-fout", f.fetchImpl).discover()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("stuurt het wachtwoord nooit naar een andere host dan iCloud (ook niet via een redirect)", async () => {
    const seen: string[] = [];
    const evil = (async (u: string | URL) => {
      seen.push(new URL(String(u)).hostname);
      return new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } });
    }) as unknown as typeof fetch;
    await expect(new CaldavClient("a@b.nl", "abcd-efgh-ijkl-mnop", evil).discover()).rejects.toMatchObject({ code: "FAILED" });
    expect(seen).toEqual(["caldav.icloud.com"]);
    expect(isIcloudHost("p07-caldav.icloud.com")).toBe(true);
    expect(isIcloudHost("caldav.icloud.com.evil.example")).toBe(false);
    expect(isIcloudHost("evil-caldav.icloud.com")).toBe(false);
  });

  it("vraagt afspraken op met een tijdsfilter en leest zowel ge-escapete als CDATA-inhoud", async () => {
    const f = fakeIcloud();
    const c = new CaldavClient(f.user, f.password, f.fetchImpl);
    const ics = await c.events("https://p42-caldav.icloud.com/123456/calendars/home/", new Date("2026-11-20T00:00:00Z"), new Date("2027-01-20T00:00:00Z"));
    expect(ics).toHaveLength(2);
    expect(ics[0]).toContain("SUMMARY:Voetbaltraining");
    expect(ics[1]).toContain("Verjaardag oma & opa");
    const report = f.state.requests.find((r) => r.method === "REPORT")!;
    expect(report.depth).toBe("1");
    expect(report.body).toContain('<c:time-range start="20261120T000000Z" end="20270120T000000Z"/>');
  });

  it("XML-hulpjes: namespaces, entiteiten en CDATA", () => {
    expect(xmlAll("<d:a>1</d:a><a>2</a><x:a/>", "a")).toEqual(["1", "2", ""]);
    expect(xmlText("Tom &amp; Jerry &#233; &#x41;")).toBe("Tom & Jerry é A");
    expect(xmlText("<![CDATA[<b>&amp;</b>]]>")).toBe("<b>&amp;</b>");
  });
});

describe("afspraken uitrekenen (iCalendar)", () => {
  const start = new Date("2026-11-20T00:00:00Z");
  const end = new Date("2026-12-20T00:00:00Z");

  it("herhalingen met tijdzone, uitzondering (EXDATE) en verplaatst voorkomen (RECURRENCE-ID)", () => {
    const r = expandCalendar([ICS_WEEKLY], "Thuis", start, end);
    const voetbal = r.filter((e) => e.title.startsWith("Voetbal"));
    // 17 nov valt vóór de periode; 24 nov is uitgezonderd; 1 dec is verplaatst naar 20:00; 8 en 15 dec normaal.
    expect(voetbal.map((e) => [e.startsAt, e.title])).toEqual([
      ["2026-12-01T19:00:00.000Z", "Voetbaltraining (later)"],
      ["2026-12-08T18:00:00.000Z", "Voetbaltraining"],
      ["2026-12-15T18:00:00.000Z", "Voetbaltraining"],
    ]);
    expect(voetbal[1]).toMatchObject({ endsAt: "2026-12-08T19:30:00.000Z", location: "Sportpark", allDay: false, calendar: "Thuis" });
  });

  it("hele dagen en geannuleerde afspraken", () => {
    const r = expandCalendar([ICS_ALLDAY], "Thuis", start, end);
    expect(r).toEqual([expect.objectContaining({ title: "Verjaardag oma & opa", allDay: true, startsAt: "2026-11-25T12:00:00.000Z" })]);
  });

  it("negeert kapotte agenda-items in plaats van alles te laten mislukken", () => {
    expect(expandCalendar(["geen ics", "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nEND:VCALENDAR"], "x", start, end)).toEqual([]);
  });

  it("begrenst oneindige reeksen die lang geleden begonnen", () => {
    const daily = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:d\r\nSUMMARY:Elke dag\r\nDTSTART:20100101T080000Z\r\nDTEND:20100101T081500Z\r\nRRULE:FREQ=DAILY\r\nEND:VEVENT\r\nEND:VCALENDAR";
    const r = expandCalendar([daily], "x", start, end);
    expect(r).toHaveLength(30);
    expect(r[0]!.startsAt).toBe("2026-11-20T08:00:00.000Z");
  });
});
