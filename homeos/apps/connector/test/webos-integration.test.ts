import { afterEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pairTv, WebOsAdapter } from "@homeos/integrations";
import type { WebOsDeps } from "../src/webos-service";
import { startTestConnector } from "./helpers";
import { FakeWebOsTv } from "../../../packages/integrations/test/fake-webos";

type T = Awaited<ReturnType<typeof startTestConnector>>;
let t: T | null = null;
let tv: FakeWebOsTv | null = null;
afterEach(async () => {
  await t?.close();
  await tv?.stop();
  t = null;
  tv = null;
});

/** Nagebootste tv op 127.0.0.1; er wordt nooit een echte tv aangesproken. */
function deps(fake: FakeWebOsTv, woken: string[]): WebOsDeps {
  return {
    discover: async () => [{ host: "192.168.68.20", name: "[LG] webOS TV OLED48CX6LB" }],
    pair: (host, mac) => pairTv(host === "192.168.68.20" ? "127.0.0.1" : host, { manualMac: mac, hostCheck: (h) => h === "127.0.0.1", ports: { wssPort: fake.port } }),
    makeAdapter: (rec) => new WebOsAdapter(rec, { ports: { wssPort: fake.port }, wol: async (m) => void woken.push(m) }),
  };
}

describe("LG-tv in de connector", () => {
  it("zoekt, koppelt, bewaart de key versleuteld, bedient en ontkoppelt", async () => {
    tv = new FakeWebOsTv();
    await tv.start();
    const woken: string[] = [];
    t = await startTestConnector({ demo: false }, undefined, undefined, deps(tv, woken));

    const found = await (await t.call("/v1/integrations/webos/discover", { method: "POST" })).json();
    expect(found.tvs[0]).toMatchObject({ host: "192.168.68.20", paired: false });
    expect((await t.call("/v1/integrations/webos/pair", { method: "POST", body: JSON.stringify({ host: "8.8.8.8" }) })).status).toBe(400);
    expect((await t.call("/v1/integrations/webos/pair", { method: "POST", body: JSON.stringify({ host: "192.168.68.20", mac: "geen-mac" }) })).status).toBe(400);

    const paired = await t.call("/v1/integrations/webos/pair", { method: "POST", body: JSON.stringify({ host: "192.168.68.20" }) });
    expect(paired.status).toBe(200);
    const body = await paired.json();
    expect(body.tv).toMatchObject({ model: "OLED48CX6LB", mac: "aa:bb:cc:dd:ee:ff" });
    expect(JSON.stringify(body)).not.toContain("fake-client-key");

    // De client-key staat niet leesbaar op schijf.
    const secretsFile = await readFile(path.join(t.dataDir, "secrets.enc"), "utf8");
    expect(secretsFile.length).toBeGreaterThan(0);
    const files = [secretsFile, await readFile(path.join(t.dataDir, "integrations.json"), "utf8")];
    expect(files.join("")).not.toContain("fake-client-key-123");

    const list = await (await t.call("/v1/integrations")).json();
    expect(list.webos[0]).toMatchObject({ model: "OLED48CX6LB", encrypted: true, wakeOnLan: true });

    const snap = await (await t.call("/v1/snapshot")).json();
    const dev = snap.devices.find((d: { kind: string; integration: string }) => d.integration === "lg_webos");
    expect(dev).toMatchObject({ kind: "media", status: "ONLINE" });
    const cmd = await t.call(`/v1/devices/${encodeURIComponent(dev.id)}/commands`, { method: "POST", body: JSON.stringify({ command: { type: "set_volume", volume: 30 }, source: "user" }) });
    expect(cmd.status).toBe(200);
    expect(tv.volume).toBe(30);

    const tvId = list.webos[0].tvId;
    expect((await t.call(`/v1/integrations/webos/${tvId}`, { method: "DELETE" })).status).toBe(200);
    const after = await (await t.call("/v1/snapshot")).json();
    expect(after.devices.some((d: { integration: string }) => d.integration === "lg_webos")).toBe(false);
  }, 30_000);
});
