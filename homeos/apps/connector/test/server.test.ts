import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { SnapshotSchema } from "@homeos/shared";
import { startTestConnector } from "./helpers";

type T = Awaited<ReturnType<typeof startTestConnector>>;
let t: T | null = null;
afterEach(async () => {
  await t?.close();
  t = null;
});

const lamp = encodeURIComponent("demo-lights:keuken-spots");

describe("connector API — beveiliging", () => {
  it("health is openbaar maar lekt geen identiteit", async () => {
    t = await startTestConnector();
    const r = await fetch(`${t.base}/health`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toEqual({ ok: true, version: "0.1.0" });
  });

  it("weigert verzoeken zonder of met fout token", async () => {
    t = await startTestConnector();
    expect((await fetch(`${t.base}/v1/snapshot`)).status).toBe(401);
    expect((await fetch(`${t.base}/v1/snapshot`, { headers: { authorization: "Bearer fout" } })).status).toBe(401);
  });

  it("weigert directe browsertoegang (Origin-header)", async () => {
    t = await startTestConnector();
    const r = await t.call("/v1/snapshot", { headers: { origin: "https://evil.example" } });
    expect(r.status).toBe(403);
  });

  it("weigert onbekende Host-headers (DNS-rebinding)", async () => {
    t = await startTestConnector();
    const http = await import("node:http");
    const status = await new Promise<number>((resolve) => {
      http.get({ host: "127.0.0.1", port: t!.port, path: "/health", headers: { host: "evil.example" } }, (res) => resolve(res.statusCode ?? 0));
    });
    expect(status).toBe(421);
  });

  it("valideert opdrachten met zod", async () => {
    t = await startTestConnector();
    const r = await t.call(`/v1/devices/${lamp}/commands`, { method: "POST", body: JSON.stringify({ command: { type: "shell", cmd: "ls" } }) });
    expect(r.status).toBe(400);
    const bad = await t.call(`/v1/devices/${lamp}/commands`, { method: "POST", body: "{niet-json" });
    expect(bad.status).toBe(400);
  });

  it("past rate limiting toe op opdrachten", async () => {
    t = await startTestConnector({ commandLimitPerMin: 3 });
    const body = JSON.stringify({ command: { type: "set_power", on: true } });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await t.call(`/v1/devices/${lamp}/commands`, { method: "POST", body })).status);
    expect(codes.slice(0, 3)).toEqual([200, 200, 200]);
    expect(codes).toContain(429);
  });

  it("bewaart het token alleen met eigenaarsrechten", async () => {
    t = await startTestConnector();
    const { stat } = await import("node:fs/promises");
    const s = await stat(path.join(t.dataDir, "api-token"));
    expect(s.mode & 0o077).toBe(0);
  });
});

describe("connector API — functionaliteit", () => {
  it("levert een geldige snapshot met DEMO-apparaten", async () => {
    t = await startTestConnector();
    const snap = SnapshotSchema.parse(await (await t.call("/v1/snapshot")).json());
    expect(snap.devices.length).toBeGreaterThan(5);
    expect(snap.devices.every((d) => d.demo)).toBe(true);
    expect(snap.connector.demoMode).toBe(true);
  });

  it("voert een opdracht uit en logt hem in het auditlog", async () => {
    t = await startTestConnector();
    const r = await t.call(`/v1/devices/${lamp}/commands`, { method: "POST", body: JSON.stringify({ command: { type: "set_brightness", brightness: 33 } }) });
    expect(r.status).toBe(200);
    const { device } = await r.json();
    expect(device.state.brightness).toBe(33);
    const audit = await (await t.call("/v1/audit?limit=5")).json();
    expect(audit.entries[0]).toMatchObject({ action: "device.command", ok: true, target: "demo-lights:keuken-spots" });
    const raw = await readFile(path.join(t.dataDir, "logs", "audit.jsonl"), "utf8").catch(() => "");
    // schrijven is asynchroon; als het bestand er al is moet de opdracht erin staan
    if (raw) expect(raw).toContain("device.command");
  });

  it("geeft duidelijke foutcodes", async () => {
    t = await startTestConnector();
    const offline = await t.call(`/v1/devices/${encodeURIComponent("demo-lights:tuin-wandlamp")}/commands`, {
      method: "POST",
      body: JSON.stringify({ command: { type: "set_power", on: true } }),
    });
    expect(offline.status).toBe(409);
    const unsupported = await t.call(`/v1/devices/${lamp}/commands`, { method: "POST", body: JSON.stringify({ command: { type: "media", action: "play" } }) });
    expect(unsupported.status).toBe(422);
    const missing = await t.call(`/v1/devices/bestaat-niet/commands`, { method: "POST", body: JSON.stringify({ command: { type: "set_power", on: true } }) });
    expect(missing.status).toBe(404);
  });

  it("noodstop blokkeert Jarvis/automatisering maar niet de gebruiker", async () => {
    t = await startTestConnector();
    await t.call("/v1/emergency-stop", { method: "POST", body: JSON.stringify({ active: true }) });
    const auto = await t.call(`/v1/devices/${lamp}/commands`, { method: "POST", body: JSON.stringify({ command: { type: "set_power", on: true }, source: "automation" }) });
    expect(auto.status).toBe(423);
    const scene = await t.call(`/v1/scenes/${encodeURIComponent("demo-lights:avond")}/activate`, { method: "POST", body: JSON.stringify({ source: "jarvis" }) });
    expect(scene.status).toBe(423);
    const user = await t.call(`/v1/devices/${lamp}/commands`, { method: "POST", body: JSON.stringify({ command: { type: "set_power", on: true } }) });
    expect(user.status).toBe(200);
  });

  it("beheert kamers en apparaten", async () => {
    t = await startTestConnector();
    const room = await (await t.call("/v1/rooms", { method: "POST", body: JSON.stringify({ name: "Zolder" }) })).json();
    expect(room.id).toBe("zolder");
    expect((await t.call(`/v1/devices/${lamp}`, { method: "PATCH", body: JSON.stringify({ name: "Keukenspots", roomId: "zolder" }) })).status).toBe(200);
    let snap = await (await t.call("/v1/snapshot")).json();
    expect(snap.devices.find((d: { id: string }) => d.id === "demo-lights:keuken-spots")).toMatchObject({ name: "Keukenspots", roomId: "zolder" });
    expect((await t.call(`/v1/rooms/zolder`, { method: "DELETE" })).status).toBe(200);
    snap = await (await t.call("/v1/snapshot")).json();
    expect(snap.devices.find((d: { id: string }) => d.id === "demo-lights:keuken-spots").roomId).toBeNull();
    expect((await t.call(`/v1/devices/${lamp}`, { method: "PATCH", body: JSON.stringify({ roomId: "bestaat-niet" }) })).status).toBe(400);
  });

  it("verwijdert en voegt apparaten opnieuw toe", async () => {
    t = await startTestConnector();
    expect((await t.call(`/v1/devices/${lamp}`, { method: "DELETE" })).status).toBe(200);
    const avail = await (await t.call("/v1/devices/available")).json();
    expect(avail.devices.map((d: { id: string }) => d.id)).toContain("demo-lights:keuken-spots");
    const cmd = await t.call(`/v1/devices/${lamp}/commands`, { method: "POST", body: JSON.stringify({ command: { type: "set_power", on: true } }) });
    expect(cmd.status).toBe(404);
    expect((await t.call(`/v1/devices/${lamp}/add`, { method: "POST", body: JSON.stringify({ roomId: "keuken" }) })).status).toBe(200);
  });

  it("bewaart configuratie na een herstart", async () => {
    t = await startTestConnector();
    await t.call(`/v1/devices/${lamp}`, { method: "PATCH", body: JSON.stringify({ name: "Hernoemd" }) });
    const dir = t.dataDir;
    const token = t.token;
    await t.close(false);
    t = await startTestConnector({ dataDir: dir });
    expect(t.token).toBe(token);
    const snap = await (await t.call("/v1/snapshot")).json();
    expect(snap.devices.find((d: { id: string }) => d.id === "demo-lights:keuken-spots").name).toBe("Hernoemd");
  });

  it("levert energiegegevens", async () => {
    t = await startTestConnector();
    const s = await (await t.call("/v1/energy/summary")).json();
    expect(s.demo).toBe(true);
    expect((await t.call("/v1/energy/history?range=week")).status).toBe(200);
    expect((await t.call("/v1/energy/history?range=eeuw")).status).toBe(400);
  });

  it("start zonder demo zonder nep-apparaten", async () => {
    t = await startTestConnector({ demo: false });
    const snap = await (await t.call("/v1/snapshot")).json();
    expect(snap.devices).toEqual([]);
    expect((await t.call("/v1/energy/summary")).status).toBe(404);
  });
});

describe("connector WebSocket", () => {
  it("weigert zonder token en stuurt snapshots met token", async () => {
    t = await startTestConnector();
    const url = `ws://127.0.0.1:${t.port}/v1/ws`;
    const denied = await new Promise<string>((resolve) => {
      const ws = new WebSocket(url);
      ws.on("error", () => resolve("error"));
      ws.on("open", () => resolve("open"));
    });
    expect(denied).toBe("error");
    const msg = await new Promise<{ type: string }>((resolve, reject) => {
      const ws = new WebSocket(url, { headers: { authorization: `Bearer ${t!.token}` } });
      ws.on("message", (d) => {
        resolve(JSON.parse(String(d)));
        ws.close();
      });
      ws.on("error", reject);
    });
    expect(msg.type).toBe("snapshot");
  });
});
