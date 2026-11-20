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

export interface ServerOptions {
  registry: DeviceRegistry;
  token: string;
  logger: Logger;
  version: string;
  rateLimitPerMin: number;
  commandLimitPerMin: number;
  /** Toegestane Host-headers (bescherming tegen DNS-rebinding). */
  allowedHosts: string[];
  hue: HueService;
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
    { method: "GET", pattern: /^\/v1\/integrations$/, handler: async () => ({ hue: o.hue.list() }) },
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

      for (const route of routes) {
        if (route.method !== req.method) continue;
        const m = route.pattern.exec(url.pathname);
        if (!m) continue;
        if (route.command && !commands.take(ip)) throw new HttpError(429, "RATE_LIMITED", "Te veel opdrachten, probeer het zo opnieuw");
        const params = m.slice(1).map((p) => decodeURIComponent(p));
        const data = await route.handler({ req, params, url, body: readBody(req) });
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
