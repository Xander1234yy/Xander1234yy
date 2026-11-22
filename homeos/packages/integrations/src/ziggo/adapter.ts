import { randomBytes } from "node:crypto";
import type { AdapterHealth, Capability, DeviceCommand, DeviceState, RemoteButton } from "@homeos/shared";
import type { AdapterContext, CommandResult, DeviceAdapter, DiscoveredDevice, StatusReport } from "../adapter";
import { RequestBudget } from "../cloud/budget";
import { ZiggoApi, ZiggoError, type ZiggoBox, type ZiggoChannel, type ZiggoServices, type ZiggoSession } from "./api";
import { wsMqttConnect, type MqttConnect, type MqttSession } from "./mqtt";

/**
 * Ziggo Mediabox Next / Next Mini — NIET-OFFICIËLE koppeling (expliciet gevraagd door de gebruiker), overal zo gemarkeerd.
 * Zenders kiezen, aan/stand-by, afspelen/pauzeren en afstandsbedieningsknoppen via Ziggo's eigen berichtendienst (MQTT
 * over wss), zoals de Ziggo GO-webapp. Korte verbindingen, dus ook bruikbaar in de cloudmodus.
 * Status (aan/stand-by, zender) hooguit elke 5 minuten opgehaald, en na iedere opdracht teruggelezen.
 */
const STATUS_MS = 5 * 60_000;
const CHANNELS_MS = 24 * 3_600_000;
const WAIT_STATUS_MS = 2_500;
const MAX_SOURCES = 80;

export const ZIGGO_KEYS: Record<RemoteButton, string> = {
  UP: "ArrowUp", DOWN: "ArrowDown", LEFT: "ArrowLeft", RIGHT: "ArrowRight", ENTER: "Enter", BACK: "Escape",
  HOME: "MediaTopMenu", EXIT: "Escape", MENU: "MediaTopMenu", INFO: "Info", GUIDE: "Guide", LIST: "ContextMenu",
  CHANNELUP: "ChannelUp", CHANNELDOWN: "ChannelDown", PLAY: "MediaPlay", PAUSE: "MediaPause", STOP: "MediaStop",
  REWIND: "MediaRewind", FASTFORWARD: "MediaFastForward", RED: "Red", GREEN: "Green", YELLOW: "Yellow", BLUE: "Blue",
  "0": "0", "1": "1", "2": "2", "3": "3", "4": "4", "5": "5", "6": "6", "7": "7", "8": "8", "9": "9",
};

type BoxState = "ONLINE_RUNNING" | "ONLINE_STANDBY" | "OFFLINE_NETWORK_STANDBY" | "OFFLINE" | "UNKNOWN";
interface BoxStatus {
  state: BoxState;
  channelId: string | null;
  at: string | null;
}
interface Cache {
  services?: ZiggoServices;
  channels?: ZiggoChannel[];
  channelsAt?: number;
  status?: Record<string, BoxStatus>;
  lastStatusAttempt?: number;
  lastError?: string | null;
  budget?: unknown;
}

export interface ZiggoConfig {
  boxes: ZiggoBox[];
  cityId: string | null;
}

const id8 = () => randomBytes(4).toString("hex");

export class ZiggoAdapter implements DeviceAdapter {
  readonly integration = "ziggo" as const;
  readonly demo = false;
  readonly id = "ziggo";
  readonly displayName = "Ziggo Mediabox (niet-officieel)";
  readonly budget: RequestBudget;

  private ctx: AdapterContext | null = null;
  private api: ZiggoApi;
  private c: Cache = {};
  private session: ZiggoSession | null = null;
  private creds: { username: string; password: string } | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly config: ZiggoConfig,
    fetchImpl: typeof fetch = fetch,
    private readonly mqttConnect: MqttConnect = wsMqttConnect,
    private readonly nowMs: () => number = Date.now,
  ) {
    this.api = new ZiggoApi(fetchImpl);
    this.budget = new RequestBudget(1000, 200, nowMs);
  }

  async connect(ctx: AdapterContext): Promise<void> {
    this.ctx = ctx;
    const raw = await ctx.secrets.get("credentials");
    this.creds = raw ? (JSON.parse(raw) as { username: string; password: string }) : null;
    const s = await ctx.secrets.get("session");
    this.session = s ? (JSON.parse(s) as ZiggoSession) : null;
    this.c = ((await ctx.cache?.load()) as Cache | null) ?? {};
    this.budget.importState(this.c.budget);
    if (!this.creds) return;
    if (!ctx.serverless) {
      this.timer = setInterval(() => void this.refreshStatus(false), STATUS_MS);
      this.timer.unref?.();
    }
  }

  async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.ctx = null;
  }

  private async persist() {
    this.c.budget = this.budget.exportState();
    await this.ctx?.cache?.save(this.c);
  }

  // ---------- aanmelding ----------

  private async services(): Promise<ZiggoServices> {
    this.c.services ??= await this.api.services();
    return this.c.services;
  }

  private async withSession<T>(fn: (s: ZiggoServices, session: ZiggoSession) => Promise<T>): Promise<T> {
    if (!this.creds) throw new ZiggoError("Niet gekoppeld met Ziggo", "UNAUTHORIZED");
    const s = await this.services();
    const save = async (x: ZiggoSession) => {
      this.session = x;
      await this.ctx?.secrets.set("session", JSON.stringify(x));
    };
    if (!this.session) await save(await this.api.login(s, this.creds.username, this.creds.password));
    try {
      return await fn(s, this.session!);
    } catch (e) {
      if (!(e instanceof ZiggoError) || e.code !== "UNAUTHORIZED") throw e;
      try {
        await save(await this.api.refresh(s, this.session!));
      } catch {
        await save(await this.api.login(s, this.creds.username, this.creds.password));
      }
      return fn(s, this.session!);
    }
  }

  private async channelList(): Promise<ZiggoChannel[]> {
    if (this.c.channels && this.nowMs() - (this.c.channelsAt ?? 0) < CHANNELS_MS) return this.c.channels;
    try {
      const s = await this.services();
      this.c.channels = await this.api.channels(s, this.config.cityId);
      this.c.channelsAt = this.nowMs();
    } catch (e) {
      this.ctx?.logger.warn("Ziggo-zenderlijst ophalen mislukt", { error: String(e) });
    }
    return this.c.channels ?? [];
  }

  // ---------- berichtendienst ----------

  /** Korte MQTT-sessie: aanmelden als extra "apparaat", status van de box volgen, `fn` uitvoeren, afsluiten. */
  private async mqtt<T>(boxId: string, kind: "background" | "command", fn: (m: MqttSession, hh: string, clientId: string, waitStatus: (ms: number, until?: (s: BoxStatus, seen: boolean) => boolean) => Promise<BoxStatus>) => Promise<T>): Promise<T> {
    if (!this.budget.canSpend(kind)) throw new ZiggoError("Daglimiet van HomeOS voor Ziggo bereikt", "UNAVAILABLE");
    this.budget.spend();
    return this.withSession(async (s, session) => {
      const token = await this.api.mqttToken(s, session);
      const clientId = randomBytes(16).toString("hex");
      const hh = session.householdId;
      const m = await this.mqttConnect({ url: s.mqtt, clientId, username: hh, password: token });
      const st: BoxStatus = { ...(this.c.status?.[boxId] ?? { state: "UNKNOWN", channelId: null, at: null }) };
      let seen = false;
      let uiSeen = false;
      const waiters: (() => void)[] = [];
      m.onMessage((topic, payload) => {
        let p: { state?: string; source?: unknown; type?: string; status?: { playerState?: { source?: { channelId?: string } } } };
        try {
          p = JSON.parse(payload);
        } catch {
          return;
        }
        if (topic === `${hh}/${boxId}/status` && typeof p.state === "string") {
          st.state = (["ONLINE_RUNNING", "ONLINE_STANDBY", "OFFLINE_NETWORK_STANDBY", "OFFLINE"].includes(p.state) ? p.state : "UNKNOWN") as BoxState;
          st.at = new Date(this.nowMs()).toISOString();
          seen = true;
        } else if (p.type === "CPE.uiStatus" && p.source === boxId) {
          const ch = p.status?.playerState?.source?.channelId;
          st.channelId = typeof ch === "string" && /^[\w.:-]{1,100}$/.test(ch) ? ch : null;
          uiSeen = true;
          st.at = new Date(this.nowMs()).toISOString();
        }
        for (const w of waiters.splice(0)) w();
      });
      /** Wacht op stroomstatus én zender (of een eigen voorwaarde), hooguit `ms`. */
      const waitStatus = (ms: number, until?: (s: BoxStatus, seen: boolean) => boolean) =>
        new Promise<BoxStatus>((res) => {
          const ok = () => (until ? until(st, seen) : seen && uiSeen);
          const done = () => (ok() ? res(st) : waiters.push(done));
          setTimeout(() => res(st), ms);
          done();
        });
      try {
        await m.subscribe(`${hh}/${boxId}/status`);
        await m.subscribe(`${hh}/${clientId}`);
        m.publish(`${hh}/${clientId}/status`, { source: clientId, state: "ONLINE_RUNNING", deviceType: "HGO" });
        m.publish(`${hh}/${boxId}`, { id: id8(), type: "CPE.getUiStatus", source: clientId });
        return await fn(m, hh, clientId, waitStatus);
      } finally {
        this.c.status = { ...this.c.status, [boxId]: { ...st } };
        // Na een opdracht is de status vers: niet meteen opnieuw ophalen.
        if (seen) this.c.lastStatusAttempt = this.nowMs();
        await m.end().catch(() => undefined);
      }
    });
  }

  private async refreshStatus(force: boolean): Promise<void> {
    if (!this.creds || this.config.boxes.length === 0) return;
    if (!force && this.nowMs() - (this.c.lastStatusAttempt ?? 0) < STATUS_MS) return;
    this.c.lastStatusAttempt = this.nowMs();
    try {
      for (const b of this.config.boxes) await this.mqtt(b.deviceId, "background", async (_m, _hh, _c, wait) => wait(WAIT_STATUS_MS));
      this.c.lastError = null;
    } catch (e) {
      this.c.lastError = (e as Error).message;
    }
    await this.channelList();
    for (const b of this.config.boxes) this.ctx?.emit({ type: "device_state", externalId: b.deviceId, report: this.report(b.deviceId) });
    await this.persist();
  }

  // ---------- DeviceAdapter ----------

  getCapabilities(externalId: string): Capability[] {
    return this.config.boxes.some((b) => b.deviceId === externalId) ? ["media_power", "media_playback", "remote_control", "source_select"] : [];
  }

  async discover(): Promise<DiscoveredDevice[]> {
    return this.config.boxes.map((b) => ({
      externalId: b.deviceId,
      name: b.name,
      brand: "Ziggo (niet-officieel)",
      model: b.platform ? `Mediabox (${b.platform})` : "Mediabox",
      kind: "media" as const,
      capabilities: this.getCapabilities(b.deviceId),
      suggestedRoomId: null,
      refreshIntervalMs: STATUS_MS,
    }));
  }

  private state(boxId: string): DeviceState {
    const st = this.c.status?.[boxId];
    const channels = this.c.channels ?? [];
    const current = st?.channelId ? channels.find((c) => c.id === st.channelId) : undefined;
    const power = st?.state === "ONLINE_RUNNING" ? "on" : st?.state === "ONLINE_STANDBY" || st?.state === "OFFLINE_NETWORK_STANDBY" ? "standby" : "unknown";
    return {
      media: {
        power,
        playback: "unknown",
        ...(current ? { title: `${current.number}. ${current.name}`, source: current.id } : {}),
        sources: channels.slice(0, MAX_SOURCES).map((c) => ({ id: c.id, label: `${c.number}. ${c.name}`, type: "channel" as const })),
      },
    };
  }

  private report(boxId: string): StatusReport {
    if (!this.config.boxes.some((b) => b.deviceId === boxId)) return { status: "UNKNOWN", state: {}, lastSeen: null, error: "Box niet gevonden" };
    if (!this.creds) return { status: "UNKNOWN", state: {}, lastSeen: null, error: "Niet gekoppeld met Ziggo" };
    const st = this.c.status?.[boxId];
    if (st?.state === "OFFLINE") return { status: "OFFLINE", state: this.state(boxId), lastSeen: null, error: "De box staat in diepe stand-by (energiebesparing) of heeft geen stroom/internet en is daardoor niet op afstand aan te zetten. Zet op de box bij Instellingen → Energie/Stand-by de modus op snel opstarten (niet 'Eco'). Via de tv met HDMI-CEC gaat hij wel mee aan.", stateAt: st.at };
    // Status onbekend: toch bedienbaar laten (Ziggo meldt niet altijd direct de status).
    return { status: "ONLINE", state: this.state(boxId), lastSeen: st?.at ?? null, error: this.c.lastError ?? null, stateAt: st?.at ?? null };
  }

  async getStatus(id: string): Promise<StatusReport> {
    await this.refreshStatus(false);
    return this.report(id);
  }

  async executeCommand(id: string, command: DeviceCommand): Promise<CommandResult> {
    if (!this.config.boxes.some((b) => b.deviceId === id)) return { ok: false, code: "NOT_FOUND", message: "Box niet gevonden" };
    if (!this.creds) return { ok: false, code: "DEVICE_UNAVAILABLE", message: "Niet gekoppeld met Ziggo" };
    const key = (k: string, clientId: string) => ({ id: id8(), type: "CPE.KeyEvent", runtimeType: "key", source: clientId, status: { w3cKey: k, eventType: "keyDownUp" } });
    try {
      let refused: string | null = null;
      if (command.type === "select_source") {
        const channels = await this.channelList();
        const ch = channels.find((c) => c.id === command.sourceId);
        if (!ch) return { ok: false, code: "UNSUPPORTED", message: "Onbekende zender" };
        await this.mqtt(id, "command", async (m, hh, clientId, wait) => {
          m.publish(`${hh}/${id}`, { id: id8(), type: "CPE.pushToTV", source: { clientId, friendlyDeviceName: "HomeOS" }, status: { sourceType: "linear", source: { channelId: ch.id }, relativePosition: 0, speed: 1 } });
          m.publish(`${hh}/${id}`, { id: id8(), type: "CPE.getUiStatus", source: clientId });
          await wait(WAIT_STATUS_MS, (s) => s.channelId === ch.id);
        });
      } else if (command.type === "media_power") {
        await this.mqtt(id, "command", async (m, hh, clientId, wait) => {
          const st = await wait(WAIT_STATUS_MS, (_s, seen) => seen);
          const isOn = st.state === "ONLINE_RUNNING";
          const isStandby = st.state === "ONLINE_STANDBY" || st.state === "OFFLINE_NETWORK_STANDBY";
          if (command.on === isOn) return; // staat al goed
          if (!isOn && !isStandby) {
            refused = "De status van de box is onbekend; probeer het zo opnieuw";
            return;
          }
          m.publish(`${hh}/${id}`, key("Power", clientId));
          const before = st.state;
          await wait(4_000, (s) => s.state !== before);
        });
      } else if (command.type === "remote_button") {
        if (!ZIGGO_KEYS[command.button]) return { ok: false, code: "UNSUPPORTED", message: "Onbekende knop" };
        await this.mqtt(id, "command", async (m, hh, clientId) => m.publish(`${hh}/${id}`, key(ZIGGO_KEYS[command.button], clientId)));
      } else if (command.type === "media") {
        const k = { play: "MediaPlayPause", pause: "MediaPlayPause", next: "ChannelUp", previous: "ChannelDown" }[command.action];
        await this.mqtt(id, "command", async (m, hh, clientId) => m.publish(`${hh}/${id}`, key(k, clientId)));
      } else {
        return { ok: false, code: "UNSUPPORTED", message: "Deze Ziggo-box ondersteunt dit niet via HomeOS" };
      }
      this.c.lastError = null;
      await this.channelList();
      await this.persist();
      if (refused) return { ok: false, code: "DEVICE_UNAVAILABLE", message: refused };
      return { ok: true, report: this.report(id) };
    } catch (e) {
      this.c.lastError = (e as Error).message;
      await this.persist();
      const unavailable = e instanceof ZiggoError ? e.code === "UNAUTHORIZED" || e.code === "UNAVAILABLE" : (e as { code?: string }).code === "UNAUTHORIZED" || (e as { code?: string }).code === "UNAVAILABLE";
      return { ok: false, code: unavailable ? "DEVICE_UNAVAILABLE" : "ADAPTER_ERROR", message: this.c.lastError };
    }
  }

  async healthCheck(): Promise<AdapterHealth> {
    return {
      adapterId: this.id,
      integration: this.integration,
      displayName: this.displayName,
      demo: false,
      status: !this.creds ? "not_configured" : this.c.lastError ? "degraded" : "ok",
      message: !this.creds ? "Niet gekoppeld" : (this.c.lastError ?? `${this.config.boxes.length} box(en) · niet-officieel, kan zonder aankondiging stoppen`),
      checkedAt: new Date(this.nowMs()).toISOString(),
    };
  }
}
