import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import { z } from "zod";
import {
  CommandRequestSchema,
  DeviceAddSchema,
  DevicePatchSchema,
  EmergencyStopSchema,
  EnergyRangeSchema,
  RoomInputSchema,
  RoomsReplaceSchema,
  SceneActivateSchema,
  type CommandErrorCode,
  type ConnectorMessage,
} from "@homeos/shared";
import type { Logger } from "@homeos/integrations";
import { tokensEqual } from "./identity";
import { RateLimiter } from "./rate-limit";
import type { DeviceRegistry, OpResult } from "./registry";
import type { HueService } from "./hue-service";
import { SetupError, type CloudIntegrations } from "./cloud-service";
import type { MatterService } from "./matter-service";
import type { WebOsService } from "./webos-service";
import type { CameraService } from "./camera-service";
import type { ZonneplanService } from "./zonneplan-service";
import type { HueCloudService } from "./huecloud-service";
import type { GoogleHomeService } from "./googlehome-service";
import type { IcloudCalendarService } from "./icloud-calendar-service";
import type { ShortcutsService } from "./shortcuts-service";
import type { ZiggoService } from "./ziggo-service";
import type { PushService } from "./push-service";
import type { AutomationService } from "./automation-service";
import { NOTIFICATION_CATEGORIES } from "@homeos/automation";

export interface ServerOptions {
  registry: DeviceRegistry;
  token: string;
  logger: Logger;
  version: string;
  rateLimitPerMin: number;
  commandLimitPerMin: number;
  /** Toegestane Host-headers (bescherming tegen DNS-rebinding). */
  allowedHosts: string[];
  /** Cloudmodus: lokale integraties (Hue-bridge, tv, camera, Matter) zijn niet beschikbaar. */
  cloudMode?: boolean;
  hue: HueService;
  cloud: CloudIntegrations;
  matter: MatterService;
  webos: WebOsService;
  cameras: CameraService;
  zonneplan: ZonneplanService;
  huecloud: HueCloudService;
  googlehome: GoogleHomeService;
  icloud: IcloudCalendarService;
  shortcuts: ShortcutsService;
  ziggo: ZiggoService;
  push: PushService;
  automations: AutomationService;
}

const MAX_BODY = 64 * 1024;

const STATUS_FOR: Record<CommandErrorCode, number> = {
  NOT_FOUND: 404,
  UNSUPPORTED: 422,
  DEVICE_UNAVAILABLE: 409,
  EMERGENCY_STOP: 423,
  FORBIDDEN: 403,
  ADAPTER_ERROR: 502,
  INVALID: 400,
};

class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Antwoord dat zelf naar de response schrijft (afbeeldingen, videostream) in plaats van JSON. */
class RawResponse {
  constructor(readonly write: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>) {}
}

type Handler = (ctx: { req: IncomingMessage; params: string[]; url: URL; body: () => Promise<unknown> }) => Promise<unknown>;
interface Route {
  method: string;
  pattern: RegExp;
  command?: boolean;
  handler: Handler;
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, "INVALID", r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  return r.data;
}

function unwrap<T>(r: OpResult<T>): unknown {
  if (!r.ok) throw new HttpError(STATUS_FOR[r.code], r.code, r.message);
  return "value" in r ? (r as { value: unknown }).value : { ok: true };
}

async function setup<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof SetupError) throw new HttpError(err.status, err.code, err.message);
    throw err;
  }
}

const limitSchema = z.coerce.number().int().min(1).max(500).default(50);

export function createConnectorServer(o: ServerOptions) {
  const { registry } = o;
  const general = new RateLimiter(o.rateLimitPerMin);
  const commands = new RateLimiter(o.commandLimitPerMin);
  const seg = "([^/]+)";

  const routes: Route[] = [
    { method: "GET", pattern: /^\/v1\/snapshot$/, handler: async () => registry.snapshot() },
    { method: "GET", pattern: /^\/v1\/devices\/available$/, handler: async () => ({ devices: registry.available() }) },
    { method: "POST", pattern: /^\/v1\/discover$/, handler: async () => (await registry.rediscover(), { devices: registry.available() }) },
    {
      method: "POST",
      pattern: new RegExp(`^/v1/devices/${seg}/add$`),
      handler: async ({ params, body }) => unwrap(await registry.addDevice(params[0]!, parse(DeviceAddSchema, await body()))),
    },
    {
      method: "PATCH",
      pattern: new RegExp(`^/v1/devices/${seg}$`),
      handler: async ({ params, body }) => unwrap(await registry.updateDevice(params[0]!, parse(DevicePatchSchema, await body()))),
    },
    { method: "DELETE", pattern: new RegExp(`^/v1/devices/${seg}$`), handler: async ({ params }) => unwrap(await registry.removeDevice(params[0]!)) },
    {
      method: "POST",
      pattern: new RegExp(`^/v1/devices/${seg}/commands$`),
      command: true,
      handler: async ({ params, body }) => {
        const { command, source } = parse(CommandRequestSchema, await body());
        return { device: unwrap(await registry.executeCommand(params[0]!, command, source)) };
      },
    },
    { method: "POST", pattern: new RegExp(`^/v1/devices/${seg}/sync$`), handler: async ({ params }) => unwrap(await registry.syncDevice(params[0]!)) },
    { method: "POST", pattern: /^\/v1\/sync$/, handler: async () => (await registry.syncAll("user"), registry.snapshot()) },
    {
      method: "POST",
      pattern: new RegExp(`^/v1/scenes/${seg}/activate$`),
      command: true,
      handler: async ({ params, body }) => unwrap(await registry.activateScene(params[0]!, parse(SceneActivateSchema, (await body()) ?? {}).source)),
    },
    { method: "GET", pattern: /^\/v1\/integrations$/, handler: async () => ({ hue: o.hue.list(), ...o.cloud.list(), matter: o.matter.list(), webos: o.webos.list(), tapo: o.cameras.list(), zonneplan: o.zonneplan.list(), huecloud: o.huecloud.list(), googlehome: o.googlehome.list(), icloud: o.icloud.list(), shortcuts: o.shortcuts.list(), ziggo: o.ziggo.list(), mode: o.cloudMode ? "cloud" : "local" }) },
    {
      method: "POST",
      pattern: /^\/v1\/integrations\/matter\/commission$/,
      command: true,
      handler: async ({ body }) => {
        const { pairingCode } = parse(z.object({ pairingCode: z.string().trim().min(11).max(64) }), await body());
        return setup(() => o.matter.commission(pairingCode));
      },
    },
    {
      method: "DELETE",
      pattern: /^\/v1\/integrations\/matter\/nodes\/(\d{1,20})$/,
      handler: async ({ params }) => setup(() => o.matter.removeNode(params[0]!)),
    },
    {
      method: "POST",
      pattern: /^\/v1\/integrations\/solaredge$/,
      command: true,
      handler: async ({ body }) => {
        const { siteId, apiKey } = parse(z.object({ siteId: z.string().trim().max(12), apiKey: z.string().trim().max(64) }), await body());
        return setup(() => o.cloud.addSolarEdge(siteId, apiKey));
      },
    },
    {
      method: "DELETE",
      pattern: /^\/v1\/integrations\/solaredge\/(\d{1,12})$/,
      handler: async ({ params }) => setup(() => o.cloud.removeSolarEdge(params[0]!)),
    },
    {
      method: "POST",
      pattern: /^\/v1\/integrations\/daikin\/start$/,
      command: true,
      handler: async ({ body }) => {
        const b = parse(z.object({ clientId: z.string().trim().max(200), clientSecret: z.string().trim().max(500), redirectUri: z.string().trim().max(500) }), await body());
        return setup(async () => o.cloud.startDaikin(b.clientId, b.clientSecret, b.redirectUri));
      },
    },
    {
      method: "POST",
      pattern: /^\/v1\/integrations\/daikin\/complete$/,
      command: true,
      handler: async ({ body }) => {
        const { callbackUrl } = parse(z.object({ callbackUrl: z.string().trim().max(4000) }), await body());
        return setup(() => o.cloud.completeDaikin(callbackUrl));
      },
    },
    { method: "DELETE", pattern: /^\/v1\/integrations\/daikin$/, handler: async () => setup(() => o.cloud.removeDaikin()) },
    {
      method: "POST",
      pattern: /^\/v1\/integrations\/tuya$/,
      command: true,
      handler: async ({ body }) => {
        const b = parse(
          z.object({ region: z.enum(["eu", "eu-west", "us", "us-east", "cn", "in"]), accessId: z.string().trim().max(64), accessSecret: z.string().trim().max(64), uid: z.string().trim().max(64) }),
          await body(),
        );
        return setup(() => o.cloud.addTuya(b.region, b.accessId, b.accessSecret, b.uid));
      },
    },
    { method: "DELETE", pattern: /^\/v1\/integrations\/tuya$/, handler: async () => setup(() => o.cloud.removeTuya()) },
    { method: "POST", pattern: /^\/v1\/integrations\/hue\/discover$/, handler: async () => o.hue.discover() },
    {
      method: "POST",
      pattern: /^\/v1\/integrations\/hue\/pair$/,
      command: true,
      handler: async ({ body }) => {
        const { host } = parse(z.object({ host: z.string().trim().max(64) }), await body());
        const r = await o.hue.pair(host);
        if (!r.ok) {
          const status = r.code === "LINK_BUTTON_NOT_PRESSED" ? 409 : r.code === "INVALID_HOST" ? 400 : 502;
          throw new HttpError(status, r.code, r.message);
        }
        return { bridge: r.bridge };
      },
    },
    {
      method: "DELETE",
      pattern: new RegExp(`^/v1/integrations/hue/${seg}$`),
      handler: async ({ params }) => {
        if (!(await o.hue.unpair(params[0]!))) throw new HttpError(404, "NOT_FOUND", "Bridge niet gevonden");
        return { ok: true };
      },
    },
    // ───── Philips Hue via de Hue-cloud ─────
    {
      method: "POST",
      pattern: /^\/v1\/integrations\/huecloud\/start$/,
      command: true,
      handler: async ({ body }) => {
        const b = parse(z.object({ clientId: z.string().trim().max(100), clientSecret: z.string().trim().max(200) }), await body());
        return setup(() => o.huecloud.start(b.clientId, b.clientSecret));
      },
    },
    {
      method: "POST",
      pattern: /^\/v1\/integrations\/huecloud\/complete$/,
      command: true,
      handler: async ({ body }) => {
        const b = parse(z.object({ code: z.string().trim().min(1).max(500), state: z.string().trim().min(1).max(200) }), await body());
        return setup(() => o.huecloud.complete(b.code, b.state));
      },
    },
    { method: "DELETE", pattern: /^\/v1\/integrations\/huecloud$/, handler: async () => setup(() => o.huecloud.remove()) },
    // ───── Google Home via de Google Assistant SDK ─────
    {
      method: "POST",
      pattern: /^\/v1\/integrations\/googlehome\/start$/,
      command: true,
      handler: async ({ body }) => {
        const b = parse(z.object({ clientId: z.string().trim().max(200), clientSecret: z.string().trim().max(200), redirectUri: z.string().trim().max(300) }), await body());
        return setup(() => o.googlehome.start(b.clientId, b.clientSecret, b.redirectUri));
      },
    },
    {
      method: "POST",
      pattern: /^\/v1\/integrations\/googlehome\/complete$/,
      command: true,
      handler: async ({ body }) => {
        const b = parse(z.object({ code: z.string().trim().min(1).max(1000), state: z.string().trim().min(1).max(200) }), await body());
        return setup(() => o.googlehome.complete(b.code, b.state));
      },
    },
    {
      method: "PUT",
      pattern: /^\/v1\/integrations\/googlehome\/devices$/,
      command: true,
      handler: async ({ body }) => {
        const b = parse(z.object({ names: z.array(z.string().max(80)).max(30) }), await body());
        return setup(() => o.googlehome.setDevices(b.names));
      },
    },
    { method: "DELETE", pattern: /^\/v1\/integrations\/googlehome$/, handler: async () => setup(() => o.googlehome.remove()) },
    // ───── Apple iCloud-agenda (alleen-lezen) ─────
    {
      method: "POST",
      pattern: /^\/v1\/integrations\/icloud$/,
      command: true,
      handler: async ({ body }) => {
        const b = parse(z.object({ appleId: z.string().trim().max(254), appPassword: z.string().trim().max(40) }), await body());
        return setup(() => o.icloud.connect(b.appleId, b.appPassword));
      },
    },
    {
      method: "PUT",
      pattern: /^\/v1\/integrations\/icloud\/calendars$/,
      command: true,
      handler: async ({ body }) => {
        const b = parse(z.object({ enabled: z.array(z.string().max(500)).max(50) }), await body());
        return setup(() => o.icloud.setCalendars(b.enabled));
      },
    },
    { method: "DELETE", pattern: /^\/v1\/integrations\/icloud$/, handler: async () => setup(() => o.icloud.remove()) },
    { method: "GET", pattern: /^\/v1\/calendar\/events$/, handler: async () => o.icloud.events() },
    // ───── Ziggo Mediabox (niet-officieel, op verzoek) ─────
    {
      method: "POST",
      pattern: /^\/v1\/integrations\/ziggo$/,
      command: true,
      handler: async ({ body }) => {
        const b = parse(z.object({ username: z.string().trim().max(254), password: z.string().max(200) }), await body());
        return setup(() => o.ziggo.connect(b.username, b.password));
      },
    },
    { method: "DELETE", pattern: /^\/v1\/integrations\/ziggo$/, handler: async () => setup(() => o.ziggo.remove()) },
    // ───── Apple-opdrachten (Shortcuts) als knoppen ─────
    {
      method: "PUT",
      pattern: /^\/v1\/integrations\/shortcuts$/,
      handler: async ({ body }) => {
        const b = parse(z.object({ items: z.array(z.object({ label: z.string().max(60), shortcut: z.string().max(120) })).max(30) }), await body());
        return setup(() => o.shortcuts.save(b.items));
      },
    },
    // ───── pushmeldingen ─────
    { method: "GET", pattern: /^\/v1\/push$/, handler: async () => o.push.info() },
    {
      method: "POST",
      pattern: /^\/v1\/push\/subscriptions$/,
      handler: async ({ body }) => {
        const b = parse(z.object({ subscription: z.unknown(), label: z.string().trim().max(80).default("Apparaat") }), await body());
        return setup(() => o.push.subscribe(b.subscription, b.label));
      },
    },
    {
      method: "POST",
      pattern: /^\/v1\/push\/unsubscribe$/,
      handler: async ({ body }) => o.push.unsubscribe(parse(z.object({ endpoint: z.string().max(1000) }), await body()).endpoint),
    },
    {
      method: "POST",
      pattern: /^\/v1\/push\/test$/,
      command: true,
      handler: async ({ body }) => setup(async () => o.push.test(parse(z.object({ endpoint: z.string().max(1000).nullish() }), (await body()) ?? {}).endpoint ?? null)),
    },
    // ───── Zonneplan Connect (niet-officieel) ─────
    {
      method: "POST",
      pattern: /^\/v1\/integrations\/zonneplan\/start$/,
      command: true,
      handler: async ({ body }) => {
        const { email } = parse(z.object({ email: z.email("Ongeldig e-mailadres").max(254) }), await body());
        return setup(() => o.zonneplan.start(email));
      },
    },
    {
      method: "POST",
      pattern: /^\/v1\/integrations\/zonneplan\/complete$/,
      command: true,
      handler: async ({ body }) => {
        const { code } = parse(z.object({ code: z.string().trim().regex(/^[0-9A-Za-z]{4,12}$/, "Vul de code uit de e-mail in") }), await body());
        return setup(() => o.zonneplan.complete(code));
      },
    },
    { method: "DELETE", pattern: /^\/v1\/integrations\/zonneplan$/, handler: async () => setup(() => o.zonneplan.remove()) },
    // ───── Tapo-camera's ─────
    { method: "GET", pattern: /^\/v1\/cameras$/, handler: async () => o.cameras.list() },
    {
      method: "GET",
      pattern: new RegExp(`^/v1/cameras/${seg}/snapshot$`),
      handler: async ({ params }) => {
        const jpeg = await setup(() => o.cameras.snapshot(params[0]!));
        return new RawResponse((_req, res) => {
          res.writeHead(200, { "content-type": "image/jpeg", "content-length": jpeg.length, "cache-control": "no-store", "x-content-type-options": "nosniff" });
          res.end(jpeg);
        });
      },
    },
    {
      method: "GET",
      pattern: new RegExp(`^/v1/cameras/${seg}/stream$`),
      handler: async ({ params }) => {
        const deviceId = params[0]!;
        // Eerst controleren dat de camera bestaat, vóór er een stream-antwoord begint.
        await setup(async () => o.cameras.check(deviceId));
        registry.recordAudit("camera.view", deviceId, true);
        return new RawResponse((req, res) => {
          let unsub: (() => void) | null = null;
          const boundary = "homeosframe";
          const end = () => {
            unsub?.();
            unsub = null;
            if (!res.writableEnded) res.end();
          };
          try {
            unsub = o.cameras.subscribe(deviceId, (jpeg) => {
              if (!res.headersSent) {
                if (!jpeg.length) {
                  unsub?.();
                  return send(res, 502, { error: { code: "NO_IMAGE", message: o.cameras.lastStreamError(deviceId) ?? "Geen beeld van de camera" } });
                }
                res.writeHead(200, { "content-type": `multipart/x-mixed-replace; boundary=${boundary}`, "cache-control": "no-store", "x-content-type-options": "nosniff", connection: "close" });
              }
              if (!jpeg.length) return end();
              if (res.writableLength > 2_000_000) return; // trage kijker: beeld overslaan
              res.write(`--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`);
              res.write(jpeg);
              res.write("\r\n");
            });
          } catch (err) {
            if (err instanceof SetupError) return send(res, err.status, { error: { code: err.code, message: err.message } });
            throw err;
          }
          req.on("close", end);
        });
      },
    },
    {
      method: "POST",
      pattern: /^\/v1\/integrations\/tapo$/,
      command: true,
      handler: async ({ body }) => {
        const b = parse(
          z.object({
            host: z.string().trim().max(64),
            username: z.string().trim().min(1, "Gebruikersnaam ontbreekt").max(64),
            password: z.string().min(1, "Wachtwoord ontbreekt").max(128),
            name: z.string().trim().max(80).optional(),
          }),
          await body(),
        );
        return setup(() => o.cameras.add(b));
      },
    },
    { method: "DELETE", pattern: /^\/v1\/integrations\/tapo\/([0-9a-f]{16})$/, handler: async ({ params }) => setup(() => o.cameras.remove(params[0]!)) },
    // ───── LG webOS-tv ─────
    { method: "POST", pattern: /^\/v1\/integrations\/webos\/discover$/, handler: async () => o.webos.discover() },
    {
      method: "POST",
      pattern: /^\/v1\/integrations\/webos\/pair$/,
      command: true,
      handler: async ({ body }) => {
        const b = parse(
          z.object({
            host: z.string().trim().max(64),
            mac: z.string().trim().regex(/^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/, "MAC-adres als AA:BB:CC:DD:EE:FF").nullish().or(z.literal("").transform(() => null)),
          }),
          await body(),
        );
        const r = await o.webos.pair(b.host, b.mac ?? null);
        if (!r.ok) {
          const status = r.code === "INVALID_HOST" ? 400 : r.code === "REJECTED" ? 403 : r.code === "TIMEOUT" ? 408 : r.code === "BUSY" ? 409 : 502;
          throw new HttpError(status, r.code, r.message);
        }
        return { tv: { ...r.tv, fingerprint256: undefined } };
      },
    },
    {
      method: "DELETE",
      pattern: /^\/v1\/integrations\/webos\/([0-9a-f]{16})$/,
      handler: async ({ params }) => {
        if (!(await o.webos.unpair(params[0]!))) throw new HttpError(404, "NOT_FOUND", "Tv niet gevonden");
        return { ok: true };
      },
    },
    // ───── automatiseringen ─────
    { method: "GET", pattern: /^\/v1\/automations$/, handler: async () => ({ automations: o.automations.list() }) },
    { method: "GET", pattern: /^\/v1\/automations\/templates$/, handler: async () => o.automations.templates() },
    {
      method: "GET",
      pattern: /^\/v1\/automations\/runs$/,
      handler: async ({ url }) => ({ runs: o.automations.runs(parse(limitSchema, url.searchParams.get("limit") ?? undefined), url.searchParams.get("automationId") ?? undefined) }),
    },
    { method: "POST", pattern: /^\/v1\/automations$/, handler: async ({ body }) => setup(async () => o.automations.create(await body())) },
    { method: "PATCH", pattern: new RegExp(`^/v1/automations/${seg}$`), handler: async ({ params, body }) => setup(async () => o.automations.update(params[0]!, await body())) },
    { method: "DELETE", pattern: new RegExp(`^/v1/automations/${seg}$`), handler: async ({ params }) => setup(() => o.automations.remove(params[0]!)) },
    { method: "POST", pattern: new RegExp(`^/v1/automations/${seg}/run$`), command: true, handler: async ({ params }) => setup(() => o.automations.runNow(params[0]!)) },
    // ───── meldingen ─────
    { method: "GET", pattern: /^\/v1\/notifications$/, handler: async ({ url }) => ({ notifications: o.automations.notifications(parse(limitSchema, url.searchParams.get("limit") ?? undefined)) }) },
    {
      method: "POST",
      pattern: /^\/v1\/notifications\/read$/,
      handler: async ({ body }) => o.automations.markRead(parse(z.object({ ids: z.array(z.string().max(64)).max(300).or(z.literal("all")) }), await body()).ids),
    },
    { method: "GET", pattern: /^\/v1\/notifications\/preferences$/, handler: async () => o.automations.preferences() },
    {
      method: "PUT",
      pattern: /^\/v1\/notifications\/preferences$/,
      handler: async ({ body }) => o.automations.setPreferences(parse(z.partialRecord(z.enum(NOTIFICATION_CATEGORIES), z.boolean()), await body())),
    },
    { method: "GET", pattern: /^\/v1\/identity$/, handler: async () => registry.identity() },
    { method: "PUT", pattern: /^\/v1\/rooms$/, handler: async ({ body }) => unwrap(await registry.replaceRooms(parse(RoomsReplaceSchema, await body()).rooms)) },
    { method: "POST", pattern: /^\/v1\/rooms$/, handler: async ({ body }) => unwrap(await registry.createRoom(parse(RoomInputSchema, await body()))) },
    {
      method: "PATCH",
      pattern: new RegExp(`^/v1/rooms/${seg}$`),
      handler: async ({ params, body }) => unwrap(await registry.updateRoom(params[0]!, parse(RoomInputSchema, await body()))),
    },
    { method: "DELETE", pattern: new RegExp(`^/v1/rooms/${seg}$`), handler: async ({ params }) => unwrap(await registry.deleteRoom(params[0]!)) },
    {
      method: "GET",
      pattern: /^\/v1\/energy\/summary$/,
      handler: async () => {
        const s = await registry.energySummary();
        if (!s) throw new HttpError(404, "NO_ENERGY_SOURCE", "Geen energiebron gekoppeld");
        return s;
      },
    },
    {
      method: "GET",
      pattern: /^\/v1\/energy\/history$/,
      handler: async ({ url }) => {
        const range = parse(EnergyRangeSchema, url.searchParams.get("range") ?? "day");
        const h = await registry.energyHistory(range);
        if (!h) throw new HttpError(404, "NO_ENERGY_SOURCE", "Geen energiebron gekoppeld");
        return h;
      },
    },
    { method: "GET", pattern: /^\/v1\/events$/, handler: async ({ url }) => ({ events: registry.events(parse(limitSchema, url.searchParams.get("limit") ?? undefined)) }) },
    { method: "GET", pattern: /^\/v1\/audit$/, handler: async ({ url }) => ({ entries: registry.auditLog(parse(limitSchema, url.searchParams.get("limit") ?? undefined)) }) },
    {
      method: "POST",
      pattern: /^\/v1\/emergency-stop$/,
      handler: async ({ body }) => {
        const { active } = parse(EmergencyStopSchema, await body());
        await registry.setEmergencyStop(active);
        return { emergencyStop: active };
      },
    },
  ];

  const send = (res: ServerResponse, status: number, data: unknown) => {
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    res.end(JSON.stringify(data));
  };

  const hostAllowed = (req: IncomingMessage) => {
    const host = (req.headers.host ?? "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
    return o.allowedHosts.includes(host);
  };

  const authorized = (req: IncomingMessage) => {
    const h = req.headers.authorization ?? "";
    return h.startsWith("Bearer ") && tokensEqual(h.slice(7).trim(), o.token);
  };

  const readBody = (req: IncomingMessage) => async (): Promise<unknown> => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY) throw new HttpError(413, "TOO_LARGE", "Verzoek te groot");
      chunks.push(chunk as Buffer);
    }
    if (size === 0) return undefined;
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new HttpError(400, "INVALID_JSON", "Ongeldige JSON");
    }
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://connector.local");
      if (!hostAllowed(req)) throw new HttpError(421, "BAD_HOST", "Host niet toegestaan");
      // Browsers sturen een Origin-header; de connector accepteert alleen server-naar-server verkeer.
      if (req.headers.origin) throw new HttpError(403, "BROWSER_FORBIDDEN", "Directe browsertoegang is niet toegestaan");
      if (url.pathname === "/health" && req.method === "GET") return send(res, 200, { ok: true, version: o.version });
      const ip = req.socket.remoteAddress ?? "unknown";
      if (!general.take(ip)) throw new HttpError(429, "RATE_LIMITED", "Te veel verzoeken");
      if (!authorized(req)) throw new HttpError(401, "UNAUTHORIZED", "Ongeldig of ontbrekend connector-token");
      if (o.cloudMode && /^\/v1\/(integrations\/(hue|webos|tapo|matter)|cameras)(\/|$)/.test(url.pathname)) {
        throw new HttpError(409, "LOCAL_ONLY", "Niet beschikbaar in de cloudmodus: dit apparaat is alleen bereikbaar via je eigen netwerk.");
      }

      for (const route of routes) {
        if (route.method !== req.method) continue;
        const m = route.pattern.exec(url.pathname);
        if (!m) continue;
        if (route.command && !commands.take(ip)) throw new HttpError(429, "RATE_LIMITED", "Te veel opdrachten, probeer het zo opnieuw");
        const params = m.slice(1).map((p) => decodeURIComponent(p));
        const data = await route.handler({ req, params, url, body: readBody(req) });
        if (data instanceof RawResponse) return await data.write(req, res);
        return send(res, 200, data);
      }
      throw new HttpError(404, "NOT_FOUND", "Onbekend endpoint");
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: { code: err.code, message: err.message } });
      o.logger.error("Onverwachte fout in API", { error: String(err) });
      return send(res, 500, { error: { code: "INTERNAL", message: "Interne fout" } });
    }
  });

  // ---------- WebSocket: realtime snapshots en gebeurtenissen ----------
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  const clients = new Set<WebSocket>();
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://connector.local");
    if (url.pathname !== "/v1/ws" || !hostAllowed(req) || req.headers.origin || !authorized(req)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      clients.add(ws);
      ws.on("close", () => clients.delete(ws));
      ws.on("message", () => undefined); // inkomende berichten worden genegeerd: geen remote commands via WS
      const msg: ConnectorMessage = { type: "snapshot", data: registry.snapshot() };
      ws.send(JSON.stringify(msg));
    });
  });
  const broadcast = (msg: ConnectorMessage) => {
    const data = JSON.stringify(msg);
    for (const c of clients) if (c.readyState === c.OPEN) c.send(data);
  };
  registry.on("snapshot", (data) => broadcast({ type: "snapshot", data }));
  registry.on("event", (data) => broadcast({ type: "event", data }));
  o.automations.events.on("notification", (data) => broadcast({ type: "notification", data }));
  o.automations.events.on("run", (data) => broadcast({ type: "automation_run", data }));

  return {
    server,
    listen(port: number, host: string): Promise<AddressInfo> {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => resolve(server.address() as AddressInfo));
      });
    },
    async close(): Promise<void> {
      for (const c of clients) c.terminate();
      wss.close();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
