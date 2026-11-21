import { CaldavClient, CaldavError, expandCalendar, type CalendarOccurrence } from "@homeos/integrations";
import { joinPath, readFileOrNull, writeFileAtomic } from "./fs-utils";
import type { SecretStore } from "./secret-store";
import type { IntegrationsStore } from "./integrations-store";
import { SetupError } from "./cloud-service";

const SCOPE = "icloud-calendar";
const REFRESH_MS = 10 * 60_000;
const PAST_MS = 86_400_000;
const AHEAD_MS = 60 * 86_400_000;
/** Apple: app-specifieke wachtwoorden zijn 16 kleine letters, getoond als xxxx-xxxx-xxxx-xxxx. */
export const APP_PASSWORD = /^[a-z]{4}-?[a-z]{4}-?[a-z]{4}-?[a-z]{4}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;

interface CacheDoc {
  fetchedAt: string | null;
  lastAttempt: number;
  events: CalendarOccurrence[];
  error: string | null;
}

/**
 * Apple iCloud-agenda (alleen-lezen) via CalDAV met een app-specifiek wachtwoord. Apple ID en wachtwoord versleuteld;
 * alleen agenda-adressen en -namen in de gewone opslag. Afspraken worden hooguit elke 10 minuten opgehaald.
 */
export function createIcloudCalendarService(o: { store: IntegrationsStore; secrets: SecretStore; dataDir: string | null; serverless?: boolean; fetchImpl?: typeof fetch; now?: () => number }) {
  const scope = o.secrets.scoped(SCOPE);
  const now = o.now ?? Date.now;
  const cacheFile = o.dataDir ? joinPath(o.dataDir, "cache", "icloud-calendar-events.json") : null;
  let memory: CacheDoc | null = null;
  let refreshing: Promise<CacheDoc> | null = null;

  const readCache = async (): Promise<CacheDoc> => {
    if (memory) return memory;
    const raw = cacheFile ? await readFileOrNull(cacheFile) : null;
    try {
      memory = raw ? (JSON.parse(raw) as CacheDoc) : null;
    } catch {
      memory = null;
    }
    return memory ?? { fetchedAt: null, lastAttempt: 0, events: [], error: null };
  };
  const writeCache = async (c: CacheDoc) => {
    memory = c;
    if (cacheFile) await writeFileAtomic(cacheFile, JSON.stringify(c));
  };
  const client = async () => {
    const appleId = await scope.get("appleId");
    const password = await scope.get("appPassword");
    if (!appleId || !password) throw new CaldavError("Niet gekoppeld", "UNAUTHORIZED");
    return new CaldavClient(appleId, password, o.fetchImpl);
  };
  const setupError = (e: unknown) => {
    if (e instanceof SetupError) return e;
    const err = e as CaldavError;
    return new SetupError(err.code === "UNAUTHORIZED" ? 401 : err.code === "UNAVAILABLE" ? 503 : 502, "ICLOUD", err.message ?? "iCloud-fout");
  };

  async function refresh(force: boolean): Promise<CacheDoc> {
    const cache = await readCache();
    const s = o.store.state.icloud;
    if (!s) return cache;
    if (!force && now() - cache.lastAttempt < REFRESH_MS) return cache;
    const start = new Date(now() - PAST_MS);
    const end = new Date(now() + AHEAD_MS);
    try {
      const c = await client();
      const events: CalendarOccurrence[] = [];
      for (const cal of s.calendars.filter((x) => x.enabled)) {
        events.push(...expandCalendar(await c.events(cal.href, start, end), cal.name, start, end));
      }
      events.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      const next = { fetchedAt: new Date(now()).toISOString(), lastAttempt: now(), events: events.slice(0, 1000), error: null };
      await writeCache(next);
      return next;
    } catch (e) {
      // Oude afspraken blijven zichtbaar (met tijdstip), de fout wordt erbij gemeld.
      const next = { ...cache, lastAttempt: now(), error: (e as Error).message };
      await writeCache(next);
      return next;
    }
  }

  return {
    list() {
      const s = o.store.state.icloud;
      return s ? { connected: true, addedAt: s.addedAt, calendars: s.calendars, fetchedAt: memory?.fetchedAt ?? null, error: memory?.error ?? null } : { connected: false };
    },
    async connect(appleId: string, appPassword: string) {
      const id = appleId.trim().toLowerCase();
      const pw = appPassword.trim().toLowerCase();
      if (!EMAIL.test(id)) throw new SetupError(400, "INVALID", "Vul je Apple ID (e-mailadres) in");
      if (!APP_PASSWORD.test(pw)) throw new SetupError(400, "INVALID", "Gebruik een app-specifiek wachtwoord (xxxx-xxxx-xxxx-xxxx), niet je gewone Apple-wachtwoord");
      let calendars;
      try {
        calendars = (await new CaldavClient(id, pw, o.fetchImpl).discover()).calendars;
      } catch (e) {
        throw setupError(e);
      }
      if (calendars.length === 0) throw new SetupError(404, "NO_CALENDARS", "Geen agenda's gevonden in dit iCloud-account");
      await scope.set("appleId", id);
      await scope.set("appPassword", pw);
      o.store.state.icloud = { addedAt: new Date().toISOString(), calendars: calendars.slice(0, 50).map((c) => ({ ...c, enabled: true })) };
      await o.store.save();
      await refresh(true);
      return { ok: true, calendars: o.store.state.icloud.calendars };
    },
    async setCalendars(enabled: string[]) {
      const s = o.store.state.icloud;
      if (!s) throw new SetupError(404, "NOT_FOUND", "Apple-agenda is niet gekoppeld");
      const on = new Set(enabled);
      s.calendars = s.calendars.map((c) => ({ ...c, enabled: on.has(c.href) }));
      await o.store.save();
      await refresh(true);
      return { ok: true, calendars: s.calendars };
    },
    async events(force = false) {
      if (!o.store.state.icloud) return { connected: false, events: [], fetchedAt: null, error: null };
      // Lokaal: direct de bewaarde afspraken tonen en op de achtergrond verversen (de webapp wacht max. 6 s).
      // Cloud (serverless): geen achtergrondwerk mogelijk, dus wachten op het verversen.
      let c: CacheDoc;
      if (o.serverless || force) c = await refresh(force);
      else {
        c = await readCache();
        if (now() - c.lastAttempt >= REFRESH_MS && !refreshing) refreshing = refresh(false).finally(() => (refreshing = null));
        if (!c.fetchedAt && refreshing) c = await refreshing;
      }
      return { connected: true, events: c.events, fetchedAt: c.fetchedAt, error: c.error };
    },
    async remove() {
      if (!o.store.state.icloud) throw new SetupError(404, "NOT_FOUND", "Apple-agenda is niet gekoppeld");
      await scope.delete("appleId");
      await scope.delete("appPassword");
      o.store.state.icloud = null;
      await o.store.save();
      await writeCache({ fetchedAt: null, lastAttempt: 0, events: [], error: null });
      return { ok: true };
    },
  };
}

export type IcloudCalendarService = ReturnType<typeof createIcloudCalendarService>;
