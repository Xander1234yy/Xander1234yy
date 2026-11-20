"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SnapshotSchema, type Device, type DeviceCommand, type DeviceEvent, type Snapshot } from "@homeos/shared";
import { api, connectorPath, enc } from "./api";
import { useToast } from "@/components/toast";

export type LinkState = "online" | "offline" | "connecting";

export interface HomeNotification {
  id: string;
  at: string;
  category: "connection" | "energy" | "maintenance" | "automation" | "security" | "system";
  title: string;
  body: string;
  read: boolean;
}

interface HomeState {
  snapshot: Snapshot | null;
  /** true als de snapshot uit de lokale cache komt (niet live). */
  fromCache: boolean;
  /** Tijdstip waarop de laatste snapshot van de connector binnenkwam. */
  lastSync: string | null;
  cloud: LinkState;
  connector: LinkState;
  connectorReason: string | null;
  events: DeviceEvent[];
  notifications: HomeNotification[];
  markNotificationsRead(): Promise<void>;
  /** Telt op bij iedere automatisering-run (om lijsten te verversen). */
  runTick: number;
  pending: Set<string>;
  sendCommand(device: Device, command: DeviceCommand, source?: "user" | "jarvis"): Promise<boolean>;
  activateScene(sceneId: string, source?: "user" | "jarvis"): Promise<boolean>;
  setEmergencyStop(active: boolean): Promise<void>;
  syncAll(): Promise<void>;
  mutate(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown, success?: string): Promise<boolean>;
}

const Ctx = createContext<HomeState | null>(null);
const CACHE_KEY = "homeos:last-snapshot:v1";

export function HomeProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [cloud, setCloud] = useState<LinkState>("connecting");
  const [connector, setConnector] = useState<LinkState>("connecting");
  const [connectorReason, setConnectorReason] = useState<string | null>(null);
  const [events, setEvents] = useState<DeviceEvent[]>([]);
  const [notifications, setNotifications] = useState<HomeNotification[]>([]);
  const [runTick, setRunTick] = useState(0);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const esRef = useRef<EventSource | null>(null);

  const accept = useCallback((s: Snapshot) => {
    setSnapshot(s);
    setFromCache(false);
    setLastSync(new Date().toISOString());
    setConnector("online");
    setConnectorReason(null);
    setCloud("online");
    try {
      // Alleen niet-geheime apparaatstatus; nooit tokens.
      localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: new Date().toISOString(), snapshot: s }));
    } catch {
      /* opslag vol of geblokkeerd */
    }
  }, []);

  // Laatst bekende gegevens uit de cache tonen (duidelijk als niet-live gemarkeerd).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { savedAt: string; snapshot: unknown };
      const s = SnapshotSchema.safeParse(parsed.snapshot);
      if (s.success) {
        setSnapshot((cur) => cur ?? s.data);
        setFromCache(true);
        setLastSync((cur) => cur ?? parsed.savedAt);
      }
    } catch {
      /* negeren */
    }
  }, []);

  const loadEvents = useCallback(async () => {
    try {
      const [r, n] = await Promise.all([
        api<{ events: DeviceEvent[] }>(connectorPath("v1/events?limit=40")),
        api<{ notifications: HomeNotification[] }>(connectorPath("v1/notifications?limit=40")),
      ]);
      setEvents(r.events);
      setNotifications(n.notifications);
    } catch {
      /* connector offline */
    }
  }, []);

  // Realtime verbinding via SSE, met fallback naar polling.
  useEffect(() => {
    let disposed = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let reopenTimer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const s = SnapshotSchema.parse(await api(connectorPath("v1/snapshot")));
        if (!disposed) accept(s);
      } catch (e) {
        if (disposed) return;
        const status = (e as { status?: number }).status ?? 0;
        setCloud(status === 0 ? "offline" : "online");
        setConnector("offline");
      }
    };

    const open = () => {
      if (disposed) return;
      const es = new EventSource("/api/stream");
      esRef.current = es;
      es.addEventListener("snapshot", (ev) => {
        const s = SnapshotSchema.safeParse(JSON.parse((ev as MessageEvent).data));
        if (s.success) accept(s.data);
      });
      es.addEventListener("event", (ev) => {
        const e = JSON.parse((ev as MessageEvent).data) as DeviceEvent;
        setEvents((cur) => [e, ...cur.filter((x) => x.id !== e.id)].slice(0, 60));
      });
      es.addEventListener("notification", (ev) => {
        const n = JSON.parse((ev as MessageEvent).data) as HomeNotification;
        setNotifications((cur) => [n, ...cur.filter((x) => x.id !== n.id)].slice(0, 60));
        toast.push({ title: n.title, description: n.body, tone: n.category === "security" ? "accent" : n.category === "automation" && /mislukt/.test(n.title) ? "danger" : "accent" });
      });
      es.addEventListener("automation_run", () => setRunTick((t) => t + 1));
      es.addEventListener("connector", (ev) => {
        const d = JSON.parse((ev as MessageEvent).data) as { online: boolean; reason?: string };
        setCloud("online");
        if (d.online) {
          setConnector("online");
          void loadEvents();
        } else {
          setConnector("offline");
          setConnectorReason(d.reason ?? null);
          // Niet (juist) gekoppeld: sluit de stream en probeer het over 5 s opnieuw,
          // zodat een koppeling in Instellingen meteen effect heeft.
          if (d.reason?.startsWith("connector_")) {
            es.close();
            if (!disposed) reopenTimer = setTimeout(open, 5_000);
          }
        }
      });
      es.onerror = () => {
        // EventSource probeert zelf opnieuw; controleer of de cloud-API nog bereikbaar is.
        fetch("/api/health", { cache: "no-store" })
          .then((r) => r.json() as Promise<{ connector: boolean }>)
          .then((h) => {
            if (disposed) return;
            setCloud("online");
            if (!h.connector) setConnector("offline");
          })
          .catch(() => {
            if (disposed) return;
            setCloud("offline");
            setConnector("offline");
          });
      };
    };

    if (typeof EventSource !== "undefined") open();
    else {
      const loop = async () => {
        await poll();
        if (!disposed) pollTimer = setTimeout(loop, 5_000);
      };
      void loop();
    }
    void loadEvents();

    const onOnline = () => setCloud("connecting");
    const onOffline = () => {
      setCloud("offline");
      setConnector("offline");
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      disposed = true;
      esRef.current?.close();
      if (pollTimer) clearTimeout(pollTimer);
      if (reopenTimer) clearTimeout(reopenTimer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [accept, loadEvents, toast]);

  const withPending = useCallback(async <T,>(key: string, fn: () => Promise<T>) => {
    setPending((p) => new Set(p).add(key));
    try {
      return await fn();
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(key);
        return n;
      });
    }
  }, []);

  const replaceDevice = useCallback((device: Device) => {
    setSnapshot((s) => (s ? { ...s, devices: s.devices.map((d) => (d.id === device.id ? device : d)) } : s));
  }, []);

  const sendCommand = useCallback<HomeState["sendCommand"]>(
    (device, command, source = "user") =>
      withPending(device.id, async () => {
        try {
          // Geen optimistische update: we tonen pas de status die de connector werkelijk terugmeldt.
          const r = await api<{ device: Device }>(connectorPath(`v1/devices/${enc(device.id)}/commands`), {
            method: "POST",
            body: JSON.stringify({ command, source }),
          });
          replaceDevice(r.device);
          return true;
        } catch (e) {
          toast.push({ title: `${device.name}: opdracht niet uitgevoerd`, description: (e as Error).message, tone: "danger" });
          return false;
        }
      }),
    [replaceDevice, toast, withPending],
  );

  const activateScene = useCallback<HomeState["activateScene"]>(
    (sceneId, source = "user") =>
      withPending(sceneId, async () => {
        try {
          await api(connectorPath(`v1/scenes/${enc(sceneId)}/activate`), { method: "POST", body: JSON.stringify({ source }) });
          return true;
        } catch (e) {
          toast.push({ title: "Scène niet geactiveerd", description: (e as Error).message, tone: "danger" });
          return false;
        }
      }),
    [toast, withPending],
  );

  const mutate = useCallback<HomeState["mutate"]>(
    async (path, method, body, success) => {
      try {
        await api(connectorPath(path), { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
        if (success) toast.push({ title: success, tone: "success" });
        return true;
      } catch (e) {
        toast.push({ title: "Niet gelukt", description: (e as Error).message, tone: "danger" });
        return false;
      }
    },
    [toast],
  );

  const setEmergencyStop = useCallback(
    async (active: boolean) => {
      await mutate("v1/emergency-stop", "POST", { active }, active ? "Noodstop geactiveerd" : "Noodstop opgeheven");
    },
    [mutate],
  );

  const markNotificationsRead = useCallback(async () => {
    setNotifications((cur) => cur.map((n) => ({ ...n, read: true })));
    try {
      await api(connectorPath("v1/notifications/read"), { method: "POST", body: JSON.stringify({ ids: "all" }) });
    } catch {
      /* niet kritiek */
    }
  }, []);

  const syncAll = useCallback(async () => {
    await withPending("sync", async () => {
      try {
        accept(SnapshotSchema.parse(await api(connectorPath("v1/sync"), { method: "POST" })));
        toast.push({ title: "Alle apparaten gesynchroniseerd", tone: "success" });
      } catch (e) {
        toast.push({ title: "Synchroniseren mislukt", description: (e as Error).message, tone: "danger" });
      }
    });
  }, [accept, toast, withPending]);

  const value = useMemo<HomeState>(
    () => ({ snapshot, fromCache, lastSync, cloud, connector, connectorReason, events, notifications, markNotificationsRead, runTick, pending, sendCommand, activateScene, setEmergencyStop, syncAll, mutate }),
    [snapshot, fromCache, lastSync, cloud, connector, connectorReason, events, notifications, markNotificationsRead, runTick, pending, sendCommand, activateScene, setEmergencyStop, syncAll, mutate],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHome(): HomeState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useHome buiten HomeProvider");
  return v;
}

/** Of live bediening mogelijk is. */
export function useLive(): boolean {
  const { connector, fromCache } = useHome();
  return connector === "online" && !fromCache;
}
