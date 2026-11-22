import { afterEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { HueAdapter } from "@homeos/integrations";
import type { HueDeps } from "../src/hue-service";
import { startTestConnector } from "./helpers";
import { fakeBridge } from "../../../packages/integrations/test/fake-bridge";

type T = Awaited<ReturnType<typeof startTestConnector>>;
let t: T | null = null;
afterEach(async () => {
  await t?.close();
  t = null;
});

/** Nep-bridge: er wordt nooit een echt netwerkapparaat aangesproken. */
function deps(pressed = { value: false }): HueDeps {
  const bridge = fakeBridge();
  return {
    discover: async () => [{ id: "001788fffe123456", host: "192.168.1.20", source: "discovery" }],
    pair: async (host) => {
      if (host === "8.8.8.8") return { ok: false, code: "INVALID_HOST", message: "Gebruik het lokale IP-adres" };
      if (!pressed.value) return { ok: false, code: "LINK_BUTTON_NOT_PRESSED", message: "Druk op de knop" };
      return { ok: true, bridge: { bridgeId: "001788fffe123456", name: "Testbridge", modelId: "BSB002", apiVersion: "1.70.0" }, fingerprint256: "AA:BB:CC:DD:EE:FF", appKey: "super-geheime-key", clientKey: "ck" };
    },
    makeAdapter: (cfg) => new HueAdapter(cfg, () => bridge.http),
  };
}

describe("Hue in de connector", () => {
  it("zoekt, koppelt (met link-knop), bewaart de key versleuteld en voegt lampen toe", async () => {
    const pressed = { value: false };
    t = await startTestConnector({ demo: false }, deps(pressed));
    const found = await (await t.call("/v1/integrations/hue/discover", { method: "POST" })).json();
    expect(found.bridges[0]).toMatchObject({ host: "192.168.1.20", paired: false });

    const notPressed = await t.call("/v1/integrations/hue/pair", { method: "POST", body: JSON.stringify({ host: "192.168.1.20" }) });
    expect(notPressed.status).toBe(409);
    expect((await notPressed.json()).error.code).toBe("LINK_BUTTON_NOT_PRESSED");
    expect((await t.call("/v1/integrations/hue/pair", { method: "POST", body: JSON.stringify({ host: "8.8.8.8" }) })).status).toBe(400);

    pressed.value = true;
    const ok = await t.call("/v1/integrations/hue/pair", { method: "POST", body: JSON.stringify({ host: "192.168.1.20" }) });
    expect(ok.status).toBe(200);
    const body = await ok.text();
    expect(body).not.toContain("super-geheime-key");

    const snap = await (await t.call("/v1/snapshot")).json();
    const plafond = snap.devices.find((d: { name: string }) => d.name === "Plafond");
    expect(plafond).toMatchObject({ brand: "Philips Hue", demo: false, integration: "philips_hue", roomId: "woonkamer", status: "ONLINE" });
    expect(snap.devices.find((d: { name: string }) => d.name === "Tuinlamp").status).toBe("OFFLINE");
    expect(snap.scenes.map((s: { name: string }) => s.name)).toContain("Ontspannen · Woonkamer");

    // Key staat alleen versleuteld op schijf, nergens leesbaar
    const files = ["integrations.json", "registry.json", "secrets.enc"];
    for (const f of files) expect(await readFile(path.join(t.dataDir, f), "utf8")).not.toContain("super-geheime-key");

    const cmd = await t.call(`/v1/devices/${encodeURIComponent(plafond.id)}/commands`, { method: "POST", body: JSON.stringify({ command: { type: "set_power", on: true } }) });
    expect(cmd.status).toBe(200);
    expect((await cmd.json()).device.state.on).toBe(true);

    const list = await (await t.call("/v1/integrations")).json();
    expect(list.hue[0]).toMatchObject({ bridgeId: "001788fffe123456", name: "Testbridge" });
    expect(JSON.stringify(list)).not.toContain("AA:BB");
  });

  it("herstelt een gekoppelde bridge na herstart en ontkoppelt volledig", async () => {
    const d = deps({ value: true });
    t = await startTestConnector({ demo: false }, d);
    await t.call("/v1/integrations/hue/pair", { method: "POST", body: JSON.stringify({ host: "192.168.1.20" }) });
    const dir = t.dataDir;
    await t.close(false);
    t = await startTestConnector({ demo: false, dataDir: dir }, d);
    let snap = await (await t.call("/v1/snapshot")).json();
    expect(snap.devices.length).toBe(2);
    expect((await t.call("/v1/integrations/hue/001788fffe123456", { method: "DELETE" })).status).toBe(200);
    snap = await (await t.call("/v1/snapshot")).json();
    expect(snap.devices).toEqual([]);
    expect((await t.call("/v1/integrations")).ok).toBe(true);
    expect((await (await t.call("/v1/integrations")).json()).hue).toEqual([]);
  });
});
