import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { importToCloud } from "../src/cloud-import";
import { memoryStorage, registerStorage, unregisterStorage } from "../src/fs-utils";
import { IntegrationsStore } from "../src/integrations-store";
import { SecretStore } from "../src/secret-store";
import { StateStore } from "../src/state-store";
import { tempDir } from "./helpers";

const HH = "33333333-2222-4333-8444-555555555555";
const CLOUD_SECRET = "cloud-sleutel-die-lang-genoeg-is-0123456789abcdef";

describe("overzetten van de MacBook naar de cloud", () => {
  it("neemt alleen cloud-koppelingen mee, versleutelt opnieuw en laat lokale apparaten weg", async () => {
    // ── nagebootste MacBook-datamap
    const dir = await tempDir();
    const ints = await IntegrationsStore.open(dir);
    ints.state.zonneplan = { connectionUuid: "11111111-2222-4333-8444-555555555555", label: "Connect", addedAt: "2026-11-20T10:00:00Z" };
    ints.state.tuya = { region: "eu", accessId: "abc", uid: "eu123", addedAt: "2026-11-20T10:00:00Z" };
    ints.state.solaredge = [{ siteId: "123456", name: "Lacroix Jorg", timeZone: "Europe/Amsterdam", peakPowerKw: 3.06, addedAt: "2026-11-20T10:00:00Z" }];
    ints.state.hue = [{ bridgeId: "001788fffe123456", host: "192.168.68.131", name: "Hue", fingerprint256: "AA:BB:CC:DD:EE:FF:00", pairedAt: "2026-11-20T10:00:00Z" }];
    ints.state.webos = [{ tvId: "0123456789abcdef", host: "192.168.68.20", name: "LG", model: "OLED48CX6LB", scheme: "wss", fingerprint256: null, mac: null, pairedAt: "2026-11-20T10:00:00Z" }];
    await ints.save();
    const local = new SecretStore(dir, null);
    await local.importAll({
      "zonneplan-555555:tokens": JSON.stringify({ accessToken: "a", refreshToken: "r", expiresAt: 1 }),
      "tuya:accessSecret": "tuya-geheim",
      "solaredge-123456:apiKey": "se-sleutel",
      "hue-123456:appKey": "hue-lokaal",
      "lgtv-abcdef:clientKey": "tv-lokaal",
      "push:vapidPrivate": "oud",
    });
    const state = await StateStore.open(dir);
    state.state.devices = {
      "tuya:bf123": { name: "Koffiezetapparaat", roomId: "keuken", addedAt: "2026-11-20T10:00:00Z" },
      "hue-123456:l-1": { name: "Plafond", roomId: "woonkamer", addedAt: "2026-11-20T10:00:00Z" },
      "demo-lights:spots": { addedAt: "2026-11-20T10:00:00Z" },
    };
    await state.save();
    await writeFile(path.join(dir, "automations.json"), JSON.stringify({ version: 1, automations: [{ id: "a1" }], preferences: {} }));

    // ── proefrun schrijft niets
    const storage = memoryStorage();
    const dry = await importToCloud({ localDir: dir, localSecret: null, householdId: HH, cloudSecret: CLOUD_SECRET, storage, dryRun: true });
    expect(storage.docs.size).toBe(0);
    expect(dry).toMatchObject({ secrets: 3, devices: 1, automations: 1 });
    expect(dry.integrations).toEqual(["SolarEdge (1)", "Smart Life/Tuya", "Zonneplan Connect"]);
    expect(dry.skipped.join(" ")).toMatch(/Hue-bridge.*LG-tv/);

    // ── echt overzetten
    await importToCloud({ localDir: dir, localSecret: null, householdId: HH, cloudSecret: CLOUD_SECRET, storage });
    expect(JSON.stringify([...storage.docs.values()])).not.toContain("tuya-geheim"); // versleuteld
    const prefix = `db://${HH}`;
    registerStorage(prefix, storage);
    try {
      const cloud = new SecretStore(prefix, CLOUD_SECRET);
      const all = await cloud.exportAll();
      expect(all["tuya:accessSecret"]).toBe("tuya-geheim");
      expect(all["solaredge-123456:apiKey"]).toBe("se-sleutel");
      expect(Object.keys(all).some((k) => k.startsWith("hue-") || k.startsWith("lgtv-") || k.startsWith("push"))).toBe(false);
      const ci = await IntegrationsStore.open(prefix);
      expect(ci.state.hue).toEqual([]);
      expect(ci.state.webos).toEqual([]);
      expect(ci.state.tuya?.uid).toBe("eu123");
      const cs = await StateStore.open(prefix);
      expect(Object.keys(cs.state.devices)).toEqual(["tuya:bf123"]);
      expect(storage.docs.get("automations.json")).toContain("a1");
      // Met een verkeerde cloudsleutel is niets te lezen.
      await expect(new SecretStore(prefix, "een-andere-sleutel-die-ook-lang-genoeg-is-123").exportAll()).rejects.toThrow();
    } finally {
      unregisterStorage(prefix);
    }
  });
});
