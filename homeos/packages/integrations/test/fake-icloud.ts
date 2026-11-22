/**
 * Nagebootste iCloud-CalDAV-server (alleen voor tests, nooit het netwerk). Volgt het gedrag van iCloud:
 * eerste aanvraag op caldav.icloud.com, daarna een redirect/verwijzing naar een eigen pNN-server.
 */
export const ICS_WEEKLY = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Apple Inc.//iCloud//EN",
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Amsterdam",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "DTSTART:19810329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "TZNAME:CEST",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "DTSTART:19961027T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "TZNAME:CET",
  "END:STANDARD",
  "END:VTIMEZONE",
  "BEGIN:VEVENT",
  "UID:voetbal-1",
  "SUMMARY:Voetbaltraining",
  "LOCATION:Sportpark",
  "DTSTART;TZID=Europe/Amsterdam:20261103T190000",
  "DTEND;TZID=Europe/Amsterdam:20261103T203000",
  "RRULE:FREQ=WEEKLY;COUNT=10",
  "EXDATE;TZID=Europe/Amsterdam:20261124T190000",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:voetbal-1",
  "RECURRENCE-ID;TZID=Europe/Amsterdam:20261201T190000",
  "SUMMARY:Voetbaltraining (later)",
  "DTSTART;TZID=Europe/Amsterdam:20261201T200000",
  "DTEND;TZID=Europe/Amsterdam:20261201T213000",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

export const ICS_ALLDAY = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:verjaardag-1",
  "SUMMARY:Verjaardag oma & opa",
  "DTSTART;VALUE=DATE:20261125",
  "DTEND;VALUE=DATE:20261126",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:afgezegd-1",
  "SUMMARY:Tandarts",
  "STATUS:CANCELLED",
  "DTSTART:20261126T090000Z",
  "DTEND:20261126T093000Z",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function fakeIcloud(opts: { user?: string; password?: string } = {}) {
  const user = opts.user ?? "xander@example.com";
  const password = opts.password ?? "abcd-efgh-ijkl-mnop";
  const auth = "Basic " + Buffer.from(`${user}:${password}`).toString("base64");
  const state = { requests: [] as { method: string; url: string; auth: string | null; depth: string | null; body: string }[] };
  const P = "https://p42-caldav.icloud.com";

  const ms = (body: string) => new Response(`<?xml version="1.0" encoding="UTF-8"?><multistatus xmlns="DAV:">${body}</multistatus>`, { status: 207, headers: { "content-type": "application/xml" } });

  const fetchImpl = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const h = new Headers(init.headers);
    const body = String(init.body ?? "");
    state.requests.push({ method: String(init.method), url: url.toString(), auth: h.get("authorization"), depth: h.get("depth"), body });
    if (h.get("authorization") !== auth) return new Response("Unauthorized", { status: 401 });
    // Eerste aanvraag: iCloud verwijst door naar de eigen server van het account.
    if (url.hostname === "caldav.icloud.com" && url.pathname === "/") {
      if (init.redirect !== "manual") return new Response("redirect not manual", { status: 500 });
      return new Response(null, { status: 301, headers: { location: `${P}/` } });
    }
    if (url.origin !== P) return new Response("nope", { status: 404 });
    if (url.pathname === "/" && body.includes("current-user-principal")) {
      return ms(`<response><href>/</href><propstat><prop><current-user-principal><href>/123456/principal/</href></current-user-principal></prop><status>HTTP/1.1 200 OK</status></propstat></response>`);
    }
    if (url.pathname === "/123456/principal/" && body.includes("calendar-home-set")) {
      return ms(`<response xmlns:c="urn:ietf:params:xml:ns:caldav"><href>/123456/principal/</href><propstat><prop><c:calendar-home-set><href>${P}/123456/calendars/</href></c:calendar-home-set></prop><status>HTTP/1.1 200 OK</status></propstat></response>`);
    }
    if (url.pathname === "/123456/calendars/" && h.get("depth") === "1") {
      return ms(
        [
          `<response><href>/123456/calendars/</href><propstat><prop><resourcetype><collection/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response>`,
          `<response xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/"><href>/123456/calendars/home/</href><propstat><prop><resourcetype><collection/><c:calendar/></resourcetype><displayname>Thuis &amp; gezin</displayname><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set><a:calendar-color>#34C759FF</a:calendar-color></prop><status>HTTP/1.1 200 OK</status></propstat></response>`,
          `<response xmlns:c="urn:ietf:params:xml:ns:caldav"><href>/123456/calendars/work/</href><propstat><prop><resourcetype><collection/><c:calendar/></resourcetype><displayname>Werk</displayname><c:supported-calendar-component-set><c:comp name="VEVENT"/><c:comp name="VTODO"/></c:supported-calendar-component-set></prop><status>HTTP/1.1 200 OK</status></propstat></response>`,
          `<response xmlns:c="urn:ietf:params:xml:ns:caldav"><href>/123456/calendars/tasks/</href><propstat><prop><resourcetype><collection/><c:calendar/></resourcetype><displayname>Herinneringen</displayname><c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set></prop><status>HTTP/1.1 200 OK</status></propstat></response>`,
        ].join(""),
      );
    }
    if (init.method === "REPORT" && url.pathname === "/123456/calendars/home/") {
      return ms(
        `<response xmlns:c="urn:ietf:params:xml:ns:caldav"><href>/123456/calendars/home/a.ics</href><propstat><prop><c:calendar-data>${esc(ICS_WEEKLY)}</c:calendar-data></prop><status>HTTP/1.1 200 OK</status></propstat></response>` +
          `<response xmlns:c="urn:ietf:params:xml:ns:caldav"><href>/123456/calendars/home/b.ics</href><propstat><prop><c:calendar-data><![CDATA[${ICS_ALLDAY}]]></c:calendar-data></prop><status>HTTP/1.1 200 OK</status></propstat></response>`,
      );
    }
    if (init.method === "REPORT" && url.pathname === "/123456/calendars/work/") return ms("");
    return new Response("nope", { status: 404 });
  }) as unknown as typeof fetch;
  return { state, fetchImpl, user, password };
}
