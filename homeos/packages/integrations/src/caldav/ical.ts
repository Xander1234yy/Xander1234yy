import ICAL from "ical.js";

export interface CalendarOccurrence {
  /** Uniek per voorkomen (uid + starttijd). */
  id: string;
  calendar: string;
  title: string;
  location: string;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
}

/** Max. voorkomens per afspraak in de periode, en max. stappen door de herhaling (oude dagelijkse reeksen). */
const MAX_PER_EVENT = 400;
const MAX_STEPS = 20_000;

/** Tijd naar ISO. Hele dagen op 12:00 UTC, zodat de datum in elke tijdzone van Europa/Amerika gelijk blijft. */
function iso(t: ICAL.Time): string {
  if (t.isDate) return new Date(Date.UTC(t.year, t.month - 1, t.day, 12)).toISOString();
  return t.toJSDate().toISOString();
}

/**
 * Zet iCalendar-teksten (zoals CalDAV ze teruggeeft) om in losse afspraken binnen [start, end), inclusief
 * herhalingen (RRULE/RDATE), uitzonderingen (EXDATE) en verplaatste voorkomens (RECURRENCE-ID). Geannuleerde
 * afspraken worden overgeslagen. Kapotte agenda-items worden genegeerd in plaats van alles te laten mislukken.
 */
export function expandCalendar(icsTexts: string[], calendar: string, start: Date, end: Date): CalendarOccurrence[] {
  const out: CalendarOccurrence[] = [];
  const startMs = start.getTime();
  const endMs = end.getTime();
  for (const text of icsTexts) {
    let root: ICAL.Component;
    try {
      root = new ICAL.Component(ICAL.parse(text));
    } catch {
      continue;
    }
    for (const tz of root.getAllSubcomponents("vtimezone")) {
      try {
        const zone = new ICAL.Timezone(tz);
        if (zone.tzid && !ICAL.TimezoneService.has(zone.tzid)) ICAL.TimezoneService.register(tz);
      } catch {
        /* onbekende tijdzone: tijden worden dan als UTC gelezen */
      }
    }
    const vevents = root.getAllSubcomponents("vevent");
    const masters = vevents.filter((v) => !v.hasProperty("recurrence-id"));
    const exceptions = vevents.filter((v) => v.hasProperty("recurrence-id"));
    for (const m of masters) {
      try {
        const ev = new ICAL.Event(m, { exceptions });
        const push = (s: ICAL.Time, e: ICAL.Time | null, item: ICAL.Event) => {
          if (String(item.component.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED") return;
          const sMs = s.toJSDate().getTime();
          const eMs = e ? e.toJSDate().getTime() : sMs;
          if (eMs < startMs || sMs >= endMs) return;
          out.push({
            id: `${item.uid || "x"}@${iso(s)}`.slice(0, 300),
            calendar,
            title: (item.summary || "(geen titel)").slice(0, 200),
            location: (item.location || "").slice(0, 200),
            startsAt: iso(s),
            endsAt: e ? iso(e) : null,
            allDay: s.isDate,
          });
        };
        if (ev.isRecurring()) {
          const it = ev.iterator();
          const before = out.length;
          for (let i = 0, next = it.next(); next && i < MAX_STEPS && out.length - before < MAX_PER_EVENT; i++, next = it.next()) {
            if (next.toJSDate().getTime() >= endMs) break;
            const d = ev.getOccurrenceDetails(next);
            push(d.startDate, d.endDate, d.item);
          }
        } else {
          push(ev.startDate, ev.endDate ?? null, ev);
        }
      } catch {
        /* kapot item overslaan */
      }
    }
  }
  return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
